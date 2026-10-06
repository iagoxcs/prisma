// Tema claro (Lâminas) / escuro (Noturno). Preferência guardada no navegador do usuário.
export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "prisma-theme";

// Executado inline no <head> antes do primeiro paint. Mantenha sem dependências.
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const THEME_EVENT = "prisma-theme-change";

export function applyTheme(pref: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* navegação privada: aplica só nesta sessão */
  }
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new Event(THEME_EVENT));
}

// Para useSyncExternalStore: avisa quando a preferência muda (nesta aba, em outra aba ou no sistema).
export function subscribeTheme(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (readThemePreference() === "system") applyTheme("system");
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyTheme(readThemePreference());
  };
  mq.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    mq.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}
