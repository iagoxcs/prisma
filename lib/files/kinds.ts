// Tipos de arquivo que o Prisma lê e gera no navegador (TXT, MD, CSV, PDF, DOCX, XLSX, HTML, BPMN).
// Detecção pelo sufixo do nome: o mime_type gravado nos anexos nem sempre existe.

export type DocKind = "txt" | "md" | "csv" | "pdf" | "docx" | "xlsx" | "html" | "bpmn";

const EXT: Record<string, DocKind> = {
  txt: "txt",
  text: "txt",
  log: "txt",
  vtt: "txt",
  srt: "txt",
  md: "md",
  markdown: "md",
  csv: "csv",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  html: "html",
  htm: "html",
  bpmn: "bpmn",
};

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  txt: "Texto",
  md: "Markdown",
  csv: "CSV",
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  html: "HTML",
  bpmn: "BPMN",
};

export const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

// null = formato que o Prisma não lê (o arquivo continua podendo ser baixado).
export function docKind(name: string): DocKind | null {
  return EXT[extOf(name)] ?? null;
}

// Para o atributo accept de <input type="file">.
export const acceptFor = (kinds: DocKind[]) =>
  Object.entries(EXT)
    .filter(([, k]) => kinds.includes(k))
    .map(([e]) => `.${e}`)
    .join(",");

export const READABLE_KINDS: DocKind[] = ["txt", "md", "csv", "pdf", "docx", "xlsx", "html", "bpmn"];
// Formatos que viram texto corrido (contexto do projeto, conteúdo da Base de Conhecimento).
export const TEXT_KINDS: DocKind[] = ["txt", "md", "pdf", "docx", "html", "xlsx", "bpmn"];

export const MAX_READ_BYTES = 20 * 1024 * 1024;
