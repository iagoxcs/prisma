"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABEL, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";
import { TaskPanel } from "./task-panel";

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];
const TASK_COLS = "id, project_id, category_id, title, description, status, assignee_id, start_date, due_date, position";

export function Kanban({
  projectId,
  categories,
  people,
  canCreate,
  isExternal,
}: {
  projectId: string;
  categories: Category[];
  people: Person[];
  canCreate: boolean;
  isExternal: boolean;
}) {
  const tasks = useQuery<Task[]>(
    () => getSupabase().from("tasks").select(TASK_COLS).eq("project_id", projectId).order("position"),
    [projectId],
  );
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  // Tempo real: qualquer mudança em tarefas do projeto recarrega o quadro.
  const reload = tasks.reload;
  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`tasks-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, reload]);

  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const category = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const visible = (tasks.data ?? []).filter(
    (t) => (!filterAssignee || t.assignee_id === filterAssignee) && (!filterCategory || t.category_id === filterCategory),
  );

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const max = Math.max(0, ...(tasks.data ?? []).filter((t) => t.status === "todo").map((t) => t.position));
    const { error } = await getSupabase()
      .from("tasks")
      .insert({ project_id: projectId, title: title.trim(), position: max + 1 });
    if (error) return setError(error.message);
    setTitle("");
    tasks.reload();
  }

  async function move(id: string, status: TaskStatus) {
    const current = (tasks.data ?? []).find((t) => t.id === id);
    if (!current || current.status === status) return;
    const max = Math.max(0, ...(tasks.data ?? []).filter((t) => t.status === status).map((t) => t.position));
    const { error } = await getSupabase().from("tasks").update({ status, position: max + 1 }).eq("id", id);
    if (error) setError(error.message);
    tasks.reload();
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
      {(error || tasks.error) && <p role="alert" className="text-sm text-destructive">{error ?? tasks.error}</p>}

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
                  const overdue = t.due_date && status !== "done" && t.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={() => setDragId(t.id)}
                        onClick={() => setOpenId(t.id)}
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

      {openId && (
        <TaskPanel
          taskId={openId}
          task={(tasks.data ?? []).find((t) => t.id === openId)}
          categories={categories}
          people={people}
          isExternal={isExternal}
          onClose={() => setOpenId(null)}
          onChanged={tasks.reload}
        />
      )}
    </div>
  );
}
