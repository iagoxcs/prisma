import { PrismaWordmark } from "@/components/brand/prisma-mark";
import { ThemeToggle } from "@/components/theme-toggle";

// Moldura das telas fora do app (login, recuperar e redefinir senha).
export function AuthCard({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-3 right-3 md:top-5 md:right-5">
        <ThemeToggle />
      </div>
      <main className="glass-lamina w-full max-w-sm space-y-7 p-7">
        <div className="space-y-2">
          <PrismaWordmark />
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
