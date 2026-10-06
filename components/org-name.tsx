"use client";

import { getSupabase } from "@/lib/supabase/client";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useQuery } from "@/lib/use-query";

// Nome da organização (parâmetro organization_name) exibido sob a marca.
export function OrgName() {
  const { data } = useQuery<{ value: unknown }>(
    () => getSupabase().from("app_settings").select("value").eq("key", "organization_name").maybeSingle(),
    [],
  );
  const name = typeof data?.value === "string" ? data.value : DEFAULT_SETTINGS.organization_name;
  return <div className="truncate text-xs text-muted-foreground">{name}</div>;
}
