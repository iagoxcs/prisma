"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { DIALOG, OVERLAY, restoreFocus, trapFocus } from "@/lib/ui";

// Confirmação modal no lugar de confirm(): sólida (bg-popover), foco preso e devolvido a quem abriu.
// Começa focada em "Cancelar", a opção segura. Esc e clique no véu cancelam.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    ref.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    return () => restoreFocus(opener);
  }, [open]);

  if (!open) return null;
  // Eventos de portal sobem pela árvore React: param aqui para não fechar o drawer por baixo.
  return createPortal(
    <div
      className={`${OVERLAY} z-50 items-center justify-center p-4`}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onCancel();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) onCancel();
        trapFocus(e, ref.current);
      }}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={DIALOG}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h2 id={titleId} className="text-[1.0625rem] font-semibold">{title}</h2>
          {description && <p id={descId} className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" data-cancel="" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
