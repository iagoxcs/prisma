import { cn } from "@/lib/utils";

// Bloco de carregamento: bg-muted pulsando (parado com motion-reduce). Puramente visual.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} />;
}

// Mesmas dimensões de ROW (lib/ui.ts): linha de lista.
export function SkeletonRow({ className }: { className?: string }) {
  return <Skeleton className={cn("h-13 w-full rounded-lg", className)} />;
}

// Mesmas proporções de um card de tarefa (surface-card p-4).
export function SkeletonCard({ className }: { className?: string }) {
  return <Skeleton className={cn("h-28 w-full rounded-lg", className)} />;
}

// Lista de placeholders anunciada uma única vez a leitores de tela.
export function SkeletonList({
  count = 4,
  variant = "row",
  label = "Carregando…",
  className,
}: {
  count?: number;
  variant?: "row" | "card";
  label?: string;
  className?: string;
}) {
  const Item = variant === "card" ? SkeletonCard : SkeletonRow;
  return (
    <div role="status" className={cn("flex flex-col gap-2", variant === "card" && "gap-2.5", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <Item key={i} />
      ))}
    </div>
  );
}
