// Cores semânticas de status. Fonte única: substitui mapas locais de hex
// (ex.: STATUS_COLOR em app/(app)/cronograma/page.tsx).
// Os valores são var(--token): funcionam em style={{}} e em fill/stroke de SVG,
// e trocam sozinhos entre tema claro e escuro.
import type { ProjectStatus, TaskStatus } from "@/types/domain";

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planejamento: "var(--status-planned)",
  em_andamento: "var(--status-active)",
  pausado: "var(--status-paused)",
  concluido: "var(--status-done)",
  cancelado: "var(--status-cancelled)",
};

export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "var(--status-todo)",
  doing: "var(--status-doing)",
  done: "var(--status-done)",
};

// Atraso/vencimento NÃO é um status: é uma condição sobreposta a qualquer status.
// Sempre âmbar, nunca vermelho. Use junto com texto ("vencida 02 out"), nunca só a cor.
export const OVERDUE_COLOR = "var(--warning)";
export const OVERDUE_SURFACE = "var(--warning-surface)";

// Classes Tailwind equivalentes, para badges e pontos de status.
export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-status-todo",
  doing: "bg-status-doing",
  done: "bg-status-done",
};

export const OVERDUE_BADGE = "bg-warning-surface text-warning";

// Paleta restrita para categories.color (escopos). Família fria, distinguível por luminosidade.
// Valores em hex porque ficam gravados no banco; o par escuro é derivado na UI.
export const CATEGORY_PALETTE = [
  { light: "#2a6aa3", dark: "#8ec0ee", name: "Azul" },
  { light: "#1f6f80", dark: "#7cc4d2", name: "Petróleo" },
  { light: "#45549e", dark: "#a4afe6", name: "Índigo" },
  { light: "#5e7f99", dark: "#a9c0d3", name: "Ardósia" },
  { light: "#0f4c75", dark: "#5fa6d9", name: "Marinho" },
  { light: "#6a5fa8", dark: "#bdb3ec", name: "Lavanda" },
  { light: "#3d7f9e", dark: "#93cde6", name: "Céu" },
  { light: "#4a6a88", dark: "#b5cfe6", name: "Névoa" },
] as const;

// Cor de exibição de um escopo, já com o par do tema escuro (light-dark() segue o color-scheme do <html>).
// Cores fora da paleta (legado, ou o default '#64748b' do banco) caem em "Névoa".
export function categoryColor(stored: string | null | undefined): string {
  const hit = CATEGORY_PALETTE.find((c) => c.light === stored?.toLowerCase()) ?? CATEGORY_PALETTE[CATEGORY_PALETTE.length - 1];
  return `light-dark(${hit.light}, ${hit.dark})`;
}
