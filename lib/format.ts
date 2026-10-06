// Formatação de datas para exibição (sempre America/Sao_Paulo). Use com o utilitário `num`.

// "2026-10-02" → "02/10/2026"
export const brDate = (iso: string) => iso.split("-").reverse().join("/");

// "2026-10-02" → "02 out" (selo de vencimento, cards)
export function shortDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
    .replace(".", "")
    .replace(" de ", " ");
}

// timestamptz → "05/10/2026 14:30"
export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

// Iniciais para avatar: "Ana Paula Souza" → "AS"
export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
