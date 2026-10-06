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

interface AuthInfo {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
}

async function callAdmin(body: Record<string, string>) {
  const { data, error } = await getSupabase().functions.invoke("admin-users", { body });
  if (error) {
    const detail = await (error as { context?: Response }).context?.json().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data;
}

export function UsersTab() {
  const { profile } = useAuth();
  const users = useQuery<Profile[]>(
    () => getSupabase().from("profiles").select("id, name, job_title, role, is_external, active").order("name"),
    [],
  );
  const auth = useQuery<AuthInfo[]>(async () => {
    try {
      const data = await callAdmin({ action: "list" });
      return { data: (data?.users ?? []) as AuthInfo[], error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }, []);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const info = new Map((auth.data ?? []).map((a) => [a.id, a]));
  const q = search.trim().toLowerCase();
  const list = (users.data ?? []).filter(
    (u) =>
      (!q || u.name.toLowerCase().includes(q) || (info.get(u.id)?.email ?? "").toLowerCase().includes(q)) &&
      (!roleFilter || u.role === roleFilter) &&
      (!statusFilter || (statusFilter === "active") === u.active),
  );

  function reloadAll() {
    users.reload();
    auth.reload();
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
      await callAdmin({ action: "reset_password", user_id: u.id, password });
      setMsg({ ok: true, text: `Senha de ${u.name} redefinida.` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-64" placeholder="Buscar por nome ou e-mail" aria-label="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filtrar por perfil" className={SELECT_CLASS} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">Todos os perfis</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <select aria-label="Filtrar por situação" className={SELECT_CLASS} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Ativos e inativos</option>
          <option value="active">Somente ativos</option>
          <option value="inactive">Somente inativos</option>
        </select>
        <Button className="ml-auto" onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Fechar" : "Novo usuário"}</Button>
      </div>

      {showCreate && <CreateForm onCreated={(email) => { setMsg({ ok: true, text: `Usuário ${email} criado.` }); reloadAll(); }} onError={(t) => setMsg({ ok: false, text: t })} />}

      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>{msg.text}</p>}
      {users.error && <p role="alert" className="text-sm text-destructive">{users.error}</p>}
      {auth.error && <p role="alert" className="text-sm text-destructive">E-mails indisponíveis: {auth.error}</p>}

      <ul className="divide-y rounded-lg border">
        {list.map((u) => {
          const self = u.id === profile?.id;
          const a = info.get(u.id);
          return (
            <li key={u.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{u.name}</span>
                  {self && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                  {!u.active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">inativo</span>}
                  <span className="block text-xs text-muted-foreground">
                    {a?.email ?? "—"}
                    {u.job_title && ` · ${u.job_title}`}
                    {` · último acesso: ${a?.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca"}`}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <select aria-label={`Perfil de ${u.name}`} className={SELECT_CLASS} value={u.role} onChange={(e) => update(u, e.target.value as UserRole, u.active)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                  <Button size="sm" variant={u.active ? "outline" : "default"} onClick={() => update(u, u.role, !u.active)}>
                    {u.active ? "Desativar" : "Ativar"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === u.id ? null : u.id)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>Redefinir senha</Button>
                </span>
              </div>
              {editing === u.id && (
                <EditForm
                  user={u}
                  onDone={(error) => {
                    if (error) setMsg({ ok: false, text: error });
                    else {
                      setMsg({ ok: true, text: "Dados atualizados." });
                      setEditing(null);
                    }
                    users.reload();
                  }}
                />
              )}
            </li>
          );
        })}
        {list.length === 0 && !users.loading && <li className="px-4 py-6 text-sm text-muted-foreground">Nenhum usuário encontrado.</li>}
      </ul>
      <p className="text-xs text-muted-foreground">
        Usuários não são excluídos: desative para bloquear o acesso e preservar o histórico. O sistema sempre mantém ao menos um administrador ativo.
      </p>
    </div>
  );
}

function CreateForm({ onCreated, onError }: { onCreated: (email: string) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "consultor" as UserRole, job_title: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await callAdmin({ action: "create", ...form });
      onCreated(form.email);
      setForm({ name: "", email: "", password: "", role: "consultor", job_title: "" });
    } catch (err) {
      onError((err as Error).message);
    }
    setBusy(false);
  }

  return (
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
  );
}

function EditForm({ user, onDone }: { user: Profile; onDone: (error?: string) => void }) {
  const [name, setName] = useState(user.name);
  const [job, setJob] = useState(user.job_title ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    const { error } = await getSupabase().rpc("admin_update_profile_details", { target: user.id, new_name: name, new_job_title: job });
    onDone(error?.message);
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">Nome</span>
        <Input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">Cargo</span>
        <Input value={job} onChange={(e) => setJob(e.target.value)} />
      </label>
      <Button type="submit" size="sm">Salvar</Button>
    </form>
  );
}
