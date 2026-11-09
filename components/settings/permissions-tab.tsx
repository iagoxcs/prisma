"use client";

import { useState } from "react";
import { Check, Lock, Minus } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { LOCKED_ROLES, PERMISSIONS, ROLE_ORDER, type Permission, type PermissionRow } from "@/lib/permissions";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { ROLE_LABEL, type UserRole } from "@/types/domain";

// Regras estruturais: não configuráveis (abririam dados internos a externos ou dariam poder de administrador).
const FIXED: { label: string; allowed: UserRole[]; note?: string }[] = [
  { label: "Ver todos os projetos", allowed: ["admin"] },
  { label: "Ver projetos em que participa", allowed: ["gerente", "lider", "consultor", "externo"], note: "Externo: só os convidados" },
  { label: "Tudo no próprio projeto (membros, status, escopos, tarefas)", allowed: ["admin", "gerente"], note: "Gerente: nos projetos que gerencia" },
  { label: "Editar as tarefas atribuídas a si", allowed: ["admin", "gerente", "lider", "consultor", "externo"] },
  { label: "Comentários internos (criar e ver)", allowed: ["admin", "gerente", "lider", "consultor"] },
  { label: "Configurações, usuários e auditoria", allowed: ["admin"] },
];

const key = (role: UserRole, perm: Permission) => `${role}:${perm}`;

export function PermissionsTab() {
  const rows = useQuery<PermissionRow[]>(
    () => getSupabase().from("role_permissions").select("role, permission, allowed"),
    [],
  );
  // Gravação otimista: o valor local vence até a resposta; em erro, volta.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  if (rows.error) return <ErrorState what="as permissões" detail={rows.error} onRetry={rows.reload} />;

  const stored = new Map((rows.data ?? []).map((r) => [key(r.role, r.permission), r.allowed]));
  const value = (role: UserRole, perm: Permission) => {
    if (role === "admin") return true;
    const k = key(role, perm);
    return overrides[k] ?? stored.get(k) ?? false;
  };

  async function toggle(role: UserRole, perm: Permission) {
    const k = key(role, perm);
    const next = !value(role, perm);
    setError(null);
    setOverrides((o) => ({ ...o, [k]: next }));
    setSaving((s) => new Set(s).add(k));
    const { data, error: err } = await getSupabase()
      .from("role_permissions")
      .update({ allowed: next })
      .eq("role", role)
      .eq("permission", perm)
      .select("role");
    setSaving((s) => {
      const n = new Set(s);
      n.delete(k);
      return n;
    });
    if (err || !data?.length) {
      setOverrides((o) => ({ ...o, [k]: !next }));
      setError(err?.message ?? "Não foi possível salvar a permissão.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Marque o que cada perfil pode fazer. As regras são aplicadas pelo banco de dados e valem para quem entrar ou recarregar a página depois da alteração. Toda mudança fica registrada na Auditoria.
        </p>
        {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
        <div className="glass-coluna overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Permissões configuráveis por perfil</caption>
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th scope="col" className="min-w-56 px-4 py-3 font-medium">Capacidade</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} scope="col" className="px-3 py-3 text-center font-medium">{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.key} className="border-b last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {p.label}
                    {"note" in p && <span className="block text-[0.8125rem] text-muted-foreground">{p.note}</span>}
                  </th>
                  {ROLE_ORDER.map((r) => {
                    const on = value(r, p.key);
                    const lock = LOCKED_ROLES[r];
                    return (
                      <td key={r} className="px-3 py-3 text-center">
                        {lock ? (
                          <span title={lock} className="inline-flex items-center gap-1 text-muted-foreground">
                            {on ? (
                              <Check aria-hidden className="size-4 text-brand-mid" strokeWidth={1.75} />
                            ) : (
                              <Minus aria-hidden className="size-4" strokeWidth={1.75} />
                            )}
                            <Lock aria-hidden className="size-3" strokeWidth={1.75} />
                            <span className="sr-only">{on ? "Permitido" : "Não permitido"} (fixo: {lock})</span>
                          </span>
                        ) : (
                          <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              aria-label={`${p.label} — ${ROLE_LABEL[r]}`}
                              checked={on}
                              disabled={rows.loading || saving.has(key(r, p.key))}
                              onChange={() => toggle(r, p.key)}
                            />
                          </label>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Regras fixas</h2>
        <p className="text-sm text-muted-foreground">
          Definem quem enxerga o quê e protegem os dados internos. Não são editáveis pela tela.
        </p>
        <div className="glass-coluna overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Regras fixas por perfil</caption>
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th scope="col" className="min-w-56 px-4 py-3 font-medium">Regra</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} scope="col" className="px-3 py-3 text-center font-medium">{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIXED.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {row.label}
                    {row.note && <span className="block text-[0.8125rem] text-muted-foreground">{row.note}</span>}
                  </th>
                  {ROLE_ORDER.map((r) => (
                    <td key={r} className="px-3 py-3 text-center">
                      {row.allowed.includes(r) ? (
                        <Check aria-label="Permitido" className="mx-auto size-4 text-brand-mid" strokeWidth={1.75} />
                      ) : (
                        <Minus aria-label="Não permitido" className="mx-auto size-4 text-muted-foreground" strokeWidth={1.75} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
