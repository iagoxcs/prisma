"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { getSupabase } from "@/lib/supabase/client";
import { useQuery } from "@/lib/use-query";
import { notificationHref, type AppNotification } from "@/types/domain";

export const NOTIFICATION_COLS = "id, type, entity_id, project_id, message, read, created_at";

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

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
      <button
        type="button"
        aria-label={count > 0 ? `Notificações: ${count} não lidas` : "Notificações"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 hover:bg-muted"
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <span className="font-medium">Notificações</span>
            {count > 0 && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={markAll}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y overflow-y-auto">
            {(latest.data ?? []).map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openNotification(n)} className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className={n.read ? "mt-1.5 size-2 shrink-0" : "mt-1.5 size-2 shrink-0 rounded-full bg-primary"} />
                  <span>
                    <span className={n.read ? "text-muted-foreground" : "font-medium"}>{n.message}</span>
                    <span className="block text-xs text-muted-foreground">{formatWhen(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {latest.data?.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</li>}
          </ul>
          <Link href="/notificacoes/" onClick={() => setOpen(false)} className="block border-t px-3 py-2 text-center text-xs text-primary hover:underline">
            Ver todas
          </Link>
        </div>
      )}
    </div>
  );
}
