"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { SELECT_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { DOC_CATEGORY_LABEL, type DocCategory } from "@/types/domain";
import { Select } from "@/components/ui/select";

const NO_PERMISSION = "Você não tem permissão para categorizar este documento.";
export const DOC_CATEGORIES = Object.keys(DOC_CATEGORY_LABEL) as DocCategory[];

// Quem pode categorizar: quem enviou ou o gerente do projeto (admin sempre). Só UX: a RLS decide.
export function useCanCategorize() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const managed = useQuery<{ id: string }[]>(
    () =>
      profile && !isAdmin && !profile.is_external
        ? getSupabase().from("projects").select("id").eq("manager_id", profile.id)
        : Promise.resolve({ data: [], error: null }),
    [profile?.id, isAdmin],
  );
  const ids = new Set((managed.data ?? []).map((p) => p.id));
  return (projectId: string, uploadedBy: string | null) =>
    !!profile && (isAdmin || uploadedBy === profile.id || ids.has(projectId));
}

// Categoria de um anexo: seletor para quem pode editar, texto para os demais.
export function DocCategoryField({
  id,
  fileName,
  value,
  editable,
  onSaved,
  onError,
  className,
}: {
  id: string;
  fileName: string;
  value: DocCategory | null;
  editable: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  if (!editable)
    return value ? <span>{DOC_CATEGORY_LABEL[value]}</span> : <span className="text-muted-foreground">Sem categoria</span>;

  async function change(next: DocCategory | "") {
    setBusy(true);
    const { data, error } = await getSupabase()
      .from("task_attachments")
      .update({ doc_category: next || null })
      .eq("id", id)
      .select("id");
    setBusy(false);
    if (error) return onError(error.code === "42501" ? NO_PERMISSION : error.message);
    if (!data?.length) return onError(NO_PERMISSION);
    onSaved();
  }

  return (
    <Select
      aria-label={`Categoria de ${fileName}`}
      className={cn(SELECT_CLASS, "px-2", className)}
      value={value ?? ""}
      disabled={busy}
      onChange={(e) => change(e.target.value as DocCategory | "")}
    >
      <option value="">Sem categoria</option>
      {DOC_CATEGORIES.map((c) => (
        <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>
      ))}
    </Select>
  );
}
