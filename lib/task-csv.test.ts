import { describe, expect, it } from "vitest";
import { parseCsv, parseDate, templatePhases } from "@/lib/task-csv";

describe("parseCsv", () => {
  it("separa por ponto e vírgula", () => {
    expect(parseCsv("Título;Escopo\nA;B\n")).toEqual([
      ["Título", "Escopo"],
      ["A", "B"],
    ]);
  });

  it("aceita campos entre aspas com separador e aspas escapadas", () => {
    expect(parseCsv('a;b\n"x;y";"diz ""oi"""\n')).toEqual([
      ["a", "b"],
      ["x;y", 'diz "oi"'],
    ]);
  });

  it("remove o BOM do início", () => {
    const rows = parseCsv("﻿Título;Prazo\r\nA;01/11/2026\r\n");
    expect(rows[0][0]).toBe("Título");
    expect(rows).toEqual([
      ["Título", "Prazo"],
      ["A", "01/11/2026"],
    ]);
  });

  it("mantém quebra de linha dentro de aspas", () => {
    expect(parseCsv('a;b\n"linha 1\nlinha 2";c\n')).toEqual([
      ["a", "b"],
      ["linha 1\nlinha 2", "c"],
    ]);
  });

  it("lê a última linha sem quebra final", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseDate", () => {
  it.each([
    ["2026-11-17", "2026-11-17"],
    ["17/11/2026", "2026-11-17"],
    ["7.1.26", "2026-01-07"],
    ["2026-11-17T10:00:00Z", "2026-11-17"],
    [" 29/02/2028 ", "2028-02-29"],
  ])("converte %j em %s", (raw, iso) => {
    expect(parseDate(raw)).toBe(iso);
  });

  it.each(["31/02/2026", "2026-13-01", "29/02/2026", "amanhã", "", "11/2026"])("devolve null para %j", (raw) => {
    expect(parseDate(raw)).toBeNull();
  });
});

describe("templatePhases", () => {
  it("monta as fases a partir do Escopo, na ordem do arquivo", () => {
    const csv = "Título;Escopo\nT1;Diagnóstico\nT2;Implantação\nT3;Diagnóstico\n";
    expect(templatePhases(csv)).toEqual({
      phases: [
        { name: "Diagnóstico", tasks: 2 },
        { name: "Implantação", tasks: 1 },
      ],
      tasks: 3,
      errors: [],
    });
  });

  it("agrupa escopos que só diferem em acento e caixa, com o nome como escrito primeiro", () => {
    const { phases } = templatePhases("Título;Escopo\nT1;Diagnóstico\nT2;diagnostico\n");
    expect(phases).toEqual([{ name: "Diagnóstico", tasks: 2 }]);
  });

  it("aponta tarefas sem Escopo", () => {
    const result = templatePhases("Título;Escopo\nT1;Diagnóstico\nT2;\n");
    expect(result.tasks).toBe(2);
    expect(result.phases).toEqual([{ name: "Diagnóstico", tasks: 1 }]);
    expect(result.errors).toEqual([
      "1 tarefa(s) sem Escopo. Cada tarefa precisa indicar a fase na coluna Escopo.",
    ]);
  });

  it("aponta planilha sem tarefas", () => {
    const result = templatePhases("Título;Escopo\n");
    expect(result).toEqual({
      phases: [],
      tasks: 0,
      errors: ["A planilha não tem nenhuma tarefa com Título."],
    });
  });
});
