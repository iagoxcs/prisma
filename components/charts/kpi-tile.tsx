import { cn } from "@/lib/utils";

// Item de <dl>: "…" carregando, "—" indisponível/sem base (nunca 0 em erro), valor formatado quando há dado.
// `warn` aplica âmbar (condição de atraso), e o rótulo já diz do que se trata.
export function KpiTile({
  label,
  value,
  loading,
  error,
  warn,
  hint,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  error: boolean;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className="glass-coluna space-y-1 p-5">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("num text-4xl font-medium tracking-tight", warn && "text-warning")}>
        {loading ? (
          <>
            <span aria-hidden>…</span>
            <span className="sr-only">Carregando</span>
          </>
        ) : error || value === null ? (
          <span role="img" aria-label={error ? "indisponível" : "sem dados"}>
            —
          </span>
        ) : (
          value
        )}
      </dd>
      {hint && <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}
