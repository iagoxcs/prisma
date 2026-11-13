// ai-gateway: única porta entre o Hermes (assistente no Discord) e o banco.
// Chamado servidor a servidor (verify_jwt = false) por dois clientes, cada um com o seu segredo:
// - plugin do Hermes (x-hermes-secret): leitura e escrita em duas fases (propose/commit, Etapa 5). O
//   discord_user_id vem do contexto da sessão do Hermes, nunca do LLM (spike S1), e tudo roda com a sessão
//   do próprio usuário (RLS).
// - rotina diária (x-routine-secret, Etapa 4): só lista os canais mapeados e grava o resumo do dia.
//   Não há usuário: roda com o service_role, restrita a essas duas operações (N5).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const RATE_LIMIT_PER_MIN = 30; // DV7
const PROPOSE_LIMIT_PER_MIN = 10; // DV7: escrita
const CONFIRM_TTL_MS = 10 * 60_000; // DV7: confirmação válida por 10 min
const MAX_ATTEMPTS = 3; // DV7
const EXCERPT = 2000;
const TOOLS = ["list_projects", "list_tasks", "get_task", "search_context", "search_knowledge"] as const;
// whoami (Etapa 6): só confirma que o autor está vinculado a um perfil ativo e interno, sem abrir sessão.
// O plugin consulta antes de enviar um áudio ao provedor de transcrição.
const WRITE_TOOLS = ["propose", "commit", "whoami"] as const;
const ROUTINE_TOOLS = ["routine_list_channels", "routine_upsert_context"] as const;
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

// Cada ferramenta: colunas explícitas, sem escrita, sem SQL arbitrário.
async function runTool(db: SupabaseClient, tool: Tool, args: Args): Promise<unknown[] | Record<string, unknown> | null> {
  switch (tool) {
    case "list_projects": {
      const { data, error } = await db
        .from("projects")
        .select("id, name, status, start_date, end_date")
        .order("name");
      if (error) throw error;
      return data;
    }
    case "list_tasks": {
      const projectId = uuidArg(args, "project_id", true)!;
      const { data, error } = await db
        .from("tasks")
        .select("id, title, status, assignee_id, due_date")
        .eq("project_id", projectId)
        .order("position")
        .limit(200);
      if (error) throw error;
      return data;
    }
    case "get_task": {
      const taskId = uuidArg(args, "task_id", true)!;
      const { data, error } = await db
        .from("tasks")
        .select("id, project_id, title, description, status, assignee_id, start_date, due_date, concluded_at")
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
    case "search_context": {
      const query = queryArg(args);
      const projectId = uuidArg(args, "project_id", false);
      let q = db
        .from("project_context_entries")
        .select("id, project_id, kind, title, meeting_date, body")
        .textSearch("search", query, { config: "portuguese", type: "websearch" })
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .limit(10);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, body: cut(r.body) }));
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
// Escrita em duas fases (Etapa 5). propose valida e grava a ação com o hash de um código de 6 dígitos;
// o plugin entrega o código por DM, fora do contexto do LLM (S3). commit confere código, dono, prazo e uso
// único e executa com a sessão do usuário: a RLS decide. Nenhuma exclusão.
// ---------------------------------------------------------------------------------------------------------

const ACTIONS = ["create_task", "update_task", "add_comment", "add_context_entry"] as const;
type Action = (typeof ACTIONS)[number];
type Params = Record<string, string | null>;

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

// Só os parâmetros conhecidos de cada ação passam; qualquer outro é recusado.
function validateAction(action: string, raw: Args): Params {
  const allowed: Record<Action, readonly string[]> = {
    create_task: ["project_id", "title", "description", "status", "assignee_id", "start_date", "due_date", "category_id"],
    update_task: ["task_id", ...UPDATE_FIELDS],
    add_comment: ["task_id", "body"],
    add_context_entry: ["project_id", "kind", "title", "meeting_date", "participants", "body"],
  };
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw new GatewayError(400, "invalid_args", "Ação de escrita não permitida.");
  }
  const extra = Object.keys(raw).filter((k) => !allowed[action as Action].includes(k));
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
  }
  if (p.start_date && p.due_date && p.due_date < p.start_date) {
    throw new GatewayError(400, "invalid_args", "O prazo não pode ser anterior ao início.");
  }
  return p;
}

const notFound = () => new GatewayError(404, "not_found", "Projeto ou tarefa não encontrado, ou sem acesso.");

async function projectName(db: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await db.from("projects").select("name").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();
  return data.name;
}

async function taskRef(db: SupabaseClient, id: string): Promise<{ title: string; project_id: string; project: string }> {
  const { data, error } = await db.from("tasks").select("title, project_id, projects(name)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();
  const proj = data.projects as unknown as { name: string } | null;
  return { title: data.title, project_id: data.project_id, project: proj?.name ?? "?" };
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

// Resumo em pt-BR mostrado ao usuário na DM junto com o código. Lido com a sessão do usuário: se ele não
// enxerga o projeto ou a tarefa, a proposta já é recusada aqui.
async function describe(db: SupabaseClient, action: Action, p: Params): Promise<{ summary: string; project_id: string }> {
  const changes = async (projectId: string): Promise<string[]> => {
    const out: string[] = [];
    if (p.title !== undefined && action === "update_task") out.push(`título: ${quote(p.title!)}`);
    if (p.status !== undefined) out.push(`status: ${TASK_STATUS_LABEL[p.status!]}`);
    if (p.assignee_id !== undefined) out.push(`responsável: ${p.assignee_id ? await personName(db, p.assignee_id) : "nenhum"}`);
    if (p.start_date !== undefined) out.push(`início: ${p.start_date ? brDate(p.start_date) : "sem data"}`);
    if (p.due_date !== undefined) out.push(`prazo: ${p.due_date ? brDate(p.due_date) : "sem data"}`);
    if (p.category_id !== undefined) out.push(`escopo: ${p.category_id ? await categoryName(db, p.category_id, projectId) : "nenhum"}`);
    if (p.description !== undefined) out.push(p.description ? `descrição: ${quote(p.description, 200)}` : "descrição: apagada");
    return out;
  };
  switch (action) {
    case "create_task": {
      const project = await projectName(db, p.project_id!);
      const extra = await changes(p.project_id!);
      return {
        project_id: p.project_id!,
        summary: `Criar a tarefa ${quote(p.title!)} no projeto ${project}` + (extra.length ? ` (${extra.join("; ")})` : "") + ".",
      };
    }
    case "update_task": {
      const t = await taskRef(db, p.task_id!);
      return {
        project_id: t.project_id,
        summary: `Alterar a tarefa ${quote(t.title)} do projeto ${t.project}: ${(await changes(t.project_id)).join("; ")}.`,
      };
    }
    case "add_comment": {
      const t = await taskRef(db, p.task_id!);
      return {
        project_id: t.project_id,
        summary: `Comentar (interno) na tarefa ${quote(t.title)} do projeto ${t.project}: ${quote(p.body!, 300)}`,
      };
    }
    case "add_context_entry": {
      const project = await projectName(db, p.project_id!);
      const date = p.meeting_date ? `, reunião de ${brDate(p.meeting_date)}` : "";
      return {
        project_id: p.project_id!,
        summary: `Registrar ${CONTEXT_KIND_LABEL[p.kind!]} ${quote(p.title!)} no contexto do projeto ${project}` +
          `${date}, com ${p.body!.length.toLocaleString("pt-BR")} caracteres.`,
      };
    }
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newCode(): string {
  // 6 dígitos uniformes (descarta o excedente de 2^32 para não enviesar).
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= 4_294_000_000);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

const codeHash = (pendingId: string, code: string) => sha256Hex(`${pendingId}:${code}`);

// Erros do banco na execução: RLS ou dado inválido viram recusa (denied); o resto é erro interno.
function writeError(error: { code?: string; message?: string }): GatewayError | null {
  if (error.code === "42501") return new GatewayError(403, "forbidden", "Você não tem permissão para esta alteração no Prisma.");
  if (error.code === "23514") return new GatewayError(400, "invalid_data", "Os dados não passaram nas regras do Prisma (ex.: prazo antes do início).");
  if (error.code === "23503") return new GatewayError(400, "invalid_data", "Algum item referenciado não existe mais.");
  return null;
}

async function execute(db: SupabaseClient, userId: string, action: Action, p: Params): Promise<string> {
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
  if (params) out.params = params;
  delete out.confirm_code;
  return out;
}

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
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

// Operações da rotina. Escrita só em project_context_entries (kind 'discord'), idempotente por source_ref.
async function runRoutineTool(db: SupabaseClient, tool: string, args: Args): Promise<unknown[] | Record<string, unknown>> {
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

  const sourceRef = `${channelId}:${date}`;
  const { data: existing, error: exErr } = await db
    .from("project_context_entries")
    .select("id, project_id")
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (exErr) throw exErr;
  // Canal remapeado para outro projeto: o resumo antigo fica onde está, não é movido.
  if (existing && existing.project_id !== projectId) {
    throw new GatewayError(409, "source_ref_conflict", "Já existe um resumo deste canal e dia em outro projeto.");
  }

  const { data, error } = await db
    .from("project_context_entries")
    .upsert(
      { project_id: projectId, kind: "discord", title, body, participants, meeting_date: date, source_ref: sourceRef, created_by: null },
      { onConflict: "source_ref" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id, source_ref: sourceRef, created: !existing };
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
  const discordId = typeof body.discord_user_id === "string" ? body.discord_user_id : "";
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const tool = typeof body.tool === "string" ? body.tool : "";
  const args: Args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Args) : {};
  if (!/^\d{5,25}$/.test(discordId)) return json({ code: "invalid_request", error: "discord_user_id inválido." }, 400);
  if (!UUID_RE.test(requestId)) return json({ code: "invalid_request", error: "request_id inválido." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
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
    const input = pa.input as { action: Action; params: Params; summary: string; project_id: string };
    projectArg = input.project_id ?? null;
    if (pa.status !== "proposed") {
      throw new GatewayError(409, "not_pending", "Esta ação já foi confirmada, cancelada ou expirou. Peça uma nova.");
    }
    if (new Date(pa.expires_at).getTime() <= Date.now()) {
      await service.from("ai_pending_actions").update({ status: "expired" }).eq("id", pendingId).eq("status", "proposed");
      throw new GatewayError(410, "expired", "O código expirou (10 minutos). Peça a alteração de novo.");
    }
    if (!/^\d{6}$/.test(code) || !(await sameSecret(await codeHash(pendingId, code), pa.code_hash))) {
      const attempts = pa.attempts + 1;
      const cancel = attempts >= MAX_ATTEMPTS;
      await service
        .from("ai_pending_actions")
        .update({ attempts, ...(cancel ? { status: "cancelled" } : {}) })
        .eq("id", pendingId)
        .eq("status", "proposed")
        .eq("attempts", pa.attempts);
      throw cancel
        ? new GatewayError(403, "cancelled", "Código incorreto pela terceira vez. A ação foi cancelada.")
        : new GatewayError(403, "wrong_code", `Código incorreto. Restam ${MAX_ATTEMPTS - attempts} tentativa(s).`);
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
      const entityId = await execute(await openSession(), userId!, input.action, input.params);
      await audit("executed", { pending_id: pendingId, entity_id: entityId });
      return json({ ok: true, tool, data: { pending_id: pendingId, action: input.action, id: entityId, summary: input.summary } });
    } catch (e) {
      // A execução falhou: a ação não fica como confirmada.
      await service.from("ai_pending_actions").update({ status: "cancelled", committed_at: null }).eq("id", pendingId);
      throw e;
    }
  };

  try {
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
