// Testes de labels.ts (P10, P13). Rodar a partir da raiz do repositório:
//   deno test supabase/functions/ai-gateway/labels.test.ts
// Não é importado pelo index.ts, então não vai no deploy da função.
import { embeddedName, labelFromEmbed, projectLabel, withAssigneeNames } from "./labels.ts";

function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: esperava ${e}, veio ${a}`);
}

Deno.test("projectLabel junta projeto e cliente", () => {
  eq(projectLabel("Mapeamento de Processos", "Cliente Alfa"), "Mapeamento de Processos - Cliente Alfa", "com cliente");
  eq(projectLabel(" Diagnóstico ", " Cliente Beta "), "Diagnóstico - Cliente Beta", "apara espaços");
});

Deno.test("projectLabel sem cliente fica só com o projeto", () => {
  eq(projectLabel("Interno"), "Interno", "sem argumento");
  eq(projectLabel("Interno", null), "Interno", "nulo (sem clients.view)");
  eq(projectLabel("Interno", "   "), "Interno", "em branco");
});

Deno.test("embeddedName aceita objeto, lista e nulo", () => {
  eq(embeddedName({ name: "Cliente Alfa" }), "Cliente Alfa", "objeto");
  eq(embeddedName([{ name: "Cliente Alfa" }]), "Cliente Alfa", "lista");
  eq(embeddedName(null), null, "nulo");
  eq(embeddedName({ name: "" }), null, "vazio");
  eq(embeddedName({ nome: "x" }), null, "sem name");
});

Deno.test("labelFromEmbed monta o rótulo do embed projects(name, clients(name))", () => {
  eq(labelFromEmbed({ name: "BPM", clients: { name: "Cliente Beta" } }), "BPM - Cliente Beta", "com cliente");
  eq(labelFromEmbed({ name: "BPM", clients: null }), "BPM", "cliente invisível");
  eq(labelFromEmbed([{ name: "BPM", clients: [{ name: "Cliente Beta" }] }]), "BPM - Cliente Beta", "listas");
  eq(labelFromEmbed(null), null, "sem projeto");
});

Deno.test("withAssigneeNames põe o nome do responsável ao lado do id", () => {
  const names = new Map([["u1", "Ana Souza"]]);
  const rows = [
    { id: "t1", assignee_id: "u1" },
    { id: "t2", assignee_id: null },
    { id: "t3", assignee_id: "u9" },
  ];
  eq(withAssigneeNames(rows, names), [
    { id: "t1", assignee_id: "u1", assignee_name: "Ana Souza" },
    { id: "t2", assignee_id: null, assignee_name: null },
    { id: "t3", assignee_id: "u9", assignee_name: null },
  ], "nomes");
});
