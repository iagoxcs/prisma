"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { CategoriesPanel } from "@/components/project/categories-panel";
import { Kanban } from "@/components/project/kanban";
import { MembersPanel } from "@/components/project/members-panel";
import { Badge } from "@/components/ui/badge";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, type Category, type Person, type Project } from "@/types/domain";

type Tab = "quadro" | "membros" | "escopos";
const TABS: { id: Tab; label: string }[] = [
  { id: "quadro", label: "Quadro" },
  { id: "membros", label: "Membros" },
  { id: "escopos", label: "Escopos" },
];

// Rota por query string (?id=) porque o site é exportado estaticamente.
function ProjetoDetalhe() {
  const id = useSearchParams().get("id") ?? "";
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("quadro");

  const project = useQuery<Project>(
    () =>
      getSupabase()
        .from("projects")
        .select("id, client_id, name, status, manager_id, start_date, end_date, clients(name)")
        .eq("id", id)
        .maybeSingle()
        .then((r) => ({ data: r.data as unknown as Project | null, error: r.error })),
    [id],
  );
  const categories = useQuery<Category[]>(
    () => getSupabase().from("categories").select("id, project_id, name, color").eq("project_id", id).order("name"),
    [id],
  );
  const people = useQuery<Person[]>(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("project_members")
      .select("profiles(id, name)")
      .eq("project_id", id);
    const list = ((data ?? []) as unknown as { profiles: Person | null }[]).flatMap((m) => (m.profiles ? [m.profiles] : []));
    const managerId = project.data?.manager_id;
    if (managerId && !list.some((p) => p.id === managerId)) {
      const mgr = await supabase.from("profiles").select("id, name").eq("id", managerId).maybeSingle();
      if (mgr.data) list.push(mgr.data as Person);
    }
    return { data: list.sort((a, b) => a.name.localeCompare(b.name)), error };
  }, [id, project.data?.manager_id]);

  if (!id) return <p className="text-sm">Projeto não informado.</p>;
  if (project.loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const p = project.data;
  if (!p || !profile) return <p className="text-sm">Projeto não encontrado ou sem acesso.</p>;

  const isManager = profile.role === "admin" || p.manager_id === profile.id;
  const canCreate = !profile.is_external;
  const canManageScopes = isManager || profile.role === "lider";

  return (
    <div className="space-y-4">
      <Link href="/projetos/" className="text-sm text-muted-foreground hover:underline">← Projetos</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <Badge variant="secondary">{PROJECT_STATUS_LABEL[p.status]}</Badge>
        {p.clients?.name && <span className="text-sm text-muted-foreground">{p.clients.name}</span>}
      </div>

      <div role="tablist" className="flex gap-1 border-b">
        {TABS.filter((t) => !(profile.is_external && t.id === "escopos")).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "quadro" && (
        <Kanban projectId={id} categories={categories.data ?? []} people={people.data ?? []} canCreate={canCreate} isExternal={profile.is_external} />
      )}
      {tab === "membros" && <MembersPanel projectId={id} managerId={p.manager_id} canManage={isManager} onChanged={people.reload} />}
      {tab === "escopos" && <CategoriesPanel projectId={id} categories={categories.data ?? []} canManage={canManageScopes} onChanged={categories.reload} />}
    </div>
  );
}

export default function ProjetoPage() {
  return (
    <Suspense fallback={null}>
      <ProjetoDetalhe />
    </Suspense>
  );
}
