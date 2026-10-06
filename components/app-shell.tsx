"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Briefcase, Building2, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/types/domain";

const NAV = [
  { href: "/", label: "Painel", icon: LayoutDashboard, internalOnly: false },
  { href: "/projetos/", label: "Projetos", icon: Briefcase, internalOnly: false },
  { href: "/clientes/", label: "Clientes", icon: Building2, internalOnly: true },
];

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

  const items = NAV.filter((i) => !i.internalOnly || !profile.is_external);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="mb-6 text-lg font-semibold tracking-tight">Prisma</div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, ""));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted",
                  active && "bg-muted font-medium",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t pt-3 text-xs">
          <div className="font-medium">{profile.name}</div>
          <div className="text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={signOut}>
            <LogOut /> Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
