// Administração de usuários (login por e-mail/senha, sem cadastro aberto).
// Único lugar que usa service_role. Só administradores ativos podem chamar.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLES = ["admin", "gerente", "lider", "consultor", "externo"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Identidade do chamador: client com o JWT dele; is_admin() respeita perfil ativo.
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isAdmin, error: authErr } = await caller.rpc("is_admin");
  if (authErr || isAdmin !== true) return json({ error: "acesso restrito a administradores" }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const password = body.password ?? "";
  if (password.length < 10) {
    return json({ error: "a senha deve ter ao menos 10 caracteres" }, 400);
  }

  if (body.action === "create") {
    const email = (body.email ?? "").trim().toLowerCase();
    const role = body.role ?? "consultor";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "e-mail inválido" }, 400);
    if (!ROLES.includes(role)) return json({ error: "perfil inválido" }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: body.name ?? email.split("@")[0] },
    });
    if (error || !data.user) return json({ error: error?.message ?? "falha ao criar usuário" }, 400);

    const { error: pErr } = await admin
      .from("profiles")
      .update({ role, active: true, name: body.name ?? email.split("@")[0], job_title: body.job_title ?? null })
      .eq("id", data.user.id);
    if (pErr) return json({ error: pErr.message }, 500);
    return json({ id: data.user.id });
  }

  if (body.action === "reset_password") {
    if (!body.user_id) return json({ error: "user_id obrigatório" }, 400);
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "ação desconhecida" }, 400);
});
