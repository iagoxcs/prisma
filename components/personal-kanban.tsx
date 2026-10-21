"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, ListChecks, Plus, X } from "lucide-react";
import { placeInColumn } from "@/components/project/kanban";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { OVERDUE_BADGE, TASK_STATUS_DOT } from "@/lib/theme/status";
import { DIALOG, MSG_ERROR, OVERLAY, restoreFocus, TEXTAREA_CLASS, trapFocus } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABEL, todayISO, type TaskStatus } from "@/types/domain";
import type { Json } from "@/types/database";

export type PersonalTask = {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  position: number;
  notes: string | null;
  checklist: Json;
};
type ChecklistItem = { id: string; text: string; done: boolean };

const MAX_NOTES = 5000;
const MAX_ITEMS = 100;

// A coluna é jsonb: valida o formato ao ler, descartando o que não for item de checklist.
function readChecklist(raw: Json): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return [];
    const { id, text, done } = x;
    return typeof id === "string" && typeof text === "string" ? [{ id, text, done: done === true }] : [];
  });
}

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];
type Order = Record<TaskStatus, string[]>;

const isColumn = (id: UniqueIdentifier): id is TaskStatus => (COLUMNS as UniqueIdentifier[]).includes(id);
const byPosition = (a: PersonalTask, b: PersonalTask) => a.position - b.position;

// Kanban individual (Minhas Tarefas): sem projeto, só do próprio usuário. Mesmo comportamento do kanban de projetos.
export function PersonalKanban({ tasks, onChanged }: { tasks: PersonalTask[]; onChanged: () => void }) {
  const [items, setItems] = useState(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orderRef = useRef<Order | null>(null);
  const today = todayISO();

  // Lista nova do servidor substitui a local, exceto durante um arraste.
  useEffect(() => {
    if (!orderRef.current) setItems(tasks);
  }, [tasks]);

  const byId = useMemo(() => new Map(items.map((t) => [t.id, t])), [items]);
  const baseOrder: Order = useMemo(() => {
    const o: Order = { todo: [], doing: [], done: [] };
    for (const t of [...items].sort(byPosition)) o[t.status].push(t.id);
    return o;
  }, [items]);
  const shown = order ?? baseOrder;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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
    const o = orderRef.current ?? baseOrder;
    return COLUMNS.find((c) => o[c].includes(String(id)));
  };

  function onDragStart({ active }: DragStartEvent) {
    setError(null);
    setActiveId(String(active.id));
    writeOrder(baseOrder);
  }

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

  function cancelDrag() {
    setActiveId(null);
    writeOrder(null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const col = containerOf(over?.id);
    let o = orderRef.current;
    if (!o || !col || !over) return cancelDrag();
    if (!isColumn(over.id) && over.id !== active.id) {
      const from = o[col].indexOf(id);
      const to = o[col].indexOf(String(over.id));
      if (from >= 0 && to >= 0) o = { ...o, [col]: arrayMove(o[col], from, to) };
    }
    const ids = o[col];
    setActiveId(null);
    void commit(id, col, ids);
  }

  async function commit(id: string, status: TaskStatus, ids: string[]) {
    const moved = items.find((t) => t.id === id);
    if (!moved || (moved.status === status && baseOrder[status].join() === ids.join())) return writeOrder(null);

    const full = items.filter((t) => t.status === status && t.id !== id).sort(byPosition);
    const { position, renumber } = placeInColumn(full, ids, id);
    const nextPos = new Map(renumber ? renumber.map((x, i) => [x, i + 1]) : [[id, position]]);
    setItems(items.map((t) => (t.id === id ? { ...t, status, position: nextPos.get(id)! } : nextPos.has(t.id) ? { ...t, position: nextPos.get(t.id)! } : t)));
    writeOrder(null);

    const supabase = getSupabase();
    const results = renumber
      ? await Promise.all(renumber.map((x, i) => supabase.from("personal_tasks").update(x === id ? { status, position: i + 1 } : { position: i + 1 }).eq("id", x)))
      : [await supabase.from("personal_tasks").update({ status, position }).eq("id", id)];
    const failed = results.find((r) => r.error)?.error;
    if (failed) setError(`Não foi possível mover a tarefa: ${failed.message}`);
    onChanged();
  }

  async function addToColumn(status: TaskStatus, title: string): Promise<string | null> {
    const max = Math.max(0, ...items.filter((t) => t.status === status).map((t) => t.position));
    const { error } = await getSupabase().from("personal_tasks").insert({ title, status, position: max + 1 });
    if (error) return error.message;
    onChanged();
    return null;
  }

  const activeTask = activeId ? byId.get(activeId) : undefined;
  const editingTask = editing ? byId.get(editing) : undefined;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <DndContext
        id="kanban-pessoal"
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{
          screenReaderInstructions: {
            draggable: "Para mover a tarefa, pressione espaço ou Enter. Use as setas para trocar de posição ou de coluna e pressione espaço ou Enter para soltar. Esc cancela.",
          },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={cancelDrag}
      >
        <div className="grid gap-4 lg:grid-cols-3">
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
                    return t ? <SortableTask key={id} task={t} status={status} today={today} onOpen={setEditing} /> : null;
                  })}
                </ul>
              </SortableContext>
              {shown[status].length === 0 && <p className="px-1 text-[0.8125rem] text-muted-foreground">Nenhuma tarefa aqui.</p>}
              <ColumnAdd status={status} onAdd={addToColumn} />
            </Column>
          ))}
        </div>
        <DragOverlay>{activeTask && <TaskCard task={activeTask} status={activeTask.status} today={today} overlay />}</DragOverlay>
      </DndContext>
      {editingTask && (
        <EditDialog
          key={editingTask.id}
          task={editingTask}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
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

function ColumnAdd({ status, onAdd }: { status: TaskStatus; onAdd: (status: TaskStatus, title: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  useEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    restore.current = true;
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

function SortableTask({ task, status, today, onOpen }: { task: PersonalTask; status: TaskStatus; today: string; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
      <TaskCard
        task={task}
        status={status}
        today={today}
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
      />
    </li>
  );
}

function TaskCard({
  task: t,
  status,
  today,
  onOpen,
  handle,
  overlay = false,
}: { task: PersonalTask; status: TaskStatus; today: string; onOpen?: (id: string) => void; handle?: ReactNode; overlay?: boolean }) {
  const overdue = !!t.due_date && status !== "done" && t.due_date < today;
  const items = readChecklist(t.checklist);
  const doneCount = items.filter((i) => i.done).length;
  const body = (
    <>
      <span className={cn("text-[0.9375rem] font-medium", status === "done" && "text-muted-foreground")}>{t.title}</span>
      {t.due_date &&
        (overdue ? (
          <span className={cn("num rounded-md px-2.5 py-0.5 text-xs whitespace-nowrap self-start", OVERDUE_BADGE)}>vencida {shortDate(t.due_date)}</span>
        ) : (
          <span className="num flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
            <CalendarDays className="size-3.5" strokeWidth={1.75} aria-hidden />
            {shortDate(t.due_date)}
          </span>
        ))}
      {items.length > 0 && (
        <span className="num flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <ListChecks className="size-3.5" strokeWidth={1.75} aria-hidden />
          {doneCount}/{items.length}
        </span>
      )}
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
        <div className="flex min-w-0 flex-1 flex-col gap-2 py-4 pr-4 pl-1">{body}</div>
      ) : (
        <button type="button" onClick={() => onOpen?.(t.id)} className="flex min-w-0 flex-1 flex-col gap-2 rounded-r-lg py-4 pr-4 pl-1 text-left outline-offset-2">
          {body}
        </button>
      )}
    </div>
  );
}

// Edição: título, prazo, observações, checklist e exclusão (só da própria tarefa pessoal).
function EditDialog({ task, onClose, onSaved }: { task: PersonalTask; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.due_date ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [items, setItems] = useState(() => readChecklist(task.checklist));
  const [newItem, setNewItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    return () => restoreFocus(opener);
  }, []);

  function addItem() {
    const text = newItem.trim();
    if (!text || items.length >= MAX_ITEMS) return;
    setItems([...items, { id: crypto.randomUUID(), text, done: false }]);
    setNewItem("");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    // Item digitado e ainda não confirmado entra no salvamento.
    const pending = newItem.trim();
    const checklist = pending && items.length < MAX_ITEMS ? [...items, { id: crypto.randomUUID(), text: pending, done: false }] : items;
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()
      .from("personal_tasks")
      .update({ title: title.trim(), due_date: due || null, notes: notes.trim() || null, checklist })
      .eq("id", task.id);
    setBusy(false);
    if (error) return setError(error.message);
    onSaved();
  }

  async function remove() {
    setBusy(true);
    const { error } = await getSupabase().from("personal_tasks").delete().eq("id", task.id);
    setBusy(false);
    setConfirming(false);
    if (error) return setError(error.message);
    onSaved();
  }

  return createPortal(
    <div className={cn(OVERLAY, "z-50 items-center justify-center p-4")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(DIALOG, "max-h-[90dvh] overflow-y-auto")}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !confirming) onClose();
          trapFocus(e, ref.current);
        }}
      >
        <form onSubmit={save} className="space-y-4">
          <h2 id={titleId}>Editar tarefa</h2>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">Título</span>
            <Input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">Prazo</span>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="text-muted-foreground">
              Checklist{items.length > 0 && <span className="num"> ({items.filter((i) => i.done).length}/{items.length})</span>}
            </legend>
            {items.length > 0 && (
              <ul className="space-y-1">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Concluir: ${it.text}`}
                      className="size-4 shrink-0 accent-primary"
                      checked={it.done}
                      onChange={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                    />
                    <span className={cn("min-w-0 flex-1 break-words", it.done && "text-muted-foreground line-through")}>{it.text}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover item: ${it.text}`} onClick={() => setItems(items.filter((x) => x.id !== it.id))}>
                      <X strokeWidth={1.75} aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                aria-label="Novo item do checklist"
                placeholder="Adicionar item"
                maxLength={200}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addItem} disabled={!newItem.trim() || items.length >= MAX_ITEMS}>
                <Plus strokeWidth={1.75} aria-hidden /> Adicionar
              </Button>
            </div>
          </fieldset>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">Observações</span>
            <textarea className={cn(TEXTAREA_CLASS, "min-h-24")} maxLength={MAX_NOTES} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
              Excluir
            </Button>
            <Button type="button" variant="outline" className="ml-auto" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Salvar
            </Button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Excluir tarefa?"
        description="Esta tarefa pessoal será removida."
        confirmLabel="Excluir"
        destructive
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </div>,
    document.body,
  );
}
