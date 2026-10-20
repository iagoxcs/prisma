// Fases de um modelo de projeto (escopos da planilha), na ordem do arquivo, com a contagem de tarefas.
export function PhaseList({ phases, total }: { phases: { name: string; tasks: number }[]; total: number }) {
  return (
    <div className="space-y-2">
      <p className="text-[0.8125rem] text-muted-foreground">
        <span className="num text-foreground">{phases.length}</span> fase(s) · <span className="num text-foreground">{total}</span> tarefa(s)
      </p>
      <ol className="flex flex-col">
        {phases.map((p, i) => (
          <li key={p.name} className="flex min-h-11 items-center justify-between gap-3 border-b text-sm last:border-b-0">
            <span className="flex items-center gap-3">
              <span className="num w-6 text-right text-muted-foreground">{i + 1}</span>
              {p.name}
            </span>
            <span className="num text-muted-foreground">{p.tasks}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
