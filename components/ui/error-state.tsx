import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Falha ao carregar: diz o que não carregou, o que fazer e oferece nova tentativa (reload() do useQuery).
export function ErrorState({
  what,
  detail,
  onRetry,
  className,
}: {
  what: string; // ex.: "suas tarefas", "os projetos"
  detail?: string | null; // mensagem técnica do Supabase, exibida em segundo plano
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("glass-coluna flex flex-wrap items-center justify-between gap-3 p-4 text-sm", className)}>
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-destructive">Não foi possível carregar {what}.</p>
        <p className="text-muted-foreground">Verifique sua conexão e tente novamente. Se o problema continuar, avise o administrador.</p>
        {detail && <p className="text-[0.8125rem] break-words text-muted-foreground">Detalhe: {detail}</p>}
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        <RotateCw strokeWidth={1.75} aria-hidden /> Tentar novamente
      </Button>
    </div>
  );
}
