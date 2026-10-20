"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { todayISO, type Task } from "@/types/domain";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/format";
import { OVERDUE_BADGE } from "@/lib/theme/status";
import { cn } from "@/lib/utils";

type MyTask = Pick<Task, "id" | "project_id" | "title" | "due_date"> & { projects: { name: string } | null };

const GROUPS = ["Atrasadas", "Hoje", "Próximos 7 dias", "Sem prazo"] as const;
type Group = (typeof GROUPS)[number];

const TASK_LIMIT = 500;

// Soma dias a uma data YYYY-MM-DD.
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function groupOf(due: string | null, today: string, limit: string): Group | null {
  if (!due) return "Sem prazo";
  if (due < today) return "Atrasadas";
  if (due === today) return "Hoje";
  if (due <= limit) return "Próximos 7 dias";
  return null;
}

// Valor de KPI: "…" carregando, "—" indisponível (nunca 0 em erro), número quando disponível.
function Kpi({ label, value, loading, error, warn }: { label: string; value: number | null; loading: boolean; error: boolean; warn?: boolean }) {
  return (
    <div className="glass-coluna space-y-1 p-5">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("num text-4xl font-medium tracking-tight", warn && "text-warning")}>
        {loading ? (
          <>
            <span aria-hidden>…</span>
            <span className="sr-only">Carregando</span>
          </>
        ) : error || value === null ? (
          <span role="img" aria-label="indisponível">
            —
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  // Perfil ausente/inativo já é barrado pelo AppShell ("Acesso pendente").
  const external = profile?.role === "externo" || !!profile?.is_external;
  const today = todayISO();
  const limit = addDays(today, 7);

  // Indicador consolidado: oculto para externo (RF-22/25), então nem é consultado.
  const projects = useQuery<number>(
    () =>
      external
        ? Promise.resolve({ data: 0, error: null })
        : getSupabase()
            .from("projects")
            .select("id", { count: "exact", head: true })
            .neq("status", "concluido")
            .neq("status", "cancelado")
            .then(({ count, error }) => ({ data: error ? null : (count ?? 0), error })),
    [external],
  );

  const tasks = useQuery<{ rows: MyTask[]; total: number }>(
    () =>
      profile
        ? getSupabase()
            .from("tasks")
            .select("id, project_id, title, due_date, projects(name)", { count: "exact" })
            .eq("assignee_id", profile.id)
            .neq("status", "done")
            .or(`due_date.is.null,due_date.lte.${limit}`)
            .order("due_date", { ascending: true, nullsFirst: false })
            .limit(TASK_LIMIT)
            .overrideTypes<MyTask[], { merge: false }>()
            .then(({ data, count, error }) => ({ data: data ? { rows: data, total: count ?? data.length } : null, error }))
        : // Sem perfil ainda: mantém "carregando" (o AppShell só renderiza a página com perfil ativo).
          new Promise<never>(() => {}),
    [profile?.id, limit],
  );

  const rows = tasks.data?.rows ?? [];
  const grouped = new Map<Group, MyTask[]>(GROUPS.map((g) => [g, []]));
  for (const t of rows) {
    const g = groupOf(t.due_date, today, limit);
    if (g) grouped.get(g)!.push(t);
  }
  const visible = GROUPS.filter((g) => grouped.get(g)!.length > 0);
  const taskCount = (g: Group) => (tasks.loading || tasks.error ? null : grouped.get(g)!.length);
  const overdue = taskCount("Atrasadas");

  return (
    <div className="space-y-6">
      <h1>Olá{profile?.name ? `, ${profile.name}` : ""}</h1>
      {!external && (
        <dl className="grid gap-4 sm:grid-cols-3">
          <Kpi label="Projetos em aberto" value={projects.data} loading={projects.loading} error={!!projects.error} />
          <Kpi label="Minhas atrasadas" value={overdue} loading={tasks.loading} error={!!tasks.error} warn={!!overdue} />
          <Kpi label="Minhas para hoje" value={taskCount("Hoje")} loading={tasks.loading} error={!!tasks.error} />
        </dl>
      )}
      {!external && projects.error && !projects.loading && (
        <ErrorState what="a contagem de projetos" detail={projects.error} onRetry={projects.reload} />
      )}

      <section className="space-y-4">
        <h2>Minhas tarefas</h2>
        {tasks.loading ? (
          <SkeletonList variant="card" count={2} label="Carregando suas tarefas…" />
        ) : tasks.error ? (
          <ErrorState what="suas tarefas" detail={tasks.error} onRetry={tasks.reload} />
        ) : !visible.length ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Nenhuma tarefa atrasada, para hoje, nos próximos 7 dias ou sem prazo atribuída a você.</p>
            <Link href="/projetos/" className={buttonVariants({ variant: "outline" })}>
              Ver projetos
            </Link>
          </div>
        ) : (
          <>
            {tasks.data && tasks.data.total > rows.length && (
              <p role="status" className="text-sm text-muted-foreground">
                Mostrando <span className="num">{rows.length}</span> de <span className="num">{tasks.data.total}</span> tarefas
              </p>
            )}
            {visible.map((g) => (
              <Card key={g} size="sm">
                <CardHeader>
                  <CardTitle className={g === "Atrasadas" ? "text-warning" : undefined}>
                    {g} <span className="num text-muted-foreground">({grouped.get(g)!.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-border">
                    {grouped.get(g)!.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/projeto/?id=${t.project_id}&task=${t.id}`}
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{t.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{t.projects?.name}</span>
                          </span>
                          {t.due_date &&
                            (g === "Atrasadas" ? (
                              <span className={cn(OVERDUE_BADGE, "num shrink-0 rounded-md px-2.5 py-0.5 text-xs")}>vencida {shortDate(t.due_date)}</span>
                            ) : (
                              <span className="num shrink-0 text-xs text-muted-foreground">{shortDate(t.due_date)}</span>
                            ))}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
