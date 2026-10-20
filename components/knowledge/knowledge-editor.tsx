"use client";

import { useRef, useState, type FormEvent } from "react";
import { Download, FileUp } from "lucide-react";
import { PhaseList } from "@/components/knowledge/phase-list";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { saveText } from "@/lib/attachments";
import { getSupabase } from "@/lib/supabase/client";
import { readCsvFile, templateCsv, templatePhases } from "@/lib/task-csv";
import { MSG_ERROR, SELECT_CLASS, TEXTAREA_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { KNOWLEDGE_KIND_LABEL, PRISMA_STAGE_LABEL, type KnowledgeItem, type KnowledgeStatus, type PrismaStage } from "@/types/domain";

const NO_PERMISSION = "Você não tem permissão para editar este item.";
const LABEL = "block text-[0.8125rem] font-medium text-muted-foreground";
const MAX_BODY = 200000;
const MAX_TEMPLATE = 1048576;
const MD_EXT = [".md", ".markdown"];

// "Processos, BPM , processos" → ["processos", "bpm"]
const parseTags = (raw: string) => [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];

// Edição de item (admin/gerente). A RLS é a regra real: update sem linha devolvida = sem permissão.
// Metodologia: conteúdo em Markdown (importado de .md). Modelo: metodologia de origem + planilha de fases.
export function KnowledgeEditor({
  item,
  onSaved,
  onDeleted,
  onCancel,
}: {
  item: KnowledgeItem;
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const isModel = item.kind === "modelo";
  const [title, setTitle] = useState(item.title);
  const [methodology, setMethodology] = useState(item.methodology_id ?? "");
  const [stage, setStage] = useState<PrismaStage | "">(item.prisma_stage ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [summary, setSummary] = useState(item.summary ?? "");
  const [body, setBody] = useState(item.body ?? "");
  const [sourceFile, setSourceFile] = useState(item.source_file_name);
  const [template, setTemplate] = useState(item.template_csv);
  const [templateFile, setTemplateFile] = useState(item.template_file_name);
  const [fileError, setFileError] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mdRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const methodologies = useQuery<{ id: string; title: string }[]>(
    () =>
      isModel
        ? getSupabase().from("knowledge_items").select("id, title").eq("kind", "metodologia").order("title")
        : Promise.resolve({ data: [], error: null }),
    [isModel],
  );

  const phases = template ? templatePhases(template) : null;

  async function importMarkdown(file: File) {
    setFileError([]);
    if (!MD_EXT.some((ext) => file.name.toLowerCase().endsWith(ext))) return setFileError(["Formato não suportado. Envie um arquivo .md."]);
    const text = await file.text();
    if (!text.trim()) return setFileError(["O arquivo está vazio."]);
    if (text.length > MAX_BODY) return setFileError(["O arquivo passa de 200 mil caracteres."]);
    setBody(text);
    setSourceFile(file.name);
  }

  async function importTemplate(file: File) {
    setFileError([]);
    if (!file.name.toLowerCase().endsWith(".csv")) return setFileError(["Formato não suportado. Envie a planilha em .csv (no Excel: Salvar como → CSV)."]);
    const text = await readCsvFile(file);
    if (text.length > MAX_TEMPLATE) return setFileError(["A planilha passa de 1 MB."]);
    const check = templatePhases(text);
    if (check.errors.length) return setFileError(check.errors);
    setTemplate(text);
    setTemplateFile(file.name);
  }

  function messageFor(code: string | undefined, message: string) {
    if (code === "42501") return NO_PERMISSION;
    if (message.includes("knowledge_items_publish_ready"))
      return isModel ? "Para publicar o modelo, envie a planilha de fases." : "Para publicar a metodologia, importe ou escreva o conteúdo em Markdown.";
    if (code === "23503") return "Esta metodologia tem modelos vinculados. Exclua os modelos antes.";
    return message;
  }

  async function update(patch: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    const { data, error } = await getSupabase().from("knowledge_items").update(patch).eq("id", item.id).select("id");
    setBusy(false);
    if (error) {
      setError(messageFor(error.code, error.message));
      return false;
    }
    if (!data?.length) {
      setError(NO_PERMISSION);
      return false;
    }
    return true;
  }

  const fields = () => ({
    title: title.trim(),
    prisma_stage: stage || null,
    tags: parseTags(tags),
    summary: summary.trim() || null,
    body: body || null,
    source_file_name: body ? sourceFile : null,
    ...(isModel ? { methodology_id: methodology, template_csv: template, template_file_name: template ? templateFile : null } : {}),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (await update(fields())) onSaved();
  }

  // Publicar/voltar para rascunho também grava o que está no formulário.
  async function setStatus(status: KnowledgeStatus) {
    if (await update({ ...fields(), status })) onSaved();
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const supabase = getSupabase();
    if (!isModel) {
      const models = await supabase.from("knowledge_items").select("id", { count: "exact", head: true }).eq("methodology_id", item.id);
      if ((models.count ?? 0) > 0) {
        setBusy(false);
        setConfirmDelete(false);
        return setError(messageFor("23503", ""));
      }
    }
    // A exclusão em cascata remove só as linhas: os objetos do bucket saem antes.
    const files = await supabase.from("knowledge_files").select("storage_path").eq("item_id", item.id);
    const paths = (files.data ?? []).map((f) => f.storage_path as string);
    if (paths.length) await supabase.storage.from("knowledge-files").remove(paths);
    const { data, error } = await supabase.from("knowledge_items").delete().eq("id", item.id).select("id");
    setBusy(false);
    setConfirmDelete(false);
    if (error) return setError(messageFor(error.code, error.message));
    if (!data?.length) return setError(NO_PERMISSION);
    onDeleted();
  }

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      <p className="text-[0.8125rem] font-semibold text-brand-mid">{KNOWLEDGE_KIND_LABEL[item.kind]}</p>
      <label className="block space-y-1.5">
        <span className={LABEL}>Título</span>
        <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-3">
        {isModel && (
          <label className="space-y-1.5">
            <span className={LABEL}>Metodologia</span>
            <select className={SELECT_CLASS} required value={methodology} onChange={(e) => setMethodology(e.target.value)}>
              {(methodologies.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1.5">
          <span className={LABEL}>Etapa PRISMA</span>
          <select className={SELECT_CLASS} value={stage} onChange={(e) => setStage(e.target.value as PrismaStage | "")}>
            <option value="">Sem etapa</option>
            {(Object.keys(PRISMA_STAGE_LABEL) as PrismaStage[]).map((s) => (
              <option key={s} value={s}>{PRISMA_STAGE_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className="min-w-64 flex-1 space-y-1.5">
          <span className={LABEL}>Tags (separadas por vírgula)</span>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="bpm, mapeamento" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className={LABEL}>Resumo</span>
        <textarea className={cn(TEXTAREA_CLASS, "min-h-20")} maxLength={500} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>

      {isModel && (
        <section className="glass-coluna space-y-3 p-4" aria-labelledby="template-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="template-title" className="font-semibold">Planilha de fases</h3>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => saveText(templateCsv(), "modelo-fases.csv", "text/csv;charset=utf-8")}>
                <Download strokeWidth={1.75} aria-hidden /> Planilha em branco
              </Button>
              <Button type="button" variant="outline" onClick={() => csvRef.current?.click()}>
                <FileUp strokeWidth={1.75} aria-hidden /> {template ? "Trocar planilha" : "Enviar planilha"}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground">
            CSV no formato da importação de tarefas. A coluna <strong>Escopo</strong> é a fase do modelo e é obrigatória em todas as linhas.
          </p>
          {phases && templateFile && <p className="num text-[0.8125rem] text-muted-foreground">{templateFile}</p>}
          {phases && <PhaseList phases={phases.phases} total={phases.tasks} />}
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importTemplate(f);
              e.target.value = "";
            }}
          />
        </section>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="knowledge-body" className={LABEL}>
            {isModel ? "Orientações (Markdown, opcional)" : "Conteúdo da metodologia (Markdown)"}
            {sourceFile && body && <> · importado de <span className="num">{sourceFile}</span></>}
          </label>
          <Button type="button" variant="outline" onClick={() => mdRef.current?.click()}>
            <FileUp strokeWidth={1.75} aria-hidden /> Importar .md
          </Button>
          <input
            ref={mdRef}
            type="file"
            accept={MD_EXT.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importMarkdown(f);
              e.target.value = "";
            }}
          />
        </div>
        <textarea id="knowledge-body" className={cn(TEXTAREA_CLASS, "min-h-80")} maxLength={MAX_BODY} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {fileError.length > 0 && (
        <ul role="alert" className={cn("space-y-1", MSG_ERROR)}>
          {fileError.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>Salvar</Button>
        {item.status === "rascunho" ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStatus("publicado")}>Publicar</Button>
        ) : (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStatus("rascunho")}>Voltar para rascunho</Button>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
        <Button type="button" variant="ghost" className="ml-auto hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Excluir
        </Button>
      </div>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir item?"
        description="O item e seus arquivos serão excluídos. Esta ação não pode ser desfeita."
        confirmLabel="Excluir item"
        destructive
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
