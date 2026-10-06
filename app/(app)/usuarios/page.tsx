"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { ROLE_LABEL, type Profile, type UserRole } from "@/types/domain";

const ROLES = Object.keys(ROLE_LABEL) as UserRole[];
const SELECT_CLASS = "h-8 rounded-lg border bg-background px-2 text-sm";

// Administração de usuários: login por e-mail e senha criados por um administrador.
export default function UsuariosPage() {
  const { profile } = useAuth();
  const users = useQuery<Profile[]>(
    () => getSupabase().from("profiles").select("id, name, job_title, role, is_external, active").order("name"),
    [],
  );
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "consultor" as UserRole, job_title: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (profile?.role !== "admin") return <p className="text-sm">Acesso restrito a administradores.</p>;

  async function call(body: Record<string, string>) {
    const { data, error } = await getSupabase().functions.invoke("admin-users", { body });
    if (error) {
      // Mensagem detalhada vem no corpo da resposta da função.
      const detail = await (error as { context?: Response }).context?.json().catch(() => null);
      throw new Error(detail?.error ?? error.message);
    }
    return data;
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await call({ action: "create", ...form });
      setMsg({ ok: true, text: `Usuário ${form.email} criado.` });
      setForm({ name: "", email: "", password: "", role: "consultor", job_title: "" });
      users.reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }

  async function update(u: Profile, role: UserRole, active: boolean) {
    setMsg(null);
    const { error } = await getSupabase().rpc("admin_update_profile", { target: u.id, new_role: role, new_active: active });
    if (error) setMsg({ ok: false, text: error.message });
    users.reload();
  }

  async function resetPassword(u: Profile) {
    const password = prompt(`Nova senha para ${u.name} (mínimo 10 caracteres):`);
    if (!password) return;
    try {
      await call({ action: "reset_password", user_id: u.id, password });
      setMsg({ ok: true, text: `Senha de ${u.name} redefinida.` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Usuários</h1>

      <form onSubmit={create} className="grid max-w-2xl gap-3 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="u-name">Nome</Label>
          <Input id="u-name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="u-email">E-mail (login)</Label>
          <Input id="u-email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="u-pass">Senha inicial (mín. 10)</Label>
          <Input id="u-pass" type="password" autoComplete="new-password" minLength={10} required value={form.password} onChange={(e) => set("password", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="u-role">Perfil</Label>
          <select id="u-role" className={`${SELECT_CLASS} w-full`} value={form.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="u-job">Cargo</Label>
          <Input id="u-job" value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? "Criando…" : "Criar usuário"}</Button>
        </div>
      </form>

      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{msg.text}</p>}
      {users.error && <p role="alert" className="text-sm text-destructive">{users.error}</p>}

      <ul className="divide-y rounded-lg border">
        {(users.data ?? []).map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              <span className="font-medium">{u.name}</span>
              {u.job_title && <span className="ml-2 text-muted-foreground">{u.job_title}</span>}
            </span>
            <span className="flex items-center gap-2">
              <select aria-label={`Perfil de ${u.name}`} className={SELECT_CLASS} value={u.role} disabled={u.id === profile.id} onChange={(e) => update(u, e.target.value as UserRole, u.active)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
              <Button size="sm" variant={u.active ? "outline" : "default"} disabled={u.id === profile.id} onClick={() => update(u, u.role, !u.active)}>
                {u.active ? "Desativar" : "Ativar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>Redefinir senha</Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
