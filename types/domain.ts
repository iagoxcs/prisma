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

// GED: anexos de tarefas indexados por projeto (view project_documents, security_invoker).
// Nomes podem vir nulos quando a RLS esconde a linha relacionada (ex.: cliente para externos).
export interface ProjectDocument {
  id: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
  task_title: string;
  project_id: string;
  category_id: string | null;
  project_name: string;
  client_id: string | null;
  client_name: string | null;
  category_name: string | null;
  uploader_name: string | null;
}

// Base de Conhecimento: metodologias (Markdown) e modelos de projeto vinculados (planilha de fases).
export type KnowledgeKind = "metodologia" | "modelo";
export type KnowledgeStatus = "rascunho" | "publicado";
export type PrismaStage = "processos" | "resultados" | "indicadores" | "sistemas" | "melhoria" | "alinhamento";

export const KNOWLEDGE_KIND_LABEL: Record<KnowledgeKind, string> = {
  metodologia: "Metodologia",
  modelo: "Modelo",
};

export const KNOWLEDGE_STATUS_LABEL: Record<KnowledgeStatus, string> = {
  rascunho: "Rascunho",
  publicado: "Publicado",
};

export const PRISMA_STAGE_LABEL: Record<PrismaStage, string> = {
  processos: "Processos",
  resultados: "Resultados",
  indicadores: "Indicadores",
  sistemas: "Sistemas",
  melhoria: "Melhoria",
  alinhamento: "Alinhamento",
};

// `search` (tsvector) fica de fora: selecione colunas explícitas.
export interface KnowledgeItem {
  id: string;
  title: string;
  kind: KnowledgeKind;
  methodology_id: string | null; // modelo → metodologia a que pertence
  prisma_stage: PrismaStage | null;
  tags: string[];
  summary: string | null;
  body: string | null; // Markdown (metodologia)
  source_file_name: string | null; // .md de origem do corpo
  template_csv: string | null; // planilha de fases (modelo), no formato da importação de tarefas
  template_file_name: string | null;
  status: KnowledgeStatus;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFile {
  id: string;
  item_id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

// Contexto do projeto (reuniões). Só internos membros do projeto.
export type ContextKind = "transcricao" | "ata" | "anotacao";

export const CONTEXT_KIND_LABEL: Record<ContextKind, string> = {
  transcricao: "Transcrição",
  ata: "Ata",
  anotacao: "Anotação",
};

export interface ProjectContextEntry {
  id: string;
  project_id: string;
  kind: ContextKind;
  title: string;
  meeting_date: string | null;
  participants: string | null;
  body: string;
  source_file_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
