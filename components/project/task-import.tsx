"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { CATEGORY_PALETTE } from "@/lib/theme/status";
import { buildPreview, CHECKLIST_SEPARATOR, readCsvFile, TEMPLATE_HEADERS, templateCsv, type ImportPreview } from "@/lib/task-csv";
import { TaskExport } from "@/components/project/task-export";
import { MSG_ERROR, MSG_OK, SEGMENT_ITEM, SELECT_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { TASK_STATUS_LABEL, type Category, type Person, type Task, type TaskStatus } from "@/types/domain";
import { Select } from "@/components/ui/select";

const BATCH = 500;

// Modelos publicados na Base de Conhecimento que têm planilha de fases.
type KnowledgeModel = { id: string; title: string; methodology: { title: string } | null };

// Diálogo de importação de tarefas por CSV. Só "Título" é obrigatório.
export function TaskImport({
  projectId,
  tasks,
  categories,
  people,
  canManageScopes,
  canImport,
  filteredTasks,
  filtering,
  initialTab,
  onClose,
  onImported,
}: {
  projectId: string;
  tasks: Task[];
  categories: Category[];
  people: Person[];
  canManageScopes: boolean;
  canImport: boolean;
  filteredTasks: Task[];
  filtering: boolean;
  initialTab: "import" | "export";
  onClose: () => void;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<"import" | "export">(canImport ? initialTab : "export");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
  const models = useQuery<KnowledgeModel[]>(
    () =>
      getSupabase()
        .from("knowledge_items")
        .select("id, title, methodology:methodology_id(title)")
        .eq("kind", "modelo")
        .eq("status", "publicado")
        .not("template_csv", "is", null)
        .order("title")
        .then((r) => ({ data: r.data as unknown as KnowledgeModel[] | null, error: r.error })),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setError(null);
    setDone(null);
    if (!file) return;
    setModelId("");
    setFileName(file.name);
    setPreview(buildPreview(await readCsvFile(file), categories, people));
  }

  // Planilha de fases de um modelo da base: mesmo fluxo de pré-visualização do arquivo.
  async function pickModel(id: string) {
    setModelId(id);
    setError(null);
    setDone(null);
    setPreview(null);
    setFileName("");
    if (!id) return;
    const { data, error } = await getSupabase().from("knowledge_items").select("title, template_csv").eq("id", id).maybeSingle();
    if (error || !data?.template_csv) return setError(error?.message ?? "O modelo não tem planilha de fases.");
    setFileName(`Modelo: ${data.title}`);
    setPreview(buildPreview(data.template_csv as string, categories, people));
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "modelo-tarefas.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function run() {
    if (!preview || preview.tasks.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();

    // Escopos citados que ainda não existem: cria (se puder) e liga às tarefas.
    const created = new Map<string, string>();
    if (canManageScopes && preview.newCategories.length > 0) {
      const { data, error } = await supabase
        .from("categories")
        .insert(
          preview.newCategories.map((name, i) => ({
            project_id: projectId,
            name,
            color: CATEGORY_PALETTE[(categories.length + i) % CATEGORY_PALETTE.length].light,
          })),
        )
        .select("id, name");
      if (error) {
        setBusy(false);
        return setError(`Não foi possível criar os escopos: ${error.message}`);
      }
      for (const c of data ?? []) created.set(c.name, c.id);
    }

    // Novas tarefas entram no fim de cada coluna, na ordem do arquivo.
    const next: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
    for (const s of Object.keys(next) as TaskStatus[]) {
      next[s] = Math.max(0, ...tasks.filter((t) => t.status === s).map((t) => t.position));
    }
    const rows = preview.tasks.map((t) => ({
      project_id: projectId,
      title: t.title,
      description: t.description,
      status: t.status,
      category_id: t.category_id ?? (t.new_category ? (created.get(t.new_category) ?? null) : null),
      assignee_id: t.assignee_id,
      client_owner: t.client_owner,
      start_date: t.start_date,
      due_date: t.due_date,
      position: ++next[t.status],
    }));

    let imported = 0;
    let checklistFailed = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { data, error } = await supabase.from("tasks").insert(chunk).select("id");
      if (error) {
        setBusy(false);
        onImported();
        const prefix = imported > 0 ? `${imported} tarefa(s) importada(s); o restante falhou: ` : "";
        return setError(prefix + error.message);
      }
      imported += chunk.length;

      const items = (data ?? []).flatMap((row, j) =>
        preview.tasks[i + j].checklist.map((text, position) => ({ task_id: row.id, text, position })),
      );
      if (items.length > 0) {
        const { error } = await supabase.from("checklist_items").insert(items);
        if (error) checklistFailed += items.length;
      }
    }

    setBusy(false);
    setPreview(null);
    setFileName("");
    onImported();
    setDone(
      `${imported} tarefa(s) importada(s).` +
        (checklistFailed > 0 ? ` ${checklistFailed} item(ns) de checklist não foram gravados por falta de permissão.` : ""),
    );
  }

  const unmatchedScopes = !canManageScopes && preview ? preview.newCategories : [];

  // Portal para o <body>: a lâmina (<main>) tem backdrop-filter, que prenderia o position: fixed dentro dela.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-background/60 p-0 md:p-8" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Importar e exportar tarefas"
        className="min-h-full w-full max-w-2xl space-y-6 border-glass-edge bg-popover p-6 text-popover-foreground shadow-[var(--glass-shadow)] md:min-h-0 md:rounded-2xl md:border md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2>Importar / Exportar</h2>
          <Button variant="ghost" size="icon" aria-label="Fechar" disabled={busy} onClick={onClose}>
            <X strokeWidth={1.75} />
          </Button>
        </div>

        <div role="tablist" aria-label="Importar ou exportar" className="flex gap-2">
          {canImport && (
            <button type="button" role="tab" aria-selected={tab === "import"} disabled={busy} className={SEGMENT_ITEM} onClick={() => setTab("import")}>
              Importar
            </button>
          )}
          <button type="button" role="tab" aria-selected={tab === "export"} disabled={busy} className={SEGMENT_ITEM} onClick={() => setTab("export")}>
            Exportar
          </button>
        </div>

        {tab === "export" && <TaskExport tasks={tasks} filtered={filteredTasks} filtering={filtering} categories={categories} people={people} />}

        <div className={tab === "import" ? "space-y-3 text-sm" : "hidden"}>
          <p>
            Envie um arquivo CSV com uma tarefa por linha. Só a coluna <strong>Título</strong> é obrigatória; as demais são
            opcionais e podem estar em qualquer ordem.
          </p>
          <ul className="grid gap-1.5 rounded-xl bg-secondary p-4 text-[0.8125rem] text-muted-foreground sm:grid-cols-2">
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.title}</span> · obrigatório</li>
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.description}</span> · texto livre</li>
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.status}</span> · {Object.values(TASK_STATUS_LABEL).join(", ")}</li>
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.category}</span> · nome do escopo</li>
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.assignee}</span> · nome de um membro</li>
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.client_owner}</span> · texto livre</li>
            <li><span className="font-medium text-foreground">{TEMPLATE_HEADERS.start_date}</span> e <span className="font-medium text-foreground">{TEMPLATE_HEADERS.due_date}</span> · DD/MM/AAAA</li>
            <li className="sm:col-span-2"><span className="font-medium text-foreground">{TEMPLATE_HEADERS.checklist}</span> · itens separados por <span className="num">{CHECKLIST_SEPARATOR}</span></li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download strokeWidth={1.75} aria-hidden /> Baixar modelo
            </Button>
            <label className="inline-flex h-11 cursor-pointer items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
              Escolher arquivo
              <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={pick} />
            </label>
            {fileName && <span className="num truncate text-[0.8125rem] text-muted-foreground">{fileName}</span>}
          </div>
          {(models.data ?? []).length > 0 && (
            <label className="block space-y-1.5">
              <span className="block text-[0.8125rem] font-medium text-muted-foreground">Ou use um modelo da Base de conhecimento</span>
              <Select className={SELECT_CLASS + " w-full"} value={modelId} disabled={busy} onChange={(e) => pickModel(e.target.value)}>
                <option value="">Escolher modelo…</option>
                {(models.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.methodology ? `${m.methodology.title} · ${m.title}` : m.title}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>

        {tab === "import" && preview && (
          <div className="space-y-4 text-sm">
            <p className="font-medium">
              {preview.tasks.length} tarefa(s) prontas para importar
              {preview.skipped.length > 0 && `, ${preview.skipped.length} linha(s) ignorada(s)`}.
            </p>
            {canManageScopes && preview.newCategories.length > 0 && (
              <p className="text-muted-foreground">Novos escopos serão criados: {preview.newCategories.join(", ")}.</p>
            )}
            {unmatchedScopes.length > 0 && (
              <p className="text-warning">
                Escopos inexistentes no projeto (as tarefas ficarão sem escopo): {unmatchedScopes.join(", ")}.
              </p>
            )}
            {preview.unknownColumns.length > 0 && (
              <p className="text-muted-foreground">Colunas ignoradas: {preview.unknownColumns.join(", ")}.</p>
            )}
            <Issues title="Linhas ignoradas" items={preview.skipped.map((s) => ({ line: s.line, text: s.reason }))} className={MSG_ERROR} />
            <Issues title="Avisos" items={preview.warnings.map((w) => ({ line: w.line, text: w.message }))} className="text-warning" />

            {preview.tasks.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-xl border border-border">
                <table className="w-full text-left text-[0.8125rem]">
                  <thead className="sticky top-0 bg-popover text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Linha</th>
                      <th className="px-3 py-2 font-medium">Título</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.tasks.slice(0, 100).map((t) => (
                      <tr key={t.line} className="border-t border-border">
                        <td className="num px-3 py-2 text-muted-foreground">{t.line}</td>
                        <td className="px-3 py-2">{t.title}</td>
                        <td className="px-3 py-2">{TASK_STATUS_LABEL[t.status]}</td>
                        <td className="num px-3 py-2">{t.due_date ? brDate(t.due_date) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.tasks.length > 100 && (
                  <p className="border-t border-border px-3 py-2 text-muted-foreground">… e mais {preview.tasks.length - 100}.</p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "import" && error && <p role="alert" className={MSG_ERROR}>{error}</p>}
        {tab === "import" && done && <p role="status" className={MSG_OK}>{done}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{done || tab === "export" ? "Fechar" : "Cancelar"}</Button>
          {tab === "import" && (
            <Button type="button" disabled={busy || !preview || preview.tasks.length === 0} onClick={run}>
              {busy ? "Importando…" : `Importar ${preview?.tasks.length ?? 0} tarefa(s)`}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Issues({ title, items, className }: { title: string; items: { line: number; text: string }[]; className: string }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-xl bg-secondary px-4 py-3">
      <summary className="cursor-pointer font-medium">
        {title} <span className="num text-muted-foreground">({items.length})</span>
      </summary>
      <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[0.8125rem]">
        {items.map((it, i) => (
          <li key={i} className={className}>
            <span className="num">Linha {it.line}</span> · {it.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

