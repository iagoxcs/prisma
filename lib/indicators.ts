// Agregações puras dos indicadores de projeto (views de 20261020203101_project_indicators_views.sql)
// e geração dos títulos-conclusão. Sempre somas: nunca média de percentuais.
import type { TaskStatus } from "@/types/domain";

type N = number | null;

export interface ProgressRow {
  total: N;
  done: N;
  overdue: N;
}
export interface AdherenceRow {
  done_total: N;
  done_on_time: N;
}
export interface LeadTimeRow {
  tasks_done: N;
  avg_days: N;
}
export interface ThroughputRow {
  week_start: string | null;
  done_count: N;
}
export interface WorkloadRow {
  assignee_id: string | null;
  open_count: N;
  overdue_count: N;
}
export interface ScopeRow {
  category_id: string | null;
  status: TaskStatus | null;
  task_count: N;
}

const sum = (xs: N[]) => xs.reduce<number>((acc, x) => acc + (x ?? 0), 0);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
export const completionPct = (rows: ProgressRow[]) => pct(sum(rows.map((r) => r.done)), sum(rows.map((r) => r.total)));

export const overdueTotal = (rows: ProgressRow[]) => sum(rows.map((r) => r.overdue));

// "—" (null) quando não há concluída com prazo.
export const adherencePct = (rows: AdherenceRow[]) => pct(sum(rows.map((r) => r.done_on_time)), sum(rows.map((r) => r.done_total)));

// Média de dias ponderada por tarefas concluídas, com 1 casa decimal; null sem concluídas.
export function leadTimeDays(rows: LeadTimeRow[]) {
  let weighted = 0;
  let tasks = 0;
  for (const r of rows) {
    if (r.avg_days === null || !r.tasks_done) continue;
    weighted += r.avg_days * r.tasks_done;
    tasks += r.tasks_done;
  }
  return tasks > 0 ? Math.round((weighted / tasks) * 10) / 10 : null;
}

export const fmtPct = (v: number | null) => (v === null ? null : `${Math.round(v)}%`);
export const fmtDays = (v: number | null) =>
  v === null ? null : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias`;

// ---------------------------------------------------------------------------
// Throughput semanal
// ---------------------------------------------------------------------------
export const THROUGHPUT_WEEKS = 12;
const COMPARE_WEEKS = 4;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Segunda-feira da semana de uma data YYYY-MM-DD (mesma regra da view: date_trunc('week')).
export const weekStartOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

// As últimas `n` semanas (segundas-feiras, ordem crescente), terminando na semana de `today`.
export function lastWeeks(today: string, n = THROUGHPUT_WEEKS) {
  const current = weekStartOf(today);
  return Array.from({ length: n }, (_, i) => addDays(current, (i - (n - 1)) * 7));
}

export interface WeekPoint {
  week_start: string;
  value: number;
}

// Soma por semana (todos os projetos visíveis); semanas sem dado valem 0.
export function throughputSeries(rows: ThroughputRow[], today: string): WeekPoint[] {
  const byWeek = new Map<string, number>();
  for (const r of rows) {
    if (r.week_start) byWeek.set(r.week_start, (byWeek.get(r.week_start) ?? 0) + (r.done_count ?? 0));
  }
  return lastWeeks(today).map((week_start) => ({ week_start, value: byWeek.get(week_start) ?? 0 }));
}

// Compara as 4 últimas semanas fechadas com as 4 anteriores (a semana corrente é parcial e fica de fora).
// Sem base (período anterior vazio), devolve título neutro, sem verbo de tendência.
export function throughputTitle(series: WeekPoint[]) {
  const closed = series.slice(0, -1);
  const current = sum(closed.slice(-COMPARE_WEEKS).map((p) => p.value));
  const previous = sum(closed.slice(-COMPARE_WEEKS * 2, -COMPARE_WEEKS).map((p) => p.value));
  if (previous === 0) return `Tarefas concluídas por semana nas últimas ${THROUGHPUT_WEEKS} semanas`;
  const change = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(change) < 5) return `Throughput estável nas últimas ${COMPARE_WEEKS} semanas fechadas`;
  return `Throughput ${change > 0 ? "subiu" : "caiu"} ${Math.abs(change)}% nas últimas ${COMPARE_WEEKS} semanas fechadas`;
}

// ---------------------------------------------------------------------------
// Carga por responsável
// ---------------------------------------------------------------------------
export const WORKLOAD_TOP = 10;
export const NO_ASSIGNEE = "Sem responsável";

export interface WorkloadBar {
  name: string;
  onTime: number; // abertas no prazo
  overdue: number; // abertas vencidas
  open: number;
}

// `names`: id → nome (profiles). Soma por responsável entre projetos; top por tarefas abertas.
export function workloadBars(rows: WorkloadRow[], names: Map<string, string>): { bars: WorkloadBar[]; openTotal: number } {
  const byAssignee = new Map<string | null, { open: number; overdue: number }>();
  for (const r of rows) {
    const cur = byAssignee.get(r.assignee_id) ?? { open: 0, overdue: 0 };
    cur.open += r.open_count ?? 0;
    cur.overdue += r.overdue_count ?? 0;
    byAssignee.set(r.assignee_id, cur);
  }
  const all = [...byAssignee.entries()].map(([id, v]) => ({
    name: id ? (names.get(id) ?? "Pessoa sem acesso") : NO_ASSIGNEE,
    onTime: v.open - v.overdue,
    overdue: v.overdue,
    open: v.open,
  }));
  return { bars: all.sort((a, b) => b.open - a.open).slice(0, WORKLOAD_TOP), openTotal: sum(all.map((b) => b.open)) };
}

export function workloadTitle(bars: WorkloadBar[], openTotal: number) {
  const top = bars[0];
  if (!top || openTotal === 0) return "Carga de tarefas abertas por responsável";
  const share = Math.round((top.open / openTotal) * 100);
  return top.name === NO_ASSIGNEE
    ? `Tarefas sem responsável somam ${share}% das abertas`
    : `${top.name} concentra ${share}% das tarefas abertas`;
}

// ---------------------------------------------------------------------------
// Distribuição por escopo
// ---------------------------------------------------------------------------
export const NO_SCOPE = "Sem escopo";

export interface ScopeBar {
  name: string;
  todo: number;
  doing: number;
  done: number;
  open: number;
  total: number;
}

// Agrega por NOME da categoria entre projetos ("Sem escopo" para category_id nulo ou desconhecido).
export function scopeBars(rows: ScopeRow[], names: Map<string, string>): ScopeBar[] {
  const byName = new Map<string, ScopeBar>();
  for (const r of rows) {
    if (!r.status) continue;
    const name = r.category_id ? (names.get(r.category_id) ?? NO_SCOPE) : NO_SCOPE;
    const bar = byName.get(name) ?? { name, todo: 0, doing: 0, done: 0, open: 0, total: 0 };
    const n = r.task_count ?? 0;
    bar[r.status] += n;
    bar.total += n;
    bar.open = bar.todo + bar.doing;
    byName.set(name, bar);
  }
  return [...byName.values()].sort((a, b) => b.total - a.total);
}

export function scopeTitle(bars: ScopeBar[]) {
  const total = sum(bars.map((b) => b.total));
  if (total === 0) return "Tarefas por escopo e status";
  const open = sum(bars.map((b) => b.open));
  if (open === 0) return "Todas as tarefas dos escopos estão concluídas";
  const top = [...bars].sort((a, b) => b.open - a.open)[0];
  return `“${top.name}” concentra ${Math.round((top.open / open) * 100)}% das tarefas em aberto`;
}
