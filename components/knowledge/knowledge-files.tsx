"use client";

import { useState } from "react";
import { Download, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { downloadFile, formatSize } from "@/lib/attachments";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { MAX_ATTACHMENT_BYTES, type KnowledgeFile } from "@/types/domain";

const BUCKET = "knowledge-files";

// Arquivos de um item da base. Sempre baixados, nunca abertos no navegador (RNF-04).
export function KnowledgeFiles({ itemId, canManage }: { itemId: string; canManage: boolean }) {
  const list = useQuery<KnowledgeFile[]>(
    () =>
      getSupabase()
        .from("knowledge_files")
        .select("id, item_id, storage_path, file_name, size_bytes, mime_type, uploaded_by, created_at")
        .eq("item_id", itemId)
        .order("created_at"),
    [itemId],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<KnowledgeFile | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) return setError("O arquivo excede o limite de 20 MB.");
    if (file.size === 0) return setError("O arquivo está vazio.");
    setBusy(true);
    const supabase = getSupabase();
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${itemId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/octet-stream" });
    if (up.error) {
      setBusy(false);
      return setError(up.error.message);
    }
    const ins = await supabase.from("knowledge_files").insert({
      item_id: itemId,
      storage_path: path,
      file_name: file.name,
      size_bytes: file.size,
      mime_type: file.type || null,
    });
    if (ins.error) {
      await supabase.storage.from(BUCKET).remove([path]); // não deixa arquivo órfão
      setError(ins.error.message);
    }
    setBusy(false);
    list.reload();
  }

  async function download(f: KnowledgeFile) {
    setError(null);
    const err = await downloadFile(BUCKET, f.storage_path, f.file_name);
    if (err) setError(err);
  }

  async function remove() {
    if (!removing) return;
    const f = removing;
    const supabase = getSupabase();
    const del = await supabase.from("knowledge_files").delete().eq("id", f.id);
    setRemoving(null);
    if (del.error) return setError(del.error.message);
    await supabase.storage.from(BUCKET).remove([f.storage_path]);
    list.reload();
  }

  const files = list.data ?? [];

  return (
    <section className="space-y-3" aria-labelledby="knowledge-files-title">
      <h2 id="knowledge-files-title" className="text-lg font-semibold">Arquivos</h2>
      {files.length === 0 && !list.loading && <p className="text-sm text-muted-foreground">Nenhum arquivo anexado.</p>}
      {files.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {files.map((f) => (
            <li key={f.id} className="surface-card flex min-h-11 items-center justify-between gap-2 py-1 pr-1 pl-3">
              <button type="button" className="flex min-h-11 min-w-0 items-center gap-2 text-left font-medium hover:underline" onClick={() => download(f)}>
                <Download className="size-4 shrink-0 text-brand-mid" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{f.file_name}</span>
              </button>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <span className="num text-xs">{formatSize(f.size_bytes)}</span>
                {canManage && (
                  <Button variant="ghost" size="icon" aria-label={`Remover arquivo ${f.file_name}`} className="hover:text-destructive" onClick={() => setRemoving(f)}>
                    <X strokeWidth={1.75} />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <label className="surface-card flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium hover:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-ring">
            <Paperclip className="size-4 text-brand-mid" strokeWidth={1.75} aria-hidden />
            {busy ? "Enviando…" : "Adicionar arquivo"}
            <input
              type="file"
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-[0.8125rem] text-muted-foreground">Qualquer formato, até 20 MB. Arquivos são sempre baixados, nunca abertos no navegador.</p>
        </>
      )}
      {(error || list.error) && <p role="alert" className={MSG_ERROR}>{error ?? list.error}</p>}
      <ConfirmDialog
        open={!!removing}
        title="Remover arquivo?"
        description={removing ? `"${removing.file_name}" será removido deste item.` : undefined}
        confirmLabel="Remover"
        destructive
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
