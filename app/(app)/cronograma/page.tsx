"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { GanttChart, type GanttRow } from "@/components/gantt-chart";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { PROJECT_STATUS_LABEL, todayISO, type Project, type ProjectStatus } from "@/types/domain";

const STATUS_COLOR: Record<ProjectStatus, string> = {
  planejamento: "#64748b",
  em_andamento: "#2563eb",
  pausado: "#d97706",
  concluido: "#16a34a",
  cancelado: "#9ca3af",
};

// Cronograma de portfólio: um projeto por linha, respeitando o RLS de quem consulta.
export default function CronogramaPage() {
  const router = useRouter();
  const projects = useQuery<Project[]>(
    () =>
      getSupabase()
        .from("projects")
        .select("id, client_id, name, status, manager_id, start_date, end_date, clients(name)")
        .order("start_date", { ascending: true, nullsFirst: false })
        .then((r) => ({ data: r.data as unknown as Project[] | null, error: r.error })),
    [],
  );

  const rows = useMemo<GanttRow[]>(() => {
    const today = todayISO();
    return (projects.data ?? []).map((p) => ({
      id: p.id,
      label: p.name,
      sub: p.clients?.name ?? PROJECT_STATUS_LABEL[p.status],
      start: p.start_date,
      end: p.end_date,
      color: STATUS_COLOR[p.status],
      done: p.status === "concluido" || p.status === "cancelado",
      overdue: !!p.end_date && p.end_date < today && p.status !== "concluido" && p.status !== "cancelado",
    }));
  }, [projects.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cronograma de projetos</h1>
      <p className="text-sm text-muted-foreground">
        Período definido em cada projeto (início e fim). Cor por status; contorno vermelho = fim vencido.
      </p>
      {projects.error && <p role="alert" className="text-sm text-destructive">{projects.error}</p>}
      {projects.loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <GanttChart rows={rows} onSelect={(id) => router.push(`/projeto/?id=${id}`)} />
      )}
    </div>
  );
}
