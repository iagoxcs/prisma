// Alertas de prazo por e-mail (Resend). Chamada só pelo pg_cron (job prisma-deadline-emails),
// autenticada pelo cabeçalho x-cron-secret (verify_jwt = false em config.toml).
// Um resumo por pessoa com as notificações due_soon/overdue/missing_due_date ainda não enviadas.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Chaves de API (migração, passo 3): só a chave nova "default", sem retorno à legada.
// Se faltar, loga o motivo uma vez (nunca a chave) e falha, para o erro aparecer logo.
let keyLogged = false;
function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
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
  if (!keyLogged) {
    keyLogged = true;
    console.error(`chave de API secret: ausente (${why})`);
  }
  throw new Error("chave de API secret ausente");
}

const SITE_URL = "https://prisma.ambienteconsulta.com.br";
const BATCH = 100; // limite da API /emails/batch do Resend

type Pending = { id: string; user_id: string; type: string; entity_id: string; project_id: string | null; message: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey());

  const { data: ok } = await admin.rpc("check_cron_secret", { secret: req.headers.get("x-cron-secret") ?? "" });
  if (ok !== true) return json({ error: "não autorizado" }, 401);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey || !from) return json({ error: "defina RESEND_API_KEY e EMAIL_FROM nos secrets da função" }, 500);

  const { data: setting } = await admin.from("app_settings").select("value").eq("key", "email_deadline_alerts").maybeSingle();
  if (setting?.value === false) return json({ sent: 0, skipped: "email_deadline_alerts desligado" });

  // Janela de 2 dias: uma falha pontual é reenviada no dia seguinte, sem acumular histórico.
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: pending, error } = await admin
    .from("notifications")
    .select("id, user_id, type, entity_id, project_id, message, profiles!inner(active)")
    .in("type", ["due_soon", "overdue", "missing_due_date"])
    .is("emailed_at", null)
    .gte("created_at", since)
    .eq("profiles.active", true)
    .order("created_at");
  if (error) return json({ error: error.message }, 500);
  if (!pending?.length) return json({ sent: 0 });

  const projectIds = [...new Set(pending.map((n) => n.project_id).filter(Boolean))] as string[];
  const { data: projects } = await admin.from("projects").select("id, name").in("id", projectIds);
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name as string]));

  const { data: users, error: uErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (uErr) return json({ error: uErr.message }, 500);
  const emailOf = new Map(users.users.map((u) => [u.id, u.email]));

  const byUser = new Map<string, Pending[]>();
  for (const n of pending as Pending[]) {
    if (!emailOf.get(n.user_id)) continue;
    byUser.set(n.user_id, [...(byUser.get(n.user_id) ?? []), n]);
  }

  const messages = [...byUser].map(([userId, items]) => ({ userId, items, email: buildEmail(items, projectName) }));
  let sent = 0;
  const failed: string[] = [];

  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(chunk.map((m) => ({ from, to: [emailOf.get(m.userId)], ...m.email }))),
    });
    if (!res.ok) {
      failed.push(`${res.status} ${await res.text()}`);
      continue;
    }
    const ids = chunk.flatMap((m) => m.items.map((n) => n.id));
    const { error: mErr } = await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", ids);
    if (mErr) failed.push(`marcar emailed_at: ${mErr.message}`);
    sent += chunk.length;
  }

  if (failed.length) console.error("deadline-emails:", failed);
  return json({ sent, failed: failed.length }, failed.length && !sent ? 502 : 200);
});

function buildEmail(items: Pending[], projectName: Map<string, string>) {
  // Prazo (due_soon/overdue) e higiene do projeto (missing_due_date) saem em blocos separados.
  const deadline = items.filter((n) => n.type !== "missing_due_date");
  const missing = items.filter((n) => n.type === "missing_due_date");

  const overdue = deadline.filter((n) => n.type === "overdue").length;
  const subject =
    overdue > 0
      ? `Prisma: ${overdue === 1 ? "1 tarefa com prazo vencido" : `${overdue} tarefas com prazo vencido`}`
      : deadline.length > 0
        ? `Prisma: ${deadline.length === 1 ? "1 tarefa com prazo próximo" : `${deadline.length} tarefas com prazo próximo`}`
        : "Prisma: tarefas sem prazo nos seus projetos";

  const link = (n: Pending) =>
    !n.project_id
      ? `${SITE_URL}/notificacoes/`
      : n.type === "missing_due_date"
        ? `${SITE_URL}/projeto/?id=${n.project_id}&tab=lista`
        : `${SITE_URL}/projeto/?id=${n.project_id}&task=${n.entity_id}`;
  // A mensagem de missing_due_date já traz o nome do projeto.
  const project = (n: Pending) =>
    n.project_id && n.type !== "missing_due_date" ? projectName.get(n.project_id) ?? "" : "";

  // E-mail não lê os tokens de app/globals.css: cores inline, neutras (atraso em âmbar + texto).
  const row = (n: Pending) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e4e4e7">
  <a href="${link(n)}" style="color:#18181b;text-decoration:none;font-weight:600">${esc(n.message)}</a>
  ${project(n) ? `<div style="color:#71717a;font-size:13px;margin-top:2px">${esc(project(n))}</div>` : ""}
  ${n.type === "overdue" ? `<div style="color:#b45309;font-size:13px;margin-top:2px">Vencida</div>` : ""}
</td></tr>`;
  const table = (list: Pending[]) =>
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map(row).join("")}</table></td></tr>`;

  const blocks = [
    deadline.length
      ? `<tr><td style="font-size:15px;color:#3f3f46;padding-bottom:12px">Estas tarefas sob sua responsabilidade pedem atenção:</td></tr>${table(deadline)}`
      : "",
    missing.length
      ? `<tr><td style="font-size:16px;font-weight:600;color:#18181b;padding:${deadline.length ? "20px" : "0"} 0 4px">Tarefas sem prazo</td></tr>
<tr><td style="font-size:15px;color:#3f3f46;padding-bottom:12px">Projetos que você gerencia têm tarefas abertas sem prazo definido:</td></tr>${table(missing)}`
      : "",
  ].join("");

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:'Red Hat Display',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:24px">
<tr><td style="font-size:18px;font-weight:700;color:#18181b;padding-bottom:4px">Prisma</td></tr>
${blocks}
<tr><td style="padding-top:20px"><a href="${SITE_URL}/notificacoes/" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Abrir notificações</a></td></tr>
<tr><td style="font-size:12px;color:#a1a1aa;padding-top:20px">Aviso automático do Prisma · Ambiente Consultoria. Os alertas por e-mail são ligados e desligados em Configurações → Parâmetros.</td></tr>
</table></td></tr></table></body></html>`;

  const line = (n: Pending) =>
    `- ${n.message}${project(n) ? ` (${project(n)})` : ""}${n.type === "overdue" ? " [vencida]" : ""}\n  ${link(n)}`;
  const text = [
    ...(deadline.length ? ["Prisma: tarefas sob sua responsabilidade que pedem atenção", "", ...deadline.map(line), ""] : []),
    ...(missing.length
      ? ["Tarefas sem prazo", "Projetos que você gerencia têm tarefas abertas sem prazo definido:", "", ...missing.map(line), ""]
      : []),
    `Notificações: ${SITE_URL}/notificacoes/`,
  ].join("\n");

  return { subject, html, text };
}
