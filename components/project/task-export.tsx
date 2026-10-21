"use client";

import { useState } from "react";
import { FileText, Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase/client";
import { downloadText, tasksToCsv, tasksToMarkdown, type ChecklistByTask } from "@/lib/task-export";
import { MSG_ERROR } from "@/lib/ui";
import type { Category, Person, Task } from "@/types/domain";

const CHUNK = 150; // ids por consulta (limite de tamanho da URL)

// Aba "Exportar" do diálogo de importação/exportação.
export function TaskExport({
  tasks,
  filtered,
  filtering,
  categories,
  people,
}: {
  tasks: Task[];
  filtered: Task[];
  filtering: boolean;
  categories: Category[];
  people: Person[];
}) {
  const [onlyFiltered, setOnlyFiltered] = useState(filtering);
  const [busy, setBusy] = useState<"csv" | "md" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = onlyFiltered ? filtered : tasks;

  async function run(kind: "csv" | "md") {
    setBusy(kind);
    setError(null);
    const checklists: ChecklistByTask = new Map();
    const supabase = getSupabase();
    for (let i = 0; i < selected.length; i += CHUNK) {
      const ids = selected.slice(i, i + CHUNK).map((t) => t.id);
      const { data, error } = await supabase.from("checklist_items").select("task_id, text, done, position").in("task_id", ids).order("position");
      if (error) {
        setBusy(null);
        return setError(`Não foi possível ler os checklists: ${error.message}`);
      }
      for (const row of data ?? []) {
        const list = checklists.get(row.task_id) ?? [];
        list.push({ text: row.text, done: row.done });
        checklists.set(row.task_id, list);
      }
    }
    const ctx = { tasks: selected, categories, people, checklists };
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "csv") downloadText(tasksToCsv(ctx), `tarefas-${stamp}.csv`, "text/csv");
    else downloadText(tasksToMarkdown(ctx, "Tarefas do projeto"), `tarefas-${stamp}.md`, "text/markdown");
    setBusy(null);
  }

  return (
    <div className="space-y-5 text-sm">
      <p>
        Baixe as tarefas do projeto com título, descrição, status, escopo, responsável, datas e checklist. O CSV usa o mesmo formato da
        importação (abre no Excel e pode ser reimportado); o Markdown é um documento legível, agrupado por status.
      </p>
      {filtering && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={onlyFiltered} onChange={(e) => setOnlyFiltered(e.target.checked)} />
          Exportar só as tarefas filtradas no quadro
        </label>
      )}
      <p className="num text-[0.8125rem] text-muted-foreground">{selected.length} tarefa(s) serão exportadas.</p>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy !== null || selected.length === 0} onClick={() => run("csv")}>
          <Table strokeWidth={1.75} aria-hidden /> {busy === "csv" ? "Gerando…" : "Exportar CSV"}
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null || selected.length === 0} onClick={() => run("md")}>
          <FileText strokeWidth={1.75} aria-hidden /> {busy === "md" ? "Gerando…" : "Exportar Markdown (.md)"}
        </Button>
      </div>
    </div>
  );
}
