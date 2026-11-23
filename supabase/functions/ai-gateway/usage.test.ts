// Testes de usage.ts (O5). Rodar a partir da raiz do repositório:
//   npx deno test supabase/functions/ai-gateway/usage.test.ts
// Não é importado pelo index.ts, então não vai no deploy da função.
import { addDays, aggregateUsage, parseRange, parseUsageRows, todayBrt, UsageError } from "./usage.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function throwsUsage(fn: () => unknown, label: string) {
  try {
    fn();
  } catch (e) {
    assert(e instanceof UsageError, `${label}: esperava UsageError, veio ${e}`);
    return;
  }
  throw new Error(`${label}: não recusou`);
}

const TODAY = "2026-11-23";
const row = (extra: Record<string, unknown> = {}) => ({
  day: TODAY, source: "bot", model: "claude-sonnet-5.5", calls: 2, input_tokens: 10, output_tokens: 5, cache_read_tokens: 100, cache_write_tokens: 0, ...extra,
});

Deno.test("aceita linhas válidas e completa contadores ausentes com 0", () => {
  const out = parseUsageRows([row(), { day: "2026-11-16", source: "transcricao", model: "gemini-3.5-flash", calls: 1 }], ["bot", "transcricao"], TODAY);
  assert(out.length === 2, "duas linhas");
  assert(out[1].input_tokens === 0 && out[1].cache_write_tokens === 0, "contadores ausentes viram 0");
});

Deno.test("recusa fonte fora das permitidas (plugin não grava como rotina)", () => {
  throwsUsage(() => parseUsageRows([row({ source: "rotina" })], ["bot", "transcricao"], TODAY), "fonte");
});

Deno.test("recusa dia no futuro, antes de 7 dias e data inválida", () => {
  throwsUsage(() => parseUsageRows([row({ day: "2026-11-24" })], ["bot"], TODAY), "futuro");
  throwsUsage(() => parseUsageRows([row({ day: "2026-11-15" })], ["bot"], TODAY), "antigo");
  throwsUsage(() => parseUsageRows([row({ day: "2026-02-30" })], ["bot"], TODAY), "inválida");
});

Deno.test("recusa contador negativo, fracionário, texto ou grande demais", () => {
  for (const v of [-1, 1.5, "10", 2_000_000_000]) {
    throwsUsage(() => parseUsageRows([row({ input_tokens: v })], ["bot"], TODAY), `input_tokens=${v}`);
  }
});

Deno.test("recusa modelo inválido, lista vazia ou longa demais", () => {
  throwsUsage(() => parseUsageRows([row({ model: "a b" })], ["bot"], TODAY), "modelo com espaço");
  throwsUsage(() => parseUsageRows([], ["bot"], TODAY), "vazia");
  throwsUsage(() => parseUsageRows(Array.from({ length: 51 }, () => row()), ["bot"], TODAY), "51 linhas");
  throwsUsage(() => parseUsageRows("x", ["bot"], TODAY), "não lista");
});

Deno.test("parseRange: até 62 dias, from <= to", () => {
  parseRange("2026-11-01", "2026-11-30");
  parseRange("2026-10-01", addDays("2026-10-01", 61));
  throwsUsage(() => parseRange("2026-10-01", addDays("2026-10-01", 62)), "63 dias");
  throwsUsage(() => parseRange("2026-11-30", "2026-11-01"), "invertido");
  throwsUsage(() => parseRange("2026-11-01", undefined), "sem to");
});

Deno.test("aggregateUsage soma por fonte e modelo e ordena", () => {
  const out = aggregateUsage([
    { source: "rotina", model: "claude-haiku-5.5", calls: 1, input_tokens: 5 },
    { source: "bot", model: "claude-sonnet-5.5", calls: 2, input_tokens: 10, output_tokens: 1 },
    { source: "bot", model: "claude-sonnet-5.5", calls: 3, input_tokens: 20, output_tokens: 2 },
  ]);
  assert(out.length === 2, "duas chaves");
  assert(out[0].source === "bot" && out[0].calls === 5 && out[0].input_tokens === 30 && out[0].output_tokens === 3, "soma do bot");
  assert(out[1].source === "rotina" && out[1].cache_read_tokens === 0, "rotina com zeros");
});

Deno.test("todayBrt usa America/Sao_Paulo", () => {
  assert(todayBrt(new Date("2026-11-24T02:30:00Z")) === "2026-11-23", "23:30 BRT ainda é dia 23");
  assert(todayBrt(new Date("2026-11-24T03:30:00Z")) === "2026-11-24", "00:30 BRT já é dia 24");
});
