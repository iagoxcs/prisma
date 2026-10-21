"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, Plus, Upload } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { TaskImport } from "@/components/project/task-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials, shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { categoryColor, OVERDUE_BADGE, TASK_STATUS_DOT } from "@/lib/theme/status";
import { MSG_ERROR, SEGMENT_ITEM, SELECT_CLASS } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABEL, todayISO, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";
import { Select } from "@/components/ui/select";

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];
const MIN_GAP = 1e-6;
const MOTION_MS = 180;

type Order = Record<TaskStatus, string[]>;
// Estado otimista: `items` é exibido enquanto arrasta, enquanto salva e até chegar uma lista nova do servidor
// (referência diferente de `until`). Assim o Realtime não sobrescreve o arraste em andamento.
type Override = { items: Task[]; until: Task[]; saving: boolean };

const isColumn = (id: UniqueIdentifier): id is TaskStatus => (COLUMNS as UniqueIdentifier[]).includes(id);
const byPosition = (a: Task, b: Task) => a.position - b.position;

// Toque fica com o TouchSensor (com atraso); o PointerSensor atende mouse e caneta.
class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: e }: { nativeEvent: PointerEvent }) => e.pointerType !== "touch" && e.isPrimary && e.button === 0,
    },
  ];
}

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

// Nova position do item movido, considerando TODAS as tarefas da coluna (`full`, sem o item, ordenada),
// a partir dos vizinhos visíveis na ordem final (`visible`, com o item). Se o espaço acabar, renumera a coluna.
export function placeInColumn(full: { id: string; position: number }[], visible: string[], movedId: string): { position: number; renumber?: string[] } {
  type Item = (typeof full)[number];
  if (full.length === 0) return { position: 1 };
  const idx = visible.indexOf(movedId);
  const prevVis = visible[idx - 1];
  const nextVis = visible[idx + 1];
  let before: Item | undefined;
  let after: Item | undefined;
  if (prevVis) {
    const i = full.findIndex((t) => t.id === prevVis);
    [before, after] = [full[i], full[i + 1]];
  } else if (nextVis) {
    const j = full.findIndex((t) => t.id === nextVis);
    [before, after] = [full[j - 1], full[j]];
  } else {
    before = full[full.length - 1];
  }
  if (before && !after) return { position: before.position + 1 };
  if (!before && after) return { position: after.position - 1 };
  const mid = (before!.position + after!.position) / 2;
  if (mid - before!.position < MIN_GAP || after!.position - mid < MIN_GAP) {
    const ids = full.map((t) => t.id);
    ids.splice(ids.indexOf(before!.id) + 1, 0, movedId);
    return { position: ids.indexOf(movedId) + 1, renumber: ids };
  }
  return { position: mid };
}

export function Kanban({
  projectId,
  tasks,
  categories,
  people,
  canCreate,
  canManageScopes,
  onOpen,
  onChanged,
}: {
  projectId: string;
  tasks: Task[];
  categories: Category[];
  people: Person[];
  canCreate: boolean;
  canManageScopes: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const orderRef = useRef<Order | null>(null);
  const endMsgRef = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile } = useAuth();

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const category = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const today = todayISO();

  // Filtros vivem na URL (?assignee=, ?scope=, ?mine=1, ?overdue=1); valores inválidos são ignorados.
  const paramAssignee = searchParams.get("assignee") ?? "";
  const paramScope = searchParams.get("scope") ?? "";
  const filterAssignee = nameOf.has(paramAssignee) ? paramAssignee : "";
  const filterCategory = category.has(paramScope) ? paramScope : "";
  const filterMine = searchParams.get("mine") === "1" && !!profile;
  const filterOverdue = searchParams.get("overdue") === "1";
  const myId = profile?.id ?? "";
  const filtering = !!filterAssignee || !!filterCategory || filterMine || filterOverdue;

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const clearFilters = () => setParams({ assignee: null, scope: null, mine: null, overdue: null });

  const base = override && (activeId || override.saving || tasks === override.until) ? override.items : tasks;
  const byId = useMemo(() => new Map(base.map((t) => [t.id, t])), [base]);
  const matches = (t: Task) =>
    (!filterAssignee || t.assignee_id === filterAssignee) &&
    (!filterCategory || t.category_id === filterCategory) &&
    (!filterMine || t.assignee_id === myId) &&
    (!filterOverdue || (!!t.due_date && t.status !== "done" && t.due_date < today));
  const visibleOrder: Order = useMemo(() => {
    const o = { todo: [], doing: [], done: [] } as Order;
    for (const t of [...base].sort(byPosition)) if (matches(t)) o[t.status].push(t.id);
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filterAssignee, filterCategory, filterMine, filterOverdue, myId, today]);
  const shown = order ?? visibleOrder;
  const visibleCount = COLUMNS.reduce((n, c) => n + visibleOrder[c].length, 0);
  const noResults = filtering && visibleCount === 0;

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const writeOrder = (next: Order | null) => {
    orderRef.current = next;
    setOrder(next);
  };
  const containerOf = (id: UniqueIdentifier | undefined): TaskStatus | undefined => {
    if (id === undefined) return undefined;
    if (isColumn(id)) return id;
    const o = orderRef.current ?? visibleOrder;
    return COLUMNS.find((c) => o[c].includes(String(id)));
  };
  // Posição (1-based) e total do item na coluna, para os anúncios.
  const slot = (activeKey: UniqueIdentifier, overKey: UniqueIdentifier | undefined) => {
    const col = containerOf(overKey) ?? containerOf(activeKey);
    if (!col) return null;
    const list = (orderRef.current ?? visibleOrder)[col];
    const at = overKey !== undefined && !isColumn(overKey) ? list.indexOf(String(overKey)) : list.indexOf(String(activeKey));
    const n = list.includes(String(activeKey)) ? list.length : list.length + 1;
    return { col, pos: (at < 0 ? n - 1 : at) + 1, n };
  };
  const titleOf = (id: UniqueIdentifier) => byId.get(String(id))?.title ?? "";

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tarefa ${titleOf(active.id)} selecionada.`,
    onDragOver: ({ active, over }) => {
      const s = slot(active.id, over?.id);
      return s ? `Tarefa ${titleOf(active.id)} sobre ${TASK_STATUS_LABEL[s.col]}, posição ${s.pos} de ${s.n}.` : `Tarefa ${titleOf(active.id)} fora de uma coluna.`;
    },
    // Calculado em onDragEnd (a ordem provisória já foi descartada quando o anúncio é emitido).
    onDragEnd: ({ active }) => endMsgRef.current ?? `Tarefa ${titleOf(active.id)} solta fora de uma coluna. Nada mudou.`,
    onDragCancel: ({ active }) => `Movimento cancelado. Tarefa ${titleOf(active.id)} voltou ao lugar.`,
  };

  function onDragStart({ active }: DragStartEvent) {
    setError(null);
    setActiveId(String(active.id));
    // Congela a lista atual: eventos do Realtime durante o arraste não mexem no quadro.
    setOverride({ items: base, until: tasks, saving: false });
    writeOrder(visibleOrder);
  }

  // Entre colunas: o card passa para a outra lista assim que entra nela.
  function onDragOver({ active, over }: DragOverEvent) {
    const from = containerOf(active.id);
    const to = containerOf(over?.id);
    const o = orderRef.current;
    if (!o || !from || !to || from === to || !over) return;
    const id = String(active.id);
    const target = o[to].filter((x) => x !== id);
    const at = isColumn(over.id) ? target.length : Math.max(0, target.indexOf(String(over.id)));
    target.splice(at, 0, id);
    writeOrder({ ...o, [from]: o[from].filter((x) => x !== id), [to]: target });
  }

  function onDragCancel() {
    setActiveId(null);
    writeOrder(null);
    setOverride(null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const col = containerOf(over?.id);
    let o = orderRef.current;
    endMsgRef.current = null;
    if (!o || !col || !over) return onDragCancel();
    if (!isColumn(over.id) && over.id !== active.id) {
      const from = o[col].indexOf(id);
      const to = o[col].indexOf(String(over.id));
      if (from >= 0 && to >= 0) o = { ...o, [col]: arrayMove(o[col], from, to) };
    }
    endMsgRef.current = `Tarefa ${titleOf(id)} movida para ${TASK_STATUS_LABEL[col]}, posição ${o[col].indexOf(id) + 1} de ${o[col].length}.`;
    setActiveId(null);
    writeOrder(null);
    commit(id, col, o[col]);
  }

  async function commit(id: string, status: TaskStatus, visibleIds: string[]) {
    const items = override?.items ?? base;
    const moved = items.find((t) => t.id === id);
    if (!moved) return setOverride(null);
    const before = visibleOrder[status];
    if (moved.status === status && before.join() === visibleIds.join()) return setOverride(null);

    const full = items.filter((t) => t.status === status && t.id !== id).sort(byPosition);
    const { position, renumber } = placeInColumn(full, visibleIds, id);
    const nextPos = new Map(renumber ? renumber.map((x, i) => [x, i + 1]) : [[id, position]]);
    const next = items.map((t) => (t.id === id ? { ...t, status, position: nextPos.get(id)! } : nextPos.has(t.id) ? { ...t, position: nextPos.get(t.id)! } : t));
    setOverride({ items: next, until: tasksRef.current, saving: true });

    const supabase = getSupabase();
    const results = renumber
      ? await Promise.all(renumber.map((x, i) => supabase.from("tasks").update(x === id ? { status, position: i + 1 } : { position: i + 1 }).eq("id", x)))
      : [await supabase.from("tasks").update({ status, position }).eq("id", id)];
    const failed = results.find((r) => r.error)?.error;
    if (failed) {
      setOverride(null); // volta ao estado anterior (lista do servidor)
      setError(`Não foi possível mover a tarefa: ${failed.message}`);
      if (renumber) onChanged(); // parte do lote pode ter sido gravada
      return;
    }
    setOverride((cur) => cur && { ...cur, saving: false, until: tasksRef.current });
    onChanged();
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const max = Math.max(0, ...tasks.filter((t) => t.status === "todo").map((t) => t.position));
    const { error } = await getSupabase()
      .from("tasks")
      .insert({ project_id: projectId, title: title.trim(), position: max + 1 });
    if (error) return setError(error.message);
    setTitle("");
    onChanged();
  }

  // Criação pelo rodapé da coluna: entra ao final e herda os filtros ativos, para continuar visível.
  async function addToColumn(status: TaskStatus, text: string): Promise<string | null> {
    const max = Math.max(0, ...tasks.filter((t) => t.status === status).map((t) => t.position));
    const { error } = await getSupabase()
      .from("tasks")
      .insert({
        project_id: projectId,
        title: text,
        status,
        position: max + 1,
        ...((filterAssignee || (filterMine && myId)) && { assignee_id: filterAssignee || myId }),
        ...(filterCategory && { category_id: filterCategory }),
      });
    if (error) return error.message;
    onChanged();
    return null;
  }

  const activeTask = activeId ? byId.get(activeId) : undefined;
  const card = { category, nameOf, today };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <form onSubmit={add} className="flex min-w-64 flex-1 gap-2">
            <Input placeholder="Nova tarefa" required value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit">Adicionar</Button>
          </form>
        )}
        {canCreate && (
          <Button type="button" variant="outline" onClick={() => setImporting(true)}>
            <Upload strokeWidth={1.75} aria-hidden /> Importar CSV
          </Button>
        )}
        <Select aria-label="Filtrar por responsável" className={SELECT_CLASS} value={filterAssignee} onChange={(e) => setParams({ assignee: e.target.value || null })}>
          <option value="">Todos os responsáveis</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select aria-label="Filtrar por escopo" className={SELECT_CLASS} value={filterCategory} onChange={(e) => setParams({ scope: e.target.value || null })}>
          <option value="">Todos os escopos</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        {profile && (
          <button type="button" aria-pressed={filterMine} className={SEGMENT_ITEM} onClick={() => setParams({ mine: filterMine ? null : "1" })}>
            Minhas
          </button>
        )}
        <button type="button" aria-pressed={filterOverdue} className={SEGMENT_ITEM} onClick={() => setParams({ overdue: filterOverdue ? null : "1" })}>
          Atrasadas
        </button>
        {filtering && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
        <p aria-live="polite" className="num ml-auto text-sm text-muted-foreground">
          {visibleCount} de {base.length} tarefas
        </p>
      </div>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      {importing && (
        <TaskImport
          projectId={projectId}
          tasks={tasks}
          categories={categories}
          people={people}
          canManageScopes={canManageScopes}
          onClose={() => setImporting(false)}
          onImported={onChanged}
        />
      )}

      <DndContext
        id={`kanban-${projectId}`}
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Para mover a tarefa, pressione espaço ou Enter. Use as setas para trocar de posição ou de coluna e pressione espaço ou Enter para soltar. Esc cancela.",
          },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {noResults && (
          <div className="glass-coluna flex flex-col items-start gap-3 p-5">
            <p className="text-sm text-muted-foreground">Nenhuma tarefa com esses filtros.</p>
            <Button type="button" variant="outline" onClick={clearFilters}>
              Limpar filtros
            </Button>
          </div>
        )}
        <div className={cn("grid gap-4 lg:grid-cols-3", noResults && "hidden")}>
          {COLUMNS.map((status) => (
            <Column key={status} status={status}>
              <h3 className="flex items-center gap-2 px-1 pb-1">
                <span className={cn("size-2 rounded-full", TASK_STATUS_DOT[status])} />
                {TASK_STATUS_LABEL[status]}
                <span className="num ml-auto text-sm font-normal text-muted-foreground">{shown[status].length}</span>
              </h3>
              <SortableContext id={status} items={shown[status]} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2.5">
                  {shown[status].map((id) => {
                    const t = byId.get(id);
                    return t ? <SortableTask key={id} task={t} status={status} onOpen={onOpen} reducedMotion={reducedMotion} {...card} /> : null;
                  })}
                </ul>
              </SortableContext>
              {shown[status].length === 0 && <p className="px-1 text-[0.8125rem] text-muted-foreground">Nenhuma tarefa aqui.</p>}
              {canCreate && <ColumnAdd status={status} onAdd={addToColumn} />}
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={reducedMotion ? null : { duration: MOTION_MS, easing: "ease-out" }}>
          {activeTask && <TaskCard task={activeTask} status={COLUMNS.find((c) => shown[c].includes(activeTask.id)) ?? activeTask.status} overlay {...card} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ status, children }: { status: TaskStatus; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} aria-label={TASK_STATUS_LABEL[status]} className="glass-coluna flex min-h-40 flex-col gap-2.5 p-3.5">
      {children}
    </section>
  );
}

// Rodapé da coluna: botão que vira campo. Enter cria, Esc cancela; nos dois casos o foco volta ao botão.
function ColumnAdd({ status, onAdd }: { status: TaskStatus; onAdd: (status: TaskStatus, title: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    restoreFocus.current = true;
    setValue("");
    setError(null);
    setOpen(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onAdd(status, text);
    setBusy(false);
    if (failure) return setError(failure);
    close();
  }

  if (!open)
    return (
      <Button ref={buttonRef} type="button" variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Plus strokeWidth={1.75} aria-hidden /> Adicionar tarefa
      </Button>
    );

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <Input
        autoFocus
        aria-label={`Nova tarefa em ${TASK_STATUS_LABEL[status]}`}
        placeholder="Título da tarefa"
        value={value}
        readOnly={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
    </form>
  );
}

type CardContext = { category: Map<string, Category>; nameOf: Map<string, string>; today: string };

function SortableTask({
  task,
  status,
  onOpen,
  reducedMotion,
  ...ctx
}: { task: Task; status: TaskStatus; onOpen: (id: string) => void; reducedMotion: boolean } & CardContext) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    transition: reducedMotion ? null : { duration: MOTION_MS, easing: "ease-out" },
  });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
      <TaskCard
        task={task}
        status={status}
        onOpen={onOpen}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label="Arrastar tarefa"
            {...attributes}
            {...listeners}
            className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-lg text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        }
        {...ctx}
      />
    </li>
  );
}

// Card sem blur (surface-card). A alça e o botão que abre o drawer são irmãos, nunca aninhados.
function TaskCard({
  task: t,
  status,
  onOpen,
  handle,
  overlay = false,
  category,
  nameOf,
  today,
}: { task: Task; status: TaskStatus; onOpen?: (id: string) => void; handle?: ReactNode; overlay?: boolean } & CardContext) {
  const cat = t.category_id ? category.get(t.category_id) : undefined;
  const overdue = !!t.due_date && status !== "done" && t.due_date < today;
  const assignee = t.assignee_id ? nameOf.get(t.assignee_id) : undefined;
  const body = (
    <>
      {cat && (
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-brand-mid">
          <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(cat.color) }} />
          {cat.name}
        </span>
      )}
      <span className={cn("text-[0.9375rem] font-medium", status === "done" && "text-muted-foreground")}>{t.title}</span>
      <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
        {assignee ? (
          <span title={assignee} className="num flex size-7 items-center justify-center rounded-full bg-brand-shallow text-xs text-foreground">
            {initials(assignee)}
          </span>
        ) : (
          <span>Sem responsável</span>
        )}
        {t.due_date &&
          (overdue ? (
            <span className={cn("num ml-auto rounded-md px-2.5 py-0.5 text-xs whitespace-nowrap", OVERDUE_BADGE)}>vencida {shortDate(t.due_date)}</span>
          ) : (
            <span className="num ml-auto flex items-center gap-1 text-xs whitespace-nowrap">
              <CalendarDays className="size-3.5" strokeWidth={1.75} aria-hidden />
              {shortDate(t.due_date)}
            </span>
          ))}
      </span>
    </>
  );
  return (
    <div className={cn("surface-card flex min-h-11 text-left transition-colors duration-150", overlay ? "cursor-grabbing ring-2 ring-ring" : "hover:bg-accent")}>
      {overlay ? (
        <span className="flex w-8 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          <GripVertical className="size-4" strokeWidth={1.75} />
        </span>
      ) : (
        handle
      )}
      {overlay ? (
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 py-4 pr-4 pl-1">{body}</div>
      ) : (
        <button type="button" onClick={() => onOpen?.(t.id)} className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-r-lg py-4 pr-4 pl-1 text-left outline-offset-2">
          {body}
        </button>
      )}
    </div>
  );
}
