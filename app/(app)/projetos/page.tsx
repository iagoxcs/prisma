"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import { PROJECT_STATUS_LABEL, type Client, type Project } from "@/types/domain";

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
    setName("");
    setClientId("");
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Projetos</h1>
      {canCreate && (
        <form onSubmit={create} className="flex max-w-2xl flex-wrap gap-2">
          <Input className="min-w-48 flex-1" placeholder="Nome do projeto" required value={name} onChange={(e) => setName(e.target.value)} />
          <select
            aria-label="Cliente"
            className="h-8 rounded-lg border bg-background px-2 text-sm"
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
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y rounded-lg border">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projeto/?id=${p.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted">
              <span>
                <span className="font-medium">{p.name}</span>
                {p.clients?.name && <span className="ml-2 text-muted-foreground">{p.clients.name}</span>}
              </span>
              <Badge variant="secondary">{PROJECT_STATUS_LABEL[p.status]}</Badge>
            </Link>
          </li>
        ))}
        {projects.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">Nenhum projeto visível para você.</li>}
      </ul>
    </div>
  );
}
