"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAGE_SIZES } from "@/lib/use-page-size";
import { SELECT_CLASS } from "@/lib/ui";
import { cn } from "@/lib/utils";

// Paginação no cliente: `page` começa em 1. Use com usePageSize(scope) para persistir o tamanho.
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  className?: string;
}) {
  if (total <= 0) return null;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label="Paginação" className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm", className)}>
      <select
        aria-label="Itens por página"
        className={cn(SELECT_CLASS, "num min-h-11")}
        value={pageSize}
        onChange={(e) => {
          onPageSizeChange(Number(e.target.value));
          onPageChange(1);
        }}
      >
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <div className="flex items-center gap-3">
        <p className="num text-muted-foreground" aria-live="polite">
          {from}–{to} de {total}
        </p>
        <div className="flex gap-1">
          <Button type="button" variant="outline" className="min-h-11 px-3" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft strokeWidth={1.75} aria-hidden /> Anterior
          </Button>
          <Button type="button" variant="outline" className="min-h-11 px-3" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            Próxima <ChevronRight strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
