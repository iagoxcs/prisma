// Rótulos e nomes que o assistente mostra (Onda 7).
// P13: projetos citados como "Projeto - Cliente". O nome do cliente vem do embed clients(name), lido com a
// sessão do usuário: sem cliente, ou sem a permissão clients.view (RLS de clients), o embed vem nulo e o
// rótulo é só o nome do projeto.
// P10: tarefas trazem o nome do responsável (assignee_name) ao lado do assignee_id.
// Funções puras, testadas em labels.test.ts.

export const LABEL_SEP = " - ";

export function projectLabel(name: string, client?: string | null): string {
  const n = (name ?? "").trim();
  const c = (client ?? "").trim();
  return c ? `${n}${LABEL_SEP}${c}` : n;
}

// Um embed N:1 (projects → clients, tasks → projects) vem como objeto; por garantia, aceita também lista.
function one(v: unknown): Record<string, unknown> | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

// Nome de um embed `clients(name)`; null se ausente ou invisível pela RLS.
export function embeddedName(v: unknown): string | null {
  const name = one(v)?.name;
  return typeof name === "string" && name.trim() ? name : null;
}

// Rótulo a partir de um embed `projects(name, clients(name))`; null se o projeto não veio.
export function labelFromEmbed(v: unknown): string | null {
  const p = one(v);
  return p && typeof p.name === "string" ? projectLabel(p.name, embeddedName(p.clients)) : null;
}

export function withAssigneeNames<T extends { assignee_id?: string | null }>(
  rows: T[],
  names: Map<string, string>,
): (T & { assignee_name: string | null })[] {
  return rows.map((r) => ({ ...r, assignee_name: r.assignee_id ? names.get(r.assignee_id) ?? null : null }));
}
