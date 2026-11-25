"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A Base de conhecimento virou aba de Configurações; o endereço antigo continua valendo.
export default function ConhecimentoPage() {
  const router = useRouter();
  useEffect(() => router.replace("/configuracoes/?tab=conhecimento"), [router]);
  return null;
}
