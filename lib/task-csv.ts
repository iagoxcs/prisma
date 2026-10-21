// Importação de tarefas por CSV: leitura do arquivo, mapeamento de colunas e validação.
// Só o título é obrigatório; os demais campos, quando inválidos ou não encontrados,
// ficam em branco e geram um aviso (a linha é importada mesmo assim).
import type { Category, Person, TaskStatus } from "@/types/domain";

export type TaskField = "title" | "description" | "status" | "category" | "assignee" | "client_owner" | "start_date" | "due_date" | "checklist";

// Cabeçalho do modelo, na ordem em que é baixado.
export const TEMPLATE_HEADERS: Record<TaskField, string> = {
  title: "Título",
  description: "Descrição",
  status: "Status",
  category: "Escopo",
  assignee: "Responsável",
  client_owner: "Responsável no Cliente",
  start_date: "Início",
  due_date: "Prazo",
  checklist: "Checklist",
};

// Nomes aceitos por coluna (comparados sem acento, sem caixa e sem espaços extras).
const ALIASES: Record<TaskField, string[]> = {
  title: ["titulo", "title", "tarefa", "nome", "nome da tarefa"],
  description: ["descricao", "description", "detalhes", "observacao", "observacoes"],
  status: ["status", "situacao", "etapa"],
  category: ["escopo", "categoria", "category", "category_id"],
  assignee: ["responsavel", "assignee", "assignee_id", "atribuido a"],
  client_owner: ["responsavel no cliente", "responsavel cliente", "client_owner", "contato no cliente"],
  start_date: ["inicio", "data de inicio", "data inicio", "start_date", "start"],
  due_date: ["prazo", "data de entrega", "entrega", "vencimento", "fim", "termino", "due_date", "due"],
  checklist: ["checklist", "itens", "subtarefas"],
};

const STATUS_ALIASES: Record<string, TaskStatus> = {
  "a fazer": "todo",
  afazer: "todo",
  todo: "todo",
  pendente: "todo",
  "nao iniciada": "todo",
  "nao iniciado": "todo",
  fazendo: "doing",
  doing: "doing",
  "em andamento": "doing",
  "em execucao": "doing",
  feito: "done",
  feita: "done",
  done: "done",
  concluido: "done",
  concluida: "done",
};

// Separador dos itens de checklist dentro da célula.
export const CHECKLIST_SEPARATOR = "|";

export interface ParsedTask {
  line: number; // linha no arquivo (1 = cabeçalho)
  title: string;
  description: string | null;
  status: TaskStatus;
  category_id: string | null;
  new_category: string | null; // escopo citado que ainda não existe no projeto
  assignee_id: string | null;
  client_owner: string | null;
  start_date: string | null;
  due_date: string | null;
  checklist: string[];
}

export interface ImportPreview {
  tasks: ParsedTask[];
  skipped: { line: number; reason: string }[];
  warnings: { line: number; message: string }[];
  unknownColumns: string[];
  newCategories: string[];
}

export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Excel em pt-BR salva com ";"; outros programas com ",". Escolhe o que aparece mais no cabeçalho.
function detectDelimiter(text: string): string {
  const header = text.slice(0, text.search(/\r?\n|$/));
  const counts = [";", ",", "\t"].map((d) => [d, header.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

// Parser RFC 4180: aspas duplas, "" como aspas escapadas e quebras de linha dentro de células.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// Aceita AAAA-MM-DD e DD/MM/AAAA (ou DD-MM-AAAA, DD.MM.AAAA, ano com 2 dígitos). Devolve AAAA-MM-DD ou null.
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?: .*)?$/);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function buildPreview(text: string, categories: Category[], people: Person[]): ImportPreview {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const preview: ImportPreview = { tasks: [], skipped: [], warnings: [], unknownColumns: [], newCategories: [] };
  if (rows.length === 0) return preview;

  const [header, ...body] = rows;
  const columns = new Map<TaskField, number>();
  header.forEach((h, i) => {
    const key = normalize(h);
    const field = (Object.keys(ALIASES) as TaskField[]).find((f) => ALIASES[f].includes(key));
    if (field && !columns.has(field)) columns.set(field, i);
    else if (key) preview.unknownColumns.push(h.trim());
  });
  if (!columns.has("title")) {
    preview.skipped.push({ line: 1, reason: 'Coluna "Título" não encontrada no cabeçalho.' });
    return preview;
  }

  const categoryByName = new Map(categories.map((c) => [normalize(c.name), c.id]));
  const newCategories = new Map<string, string>(); // normalizado → nome como escrito
  const personByName = new Map<string, string | null>(); // null = nome ambíguo
  for (const p of people) {
    const key = normalize(p.name);
    personByName.set(key, personByName.has(key) ? null : p.id);
  }

  body.forEach((row, idx) => {
    const line = idx + 2;
    const get = (f: TaskField) => {
      const i = columns.get(f);
      return i === undefined ? "" : (row[i] ?? "").trim();
    };
    const warn = (message: string) => preview.warnings.push({ line, message });

    const title = get("title");
    if (!title) {
      preview.skipped.push({ line, reason: "Título em branco." });
      return;
    }

    let status: TaskStatus = "todo";
    const rawStatus = get("status");
    if (rawStatus) {
      const hit = STATUS_ALIASES[normalize(rawStatus)];
      if (hit) status = hit;
      else warn(`Status "${rawStatus}" não reconhecido; a tarefa entra em A Fazer.`);
    }

    let category_id: string | null = null;
    let new_category: string | null = null;
    const rawCategory = get("category");
    if (rawCategory) {
      const key = normalize(rawCategory);
      category_id = categoryByName.get(key) ?? null;
      if (!category_id) {
        if (!newCategories.has(key)) newCategories.set(key, rawCategory);
        new_category = newCategories.get(key)!;
      }
    }

    let assignee_id: string | null = null;
    const rawAssignee = get("assignee");
    if (rawAssignee) {
      const key = normalize(rawAssignee);
      const hit = personByName.get(key);
      if (hit) assignee_id = hit;
      else if (hit === null) warn(`Mais de um membro se chama "${rawAssignee}"; a tarefa fica sem responsável.`);
      else warn(`"${rawAssignee}" não é membro do projeto; a tarefa fica sem responsável.`);
    }

    const date = (f: "start_date" | "due_date", label: string) => {
      const raw = get(f);
      if (!raw) return null;
      const iso = parseDate(raw);
      if (!iso) warn(`${label} "${raw}" não é uma data válida (use DD/MM/AAAA); campo ignorado.`);
      return iso;
    };
    const start_date = date("start_date", "Início");
    let due_date = date("due_date", "Prazo");
    if (start_date && due_date && due_date < start_date) {
      warn("Prazo anterior ao início; prazo ignorado.");
      due_date = null;
    }

    const checklist = get("checklist")
      .split(CHECKLIST_SEPARATOR)
      .map((s) => s.trim())
      .filter(Boolean);

    preview.tasks.push({
      line,
      title,
      description: get("description") || null,
      status,
      category_id,
      new_category,
      assignee_id,
      client_owner: get("client_owner") || null,
      start_date,
      due_date,
      checklist,
    });
  });

  preview.newCategories = [...newCategories.values()];
  return preview;
}

// Modelo para download: cabeçalho + uma linha de exemplo, separado por ";" (abre direto no Excel pt-BR).
export function templateCsv(): string {
  const header = Object.values(TEMPLATE_HEADERS).join(";");
  const example = [
    "Levantar processos atuais",
    "Entrevistar os Líderes de cada área",
    "A Fazer",
    "Diagnóstico",
    "",
    "Maria (RH do cliente)",
    "01/11/2026",
    "15/11/2026",
    "Agendar entrevistas | Consolidar anotações",
  ].join(";");
  return `﻿${header}\r\n${example}\r\n`;
}

// CSV do Excel em pt-BR costuma vir em Windows-1252; se o UTF-8 trouxer caracteres inválidos, relê nessa codificação.
export async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
}

export interface TemplatePhases {
  phases: { name: string; tasks: number }[];
  tasks: number;
  errors: string[];
}

// Planilha de modelo de projeto (Base de Conhecimento): mesmo formato da importação, com a coluna
// Escopo obrigatória, porque cada escopo é uma fase do modelo. Devolve as fases na ordem do arquivo.
export function templatePhases(text: string): TemplatePhases {
  const preview = buildPreview(text, [], []);
  const errors: string[] = [];
  const counts = new Map<string, number>();
  let withoutPhase = 0;
  for (const t of preview.tasks) {
    if (!t.new_category) withoutPhase++;
    else counts.set(t.new_category, (counts.get(t.new_category) ?? 0) + 1);
  }
  if (preview.tasks.length === 0) errors.push("A planilha não tem nenhuma tarefa com Título.");
  if (withoutPhase > 0) errors.push(`${withoutPhase} tarefa(s) sem Escopo. Cada tarefa precisa indicar a fase na coluna ${TEMPLATE_HEADERS.category}.`);
  return { phases: [...counts].map(([name, tasks]) => ({ name, tasks })), tasks: preview.tasks.length, errors };
}
