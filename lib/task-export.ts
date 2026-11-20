// Exportação de tarefas: CSV e XLSX (mesmo formato do modelo de importação), Markdown, DOCX, PDF, HTML,
// TXT (via modelo de documento) e BPMN (cronograma por escopo).
import type { BpmnProcess } from "@/lib/files/bpmn";
import type { Block, DocModel, SheetModel } from "@/lib/files/write";
import { brDate, brDateFromTs } from "@/lib/format";
import { CHECKLIST_SEPARATOR, TEMPLATE_HEADERS } from "@/lib/task-csv";
import { TASK_STATUS_LABEL, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";

export interface ExportItem {
  text: string;
  done: boolean;
}
export type ChecklistByTask = Map<string, ExportItem[]>;
// concluded_at (timestamptz) por tarefa, lido do banco na hora da exportação.
export type ConcludedByTask = Map<string, string>;

interface Ctx {
  tasks: Task[];
  categories: Category[];
  people: Person[];
  checklists: ChecklistByTask;
  concluded: ConcludedByTask;
}

export const CONCLUDED_HEADER = "Conclusão";

// Só tarefas em Feito têm data de conclusão (o gatilho do banco limpa o campo quando a tarefa é reaberta).
const concludedOn = (ctx: Ctx, t: Task) => {
  const ts = t.status === "done" ? ctx.concluded.get(t.id) : undefined;
  return ts ? brDateFromTs(ts) : "";
};

const STATUS_ORDER: TaskStatus[] = ["todo", "doing", "done", "cancelled"];

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
  // "Conclusão" entra depois de "Prazo"; a importação localiza as colunas pelo nome e ignora esta.
  const headers = Object.values(TEMPLATE_HEADERS);
  headers.splice(headers.indexOf(TEMPLATE_HEADERS.due_date) + 1, 0, CONCLUDED_HEADER);
  const header = headers.map(csvCell).join(";");
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
      concludedOn(ctx, t),
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
        [CONCLUDED_HEADER, concludedOn(ctx, t) || undefined],
      ];
      for (const [k, v] of meta) if (v) out.push(`- **${k}:** ${v}`);
      if (t.description?.trim()) out.push("", t.description.trim());
      const items = ctx.checklists.get(t.id) ?? [];
      if (items.length > 0) out.push("", ...items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`));
    }
  }
  return `${out.join("\n")}\n`;
}

// Mesmo conteúdo do Markdown, no modelo de documento usado para DOCX, PDF, HTML e TXT (lib/files/write.ts).
export function tasksToDoc(ctx: Ctx, title: string, subtitle?: string): DocModel {
  const { cat, who } = lookups(ctx);
  const blocks: Block[] = [{ t: "p", text: `${ctx.tasks.length} tarefa(s).` }];
  for (const status of STATUS_ORDER) {
    const group = sorted(ctx.tasks).filter((t) => t.status === status);
    if (group.length === 0) continue;
    blocks.push({ t: "h", level: 1, text: `${TASK_STATUS_LABEL[status]} (${group.length})` });
    for (const t of group) {
      blocks.push({ t: "h", level: 2, text: t.title.replace(/\s+/g, " ") });
      const meta: [string, string | undefined][] = [
        ["Escopo", t.category_id ? cat.get(t.category_id) : undefined],
        ["Responsável", t.assignee_id ? who.get(t.assignee_id) : undefined],
        ["Responsável no Cliente", t.client_owner?.trim() || undefined],
        ["Início", t.start_date ? brDate(t.start_date) : undefined],
        ["Prazo", t.due_date ? brDate(t.due_date) : undefined],
        [CONCLUDED_HEADER, concludedOn(ctx, t) || undefined],
      ];
      const items = meta.filter((m): m is [string, string] => Boolean(m[1]));
      if (items.length) blocks.push({ t: "meta", items });
      if (t.description?.trim()) blocks.push({ t: "p", text: t.description.trim() });
      const list = ctx.checklists.get(t.id) ?? [];
      if (list.length) blocks.push({ t: "list", items: list.map((i) => ({ text: i.text, done: i.done })) });
    }
  }
  return { title, subtitle, blocks };
}

const isoToUtcDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Planilha: mesmas colunas do CSV, com datas como data (filtráveis no Excel) e checklist com [x]/[ ].
export function tasksToSheet(ctx: Ctx): SheetModel {
  const { cat, who } = lookups(ctx);
  const columns = Object.values(TEMPLATE_HEADERS);
  columns.splice(columns.indexOf(TEMPLATE_HEADERS.due_date) + 1, 0, CONCLUDED_HEADER);
  const rows = sorted(ctx.tasks).map((t) => {
    const concluded = t.status === "done" ? ctx.concluded.get(t.id) : undefined;
    return [
      t.title,
      t.description ?? "",
      TASK_STATUS_LABEL[t.status],
      t.category_id ? (cat.get(t.category_id) ?? "") : "",
      t.assignee_id ? (who.get(t.assignee_id) ?? "") : "",
      t.client_owner ?? "",
      t.start_date ? isoToUtcDate(t.start_date) : null,
      t.due_date ? isoToUtcDate(t.due_date) : null,
      // Dia da conclusão no fuso de Brasília, gravado como data.
      concluded ? isoToUtcDate(new Date(concluded).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })) : null,
      (ctx.checklists.get(t.id) ?? []).map((i) => i.text.replaceAll(CHECKLIST_SEPARATOR, "/")).join(` ${CHECKLIST_SEPARATOR} `),
    ];
  });
  return { name: "Tarefas", columns, rows };
}

// Cronograma em BPMN: uma raia por escopo (mais "Sem escopo"), tarefas em sequência por início/prazo
// dentro de cada raia, do início ao fim do projeto. Serve para abrir e ajustar no Camunda ou no Bizagi.
export function tasksToBpmn(ctx: Ctx, title: string): BpmnProcess {
  const { cat } = lookups(ctx);
  const NO_SCOPE = "Sem escopo";
  const key = (t: Task) => t.start_date ?? t.due_date ?? "9999-12-31";
  const byLane = new Map<string, Task[]>();
  for (const c of ctx.categories) byLane.set(c.name, []);
  for (const t of ctx.tasks) {
    const lane = (t.category_id && cat.get(t.category_id)) || NO_SCOPE;
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane)!.push(t);
  }
  const lanes = [...byLane].filter(([, list]) => list.length > 0);
  const elementos: BpmnProcess["elementos"] = [];
  const fluxos: BpmnProcess["fluxos"] = [];
  const firstLane = lanes[0]?.[0] ?? NO_SCOPE;
  elementos.push({ id: "inicio", tipo: "inicio", nome: "Início do projeto", raia: firstLane });
  const lastOfLane: string[] = [];
  for (const [lane, list] of lanes) {
    const ordered = [...list].sort((a, b) => key(a).localeCompare(key(b)) || a.position - b.position);
    let prev = "inicio";
    for (const t of ordered) {
      const id = `t_${t.id.replace(/-/g, "")}`;
      const when = t.due_date ? ` (até ${brDate(t.due_date)})` : "";
      elementos.push({ id, tipo: "tarefa", nome: `${t.title.replace(/\s+/g, " ").slice(0, 120)}${when}`, raia: lane });
      fluxos.push({ de: prev, para: id });
      prev = id;
    }
    lastOfLane.push(prev);
  }
  const lastLane = lanes[lanes.length - 1]?.[0] ?? NO_SCOPE;
  if (lastOfLane.length > 1) {
    elementos.push({ id: "juncao", tipo: "paralelo", nome: "", raia: lastLane });
    for (const id of lastOfLane) fluxos.push({ de: id, para: "juncao" });
    elementos.push({ id: "fim", tipo: "fim", nome: "Projeto concluído", raia: lastLane });
    fluxos.push({ de: "juncao", para: "fim" });
  } else {
    elementos.push({ id: "fim", tipo: "fim", nome: "Projeto concluído", raia: lastLane });
    fluxos.push({ de: lastOfLane[0] ?? "inicio", para: "fim" });
  }
  // Mais de uma raia: as sequências começam em paralelo.
  if (lanes.length > 1) {
    elementos.splice(1, 0, { id: "divisao", tipo: "paralelo", nome: "", raia: firstLane });
    for (const f of fluxos) if (f.de === "inicio") f.de = "divisao";
    fluxos.unshift({ de: "inicio", para: "divisao" });
  }
  return { nome: title, raias: lanes.map(([l]) => l), elementos, fluxos };
}

export function downloadText(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
