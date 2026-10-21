"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend, ChartTooltip } from "@/components/charts/chart-frame";
import type { ScopeBar } from "@/lib/indicators";
import { TASK_STATUS_COLOR } from "@/lib/theme/status";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/types/domain";

const TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const STATUSES: TaskStatus[] = ["todo", "doing", "done"];

export function ScopeChart({ data }: { data: ScopeBar[] }) {
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
          {STATUSES.map((s) => (
            <Bar key={s} dataKey={s} name={TASK_STATUS_LABEL[s]} stackId="a" fill={TASK_STATUS_COLOR[s]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend items={STATUSES.map((s) => ({ label: TASK_STATUS_LABEL[s], color: TASK_STATUS_COLOR[s] }))} />
    </div>
  );
}
