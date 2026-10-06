"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { brDate } from "@/lib/format";
import { OVERDUE_BADGE } from "@/lib/theme/status";
import { SEGMENTED, SEGMENT_ITEM } from "@/lib/ui";
import { cn } from "@/lib/utils";

export interface GanttRow {
  id: string;
  label: string;
  sub?: string;
  start: string | null; // YYYY-MM-DD
  end: string | null;
  color: string; // var(--token) ou cor de escopo (lib/theme/status.ts)
  done?: boolean;
  overdue?: boolean;
}

const DAY_MS = 86_400_000;
const LABEL_W = 224; // coluna fixa de nomes (w-56)
const ZOOMS = { dia: 28, semana: 12, mês: 4 } as const;
type Zoom = keyof typeof ZOOMS;

const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (d: number) => new Date(d * DAY_MS);

function todayDay() {
  // "Hoje" no fuso de Brasília.
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return toDay(iso);
}

// Gantt por período (sem dependências entre itens). Barras sem início usam só o prazo (1 dia).
export function GanttChart({ rows, onSelect }: { rows: GanttRow[]; onSelect?: (id: string) => void }) {
  const [zoom, setZoom] = useState<Zoom>("semana");
  const px = ZOOMS[zoom];
  const today = todayDay();

  const scheduled = rows.filter((r) => r.start || r.end);
  const unscheduled = rows.filter((r) => !r.start && !r.end);

  const { first, last } = useMemo(() => {
    const days = [today, ...scheduled.flatMap((r) => [r.start, r.end].filter(Boolean).map((d) => toDay(d as string)))];
    return { first: Math.min(...days) - 3, last: Math.max(...days) + 10 };
  }, [scheduled, today]);

  const total = last - first + 1;
  const width = total * px;

  // Abre com "hoje" à vista (o período pode começar meses antes).
  const scroller = useRef<HTMLDivElement>(null);
  const todayLeft = (today - first) * px;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, todayLeft - (el.clientWidth - LABEL_W) / 3);
  }, [todayLeft]);

  // Cabeçalho de meses.
  const months: { label: string; left: number; width: number }[] = [];
  for (let d = first; d <= last; d++) {
    const dt = fromDay(d);
    if (months.length === 0 || dt.getUTCDate() === 1) {
      months.push({
        label: dt.toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "").replace(" de ", " "),
        left: (d - first) * px,
        width: 0,
      });
    }
    months[months.length - 1].width += px;
  }

  // Marcas: dias (zoom dia), segundas-feiras (semana) ou nenhuma (mês).
  const ticks: { left: number; label: string }[] = [];
  for (let d = first; d <= last; d++) {
    const dt = fromDay(d);
    if (zoom === "dia") ticks.push({ left: (d - first) * px, label: String(dt.getUTCDate()) });
    else if (zoom === "semana" && dt.getUTCDay() === 1) ticks.push({ left: (d - first) * px, label: String(dt.getUTCDate()) });
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nada para exibir. Defina datas de início e fim para ver o cronograma.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Escala</span>
        <div className={SEGMENTED} role="group" aria-label="Escala do cronograma">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button key={z} type="button" onClick={() => setZoom(z)} aria-pressed={zoom === z} className={SEGMENT_ITEM}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div ref={scroller} className="glass-coluna overflow-x-auto [scrollbar-width:thin]">
        <div className="flex" style={{ minWidth: LABEL_W + width }}>
          {/* Coluna fixa: sólida (popover) para não deixar as barras aparecerem por baixo ao rolar */}
          <div className="sticky left-0 z-10 w-56 shrink-0 border-r bg-popover">
            <div className="h-14 border-b" />
            {scheduled.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect?.(r.id)}
                className="flex h-11 w-full items-center gap-2 border-b px-3 text-left text-sm hover:bg-accent"
                title={r.label}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className={cn("font-medium", r.done && "text-muted-foreground line-through")}>{r.label}</span>
                  {r.sub && <span className="ml-1.5 text-[0.8125rem] text-muted-foreground">{r.sub}</span>}
                </span>
                {r.overdue && <span className={cn("num shrink-0 rounded-md px-1.5 text-xs leading-5", OVERDUE_BADGE)}>vencido</span>}
              </button>
            ))}
          </div>

          <div className="relative" style={{ width }}>
            <div className="relative h-7 border-b">
              {months.map((m, i) => (
                <div key={i} title={m.label} className="absolute top-0 h-7 truncate border-l px-1.5 text-xs font-medium leading-7 whitespace-nowrap" style={{ left: m.left, width: m.width }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="relative h-7 border-b">
              {ticks.map((t, i) => (
                <div key={i} className="num absolute top-0 h-7 border-l pl-1 text-[10px] leading-7 text-muted-foreground" style={{ left: t.left }}>
                  {t.label}
                </div>
              ))}
            </div>

            {scheduled.map((r) => {
              const s = toDay((r.start ?? r.end) as string);
              const e = toDay((r.end ?? r.start) as string);
              const [from, to] = s <= e ? [s, e] : [e, s];
              const period = `${r.start ? brDate(r.start) : "?"} → ${r.end ? brDate(r.end) : "?"}`;
              return (
                <div key={r.id} className="relative h-11 border-b border-border/60">
                  <button
                    type="button"
                    onClick={() => onSelect?.(r.id)}
                    title={`${r.label}: ${period}${r.overdue ? " (vencido)" : ""}`}
                    aria-label={`${r.label}, ${period}${r.overdue ? ", vencido" : ""}`}
                    className={cn(
                      "absolute top-3 h-5 rounded-full outline-offset-2 transition-[filter] duration-150 hover:brightness-110",
                      r.done && "opacity-50",
                      r.overdue && "outline-2 outline-warning",
                    )}
                    style={{ left: (from - first) * px, width: Math.max(px, (to - from + 1) * px), background: r.color }}
                  />
                </div>
              );
            })}

            {today >= first && today <= last && (
              <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand-mid" style={{ left: (today - first) * px + px / 2 }}>
                <span className="absolute top-0 -translate-x-1/2 rounded-sm bg-brand-mid px-1.5 text-[10px] font-medium leading-4 text-primary-foreground">hoje</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="space-y-2 text-sm">
          <h3>
            Sem datas <span className="num font-normal text-muted-foreground">{unscheduled.length}</span>
          </h3>
          <ul className="flex flex-wrap gap-2">
            {unscheduled.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onSelect?.(r.id)} className="surface-card min-h-11 px-3 hover:bg-accent">
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
