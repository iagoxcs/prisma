"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { SaveState } from "@/lib/autosave";
import { cn } from "@/lib/utils";

// Estado do salvamento automático, anunciado a leitores de tela sem roubar o foco.
export function SaveStatus({ state, error, invalidText, className }: { state: SaveState; error: string | null; invalidText?: string; className?: string }) {
  const content = (() => {
    switch (state) {
      case "pending":
        return <span className="text-muted-foreground">Alterações não salvas…</span>;
      case "saving":
        return (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden /> Salvando…
          </span>
        );
      case "saved":
        return (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Check className="size-3.5" strokeWidth={1.75} aria-hidden /> Salvo
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1.5 text-destructive">
            <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden /> Não foi possível salvar: {error}
          </span>
        );
      case "invalid":
        return <span className="text-destructive">{invalidText ?? "Corrija os campos para salvar."}</span>;
      default:
        return <span className="text-muted-foreground">Salvamento automático</span>;
    }
  })();
  return (
    <p role="status" aria-live="polite" className={cn("min-h-5 text-[0.8125rem]", className)}>
      {content}
    </p>
  );
}
