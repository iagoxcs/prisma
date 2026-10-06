"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getSupabase } from "@/lib/supabase/client";
import { PROJECT_STATUS_LABEL, type Project } from "@/types/domain";

// Rota por query string (?id=) porque o site é exportado estaticamente.
function ProjetoDetalhe() {
  const id = useSearchParams().get("id");
  const [result, setResult] = useState<{ id: string; project: Project | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    getSupabase()
      .from("projects")
      .select("id, client_id, name, status, manager_id, start_date, end_date, clients(name)")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setResult({ id, project: (data as unknown as Project | null) ?? null });
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (id && result?.id !== id) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const project = id ? result?.project : null;
  if (!project) return <p className="text-sm">Projeto não encontrado ou sem acesso.</p>;

  return (
    <div className="space-y-4">
      <Link href="/projetos/" className="text-sm text-muted-foreground hover:underline">← Projetos</Link>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <Badge variant="secondary">{PROJECT_STATUS_LABEL[project.status]}</Badge>
      </div>
      <dl className="grid max-w-md grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Cliente</dt>
        <dd>{project.clients?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">Período</dt>
        <dd>{project.start_date ?? "—"} → {project.end_date ?? "—"}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">Tarefas, Kanban e membros entram na Fase 2.</p>
    </div>
  );
}

export default function ProjetoPage() {
  return (
    <Suspense fallback={null}>
      <ProjetoDetalhe />
    </Suspense>
  );
}
