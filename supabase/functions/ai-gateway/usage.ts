// Telemetria de uso da IA (O5, DP3): validação das linhas de tokens e agregação do resumo do mês.
// Funções puras (sem banco), testadas em usage.test.ts com `deno test`.

export const USAGE_MAX_ROWS = 50;
export const USAGE_PAST_DAYS = 7; // o plugin envia a cada 10 min; a rotina, uma vez por dia
export const USAGE_MAX_COUNT = 1_000_000_000;
export const SUMMARY_MAX_DAYS = 62;
const MODEL_RE = /^[A-Za-z0-9._:\/@-]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTS = ["calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"] as const;

export type UsageSource = "bot" | "transcricao" | "rotina";
export type UsageCounts = Record<(typeof COUNTS)[number], number>;
export type UsageRow = { day: string; source: UsageSource; model: string } & UsageCounts;

export class UsageError extends Error {}

export function isIsoDate(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return DATE_RE.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Data de hoje em America/Sao_Paulo (AAAA-MM-DD), como o plugin e a rotina contam o dia.
export function todayBrt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Valida `rows` vindo do plugin (bot, transcricao) ou da rotina (rotina). Dia entre hoje−7 e hoje (BRT).
export function parseUsageRows(raw: unknown, allowed: readonly UsageSource[], today: string): UsageRow[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > USAGE_MAX_ROWS) {
    throw new UsageError(`rows deve ter de 1 a ${USAGE_MAX_ROWS} linhas.`);
  }
  const oldest = addDays(today, -USAGE_PAST_DAYS);
  return raw.map((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new UsageError(`rows[${i}] inválida.`);
    const row = r as Record<string, unknown>;
    const day = typeof row.day === "string" ? row.day : "";
    if (!isIsoDate(day) || day < oldest || day > today) {
      throw new UsageError(`rows[${i}].day deve ser uma data entre ${oldest} e ${today}.`);
    }
    const source = row.source;
    if (typeof source !== "string" || !(allowed as readonly string[]).includes(source)) {
      throw new UsageError(`rows[${i}].source deve ser ${allowed.join(" ou ")}.`);
    }
    const model = typeof row.model === "string" ? row.model : "";
    if (!MODEL_RE.test(model)) throw new UsageError(`rows[${i}].model inválido.`);
    const counts = {} as UsageCounts;
    for (const k of COUNTS) {
      const v = row[k] ?? 0;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > USAGE_MAX_COUNT) {
        throw new UsageError(`rows[${i}].${k} deve ser inteiro entre 0 e ${USAGE_MAX_COUNT}.`);
      }
      counts[k] = v;
    }
    return { day, source: source as UsageSource, model, ...counts };
  });
}

// Intervalo do resumo: datas válidas, from <= to, até 62 dias.
export function parseRange(from: unknown, to: unknown): { from: string; to: string } {
  if (typeof from !== "string" || typeof to !== "string" || !isIsoDate(from) || !isIsoDate(to)) {
    throw new UsageError("from e to devem estar no formato AAAA-MM-DD.");
  }
  if (from > to) throw new UsageError("from deve ser anterior ou igual a to.");
  if (addDays(from, SUMMARY_MAX_DAYS - 1) < to) throw new UsageError(`O intervalo vai até ${SUMMARY_MAX_DAYS} dias.`);
  return { from, to };
}

// Soma as linhas diárias por fonte e modelo (ordem: fonte, modelo).
export function aggregateUsage(rows: Array<{ source: string; model: string } & Partial<UsageCounts>>) {
  const acc = new Map<string, { source: string; model: string } & UsageCounts>();
  for (const r of rows) {
    const key = `${r.source}\u0000${r.model}`;
    const cur = acc.get(key) ?? { source: r.source, model: r.model, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
    for (const k of COUNTS) cur[k] += Number(r[k] ?? 0);
    acc.set(key, cur);
  }
  return [...acc.values()].sort((a, b) => a.source.localeCompare(b.source) || a.model.localeCompare(b.model));
}
