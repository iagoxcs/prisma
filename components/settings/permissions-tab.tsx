import { Check, Minus } from "lucide-react";
import { ROLE_LABEL, type UserRole } from "@/types/domain";

// Matriz somente leitura: espelha as policies de RLS (docs/ARQUITETURA.md). Alterar permissões = migração.
const ORDER: UserRole[] = ["admin", "gerente", "lider", "consultor", "externo"];

const ROWS: { label: string; allowed: UserRole[]; note?: string }[] = [
  { label: "Ver todos os projetos", allowed: ["admin"] },
  { label: "Ver projetos em que participa", allowed: ["gerente", "lider", "consultor", "externo"], note: "Externo: só os convidados" },
  { label: "Criar projetos", allowed: ["admin", "gerente"] },
  { label: "Gerir membros, status e período do projeto", allowed: ["admin", "gerente"], note: "Gerente: nos projetos que gerencia" },
  { label: "Criar e editar escopos", allowed: ["admin", "gerente", "lider"] },
  { label: "Criar tarefas", allowed: ["admin", "gerente", "lider", "consultor"] },
  { label: "Editar qualquer tarefa do projeto", allowed: ["admin", "gerente", "lider"] },
  { label: "Editar as tarefas atribuídas a si", allowed: ["admin", "gerente", "lider", "consultor", "externo"] },
  { label: "Excluir tarefas", allowed: ["admin", "gerente"] },
  { label: "Comentários internos (criar e ver)", allowed: ["admin", "gerente", "lider", "consultor"] },
  { label: "Clientes (ver)", allowed: ["admin", "gerente", "lider", "consultor"] },
  { label: "Clientes (criar e editar)", allowed: ["admin", "gerente"] },
  { label: "Configurações, usuários e auditoria", allowed: ["admin"] },
];

export function PermissionsTab() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Referência das regras aplicadas pelo banco de dados (RLS). Para alterar uma permissão é necessária uma migração — não há edição por tela, de propósito.
      </p>
      <div className="glass-coluna overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-sm text-muted-foreground">
              <th className="min-w-56 px-4 py-3 font-medium">Capacidade</th>
              {ORDER.map((r) => (
                <th key={r} className="px-3 py-3 text-center font-medium">{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="px-4 py-3">
                  {row.label}
                  {row.note && <span className="block text-[0.8125rem] text-muted-foreground">{row.note}</span>}
                </td>
                {ORDER.map((r) => (
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
    </div>
  );
}
