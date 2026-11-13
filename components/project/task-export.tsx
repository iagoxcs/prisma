"use client";

import { useState } from "react";
import { FileCode, FileSpreadsheet, FileText, Workflow, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase/client";
import {
  downloadText,
  tasksToBpmn,
  tasksToCsv,
  tasksToDoc,
  tasksToMarkdown,
  tasksToSheet,
  type ChecklistByTask,
  type ConcludedByTask,
} from "@/lib/task-export";
import { MSG_ERROR } from "@/lib/ui";
import type { Category, Person, Task } from "@/types/domain";

const CHUNK = 150; // ids por consulta (limite de tamanho da URL)

type Format = "xlsx" | "csv" | "docx" | "pdf" | "md" | "html" | "txt" | "bpmn";

const FORMATS: { id: Format; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "xlsx", label: "Excel (.xlsx)", icon: FileSpreadsheet, hint: "Planilha com filtro e datas; pode ser reimportada." },
  { id: "csv", label: "CSV", icon: FileSpreadsheet, hint: "Mesmo formato da importação." },
  { id: "docx", label: "Word (.docx)", icon: FileText, hint: "Documento agrupado por status." },
  { id: "pdf", label: "PDF", icon: FileText, hint: "Pronto para imprimir ou enviar." },
  { id: "md", label: "Markdown (.md)", icon: FileText, hint: "Texto estruturado." },
  { id: "html", label: "HTML", icon: FileCode, hint: "Página única, abre no navegador." },
  { id: "txt", label: "Texto (.txt)", icon: FileText, hint: "Texto simples." },
  { id: "bpmn", label: "BPMN", icon: Workflow, hint: "Cronograma com uma raia por escopo (Camunda, Bizagi)." },
];

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "projeto";

// Aba "Exportar" do diálogo de importação/exportação.
export function TaskExport({
  projectId,
  tasks,
  filtered,
  filtering,
  categories,
  people,
}: {
  projectId: string;
  tasks: Task[];
  filtered: Task[];
  filtering: boolean;
  categories: Category[];
  people: Person[];
}) {
  const [onlyFiltered, setOnlyFiltered] = useState(filtering);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = onlyFiltered ? filtered : tasks;

  async function run(kind: Format) {
    setBusy(kind);
    setError(null);
    try {
      const checklists: ChecklistByTask = new Map();
      const concluded: ConcludedByTask = new Map();
      const supabase = getSupabase();
      const project = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
      for (let i = 0; i < selected.length; i += CHUNK) {
        const ids = selected.slice(i, i + CHUNK).map((t) => t.id);
        // A data de conclusão é lida na hora: o quadro tem o status, mas não o concluded_at gravado pelo gatilho do banco.
        const [items, done] = await Promise.all([
          supabase.from("checklist_items").select("task_id, text, done, position").in("task_id", ids).order("position"),
          supabase.from("tasks").select("id, concluded_at").in("id", ids).not("concluded_at", "is", null),
        ]);
        if (items.error || done.error) throw new Error(`Não foi possível ler as tarefas: ${(items.error ?? done.error)?.message}`);
        for (const row of done.data ?? []) if (row.concluded_at) concluded.set(row.id, row.concluded_at);
        for (const row of items.data ?? []) {
          const list = checklists.get(row.task_id) ?? [];
          list.push({ text: row.text, done: row.done });
          checklists.set(row.task_id, list);
        }
      }
      const ctx = { tasks: selected, categories, people, checklists, concluded };
      const name = project.data?.name ?? "Projeto";
      const title = `Tarefas — ${name}`;
      const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      const subtitle = `Exportado em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${onlyFiltered && filtering ? " · tarefas filtradas" : ""}`;
      const file = `tarefas-${slug(name)}-${stamp}`;
      const w = await import("@/lib/files/write");
      switch (kind) {
        case "csv":
          downloadText(tasksToCsv(ctx), `${file}.csv`, "text/csv");
          break;
        case "md":
          downloadText(tasksToMarkdown(ctx, title), `${file}.md`, "text/markdown");
          break;
        case "xlsx":
          w.downloadBlob(await w.toXlsx([tasksToSheet(ctx)]), `${file}.xlsx`);
          break;
        case "docx":
          w.downloadBlob(await w.toDocx(tasksToDoc(ctx, title, subtitle)), `${file}.docx`);
          break;
        case "pdf":
          w.downloadBlob(await w.toPdf(tasksToDoc(ctx, title, subtitle)), `${file}.pdf`);
          break;
        case "html":
          downloadText(w.toHtml(tasksToDoc(ctx, title, subtitle)), `${file}.html`, "text/html");
          break;
        case "txt":
          downloadText(w.toTxt(tasksToDoc(ctx, title, subtitle)), `${file}.txt`, "text/plain");
          break;
        case "bpmn": {
          const { buildBpmn } = await import("@/lib/files/bpmn");
          downloadText(buildBpmn(tasksToBpmn(ctx, `Cronograma — ${name}`)), `${file}.bpmn`, "application/xml");
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("Não foi possível") ? e.message : "Não foi possível gerar o arquivo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 text-sm">
      <p>
        Baixe as tarefas do projeto com título, descrição, status, escopo, responsável, datas (inclusive a de conclusão das tarefas feitas) e
        checklist. Excel e CSV usam o mesmo formato da importação; os documentos saem agrupados por status.
      </p>
      {filtering && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={onlyFiltered} onChange={(e) => setOnlyFiltered(e.target.checked)} />
          Exportar só as tarefas filtradas no quadro
        </label>
      )}
      <p className="num text-[0.8125rem] text-muted-foreground">{selected.length} tarefa(s) serão exportadas.</p>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {FORMATS.map(({ id, label, icon: Icon, hint }) => (
          <li key={id}>
            <Button
              type="button"
              variant={id === "xlsx" ? "default" : "outline"}
              className="h-auto min-h-11 w-full justify-start py-2 text-left whitespace-normal"
              disabled={busy !== null || selected.length === 0}
              onClick={() => run(id)}
            >
              <Icon strokeWidth={1.75} aria-hidden />
              <span className="flex flex-col">
                <span>{busy === id ? "Gerando…" : label}</span>
                <span className="text-xs font-normal opacity-80">{hint}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
