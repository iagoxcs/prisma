"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { ClientsList } from "@/components/clients/clients-list";
import { KnowledgeList } from "@/components/knowledge/knowledge-list";
import { AuditTab } from "@/components/settings/audit-tab";
import { GeneralTab } from "@/components/settings/general-tab";
import { PermissionsTab } from "@/components/settings/permissions-tab";
import { UsersTab } from "@/components/settings/users-tab";
import type { Permission } from "@/lib/permissions";
import { SEGMENTED, SEGMENT_ITEM } from "@/lib/ui";

// Quem vê cada aba (só UX: a regra real é o RLS). Conhecimento: internos. Clientes: clients.view. O resto: admin.
const TABS = [
  { id: "conhecimento", label: "Conhecimento" },
  { id: "clientes", label: "Clientes", perm: "clients.view" },
  { id: "geral", label: "Parâmetros", adminOnly: true },
  { id: "usuarios", label: "Usuários", adminOnly: true },
  { id: "permissoes", label: "Perfis e permissões", adminOnly: true },
  { id: "auditoria", label: "Auditoria", adminOnly: true },
] as const satisfies readonly { id: string; label: string; perm?: Permission; adminOnly?: boolean }[];
type TabId = (typeof TABS)[number]["id"];

// Módulo de configurações: base de conhecimento, clientes, parâmetros e gestão de usuários.
// A aba fica na URL (?tab=) para o "voltar" de um item da base cair no lugar certo.
function Configuracoes() {
  const { profile, can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const visible = TABS.filter(
    (t) =>
      !profile?.is_external &&
      (!("adminOnly" in t) || profile?.role === "admin") &&
      (!("perm" in t) || can(t.perm)),
  );
  if (visible.length === 0) return <p className="text-sm">Acesso restrito.</p>;

  const requested = params.get("tab");
  const tab: TabId = visible.find((t) => t.id === requested)?.id ?? visible[0].id;
  const select = (id: TabId) => {
    const q = new URLSearchParams(params.toString());
    q.set("tab", id);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <h1>Configurações</h1>
      <div role="tablist" aria-label="Seções de configuração" className={SEGMENTED}>
        {visible.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => select(t.id)} className={SEGMENT_ITEM}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "conhecimento" && <KnowledgeList />}
      {tab === "clientes" && <ClientsList />}
      {tab === "geral" && <GeneralTab />}
      {tab === "usuarios" && <UsersTab />}
      {tab === "permissoes" && <PermissionsTab />}
      {tab === "auditoria" && <AuditTab />}
    </div>
  );
}

export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={null}>
      <Configuracoes />
    </Suspense>
  );
}
