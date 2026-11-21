"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
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
import { ArrowLeft, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { categoryColor, OVERDUE_BADGE, PROJECT_STATUS_COLOR, TASK_STATUS_COLOR } from "@/lib/theme/status";
import { MSG_ERROR, SEGMENTED, SEGMENT_ITEM, SELECT_CLASS } from "@/lib/ui";
import { useAutosave } from "@/lib/use-autosave";
import { useQuery } from "@/lib/use-query";
import { SaveStatus } from "@/components/ui/save-status";
import { cn } from "@/lib/utils";
import { isOpenTask, PROJECT_STATUS_LABEL, todayISO, type Category, type Client, type Person, type Project, type ProjectStatus, type Task } from "@/types/domain";
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
const TASK_COLS = "id, project_id, category_id, title, description, status, assignee_id, client_owner, start_date, due_date, position";

// Contexto e Escopos são só da equipe interna.
const INTERNAL_TABS: Tab[] = ["contexto", "escopos"];
const tabsFor = (isExternal: boolean) => TABS.filter((t) => !(isExternal && INTERNAL_TABS.includes(t.id)));
const tabId = (t: Tab) => `projeto-tab-${t}`;
const panelId = (t: Tab) => `projeto-painel-${t}`;

// Rota por query string (?id=&task=&tab=) porque o site é exportado estaticamente.
function ProjetoDetalhe() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.get("id") ?? "";
  const taskParam = params.get("task");
  const { profile, can } = useAuth();
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

  // Padrão ARIA de tabs: ←/→ (circular), Home e End movem o foco e já ativam a aba.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = allowedTabs.findIndex((t) => t.id === tab);
    const last = allowedTabs.length - 1;
    const target = ({ ArrowLeft: i <= 0 ? last : i - 1, ArrowRight: i >= last ? 0 : i + 1, Home: 0, End: last } as Record<string, number>)[e.key];
    if (target === undefined) return;
    e.preventDefault();
    const next = allowedTabs[target].id;
    document.getElementById(tabId(next))?.focus();
    if (next !== tab) setTab(next);
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
        .select("id, client_id, name, status, manager_id, start_date, end_date, discord_channel_id, clients(name)")
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
    // Canceladas ficam fora do Cronograma (aparecem só na Lista, pelo filtro "Canceladas").
    return (tasks.data ?? [])
      .filter((t) => t.status !== "cancelled")
      .map((t) => ({
        id: t.id,
        label: t.title,
        sub: t.assignee_id ? names.get(t.assignee_id) : undefined,
        start: t.start_date,
        end: t.due_date,
        color: t.category_id && cats.get(t.category_id) ? categoryColor(cats.get(t.category_id)!.color) : TASK_STATUS_COLOR[t.status],
        done: t.status === "done",
        overdue: isOpenTask(t.status) && !!t.due_date && t.due_date < today,
      }))
      .sort((a, b) => (a.start ?? a.end ?? "9").localeCompare(b.start ?? b.end ?? "9"));
  }, [tasks.data, categories.data, people.data]);

  if (!id) return <p className="text-sm">Projeto não informado.</p>;
  if (project.loading) return <ProjectSkeleton />;
  if (project.error) return <ErrorState what="o projeto" detail={project.error} onRetry={project.reload} />;
  const p = project.data;
  if (!p || !profile) return <p className="text-sm">Projeto não encontrado ou sem acesso.</p>;

  const isManager = profile.role === "admin" || p.manager_id === profile.id;
  const canManageScopes = isManager || can("scope.manage");
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
          <div className="flex flex-wrap gap-2">
            {profile.role === "admin" && <DeleteProjectButton project={p} onDeleted={() => router.replace("/projetos/")} />}
            <Button type="button" variant="outline" aria-expanded={editing} aria-controls="project-editor" onClick={() => setEditing((v) => !v)}>
              Editar projeto
              <ChevronDown strokeWidth={1.75} aria-hidden className={cn("transition-transform duration-150 motion-reduce:transition-none", editing && "rotate-180")} />
            </Button>
          </div>
        )}
      </div>
      {/* Recolhido com hidden (sem desmontar): fechar e reabrir mantém o que está sendo editado. */}
      {isManager && (
        <div id="project-editor" hidden={!editing}>
          <ProjectEditor key={p.id} project={p} onSaved={project.reload} />
        </div>
      )}

      {/* Em telas estreitas as abas quebram linha: com rolagem, as últimas ficavam cortadas e escondidas. */}
      <div role="tablist" aria-label="Visões do projeto" onKeyDown={onTabKeyDown} className={cn(SEGMENTED, "max-w-full")}>
        {allowedTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-controls={panelId(t.id)}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={cn(SEGMENT_ITEM, "shrink-0 whitespace-nowrap")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Só a aba ativa é montada; cada visão renderiza um único bloco, então o painel não altera o espaçamento. */}
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
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
          <TaskList
            tasks={tasks.data ?? []}
            categories={categories.data ?? []}
            people={people.data ?? []}
            onOpen={setOpenId}
            canBulkDelete={profile.role === "admin"}
            onChanged={tasks.reload}
          />
        )}
        {tab === "cronograma" && !tasks.loading && !tasks.error && <GanttChart rows={ganttRows} onSelect={setOpenId} />}
        {tab === "documentos" && <DocumentIndex projectId={id} />}
        {tab === "contexto" && <ContextPanel projectId={id} isManager={isManager} />}
        {tab === "membros" && <MembersPanel projectId={id} managerId={p.manager_id} canManage={isManager} onChanged={people.reload} />}
        {tab === "escopos" && <CategoriesPanel projectId={id} categories={categories.data ?? []} canManage={canManageScopes} onChanged={categories.reload} />}
      </div>

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

const BUCKET = "task-attachments";

// Exclusão definitiva do projeto (só admin; o RLS de projects também exige is_admin()).
// O banco apaga em cascata tarefas, membros, escopos, contexto e comentários; os arquivos dos anexos
// ficam no Storage, então saem antes, para não sobrar arquivo órfão.
function DeleteProjectButton({ project, onDeleted }: { project: Project; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const files = await supabase.from("task_attachments").select("storage_path, tasks!inner(project_id)").eq("tasks.project_id", project.id);
    if (files.error) {
      setBusy(false);
      return setError(files.error.message);
    }
    const paths = (files.data ?? []).map((f) => f.storage_path as string);
    for (let i = 0; i < paths.length; i += 100) {
      // Falha aqui não impede a exclusão: o pior caso é um arquivo órfão no bucket privado.
      await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    }
    const { error } = await supabase.from("projects").delete().eq("id", project.id).select("id").single();
    setBusy(false);
    if (error) return setError(error.code === "PGRST116" ? "Sem permissão para excluir este projeto." : error.message);
    close();
    onDeleted();
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Trash2 strokeWidth={1.75} aria-hidden /> Excluir projeto
      </Button>
      <ConfirmDialog
        open={open}
        title="Excluir projeto?"
        description={`Apaga "${project.name}" com todas as tarefas, anexos, comentários, escopos e contexto. Não dá para desfazer. Para encerrar sem apagar, mude o status para Concluído ou Cancelado.`}
        confirmLabel={busy ? "Excluindo…" : "Excluir projeto"}
        destructive
        busy={busy}
        confirmDisabled={typed.trim() !== project.name.trim()}
        onConfirm={remove}
        onCancel={close}
      >
        <div className="space-y-1.5">
          <label htmlFor="confirmar-exclusao" className="block text-sm">
            Digite o nome do projeto para confirmar
          </label>
          <Input id="confirmar-exclusao" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
        </div>
      </ConfirmDialog>
    </>
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

// Cliente, status e período do projeto (alimentam o cronograma de portfólio) e canal do Discord (rotina diária).
// Salvamento automático: cada alteração é gravada após uma pausa, sem botão de salvar.
type ProjectForm = { client_id: string; status: ProjectStatus; start: string; end: string; channel: string };
type ChannelProject = Pick<Project, "id" | "name" | "status">;
const NEW_CLIENT = "__novo__";
const CHANNEL_RE = /^[0-9]{17,20}$/;

function projectFormError(f: ProjectForm): string | null {
  const channel = f.channel.trim();
  if (channel && !CHANNEL_RE.test(channel)) return "Informe só os números do ID do canal (17 a 20 dígitos) para salvar.";
  if (f.start && f.end && f.end < f.start) return "O fim não pode ser anterior ao início.";
  return null;
}

function ProjectEditor({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const { can } = useAuth();
  const canManageClients = can("clients.manage");
  const [form, setForm] = useState<ProjectForm>(() => ({
    client_id: project.client_id ?? "",
    status: project.status,
    start: project.start_date ?? "",
    end: project.end_date ?? "",
    channel: project.discord_channel_id ?? "",
  }));
  const [choosingNew, setChoosingNew] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [creating, setCreating] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const set = <K extends keyof ProjectForm>(k: K, v: ProjectForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Clientes ativos, mais o atual mesmo se inativo (para não sumir da lista).
  const clients = useQuery<Client[]>(
    () => getSupabase().from("clients").select("id, name, status").order("name"),
    [],
  );
  const clientOptions = (clients.data ?? []).filter((c) => c.status === "ativo" || c.id === form.client_id);
  // Sem permissão de ver clientes, a lista vem vazia: o cliente atual continua visível pelo nome do projeto.
  if (project.client_id && project.clients?.name && !clientOptions.some((c) => c.id === project.client_id)) {
    clientOptions.unshift({ id: project.client_id, name: project.clients.name, status: "ativo" } as Client);
  }

  // Outros projetos no mesmo canal (I1): a rotina grava o mesmo resumo no Contexto de cada um.
  // Parte do canal já salvo; a lista traz só os projetos que o usuário enxerga (RLS).
  const savedChannel = project.discord_channel_id;
  const sameChannel = useQuery<ChannelProject[]>(
    () =>
      savedChannel
        ? getSupabase()
            .from("projects")
            .select("id, name, status")
            .eq("discord_channel_id", savedChannel)
            .neq("id", project.id)
            .order("name")
        : Promise.resolve({ data: [], error: null }),
    [project.id, savedChannel],
  );
  const sharedWith = savedChannel ? (sameChannel.data ?? []) : [];

  const autosave = useAutosave(form, {
    valid: (f) => projectFormError(f) === null,
    save: async (f, prev) => {
      const payload = {
        client_id: f.client_id || null,
        status: f.status,
        start_date: f.start || null,
        end_date: f.end || null,
        discord_channel_id: f.channel.trim() || null,
      };
      const before = {
        client_id: prev.client_id || null,
        status: prev.status,
        start_date: prev.start || null,
        end_date: prev.end || null,
        discord_channel_id: prev.channel.trim() || null,
      };
      const changes = Object.fromEntries(Object.entries(payload).filter(([k, v]) => v !== before[k as keyof typeof before]));
      if (Object.keys(changes).length === 0) return null;
      const { error } = await getSupabase().from("projects").update(changes).eq("id", project.id).select("id").single();
      if (error) {
        if (error.code === "PGRST116") return "sem permissão para editar este projeto.";
        if (error.code === "23514" && error.message.includes("discord_channel_id")) return "informe só os números do ID do canal.";
        if (error.code === "23514") return "o fim não pode ser anterior ao início.";
        if (error.code === "23503") return "o cliente escolhido não existe mais.";
        return error.message;
      }
      onSaved();
      return null;
    },
  });

  async function createClient(e: FormEvent) {
    e.preventDefault();
    const name = newClient.trim();
    if (!name) return;
    setCreating(true);
    setClientError(null);
    const { data, error } = await getSupabase().from("clients").insert({ name }).select("id").single();
    setCreating(false);
    if (error) return setClientError(error.message);
    clients.reload();
    set("client_id", data.id as string);
    setNewClient("");
    setChoosingNew(false);
  }

  const invalidText = projectFormError(form) ?? undefined;

  return (
    <div className="glass-coluna space-y-3 p-4 text-sm">
      {/* Enter num campo grava na hora; o salvamento automático cuida do resto. */}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void autosave.flush();
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void autosave.flush();
        }}
      >
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">Cliente</span>
          <Select
            className={SELECT_CLASS}
            value={choosingNew ? NEW_CLIENT : form.client_id}
            onChange={(e) => {
              if (e.target.value === NEW_CLIENT) return setChoosingNew(true);
              setChoosingNew(false);
              set("client_id", e.target.value);
            }}
          >
            <option value="">Sem cliente</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.status === "ativo" ? c.name : `${c.name} (inativo)`}
              </option>
            ))}
            {canManageClients && <option value={NEW_CLIENT}>Novo cliente…</option>}
          </Select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">Status</span>
          <Select className={SELECT_CLASS} value={form.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
            {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">Início</span>
          <Input type="date" className="num" value={form.start} onChange={(e) => set("start", e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">Fim</span>
          <Input type="date" className="num" value={form.end} onChange={(e) => set("end", e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">Canal do Discord</span>
          <Input
            className="num w-56"
            inputMode="numeric"
            maxLength={20}
            title="Informe só os números do ID do canal."
            aria-describedby="project-discord-help"
            value={form.channel}
            onChange={(e) => set("channel", e.target.value)}
          />
        </label>
      </form>
      {choosingNew && (
        <form onSubmit={createClient} className="flex max-w-md flex-wrap gap-2">
          <Input
            autoFocus
            aria-label="Nome do novo cliente"
            placeholder="Nome do novo cliente"
            required
            className="min-w-48 flex-1"
            value={newClient}
            onChange={(e) => setNewClient(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={creating}>{creating ? "Criando…" : "Criar e vincular"}</Button>
          <Button type="button" variant="ghost" onClick={() => setChoosingNew(false)}>Cancelar</Button>
        </form>
      )}
      {(clientError || clients.error) && <p role="alert" className={MSG_ERROR}>{clientError ?? clients.error}</p>}
      <p id="project-discord-help" className="text-[0.8125rem] text-muted-foreground">
        ID do canal do projeto no Discord. Usado no resumo diário das conversas. Um canal pode ter mais de um projeto.
      </p>
      {sharedWith.length > 0 && (
        <p className="text-[0.8125rem] text-muted-foreground">
          Também neste canal:{" "}
          {sharedWith.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/projeto/?id=${p.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                {p.name}
              </Link>
              {(p.status === "concluido" || p.status === "cancelado") && ` (${PROJECT_STATUS_LABEL[p.status].toLowerCase()})`}
            </span>
          ))}
          . O resumo diário do canal vai para o Contexto de cada projeto ativo do canal.
        </p>
      )}
      <SaveStatus state={autosave.state} error={autosave.error} invalidText={invalidText} />
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
