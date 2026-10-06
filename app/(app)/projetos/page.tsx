"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { OVERDUE_BADGE, PROJECT_STATUS_COLOR } from "@/lib/theme/status";
import { MSG_ERROR, ROW_LIST, SELECT_CLASS } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, todayISO, type Client, type Project } from "@/types/domain";

export default function ProjetosPage() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canCreate = profile?.role === "admin" || profile?.role === "gerente";

  const [version, setVersion] = useState(0);
  const isExternal = profile?.is_external ?? true;
  const today = todayISO();

  useEffect(() => {
    let active = true;
    const supabase = getSupabase();
    Promise.all([
      supabase
        .from("projects")
        .select("id, client_id, name, status, manager_id, start_date, end_date, clients(name)")
        .order("created_at", { ascending: false }),
      isExternal
        ? Promise.resolve({ data: [], error: null })
        : supabase.from("clients").select("id, name, status").eq("status", "ativo").order("name"),
    ]).then(([p, c]) => {
      if (!active) return;
      if (p.error) setError(p.error.message);
      else setProjects((p.data as unknown as Project[]) ?? []);
      setClients((c.data as Client[]) ?? []);
    });
    return () => {
      active = false;
    };
  }, [isExternal, version]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: name.trim(), client_id: clientId || null, manager_id: profile.id })
      .select("id")
      .single();
    if (error) return setError(error.message);
    // O gerente também aparece na lista de membros do projeto.
    await supabase.from("project_members").insert({ project_id: data.id, user_id: profile.id, project_role: "gerente" });
    // Escopos padrão definidos em Configurações → Parâmetros.
    const defaults = await supabase.from("app_settings").select("value").eq("key", "default_categories").maybeSingle();
    if (Array.isArray(defaults.data?.value) && defaults.data.value.length > 0) {
      await supabase.from("categories").insert((defaults.data.value as string[]).map((name) => ({ project_id: data.id, name })));
    }
    setName("");
    setClientId("");
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-6">
      <h1>Projetos</h1>
      {canCreate && (
        <form onSubmit={create} className="flex max-w-2xl flex-wrap gap-2">
          <Input className="min-w-48 flex-1" placeholder="Nome do projeto" required value={name} onChange={(e) => setName(e.target.value)} />
          <select
            aria-label="Cliente"
            className={SELECT_CLASS}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button type="submit">Criar projeto</Button>
        </form>
      )}
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <ul className={ROW_LIST}>
        {projects.map((p) => {
          const overdue = !!p.end_date && p.end_date < today && p.status !== "concluido" && p.status !== "cancelado";
          return (
            <li key={p.id}>
              <Link
                href={`/projeto/?id=${p.id}`}
                className="surface-card flex min-h-13 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors duration-150 hover:bg-accent"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[0.9375rem] font-medium">{p.name}</span>
                  {p.clients?.name && <span className="truncate text-[0.8125rem] text-muted-foreground">{p.clients.name}</span>}
                </span>
                <span className="flex items-center gap-3">
                  {overdue && <span className={cn("num rounded-md px-2.5 py-0.5 text-xs", OVERDUE_BADGE)}>vencido {shortDate(p.end_date!)}</span>}
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: PROJECT_STATUS_COLOR[p.status] }} />
                    {PROJECT_STATUS_LABEL[p.status]}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {projects.length === 0 && (
          <li className="text-sm text-muted-foreground">{canCreate ? "Nenhum projeto ainda. Crie o primeiro acima." : "Nenhum projeto visível para você."}</li>
        )}
      </ul>
    </div>
  );
}
