"use client";

import { useEffect, useState } from "react";

type Result<D> = { data: D | null; error: { message: string } | null };

// Carrega dados do Supabase e permite recarregar. `deps` re-dispara a consulta.
// Em reload ou troca de deps, os dados anteriores permanecem e `refreshing` fica true;
// `loading` só volta a true quando não há dados (primeira carga ou nova tentativa após erro).
// Rejeições (rede, exceção na consulta) viram `error`: `loading` nunca fica preso em true.
export function useQuery<D>(fn: () => PromiseLike<Result<D>>, deps: unknown[]) {
  const [state, setState] = useState<{ data: D | null; error: string | null; loading: boolean; refreshing: boolean }>({
    data: null,
    error: null,
    loading: true,
    refreshing: false,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState((s) => (s.data !== null ? { ...s, refreshing: true } : { ...s, error: null, loading: true }));
    (async () => {
      try {
        const { data, error } = await fn();
        if (active) setState({ data, error: error?.message ?? null, loading: false, refreshing: false });
      } catch (e) {
        if (active) {
          setState((s) => ({
            data: s.data,
            error: e instanceof Error && e.message ? e.message : "Falha de conexão",
            loading: false,
            refreshing: false,
          }));
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { ...state, reload: () => setVersion((v) => v + 1) };
}
