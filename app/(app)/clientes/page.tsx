"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, ROW, ROW_LIST } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/domain";

export default function ClientesPage() {
  const { profile } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canWrite = profile?.role === "admin" || profile?.role === "gerente";

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
            <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span className={cn("size-2 rounded-full", c.status === "ativo" ? "bg-status-active" : "bg-status-cancelled")} />
              {c.status === "ativo" ? "Ativo" : "Inativo"}
            </span>
          </li>
        ))}
        {clients.length === 0 && <li className="text-sm text-muted-foreground">Nenhum cliente cadastrado.{canWrite && " Adicione o primeiro acima."}</li>}
      </ul>
    </div>
  );
}
