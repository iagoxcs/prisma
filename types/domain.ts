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

export type ProjectHealth = "on_track" | "at_risk" | "off_track";

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "No prazo",
  at_risk: "Em risco",
  off_track: "Fora do prazo",
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

export interface Category {
  id: string;
  project_id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  project_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface Attachment {
  id: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  profiles?: { name: string } | null;
}

export interface Person {
  id: string;
  name: string;
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // RF-09

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

export interface AppNotification {
  id: string;
  type: "task_assigned" | "due_soon" | "overdue" | "comment" | "mention";
  entity_id: string;
  project_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
}

export const notificationHref = (n: Pick<AppNotification, "project_id" | "entity_id">) =>
  n.project_id ? `/projeto/?id=${n.project_id}&task=${n.entity_id}` : "/";

// Data de hoje (YYYY-MM-DD) no fuso de Brasília.
export const todayISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
