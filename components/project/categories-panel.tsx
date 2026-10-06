"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import type { Category } from "@/types/domain";

// Escopos do projeto (RF-02) = categorias das tarefas.
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
  const [color, setColor] = useState("#2563eb");
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
    <div className="max-w-xl space-y-4">
      <ul className="divide-y rounded-lg border">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: c.color }} />
              {c.name}
            </span>
            {canManage && (
              <button type="button" aria-label="Excluir escopo" className="text-muted-foreground hover:text-destructive" onClick={() => remove(c)}>
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
        {categories.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Nenhum escopo cadastrado.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="flex gap-2">
          <Input placeholder="Nome do escopo" required value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" aria-label="Cor" className="h-8 w-10 rounded border" value={color} onChange={(e) => setColor(e.target.value)} />
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
