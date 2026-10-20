"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, SELECT_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { KNOWLEDGE_KIND_LABEL, type KnowledgeKind } from "@/types/domain";
import { Select } from "@/components/ui/select";

const LABEL = "block text-[0.8125rem] font-medium text-muted-foreground";

// Cria o item como rascunho e leva direto para a edição. Modelo exige a metodologia de origem;
// com `methodologyId`, cria um modelo já vinculado (botão da página da metodologia).
export function NewItem({
  methodologyId,
  label = "Novo item",
  onCreated,
}: {
  methodologyId?: string;
  label?: string;
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<KnowledgeKind>(methodologyId ? "modelo" : "metodologia");
  const [methodology, setMethodology] = useState(methodologyId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const methodologies = useQuery<{ id: string; title: string }[]>(
    () =>
      open && !methodologyId
        ? getSupabase().from("knowledge_items").select("id, title").eq("kind", "metodologia").order("title")
        : Promise.resolve({ data: [], error: null }),
    [open, methodologyId],
  );

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind === "modelo" && !methodology) return setError("Escolha a metodologia do modelo.");
    setBusy(true);
    const { data, error } = await getSupabase()
      .from("knowledge_items")
      .insert({ title: title.trim(), kind, methodology_id: kind === "modelo" ? methodology : null, status: "rascunho" })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) return setError(error?.code === "42501" ? "Você não tem permissão para criar itens." : (error?.message ?? "Falha ao criar."));
    onCreated(data.id as string);
  }

  if (!open)
    return (
      <Button type="button" variant={methodologyId ? "outline" : "default"} onClick={() => setOpen(true)}>
        <Plus strokeWidth={1.75} aria-hidden /> {label}
      </Button>
    );

  return (
    <form onSubmit={create} className="glass-coluna flex w-full flex-wrap items-end gap-3 p-4 text-sm">
      <label className="min-w-64 flex-1 space-y-1.5">
        <span className={LABEL}>Título</span>
        <Input required maxLength={200} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {!methodologyId && (
        <label className="space-y-1.5">
          <span className={LABEL}>Tipo</span>
          <Select className={SELECT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
            {(Object.keys(KNOWLEDGE_KIND_LABEL) as KnowledgeKind[]).map((k) => (
              <option key={k} value={k}>{KNOWLEDGE_KIND_LABEL[k]}</option>
            ))}
          </Select>
        </label>
      )}
      {!methodologyId && kind === "modelo" && (
        <label className="space-y-1.5">
          <span className={LABEL}>Metodologia</span>
          <Select className={SELECT_CLASS} required value={methodology} onChange={(e) => setMethodology(e.target.value)}>
            <option value="">Escolher…</option>
            {(methodologies.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </Select>
        </label>
      )}
      <Button type="submit" disabled={busy || !title.trim()}>{busy ? "Criando…" : "Criar rascunho"}</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
      {!methodologyId && kind === "modelo" && methodologies.data?.length === 0 && (
        <p className="w-full text-muted-foreground">Crie uma metodologia antes de cadastrar modelos.</p>
      )}
      {error && <p role="alert" className={cn("w-full", MSG_ERROR)}>{error}</p>}
    </form>
  );
}
