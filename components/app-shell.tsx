"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  CalendarRange,
  ChartColumn,
  CircleUser,
  FileText,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { PrismaMark, PrismaWordmark } from "@/components/brand/prisma-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import type { Permission } from "@/lib/permissions";
import { ORG_NAME } from "@/lib/settings";
import { useStoredFlag } from "@/lib/use-stored-flag";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/types/domain";

const NAV = [
  { href: "/", label: "Meu painel", icon: LayoutDashboard },
  { href: "/projetos/", label: "Projetos", icon: Briefcase },
  { href: "/cronograma/", label: "Cronograma", icon: CalendarRange },
  { href: "/indicadores/", label: "Indicadores", icon: ChartColumn, internalOnly: true },
  { href: "/documentos/", label: "Documentos", icon: FileText, internalOnly: true },
  { href: "/conhecimento/", label: "Conhecimento", icon: BookOpen, internalOnly: true },
  { href: "/notificacoes/", label: "Notificações", icon: Bell },
  { href: "/clientes/", label: "Clientes", icon: Building2, internalOnly: true, perm: "clients.view" },
  { href: "/configuracoes/", label: "Configurações", icon: Settings, internalOnly: true, adminOnly: true },
] as { href: string; label: string; icon: typeof Bell; internalOnly?: boolean; adminOnly?: boolean; perm?: Permission }[];

// O gate é só UX: a segurança real é o RLS no banco.
export function AppShell({ children }: { children: ReactNode }) {
  const { loading, session, profile, profileError, can, retry, signOut } = useAuth();
  // Menu lateral recolhido (só ícones). Preferência do navegador; no celular o menu é a faixa do topo.
  const [collapsed, setCollapsed] = useStoredFlag("prisma.menu-recolhido");
  const pathname = usePathname();
  const router = useRouter();
  const mobileNav = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!loading && !session) router.replace("/login/");
  }, [loading, session, router]);

  // Celular: a faixa de navegação rola na horizontal; centraliza a página atual para ela nunca ficar escondida.
  const ready = !!profile?.active;
  useEffect(() => {
    const nav = mobileNav.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    nav.scrollLeft += active.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - active.offsetWidth) / 2;
  }, [pathname, ready]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <PrismaMark size={40} title="Carregando" className="animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }

  // Falha ao ler o perfil não é conta inativa: oferece nova tentativa em vez de "Acesso pendente".
  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-5">
        <main className="glass-lamina w-full max-w-md space-y-4 p-6">
          <PrismaMark size={36} className="mx-auto" />
          <ErrorState what="seu perfil" detail={profileError} onRetry={retry} />
          <Button variant="outline" className="w-full" onClick={signOut}>
            Sair
          </Button>
        </main>
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

  const items = NAV.filter(
    (i) => (!i.internalOnly || !profile.is_external) && (!i.adminOnly || profile.role === "admin") && (!i.perm || can(i.perm)),
  );
  // A página de um projeto (/projeto/?id=) pertence a "Projetos".
  const section = pathname.startsWith("/projeto/") ? "/projetos/" : pathname;
  const isActive = (href: string) => (href === "/" ? section === "/" : section.startsWith(href.replace(/\/$/, "")));

  return (
    <div className="flex min-h-screen gap-5 p-3 md:p-5">
      {/* Painel de navegação: lâmina de vidro (glass-painel) */}
      <aside
        className={cn(
          "glass-painel sticky top-5 hidden h-[calc(100dvh-2.5rem)] shrink-0 flex-col overflow-hidden py-4 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
          collapsed ? "w-[4.5rem] px-2.5" : "w-60 px-4",
        )}
      >
        <Link
          href="/"
          className={cn("mb-7 block shrink-0 pt-1 baixa:mb-3", collapsed ? "flex justify-center px-0" : "px-2")}
          aria-label="Prisma, ir para o Meu painel"
          title={collapsed ? "Meu painel" : undefined}
        >
          {collapsed ? (
            <PrismaMark size={34} />
          ) : (
            <>
              <PrismaWordmark />
              <span className="mt-1 block truncate pl-[2.45rem] text-[0.8125rem] font-medium text-muted-foreground">{ORG_NAME}</span>
            </>
          )}
        </Link>
        {/* Se ainda faltar altura, a lista rola com barra visível: itens escondidos sem pista pareciam cortados. */}
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto [scrollbar-width:thin] baixa:gap-0.5" aria-label="Navegação principal">
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-3 rounded-md text-[0.9375rem] baixa:min-h-9 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                  collapsed ? "justify-center px-0" : "px-3",
                  active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                )}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>
        {collapsed ? (
          <div className="mt-4 flex shrink-0 flex-col items-center gap-1 baixa:mt-2">
            <Link
              href="/conta/"
              aria-current={isActive("/conta/") ? "page" : undefined}
              aria-label={`Minha conta (${profile.name})`}
              title={`${profile.name} · ${ROLE_LABEL[profile.role]}`}
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), isActive("/conta/") && "text-foreground")}
            >
              <CircleUser strokeWidth={1.75} />
            </Link>
            <Button variant="ghost" size="icon" aria-label="Sair" title="Sair" onClick={signOut}>
              <LogOut strokeWidth={1.75} />
            </Button>
          </div>
        ) : (
          <div className="mt-4 shrink-0 rounded-lg bg-sidebar-accent p-3 text-sm baixa:mt-2 baixa:p-2 baixa:pl-3">
            <div className="truncate font-semibold">{profile.name}</div>
            <div className="text-muted-foreground baixa:hidden">{ROLE_LABEL[profile.role]}</div>
            <div className="mt-2 -ml-2 flex flex-wrap baixa:mt-1">
              <Link
                href="/conta/"
                aria-current={isActive("/conta/") ? "page" : undefined}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), isActive("/conta/") && "text-foreground")}
              >
                <CircleUser strokeWidth={1.75} /> Minha conta
              </Link>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut strokeWidth={1.75} /> Sair
              </Button>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn("mt-2 shrink-0 text-muted-foreground baixa:mt-1", collapsed ? "self-center" : "justify-start")}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : undefined}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen strokeWidth={1.75} /> : <PanelLeftClose strokeWidth={1.75} />}
          {!collapsed && "Recolher menu"}
        </Button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Celular: marca e ações numa linha; a navegação ganha a largura toda na linha de baixo
            (dividindo a linha com os ícones, só um ou dois itens cabiam e o resto ficava cortado). */}
        <header className="flex flex-col gap-1 px-1 md:flex-row md:items-center md:justify-end">
          <div className="flex items-center justify-between gap-2 md:contents">
            <Link href="/" className="flex min-h-11 items-center md:hidden" aria-label="Prisma, ir para o Meu painel">
              <PrismaMark size={28} />
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell />
              <Link href="/conta/" aria-label="Minha conta" className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}>
                <CircleUser strokeWidth={1.75} />
              </Link>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Sair" onClick={signOut}>
                <LogOut strokeWidth={1.75} />
              </Button>
            </div>
          </div>
          <nav ref={mobileNav} className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden" aria-label="Navegação">
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
        </header>
        {/* Área de trabalho: lâmina principal (glass-lamina). Conteúdo interno NÃO usa blur. */}
        <main className="glass-lamina min-w-0 flex-1 p-4 md:p-7">{children}</main>
      </div>
    </div>
  );
}
