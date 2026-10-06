"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";
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
      <h1 className="text-2xl font-semibold">Clientes</h1>
      {canWrite && (
        <form onSubmit={add} className="flex max-w-md gap-2">
          <Input placeholder="Nome do cliente" required value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">Adicionar</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y rounded-lg border">
        {clients.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
            {c.name}
            <Badge variant={c.status === "ativo" ? "default" : "secondary"}>{c.status}</Badge>
          </li>
        ))}
        {clients.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">Nenhum cliente cadastrado.</li>}
      </ul>
    </div>
  );
}
