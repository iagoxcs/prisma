"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface GanttRow {
  id: string;
  label: string;
  sub?: string;
  start: string | null; // YYYY-MM-DD
  end: string | null;
  color: string;
  done?: boolean;
  overdue?: boolean;
}

const DAY_MS = 86_400_000;
const ZOOMS = { dia: 28, semana: 12, mês: 4 } as const;
type Zoom = keyof typeof ZOOMS;

const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (d: number) => new Date(d * DAY_MS);
const brDate = (iso: string) => iso.split("-").reverse().join("/");

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

  // Cabeçalho de meses.
  const months: { label: string; left: number; width: number }[] = [];
  for (let d = first; d <= last; d++) {
    const dt = fromDay(d);
    if (months.length === 0 || dt.getUTCDate() === 1) {
      months.push({
        label: dt.toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }),
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

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nada para exibir.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Escala:</span>
        {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => setZoom(z)}
            aria-pressed={zoom === z}
            className={cn("rounded-lg border px-2 py-1", zoom === z ? "bg-muted font-medium" : "hover:bg-muted/60")}
          >
            {z}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <div className="flex" style={{ minWidth: 224 + width }}>
          <div className="sticky left-0 z-10 w-56 shrink-0 border-r bg-background">
            <div className="h-14 border-b" />
            {scheduled.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect?.(r.id)}
                className="block h-9 w-full truncate border-b px-3 text-left text-sm hover:bg-muted"
                title={r.label}
              >
                <span className={cn(r.done && "text-muted-foreground line-through")}>{r.label}</span>
                {r.sub && <span className="ml-1 text-xs text-muted-foreground">{r.sub}</span>}
              </button>
            ))}
          </div>

          <div className="relative" style={{ width }}>
            <div className="relative h-7 border-b">
              {months.map((m, i) => (
                <div key={i} className="absolute top-0 h-7 border-l px-1 text-xs font-medium leading-7" style={{ left: m.left, width: m.width }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="relative h-7 border-b">
              {ticks.map((t, i) => (
                <div key={i} className="absolute top-0 h-7 border-l pl-1 text-[10px] leading-7 text-muted-foreground" style={{ left: t.left }}>
                  {t.label}
                </div>
              ))}
            </div>

            {scheduled.map((r) => {
              const s = toDay((r.start ?? r.end) as string);
              const e = toDay((r.end ?? r.start) as string);
              const [from, to] = s <= e ? [s, e] : [e, s];
              return (
                <div key={r.id} className="relative h-9 border-b">
                  <button
                    type="button"
                    onClick={() => onSelect?.(r.id)}
                    title={`${r.label} · ${r.start ? brDate(r.start) : "?"} → ${r.end ? brDate(r.end) : "?"}`}
                    className={cn(
                      "absolute top-1.5 h-6 rounded-md text-left text-[11px] leading-6 text-white shadow-xs outline-offset-2 hover:brightness-110",
                      r.done && "opacity-50",
                      r.overdue && "ring-2 ring-destructive",
                    )}
                    style={{ left: (from - first) * px, width: Math.max(px, (to - from + 1) * px), background: r.color }}
                  >
                    <span className="block truncate px-1.5">{(to - from + 1) * px > 60 ? r.label : ""}</span>
                  </button>
                </div>
              );
            })}

            {today >= first && today <= last && (
              <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-destructive" style={{ left: (today - first) * px + px / 2 }}>
                <span className="absolute top-0 -translate-x-1/2 rounded bg-destructive px-1 text-[10px] text-white">hoje</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="text-sm">
          <h3 className="mb-1 font-medium">Sem datas ({unscheduled.length})</h3>
          <ul className="flex flex-wrap gap-2">
            {unscheduled.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onSelect?.(r.id)} className="rounded-lg border px-2 py-1 hover:bg-muted">
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
