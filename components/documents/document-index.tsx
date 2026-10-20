"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { DOC_CATEGORIES, DocCategoryField, useCanCategorize } from "@/components/documents/doc-category";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { downloadFile, formatSize } from "@/lib/attachments";
import { dateTime } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, SELECT_CLASS } from "@/lib/ui";
import { usePageSize } from "@/lib/use-page-size";
import { useQuery } from "@/lib/use-query";
import { DOC_CATEGORY_LABEL, type DocCategory, type ProjectDocument } from "@/types/domain";

const BUCKET = "task-attachments";
const COLS =
  "id, task_id, storage_path, file_name, size_bytes, mime_type, uploaded_by, created_at, doc_category, task_title, project_id, category_id, project_name, client_id, client_name, category_name, uploader_name";

// Tipo pelo sufixo do nome do arquivo. "outros" = nenhum dos sufixos conhecidos.
const FILE_TYPES = {
  pdf: { label: "PDF", ext: ["pdf"] },
  word: { label: "Word", ext: ["doc", "docx", "odt", "rtf"] },
  excel: { label: "Excel", ext: ["xls", "xlsx", "xlsm", "csv", "ods"] },
  powerpoint: { label: "PowerPoint", ext: ["ppt", "pptx", "odp"] },
  imagem: { label: "Imagem", ext: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"] },
} as const;
type FileType = keyof typeof FILE_TYPES | "outros";
const KNOWN_EXT = Object.values(FILE_TYPES).flatMap((t) => t.ext);

type Option = { id: string; name: string };
type Group = { id: string; name: string; client: string | null; docs: ProjectDocument[] };

// Projetos recolhidos no GED, guardados no navegador (ids em JSON).
const COLLAPSED_KEY = "prisma-documents-collapsed";
const COLLAPSED_EVENT = "prisma-documents-collapsed-change";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSED_EVENT, onChange);
  };
}

// No export estático, o HTML e a hidratação saem tudo expandido; o estado salvo entra após a montagem.
function useCollapsed(): [Set<string>, (ids: Set<string>) => void] {
  const raw = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => "[]");
  const collapsed = useMemo(() => {
    try {
      const ids: unknown = JSON.parse(raw);
      return new Set(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);
  const setCollapsed = useCallback((ids: Set<string>) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
    } catch {
      /* navegação privada: o estado não persiste */
    }
    window.dispatchEvent(new Event(COLLAPSED_EVENT));
  }, []);
  return [collapsed, setCollapsed];
}

// Índice de anexos (GED). Sem projectId: todos os projetos visíveis, agrupados e recolhíveis; com projectId: só o projeto.
// Paginação no servidor; a RLS da view (security_invoker) decide o que cada pessoa enxerga.
export function DocumentIndex({ projectId }: { projectId?: string }) {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [category, setCategory] = useState("");
  const [docCategory, setDocCategory] = useState<DocCategory | "sem" | "">("");
  const [type, setType] = useState<FileType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("documents");
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useCollapsed();
  const canCategorize = useCanCategorize();

  // Busca por nome com debounce de 300ms.
  useEffect(() => {
    const t = setTimeout(() => setName(nameInput.trim()), 300);
    return () => clearTimeout(t);
  }, [nameInput]);

  const projects = useQuery<Option[]>(
    () => (projectId ? Promise.resolve({ data: [], error: null }) : getSupabase().from("projects").select("id, name").order("name")),
    [projectId],
  );
  const categories = useQuery<Option[]>(
    () =>
      projectId
        ? getSupabase().from("categories").select("id, name").eq("project_id", projectId).order("name")
        : Promise.resolve({ data: [], error: null }),
    [projectId],
  );

  const docs = useQuery<{ rows: ProjectDocument[]; total: number }>(async () => {
    let q = getSupabase().from("project_documents").select(COLS, { count: "exact" });
    if (projectId) q = q.eq("project_id", projectId);
    else if (project) q = q.eq("project_id", project);
    if (projectId && category) q = q.eq("category_id", category);
    if (docCategory === "sem") q = q.is("doc_category", null);
    else if (docCategory) q = q.eq("doc_category", docCategory);
    if (name) q = q.ilike("file_name", `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    if (type === "outros") for (const ext of KNOWN_EXT) q = q.not("file_name", "ilike", `%.${ext}`);
    else if (type) q = q.or(FILE_TYPES[type].ext.map((ext) => `file_name.ilike.%.${ext}`).join(","));
    // Período em America/Sao_Paulo (UTC-3, sem horário de verão).
    if (from) q = q.gte("created_at", `${from}T00:00:00-03:00`);
    if (to) q = q.lte("created_at", `${to}T23:59:59.999-03:00`);
    const start = (page - 1) * pageSize;
    const r = await q
      .order("project_name", { ascending: true })
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);
    return { data: { rows: (r.data ?? []) as unknown as ProjectDocument[], total: r.count ?? 0 }, error: r.error };
  }, [projectId, project, category, docCategory, name, type, from, to, page, pageSize]);

  const filtered = !!(name || project || category || docCategory || type || from || to);
  const rows = useMemo(() => docs.data?.rows ?? [], [docs.data]);
  const total = docs.data?.total ?? 0;

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const d of rows) {
      const g = map.get(d.project_id) ?? { id: d.project_id, name: d.project_name, client: d.client_name, docs: [] };
      g.docs.push(d);
      map.set(d.project_id, g);
    }
    return [...map.values()];
  }, [rows]);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.id));

  // Filtro novo: volta para a primeira página.
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
  }

  function toggleAll() {
    const next = new Set(collapsed);
    for (const g of groups) {
      if (allCollapsed) next.delete(g.id);
      else next.add(g.id);
    }
    setCollapsed(next);
  }

  async function download(d: ProjectDocument) {
    setError(null);
    const err = await downloadFile(BUCKET, d.storage_path, d.file_name);
    if (err) setError(err);
  }

  const table = (list: ProjectDocument[]) => (
    <DocumentTable
      docs={list}
      onDownload={download}
      canEdit={(d) => canCategorize(d.project_id, d.uploaded_by)}
      onSaved={() => {
        setError(null);
        docs.reload();
      }}
      onError={setError}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="search"
          aria-label="Buscar por nome do arquivo"
          placeholder="Nome do arquivo"
          className="min-w-56 flex-1"
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
            setPage(1);
          }}
        />
        {!projectId && (
          <select aria-label="Filtrar por projeto" className={SELECT_CLASS} value={project} onChange={(e) => filter(setProject)(e.target.value)}>
            <option value="">Todos os projetos</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        {projectId && (
          <select aria-label="Filtrar por escopo" className={SELECT_CLASS} value={category} onChange={(e) => filter(setCategory)(e.target.value)}>
            <option value="">Todos os escopos</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <select
          aria-label="Filtrar por categoria do documento"
          className={SELECT_CLASS}
          value={docCategory}
          onChange={(e) => filter(setDocCategory)(e.target.value as DocCategory | "sem" | "")}
        >
          <option value="">Todas as categorias</option>
          {DOC_CATEGORIES.map((c) => (
            <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>
          ))}
          <option value="sem">Sem categoria</option>
        </select>
        <select aria-label="Filtrar por tipo de arquivo" className={SELECT_CLASS} value={type} onChange={(e) => filter(setType)(e.target.value as FileType | "")}>
          <option value="">Todos os tipos</option>
          {(Object.keys(FILE_TYPES) as (keyof typeof FILE_TYPES)[]).map((k) => (
            <option key={k} value={k}>{FILE_TYPES[k].label}</option>
          ))}
          <option value="outros">Outros</option>
        </select>
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">Enviado de</span>
          <Input type="date" className="num" value={from} max={to || undefined} onChange={(e) => filter(setFrom)(e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="block text-[0.8125rem] font-medium text-muted-foreground">até</span>
          <Input type="date" className="num" value={to} min={from || undefined} onChange={(e) => filter(setTo)(e.target.value)} />
        </label>
        {!projectId && groups.length > 1 && (
          <Button type="button" variant="ghost" className="h-11" onClick={toggleAll}>
            {allCollapsed ? "Expandir todos" : "Recolher todos"}
          </Button>
        )}
      </div>

      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      {docs.error && <ErrorState what="os documentos" detail={docs.error} onRetry={docs.reload} />}
      {docs.loading && !docs.data && <SkeletonList count={5} label="Carregando os documentos…" />}

      {!docs.error && docs.data && total === 0 && (
        <p className="surface-card px-4 py-6 text-sm text-muted-foreground">
          {filtered ? "Nenhum documento com esses filtros." : "Nenhum documento anexado ainda. Os anexos das tarefas aparecem aqui."}
        </p>
      )}

      {!docs.error && rows.length > 0 &&
        (projectId
          ? table(rows)
          : groups.map((g) => {
              const open = !collapsed.has(g.id);
              return (
                <section key={g.id} className="space-y-2" aria-labelledby={`docs-${g.id}`}>
                  <h2 id={`docs-${g.id}`} className="text-base font-semibold">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`docs-body-${g.id}`}
                      onClick={() => toggle(g.id)}
                      className="-ml-2 flex min-h-11 flex-wrap items-center gap-x-2 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {open ? (
                        <ChevronDown className="size-4 shrink-0 text-brand-mid" strokeWidth={1.75} aria-hidden />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-brand-mid" strokeWidth={1.75} aria-hidden />
                      )}
                      {g.name}
                      {g.client && <span className="text-sm font-normal text-muted-foreground">{g.client}</span>}
                      <span className="num text-sm font-normal text-muted-foreground">{g.docs.length}</span>
                    </button>
                  </h2>
                  <div id={`docs-body-${g.id}`} hidden={!open}>
                    {open && table(g.docs)}
                  </div>
                </section>
              );
            }))}

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}

function DocumentTable({
  docs,
  onDownload,
  canEdit,
  onSaved,
  onError,
}: {
  docs: ProjectDocument[];
  onDownload: (d: ProjectDocument) => void;
  canEdit: (d: ProjectDocument) => boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="surface-card overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead>
          <tr className="border-b text-sm font-medium text-muted-foreground">
            <th scope="col" className="h-11 px-4 font-medium">Arquivo</th>
            <th scope="col" className="px-4 font-medium">Categoria</th>
            <th scope="col" className="px-4 font-medium">Tarefa</th>
            <th scope="col" className="px-4 font-medium">Escopo</th>
            <th scope="col" className="px-4 font-medium">Enviado por</th>
            <th scope="col" className="px-4 text-right font-medium">Data</th>
            <th scope="col" className="px-4 text-right font-medium">Tamanho</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="h-13 border-b last:border-b-0">
              <td className="px-2">
                <button
                  type="button"
                  onClick={() => onDownload(d)}
                  className="flex min-h-11 max-w-72 items-center gap-2 rounded-md px-2 text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Download className="size-4 shrink-0 text-brand-mid" strokeWidth={1.75} aria-hidden />
                  <span className="truncate">{d.file_name}</span>
                  <span className="sr-only">(baixar)</span>
                </button>
              </td>
              <td className="px-4 whitespace-nowrap">
                <DocCategoryField
                  id={d.id}
                  fileName={d.file_name}
                  value={d.doc_category}
                  editable={canEdit(d)}
                  onSaved={onSaved}
                  onError={onError}
                />
              </td>
              <td className="px-4">
                <Link href={`/projeto/?id=${d.project_id}&task=${d.task_id}`} className="inline-flex min-h-11 items-center hover:underline">
                  {d.task_title}
                </Link>
              </td>
              <td className="px-4">{d.category_name ?? <span className="text-muted-foreground">—</span>}</td>
              <td className="px-4">{d.uploader_name ?? <span className="text-muted-foreground">—</span>}</td>
              <td className="num px-4 text-right whitespace-nowrap">{dateTime(d.created_at)}</td>
              <td className="num px-4 text-right whitespace-nowrap">{formatSize(d.size_bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
