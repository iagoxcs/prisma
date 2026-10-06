"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Download, Paperclip, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateTime } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, SELECT_CLASS as BASE_SELECT, TEXTAREA_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import {
  MAX_ATTACHMENT_BYTES,
  TASK_STATUS_LABEL,
  type Attachment,
  type Category,
  type ChecklistItem,
  type Person,
  type Task,
  type TaskComment,
  type TaskStatus,
} from "@/types/domain";

const BUCKET = "task-attachments";
const SELECT_CLASS = `${BASE_SELECT} w-full`;

export function TaskPanel({
  taskId,
  task,
  categories,
  people,
  isExternal,
  onClose,
  onChanged,
}: {
  taskId: string;
  task: Task | undefined;
  categories: Category[];
  people: Person[];
  isExternal: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;
  // Portal para o <body>: a lâmina (<main>) tem backdrop-filter, que prenderia o position: fixed
  // dentro dela e aninharia o blur do drawer. Fora dela, o drawer é um glass-painel legítimo.
  // key força o formulário a reinicializar ao trocar de tarefa.
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-background/40 p-0 md:p-5" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes da tarefa"
        className="glass-painel h-full w-full max-w-xl space-y-7 overflow-y-auto rounded-none p-6 md:rounded-2xl md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-[0.8125rem] font-medium text-muted-foreground">Detalhes da tarefa</span>
          <Button variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}>
            <X strokeWidth={1.75} />
          </Button>
        </div>
        <Details key={taskId} task={task} categories={categories} people={people} onChanged={onChanged} onClose={onClose} />
        <Checklist taskId={taskId} />
        <Attachments taskId={taskId} projectId={task.project_id} />
        <Comments taskId={taskId} isExternal={isExternal} />
      </aside>
    </div>,
    document.body,
  );
}

function Details({
  task,
  categories,
  people,
  onChanged,
  onClose,
}: {
  task: Task;
  categories: Category[];
  people: Person[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    assignee_id: task.assignee_id ?? "",
    category_id: task.category_id ?? "",
    start_date: task.start_date ?? "",
    due_date: task.due_date ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase()
      .from("tasks")
      .update({
        title: form.title.trim(),
        description: form.description || null,
        status: form.status,
        assignee_id: form.assignee_id || null,
        category_id: form.category_id || null,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      })
      .eq("id", task.id);
    setBusy(false);
    if (error) return setError(error.message);
    onChanged();
  }

  async function remove() {
    if (!confirm("Excluir esta tarefa? Esta ação não pode ser desfeita.")) return;
    const { error } = await getSupabase().from("tasks").delete().eq("id", task.id);
    if (error) return setError(error.message);
    onChanged();
    onClose();
  }

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={save} className="space-y-4">
      <Input aria-label="Título" className="h-12 text-lg font-semibold md:text-lg" required value={form.title} onChange={(e) => set("title", e.target.value)} />
      <textarea
        aria-label="Descrição"
        placeholder="Descrição"
        rows={4}
        className={TEXTAREA_CLASS}
        value={form.description}
        onChange={(e) => set("description", e.target.value)}
      />
      <div className="glass-coluna grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="t-status">Status</Label>
          <select id="t-status" className={SELECT_CLASS} value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-assignee">Responsável</Label>
          <select id="t-assignee" className={SELECT_CLASS} value={form.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
            <option value="">Sem responsável</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="t-scope">Escopo</Label>
          <select id="t-scope" className={SELECT_CLASS} value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
            <option value="">Sem escopo</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-start">Início</Label>
          <Input id="t-start" type="date" className="num" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-due">Prazo</Label>
          <Input id="t-due" type="date" className="num" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <div className="flex justify-between gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove}>Excluir tarefa</Button>
      </div>
    </form>
  );
}

function Checklist({ taskId }: { taskId: string }) {
  const items = useQuery<ChecklistItem[]>(
    () => getSupabase().from("checklist_items").select("id, task_id, text, done, position").eq("task_id", taskId).order("position").order("created_at"),
    [taskId],
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = items.data ?? [];
  const doneCount = list.filter((i) => i.done).length;

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await getSupabase()
      .from("checklist_items")
      .insert({ task_id: taskId, text: text.trim(), position: list.length });
    if (error) return setError(error.message);
    setText("");
    items.reload();
  }

  async function toggle(i: ChecklistItem) {
    const { error } = await getSupabase().from("checklist_items").update({ done: !i.done }).eq("id", i.id);
    if (error) setError(error.message);
    items.reload();
  }

  async function remove(id: string) {
    const { error } = await getSupabase().from("checklist_items").delete().eq("id", id);
    if (error) setError(error.message);
    items.reload();
  }

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2">
        Checklist
        {list.length > 0 && <span className="num text-sm font-normal text-muted-foreground">{doneCount}/{list.length}</span>}
      </h3>
      {list.length > 0 && (
        <div className="h-1 overflow-hidden rounded-full bg-brand-shallow" role="progressbar" aria-valuemin={0} aria-valuemax={list.length} aria-valuenow={doneCount} aria-label="Progresso do checklist">
          <div className="h-full rounded-full bg-status-doing transition-[width] duration-200" style={{ width: `${(doneCount / list.length) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-0.5">
        {list.map((i) => (
          <li key={i.id} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={i.done} onChange={() => toggle(i)} aria-label={i.text} />
            <span className={i.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{i.text}</span>
            <Button variant="ghost" size="icon-sm" aria-label={`Remover item ${i.text}`} className="text-muted-foreground hover:text-destructive" onClick={() => remove(i.id)}>
              <X strokeWidth={1.75} />
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input placeholder="Novo item" aria-label="Novo item do checklist" required value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="outline">Adicionar</Button>
      </form>
      {(error || items.error) && <p role="alert" className={MSG_ERROR}>{error ?? items.error}</p>}
    </section>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Attachments({ taskId, projectId }: { taskId: string; projectId: string }) {
  const { profile } = useAuth();
  const list = useQuery<Attachment[]>(
    () => getSupabase().from("task_attachments").select("id, task_id, storage_path, file_name, size_bytes").eq("task_id", taskId).order("created_at"),
    [taskId],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) return setError("O arquivo excede o limite de 20 MB.");
    if (file.size === 0) return setError("O arquivo está vazio.");
    setBusy(true);
    const supabase = getSupabase();
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${projectId}/${taskId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/octet-stream" });
    if (up.error) {
      setBusy(false);
      return setError(up.error.message);
    }
    const ins = await supabase.from("task_attachments").insert({
      task_id: taskId,
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

  // Sempre download (RNF-04): URL assinada de curta duração com Content-Disposition: attachment.
  async function download(a: Attachment) {
    const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(a.storage_path, 60, { download: a.file_name });
    if (error || !data) return setError(error?.message ?? "Falha ao gerar o link.");
    window.location.assign(data.signedUrl);
  }

  async function remove(a: Attachment) {
    if (!confirm(`Remover "${a.file_name}"?`)) return;
    const supabase = getSupabase();
    const del = await supabase.from("task_attachments").delete().eq("id", a.id);
    if (del.error) return setError(del.error.message);
    await supabase.storage.from(BUCKET).remove([a.storage_path]);
    list.reload();
  }

  return (
    <section className="space-y-3">
      <h3>Anexos</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {(list.data ?? []).map((a) => (
          <li key={a.id} className="surface-card flex min-h-11 items-center justify-between gap-2 py-1 pr-1 pl-3">
            <button type="button" className="flex min-w-0 items-center gap-2 text-left font-medium hover:underline" onClick={() => download(a)}>
              <Download className="size-4 shrink-0 text-brand-mid" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{a.file_name}</span>
            </button>
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <span className="num text-xs">{formatSize(a.size_bytes)}</span>
              {profile && !profile.is_external && (
                <Button variant="ghost" size="icon-sm" aria-label={`Remover anexo ${a.file_name}`} className="hover:text-destructive" onClick={() => remove(a)}>
                  <X strokeWidth={1.75} />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <label className="surface-card flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium hover:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-ring">
        <Paperclip className="size-4 text-brand-mid" strokeWidth={1.75} aria-hidden />
        {busy ? "Enviando…" : "Adicionar anexo"}
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
      {(error || list.error) && <p role="alert" className={MSG_ERROR}>{error ?? list.error}</p>}
    </section>
  );
}

function Comments({ taskId, isExternal }: { taskId: string; isExternal: boolean }) {
  const list = useQuery<TaskComment[]>(
    () =>
      getSupabase()
        .from("comments")
        .select("id, task_id, author_id, body, is_internal, created_at, profiles(name)")
        .eq("task_id", taskId)
        .order("created_at")
        .then((r) => ({ data: r.data as unknown as TaskComment[] | null, error: r.error })),
    [taskId],
  );
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await getSupabase().from("comments").insert({ task_id: taskId, body: body.trim(), is_internal: internal });
    if (error) return setError(error.message);
    setBody("");
    list.reload();
  }

  return (
    <section className="space-y-3">
      <h3>Comentários</h3>
      <ul className="flex flex-col gap-2">
        {(list.data ?? []).map((c) => (
          <li key={c.id} className="surface-card space-y-1.5 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span className="font-semibold text-foreground">{c.profiles?.name ?? "—"}</span>
              {c.is_internal && <span className="rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground">Interno</span>}
              <time dateTime={c.created_at} className="num ml-auto text-xs">{dateTime(c.created_at)}</time>
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Sem comentários. Escreva o primeiro abaixo.</li>}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <textarea aria-label="Novo comentário" placeholder="Escreva um comentário" required rows={2} className={TEXTAREA_CLASS} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center justify-between gap-2">
          {!isExternal ? (
            <label className="flex min-h-11 items-center gap-2 text-[0.8125rem]">
              <input type="checkbox" className="size-4 accent-primary" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Interno (oculto para externos)
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" variant="outline">Comentar</Button>
        </div>
      </form>
      {(error || list.error) && <p role="alert" className={MSG_ERROR}>{error ?? list.error}</p>}
    </section>
  );
}
