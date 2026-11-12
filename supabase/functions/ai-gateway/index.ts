// ai-gateway: única porta entre o Hermes (assistente no Discord) e o banco. Etapa 3: só leitura.
// Chamado servidor a servidor pelo plugin do Hermes, autenticado por x-hermes-secret (verify_jwt = false).
// O discord_user_id vem do contexto da sessão do Hermes, nunca do LLM (spike S1).
// A consulta roda com a sessão do próprio usuário: a RLS decide o que ele vê.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const RATE_LIMIT_PER_MIN = 30; // DV7
const EXCERPT = 2000;
const TOOLS = ["list_projects", "list_tasks", "get_task", "search_context", "search_knowledge"] as const;
type Tool = (typeof TOOLS)[number];
type Args = Record<string, unknown>;
type Status = "executed" | "denied" | "error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ code: "method_not_allowed", error: "Método não permitido." }, 405);

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

  const projectArg = typeof args.project_id === "string" && UUID_RE.test(args.project_id) ? args.project_id : null;
  let userId: string | null = null;

  // Auditoria de toda chamada; o input guarda só os args (nunca segredo ou token), o result só o resumo.
  const audit = async (status: Status, result: Record<string, unknown>) => {
    const { error } = await service.from("ai_actions_log").insert({
      source: "discord",
      status,
      tool: tool.slice(0, 64) || "(vazio)",
      user_id: userId,
      input: { args },
      result,
      request_id: requestId,
      project_id: projectArg,
      external_ref: userId ? null : discordId,
    });
    if (error) console.error(`ai_actions_log: falha ao gravar (${error.code ?? "sem código"})`);
  };

  if (!(TOOLS as readonly string[]).includes(tool)) {
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

  // Sessão do usuário obtida aqui dentro: link mágico gerado (sem envio de e-mail) e verificado.
  // O access_token não sai desta função nem vai para log; a sessão é encerrada no finally.
  let accessToken: string | null = null;
  try {
    const { data: u, error: userErr } = await service.auth.admin.getUserById(userId);
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

    const db = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    let data: unknown;
    try {
      data = await runTool(db, tool as Tool, args);
    } catch (e) {
      if (e instanceof GatewayError) {
        await audit("denied", { code: e.code });
        return json({ code: e.code, error: e.message }, e.status);
      }
      throw e;
    }
    const n = Array.isArray(data) ? data.length : data ? 1 : 0;
    await audit("executed", { count: n });
    return json({ ok: true, tool, count: n, data });
  } catch (e) {
    console.error(`ai-gateway: ${tool} falhou (${e instanceof Error ? e.message : "erro"})`);
    await audit("error", { code: "internal" });
    return json({ code: "internal", error: "Erro interno." }, 500);
  } finally {
    if (accessToken) {
      const { error } = await service.auth.admin.signOut(accessToken, "local");
      if (error) console.warn("ai-gateway: não foi possível encerrar a sessão");
    }
  }
});
