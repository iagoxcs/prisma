"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate && (
          <form onSubmit={add} className="flex min-w-64 flex-1 gap-2">
            <Input placeholder="Nova tarefa" required value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit">Adicionar</Button>
          </form>
        )}
        <select aria-label="Filtrar por responsável" className="h-8 rounded-lg border bg-background px-2 text-sm" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select aria-label="Filtrar por escopo" className="h-8 rounded-lg border bg-background px-2 text-sm" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">Todos os escopos</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((status) => {
          const items = visible.filter((t) => t.status === status);
          return (
            <section
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) move(dragId, status);
                setDragId(null);
              }}
              className="min-h-40 rounded-lg border bg-muted/40 p-3"
            >
              <h3 className="mb-3 flex items-center justify-between text-sm font-medium">
                {TASK_STATUS_LABEL[status]}
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </h3>
              <ul className="space-y-2">
                {items.map((t) => {
                  const cat = t.category_id ? category.get(t.category_id) : undefined;
                  const overdue = t.due_date && status !== "done" && t.due_date < todayISO();
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={() => setDragId(t.id)}
                        onClick={() => onOpen(t.id)}
                        className="w-full rounded-lg border bg-background p-3 text-left text-sm shadow-xs hover:border-ring"
                      >
                        {cat && (
                          <span className="mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: cat.color }}>
                            {cat.name}
                          </span>
                        )}
                        <div className="font-medium">{t.title}</div>
                        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                          <span>{t.assignee_id ? nameOf.get(t.assignee_id) ?? "—" : "Sem responsável"}</span>
                          {t.due_date && <span className={cn(overdue && "font-medium text-destructive")}>{t.due_date.split("-").reverse().join("/")}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
