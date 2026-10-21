"use client";

import { useMemo } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { ChartFrame } from "@/components/charts/chart-frame";
import { KpiTile } from "@/components/charts/kpi-tile";
import { ScopeChart } from "@/components/charts/scope-chart";
import { ThroughputChart } from "@/components/charts/throughput-chart";
import { WorkloadChart } from "@/components/charts/workload-chart";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { shortDate } from "@/lib/format";
import {
  adherencePct,
  completionPct,
  fmtDays,
  fmtPct,
  lastWeeks,
  leadTimeDays,
  overdueTotal,
  scopeBars,
  scopeTitle,
  throughputSeries,
  throughputTitle,
  workloadBars,
  workloadTitle,
  type AdherenceRow,
  type LeadTimeRow,
  type ProgressRow,
  type ScopeRow,
  type ThroughputRow,
  type WorkloadRow,
} from "@/lib/indicators";
import { TASK_STATUS_LABEL, todayISO } from "@/types/domain";

const ROW_CAP = 1000; // teto padrão do PostgREST: acima disso a soma pode estar incompleta

type NameRow = { id: string; name: string };

export default function IndicatorsPage() {
  const { profile } = useAuth();
  const external = profile?.role === "externo" || !!profile?.is_external;
  const scopeLabel = profile?.role === "admin" ? "Portfólio completo" : "Projetos que você acessa";
  const today = todayISO();
  const firstWeek = lastWeeks(today)[0];

  // Cada view falha de forma independente. Externo não consulta (a barreira real é o RLS: 0 linhas).
  const progress = useQuery<ProgressRow[]>(
    () =>
      external
        ? Promise.resolve({ data: [], error: null })
        : getSupabase().from("project_progress").select("total, done, overdue"),
    [external],
  );
  const adherence = useQuery<AdherenceRow[]>(
    () =>
      external
        ? Promise.resolve({ data: [], error: null })
        : getSupabase().from("deadline_adherence").select("done_total, done_on_time"),
    [external],
  );
  const leadTime = useQuery<LeadTimeRow[]>(
    () =>
      external
        ? Promise.resolve({ data: [], error: null })
        : getSupabase().from("task_lead_time").select("tasks_done, avg_days"),
    [external],
  );
  const throughput = useQuery<ThroughputRow[]>(
    () =>
      external
        ? Promise.resolve({ data: [], error: null })
        : getSupabase().from("task_throughput_weekly").select("week_start, done_count").gte("week_start", firstWeek),
    [external, firstWeek],
  );
  const workload = useQuery<WorkloadRow[]>(
    () =>
      external
        ? Promise.resolve({ data: [], error: null })
        : getSupabase().from("workload_by_assignee").select("assignee_id, open_count, overdue_count"),
    [external],
  );
  const scope = useQuery<ScopeRow[]>(
    () =>
      external
        ? Promise.resolve({ data: [], error: null })
        : getSupabase().from("scope_distribution").select("category_id, status, task_count"),
    [external],
  );
  const people = useQuery<NameRow[]>(
    () => (external ? Promise.resolve({ data: [], error: null }) : getSupabase().from("profiles").select("id, name")),
    [external],
  );
  const categories = useQuery<NameRow[]>(
    () => (external ? Promise.resolve({ data: [], error: null }) : getSupabase().from("categories").select("id, name")),
    [external],
  );

  const series = useMemo(() => throughputSeries(throughput.data ?? [], today), [throughput.data, today]);
  const workloadData = useMemo(
    () => workloadBars(workload.data ?? [], new Map((people.data ?? []).map((p) => [p.id, p.name]))),
    [workload.data, people.data],
  );
  const scopeData = useMemo(
    () => scopeBars(scope.data ?? [], new Map((categories.data ?? []).map((c) => [c.id, c.name]))),
    [scope.data, categories.data],
  );

  if (profile && external) {
    return (
      <div className="space-y-6">
        <h1>Indicadores</h1>
        <div className="glass-coluna flex items-start gap-3 p-5">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Sem acesso aos indicadores</p>
            <p className="text-sm text-muted-foreground">
              Os indicadores consolidados são internos. Você continua vendo suas tarefas no Meu painel e nos projetos para os quais foi convidado.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const partial = [progress, adherence, leadTime, throughput, workload, scope].some((q) => (q.data?.length ?? 0) >= ROW_CAP);
  const overdue = progress.data ? overdueTotal(progress.data) : null;
  const workloadLoading = workload.loading || people.loading;
  const workloadError = workload.error ?? people.error;
  const scopeLoading = scope.loading || categories.loading;
  const scopeError = scope.error ?? categories.error;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1>Indicadores</h1>
        <p className="text-sm font-medium text-muted-foreground">{scopeLabel}</p>
      </div>
      {partial && (
        <p role="status" className="text-sm text-muted-foreground">
          Algum indicador atingiu o limite de {ROW_CAP} linhas e pode estar incompleto.
        </p>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Conclusão"
          value={progress.data ? fmtPct(completionPct(progress.data)) : null}
          loading={progress.loading}
          error={!!progress.error}
          hint="Tarefas concluídas ÷ total"
        />
        <KpiTile
          label="Atrasadas"
          value={overdue === null ? null : String(overdue)}
          loading={progress.loading}
          error={!!progress.error}
          warn={!!overdue}
          hint="Abertas com prazo vencido"
        />
        <KpiTile
          label="Aderência ao prazo"
          value={adherence.data ? fmtPct(adherencePct(adherence.data)) : null}
          loading={adherence.loading}
          error={!!adherence.error}
          hint="Concluídas até o prazo ÷ concluídas com prazo"
        />
        <KpiTile
          label="Lead time médio"
          value={leadTime.data ? fmtDays(leadTimeDays(leadTime.data)) : null}
          loading={leadTime.loading}
          error={!!leadTime.error}
          hint="Da criação à conclusão"
        />
      </dl>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame
          title={throughputTitle(series)}
          what="o throughput semanal"
          loading={throughput.loading}
          error={throughput.error}
          onRetry={throughput.reload}
          empty={!series.some((p) => p.value > 0)}
          emptyText="Nenhuma tarefa foi concluída nas últimas 12 semanas nos projetos que você acessa."
          table={{
            caption: "Tarefas concluídas por semana",
            headers: ["Semana de", "Concluídas"],
            rows: series.map((p) => [shortDate(p.week_start), p.value]),
          }}
        >
          <ThroughputChart data={series} />
        </ChartFrame>

        <ChartFrame
          title={workloadTitle(workloadData.bars, workloadData.openTotal)}
          scopeLabel={scopeLabel}
          what="a carga por responsável"
          loading={workloadLoading}
          error={workloadError}
          onRetry={() => {
            workload.reload();
            people.reload();
          }}
          empty={workloadData.bars.length === 0}
          emptyText="Não há tarefas abertas nos projetos que você acessa."
          table={{
            caption: "Tarefas abertas por responsável (dez maiores cargas)",
            headers: ["Responsável", "Abertas", "Vencidas"],
            rows: workloadData.bars.map((b) => [b.name, b.open, b.overdue]),
          }}
        >
          <WorkloadChart data={workloadData.bars} />
        </ChartFrame>

        <ChartFrame
          className="xl:col-span-2"
          title={scopeTitle(scopeData)}
          what="a distribuição por escopo"
          loading={scopeLoading}
          error={scopeError}
          onRetry={() => {
            scope.reload();
            categories.reload();
          }}
          empty={scopeData.length === 0}
          emptyText="Ainda não há tarefas nos projetos que você acessa."
          table={{
            caption: "Tarefas por escopo e status",
            headers: ["Escopo", TASK_STATUS_LABEL.todo, TASK_STATUS_LABEL.doing, TASK_STATUS_LABEL.done],
            rows: scopeData.map((b) => [b.name, b.todo, b.doing, b.done]),
          }}
        >
          <ScopeChart data={scopeData} />
        </ChartFrame>
      </div>
    </div>
  );
}
