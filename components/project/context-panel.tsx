"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileUp, Plus } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { brDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, SELECT_CLASS, TEXTAREA_CLASS } from "@/lib/ui";
import { usePageSize } from "@/lib/use-page-size";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { CONTEXT_KIND_LABEL, type ContextKind, type ProjectContextEntry } from "@/types/domain";

// Corpo fica fora da listagem (até 500 mil caracteres): só é buscado ao ler ou editar.
type Entry = Omit<ProjectContextEntry, "body"> & { profiles?: { name: string } | null };
const COLS = "id, project_id, kind, title, meeting_date, participants, source_file_name, created_by, created_at, updated_at, profiles(name)";
const IMPORT_EXT = [".txt", ".md", ".vtt", ".srt"];
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_BODY = 500000;
const LABEL = "block text-[0.8125rem] font-medium text-muted-foreground";

type Draft = { kind: ContextKind; title: string; meeting_date: string; participants: string; body: string; source_file_name: string | null };
const EMPTY: Draft = { kind: "anotacao", title: "", meeting_date: "", participants: "", body: "", source_file_name: null };

async function fetchBody(id: string) {
  const r = await getSupabase().from("project_context_entries").select("body").eq("id", id).maybeSingle();
  return { body: (r.data?.body as string | undefined) ?? null, error: r.error?.message ?? null };
}

// Transcrições, atas e anotações do projeto. Só internos membros (RLS); a aba já é oculta para externos.
export function ContextPanel({ projectId, isManager }: { projectId: string; isManager: boolean }) {
  const { profile } = useAuth();
  const [termInput, setTermInput] = useState("");
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<ContextKind | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("project-context");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ entry: Entry; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(termInput.trim()), 300);
    return () => clearTimeout(t);
  }, [termInput]);

  const list = useQuery<{ rows: Entry[]; total: number }>(async () => {
    let q = getSupabase().from("project_context_entries").select(COLS, { count: "exact" }).eq("project_id", projectId);
    if (kind) q = q.eq("kind", kind);
    if (term) q = q.textSearch("search", term, { type: "websearch", config: "portuguese" });
    const start = (page - 1) * pageSize;
    const r = await q
      .order("meeting_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1);
    return { data: { rows: (r.data ?? []) as unknown as Entry[], total: r.count ?? 0 }, error: r.error };
  }, [projectId, kind, term, page, pageSize]);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const canChange = (e: Entry) => isManager || (!!profile && e.created_by === profile.id);

  async function startEdit(e: Entry) {
    setError(null);
    const { body, error } = await fetchBody(e.id);
    if (error || body === null) return setError(error ?? "Registro não encontrado.");
    setCreating(false);
    setEditing({
      entry: e,
      draft: {
        kind: e.kind,
        title: e.title,
        meeting_date: e.meeting_date ?? "",
        participants: e.participants ?? "",
        body,
        source_file_name: e.source_file_name,
      },
    });
  }

  async function remove() {
    if (!deleting) return;
    setError(null);
    const { data, error } = await getSupabase().from("project_context_entries").delete().eq("id", deleting.id).select("id");
    setDeleting(null);
    if (error) return setError(error.message);
    if (!data?.length) return setError("Você não tem permissão para excluir este registro.");
    list.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar nos registros"
          placeholder="Buscar por título ou conteúdo"
          className="min-w-56 flex-1"
          value={termInput}
          onChange={(e) => {
            setTermInput(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Filtrar por tipo"
          className={SELECT_CLASS}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ContextKind | "");
            setPage(1);
          }}
        >
          <option value="">Todos os tipos</option>
          {(Object.keys(CONTEXT_KIND_LABEL) as ContextKind[]).map((k) => (
            <option key={k} value={k}>{CONTEXT_KIND_LABEL[k]}</option>
          ))}
        </select>
        {!creating && !editing && (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus strokeWidth={1.75} aria-hidden /> Novo registro
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <EntryForm
          key={editing?.entry.id ?? "new"}
          projectId={projectId}
          entryId={editing?.entry.id}
          initial={editing?.draft ?? EMPTY}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            list.reload();
          }}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      {list.error && <ErrorState what="os registros do projeto" detail={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonList count={4} label="Carregando os registros…" />}
      {!list.error && list.data && total === 0 && (
        <p className="surface-card px-4 py-6 text-sm text-muted-foreground">
          {term || kind ? "Nenhum registro com esses filtros." : "Nenhum registro de reunião. Adicione a primeira transcrição ou anotação."}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <EntryCard
              key={e.id + e.updated_at}
              entry={e}
              canChange={canChange(e)}
              onEdit={() => startEdit(e)}
              onDelete={() => setDeleting(e)}
            />
          ))}
        </ul>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      <ConfirmDialog
        open={!!deleting}
        title="Excluir registro?"
        description={deleting ? `"${deleting.title}" será excluído. Esta ação não pode ser desfeita.` : undefined}
        confirmLabel="Excluir registro"
        destructive
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function EntryCard({ entry: e, canChange, onEdit, onDelete }: { entry: Entry; canChange: boolean; onEdit: () => void; onDelete: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyId = `context-body-${e.id}`;

  async function toggle() {
    if (open) return setOpen(false);
    if (body === null) {
      const r = await fetchBody(e.id);
      if (r.error || r.body === null) return setError(r.error ?? "Registro não encontrado.");
      setBody(r.body);
    }
    setError(null);
    setOpen(true);
  }

  return (
    <li className="surface-card space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-3 text-[0.8125rem]">
            <span className="font-semibold text-brand-mid">{CONTEXT_KIND_LABEL[e.kind]}</span>
            {e.meeting_date && <span className="num text-muted-foreground">{brDate(e.meeting_date)}</span>}
          </p>
          <p className="text-[0.9375rem] font-medium">{e.title}</p>
          {e.participants && <p className="text-muted-foreground">Participantes: {e.participants}</p>}
          <p className="text-[0.8125rem] text-muted-foreground">
            Por {e.profiles?.name ?? "—"}
            {e.source_file_name && <> · importado de <span className="num">{e.source_file_name}</span></>}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="outline" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            {open ? "Fechar" : "Ler"}
          </Button>
          {canChange && (
            <>
              <Button type="button" variant="ghost" onClick={onEdit}>Editar</Button>
              <Button type="button" variant="ghost" className="hover:text-destructive" onClick={onDelete}>Excluir</Button>
            </>
          )}
        </div>
      </div>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      {/* Texto puro: nunca interpretado como HTML ou Markdown. */}
      <div id={bodyId} hidden={!open} className="max-h-96 overflow-y-auto rounded-md bg-muted p-3 whitespace-pre-wrap" tabIndex={0}>
        {body}
      </div>
    </li>
  );
}

function EntryForm({
  projectId,
  entryId,
  initial,
  onDone,
  onCancel,
}: {
  projectId: string;
  entryId?: string;
  initial: Draft;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { profile } = useAuth();
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));

  async function importFile(file: File) {
    setImportMsg(null);
    if (!IMPORT_EXT.some((ext) => file.name.toLowerCase().endsWith(ext))) return setImportMsg("Formato não suportado. Use .txt, .md, .vtt ou .srt.");
    if (file.size > MAX_IMPORT_BYTES) return setImportMsg("O arquivo excede o limite de 2 MB.");
    const text = await file.text();
    if (!text.trim()) return setImportMsg("O arquivo está vazio.");
    setD((s) => ({ ...s, body: text.slice(0, MAX_BODY), source_file_name: file.name, title: s.title || file.name.replace(/\.[^.]+$/, "").slice(0, 200) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!d.body.trim()) return setError("O corpo do registro é obrigatório.");
    setBusy(true);
    const fields = {
      kind: d.kind,
      title: d.title.trim(),
      meeting_date: d.meeting_date || null,
      participants: d.participants.trim() || null,
      body: d.body,
      source_file_name: d.source_file_name,
    };
    const supabase = getSupabase();
    const r = entryId
      ? await supabase.from("project_context_entries").update(fields).eq("id", entryId).select("id")
      : await supabase.from("project_context_entries").insert({ ...fields, project_id: projectId, created_by: profile?.id }).select("id");
    setBusy(false);
    if (r.error) return setError(r.error.code === "42501" ? "Você não tem permissão para salvar este registro." : r.error.message);
    if (!r.data?.length) return setError("Você não tem permissão para salvar este registro.");
    onDone();
  }

  return (
    <form onSubmit={submit} className="glass-coluna space-y-4 p-4 text-sm">
      <h3 className="font-semibold">{entryId ? "Editar registro" : "Novo registro"}</h3>
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1.5">
          <span className={LABEL}>Tipo</span>
          <select className={SELECT_CLASS} value={d.kind} onChange={(e) => set("kind", e.target.value as ContextKind)}>
            {(Object.keys(CONTEXT_KIND_LABEL) as ContextKind[]).map((k) => (
              <option key={k} value={k}>{CONTEXT_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="min-w-64 flex-1 space-y-1.5">
          <span className={LABEL}>Título</span>
          <Input required maxLength={200} value={d.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className={LABEL}>Data da reunião</span>
          <Input type="date" className="num" value={d.meeting_date} onChange={(e) => set("meeting_date", e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className={LABEL}>Participantes</span>
        <Input maxLength={1000} value={d.participants} onChange={(e) => set("participants", e.target.value)} placeholder="Nomes separados por vírgula" />
      </label>
      <label className="block space-y-1.5">
        <span className={LABEL}>
          Corpo{d.source_file_name && <> · importado de <span className="num">{d.source_file_name}</span></>}
        </span>
        <textarea className={cn(TEXTAREA_CLASS, "min-h-60")} required maxLength={MAX_BODY} value={d.body} onChange={(e) => set("body", e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp strokeWidth={1.75} aria-hidden /> Importar arquivo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={IMPORT_EXT.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
      {importMsg && <p role="alert" className={MSG_ERROR}>{importMsg}</p>}
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <p className="text-[0.8125rem] text-muted-foreground">Registros visíveis apenas para a equipe interna do projeto.</p>
    </form>
  );
}
