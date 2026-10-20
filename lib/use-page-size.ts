"use client";

import { useCallback, useSyncExternalStore } from "react";

// Tamanho de página guardado no navegador, por tela (`scope`).
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

const PAGE_SIZE_EVENT = "prisma-page-size-change";
const storageKey = (scope: string) => `prisma-page-size:${scope}`;

const isPageSize = (n: number): n is PageSize => (PAGE_SIZES as readonly number[]).includes(n);

function readPageSize(scope: string): PageSize {
  try {
    const n = Number(localStorage.getItem(storageKey(scope)));
    return isPageSize(n) ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

// Avisa quando o tamanho muda nesta aba ou em outra.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PAGE_SIZE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PAGE_SIZE_EVENT, onChange);
  };
}

// No export estático, o HTML e a hidratação usam o padrão; o valor salvo entra só após a montagem.
export function usePageSize(scope: string): [PageSize, (size: number) => void] {
  const pageSize = useSyncExternalStore(subscribe, () => readPageSize(scope), () => DEFAULT_PAGE_SIZE);

  const setPageSize = useCallback(
    (size: number) => {
      if (!isPageSize(size)) return;
      try {
        localStorage.setItem(storageKey(scope), String(size));
      } catch {
        /* navegação privada: o valor não persiste */
      }
      window.dispatchEvent(new Event(PAGE_SIZE_EVENT));
    },
    [scope],
  );

  return [pageSize, setPageSize];
}
