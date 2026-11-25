// ai-gateway: única porta entre o Hermes (assistente no Discord) e o banco.
// Chamado servidor a servidor (verify_jwt = false) por dois clientes, cada um com o seu segredo:
// - plugin do Hermes (x-hermes-secret): leitura e escrita em duas fases (propose/commit, Etapa 5). O
//   discord_user_id vem do contexto da sessão do Hermes, nunca do LLM (spike S1), e tudo roda com a sessão
//   do próprio usuário (RLS). Prévias resistentes a reinício (O3): depois de postar a prévia, o plugin grava
//   canal e mensagem com preview_posted; ao iniciar, chama resume_previews (sem usuário) e recebe as prévias
//   abertas com um código novo, porque o banco guarda só o hash do anterior.
// - rotina diária (x-routine-secret, Etapa 4): lista os canais mapeados e grava o resumo do dia.
//   Não há usuário: roda com o service_role, restrita às ROUTINE_TOOLS (N5).
// Telemetria de uso da IA (O5, DP3): o plugin envia os tokens do bot e da transcrição com record_usage (sem
// usuário, como resume_previews); a rotina grava os dela com routine_record_usage e lê o resumo do mês com
// routine_usage_summary. Só contagens de tokens e nome do modelo, nunca conteúdo.
// Onda 7 (labels.ts): tarefas trazem o nome do responsável (P10) e projetos vêm com o rótulo
// "Projeto - Cliente" (P13), também nas prévias. O cliente segue a RLS de clients (clients.view).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { embeddedName, labelFromEmbed, projectLabel, withAssigneeNames } from "./labels.ts";
import { aggregateUsage, parseRange, parseUsageRows, todayBrt, type UsageRow, UsageError, type UsageSource } from "./usage.ts";

const RATE_LIMIT_PER_MIN = 30; // DV7
const PROPOSE_LIMIT_PER_MIN = 10; // DV7: escrita
const CONFIRM_TTL_MS = 10 * 60_000; // DV7: confirmação válida por 10 min
const MAX_ATTEMPTS = 3; // DV7
const EXCERPT = 2000;
// list_members (F3): id, nome e papel de quem está no projeto, para o LLM trocar o nome da ata por assignee_id.
const TOOLS = ["list_projects", "list_tasks", "get_task", "list_members", "search_context", "search_knowledge"] as const;
// whoami (Etapa 6): só confirma que o autor está vinculado a um perfil ativo e interno, sem abrir sessão.
// O plugin consulta antes de enviar um áudio ao provedor de transcrição.
// preview_posted (O3): o plugin informa onde postou a prévia, para retomá-la depois de um reinício.
const WRITE_TOOLS = ["propose", "commit", "cancel", "whoami", "preview_posted"] as const;
const RESUME_LIMIT = 200; // O3: prévias devolvidas por resume_previews
const ROUTINE_TOOLS = ["routine_list_channels", "routine_upsert_context", "routine_record_usage", "routine_usage_summary"] as const;
type Tool = (typeof TOOLS)[number];
type Args = Record<string, unknown>;
type Status = "proposed" | "executed" | "denied" | "error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_RE = /^[0-9]{17,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class GatewayError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// Comparação em tempo constante: HMAC dos dois valores com chave aleatória e comparação byte a byte.
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(given)),
    crypto.subtle.sign("HMAC", key, enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function str(args: Args, name: string, required: boolean): string | undefined {
  const v = args[name];
  if (v === undefined || v === null || v === "") {
    if (required) throw new GatewayError(400, "invalid_args", `Informe ${name}.`);
    return undefined;
  }
  if (typeof v !== "string") throw new GatewayError(400, "invalid_args", `${name} deve ser texto.`);
  return v.trim();
}

function uuidArg(args: Args, name: string, required: boolean): string | undefined {
  const v = str(args, name, required);
  if (v !== undefined && !UUID_RE.test(v)) throw new GatewayError(400, "invalid_args", `${name} inválido.`);
  return v;
}

function queryArg(args: Args): string {
  const q = str(args, "query", true)!;
  if (q.length > 200) throw new GatewayError(400, "invalid_args", "A busca deve ter até 200 caracteres.");
  return q;
}

const cut = (text: string | null) => (text && text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text);

// Nomes dos responsáveis (P10), numa consulta só e com a sessão do usuário (internos veem todos os perfis).
async function peopleNames(db: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const { data, error } = await db.from("profiles").select("id, name").in("id", unique);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id as string, p.name as string]));
}

// Projeto da tarefa ou do trecho de contexto, para o rótulo "Projeto - Cliente" (P13).
const PROJECT_EMBED = "projects(name, clients(name))";

// Cada ferramenta: colunas explícitas, sem escrita, sem SQL arbitrário.
async function runTool(db: SupabaseClient, tool: Tool, args: Args): Promise<unknown[] | Record<string, unknown> | null> {
  switch (tool) {
    case "list_projects": {
      const { data, error } = await db
        .from("projects")
        .select("id, name, status, start_date, end_date, clients(name)")
        .order("name");
      if (error) throw error;
      return (data ?? []).map(({ clients, ...p }) => {
        const client = embeddedName(clients);
        return { id: p.id, label: projectLabel(p.name as string, client), name: p.name, client, status: p.status,
                 start_date: p.start_date, end_date: p.end_date };
      });
    }
    case "list_tasks": {
      const projectId = uuidArg(args, "project_id", true)!;
      const { data, error } = await db
        .from("tasks")
        .select("id, title, status, assignee_id, client_owner, due_date")
        .eq("project_id", projectId)
        .order("position")
        .limit(200);
      if (error) throw error;
      const rows = data ?? [];
      return withAssigneeNames(rows, await peopleNames(db, rows.map((t) => t.assignee_id as string | null)));
    }
    case "get_task": {
      const taskId = uuidArg(args, "task_id", true)!;
      const { data, error } = await db
        .from("tasks")
        .select(`id, project_id, title, description, status, assignee_id, client_owner, start_date, due_date, concluded_at, ${PROJECT_EMBED}`)
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { projects, ...task } = data;
      const [named] = withAssigneeNames([task], await peopleNames(db, [task.assignee_id as string | null]));
      return { ...named, project: labelFromEmbed(projects) };
    }
    case "list_members": {
      // Tudo com a sessão do usuário: quem não vê o projeto recebe 404, sem saber se ele existe.
      const projectId = uuidArg(args, "project_id", true)!;
      const { data: project, error: projErr } = await db
        .from("projects").select("manager_id").eq("id", projectId).maybeSingle();
      if (projErr) throw projErr;
      if (!project) throw notFound();
      const { data: members, error: memErr } = await db
        .from("project_members").select("user_id, project_role").eq("project_id", projectId);
      if (memErr) throw memErr;
      const roles = new Map<string, string>((members ?? []).map((m) => [m.user_id as string, m.project_role as string]));
      if (project.manager_id) roles.set(project.manager_id as string, "gerente");
      if (!roles.size) return [];
      const { data: people, error: pplErr } = await db
        .from("profiles").select("id, name, active").in("id", [...roles.keys()]);
      if (pplErr) throw pplErr;
      return (people ?? [])
        .filter((p) => p.active)
        .map((p) => ({ id: p.id as string, name: p.name as string, project_role: roles.get(p.id as string)! }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    }
    case "search_context": {
      const query = queryArg(args);
      const projectId = uuidArg(args, "project_id", false);
      let q = db
        .from("project_context_entries")
        .select(`id, project_id, kind, title, meeting_date, body, ${PROJECT_EMBED}`)
        .textSearch("search", query, { config: "portuguese", type: "websearch" })
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .limit(10);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(({ projects, ...r }) => ({ ...r, project: labelFromEmbed(projects), body: cut(r.body as string | null) }));
    }
    case "search_knowledge": {
      const query = queryArg(args);
      const { data, error } = await db
        .from("knowledge_items")
        .select("id, title, kind, prisma_stage, summary, body")
        .eq("status", "publicado")
        .textSearch("search", query, { config: "portuguese", type: "websearch" })
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, body: cut(r.body) }));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Escrita em duas fases (Etapa 5, revista em 13/11/2026). propose valida, monta a prévia e grava a ação com
// o hash de um segredo aleatório que só o plugin recebe (nunca o LLM nem o usuário). O plugin posta a prévia
// na DM e só chama commit depois de conferir no Discord que o usuário reagiu ✅ ou respondeu "sim" (S3).
// commit confere segredo, dono, prazo e uso único e executa com a sessão do usuário: a RLS decide.
// cancel descarta a proposta. Nenhuma exclusão.
// ---------------------------------------------------------------------------------------------------------

const ACTIONS = ["create_task", "create_tasks", "update_task", "add_comment", "add_context_entry", "attach_file"] as const;
// create_tasks (F3): lote de tarefas de uma ata ou transcrição, numa única prévia e num único ✅. Cada item
// segue as regras de create_task; o insert é um só (atômico) e cada tarefa ganha a sua linha em ai_actions_log.
const BATCH_MAX = 30;
// attach_file: a proposta guarda só nome, tamanho e SHA-256; o conteúdo (base64) vem de novo no commit e
// precisa bater com o hash. Limite menor que o do site (20 MB) por causa do tamanho da requisição.
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_BUCKET = "task-attachments";
const SHA_RE = /^[0-9a-f]{64}$/;
type Action = (typeof ACTIONS)[number];
type Params = Record<string, string | null>;
type BatchParams = { project_id: string; tasks: Params[] };
type AnyParams = Params | BatchParams;

const TASK_STATUS = ["todo", "doing", "done"] as const;
const TASK_STATUS_LABEL: Record<string, string> = { todo: "A Fazer", doing: "Fazendo", done: "Feito" };
const CONTEXT_KINDS = ["transcricao", "ata", "anotacao"] as const;
const CONTEXT_KIND_LABEL: Record<string, string> = { transcricao: "transcrição", ata: "ata", anotacao: "anotação" };
const UPDATE_FIELDS = ["title", "description", "status", "assignee_id", "due_date", "start_date", "category_id"] as const;
const NULLABLE_FIELDS = new Set(["description", "assignee_id", "due_date", "start_date", "category_id"]);

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const quote = (text: string, max = 120) => `“${text.length > max ? `${text.slice(0, max)}…` : text}”`;

function isIsoDate(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return DATE_RE.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Valida e normaliza um campo. undefined = ausente; null = limpar (só campos que aceitam vazio).
function field(raw: Args, name: string, kind: "uuid" | "date" | "status" | "kind" | "text", max: number, nullable: boolean): string | null | undefined {
  if (!(name in raw)) return undefined;
  const v = raw[name];
  if (v === null || (typeof v === "string" && v.trim() === "")) {
    if (nullable) return null;
    throw new GatewayError(400, "invalid_args", `Informe ${name}.`);
  }
  if (typeof v !== "string") throw new GatewayError(400, "invalid_args", `${name} deve ser texto.`);
  const s = v.trim();
  const ok = kind === "uuid" ? UUID_RE.test(s)
    : kind === "date" ? isIsoDate(s)
    : kind === "status" ? (TASK_STATUS as readonly string[]).includes(s)
    : kind === "kind" ? (CONTEXT_KINDS as readonly string[]).includes(s)
    : s.length <= max;
  if (!ok) {
    const hint = kind === "date" ? " (AAAA-MM-DD)" : kind === "status" ? " (todo, doing ou done)"
      : kind === "kind" ? " (transcricao, ata ou anotacao)" : kind === "text" ? ` (até ${max} caracteres)` : "";
    throw new GatewayError(400, "invalid_args", `${name} inválido${hint}.`);
  }
  return s;
}

function required(raw: Args, name: string, kind: "uuid" | "date" | "status" | "kind" | "text", max = 0): string {
  const v = field(raw, name, kind, max, false);
  if (v === undefined || v === null) throw new GatewayError(400, "invalid_args", `Informe ${name}.`);
  return v;
}

// Lote: só project_id e tasks (1 a BATCH_MAX itens). Cada item é validado como create_task no mesmo projeto;
// o erro aponta o número do item.
function validateAction(action: string, raw: Args): AnyParams {
  if (action !== "create_tasks") return validateOne(action, raw);
  const extra = Object.keys(raw).filter((k) => k !== "project_id" && k !== "tasks");
  if (extra.length) throw new GatewayError(400, "invalid_args", `Campos não permitidos: ${extra.join(", ")}.`);
  const project_id = required(raw, "project_id", "uuid");
  const list = raw.tasks;
  if (!Array.isArray(list) || list.length === 0 || list.length > BATCH_MAX) {
    throw new GatewayError(400, "invalid_args", `Informe de 1 a ${BATCH_MAX} tarefas.`);
  }
  const tasks = list.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new GatewayError(400, "invalid_args", `Tarefa ${i + 1}: formato inválido.`);
    }
    if ("project_id" in item) {
      throw new GatewayError(400, "invalid_args", `Tarefa ${i + 1}: o projeto vai só no lote (project_id).`);
    }
    try {
      const p = validateOne("create_task", { ...(item as Args), project_id });
      delete p.project_id;
      return p;
    } catch (e) {
      if (e instanceof GatewayError) throw new GatewayError(e.status, e.code, `Tarefa ${i + 1}: ${e.message}`);
      throw e;
    }
  });
  return { project_id, tasks };
}

// Só os parâmetros conhecidos de cada ação passam; qualquer outro é recusado.
function validateOne(action: string, raw: Args): Params {
  if (action === "create_tasks") throw new GatewayError(400, "invalid_args", "Ação de escrita não permitida.");
  const allowed: Record<Exclude<Action, "create_tasks">, readonly string[]> = {
    create_task: ["project_id", "title", "description", "status", "assignee_id", "start_date", "due_date", "category_id"],
    update_task: ["task_id", ...UPDATE_FIELDS],
    add_comment: ["task_id", "body"],
    add_context_entry: ["project_id", "kind", "title", "meeting_date", "participants", "body"],
    attach_file: ["task_id", "file_name", "mime_type", "size_bytes", "sha256"],
  };
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw new GatewayError(400, "invalid_args", "Ação de escrita não permitida.");
  }
  const extra = Object.keys(raw).filter((k) => !allowed[action as Exclude<Action, "create_tasks">].includes(k));
  if (extra.length) throw new GatewayError(400, "invalid_args", `Campos não permitidos: ${extra.join(", ")}.`);

  const p: Params = {};
  const put = (k: string, v: string | null | undefined) => {
    if (v !== undefined) p[k] = v;
  };
  switch (action as Action) {
    case "create_task":
      p.project_id = required(raw, "project_id", "uuid");
      p.title = required(raw, "title", "text", 300);
      put("description", field(raw, "description", "text", 10000, true));
      put("status", field(raw, "status", "status", 0, false));
      put("assignee_id", field(raw, "assignee_id", "uuid", 0, true));
      put("start_date", field(raw, "start_date", "date", 0, true));
      put("due_date", field(raw, "due_date", "date", 0, true));
      put("category_id", field(raw, "category_id", "uuid", 0, true));
      break;
    case "update_task":
      p.task_id = required(raw, "task_id", "uuid");
      for (const k of UPDATE_FIELDS) {
        const kind = k === "status" ? "status" : k.endsWith("_id") ? "uuid" : k.endsWith("_date") ? "date" : "text";
        put(k, field(raw, k, kind, k === "title" ? 300 : 10000, NULLABLE_FIELDS.has(k)));
      }
      if (Object.keys(p).length === 1) throw new GatewayError(400, "invalid_args", "Informe ao menos um campo para alterar.");
      break;
    case "add_comment":
      p.task_id = required(raw, "task_id", "uuid");
      p.body = required(raw, "body", "text", 10000);
      break;
    case "add_context_entry":
      p.project_id = required(raw, "project_id", "uuid");
      p.kind = required(raw, "kind", "kind");
      p.title = required(raw, "title", "text", 200);
      put("meeting_date", field(raw, "meeting_date", "date", 0, true));
      put("participants", field(raw, "participants", "text", 1000, true));
      p.body = required(raw, "body", "text", 500000);
      break;
    case "attach_file": {
      p.task_id = required(raw, "task_id", "uuid");
      const name = required(raw, "file_name", "text", 200);
      if (/[\/\\\x00-\x1f]/.test(name) || name.startsWith(".")) throw new GatewayError(400, "invalid_args", "file_name inválido.");
      p.file_name = name;
      const mime = field(raw, "mime_type", "text", 150, true);
      if (mime && !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new GatewayError(400, "invalid_args", "mime_type inválido.");
      put("mime_type", mime);
      const size = Number(raw.size_bytes);
      if (!Number.isInteger(size) || size <= 0 || size > ATTACH_MAX_BYTES) {
        throw new GatewayError(400, "invalid_args", "O arquivo precisa ter até 10 MB.");
      }
      p.size_bytes = String(size);
      const sha = required(raw, "sha256", "text", 64).toLowerCase();
      if (!SHA_RE.test(sha)) throw new GatewayError(400, "invalid_args", "sha256 inválido.");
      p.sha256 = sha;
      break;
    }
  }
  if (p.start_date && p.due_date && p.due_date < p.start_date) {
    throw new GatewayError(400, "invalid_args", "O prazo não pode ser anterior ao início.");
  }
  return p;
}

const notFound = () => new GatewayError(404, "not_found", "Projeto ou tarefa não encontrado, ou sem acesso.");

// Rótulo "Projeto - Cliente" (P13) usado nas prévias.
async function projectName(db: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await db.from("projects").select("name, clients(name)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();
  return projectLabel(data.name as string, embeddedName(data.clients));
}

async function taskRef(db: SupabaseClient, id: string): Promise<{ title: string; project_id: string; project: string }> {
  const { data, error } = await db.from("tasks").select(`title, project_id, ${PROJECT_EMBED}`).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();
  return { title: data.title as string, project_id: data.project_id as string, project: labelFromEmbed(data.projects) ?? "?" };
}

async function personName(db: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await db.from("profiles").select("name").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new GatewayError(404, "not_found", "Responsável não encontrado.");
  return data.name;
}

async function categoryName(db: SupabaseClient, id: string, projectId: string): Promise<string> {
  const { data, error } = await db.from("categories").select("name").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  if (!data) throw new GatewayError(404, "not_found", "Escopo não encontrado neste projeto.");
  return data.name;
}

// Prévia em pt-BR que o usuário valida na DM (reagindo ✅ ou respondendo "sim"). Mostra tudo o que será
// gravado, uma linha por campo. Lida com a sessão do usuário: se ele não enxerga o projeto ou a tarefa, a
// proposta já é recusada aqui.
async function describe(db: SupabaseClient, action: Action, p: AnyParams): Promise<{ summary: string; project_id: string }> {
  return action === "create_tasks" ? describeBatch(db, p as BatchParams) : describeOne(db, action, p as Params);
}

// Prévia do lote: uma linha curta por tarefa (o plugin cuida do limite de tamanho da mensagem no Discord).
// Projeto, responsáveis e escopos são lidos com a sessão do usuário: sem acesso, o lote inteiro é recusado.
async function describeBatch(db: SupabaseClient, b: BatchParams): Promise<{ summary: string; project_id: string }> {
  const project = await projectName(db, b.project_id);
  const people = new Map<string, string>();
  const scopes = new Map<string, string>();
  const rows: string[] = [];
  for (const [i, t] of b.tasks.entries()) {
    const parts = [`${i + 1}. ${quote(t.title!, 60)}`];
    if (t.assignee_id) {
      if (!people.has(t.assignee_id)) people.set(t.assignee_id, await personName(db, t.assignee_id));
      parts.push(people.get(t.assignee_id)!);
    }
    if (t.category_id) {
      if (!scopes.has(t.category_id)) scopes.set(t.category_id, await categoryName(db, t.category_id, b.project_id));
      parts.push(`escopo ${scopes.get(t.category_id)}`);
    }
    if (t.due_date) parts.push(`prazo ${brDate(t.due_date)}`);
    if (t.status && t.status !== "todo") parts.push(TASK_STATUS_LABEL[t.status]);
    rows.push(parts.join(" · "));
  }
  const n = b.tasks.length;
  return {
    project_id: b.project_id,
    summary: [`Criar ${n} ${n === 1 ? "tarefa" : "tarefas"} no projeto ${project}`, ...rows].join("\n"),
  };
}

async function describeOne(db: SupabaseClient, action: Action, p: Params): Promise<{ summary: string; project_id: string }> {
  const fields = async (projectId: string): Promise<string[]> => {
    const out: string[] = [];
    if (p.title !== undefined && action === "update_task") out.push(`• Título: ${quote(p.title!, 300)}`);
    if (p.status !== undefined) out.push(`• Status: ${TASK_STATUS_LABEL[p.status!]}`);
    if (p.assignee_id !== undefined) out.push(`• Responsável: ${p.assignee_id ? await personName(db, p.assignee_id) : "nenhum"}`);
    if (p.start_date !== undefined) out.push(`• Início: ${p.start_date ? brDate(p.start_date) : "sem data"}`);
    if (p.due_date !== undefined) out.push(`• Prazo: ${p.due_date ? brDate(p.due_date) : "sem data"}`);
    if (p.category_id !== undefined) out.push(`• Escopo: ${p.category_id ? await categoryName(db, p.category_id, projectId) : "nenhum"}`);
    if (p.description !== undefined) out.push(p.description ? `• Descrição: ${quote(p.description, 300)}` : "• Descrição: apagada");
    return out;
  };
  const lines = (head: string, rest: string[]) => [head, ...rest].join("\n");
  switch (action) {
    case "create_task": {
      const project = await projectName(db, p.project_id!);
      const extra = await fields(p.project_id!);
      if (p.status === undefined) extra.unshift(`• Status: ${TASK_STATUS_LABEL.todo}`);
      return {
        project_id: p.project_id!,
        summary: lines(`Criar a tarefa ${quote(p.title!, 300)} no projeto ${project}`, extra),
      };
    }
    case "update_task": {
      const t = await taskRef(db, p.task_id!);
      return {
        project_id: t.project_id,
        summary: lines(`Alterar a tarefa ${quote(t.title)} do projeto ${t.project}`, await fields(t.project_id)),
      };
    }
    case "add_comment": {
      const t = await taskRef(db, p.task_id!);
      return {
        project_id: t.project_id,
        summary: lines(`Comentar (interno) na tarefa ${quote(t.title)} do projeto ${t.project}`, [`• Texto: ${quote(p.body!, 600)}`]),
      };
    }
    case "add_context_entry": {
      const project = await projectName(db, p.project_id!);
      const rest = [`• Título: ${quote(p.title!)}`];
      if (p.meeting_date) rest.push(`• Data da reunião: ${brDate(p.meeting_date)}`);
      if (p.participants) rest.push(`• Participantes: ${p.participants}`);
      rest.push(`• Conteúdo (${p.body!.length.toLocaleString("pt-BR")} caracteres): ${quote(p.body!, 400)}`);
      return {
        project_id: p.project_id!,
        summary: lines(`Registrar ${CONTEXT_KIND_LABEL[p.kind!]} no contexto do projeto ${project}`, rest),
      };
    }
    case "attach_file": {
      const t = await taskRef(db, p.task_id!);
      const mb = (Number(p.size_bytes) / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      return {
        project_id: t.project_id,
        summary: lines(`Anexar um arquivo à tarefa ${quote(t.title)} do projeto ${t.project}`, [
          `• Arquivo: ${p.file_name}`,
          `• Tamanho: ${mb} MB`,
        ]),
      };
    }
    case "create_tasks":
      throw new GatewayError(400, "invalid_args", "Ação de escrita não permitida.");
  }
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Conteúdo do anexo, enviado pelo plugin só no commit. Confere tamanho e hash da proposta.
async function attachmentBytes(args: Args, p: Params): Promise<Uint8Array> {
  const b64 = typeof args.content_b64 === "string" ? args.content_b64 : "";
  if (!b64 || b64.length > Math.ceil(ATTACH_MAX_BYTES / 3) * 4 + 4) throw new GatewayError(400, "invalid_args", "Conteúdo do arquivo ausente ou grande demais.");
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(b64);
  } catch {
    throw new GatewayError(400, "invalid_args", "Conteúdo do arquivo inválido.");
  }
  if (bytes.length !== Number(p.size_bytes) || (await sha256Bytes(bytes)) !== p.sha256) {
    throw new GatewayError(409, "file_changed", "O arquivo não é o mesmo da prévia. Peça o anexo de novo.");
  }
  return bytes;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Segredo da confirmação: fica só entre gateway e plugin (o usuário valida a prévia com ✅ no Discord, e o
// plugin confere isso antes de mandar o commit). 128 bits, então não há o que adivinhar.
const CODE_RE = /^[0-9a-f]{32}$/;
function newCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const codeHash = (pendingId: string, code: string) => sha256Hex(`${pendingId}:${code}`);

// Erros do banco na execução: RLS ou dado inválido viram recusa (denied); o resto é erro interno.
function writeError(error: { code?: string; message?: string }): GatewayError | null {
  if (error.code === "42501") return new GatewayError(403, "forbidden", "Você não tem permissão para esta alteração no Prisma.");
  if (error.code === "23514") return new GatewayError(400, "invalid_data", "Os dados não passaram nas regras do Prisma (ex.: prazo antes do início).");
  if (error.code === "23503") return new GatewayError(400, "invalid_data", "Algum item referenciado não existe mais.");
  return null;
}

// Lote: um único insert (atômico). Se a RLS ou uma constraint recusar uma linha, nenhuma tarefa é criada.
// defaultToNull: false faz o campo ausente num item usar o default da coluna (ex.: status = todo).
async function executeBatch(db: SupabaseClient, userId: string, b: BatchParams): Promise<string[]> {
  const fail = (error: { code?: string; message?: string }) => {
    throw writeError(error) ?? error;
  };
  const { data: last, error: posErr } = await db
    .from("tasks").select("position").eq("project_id", b.project_id)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  if (posErr) fail(posErr);
  const base = last?.position ?? 0;
  const rows = b.tasks.map((t, i) => ({ ...t, project_id: b.project_id, position: base + i + 1, created_by: userId }));
  const { data, error } = await db.from("tasks").insert(rows, { defaultToNull: false }).select("id");
  if (error) fail(error);
  if (data?.length !== rows.length) throw new GatewayError(403, "forbidden", "Você não tem permissão para criar estas tarefas.");
  return data.map((r) => r.id as string);
}

async function execute(db: SupabaseClient, userId: string, action: Action, p: Params, file?: Uint8Array): Promise<string> {
  const fail = (error: { code?: string; message?: string }) => {
    throw writeError(error) ?? error;
  };
  switch (action) {
    case "create_task": {
      const { data: last, error: posErr } = await db
        .from("tasks").select("position").eq("project_id", p.project_id!)
        .order("position", { ascending: false }).limit(1).maybeSingle();
      if (posErr) fail(posErr);
      const { project_id, ...rest } = p;
      const { data, error } = await db
        .from("tasks")
        .insert({ ...rest, project_id, position: (last?.position ?? 0) + 1, created_by: userId })
        .select("id")
        .single();
      if (error) fail(error);
      return data!.id;
    }
    case "update_task": {
      const { task_id, ...changes } = p;
      const { data, error } = await db.from("tasks").update(changes).eq("id", task_id!).select("id");
      if (error) fail(error);
      if (!data?.length) throw new GatewayError(403, "forbidden", "Você não tem permissão para alterar esta tarefa.");
      return data[0].id;
    }
    case "add_comment": {
      const { data, error } = await db
        .from("comments")
        .insert({ task_id: p.task_id, body: p.body, is_internal: true, author_id: userId })
        .select("id")
        .single();
      if (error) fail(error);
      return data!.id;
    }
    case "add_context_entry": {
      const { data, error } = await db
        .from("project_context_entries")
        .insert({ ...p, created_by: userId })
        .select("id")
        .single();
      if (error) fail(error);
      return data!.id;
    }
    case "attach_file": {
      // Mesmo caminho e regras do upload pelo site (task-panel): bucket privado, policies de storage e RLS.
      const t = await taskRef(db, p.task_id!);
      const safe = p.file_name!.replace(/[^\w.\-]+/g, "_").slice(-120);
      const path = `${t.project_id}/${p.task_id}/${crypto.randomUUID()}-${safe}`;
      const up = await db.storage.from(ATTACH_BUCKET).upload(path, file!, { contentType: "application/octet-stream" });
      if (up.error) throw new GatewayError(403, "forbidden", "Não foi possível anexar: sem permissão nesta tarefa.");
      const { data, error } = await db
        .from("task_attachments")
        .insert({
          task_id: p.task_id,
          storage_path: path,
          file_name: p.file_name,
          size_bytes: Number(p.size_bytes),
          mime_type: p.mime_type ?? null,
          uploaded_by: userId,
        })
        .select("id")
        .single();
      if (error) {
        await db.storage.from(ATTACH_BUCKET).remove([path]); // não deixa arquivo órfão
        fail(error);
      }
      return data!.id;
    }
    case "create_tasks":
      throw new GatewayError(400, "invalid_args", "Ação de escrita não permitida.");
  }
}

// Texto longo (corpo do contexto ou do comentário) não vai para o log: só o tamanho.
function loggable(input: Args): Args {
  const out: Args = { ...input };
  const params = out.params && typeof out.params === "object" ? { ...(out.params as Args) } : null;
  if (params && typeof params.body === "string") {
    params.body_chars = params.body.length;
    delete params.body;
  }
  // Lote: só a quantidade e os títulos; descrições ficam fora do log.
  if (params && Array.isArray(params.tasks)) {
    const list = params.tasks as unknown[];
    params.tasks_count = list.length;
    params.task_titles = list.slice(0, BATCH_MAX).map((t) => {
      const title = t && typeof t === "object" ? (t as Args).title : null;
      return typeof title === "string" ? title.slice(0, 120) : null;
    });
    delete params.tasks;
  }
  if (params) out.params = params;
  delete out.confirm_code;
  if (typeof out.content_b64 === "string") {
    out.content_b64_chars = out.content_b64.length;
    delete out.content_b64;
  }
  return out;
}

// Chaves de API (migração, passo 3): só a chave nova "default", sem retorno às legadas.
// Se faltar, loga o motivo uma vez (nunca a chave) e falha, para o erro aparecer logo.
const keyLogged = new Set<string>();
function apiKey(kind: "secret" | "publishable"): string {
  const raw = Deno.env.get(kind === "secret" ? "SUPABASE_SECRET_KEYS" : "SUPABASE_PUBLISHABLE_KEYS");
  let key: unknown;
  let why = "variável ausente";
  try {
    const keys = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    key = keys?.default;
    if (keys) why = `sem "default"; nomes: ${Object.keys(keys).join(", ") || "nenhum"}`;
  } catch {
    key = undefined;
    why = "JSON inválido";
  }
  if (typeof key === "string" && key !== "") return key;
  if (!keyLogged.has(kind)) {
    keyLogged.add(kind);
    console.error(`chave de API ${kind}: ausente (${why})`);
  }
  throw new Error(`chave de API ${kind} ausente`);
}

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, apiKey("secret"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

function limitedText(args: Args, name: string, max: number, required: boolean): string | undefined {
  const v = str(args, name, required);
  if (v !== undefined && v.length > max) {
    throw new GatewayError(400, "invalid_args", `${name} deve ter até ${max} caracteres.`);
  }
  return v;
}

function dateArg(args: Args): string {
  const v = str(args, "date", true)!;
  const d = new Date(`${v}T00:00:00Z`);
  if (!DATE_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new GatewayError(400, "invalid_args", "date deve estar no formato AAAA-MM-DD.");
  }
  return v;
}

// Telemetria (O5): linhas validadas em usage.ts; a soma é atômica no banco (record_ai_usage, só service_role).
function usageRowsArg(args: Args, allowed: readonly UsageSource[]): UsageRow[] {
  try {
    return parseUsageRows(args.rows, allowed, todayBrt());
  } catch (e) {
    if (e instanceof UsageError) throw new GatewayError(400, "invalid_args", e.message);
    throw e;
  }
}

async function recordUsage(db: SupabaseClient, rows: UsageRow[]): Promise<void> {
  for (const r of rows) {
    const { error } = await db.rpc("record_ai_usage", {
      p_day: r.day, p_source: r.source, p_model: r.model, p_calls: r.calls,
      p_input: r.input_tokens, p_output: r.output_tokens, p_cache_read: r.cache_read_tokens, p_cache_write: r.cache_write_tokens,
    });
    if (error) throw error;
  }
}

// Operações da rotina. Escrita só em project_context_entries (kind 'discord'), idempotente por projeto e
// source_ref, e nos contadores de uso da própria rotina (source 'rotina').
async function runRoutineTool(db: SupabaseClient, tool: string, args: Args): Promise<unknown[] | Record<string, unknown>> {
  if (tool === "routine_record_usage") {
    const rows = usageRowsArg(args, ["rotina"]);
    await recordUsage(db, rows);
    return { rows: rows.length };
  }

  if (tool === "routine_usage_summary") {
    let range: { from: string; to: string };
    try {
      range = parseRange(args.from, args.to);
    } catch (e) {
      if (e instanceof UsageError) throw new GatewayError(400, "invalid_args", e.message);
      throw e;
    }
    const { data, error } = await db
      .from("ai_usage_daily")
      .select("source, model, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens")
      .gte("day", range.from)
      .lte("day", range.to);
    if (error) throw error;
    return aggregateUsage(data ?? []);
  }

  if (tool === "routine_list_channels") {
    const { data, error } = await db
      .from("projects")
      .select("id, name, discord_channel_id")
      .not("discord_channel_id", "is", null)
      .not("status", "in", "(concluido,cancelado)")
      .order("name");
    if (error) throw error;
    return (data ?? []).map((p) => ({ project_id: p.id, name: p.name, discord_channel_id: p.discord_channel_id }));
  }

  const projectId = uuidArg(args, "project_id", true)!;
  const channelId = str(args, "channel_id", true)!;
  if (!CHANNEL_RE.test(channelId)) throw new GatewayError(400, "invalid_args", "channel_id inválido.");
  const date = dateArg(args);
  const title = limitedText(args, "title", 200, true)!;
  const participants = limitedText(args, "participants", 1000, false) ?? null;
  const body = limitedText(args, "body", 500000, true)!;

  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, discord_channel_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project || project.discord_channel_id !== channelId) {
    throw new GatewayError(400, "channel_mismatch", "O canal não está vinculado a este projeto.");
  }

  // Um canal pode ter mais de um projeto (I1): cada projeto tem a sua entrada do dia. Canal remapeado:
  // o resumo antigo fica no projeto antigo e o novo projeto ganha a sua.
  const sourceRef = `${channelId}:${date}`;
  const { data: existing, error: exErr } = await db
    .from("project_context_entries")
    .select("id")
    .eq("project_id", projectId)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (exErr) throw exErr;

  if (existing) {
    const { error } = await db
      .from("project_context_entries")
      .update({ title, body, participants, meeting_date: date })
      .eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id, source_ref: sourceRef, created: false };
  }

  const { data, error } = await db
    .from("project_context_entries")
    .insert({ project_id: projectId, kind: "discord", title, body, participants, meeting_date: date, source_ref: sourceRef, created_by: null })
    .select("id")
    .single();
  if (error?.code === "23505") {
    throw new GatewayError(409, "source_ref_conflict", "Já existe um resumo deste canal e dia.");
  }
  if (error) throw error;
  return { id: data.id, source_ref: sourceRef, created: true };
}

async function handleRoutine(req: Request, given: string): Promise<Response> {
  const secret = Deno.env.get("ROUTINE_SECRET") ?? "";
  if (!secret || !given || req.headers.has("x-hermes-secret") || !(await sameSecret(given, secret))) {
    return json({ code: "unauthorized", error: "Não autorizado." }, 401);
  }

  let body: { discord_user_id?: unknown; tool?: unknown; args?: unknown; request_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ code: "invalid_json", error: "JSON inválido." }, 400);
  }
  if (body.discord_user_id !== undefined) {
    return json({ code: "invalid_request", error: "A rotina não envia discord_user_id." }, 400);
  }
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const tool = typeof body.tool === "string" ? body.tool : "";
  const args: Args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Args) : {};
  if (!UUID_RE.test(requestId)) return json({ code: "invalid_request", error: "request_id inválido." }, 400);

  const service = serviceClient();
  const projectArg = typeof args.project_id === "string" && UUID_RE.test(args.project_id) ? args.project_id : null;
  // O corpo do resumo não vai para o log (até 500 mil caracteres): só o tamanho.
  const { body: summary, ...rest } = args;
  const logged = typeof summary === "string" ? { ...rest, body_chars: summary.length } : rest;

  const audit = async (status: Status, result: Record<string, unknown>) => {
    const { error } = await service.from("ai_actions_log").insert({
      source: "routine",
      status,
      tool: tool.slice(0, 64) || "(vazio)",
      user_id: null,
      input: { args: logged },
      result,
      request_id: requestId,
      project_id: projectArg,
      external_ref: null,
    });
    if (error) console.error(`ai_actions_log: falha ao gravar (${error.code ?? "sem código"})`);
  };

  if (!(ROUTINE_TOOLS as readonly string[]).includes(tool)) {
    await audit("denied", { code: "tool_not_allowed" });
    return json({ code: "tool_not_allowed", error: "Ferramenta não permitida para a rotina." }, 403);
  }

  try {
    const data = await runRoutineTool(service, tool, args);
    const n = Array.isArray(data) ? data.length : 1;
    await audit("executed", Array.isArray(data) ? { count: n } : { count: n, created: data.created });
    return json({ ok: true, tool, count: n, data });
  } catch (e) {
    if (e instanceof GatewayError) {
      await audit("denied", { code: e.code });
      return json({ code: e.code, error: e.message }, e.status);
    }
    console.error(`ai-gateway: ${tool} falhou (${e instanceof Error ? e.message : "erro"})`);
    await audit("error", { code: "internal" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  }
}

// resume_previews (O3): chamado pelo plugin ao iniciar, sem usuário (já autenticado pelo x-hermes-secret).
// Devolve as prévias abertas que já têm mensagem no Discord, cada uma com um código novo (o anterior não pode
// ser recuperado: o banco guarda só o hash). Anexos ficam de fora: o arquivo local não sobrevive ao reinício.
// O código nunca vai ao log; a confirmação continua exigindo o ✅ do usuário, conferido pelo plugin.
async function handleResume(requestId: string): Promise<Response> {
  const service = serviceClient();
  const audit = async (status: Status, result: Record<string, unknown>) => {
    const { error } = await service.from("ai_actions_log").insert({
      source: "discord",
      status,
      tool: "resume_previews",
      user_id: null,
      input: { args: {} },
      result,
      request_id: requestId,
      project_id: null,
      external_ref: null,
    });
    if (error) console.error(`ai_actions_log: falha ao gravar (${error.code ?? "sem código"})`);
  };

  try {
    const { data: rows, error } = await service
      .from("ai_pending_actions")
      .select("id, tool, input, discord_user_id, discord_channel_id, discord_message_id, expires_at")
      .eq("status", "proposed")
      .gt("expires_at", new Date().toISOString())
      .not("discord_message_id", "is", null)
      .neq("tool", "attach_file")
      .order("expires_at")
      .limit(RESUME_LIMIT);
    if (error) throw error;

    const out: Record<string, unknown>[] = [];
    for (const r of rows ?? []) {
      if (!r.discord_user_id || !r.discord_channel_id) continue;
      const code = newCode();
      const { data: rotated, error: upErr } = await service
        .from("ai_pending_actions")
        .update({ code_hash: await codeHash(r.id, code) })
        .eq("id", r.id)
        .eq("status", "proposed")
        .select("id");
      if (upErr) throw upErr;
      if (!rotated?.length) continue; // confirmada ou cancelada no meio do caminho
      out.push({
        pending_id: r.id,
        discord_user_id: r.discord_user_id,
        channel_id: r.discord_channel_id,
        message_id: r.discord_message_id,
        code,
        summary: (r.input as { summary?: string } | null)?.summary ?? "",
        expires_at: r.expires_at,
      });
    }
    await audit("executed", { count: out.length });
    return json({ ok: true, tool: "resume_previews", count: out.length, data: out });
  } catch (e) {
    console.error(`ai-gateway: resume_previews falhou (${e instanceof Error ? e.message : "erro"})`);
    await audit("error", { code: "internal" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  }
}

// record_usage (O5): chamada de serviço do plugin, sem usuário (já autenticado pelo x-hermes-secret). Soma os
// tokens do bot e da transcrição em ai_usage_daily. O log guarda só a quantidade de linhas e de chamadas.
async function handleUsage(requestId: string, args: Args): Promise<Response> {
  const service = serviceClient();
  const audit = async (status: Status, result: Record<string, unknown>) => {
    const { error } = await service.from("ai_actions_log").insert({
      source: "discord",
      status,
      tool: "record_usage",
      user_id: null,
      input: { args: { rows: Array.isArray(args.rows) ? args.rows.length : 0 } },
      result,
      request_id: requestId,
      project_id: null,
      external_ref: null,
    });
    if (error) console.error(`ai_actions_log: falha ao gravar (${error.code ?? "sem código"})`);
  };

  try {
    const rows = usageRowsArg(args, ["bot", "transcricao"]);
    await recordUsage(service, rows);
    const calls = rows.reduce((n, r) => n + r.calls, 0);
    await audit("executed", { count: rows.length, calls });
    return json({ ok: true, tool: "record_usage", count: rows.length });
  } catch (e) {
    if (e instanceof GatewayError) {
      await audit("denied", { code: e.code });
      return json({ code: e.code, error: e.message }, e.status);
    }
    console.error(`ai-gateway: record_usage falhou (${e instanceof Error ? e.message : "erro"})`);
    await audit("error", { code: "internal" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ code: "method_not_allowed", error: "Método não permitido." }, 405);

  const routineGiven = req.headers.get("x-routine-secret");
  if (routineGiven !== null) return handleRoutine(req, routineGiven);

  const secret = Deno.env.get("HERMES_GATEWAY_SECRET") ?? "";
  const given = req.headers.get("x-hermes-secret") ?? "";
  if (!secret || !given || !(await sameSecret(given, secret))) {
    return json({ code: "unauthorized", error: "Não autorizado." }, 401);
  }

  let body: { discord_user_id?: unknown; tool?: unknown; args?: unknown; request_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ code: "invalid_json", error: "JSON inválido." }, 400);
  }
  if (body.tool === "resume_previews") {
    if (body.discord_user_id !== undefined) {
      return json({ code: "invalid_request", error: "resume_previews não recebe discord_user_id." }, 400);
    }
    const rid = typeof body.request_id === "string" ? body.request_id : "";
    if (!UUID_RE.test(rid)) return json({ code: "invalid_request", error: "request_id inválido." }, 400);
    return handleResume(rid);
  }
  if (body.tool === "record_usage") {
    if (body.discord_user_id !== undefined) {
      return json({ code: "invalid_request", error: "record_usage não recebe discord_user_id." }, 400);
    }
    const rid = typeof body.request_id === "string" ? body.request_id : "";
    if (!UUID_RE.test(rid)) return json({ code: "invalid_request", error: "request_id inválido." }, 400);
    const usageArgs: Args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Args) : {};
    return handleUsage(rid, usageArgs);
  }
  const discordId = typeof body.discord_user_id === "string" ? body.discord_user_id : "";
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const tool = typeof body.tool === "string" ? body.tool : "";
  const args: Args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Args) : {};
  if (!/^\d{5,25}$/.test(discordId)) return json({ code: "invalid_request", error: "discord_user_id inválido." }, 400);
  if (!UUID_RE.test(requestId)) return json({ code: "invalid_request", error: "request_id inválido." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = apiKey("publishable");
  const service = createClient(url, apiKey("secret"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let projectArg = typeof args.project_id === "string" && UUID_RE.test(args.project_id) ? args.project_id : null;
  let userId: string | null = null;
  let auditTool = tool.slice(0, 64) || "(vazio)";

  // Auditoria de toda chamada; o input guarda os args sem o código de confirmação e sem textos longos.
  const audit = async (status: Status, result: Record<string, unknown>) => {
    const { error } = await service.from("ai_actions_log").insert({
      source: "discord",
      status,
      tool: auditTool,
      user_id: userId,
      input: { args: loggable(args) },
      result,
      request_id: requestId,
      project_id: projectArg,
      external_ref: userId ? null : discordId,
    });
    if (error) console.error(`ai_actions_log: falha ao gravar (${error.code ?? "sem código"})`);
  };

  if (!(TOOLS as readonly string[]).includes(tool) && !(WRITE_TOOLS as readonly string[]).includes(tool)) {
    await audit("denied", { code: "tool_not_allowed" });
    return json({ code: "tool_not_allowed", error: "Ferramenta não permitida." }, 400);
  }

  const { data: profileId, error: rpcErr } = await service.rpc("profile_by_discord_id", { p_discord_id: discordId });
  if (rpcErr) {
    await audit("error", { code: "resolve_failed" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  }
  if (!profileId) {
    await audit("denied", { code: "not_linked" });
    return json({
      code: "not_linked",
      error: "Sua conta do Discord não está vinculada a um perfil ativo do Prisma. Vincule em Minha conta.",
    }, 403);
  }
  userId = profileId as string;

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countErr } = await service
    .from("ai_actions_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (countErr) {
    await audit("error", { code: "rate_check_failed" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  }
  if ((count ?? 0) >= RATE_LIMIT_PER_MIN) {
    await audit("denied", { code: "rate_limited" });
    return json({ code: "rate_limited", error: "Muitas consultas em pouco tempo. Aguarde um minuto." }, 429);
  }
  if (tool === "propose") {
    const { count: proposals, error: propErr } = await service
      .from("ai_actions_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "proposed")
      .gte("created_at", since);
    if (propErr) {
      await audit("error", { code: "rate_check_failed" });
      return json({ code: "internal", error: "Erro interno." }, 500);
    }
    if ((proposals ?? 0) >= PROPOSE_LIMIT_PER_MIN) {
      await audit("denied", { code: "rate_limited" });
      return json({ code: "rate_limited", error: "Muitas alterações propostas em pouco tempo. Aguarde um minuto." }, 429);
    }
  }

  // Sessão do usuário obtida aqui dentro, só quando necessária: link mágico gerado (sem envio de e-mail) e
  // verificado. O access_token não sai desta função nem vai para log; a sessão é encerrada no finally.
  let accessToken: string | null = null;
  let userDb: SupabaseClient | null = null;
  const openSession = async (): Promise<SupabaseClient> => {
    if (userDb) return userDb;
    const { data: u, error: userErr } = await service.auth.admin.getUserById(userId!);
    if (userErr || !u.user?.email) throw new Error("usuário sem e-mail");
    const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
    if (linkErr || !link.properties?.hashed_token) throw new Error("falha ao gerar o link");
    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: otp, error: otpErr } = await verifier.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (otpErr || !otp.session) throw new Error("falha ao abrir a sessão");
    accessToken = otp.session.access_token;
    userDb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    return userDb;
  };

  // propose: valida, monta o resumo com a sessão do usuário e grava a ação com o hash do código.
  const propose = async () => {
    const action = str(args, "action", true)!;
    auditTool = `propose:${action}`.slice(0, 64);
    const raw = args.params && typeof args.params === "object" && !Array.isArray(args.params) ? (args.params as Args) : {};
    const params = validateAction(action, raw);
    const { summary, project_id } = await describe(await openSession(), action as Action, params);
    projectArg = project_id;
    const pendingId = crypto.randomUUID();
    const code = newCode();
    const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();
    const { error } = await service.from("ai_pending_actions").insert({
      id: pendingId,
      user_id: userId,
      discord_user_id: discordId,
      tool: action,
      input: { action, params, summary, project_id },
      code_hash: await codeHash(pendingId, code),
      expires_at: expiresAt,
    });
    if (error) throw error;
    await audit("proposed", { pending_id: pendingId });
    return json({ ok: true, tool, data: { pending_id: pendingId, confirm_code: code, summary, expires_at: expiresAt } });
  };

  // commit: dono, status, prazo, código (3 tentativas) e uso único; executa com a sessão do usuário.
  const commit = async () => {
    const pendingId = uuidArg(args, "pending_id", true)!;
    const code = str(args, "confirm_code", false) ?? "";
    const { data: pa, error } = await service
      .from("ai_pending_actions")
      .select("id, user_id, tool, input, code_hash, attempts, status, expires_at")
      .eq("id", pendingId)
      .maybeSingle();
    if (error) throw error;
    // Ação de outro usuário responde como inexistente: não revela que o id existe.
    if (!pa || pa.user_id !== userId) throw new GatewayError(404, "not_found", "Ação pendente não encontrada.");
    auditTool = `commit:${pa.tool}`.slice(0, 64);
    const input = pa.input as { action: Action; params: AnyParams; summary: string; project_id: string };
    projectArg = input.project_id ?? null;
    if (pa.status !== "proposed") {
      throw new GatewayError(409, "not_pending", "Esta ação já foi confirmada, cancelada ou expirou. Peça uma nova.");
    }
    if (new Date(pa.expires_at).getTime() <= Date.now()) {
      await service.from("ai_pending_actions").update({ status: "expired" }).eq("id", pendingId).eq("status", "proposed");
      throw new GatewayError(410, "expired", "A prévia expirou (10 minutos) sem confirmação. Peça a alteração de novo.");
    }
    if (!CODE_RE.test(code) || !(await sameSecret(await codeHash(pendingId, code), pa.code_hash))) {
      const attempts = pa.attempts + 1;
      const cancel = attempts >= MAX_ATTEMPTS;
      await service
        .from("ai_pending_actions")
        .update({ attempts, ...(cancel ? { status: "cancelled" } : {}) })
        .eq("id", pendingId)
        .eq("status", "proposed")
        .eq("attempts", pa.attempts);
      throw cancel
        ? new GatewayError(403, "cancelled", "Confirmação inválida pela terceira vez. A ação foi cancelada.")
        : new GatewayError(403, "wrong_code", "Confirmação inválida.");
    }
    // Uso único: só uma chamada consegue passar de proposed para committed.
    const { data: claimed, error: claimErr } = await service
      .from("ai_pending_actions")
      .update({ status: "committed", committed_at: new Date().toISOString() })
      .eq("id", pendingId)
      .eq("status", "proposed")
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed?.length) throw new GatewayError(409, "not_pending", "Esta ação já foi confirmada, cancelada ou expirou.");

    try {
      if (input.action === "create_tasks") {
        const ids = await executeBatch(await openSession(), userId!, input.params as BatchParams);
        // Uma linha de log por tarefa criada. Elas contam no limite por minuto (RATE_LIMIT_PER_MIN): depois de
        // um lote grande, o usuário espera cerca de um minuto para a próxima chamada.
        const { error: logErr } = await service.from("ai_actions_log").insert(ids.map((id, index) => ({
          source: "discord",
          status: "executed",
          tool: auditTool,
          user_id: userId,
          input: { args: loggable(args) },
          result: { pending_id: pendingId, entity_id: id, index },
          request_id: requestId,
          project_id: projectArg,
          external_ref: null,
        })));
        if (logErr) console.error(`ai_actions_log: falha ao gravar o lote (${logErr.code ?? "sem código"})`);
        return json({ ok: true, tool, data: { pending_id: pendingId, action: input.action, ids, summary: input.summary } });
      }
      const params = input.params as Params;
      const file = input.action === "attach_file" ? await attachmentBytes(args, params) : undefined;
      const entityId = await execute(await openSession(), userId!, input.action, params, file);
      await audit("executed", { pending_id: pendingId, entity_id: entityId });
      return json({ ok: true, tool, data: { pending_id: pendingId, action: input.action, id: entityId, summary: input.summary } });
    } catch (e) {
      // A execução falhou: a ação não fica como confirmada.
      await service.from("ai_pending_actions").update({ status: "cancelled", committed_at: null }).eq("id", pendingId);
      throw e;
    }
  };

  // cancel: o usuário recusou a prévia (❌ ou "não"). Só o dono e só enquanto proposta.
  const cancel = async () => {
    const pendingId = uuidArg(args, "pending_id", true)!;
    const { data, error } = await service
      .from("ai_pending_actions")
      .update({ status: "cancelled" })
      .eq("id", pendingId)
      .eq("user_id", userId!)
      .eq("status", "proposed")
      .select("id, tool, input");
    if (error) throw error;
    if (!data?.length) throw new GatewayError(404, "not_pending", "Não há ação pendente com esse id.");
    auditTool = `cancel:${data[0].tool}`.slice(0, 64);
    projectArg = (data[0].input as { project_id?: string })?.project_id ?? null;
    await audit("executed", { pending_id: pendingId, cancelled: true });
    return json({ ok: true, tool, data: { pending_id: pendingId, cancelled: true } });
  };

  // preview_posted: grava uma única vez o canal e a mensagem da prévia. Só o dono e só enquanto aberta.
  const previewPosted = async () => {
    const pendingId = uuidArg(args, "pending_id", true)!;
    const channelId = str(args, "channel_id", true)!;
    const messageId = str(args, "message_id", true)!;
    if (!CHANNEL_RE.test(channelId)) throw new GatewayError(400, "invalid_args", "channel_id inválido.");
    if (!CHANNEL_RE.test(messageId)) throw new GatewayError(400, "invalid_args", "message_id inválido.");
    const { data, error } = await service
      .from("ai_pending_actions")
      .update({ discord_channel_id: channelId, discord_message_id: messageId })
      .eq("id", pendingId)
      .eq("user_id", userId!)
      .eq("status", "proposed")
      .gt("expires_at", new Date().toISOString())
      .is("discord_message_id", null)
      .select("id, tool, input");
    if (error) throw error;
    if (!data?.length) throw new GatewayError(404, "not_pending", "Não há prévia aberta com esse id.");
    auditTool = `preview_posted:${data[0].tool}`.slice(0, 64);
    projectArg = (data[0].input as { project_id?: string })?.project_id ?? null;
    await audit("executed", { pending_id: pendingId });
    return json({ ok: true, tool, data: { pending_id: pendingId } });
  };

  try {
    if (tool === "cancel") return await cancel();
    if (tool === "preview_posted") return await previewPosted();
    if (tool === "whoami") {
      await audit("executed", { linked: true });
      return json({ ok: true, tool, data: { linked: true } });
    }
    if (tool === "propose") return await propose();
    if (tool === "commit") return await commit();
    const data = await runTool(await openSession(), tool as Tool, args);
    const n = Array.isArray(data) ? data.length : data ? 1 : 0;
    await audit("executed", { count: n });
    return json({ ok: true, tool, count: n, data });
  } catch (e) {
    if (e instanceof GatewayError) {
      await audit("denied", { code: e.code });
      return json({ code: e.code, error: e.message }, e.status);
    }
    console.error(`ai-gateway: ${auditTool} falhou (${e instanceof Error ? e.message : "erro"})`);
    await audit("error", { code: "internal" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  } finally {
    if (accessToken) {
      const { error } = await service.auth.admin.signOut(accessToken, "local");
      if (error) console.warn("ai-gateway: não foi possível encerrar a sessão");
    }
  }
});
