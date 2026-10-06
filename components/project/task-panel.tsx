"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase/client";
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
const SELECT_CLASS = "h-8 w-full rounded-lg border bg-background px-2 text-sm";

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
  if (!task) return null;
  // key força o formulário a reinicializar ao trocar de tarefa.
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Detalhes da tarefa"
        className="h-full w-full max-w-xl space-y-6 overflow-y-auto bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}>
            <X />
          </Button>
        </div>
        <Details key={taskId} task={task} categories={categories} people={people} onChanged={onChanged} onClose={onClose} />
        <Checklist taskId={taskId} />
        <Attachments taskId={taskId} projectId={task.project_id} />
        <Comments taskId={taskId} isExternal={isExternal} />
      </aside>
    </div>
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
    <form onSubmit={save} className="space-y-3">
      <Input aria-label="Título" className="text-base font-semibold" required value={form.title} onChange={(e) => set("title", e.target.value)} />
      <textarea
        aria-label="Descrição"
        placeholder="Descrição"
        rows={4}
        className="w-full rounded-lg border bg-background p-2 text-sm"
        value={form.description}
        onChange={(e) => set("description", e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Status</Label>
          <select className={SELECT_CLASS} value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Responsável</Label>
          <select className={SELECT_CLASS} value={form.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
            <option value="">Sem responsável</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Escopo</Label>
          <select className={SELECT_CLASS} value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
            <option value="">Sem escopo</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div />
        <div className="space-y-1">
          <Label>Início</Label>
          <Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Prazo</Label>
          <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-between">
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        <Button type="button" variant="destructive" onClick={remove}>Excluir</Button>
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
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Checklist {list.length > 0 && <span className="font-normal text-muted-foreground">({doneCount}/{list.length})</span>}</h3>
      <ul className="space-y-1">
        {list.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={i.done} onChange={() => toggle(i)} aria-label={i.text} />
            <span className={i.done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{i.text}</span>
            <button type="button" aria-label="Remover item" className="text-muted-foreground hover:text-destructive" onClick={() => remove(i.id)}>
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input placeholder="Novo item" required value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="outline">Adicionar</Button>
      </form>
      {(error || items.error) && <p role="alert" className="text-sm text-destructive">{error ?? items.error}</p>}
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
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Anexos</h3>
      <ul className="space-y-1 text-sm">
        {(list.data ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2">
            <button type="button" className="truncate text-left text-primary hover:underline" onClick={() => download(a)}>
              {a.file_name}
            </button>
            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {formatSize(a.size_bytes)}
              {profile && !profile.is_external && (
                <button type="button" aria-label="Remover anexo" className="hover:text-destructive" onClick={() => remove(a)}>
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <input
        type="file"
        disabled={busy}
        aria-label="Adicionar anexo"
        className="text-sm"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">Qualquer formato, até 20 MB. Arquivos são sempre baixados, nunca abertos no navegador.</p>
      {(error || list.error) && <p role="alert" className="text-sm text-destructive">{error ?? list.error}</p>}
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
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Comentários</h3>
      <ul className="space-y-2">
        {(list.data ?? []).map((c) => (
          <li key={c.id} className="rounded-lg border p-2 text-sm">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>
                {c.profiles?.name ?? "—"}
                {c.is_internal && <span className="ml-2 rounded bg-muted px-1.5 py-0.5">interno</span>}
              </span>
              <time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time>
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Sem comentários.</li>}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <textarea aria-label="Novo comentário" placeholder="Escreva um comentário" required rows={2} className="w-full rounded-lg border bg-background p-2 text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center justify-between">
          {!isExternal ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Interno (oculto para externos)
            </label>
          ) : (
            <span />
          )}
          <Button type="submit" variant="outline">Comentar</Button>
        </div>
      </form>
      {(error || list.error) && <p role="alert" className="text-sm text-destructive">{error ?? list.error}</p>}
    </section>
  );
}
