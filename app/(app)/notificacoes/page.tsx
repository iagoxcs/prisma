"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatWhen, NOTIFICATION_COLS } from "@/components/notification-bell";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, ROW_LIST } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { notificationHref, type AppNotification } from "@/types/domain";

const TYPE_LABEL: Record<AppNotification["type"], string> = {
  task_assigned: "Atribuição",
  due_soon: "Prazo próximo",
  overdue: "Prazo vencido",
  comment: "Comentário",
  mention: "Menção",
};

export default function NotificacoesPage() {
  const router = useRouter();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery<AppNotification[]>(() => {
    const q = getSupabase().from("notifications").select(NOTIFICATION_COLS).order("created_at", { ascending: false }).limit(100);
    return onlyUnread ? q.eq("read", false) : q;
  }, [onlyUnread]);

  async function setRead(id: string, read: boolean) {
    const { error } = await getSupabase().from("notifications").update({ read }).eq("id", id);
    if (error) setError(error.message);
    list.reload();
  }

  async function markAll() {
    const { error } = await getSupabase().from("notifications").update({ read: true }).eq("read", false);
    if (error) setError(error.message);
    list.reload();
  }

  async function remove(id: string) {
    const { error } = await getSupabase().from("notifications").delete().eq("id", id);
    if (error) setError(error.message);
    list.reload();
  }

  async function open(n: AppNotification) {
    if (!n.read) await setRead(n.id, true);
    router.push(notificationHref(n));
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Notificações</h1>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Somente não lidas
          </label>
          <Button variant="outline" size="sm" onClick={markAll}>Marcar todas como lidas</Button>
        </div>
      </div>
      {(error || list.error) && <p role="alert" className={MSG_ERROR}>{error ?? list.error}</p>}
      <ul className={ROW_LIST}>
        {(list.data ?? []).map((n) => (
          <li key={n.id} className="surface-card flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-2 pl-4 text-sm">
            <span className={cn("size-2 shrink-0 rounded-full", !n.read && (n.type === "overdue" ? "bg-warning" : "bg-brand-mid"))} />
            <button type="button" onClick={() => open(n)} className="min-h-11 min-w-0 flex-1 py-1 text-left">
              <span className={n.read ? "text-muted-foreground" : "font-medium"}>{n.message}</span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className={cn(n.type === "overdue" && "font-medium text-warning")}>{TYPE_LABEL[n.type]}</span>
                <span className="num">{formatWhen(n.created_at)}</span>
              </span>
            </button>
            <span className="flex">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setRead(n.id, !n.read)}>
                {n.read ? "Marcar não lida" : "Marcar lida"}
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => remove(n.id)}>
                Excluir
              </Button>
            </span>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">Nenhuma notificação.</li>}
      </ul>
    </div>
  );
}
