// Fundo da aplicação: os três estratos da marca, ampliados e desfocados.
// É o que dá refração às camadas de vidro. Renderizado UMA vez, fixo, atrás de tudo.
// Não duplicar por página, não animar, não trocar por blobs/gradientes genéricos.
export function StrataBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ opacity: "var(--strata-opacity)" }}>
      <svg className="h-full w-full" viewBox="0 0 1440 1040" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="prisma-strata-blur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="50" />
          </filter>
        </defs>
        <g filter="url(#prisma-strata-blur)">
          <path d="M160 60 L360 60 L420 230 L100 230 Z" style={{ fill: "var(--strata-1)" }} />
          <path d="M860 160 L1120 160 L1200 380 L780 380 Z" style={{ fill: "var(--strata-2)" }} />
          <path d="M700 460 L1260 460 L1380 760 L580 760 Z" style={{ fill: "var(--strata-3)" }} />
          <path d="M380 640 L800 640 L880 880 L300 880 Z" style={{ fill: "var(--strata-4)" }} />
        </g>
      </svg>
    </div>
  );
}
