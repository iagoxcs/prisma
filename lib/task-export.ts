// Exportação de tarefas em CSV (mesmo formato do modelo de importação) e em Markdown.
import { brDate } from "@/lib/format";
import { CHECKLIST_SEPARATOR, TEMPLATE_HEADERS } from "@/lib/task-csv";
import { TASK_STATUS_LABEL, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";

export interface ExportItem {
  text: string;
  done: boolean;
}
export type ChecklistByTask = Map<string, ExportItem[]>;

interface Ctx {
  tasks: Task[];
  categories: Category[];
  people: Person[];
  checklists: ChecklistByTask;
}

const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "done"];

const sorted = (tasks: Task[]) =>
  [...tasks].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.position - b.position);

const lookups = ({ categories, people }: Ctx) => ({
  cat: new Map(categories.map((c) => [c.id, c.name])),
  who: new Map(people.map((p) => [p.id, p.name])),
});

const csvCell = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Separado por ";" e com BOM: abre direto no Excel pt-BR e pode ser reimportado.
export function tasksToCsv(ctx: Ctx): string {
  const { cat, who } = lookups(ctx);
  const header = Object.values(TEMPLATE_HEADERS).map(csvCell).join(";");
  const lines = sorted(ctx.tasks).map((t) =>
    [
      t.title,
      t.description ?? "",
      TASK_STATUS_LABEL[t.status],
      t.category_id ? (cat.get(t.category_id) ?? "") : "",
      t.assignee_id ? (who.get(t.assignee_id) ?? "") : "",
      t.client_owner ?? "",
      t.start_date ? brDate(t.start_date) : "",
      t.due_date ? brDate(t.due_date) : "",
      (ctx.checklists.get(t.id) ?? []).map((i) => i.text.replaceAll(CHECKLIST_SEPARATOR, "/")).join(` ${CHECKLIST_SEPARATOR} `),
    ]
      .map(csvCell)
      .join(";"),
  );
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}

export function tasksToMarkdown(ctx: Ctx, title: string): string {
  const { cat, who } = lookups(ctx);
  const out: string[] = [`# ${title}`, "", `${ctx.tasks.length} tarefa(s).`];
  for (const status of STATUS_ORDER) {
    const group = sorted(ctx.tasks).filter((t) => t.status === status);
    if (group.length === 0) continue;
    out.push("", `## ${TASK_STATUS_LABEL[status]} (${group.length})`);
    for (const t of group) {
      out.push("", `### ${t.title.replace(/\s+/g, " ")}`, "");
      const meta: [string, string | undefined][] = [
        ["Escopo", t.category_id ? cat.get(t.category_id) : undefined],
        ["Responsável", t.assignee_id ? who.get(t.assignee_id) : undefined],
        ["Responsável no Cliente", t.client_owner?.trim() || undefined],
        ["Início", t.start_date ? brDate(t.start_date) : undefined],
        ["Prazo", t.due_date ? brDate(t.due_date) : undefined],
      ];
      for (const [k, v] of meta) if (v) out.push(`- **${k}:** ${v}`);
      if (t.description?.trim()) out.push("", t.description.trim());
      const items = ctx.checklists.get(t.id) ?? [];
      if (items.length > 0) out.push("", ...items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`));
    }
  }
  return `${out.join("\n")}\n`;
}

export function downloadText(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
