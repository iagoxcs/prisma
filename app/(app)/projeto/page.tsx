"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { GanttChart, type GanttRow } from "@/components/gantt-chart";
import { CategoriesPanel } from "@/components/project/categories-panel";
import { Kanban } from "@/components/project/kanban";
import { MembersPanel } from "@/components/project/members-panel";
import { TaskPanel } from "@/components/project/task-panel";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { categoryColor, OVERDUE_BADGE, PROJECT_STATUS_COLOR, TASK_STATUS_COLOR } from "@/lib/theme/status";
import { MSG_ERROR, SEGMENTED, SEGMENT_ITEM, SELECT_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, todayISO, type Category, type Person, type Project, type ProjectStatus, type Task } from "@/types/domain";

type Tab = "quadro" | "cronograma" | "membros" | "escopos";
const TABS: { id: Tab; label: string }[] = [
  { id: "quadro", label: "Quadro" },
  { id: "cronograma", label: "Cronograma" },
  { id: "membros", label: "Membros" },
  { id: "escopos", label: "Escopos" },
];
const TASK_COLS = "id, project_id, category_id, title, description, status, assignee_id, start_date, due_date, position";

// Rota por query string (?id=&task=) porque o site é exportado estaticamente.
function ProjetoDetalhe() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const taskParam = params.get("task");
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("quadro");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const activeTaskId = openId ?? (taskParam && taskParam !== dismissed ? taskParam : null);

  const project = useQuery<Project>(
    () =>
      getSupabase()
        .from("projects")
        .select("id, client_id, name, status, manager_id, start_date, end_date, clients(name)")
        .eq("id", id)
        .maybeSingle()
        .then((r) => ({ data: r.data as unknown as Project | null, error: r.error })),
    [id],
  );
  const categories = useQuery<Category[]>(
    () => getSupabase().from("categories").select("id, project_id, name, color").eq("project_id", id).order("name"),
    [id],
  );
  const tasks = useQuery<Task[]>(
    () => getSupabase().from("tasks").select(TASK_COLS).eq("project_id", id).order("position"),
    [id],
  );
  const people = useQuery<Person[]>(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase.from("project_members").select("profiles(id, name)").eq("project_id", id);
    const list = ((data ?? []) as unknown as { profiles: Person | null }[]).flatMap((m) => (m.profiles ? [m.profiles] : []));
    const managerId = project.data?.manager_id;
    if (managerId && !list.some((p) => p.id === managerId)) {
      const mgr = await supabase.from("profiles").select("id, name").eq("id", managerId).maybeSingle();
      if (mgr.data) list.push(mgr.data as Person);
    }
    return { data: list.sort((a, b) => a.name.localeCompare(b.name)), error };
  }, [id, project.data?.manager_id]);

  // Tempo real: mudanças em tarefas do projeto atualizam Quadro e Cronograma.
  const reloadTasks = tasks.reload;
  useEffect(() => {
    if (!id) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`tasks-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${id}` }, () => reloadTasks())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, reloadTasks]);

  const ganttRows = useMemo<GanttRow[]>(() => {
    const cats = new Map((categories.data ?? []).map((c) => [c.id, c]));
    const names = new Map((people.data ?? []).map((p) => [p.id, p.name]));
    const today = todayISO();
    return (tasks.data ?? [])
      .map((t) => ({
        id: t.id,
        label: t.title,
        sub: t.assignee_id ? names.get(t.assignee_id) : undefined,
        start: t.start_date,
        end: t.due_date,
        color: t.category_id && cats.get(t.category_id) ? categoryColor(cats.get(t.category_id)!.color) : TASK_STATUS_COLOR[t.status],
        done: t.status === "done",
        overdue: t.status !== "done" && !!t.due_date && t.due_date < today,
      }))
      .sort((a, b) => (a.start ?? a.end ?? "9").localeCompare(b.start ?? b.end ?? "9"));
  }, [tasks.data, categories.data, people.data]);

  if (!id) return <p className="text-sm">Projeto não informado.</p>;
  if (project.loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const p = project.data;
  if (!p || !profile) return <p className="text-sm">Projeto não encontrado ou sem acesso.</p>;

  const isManager = profile.role === "admin" || p.manager_id === profile.id;
  const canManageScopes = isManager || profile.role === "lider";
  const overdue = !!p.end_date && p.end_date < todayISO() && p.status !== "concluido" && p.status !== "cancelado";

  return (
    <div className="space-y-5">
      <Link href="/projetos/" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden /> Projetos
      </Link>
      <div className="space-y-2">
        <h1>{p.name}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: PROJECT_STATUS_COLOR[p.status] }} />
            {PROJECT_STATUS_LABEL[p.status]}
          </span>
          {p.clients?.name && <span className="text-muted-foreground">{p.clients.name}</span>}
          {overdue && <span className={cn("num rounded-md px-2.5 py-0.5 text-xs", OVERDUE_BADGE)}>vencido {shortDate(p.end_date!)}</span>}
        </div>
      </div>
      {isManager && <ProjectEditor key={p.id + p.status + p.start_date + p.end_date} project={p} onSaved={project.reload} />}

      <div role="tablist" aria-label="Visões do projeto" className={SEGMENTED}>
        {TABS.filter((t) => !(profile.is_external && t.id === "escopos")).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={SEGMENT_ITEM}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "quadro" && (
        <Kanban
          projectId={id}
          tasks={tasks.data ?? []}
          categories={categories.data ?? []}
          people={people.data ?? []}
          canCreate={!profile.is_external}
          onOpen={setOpenId}
          onChanged={tasks.reload}
        />
      )}
      {tab === "cronograma" && <GanttChart rows={ganttRows} onSelect={setOpenId} />}
      {tab === "membros" && <MembersPanel projectId={id} managerId={p.manager_id} canManage={isManager} onChanged={people.reload} />}
      {tab === "escopos" && <CategoriesPanel projectId={id} categories={categories.data ?? []} canManage={canManageScopes} onChanged={categories.reload} />}

      {activeTaskId && (
        <TaskPanel
          taskId={activeTaskId}
          task={(tasks.data ?? []).find((t) => t.id === activeTaskId)}
          categories={categories.data ?? []}
          people={people.data ?? []}
          isExternal={profile.is_external}
          onClose={() => {
            setOpenId(null);
            setDismissed(taskParam);
          }}
          onChanged={tasks.reload}
        />
      )}
    </div>
  );
}

// Status e período do projeto (alimentam o cronograma de portfólio).
function ProjectEditor({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [start, setStart] = useState(project.start_date ?? "");
  const [end, setEnd] = useState(project.end_date ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await getSupabase()
      .from("projects")
      .update({ status, start_date: start || null, end_date: end || null })
      .eq("id", project.id);
    if (error) return setError(error.code === "23514" ? "O fim não pode ser anterior ao início." : error.message);
    onSaved();
  }

  return (
    <form onSubmit={save} className="glass-coluna flex flex-wrap items-end gap-3 p-4 text-sm">
      <label className="space-y-1.5">
        <span className="block text-[0.8125rem] font-medium text-muted-foreground">Status</span>
        <select className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="block text-[0.8125rem] font-medium text-muted-foreground">Início</span>
        <Input type="date" className="num" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="space-y-1.5">
        <span className="block text-[0.8125rem] font-medium text-muted-foreground">Fim</span>
        <Input type="date" className="num" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <Button type="submit" variant="outline">Salvar projeto</Button>
      {error && <p role="alert" className={cn("w-full", MSG_ERROR)}>{error}</p>}
    </form>
  );
}

export default function ProjetoPage() {
  return (
    <Suspense fallback={null}>
      <ProjetoDetalhe />
    </Suspense>
  );
}
