"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, ROW, ROW_LIST, SELECT_CLASS } from "@/lib/ui";
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
    <div className="max-w-xl space-y-5">
      <ul className={ROW_LIST}>
        {(members.data ?? []).map((m) => (
          <li key={m.user_id} className={ROW}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-shallow text-xs text-foreground" aria-hidden>
                {initials(m.profiles?.name ?? "?")}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{m.profiles?.name ?? "—"}</span>
                {m.user_id === managerId && <span className="block text-[0.8125rem] text-brand-mid">Gerente do projeto</span>}
              </span>
            </span>
            <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              {m.profiles ? ROLE_LABEL[m.profiles.role] : ""}
              {canManage && m.user_id !== managerId && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${m.profiles?.name ?? "membro"}`}
                  className="-mr-2 hover:text-destructive"
                  onClick={() => remove(m.user_id)}
                >
                  <X strokeWidth={1.75} />
                </Button>
              )}
            </span>
          </li>
        ))}
        {members.data?.length === 0 && <li className="text-sm text-muted-foreground">Nenhum membro. Adicione pessoas abaixo.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="flex gap-2">
          <select aria-label="Pessoa" required className={`${SELECT_CLASS} min-w-0 flex-1`} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Adicionar pessoa…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({ROLE_LABEL[o.role]})</option>
            ))}
          </select>
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      {(error || members.error) && <p role="alert" className={MSG_ERROR}>{error ?? members.error}</p>}
    </div>
  );
}
