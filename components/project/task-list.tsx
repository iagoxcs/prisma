"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Input } from "@/components/ui/input";
import { shortDate } from "@/lib/format";
import { categoryColor, OVERDUE_BADGE, TASK_STATUS_DOT } from "@/lib/theme/status";
import { SELECT_CLASS } from "@/lib/ui";
import { usePageSize } from "@/lib/use-page-size";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABEL, todayISO, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";
import { Select } from "@/components/ui/select";

type SortKey = "title" | "category" | "status" | "assignee" | "start" | "due";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Tarefa" },
  { key: "category", label: "Escopo" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Responsável" },
  { key: "start", label: "Início" },
  { key: "due", label: "Prazo" },
];
const STATUS_ORDER: Record<TaskStatus, number> = { todo: 0, doing: 1, done: 2 };
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

// Visão em tabela das mesmas tarefas do Quadro: ordena, filtra e pagina no cliente (sem nova consulta).
export function TaskList({
  tasks,
  categories,
  people,
  onOpen,
}: {
  tasks: Task[];
  categories: Category[];
  people: Person[];
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [sort, setSort] = useState<Sort>({ key: "due", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("project-tasks");

  const cats = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const today = todayISO();

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const filtered = tasks.filter(
      (t) =>
        (!term || t.title.toLocaleLowerCase("pt-BR").includes(term)) &&
        (!assignee || t.assignee_id === assignee) &&
        (!category || t.category_id === category) &&
        (!status || t.status === status),
    );
    const value = (t: Task): string | number | null => {
      switch (sort.key) {
        case "title": return t.title;
        case "category": return t.category_id ? (cats.get(t.category_id)?.name ?? null) : null;
        case "status": return STATUS_ORDER[t.status];
        case "assignee": return t.assignee_id ? (names.get(t.assignee_id) ?? null) : null;
        case "start": return t.start_date;
        case "due": return t.due_date;
      }
    };
    const sign = sort.dir === "asc" ? 1 : -1;
    // Vazios sempre por último, nas duas direções.
    return filtered.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      const diff = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
      return diff * sign || a.position - b.position;
    });
  }, [tasks, search, assignee, category, status, sort, cats, names]);

  // Realtime pode encolher a lista: a página nunca passa da última.
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);

  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar tarefa por título"
          placeholder="Buscar tarefa"
          className="min-w-56 flex-1"
          value={search}
          onChange={(e) => filter(setSearch)(e.target.value)}
        />
        <Select aria-label="Filtrar por responsável" className={SELECT_CLASS} value={assignee} onChange={(e) => filter(setAssignee)(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select aria-label="Filtrar por escopo" className={SELECT_CLASS} value={category} onChange={(e) => filter(setCategory)(e.target.value)}>
          <option value="">Todos os escopos</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select
          aria-label="Filtrar por status"
          className={SELECT_CLASS}
          value={status}
          onChange={(e) => filter(setStatus)(e.target.value as TaskStatus | "")}
        >
          <option value="">Todos os status</option>
          {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
          ))}
        </Select>
      </div>

      {rows.length === 0 ? (
        <p className="surface-card px-4 py-6 text-sm text-muted-foreground">Nenhuma tarefa com esses filtros.</p>
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead>
              <tr className="border-b">
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      className="px-2 text-sm font-medium text-muted-foreground first:pl-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {c.label}
                        {active && <Icon className="size-4" strokeWidth={1.75} aria-hidden />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const cat = t.category_id ? cats.get(t.category_id) : undefined;
                const overdue = t.status !== "done" && !!t.due_date && t.due_date < today;
                return (
                  <tr key={t.id} className="h-13 border-b last:border-b-0">
                    <td className="px-2">
                      <button
                        type="button"
                        onClick={() => onOpen(t.id)}
                        className="min-h-11 rounded-md px-2 text-left font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {t.title}
                      </button>
                    </td>
                    <td className="px-4">
                      {cat ? (
                        <span className="flex items-center gap-2">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(cat.color) }} aria-hidden />
                          {cat.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4">
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className={cn("size-2 shrink-0 rounded-full", TASK_STATUS_DOT[t.status])} aria-hidden />
                        {TASK_STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-4">{t.assignee_id ? (names.get(t.assignee_id) ?? "—") : <span className="text-muted-foreground">—</span>}</td>
                    <td className="num px-4 whitespace-nowrap">{t.start_date ? shortDate(t.start_date) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 whitespace-nowrap">
                      {!t.due_date ? (
                        <span className="text-muted-foreground">—</span>
                      ) : overdue ? (
                        <span className={cn("num rounded-md px-2.5 py-0.5 text-xs", OVERDUE_BADGE)}>vencida {shortDate(t.due_date)}</span>
                      ) : (
                        <span className="num">{shortDate(t.due_date)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={current} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
