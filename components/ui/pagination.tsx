"use client";

import { useId } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SELECT_CLASS } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Select } from "./select";

// Paginação genérica no cliente. `page` começa em 1 e já deve vir dentro do intervalo (ver clampPage).
export function Pagination({
  total,
  page,
  size,
  sizes,
  onPage,
  onSize,
  className,
}: {
  total: number;
  page: number;
  size: number;
  sizes: readonly number[];
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  className?: string;
}) {
  const sizeId = useId();
  const pages = pageCount(total, size);
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);

  return (
    <nav aria-label="Paginação" className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId} className="text-[0.8125rem] font-medium text-muted-foreground">Itens por página</label>
        <Select id={sizeId} className={cn(SELECT_CLASS, "num")} value={size} onChange={(e) => onSize(Number(e.target.value))}>
          {sizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-muted-foreground" aria-live="polite">
          Mostrando <span className="num text-foreground">{from}–{to}</span> de <span className="num text-foreground">{total}</span>
        </p>
        <div className="flex gap-1">
          <Button type="button" variant="outline" className="px-3" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft strokeWidth={1.75} aria-hidden /> Anterior
          </Button>
          <Button type="button" variant="outline" className="px-3" aria-label="Próxima página" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Próxima <ChevronRight strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}

export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

// Página pedida (ex.: da URL) → página válida: não numérica vira 1; além do fim vira a última.
export function clampPage(raw: string | number | null | undefined, total: number, size: number) {
  const n = Math.floor(Number(raw));
  return Math.min(Number.isFinite(n) && n >= 1 ? n : 1, pageCount(total, size));
}
