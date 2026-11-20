"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Autosaver, type SaveFn, type SaveState } from "@/lib/autosave";

export const AUTOSAVE_DELAY = 1000;

// Salvamento automático de um formulário: grava após uma pausa na edição (AUTOSAVE_DELAY),
// e ao desmontar grava o que ainda estiver pendente. Valores comparados por JSON.
export function useAutosave<T>(
  value: T,
  { save, valid, delay = AUTOSAVE_DELAY }: { save: SaveFn<T>; valid?: (value: T) => boolean; delay?: number },
) {
  const [status, setStatus] = useState<{ state: SaveState; error: string | null }>({ state: "idle", error: null });
  const [saver] = useState(() => new Autosaver<T>(value, { delay, onState: (state, error) => setStatus({ state, error }) }));
  // Antes do efeito que entrega o valor: a gravação sempre usa as funções da última renderização.
  useEffect(() => {
    saver.configure({ save, valid });
  });

  const key = JSON.stringify(value);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  useEffect(() => {
    saver.update(latest.current);
  }, [saver, key]);

  // Fechar o painel ou sair da página não perde a última edição.
  useEffect(() => () => void saver.flush(), [saver]);

  // Estáveis entre renderizações (podem entrar em dependências de efeitos).
  const flush = useCallback(() => saver.flush(), [saver]);
  const cancel = useCallback(() => saver.cancel(), [saver]);
  return { ...status, flush, cancel };
}
