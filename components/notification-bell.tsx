"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { dateTime } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/use-query";
import { notificationHref, type AppNotification } from "@/types/domain";

export const NOTIFICATION_COLS = "id, type, entity_id, project_id, message, read, created_at";

export const formatWhen = dateTime;

// Sino do cabeçalho: contador de não lidas (tempo real) e últimas notificações (RF-17, RF-19).
export function NotificationBell() {
  const { profile } = useAuth();
  const router = useRouter();
  const userId = profile?.id ?? "";
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const unread = useQuery<number>(
    () =>
      getSupabase()
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("read", false)
        .then((r) => ({ data: r.count ?? 0, error: r.error })),
    [userId],
  );
  const latest = useQuery<AppNotification[]>(
    () => getSupabase().from("notifications").select(NOTIFICATION_COLS).order("created_at", { ascending: false }).limit(8),
    [userId],
  );

  const reloadUnread = unread.reload;
  const reloadLatest = latest.reload;
  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        reloadUnread();
        reloadLatest();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, reloadUnread, reloadLatest]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openNotification(n: AppNotification) {
    setOpen(false);
    if (!n.read) {
      await getSupabase().from("notifications").update({ read: true }).eq("id", n.id);
      unread.reload();
      latest.reload();
    }
    router.push(notificationHref(n));
  }

  async function markAll() {
    await getSupabase().from("notifications").update({ read: true }).eq("read", false);
    unread.reload();
    latest.reload();
  }

  const count = unread.data ?? 0;

  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={count > 0 ? `Notificações: ${count} não lidas` : "Notificações"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell strokeWidth={1.75} />
        {count > 0 && (
          <span className="num absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-mid px-1 text-[10px] text-primary-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border bg-popover text-popover-foreground">
          <div className="flex min-h-11 items-center justify-between border-b px-4 text-sm">
            <span className="font-semibold">Notificações</span>
            {count > 0 && (
              <button type="button" className="min-h-9 text-[0.8125rem] font-medium text-brand-mid hover:underline" onClick={markAll}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y overflow-y-auto">
            {(latest.data ?? []).map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openNotification(n)} className="flex w-full gap-2.5 px-4 py-3 text-left text-sm hover:bg-accent">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", !n.read && (n.type === "overdue" ? "bg-warning" : "bg-brand-mid"))} />
                  <span>
                    <span className={n.read ? "text-muted-foreground" : "font-medium"}>{n.message}</span>
                    <span className="num block text-xs text-muted-foreground">{formatWhen(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {latest.data?.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</li>}
          </ul>
          <Link href="/notificacoes/" onClick={() => setOpen(false)} className="flex min-h-11 items-center justify-center border-t text-[0.8125rem] font-medium text-brand-mid hover:underline">
            Ver todas
          </Link>
        </div>
      )}
    </div>
  );
}
