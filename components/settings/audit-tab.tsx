"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { dateTime } from "@/lib/format";
import { MSG_ERROR, ROW_LIST, SELECT_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";

interface LogRow {
  id: string;
  entity: string;
  action: string;
  user_id: string | null;
  project_id: string | null;
  diff: { old?: Record<string, unknown>; new?: Record<string, unknown> } | null;
  created_at: string;
}

const ENTITY_LABEL: Record<string, string> = {
  projects: "Projeto",
  tasks: "Tarefa",
  project_members: "Membro de projeto",
  app_settings: "Parâmetro",
};
const ACTION_LABEL: Record<string, string> = { insert: "criou", update: "alterou", delete: "excluiu" };
const IGNORED = new Set(["updated_at", "created_at", "concluded_at", "position"]);

function describe(r: LogRow) {
  const row = (r.diff?.new ?? r.diff?.old ?? {}) as Record<string, unknown>;
  const title = (row.title ?? row.name ?? row.key ?? "") as string;
  if (r.action !== "update" || !r.diff?.old || !r.diff.new) return title;
  const changed = Object.keys(r.diff.new).filter((k) => !IGNORED.has(k) && JSON.stringify(r.diff!.old![k]) !== JSON.stringify(r.diff!.new![k]));
  return `${title}${changed.length ? ` — campos: ${changed.join(", ")}` : ""}`;
}

// Trilha de auditoria (activity_log): preenchida por triggers, somente leitura.
export function AuditTab() {
  const [entity, setEntity] = useState("");
  const logs = useQuery<LogRow[]>(() => {
    const q = getSupabase().from("activity_log").select("id, entity, action, user_id, project_id, diff, created_at").order("created_at", { ascending: false }).limit(100);
    return entity ? q.eq("entity", entity) : q;
  }, [entity]);
  const people = useQuery<{ id: string; name: string }[]>(() => getSupabase().from("profiles").select("id, name"), []);
  const names = new Map((people.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Filtrar por tipo" className={SELECT_CLASS} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="text-[0.8125rem] text-muted-foreground">Últimos 100 registros. Gerado automaticamente; não pode ser editado.</span>
      </div>
      {logs.error && <p role="alert" className={MSG_ERROR}>{logs.error}</p>}
      <ul className={ROW_LIST}>
        {(logs.data ?? []).map((r) => (
          <li key={r.id} className="surface-card space-y-0.5 px-4 py-3 text-sm">
            <div>
              <span className="font-medium">{(r.user_id && names.get(r.user_id)) || "Sistema"}</span>{" "}
              {ACTION_LABEL[r.action] ?? r.action} {(ENTITY_LABEL[r.entity] ?? r.entity).toLowerCase()}
            </div>
            <div className="text-[0.8125rem] text-muted-foreground">{describe(r)}</div>
            <time dateTime={r.created_at} className="num block text-xs text-muted-foreground">
              {dateTime(r.created_at)}
            </time>
          </li>
        ))}
        {logs.data?.length === 0 && <li className="text-sm text-muted-foreground">Sem registros.</li>}
      </ul>
    </div>
  );
}
