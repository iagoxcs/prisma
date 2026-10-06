"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { ROLE_LABEL, type Person, type UserRole } from "@/types/domain";

interface MemberRow {
  user_id: string;
  project_role: string;
  profiles: { name: string; role: UserRole } | null;
}

export function MembersPanel({
  projectId,
  managerId,
  canManage,
  onChanged,
}: {
  projectId: string;
  managerId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const members = useQuery<MemberRow[]>(
    () =>
      getSupabase()
        .from("project_members")
        .select("user_id, project_role, profiles(name, role)")
        .eq("project_id", projectId)
        .then((r) => ({ data: r.data as unknown as MemberRow[] | null, error: r.error })),
    [projectId],
  );
  const candidates = useQuery<(Person & { role: UserRole })[]>(
    () => (canManage ? getSupabase().from("profiles").select("id, name, role").eq("active", true).order("name") : Promise.resolve({ data: [], error: null })),
    [canManage],
  );
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const memberIds = new Set((members.data ?? []).map((m) => m.user_id));
  const options = (candidates.data ?? []).filter((c) => !memberIds.has(c.id));

  async function add(e: FormEvent) {
    e.preventDefault();
    const person = options.find((o) => o.id === userId);
    if (!person) return;
    setError(null);
    const { error } = await getSupabase()
      .from("project_members")
      .insert({ project_id: projectId, user_id: userId, project_role: person.role === "admin" ? "gerente" : person.role });
    if (error) return setError(error.message);
    setUserId("");
    members.reload();
    onChanged();
  }

  async function remove(id: string) {
    const { error } = await getSupabase().from("project_members").delete().eq("project_id", projectId).eq("user_id", id);
    if (error) return setError(error.message);
    members.reload();
    onChanged();
  }

  return (
    <div className="max-w-xl space-y-4">
      <ul className="divide-y rounded-lg border">
        {(members.data ?? []).map((m) => (
          <li key={m.user_id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span>
              {m.profiles?.name ?? "—"}
              {m.user_id === managerId && <span className="ml-2 text-xs text-muted-foreground">gerente do projeto</span>}
            </span>
            <span className="flex items-center gap-3 text-xs text-muted-foreground">
              {m.profiles ? ROLE_LABEL[m.profiles.role] : ""}
              {canManage && m.user_id !== managerId && (
                <button type="button" aria-label="Remover membro" className="hover:text-destructive" onClick={() => remove(m.user_id)}>
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          </li>
        ))}
        {members.data?.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Nenhum membro.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="flex gap-2">
          <select aria-label="Pessoa" required className="h-8 flex-1 rounded-lg border bg-background px-2 text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Adicionar pessoa…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({ROLE_LABEL[o.role]})</option>
            ))}
          </select>
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      {(error || members.error) && <p role="alert" className="text-sm text-destructive">{error ?? members.error}</p>}
    </div>
  );
}
