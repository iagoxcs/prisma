"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials, shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { categoryColor, OVERDUE_BADGE, TASK_STATUS_DOT } from "@/lib/theme/status";
import { MSG_ERROR, SELECT_CLASS } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABEL, todayISO, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];

export function Kanban({
  projectId,
  tasks,
  categories,
  people,
  canCreate,
  onOpen,
  onChanged,
}: {
  projectId: string;
  tasks: Task[];
  categories: Category[];
  people: Person[];
  canCreate: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const category = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const today = todayISO();

  const visible = tasks.filter(
    (t) => (!filterAssignee || t.assignee_id === filterAssignee) && (!filterCategory || t.category_id === filterCategory),
  );

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

  async function move(id: string, status: TaskStatus) {
    const current = tasks.find((t) => t.id === id);
    if (!current || current.status === status) return;
    const max = Math.max(0, ...tasks.filter((t) => t.status === status).map((t) => t.position));
    const { error } = await getSupabase().from("tasks").update({ status, position: max + 1 }).eq("id", id);
    if (error) setError(error.message);
    onChanged();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <form onSubmit={add} className="flex min-w-64 flex-1 gap-2">
            <Input placeholder="Nova tarefa" required value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit">Adicionar</Button>
          </form>
        )}
        <select aria-label="Filtrar por responsável" className={SELECT_CLASS} value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select aria-label="Filtrar por escopo" className={SELECT_CLASS} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">Todos os escopos</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((status) => {
          const items = visible.filter((t) => t.status === status);
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABEL[status]}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) move(dragId, status);
                setDragId(null);
              }}
              className="glass-coluna flex min-h-40 flex-col gap-2.5 p-3.5"
            >
              <h3 className="flex items-center gap-2 px-1 pb-1">
                <span className={cn("size-2 rounded-full", TASK_STATUS_DOT[status])} />
                {TASK_STATUS_LABEL[status]}
                <span className="num ml-auto text-sm font-normal text-muted-foreground">{items.length}</span>
              </h3>
              <ul className="flex flex-col gap-2.5">
                {items.map((t) => {
                  const cat = t.category_id ? category.get(t.category_id) : undefined;
                  const overdue = !!t.due_date && status !== "done" && t.due_date < today;
                  const assignee = t.assignee_id ? nameOf.get(t.assignee_id) : undefined;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={() => setDragId(t.id)}
                        onClick={() => onOpen(t.id)}
                        className="surface-card flex w-full flex-col gap-2.5 p-4 text-left outline-offset-2 transition-colors duration-150 hover:bg-accent"
                      >
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
                      </button>
                    </li>
                  );
                })}
              </ul>
              {items.length === 0 && <p className="px-1 text-[0.8125rem] text-muted-foreground">Nenhuma tarefa aqui.</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
