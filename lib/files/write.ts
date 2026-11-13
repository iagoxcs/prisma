// Geração de arquivos no navegador a partir de um modelo de documento simples (títulos, parágrafos,
// listas, metadados e tabelas). Bibliotecas carregadas só na hora de gerar. Os arquivos saem sem cores
// próprias (padrões de cada formato), porque fora do site os tokens de app/globals.css não existem.

export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "meta"; items: [string, string][] }
  | { t: "list"; items: { text: string; done?: boolean }[] }
  | { t: "table"; rows: string[][] };

export interface DocModel {
  title: string;
  subtitle?: string;
  blocks: Block[];
}

export interface SheetModel {
  name: string;
  columns: string[];
  rows: (string | number | Date | null)[][];
}

const check = (done?: boolean) => (done === undefined ? "" : done ? "[x] " : "[ ] ");

// --- TXT ----------------------------------------------------------------------------------------------------

export function toTxt(doc: DocModel): string {
  const out: string[] = [doc.title, "=".repeat(doc.title.length)];
  if (doc.subtitle) out.push(doc.subtitle);
  for (const b of doc.blocks) {
    if (b.t === "h") out.push("", b.text, (b.level === 1 ? "=" : "-").repeat(b.text.length));
    else if (b.t === "p") out.push("", b.text);
    else if (b.t === "meta") out.push(...b.items.map(([k, v]) => `${k}: ${v}`));
    else if (b.t === "list") out.push("", ...b.items.map((i) => `  - ${check(i.done)}${i.text}`));
    else {
      const width = b.rows.reduce((w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)), [] as number[]);
      out.push("", ...b.rows.map((r) => r.map((c, i) => c.padEnd(width[i] ?? 0)).join("  ").trimEnd()));
    }
  }
  return `﻿${out.join("\r\n")}\r\n`;
}

// --- HTML ---------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const multiline = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

export function toHtml(doc: DocModel): string {
  const body: string[] = [`<h1>${esc(doc.title)}</h1>`];
  if (doc.subtitle) body.push(`<p class="sub">${esc(doc.subtitle)}</p>`);
  for (const b of doc.blocks) {
    if (b.t === "h") body.push(`<h${b.level + 1}>${esc(b.text)}</h${b.level + 1}>`);
    else if (b.t === "p") body.push(`<p>${multiline(b.text)}</p>`);
    else if (b.t === "meta") body.push(`<dl>${b.items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`);
    else if (b.t === "list") body.push(`<ul>${b.items.map((i) => `<li>${i.done === undefined ? "" : `<input type="checkbox" disabled${i.done ? " checked" : ""}> `}${esc(i.text)}</li>`).join("")}</ul>`);
    else {
      const [head, ...rows] = b.rows;
      body.push(`<table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${multiline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    }
  }
  const css = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;line-height:1.55}
h1{margin-bottom:.25rem}.sub{opacity:.7;margin-top:0}h2{margin-top:2rem}h3{margin-bottom:.25rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.15rem .75rem;margin:.5rem 0}dt{font-weight:600}dd{margin:0}
ul{padding-left:1.25rem}table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{border:1px solid color-mix(in srgb,currentColor 25%,transparent);padding:.35rem .5rem;text-align:left;vertical-align:top}
th{background:color-mix(in srgb,currentColor 7%,transparent)}`;
  return `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(doc.title)}</title>\n<style>${css}</style>\n</head>\n<body>\n${body.join("\n")}\n</body>\n</html>\n`;
}

// --- DOCX (docx) --------------------------------------------------------------------------------------------

export async function toDocx(doc: DocModel): Promise<Blob> {
  const d = await import("docx");
  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [
    new d.Paragraph({ text: doc.title, heading: d.HeadingLevel.TITLE }),
  ];
  if (doc.subtitle) children.push(new d.Paragraph({ children: [new d.TextRun({ text: doc.subtitle, italics: true })] }));
  const heading = { 1: d.HeadingLevel.HEADING_1, 2: d.HeadingLevel.HEADING_2, 3: d.HeadingLevel.HEADING_3 } as const;
  const lines = (text: string) => text.split(/\r?\n/).map((l, i) => new d.TextRun({ text: l, break: i > 0 ? 1 : undefined }));
  for (const b of doc.blocks) {
    if (b.t === "h") children.push(new d.Paragraph({ text: b.text, heading: heading[b.level] }));
    else if (b.t === "p") children.push(new d.Paragraph({ children: lines(b.text) }));
    else if (b.t === "meta") {
      for (const [k, v] of b.items) children.push(new d.Paragraph({ children: [new d.TextRun({ text: `${k}: `, bold: true }), new d.TextRun(v)] }));
    } else if (b.t === "list") {
      for (const i of b.items) children.push(new d.Paragraph({ text: `${check(i.done)}${i.text}`, bullet: { level: 0 } }));
    } else {
      children.push(
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: b.rows.map(
            (r, ri) =>
              new d.TableRow({
                tableHeader: ri === 0,
                children: r.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: ri === 0 ? [new d.TextRun({ text: c, bold: true })] : lines(c) })] })),
              }),
          ),
        }),
        new d.Paragraph(""),
      );
    }
  }
  const file = new d.Document({ creator: "Prisma", title: doc.title, sections: [{ children }] });
  return d.Packer.toBlob(file);
}

// --- PDF (jsPDF + autotable) --------------------------------------------------------------------------------
// Fontes padrão do PDF (Helvetica, WinAnsi): acentos do português funcionam; símbolos fora do Latin-1, não.

const latin1 = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x00-\xFF\n]/g, "?");

export async function toPdf(doc: DocModel): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 50;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const bottom = pdf.internal.pageSize.getHeight() - margin;
  let y = margin;
  const write = (text: string, size: number, style: "normal" | "bold" | "italic" = "normal", gap = 4, indent = 0) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    for (const line of pdf.splitTextToSize(latin1(text), width - indent) as string[]) {
      if (y + size > bottom) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin + indent, y + size);
      y += size * 1.3;
    }
    y += gap;
  };
  write(doc.title, 20, "bold", 2);
  if (doc.subtitle) write(doc.subtitle, 10, "italic", 8);
  for (const b of doc.blocks) {
    if (b.t === "h") {
      y += b.level === 1 ? 10 : 6;
      write(b.text, b.level === 1 ? 15 : b.level === 2 ? 13 : 11.5, "bold", 2);
    } else if (b.t === "p") write(b.text, 10, "normal", 6);
    else if (b.t === "meta") for (const [k, v] of b.items) write(`${k}: ${v}`, 9.5, "normal", 0);
    else if (b.t === "list") {
      for (const i of b.items) write(`- ${check(i.done)}${i.text}`, 9.5, "normal", 0, 10);
      y += 4;
    } else {
      const [head, ...rows] = b.rows;
      autoTable(pdf, {
        startY: y + 4,
        head: [head.map(latin1)],
        body: rows.map((r) => r.map(latin1)),
        theme: "grid",
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
      });
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
    }
    y += 2;
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(latin1(`Prisma · ${doc.title}`), margin, pdf.internal.pageSize.getHeight() - 25);
    pdf.text(`Página ${i} de ${pages}`, pdf.internal.pageSize.getWidth() - margin, pdf.internal.pageSize.getHeight() - 25, { align: "right" });
  }
  return pdf.output("blob");
}

// --- XLSX (exceljs) -----------------------------------------------------------------------------------------

export async function toXlsx(sheets: SheetModel[]): Promise<Blob> {
  const { loadExcel } = await import("@/lib/files/read");
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Prisma";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[[\]:*?/\\]/g, "-").slice(0, 31) || "Planilha");
    ws.addRow(s.columns);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) {
      // Texto que começa com = + - @ entraria como fórmula ao abrir: grava como texto.
      ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v)));
    }
    ws.columns.forEach((col, i) => {
      let w = s.columns[i]?.length ?? 8;
      col.eachCell?.({ includeEmpty: false }, (c) => {
        const v = c.value;
        if (v instanceof Date) c.numFmt = "dd/mm/yyyy";
        w = Math.max(w, v instanceof Date ? 10 : String(v ?? "").length);
      });
      col.width = Math.min(60, w + 2);
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (s.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
