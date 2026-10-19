// Classes compartilhadas para controles nativos (select, textarea) e padrões repetidos da identidade.
// Mantém a mesma aparência do <Input /> do shadcn sem duplicar strings pelas telas.

export const SELECT_CLASS =
  "h-11 rounded-md border border-input bg-surface-card px-3 text-sm text-foreground outline-none focus-visible:border-ring";

export const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-surface-card p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring";

// Alternador segmentado (abas de tela, escala do Gantt): contêiner + item.
export const SEGMENTED = "inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1";
export const SEGMENT_ITEM =
  "min-h-9 rounded-md px-3.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground aria-selected:bg-surface-card aria-selected:text-foreground aria-pressed:bg-surface-card aria-pressed:text-foreground dark:aria-selected:bg-accent dark:aria-pressed:bg-accent";

// Lista em linhas: cada item é um card sem blur.
export const ROW_LIST = "flex flex-col gap-2";
export const ROW = "surface-card flex min-h-13 items-center justify-between gap-3 px-4 py-3 text-sm";

// Mensagens de retorno de formulário.
export const MSG_OK = "text-sm text-brand-mid";
export const MSG_ERROR = "text-sm text-destructive";

// Diálogos e drawers sobrepostos: sólidos (sem blur), sobre um véu do fundo.
export const OVERLAY = "fixed inset-0 flex bg-background/60";
export const DIALOG =
  "w-full max-w-md space-y-5 rounded-2xl border border-glass-edge bg-popover p-6 text-popover-foreground shadow-[var(--glass-shadow)]";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Mantém o Tab dentro do contêiner (modal): do último volta ao primeiro e vice-versa.
export function trapFocus(e: { key: string; shiftKey: boolean; preventDefault: () => void }, container: HTMLElement | null) {
  if (e.key !== "Tab" || !container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (items.length === 0) return e.preventDefault();
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !container.contains(active) || active === container)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

// Devolve o foco ao elemento que abriu o modal (se ainda estiver na página).
export function restoreFocus(el: Element | null) {
  if (el instanceof HTMLElement && el.isConnected && el !== document.body) el.focus();
}
