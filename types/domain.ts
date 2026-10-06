// Tipos de domínio escritos à mão enquanto types/database.ts (gerado) não existe.
// Depois do `supabase link`: npm run db:types  → substitua estes pelos tipos gerados.

export type UserRole = "admin" | "gerente" | "lider" | "consultor" | "externo";
export type ProjectStatus = "planejamento" | "em_andamento" | "pausado" | "concluido" | "cancelado";
export type TaskStatus = "todo" | "doing" | "done";

// A interface usa "Líderes" (não "Leaders"/"Lideres").
export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  lider: "Líder",
  consultor: "Consultor",
  externo: "Externo",
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planejamento: "Planejamento",
  em_andamento: "Em andamento",
  pausado: "Pausado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "A Fazer",
  doing: "Fazendo",
  done: "Feito",
};

export interface Profile {
  id: string;
  name: string;
  job_title: string | null;
  role: UserRole;
  is_external: boolean;
  active: boolean;
}

export interface Client {
  id: string;
  name: string;
  status: "ativo" | "inativo";
}

export interface Project {
  id: string;
  client_id: string | null;
  name: string;
  status: ProjectStatus;
  manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  clients?: { name: string } | null;
}
