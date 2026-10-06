"use client";

import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import { CATEGORY_PALETTE, categoryColor } from "@/lib/theme/status";
import { MSG_ERROR, ROW, ROW_LIST } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/domain";

// Escopos do projeto (RF-02) = categorias das tarefas. Cor só da CATEGORY_PALETTE (sem seletor livre).
export function CategoriesPanel({
  projectId,
  categories,
  canManage,
  onChanged,
}: {
  projectId: string;
  categories: Category[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CATEGORY_PALETTE[0].light);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await getSupabase().from("categories").insert({ project_id: projectId, name: name.trim(), color });
    if (error) return setError(error.code === "23505" ? "Já existe um escopo com esse nome." : error.message);
    setName("");
    onChanged();
  }

  async function remove(c: Category) {
    if (!confirm(`Excluir o escopo "${c.name}"? As tarefas ficarão sem escopo.`)) return;
    const { error } = await getSupabase().from("categories").delete().eq("id", c.id);
    if (error) return setError(error.message);
    onChanged();
  }

  return (
    <div className="max-w-xl space-y-5">
      <ul className={ROW_LIST}>
        {categories.map((c) => (
          <li key={c.id} className={ROW}>
            <span className="flex items-center gap-2.5 font-medium">
              <span className="size-3 rounded-full" style={{ background: categoryColor(c.color) }} />
              {c.name}
            </span>
            {canManage && (
              <Button variant="ghost" size="icon" aria-label={`Excluir escopo ${c.name}`} className="-mr-2 text-muted-foreground hover:text-destructive" onClick={() => remove(c)}>
                <X strokeWidth={1.75} />
              </Button>
            )}
          </li>
        ))}
        {categories.length === 0 && <li className="text-sm text-muted-foreground">Nenhum escopo cadastrado. Crie o primeiro abaixo.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="glass-coluna space-y-4 p-5">
          <h3>Novo escopo</h3>
          <Input placeholder="Nome do escopo" aria-label="Nome do escopo" required value={name} onChange={(e) => setName(e.target.value)} />
          <fieldset>
            <legend className="mb-2 text-[0.8125rem] font-medium text-muted-foreground">Cor</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_PALETTE.map((p) => (
                <button
                  key={p.light}
                  type="button"
                  aria-label={p.name}
                  aria-pressed={color === p.light}
                  title={p.name}
                  onClick={() => setColor(p.light)}
                  className={cn("flex size-11 items-center justify-center rounded-md border-2 border-transparent", color === p.light && "border-ring")}
                >
                  <span className="flex size-7 items-center justify-center rounded-full" style={{ background: categoryColor(p.light) }}>
                    {color === p.light && <Check className="size-4 text-background" strokeWidth={2.25} />}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="submit">Adicionar escopo</Button>
        </form>
      )}
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
    </div>
  );
}
