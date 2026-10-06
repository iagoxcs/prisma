"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Bell, Briefcase, Building2, CalendarRange, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { NotificationBell } from "@/components/notification-bell";
import { OrgName } from "@/components/org-name";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/types/domain";

const NAV = [
  { href: "/", label: "Painel", icon: LayoutDashboard },
  { href: "/projetos/", label: "Projetos", icon: Briefcase },
  { href: "/cronograma/", label: "Cronograma", icon: CalendarRange },
  { href: "/notificacoes/", label: "Notificações", icon: Bell },
  { href: "/clientes/", label: "Clientes", icon: Building2, internalOnly: true },
  { href: "/configuracoes/", label: "Configurações", icon: Settings, internalOnly: true, adminOnly: true },
] as { href: string; label: string; icon: typeof Bell; internalOnly?: boolean; adminOnly?: boolean }[];

// O gate é só UX: a segurança real é o RLS no banco.
export function AppShell({ children }: { children: ReactNode }) {
  const { loading, session, profile, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login/");
  }, [loading, session, router]);

  if (loading || !session) {
    return <p className="p-8 text-sm text-muted-foreground">Carregando…</p>;
  }

  if (!profile || !profile.active) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Acesso pendente</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sua conta ainda não foi ativada. Peça a um administrador para liberar o acesso.
        </p>
        <Button className="mt-4" variant="outline" onClick={signOut}>
          Sair
        </Button>
      </main>
    );
  }

  const items = NAV.filter((i) => (!i.internalOnly || !profile.is_external) && (!i.adminOnly || profile.role === "admin"));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="mb-6"><div className="text-lg font-semibold tracking-tight">Prisma</div><OrgName /></div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted", isActive(href) && "bg-muted font-medium")}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t pt-3 text-xs">
          <div className="font-medium">{profile.name}</div>
          <div className="text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={signOut}>
            <LogOut /> Sair
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-2 md:justify-end md:px-8">
          <nav className="flex gap-1 overflow-x-auto md:hidden" aria-label="Navegação">
            {items.map(({ href, label }) => (
              <Link key={href} href={href} className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted", isActive(href) && "bg-muted font-medium")}>
                {label}
              </Link>
            ))}
          </nav>
          <NotificationBell />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
