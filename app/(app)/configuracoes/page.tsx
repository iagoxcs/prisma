"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuditTab } from "@/components/settings/audit-tab";
import { GeneralTab } from "@/components/settings/general-tab";
import { PermissionsTab } from "@/components/settings/permissions-tab";
import { UsersTab } from "@/components/settings/users-tab";
import { SEGMENTED, SEGMENT_ITEM } from "@/lib/ui";

const TABS = [
  { id: "geral", label: "Parâmetros" },
  { id: "usuarios", label: "Usuários" },
  { id: "permissoes", label: "Perfis e permissões" },
  { id: "auditoria", label: "Auditoria" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Módulo de configurações: centraliza parâmetros e gestão de usuários (somente administradores).
function Configuracoes() {
  const { profile } = useAuth();
  const initial = useSearchParams().get("tab");
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? (initial as TabId) : "geral");

  if (profile?.role !== "admin") return <p className="text-sm">Acesso restrito a administradores.</p>;

  return (
    <div className="space-y-6">
      <h1>Configurações</h1>
      <div role="tablist" aria-label="Seções de configuração" className={SEGMENTED}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={SEGMENT_ITEM}
          >
            {t.label}
          </button>
        ))}
      </div>
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
