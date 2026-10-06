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
