"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend, ChartTooltip } from "@/components/charts/chart-frame";
import type { WorkloadBar } from "@/lib/indicators";

const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

// Abertas no prazo em --chart-2; a parcela vencida em --warning (condição de atraso, não meta).
export function WorkloadChart({ data }: { data: WorkloadBar[] }) {
  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} horizontal={false} />
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
          />
          <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltip />} isAnimationActive={false} />
          <Bar dataKey="onTime" name="Abertas no prazo" stackId="a" fill="var(--chart-2)" isAnimationActive={false} />
          <Bar dataKey="overdue" name="Vencidas" stackId="a" fill="var(--warning)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { label: "Abertas no prazo", color: "var(--chart-2)" },
          { label: "Vencidas", color: "var(--warning)" },
        ]}
      />
    </div>
  );
}
