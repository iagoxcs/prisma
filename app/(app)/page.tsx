"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getSupabase } from "@/lib/supabase/client";

export default function DashboardPage() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<number | null>(null);

  useEffect(() => {
    getSupabase()
      .from("projects")
      .select("id", { count: "exact", head: true })
      .neq("status", "concluido")
      .neq("status", "cancelado")
      .then(({ count }) => setProjects(count ?? 0));
  }, []);

  return (
    <div className="space-y-6">
      <h1>Olá, {profile?.name}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <section className="glass-coluna space-y-1 p-5">
          <h2 className="text-sm font-medium text-muted-foreground">Projetos ativos</h2>
          <p className="num text-4xl font-medium tracking-tight">{projects ?? "…"}</p>
        </section>
      </div>
      <p className="text-sm text-muted-foreground">
        Tarefas, Kanban, Gantt, notificações, IA e indicadores entram nas próximas fases (veja docs/ROADMAP.md).
      </p>
    </div>
  );
}
