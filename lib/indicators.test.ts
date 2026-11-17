import { describe, expect, it } from "vitest";
import { adherencePct, completionPct, throughputSeries, weekStartOf, THROUGHPUT_WEEKS } from "@/lib/indicators";

describe("completionPct", () => {
  it("soma concluídas e total entre linhas (não faz média de percentuais)", () => {
    expect(
      completionPct([
        { total: 10, done: 5, overdue: 0 },
        { total: 30, done: 25, overdue: 1 },
      ]),
    ).toBe(75);
  });

  it("devolve null com total zero ou sem linhas", () => {
    expect(completionPct([{ total: 0, done: 0, overdue: 0 }])).toBeNull();
    expect(completionPct([{ total: null, done: null, overdue: null }])).toBeNull();
    expect(completionPct([])).toBeNull();
  });
});

describe("adherencePct", () => {
  it("calcula concluídas no prazo sobre concluídas", () => {
    expect(adherencePct([{ done_total: 4, done_on_time: 3 }])).toBe(75);
  });

  it("devolve null sem concluídas com prazo", () => {
    expect(adherencePct([{ done_total: 0, done_on_time: 0 }])).toBeNull();
    expect(adherencePct([])).toBeNull();
  });
});

describe("weekStartOf", () => {
  it.each([
    ["2026-11-16", "2026-11-16"], // segunda
    ["2026-11-17", "2026-11-16"], // terça
    ["2026-11-22", "2026-11-16"], // domingo fica na semana iniciada na segunda anterior
    ["2026-01-01", "2025-12-29"], // virada de ano
  ])("%s → %s", (iso, monday) => {
    expect(weekStartOf(iso)).toBe(monday);
  });
});

describe("throughputSeries", () => {
  const today = "2026-11-17"; // semana de 16/11

  it("devolve as últimas semanas em ordem crescente, com zero nas semanas sem conclusão", () => {
    const series = throughputSeries(
      [
        { week_start: "2026-11-16", done_count: 2 },
        { week_start: "2026-11-02", done_count: 3 },
      ],
      today,
    );
    expect(series).toHaveLength(THROUGHPUT_WEEKS);
    expect(series[0].week_start).toBe("2026-08-31");
    expect(series.at(-1)).toEqual({ week_start: "2026-11-16", value: 2 });
    expect(series.at(-2)).toEqual({ week_start: "2026-11-09", value: 0 });
    expect(series.at(-3)).toEqual({ week_start: "2026-11-02", value: 3 });
    expect(series.slice(0, -3).every((p) => p.value === 0)).toBe(true);
  });

  it("soma linhas da mesma semana e ignora semana nula ou fora da janela", () => {
    const series = throughputSeries(
      [
        { week_start: "2026-11-09", done_count: 1 },
        { week_start: "2026-11-09", done_count: 4 },
        { week_start: "2026-11-09", done_count: null },
        { week_start: null, done_count: 9 },
        { week_start: "2026-01-05", done_count: 7 },
      ],
      today,
    );
    expect(series.at(-2)).toEqual({ week_start: "2026-11-09", value: 5 });
    expect(series.reduce((acc, p) => acc + p.value, 0)).toBe(5);
  });
});
