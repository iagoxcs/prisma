"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, X } from "lucide-react";
import { MarkdownView } from "@/components/markdown-view";
import { Button } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { DOC_KIND_LABEL, docKind } from "@/lib/files/kinds";
import { isolatedDocument, loadPdfjs, readDocument, ReadError, themeColors, type ReadResult, type Sheet } from "@/lib/files/read";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, OVERLAY, restoreFocus, SEGMENT_ITEM, SEGMENTED, trapFocus } from "@/lib/ui";

const BpmnView = dynamic(() => import("@/components/files/bpmn-view"), { ssr: false, loading: () => <SkeletonList count={3} /> });

const PDF_MAX_PAGES = 30;

// Pré-visualização de anexos (RNF-04 revisto): mostra o conteúdo extraído e isolado, nunca o arquivo cru
// inline. PDF vira <canvas>; DOCX e HTML, HTML higienizado em <iframe sandbox> sem script; XLSX/CSV, tabela;
// BPMN, o visualizador do bpmn-js. Baixar continua sendo o caminho padrão.
export function canPreview(fileName: string) {
  return docKind(fileName) !== null;
}

// Botão "Pré-visualizar" para um arquivo de um bucket privado do Supabase.
export function PreviewButton({ bucket, path, fileName, onDownload, className }: {
  bucket: string;
  path: string;
  fileName: string;
  onDownload?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!canPreview(fileName)) return null;
  return (
    <>
      <Button type="button" variant="ghost" size="icon-sm" className={className} aria-label={`Pré-visualizar ${fileName}`} title="Pré-visualizar" onClick={() => setOpen(true)}>
        <Eye strokeWidth={1.75} />
      </Button>
      {open && (
        <FilePreview
          fileName={fileName}
          load={async () => {
            const { data, error } = await getSupabase().storage.from(bucket).download(path);
            if (error || !data) throw new ReadError(error?.message ?? "Não foi possível baixar o arquivo.");
            return data;
          }}
          onDownload={onDownload}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function FilePreview({ fileName, load, onDownload, onClose }: {
  fileName: string;
  load: () => Promise<Blob>;
  onDownload?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [result, setResult] = useState<ReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = docKind(fileName);

  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector<HTMLElement>("[data-close]")?.focus();
    return () => restoreFocus(opener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await readDocument(await load(), fileName);
        if (!cancelled) setResult(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof ReadError ? e.message : "Não foi possível abrir a pré-visualização.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // load muda a cada render do pai; o arquivo é o mesmo enquanto o diálogo estiver aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  return createPortal(
    <div
      className={`${OVERLAY} z-50 items-start justify-center overflow-y-auto p-0 md:p-8`}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        trapFocus(e, ref.current);
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="min-h-full w-full max-w-4xl space-y-4 border-glass-edge bg-popover p-5 text-popover-foreground shadow-[var(--glass-shadow)] md:min-h-0 md:rounded-2xl md:border md:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[1.0625rem] font-semibold">{fileName}</h2>
            <p className="text-[0.8125rem] text-muted-foreground">
              Pré-visualização{kind ? ` · ${DOC_KIND_LABEL[kind]}` : ""}
              {result?.pages ? <span className="num"> · {result.pages} página(s)</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            {onDownload && (
              <Button type="button" variant="outline" size="sm" onClick={onDownload}>
                <Download strokeWidth={1.75} aria-hidden /> Baixar
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" aria-label="Fechar" data-close="" onClick={onClose}>
              <X strokeWidth={1.75} />
            </Button>
          </div>
        </div>
        {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
        {!error && !result && <SkeletonList count={5} />}
        {result && <PreviewBody result={result} />}
      </div>
    </div>,
    document.body,
  );
}

function PreviewBody({ result }: { result: ReadResult }) {
  switch (result.kind) {
    case "pdf":
      return <PdfPages data={result.pdf!} pages={result.pages ?? 0} />;
    case "docx":
    case "html":
      return <IsolatedHtml body={result.html ?? ""} />;
    case "xlsx":
    case "csv":
      return <Sheets sheets={result.sheets ?? []} />;
    case "bpmn":
      return <BpmnView xml={result.bpmnXml ?? ""} />;
    case "md":
      return (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto rounded-xl border border-border p-4 text-sm">
          <MarkdownView>{result.text}</MarkdownView>
        </div>
      );
    default:
      return <pre className="max-h-[70vh] overflow-auto rounded-xl border border-border p-4 text-sm whitespace-pre-wrap">{result.text || "(arquivo vazio)"}</pre>;
  }
}

// HTML higienizado em quadro isolado: sandbox sem allow-scripts nem allow-same-origin, e CSP sem rede.
function IsolatedHtml({ body }: { body: string }) {
  // Só roda no navegador (o diálogo abre depois da leitura do arquivo), então pode ler os tokens no render.
  const doc = useMemo(() => isolatedDocument(body, themeColors()), [body]);
  return <iframe title="Conteúdo do arquivo" sandbox="" referrerPolicy="no-referrer" srcDoc={doc} className="h-[70vh] w-full rounded-xl border border-border bg-popover" />;
}

function Sheets({ sheets }: { sheets: Sheet[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[active];
  if (!sheet) return <p className="text-sm text-muted-foreground">Planilha vazia.</p>;
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const [head, ...rows] = sheet.rows;
  return (
    <div className="space-y-3">
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Abas da planilha" className={SEGMENTED}>
          {sheets.map((s, i) => (
            <button key={s.name + i} type="button" role="tab" aria-selected={i === active} className={SEGMENT_ITEM} onClick={() => setActive(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[65vh] overflow-auto rounded-xl border border-border">
        <table className="num w-full text-left text-[0.8125rem]">
          {head && (
            <thead className="sticky top-0 bg-secondary">
              <tr>{Array.from({ length: width }, (_, i) => <th key={i} className="border-b border-border px-3 py-2 font-medium">{head[i] ?? ""}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{Array.from({ length: width }, (_, i) => <td key={i} className="border-b border-border px-3 py-1.5 align-top">{r[i] ?? ""}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.truncated && <p className="text-[0.8125rem] text-muted-foreground">Mostrando as primeiras {sheet.rows.length} linhas. Baixe o arquivo para ver tudo.</p>}
    </div>
  );
}

function PdfPages({ data, pages }: { data: ArrayBuffer; pages: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = Math.min(pages, PDF_MAX_PAGES);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
        destroy = () => task.destroy();
        const doc = await task.promise;
        const box = ref.current;
        if (!box || cancelled) return;
        box.replaceChildren();
        const ratio = window.devicePixelRatio || 1;
        for (let i = 1; i <= Math.min(doc.numPages, PDF_MAX_PAGES) && !cancelled; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          // clientWidth inclui o padding do contêiner (p-3): desconta para a página não estourar a largura.
          const scale = Math.min(1.6, (box.clientWidth - 26) / base.width);
          const vp = page.getViewport({ scale: scale * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = `${Math.floor(vp.width / ratio)}px`;
          canvas.style.maxWidth = "100%"; // a barra de rolagem vertical aparece depois da 1ª página
          canvas.style.height = "auto";
          canvas.className = "mx-auto block rounded-md border border-border";
          canvas.setAttribute("aria-label", `Página ${i}`);
          box.appendChild(canvas);
          await page.render({ canvas, viewport: vp }).promise;
        }
      } catch {
        if (!cancelled) setError("Não foi possível desenhar as páginas do PDF.");
      }
    })();
    return () => {
      cancelled = true;
      void destroy?.();
    };
  }, [data]);

  return (
    <div className="space-y-2">
      <div ref={ref} className="max-h-[70vh] space-y-3 overflow-y-auto rounded-xl bg-muted p-3" />
      {pages > shown && <p className="text-[0.8125rem] text-muted-foreground">Mostrando {shown} de {pages} páginas. Baixe o arquivo para ver tudo.</p>}
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
    </div>
  );
}
