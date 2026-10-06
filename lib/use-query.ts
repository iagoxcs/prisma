"use client";

import { useEffect, useState } from "react";

type Result<D> = { data: D | null; error: { message: string } | null };

// Carrega dados do Supabase e permite recarregar. `deps` re-dispara a consulta.
export function useQuery<D>(fn: () => PromiseLike<Result<D>>, deps: unknown[]) {
  const [state, setState] = useState<{ data: D | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fn().then(({ data, error }) => {
      if (active) setState({ data, error: error?.message ?? null, loading: false });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { ...state, reload: () => setVersion((v) => v + 1) };
}
