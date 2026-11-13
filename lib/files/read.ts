// Leitura de arquivos no navegador. As bibliotecas são carregadas só quando usadas (import dinâmico).
// Nada aqui executa conteúdo do arquivo: HTML e DOCX viram HTML higienizado (sem script, sem handlers, sem
// recursos externos) para exibir em <iframe sandbox>, e o texto extraído é só texto.
import { docKind, MAX_READ_BYTES, type DocKind } from "@/lib/files/kinds";
import { bpmnSummary } from "@/lib/files/bpmn";

export interface Sheet {
  name: string;
  rows: string[][];
  truncated: boolean;
}

export interface ReadResult {
  kind: DocKind;
  text: string; // texto corrido (Markdown simples quando há estrutura)
  html?: string; // DOCX/HTML higienizado, para pré-visualização isolada
  sheets?: Sheet[]; // XLSX/CSV
  bpmnXml?: string; // BPMN, para o visualizador
  pdf?: ArrayBuffer; // PDF, para desenhar as páginas
  pages?: number;
}

export class ReadError extends Error {}

const SHEET_MAX_ROWS = 500;
const SHEET_MAX_COLS = 50;

// UTF-8; se vierem caracteres inválidos, relê como Windows-1252 (Excel e Bloco de Notas em pt-BR).
export function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
}

// --- PDF (pdf.js) ------------------------------------------------------------------------------------------

export async function loadPdfjs() {
  const lib = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerPort) {
    lib.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  }
  return lib;
}

async function pdfText(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await loadPdfjs();
  // Cópia: o pdf.js transfere o buffer para o worker e o original fica inutilizável.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  try {
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      const text = lines.join("\n").replace(/[ \t]+\n/g, "\n").trim();
      out.push(text ? `--- Página ${i} ---\n${text}` : `--- Página ${i} --- (sem texto; pode ser imagem escaneada)`);
    }
    return { text: out.join("\n\n"), pages: doc.numPages };
  } finally {
    await doc.loadingTask.destroy();
  }
}

// --- HTML ---------------------------------------------------------------------------------------------------

const DROP = "script,style,noscript,template,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,select,textarea,svg,math";

// Higieniza para exibir no iframe sandbox: sem scripts, handlers, formulários nem recursos externos.
// Estilos inline ficam (a CSP do iframe permite só 'unsafe-inline' para estilo).
export function sanitizeHtml(html: string): { title: string; body: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.title?.trim() ?? "";
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  doc.body.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "formaction" || name === "ping") el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "background") &&
        !(value.startsWith("data:image/") || value.startsWith("#") || (name === "href" && /^(https?:|mailto:)/.test(value)))) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === "A") el.setAttribute("target", "_blank");
  });
  return { title, body: doc.body.innerHTML };
}

// Cores do tema atual lidas dos tokens de app/globals.css (o iframe isolado não enxerga as variáveis CSS).
export function themeColors(): { fg: string; bg: string; line: string } {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim() || "inherit";
  return { fg: v("--popover-foreground"), bg: v("--popover"), line: v("--border") };
}

const cssValue = (s: string) => s.replace(/[;{}<>]/g, "");

// Documento completo para srcdoc, com CSP que bloqueia script, rede e navegação do quadro.
export function isolatedDocument(body: string, colors: { fg: string; bg: string; line: string }): string {
  const [fg, bg, line] = [colors.fg, colors.bg, colors.line].map(cssValue);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:${fg};background:${bg};margin:0;padding:1.25rem;line-height:1.55;font-size:15px;overflow-wrap:anywhere}
table{border-collapse:collapse;max-width:100%}td,th{border:1px solid ${line};padding:.3rem .5rem;vertical-align:top}img{max-width:100%;height:auto}a{color:inherit}</style>
</head><body>${body}</body></html>`;
}

// Texto estruturado (títulos, listas, tabelas) a partir de HTML já higienizado, via Turndown.
export async function htmlToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  td.addRule("tabela", {
    filter: ["table"],
    replacement: (_c, node) => {
      const rows = [...(node as HTMLTableElement).rows].map((r) =>
        [...r.cells].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").trim()),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return `\n\n${[line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n")}\n\n`;
    },
  });
  td.remove(["img"]);
  return td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

// --- DOCX (mammoth) -----------------------------------------------------------------------------------------

async function docxHtml(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.convertToHtml({ arrayBuffer: buffer });
  return res.value;
}

// --- XLSX (exceljs) e CSV -----------------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, "0");

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // exceljs devolve datas em UTC.
    const d = `${two(v.getUTCDate())}/${two(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    return v.getUTCHours() || v.getUTCMinutes() ? `${d} ${two(v.getUTCHours())}:${two(v.getUTCMinutes())}` : d;
  }
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string; error?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    if (o.error) return String(o.error);
    return "";
  }
  // Quebras de linha ficam (descrição de tarefa reimportada do Excel continua com parágrafos).
  return String(v).replace(/\r\n/g, "\n").trim();
}

export async function loadExcel() {
  const mod = await import("exceljs");
  return (mod as unknown as { default: typeof import("exceljs") }).default ?? mod;
}

export async function xlsxSheets(buffer: ArrayBuffer, maxRows = SHEET_MAX_ROWS): Promise<Sheet[]> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    let truncated = false;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= maxRows) {
        truncated = true;
        return;
      }
      const values = (row.values as unknown[]).slice(1, SHEET_MAX_COLS + 1).map(cellText);
      while (values.length && !values[values.length - 1]) values.pop();
      rows.push(values);
    });
    return { name: ws.name, rows, truncated };
  });
}

const sheetsToMarkdown = (sheets: Sheet[]) =>
  sheets
    .map((s) => {
      const rows = s.rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`);
      return `## Aba: ${s.name}${s.truncated ? ` (primeiras ${s.rows.length} linhas)` : ""}\n${rows.join("\n") || "(vazia)"}`;
    })
    .join("\n\n");

// --- Entrada única ------------------------------------------------------------------------------------------

export async function readDocument(blob: Blob, name: string): Promise<ReadResult> {
  const kind = docKind(name);
  if (!kind) throw new ReadError("Formato não suportado. O Prisma lê TXT, MD, CSV, PDF, DOCX, XLSX, HTML e BPMN.");
  if (blob.size > MAX_READ_BYTES) throw new ReadError("Arquivo grande demais (limite de 20 MB).");
  const buffer = await blob.arrayBuffer();
  try {
    switch (kind) {
      case "pdf": {
        const { text, pages } = await pdfText(buffer);
        return { kind, text, pdf: buffer, pages };
      }
      case "docx": {
        const { body } = sanitizeHtml(await docxHtml(buffer));
        return { kind, html: body, text: await htmlToMarkdown(body) };
      }
      case "html": {
        const { title, body } = sanitizeHtml(decodeText(buffer));
        const md = await htmlToMarkdown(body);
        return { kind, html: body, text: title && !md.startsWith("# ") ? `# ${title}\n\n${md}` : md };
      }
      case "xlsx": {
        const sheets = await xlsxSheets(buffer);
        return { kind, sheets, text: sheetsToMarkdown(sheets) };
      }
      case "csv": {
        const { parseCsv } = await import("@/lib/task-csv");
        const all = parseCsv(decodeText(buffer)).filter((r) => r.some((c) => c.trim()));
        const sheet = { name: name.replace(/\.[^.]+$/, ""), rows: all.slice(0, SHEET_MAX_ROWS), truncated: all.length > SHEET_MAX_ROWS };
        return { kind, sheets: [sheet], text: sheetsToMarkdown([sheet]) };
      }
      case "bpmn": {
        const xml = decodeText(buffer);
        return { kind, bpmnXml: xml, text: await bpmnSummary(xml) };
      }
      default:
        return { kind, text: decodeText(buffer) };
    }
  } catch (e) {
    if (e instanceof ReadError) throw e;
    const msg = e instanceof Error && /password/i.test(e.message) ? "O arquivo está protegido por senha." : "Não foi possível ler o arquivo. Ele pode estar corrompido.";
    throw new ReadError(msg);
  }
}

const csvCell = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const rowsToCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(";")).join("\r\n");

// Planilha (CSV ou XLSX) como texto CSV — a importação de tarefas e as fases de modelo trabalham sobre CSV.
// No XLSX vale a primeira aba com conteúdo; datas saem como DD/MM/AAAA.
export async function readTableAsCsv(file: File): Promise<string> {
  const kind = docKind(file.name);
  if (kind !== "xlsx" && kind !== "csv") throw new ReadError("Formato não suportado. Envie a planilha em .xlsx ou .csv.");
  if (file.size > MAX_READ_BYTES) throw new ReadError("Arquivo grande demais (limite de 20 MB).");
  const buffer = await file.arrayBuffer();
  if (kind === "csv") return decodeText(buffer);
  try {
    const sheets = await xlsxSheets(buffer, 20000);
    return rowsToCsv(sheets.find((s) => s.rows.length > 0)?.rows ?? []);
  } catch {
    throw new ReadError("Não foi possível ler a planilha. Ela pode estar corrompida ou protegida por senha.");
  }
}

// Texto de um documento para colar num campo (contexto do projeto, conteúdo da Base de Conhecimento).
export async function readAsText(file: File): Promise<string> {
  return (await readDocument(file, file.name)).text;
}
