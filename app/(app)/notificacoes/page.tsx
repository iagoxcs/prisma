"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatWhen, NOTIFICATION_COLS } from "@/components/notification-bell";
import { getSupabase } from "@/lib/supabase/client";
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
        <h1 className="text-2xl font-semibold">Notificações</h1>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Somente não lidas
          </label>
          <Button variant="outline" size="sm" onClick={markAll}>Marcar todas como lidas</Button>
        </div>
      </div>
      {(error || list.error) && <p role="alert" className="text-sm text-destructive">{error ?? list.error}</p>}
      <ul className="divide-y rounded-lg border">
        {(list.data ?? []).map((n) => (
          <li key={n.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className={cn("size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} />
            <button type="button" onClick={() => open(n)} className="flex-1 text-left">
              <span className={n.read ? "text-muted-foreground" : "font-medium"}>{n.message}</span>
              <span className="block text-xs text-muted-foreground">{TYPE_LABEL[n.type]} · {formatWhen(n.created_at)}</span>
            </button>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setRead(n.id, !n.read)}>
              {n.read ? "Marcar não lida" : "Marcar lida"}
            </button>
            <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => remove(n.id)}>
              Excluir
            </button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação.</li>}
      </ul>
    </div>
  );
}
