"use client";

import { useCallback, useSyncExternalStore } from "react";

// Preferência booleana de interface guardada no navegador (menu recolhido, seção fechada).
// localStorage pode lançar (janela privada, dados bloqueados): nesse caso vale o padrão e nada quebra.
const listeners = new Set<() => void>();
// Cópia em memória: mantém a escolha na sessão mesmo quando o localStorage falha.
const memory = new Map<string, boolean>();

function read(key: string, fallback: boolean): boolean {
  const m = memory.get(key);
  if (m !== undefined) return m;
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useStoredFlag(key: string, fallback = false): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (v: boolean) => {
      memory.set(key, v);
      try {
        window.localStorage.setItem(key, v ? "1" : "0");
      } catch {
        // Sem armazenamento: a mudança vale só até recarregar a página.
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
