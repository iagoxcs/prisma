"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { GanttChart, type GanttRow } from "@/components/gantt-chart";
import { getSupabase } from "@/lib/supabase/client";
import { PROJECT_STATUS_COLOR } from "@/lib/theme/status";
import { useQuery } from "@/lib/use-query";
import { MSG_ERROR } from "@/lib/ui";
import { PROJECT_STATUS_LABEL, todayISO, type Project, type ProjectStatus } from "@/types/domain";

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
      color: PROJECT_STATUS_COLOR[p.status],
      done: p.status === "concluido" || p.status === "cancelado",
      overdue: !!p.end_date && p.end_date < today && p.status !== "concluido" && p.status !== "cancelado",
    }));
  }, [projects.data]);

  return (
    <div className="space-y-5">
      <h1>Cronograma de projetos</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-muted-foreground">
        <span>Período definido em cada projeto (início e fim).</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda de status">
          {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: PROJECT_STATUS_COLOR[s] }} />
              {PROJECT_STATUS_LABEL[s]}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="size-2 rounded-full outline-2 outline-warning" />
            Contorno âmbar: fim vencido
          </li>
        </ul>
      </div>
      {projects.error && <p role="alert" className={MSG_ERROR}>{projects.error}</p>}
      {projects.loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <GanttChart rows={rows} onSelect={(id) => router.push(`/projeto/?id=${id}`)} />
      )}
    </div>
  );
}
