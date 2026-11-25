"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Clientes virou aba de Configurações; o endereço antigo continua valendo.
export default function ClientesPage() {
  const router = useRouter();
  useEffect(() => router.replace("/configuracoes/?tab=clientes"), [router]);
  return null;
}
