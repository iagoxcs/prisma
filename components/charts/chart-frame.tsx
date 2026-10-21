"use client";

import { useId, type ReactNode } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

export interface ChartTable {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}

// Moldura de um bloco de indicador: estados de carregando, erro (com nova tentativa) e vazio;
// o gráfico recebe role="img" com aria-label = título e uma tabela sr-only com os mesmos dados.
export function ChartFrame({
  title,
  scopeLabel,
  what,
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  table,
  className,
  children,
}: {
  title: string;
  scopeLabel?: string;
  what: string; // ex.: "o throughput semanal"
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  empty: boolean;
  emptyText: string;
  table: ChartTable;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  if (error) return <ErrorState what={what} detail={error} onRetry={onRetry} className={className} />;
  return (
    <section aria-labelledby={id} className={`glass-coluna space-y-3 p-5 ${className ?? ""}`}>
      <div className="space-y-0.5">
        <h2 id={id} className="text-lg">
          {title}
        </h2>
        {scopeLabel && <p className="text-[0.8125rem] font-medium text-muted-foreground">{scopeLabel}</p>}
      </div>
      {loading ? (
        <div role="status">
          <span className="sr-only">Carregando {what}…</span>
          <Skeleton className="h-60 w-full" />
        </div>
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <div role="img" aria-label={title}>
            {children}
          </div>
          <table className="sr-only">
            <caption>{table.caption}</caption>
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// Legenda textual (a cor nunca é a única pista).
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// Tooltip sólido (bg-popover). Injetado pelo Recharts via <Tooltip content={<ChartTooltip />} />.
export function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix = "",
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
  labelPrefix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground">
      <p className="font-medium">
        {labelPrefix}
        {label}
      </p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="num ml-auto pl-3">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
