"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, ROW, ROW_LIST } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/domain";

export default function ClientesPage() {
  const { can, profile } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canWrite = can("clients.manage");
  // Exclusão só para admin: é a regra do RLS (clients_delete usa is_admin()).
  const canDelete = profile?.role === "admin";
  const [removing, setRemoving] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    getSupabase()
      .from("clients")
      .select("id, name, status")
      .order("name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setClients((data as Client[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [version]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await getSupabase().from("clients").insert({ name: name.trim() });
    if (error) return setError(error.message);
    setName("");
    setVersion((v) => v + 1);
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().from("clients").delete().eq("id", removing.id).select("id").single();
    setBusy(false);
    setRemoving(null);
    if (error) {
      // 23503: projects.client_id é "on delete restrict".
      if (error.code === "23503") return setError(`"${removing.name}" tem projetos vinculados. Exclua os projetos ou troque o cliente deles antes.`);
      return setError(error.code === "PGRST116" ? "Sem permissão para excluir este cliente." : error.message);
    }
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-6">
      <h1>Clientes</h1>
      {canWrite && (
        <form onSubmit={add} className="flex max-w-md gap-2">
          <Input placeholder="Nome do cliente" required value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <ul className={ROW_LIST}>
        {clients.map((c) => (
          <li key={c.id} className={ROW}>
            <span className={cn("font-medium", c.status !== "ativo" && "text-muted-foreground")}>{c.name}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                <span className={cn("size-2 rounded-full", c.status === "ativo" ? "bg-status-active" : "bg-status-cancelled")} />
                {c.status === "ativo" ? "Ativo" : "Inativo"}
              </span>
              {canDelete && (
                <Button type="button" variant="ghost" size="icon" aria-label={`Excluir ${c.name}`} title="Excluir cliente" onClick={() => setRemoving(c)}>
                  <Trash2 strokeWidth={1.75} />
                </Button>
              )}
            </span>
          </li>
        ))}
        {clients.length === 0 && <li className="text-sm text-muted-foreground">Nenhum cliente cadastrado.{canWrite && " Adicione o primeiro acima."}</li>}
      </ul>
      <ConfirmDialog
        open={!!removing}
        title="Excluir cliente?"
        description={removing ? `"${removing.name}" será excluído. Não dá para desfazer. Clientes com projetos vinculados não podem ser excluídos.` : undefined}
        confirmLabel={busy ? "Excluindo…" : "Excluir"}
        destructive
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
