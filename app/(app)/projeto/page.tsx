"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { DocumentIndex } from "@/components/documents/document-index";
import { GanttChart, type GanttRow } from "@/components/gantt-chart";
import { CategoriesPanel } from "@/components/project/categories-panel";
import { ContextPanel } from "@/components/project/context-panel";
import { Kanban } from "@/components/project/kanban";
import { MembersPanel } from "@/components/project/members-panel";
import { TaskList } from "@/components/project/task-list";
import { TaskPanel } from "@/components/project/task-panel";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { categoryColor, OVERDUE_BADGE, PROJECT_STATUS_COLOR, TASK_STATUS_COLOR } from "@/lib/theme/status";
import { MSG_ERROR, SEGMENTED, SEGMENT_ITEM, SELECT_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, todayISO, type Category, type Person, type Project, type ProjectStatus, type Task } from "@/types/domain";
import { Select } from "@/components/ui/select";

type Tab = "quadro" | "lista" | "cronograma" | "documentos" | "contexto" | "membros" | "escopos";
const TABS: { id: Tab; label: string }[] = [
  { id: "quadro", label: "Quadro" },
  { id: "lista", label: "Lista" },
  { id: "cronograma", label: "Cronograma" },
  { id: "documentos", label: "Documentos" },
  { id: "contexto", label: "Contexto" },
  { id: "membros", label: "Membros" },
  { id: "escopos", label: "Escopos" },
];
const DEFAULT_TAB: Tab = "quadro";
const TASK_COLS = "id, project_id, category_id, title, description, status, assignee_id, start_date, due_date, position";

// Contexto e Escopos são só da equipe interna.
const INTERNAL_TABS: Tab[] = ["contexto", "escopos"];
const tabsFor = (isExternal: boolean) => TABS.filter((t) => !(isExternal && INTERNAL_TABS.includes(t.id)));

// Rota por query string (?id=&task=&tab=) porque o site é exportado estaticamente.
function ProjetoDetalhe() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.get("id") ?? "";
  const taskParam = params.get("task");
  const { profile } = useAuth();
  const rawTab = params.get("tab");
  const allowedTabs = tabsFor(profile?.is_external ?? false);
  const tab = allowedTabs.find((t) => t.id === rawTab)?.id ?? DEFAULT_TAB;
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // replace (não push): trocar de aba não acumula entradas no histórico. id e task são preservados.
  const setTab = (next: Tab | null) => {
    const q = new URLSearchParams(params.toString());
    if (next) q.set("tab", next);
    else q.delete("tab");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  // Aba inválida (ou Contexto/Escopos para externo): a URL cai no padrão. Só decide com o perfil carregado.
  useEffect(() => {
    if (profile && rawTab !== null && rawTab !== tab) setTab(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, rawTab, tab]);
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

  // Tempo real: mudanças em tarefas do projeto atualizam Quadro, Lista e Cronograma.
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
  if (project.loading) return <ProjectSkeleton />;
  if (project.error) return <ErrorState what="o projeto" detail={project.error} onRetry={project.reload} />;
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
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        {isManager && (
          <Button type="button" variant="outline" aria-expanded={editing} aria-controls="project-editor" onClick={() => setEditing((v) => !v)}>
            Editar projeto
            <ChevronDown strokeWidth={1.75} aria-hidden className={cn("transition-transform duration-150 motion-reduce:transition-none", editing && "rotate-180")} />
          </Button>
        )}
      </div>
      {/* Recolhido com hidden (sem desmontar): fechar e reabrir mantém o que está sendo editado. */}
      {isManager && (
        <div id="project-editor" hidden={!editing}>
          <ProjectEditor key={p.id + p.status + p.start_date + p.end_date} project={p} onSaved={project.reload} />
        </div>
      )}

      {/* Em telas estreitas as abas rolam na horizontal em vez de quebrar linha. */}
      <div role="tablist" aria-label="Visões do projeto" className={cn(SEGMENTED, "max-w-full flex-nowrap overflow-x-auto")}>
        {allowedTabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn(SEGMENT_ITEM, "shrink-0 whitespace-nowrap")}>
            {t.label}
          </button>
        ))}
      </div>

      {(tab === "quadro" || tab === "lista" || tab === "cronograma") && tasks.error && (
        <ErrorState what="as tarefas do projeto" detail={tasks.error} onRetry={tasks.reload} />
      )}
      {tab === "quadro" && tasks.loading && <BoardSkeleton />}
      {tab === "lista" && tasks.loading && <SkeletonList count={6} label="Carregando a lista…" />}
      {tab === "cronograma" && tasks.loading && <SkeletonList count={6} label="Carregando o cronograma…" />}
      {tab === "quadro" && !tasks.loading && !tasks.error && (
        <Kanban
          projectId={id}
          tasks={tasks.data ?? []}
          categories={categories.data ?? []}
          people={people.data ?? []}
          canCreate={!profile.is_external}
          canManageScopes={canManageScopes}
          onOpen={setOpenId}
          onChanged={tasks.reload}
        />
      )}
      {tab === "lista" && !tasks.loading && !tasks.error && (
        <TaskList tasks={tasks.data ?? []} categories={categories.data ?? []} people={people.data ?? []} onOpen={setOpenId} />
      )}
      {tab === "cronograma" && !tasks.loading && !tasks.error && <GanttChart rows={ganttRows} onSelect={setOpenId} />}
      {tab === "documentos" && <DocumentIndex projectId={id} />}
      {tab === "contexto" && <ContextPanel projectId={id} isManager={isManager} />}
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

// Placeholders com a forma do Quadro: três colunas com cards.
function BoardSkeleton() {
  return (
    <div role="status" className="grid gap-4 lg:grid-cols-3">
      <span className="sr-only">Carregando o quadro…</span>
      {[3, 2, 1].map((n, i) => (
        <div key={i} className="glass-coluna flex flex-col gap-2.5 p-3.5">
          <Skeleton className="mx-1 mb-1 h-5 w-24" />
          {Array.from({ length: n }, (_, j) => (
            <Skeleton key={j} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Carregando o projeto…</span>
      <Skeleton className="h-11 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-11 w-80 max-w-full rounded-lg" />
      <BoardSkeleton />
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
        <Select className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </Select>
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
