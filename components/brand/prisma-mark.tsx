// Marca Prisma: três estratos formando um triângulo.
// Cores vêm dos tokens --mark-1..3 (trocam com o tema). Não recolorir, rotacionar ou adicionar efeitos.
type Props = { size?: number; title?: string; className?: string };

export function PrismaMark({ size = 32, title = "Prisma", className }: Props) {
  const h = Math.round((size * 32) / 36);
  return (
    <svg width={size} height={h} viewBox="0 0 36 32" role="img" aria-label={title} className={className}>
      <path d="M14 0 L22 0 L26 10 L10 10 Z" style={{ fill: "var(--mark-1)" }} />
      <path d="M9 12 L27 12 L31 21 L5 21 Z" style={{ fill: "var(--mark-2)" }} />
      <path d="M4 23 L32 23 L36 32 L0 32 Z" style={{ fill: "var(--mark-3)" }} />
    </svg>
  );
}

export function PrismaWordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
      <PrismaMark size={30} title="" />
      <span className="font-heading text-xl font-bold tracking-tight text-brand-ink">Prisma</span>
    </span>
  );
}
