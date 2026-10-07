"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { todayISO, type Task } from "@/types/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MyTask = Pick<Task, "id" | "project_id" | "title" | "due_date"> & { projects: { name: string } | null };

const GROUPS = ["Atrasadas", "Hoje", "Próximos 7 dias", "Sem prazo"] as const;
type Group = (typeof GROUPS)[number];

// Soma dias a uma data YYYY-MM-DD.
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const ddMM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function groupOf(due: string | null, today: string, limit: string): Group | null {
  if (!due) return "Sem prazo";
  if (due < today) return "Atrasadas";
  if (due === today) return "Hoje";
  if (due <= limit) return "Próximos 7 dias";
  return null;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<number | null>(null);

  useEffect(() => {
    getSupabase()
      .from("projects")
      .select("id", { count: "exact", head: true })
      .neq("status", "concluido")
      .neq("status", "cancelado")
      .then(({ count }) => setProjects(count ?? 0));
  }, []);

  const tasks = useQuery<MyTask[]>(
    () =>
      profile
        ? getSupabase()
            .from("tasks")
            .select("id, project_id, title, due_date, projects(name)")
            .eq("assignee_id", profile.id)
            .neq("status", "done")
            .order("due_date", { ascending: true, nullsFirst: false })
            .overrideTypes<MyTask[], { merge: false }>()
        : // Sem perfil ainda: mantém "carregando" (useQuery não volta a loading ao trocar deps).
          new Promise<never>(() => {}),
    [profile?.id],
  );

  const today = todayISO();
  const limit = addDays(today, 7);
  const grouped = new Map<Group, MyTask[]>(GROUPS.map((g) => [g, []]));
  for (const t of tasks.data ?? []) {
    const g = groupOf(t.due_date, today, limit);
    if (g) grouped.get(g)!.push(t);
  }
  const visible = GROUPS.filter((g) => grouped.get(g)!.length > 0);
  const count = (g: Group) => (tasks.loading ? "…" : tasks.error ? "—" : grouped.get(g)!.length);

  return (
    <div className="space-y-6">
      <h1>Olá, {profile?.name}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <section className="glass-coluna space-y-1 p-5">
          <h2 className="text-sm font-medium text-muted-foreground">Projetos ativos</h2>
          <p className="num text-4xl font-medium tracking-tight">{projects ?? "…"}</p>
        </section>
        <section className="glass-coluna space-y-1 p-5">
          <h2 className="text-sm font-medium text-muted-foreground">Atrasadas</h2>
          <p className="num text-4xl font-medium tracking-tight text-warning">{count("Atrasadas")}</p>
        </section>
        <section className="glass-coluna space-y-1 p-5">
          <h2 className="text-sm font-medium text-muted-foreground">Hoje</h2>
          <p className="num text-4xl font-medium tracking-tight">{count("Hoje")}</p>
        </section>
      </div>

      <section className="space-y-4">
        <h2>Minhas tarefas</h2>
        {tasks.loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : tasks.error ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar suas tarefas: {tasks.error}
          </p>
        ) : !tasks.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa pendente atribuída a você</p>
        ) : !visible.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa com prazo nos próximos 7 dias</p>
        ) : (
          visible.map((g) => (
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
                        {t.due_date && (
                          <span className={`num shrink-0 text-xs ${g === "Atrasadas" ? "text-warning" : "text-muted-foreground"}`}>
                            {ddMM(t.due_date)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
