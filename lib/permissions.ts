import type { UserRole } from "@/types/domain";

// Capacidades configuráveis por perfil (tabela role_permissions). As chaves nascem por migração
// (20261109120000_role_permissions); o banco aplica as regras via role_can(). Aqui só a interface.
export const PERMISSIONS = [
  { key: "project.create", label: "Criar projetos", note: "Como gerente do próprio projeto" },
  { key: "scope.manage", label: "Criar e editar escopos", note: "Nos projetos de que é membro" },
  { key: "task.create", label: "Criar tarefas e relatórios", note: "Nos projetos de que é membro" },
  { key: "task.edit_any", label: "Editar qualquer tarefa do projeto", note: "Nos projetos de que é membro" },
  { key: "task.delete", label: "Excluir tarefas", note: "Nos projetos de que é membro" },
  { key: "clients.view", label: "Clientes (ver)" },
  { key: "clients.manage", label: "Clientes (criar e editar)" },
  { key: "knowledge.manage", label: "Gerir a base de conhecimento", note: "Inclui ver itens não publicados" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ROLE_ORDER: UserRole[] = ["admin", "gerente", "lider", "consultor", "externo"];

// Perfis com colunas travadas: Administrador sempre tem tudo; Externo nunca recebe estas capacidades.
export const LOCKED_ROLES: Partial<Record<UserRole, string>> = {
  admin: "O Administrador sempre tem todas as permissões",
  externo: "Externos não recebem permissões internas",
};

export type PermissionRow = { role: UserRole; permission: Permission; allowed: boolean };

// Espelho do seed da migração: usado só se a leitura falhar, para a interface não sumir com botões.
const DEFAULT_GRANTS: Partial<Record<UserRole, Permission[]>> = {
  gerente: ["project.create", "task.create", "clients.view", "clients.manage", "knowledge.manage"],
  lider: ["scope.manage", "task.create", "task.edit_any", "clients.view"],
  consultor: ["task.create", "clients.view"],
};
export const DEFAULT_ROWS: PermissionRow[] = Object.entries(DEFAULT_GRANTS).flatMap(([role, perms]) =>
  perms.map((permission) => ({ role: role as UserRole, permission, allowed: true })),
);

export function permissionSet(rows: PermissionRow[], role: UserRole | undefined): Set<Permission> {
  if (role === "admin") return new Set(PERMISSIONS.map((p) => p.key));
  return new Set(rows.filter((r) => r.role === role && r.allowed).map((r) => r.permission));
}
