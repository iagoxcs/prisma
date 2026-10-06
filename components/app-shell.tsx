"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Bell, Briefcase, Building2, CalendarRange, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { PrismaMark, PrismaWordmark } from "@/components/brand/prisma-mark";
import { Button } from "@/components/ui/button";
import { ORG_NAME } from "@/lib/settings";
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
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <PrismaMark size={40} title="Carregando" className="animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }

  if (!profile || !profile.active) {
    return (
      <div className="flex min-h-screen items-center justify-center p-5">
        <main className="glass-lamina w-full max-w-md p-8 text-center">
          <PrismaMark size={36} className="mx-auto mb-4" />
          <h1 className="text-xl">Acesso pendente</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta ainda não foi ativada. Peça a um administrador para liberar o acesso.
          </p>
          <Button className="mt-5" variant="outline" onClick={signOut}>
            Sair
          </Button>
        </main>
      </div>
    );
  }

  const items = NAV.filter((i) => (!i.internalOnly || !profile.is_external) && (!i.adminOnly || profile.role === "admin"));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

  return (
    <div className="flex min-h-screen gap-5 p-3 md:p-5">
      {/* Painel de navegação: lâmina de vidro (glass-painel) */}
      <aside className="glass-painel sticky top-5 hidden h-[calc(100vh-2.5rem)] w-60 shrink-0 flex-col p-4 md:flex">
        <Link href="/" className="mb-7 block px-2 pt-1" aria-label="Prisma, ir para o Painel">
          <PrismaWordmark />
          <span className="mt-1 block truncate pl-[2.45rem] text-[0.8125rem] font-medium text-muted-foreground">{ORG_NAME}</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Navegação principal">
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                  active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 rounded-lg bg-sidebar-accent p-3 text-sm">
          <div className="font-semibold">{profile.name}</div>
          <div className="text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={signOut}>
            <LogOut strokeWidth={1.75} /> Sair
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="flex items-center justify-between gap-2 px-1 md:justify-end">
          <nav className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden" aria-label="Navegação">
            {items.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-muted-foreground",
                  isActive(href) && "bg-primary text-primary-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Sair" onClick={signOut}>
              <LogOut strokeWidth={1.75} />
            </Button>
          </div>
        </header>
        {/* Área de trabalho: lâmina principal (glass-lamina). Conteúdo interno NÃO usa blur. */}
        <main className="glass-lamina min-w-0 flex-1 p-4 md:p-7">{children}</main>
      </div>
    </div>
  );
}
