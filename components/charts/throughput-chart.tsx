"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-frame";
import { shortDate } from "@/lib/format";
import type { WeekPoint } from "@/lib/indicators";

const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

export function ThroughputChart({ data }: { data: WeekPoint[] }) {
  const points = data.map((p) => ({ label: shortDate(p.week_start), value: p.value }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltip labelPrefix="Semana de " />} isAnimationActive={false} />
        <Bar dataKey="value" name="Concluídas" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
