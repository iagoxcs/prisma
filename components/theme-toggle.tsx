"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyTheme, readThemePreference, subscribeTheme, type ThemePreference } from "@/lib/theme/theme";

const NEXT: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemePreference, string> = {
  system: "Tema: automático (segue o sistema)",
  light: "Tema: claro",
  dark: "Tema: escuro",
};

// Alterna automático → claro → escuro. A classe .dark já foi aplicada antes do paint (THEME_INIT_SCRIPT).
export function ThemeToggle() {
  const pref = useSyncExternalStore<ThemePreference>(subscribeTheme, readThemePreference, () => "system");

  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon" onClick={() => applyTheme(NEXT[pref])} aria-label={LABEL[pref]} title={LABEL[pref]}>
      <Icon strokeWidth={1.75} />
    </Button>
  );
}
