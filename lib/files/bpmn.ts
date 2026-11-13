// BPMN 2.0: resumo em texto (leitura) e geração com diagrama (DI) e layout automático.
// Mesma lógica do plugin do Hermes (hermes/plugin-prisma/files.py): uma pool, uma raia por ator, fluxo da
// esquerda para a direita. O XML é lido com o DOMParser do navegador, que não resolve entidades externas.

const NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";

const KIND: Record<string, string> = {
  startEvent: "Início",
  endEvent: "Fim",
  intermediateCatchEvent: "Evento intermediário",
  intermediateThrowEvent: "Evento intermediário",
  boundaryEvent: "Evento de borda",
  task: "Tarefa",
  userTask: "Tarefa de usuário",
  serviceTask: "Tarefa de serviço",
  manualTask: "Tarefa manual",
  scriptTask: "Tarefa de script",
  sendTask: "Envio",
  receiveTask: "Recebimento",
  businessRuleTask: "Regra de negócio",
  subProcess: "Subprocesso",
  callActivity: "Atividade de chamada",
  exclusiveGateway: "Gateway exclusivo",
  parallelGateway: "Gateway paralelo",
  inclusiveGateway: "Gateway inclusivo",
  eventBasedGateway: "Gateway baseado em evento",
};

export async function bpmnSummary(xml: string): Promise<string> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido");
  const root = doc.documentElement;
  if (root.namespaceURI !== NS) throw new Error("Não é BPMN 2.0");
  const all = [...root.getElementsByTagNameNS(NS, "*")];
  const names = new Map<string, string>();
  for (const el of all) {
    const id = el.getAttribute("id");
    if (id) names.set(id, el.getAttribute("name")?.trim() || id);
  }
  const out: string[] = [];
  for (const p of root.getElementsByTagNameNS(NS, "participant")) out.push(`Participante (pool): ${names.get(p.getAttribute("id") ?? "")}`);
  for (const proc of [...root.children].filter((c) => c.namespaceURI === NS && c.localName === "process")) {
    out.push("", `# Processo: ${proc.getAttribute("name") || proc.getAttribute("id")}`);
    const laneOf = new Map<string, string>();
    const lanes = [...proc.getElementsByTagNameNS(NS, "lane")];
    for (const lane of lanes) {
      for (const ref of lane.getElementsByTagNameNS(NS, "flowNodeRef")) {
        laneOf.set((ref.textContent ?? "").trim(), lane.getAttribute("name") || lane.getAttribute("id") || "");
      }
    }
    if (lanes.length) out.push(`Raias: ${lanes.map((l) => l.getAttribute("name") || l.getAttribute("id")).join(", ")}`);
    out.push("", "## Elementos");
    for (const el of proc.getElementsByTagNameNS(NS, "*")) {
      const id = el.getAttribute("id");
      if (!id || !KIND[el.localName]) continue;
      const lane = laneOf.get(id);
      out.push(`- [${KIND[el.localName]}] ${names.get(id)}${lane ? ` (raia: ${lane})` : ""}`);
    }
    const flows = [...proc.getElementsByTagNameNS(NS, "sequenceFlow")];
    if (flows.length) {
      out.push("", "## Fluxos");
      for (const f of flows) {
        const label = f.getAttribute("name") ? ` [${f.getAttribute("name")}]` : "";
        out.push(`- ${names.get(f.getAttribute("sourceRef") ?? "") ?? "?"} → ${names.get(f.getAttribute("targetRef") ?? "") ?? "?"}${label}`);
      }
    }
    const notes = [...proc.getElementsByTagNameNS(NS, "textAnnotation")].map((t) => (t.textContent ?? "").trim()).filter(Boolean);
    if (notes.length) out.push("", "## Anotações", ...notes.map((n) => `- ${n}`));
  }
  return out.join("\n").trim();
}

// --- geração ------------------------------------------------------------------------------------------------

export type BpmnNodeType = "inicio" | "tarefa" | "gateway" | "paralelo" | "evento" | "subprocesso" | "fim";

export interface BpmnProcess {
  nome: string;
  raias: string[];
  elementos: { id: string; tipo: BpmnNodeType; nome: string; raia?: string }[];
  fluxos: { de: string; para: string; rotulo?: string }[];
}

const TYPES: Record<BpmnNodeType, [string, number, number]> = {
  inicio: ["startEvent", 36, 36],
  fim: ["endEvent", 36, 36],
  tarefa: ["task", 110, 70],
  gateway: ["exclusiveGateway", 50, 50],
  paralelo: ["parallelGateway", 50, 50],
  evento: ["intermediateThrowEvent", 36, 36],
  subprocesso: ["subProcess", 110, 70],
};
const COL_W = 170;
const ROW_H = 110;
const LANE_X = 30;
const POOL_LABEL = 30;
const LANE_LABEL = 30;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildBpmn(p: BpmnProcess): string {
  const used = new Set(["Definitions_1", "Collaboration_1", "Participant_1", "Process_1", "LaneSet_1", "Diagram_1", "Plane_1"]);
  const xmlId = (raw: string) => {
    let base = raw.replace(/[^A-Za-z0-9_.-]/g, "_") || "id";
    if (!/^[A-Za-z_]/.test(base)) base = `id_${base}`;
    let out = base;
    for (let n = 2; used.has(out); n++) out = `${base}_${n}`;
    used.add(out);
    return out;
  };
  const lanes = p.raias.length ? [...p.raias] : ["Processo"];
  type Node = { xid: string; tipo: BpmnNodeType; nome: string; raia: string; in: string[]; out: string[] };
  const nodes = new Map<string, Node>();
  for (const e of p.elementos) {
    if (nodes.has(e.id)) throw new Error(`Elemento repetido: ${e.id}`);
    const raia = e.raia && e.raia.trim() ? e.raia : lanes[0];
    if (!lanes.includes(raia)) lanes.push(raia);
    nodes.set(e.id, { xid: xmlId(e.id), tipo: e.tipo, nome: e.nome, raia, in: [], out: [] });
  }
  const order = [...nodes.keys()];
  const flows = p.fluxos.map((f, i) => {
    const a = nodes.get(f.de);
    const b = nodes.get(f.para);
    if (!a || !b) throw new Error(`Fluxo ${i + 1} liga elementos inexistentes.`);
    const id = xmlId(`Flow_${i + 1}`);
    a.out.push(id);
    b.in.push(id);
    return { id, de: f.de, para: f.para, rotulo: f.rotulo ?? "" };
  });

  // Colunas: caminho mais longo a partir das origens, ignorando arestas de retorno.
  const succ = new Map(order.map((k) => [k, [] as string[]]));
  for (const f of flows) succ.get(f.de)!.push(f.para);
  const back = new Set<string>();
  const state = new Map<string, number>();
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of succ.get(u)!) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.has(v)) dfs(v);
    }
    state.set(u, 2);
  };
  const starts = [...order.filter((k) => nodes.get(k)!.tipo === "inicio"), ...order.filter((k) => !nodes.get(k)!.in.length)];
  for (const k of [...starts, ...order]) if (!state.has(k)) dfs(k);
  const col = new Map(order.map((k) => [k, 0]));
  for (let i = 0; i < order.length; i++) {
    let changed = false;
    for (const f of flows) {
      if (back.has(`${f.de}>${f.para}`)) continue;
      if (col.get(f.para)! < col.get(f.de)! + 1) {
        col.set(f.para, col.get(f.de)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const slot = new Map<string, number>();
  const depth = new Map(lanes.map((r) => [r, 1]));
  const taken = new Map<string, number>();
  for (const k of order) {
    const n = nodes.get(k)!;
    const key = `${n.raia}\u0000${col.get(k)}`;
    const s = taken.get(key) ?? 0;
    slot.set(k, s);
    taken.set(key, s + 1);
    depth.set(n.raia, Math.max(depth.get(n.raia)!, s + 1));
  }
  const laneY = new Map<string, number>();
  let y = 40;
  for (const r of lanes) {
    laneY.set(r, y);
    y += depth.get(r)! * ROW_H + 20;
  }
  const poolH = y - 40;
  const maxCol = Math.max(0, ...col.values());
  const poolW = POOL_LABEL + LANE_LABEL + 60 + (maxCol + 1) * COL_W;
  const x0 = LANE_X + POOL_LABEL + LANE_LABEL + 40;

  const bounds = new Map<string, [number, number, number, number]>();
  for (const k of order) {
    const n = nodes.get(k)!;
    const [, w, h] = TYPES[n.tipo];
    const cx = x0 + col.get(k)! * COL_W + 55;
    const cy = laneY.get(n.raia)! + 10 + slot.get(k)! * ROW_H + ROW_H / 2;
    bounds.set(k, [cx - w / 2, cy - h / 2, w, h]);
  }

  const laneIds = new Map(lanes.map((r, i) => [r, xmlId(`Lane_${i + 1}`)]));
  const proc: string[] = ['    <bpmn:laneSet id="LaneSet_1">'];
  for (const r of lanes) {
    proc.push(`      <bpmn:lane id="${laneIds.get(r)}" name="${esc(r)}">`);
    for (const k of order) if (nodes.get(k)!.raia === r) proc.push(`        <bpmn:flowNodeRef>${nodes.get(k)!.xid}</bpmn:flowNodeRef>`);
    proc.push("      </bpmn:lane>");
  }
  proc.push("    </bpmn:laneSet>");
  for (const k of order) {
    const n = nodes.get(k)!;
    const tag = TYPES[n.tipo][0];
    const inner = [...n.in.map((f) => `      <bpmn:incoming>${f}</bpmn:incoming>`), ...n.out.map((f) => `      <bpmn:outgoing>${f}</bpmn:outgoing>`)];
    proc.push(inner.length ? `    <bpmn:${tag} id="${n.xid}" name="${esc(n.nome)}">\n${inner.join("\n")}\n    </bpmn:${tag}>` : `    <bpmn:${tag} id="${n.xid}" name="${esc(n.nome)}" />`);
  }
  for (const f of flows) {
    const name = f.rotulo ? ` name="${esc(f.rotulo)}"` : "";
    proc.push(`    <bpmn:sequenceFlow id="${f.id}"${name} sourceRef="${nodes.get(f.de)!.xid}" targetRef="${nodes.get(f.para)!.xid}" />`);
  }

  const di: string[] = [
    `      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true"><dc:Bounds x="${LANE_X}" y="40" width="${poolW}" height="${poolH}" /></bpmndi:BPMNShape>`,
  ];
  for (const r of lanes) {
    di.push(`      <bpmndi:BPMNShape id="${laneIds.get(r)}_di" bpmnElement="${laneIds.get(r)}" isHorizontal="true"><dc:Bounds x="${LANE_X + POOL_LABEL}" y="${laneY.get(r)}" width="${poolW - POOL_LABEL}" height="${depth.get(r)! * ROW_H + 20}" /></bpmndi:BPMNShape>`);
  }
  for (const k of order) {
    const [bx, by, w, h] = bounds.get(k)!;
    const marker = nodes.get(k)!.tipo === "gateway" ? ' isMarkerVisible="true"' : "";
    di.push(`      <bpmndi:BPMNShape id="${nodes.get(k)!.xid}_di" bpmnElement="${nodes.get(k)!.xid}"${marker}><dc:Bounds x="${bx}" y="${by}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`);
  }
  const bottom = 40 + poolH - 12;
  for (const f of flows) {
    const [sx, sy, sw, sh] = bounds.get(f.de)!;
    const [tx, ty, tw, th] = bounds.get(f.para)!;
    let pts: [number, number][];
    if (col.get(f.para)! > col.get(f.de)!) {
      const p1: [number, number] = [sx + sw, sy + sh / 2];
      const p4: [number, number] = [tx, ty + th / 2];
      const mx = (p1[0] + p4[0]) / 2;
      pts = p1[1] !== p4[1] ? [p1, [mx, p1[1]], [mx, p4[1]], p4] : [p1, p4];
    } else if (col.get(f.para) === col.get(f.de)) {
      const down = ty > sy;
      pts = [[sx + sw / 2, down ? sy + sh : sy], [tx + tw / 2, down ? ty : ty + th]];
    } else {
      pts = [[sx + sw / 2, sy + sh], [sx + sw / 2, bottom], [tx + tw / 2, bottom], [tx + tw / 2, ty + th]];
    }
    const wp = pts.map(([px, py]) => `<di:waypoint x="${px}" y="${py}" />`).join("");
    const label = f.rotulo ? `<bpmndi:BPMNLabel><dc:Bounds x="${pts[0][0] + 6}" y="${pts[0][1] - 20}" width="60" height="14" /></bpmndi:BPMNLabel>` : "";
    di.push(`      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${wp}${label}</bpmndi:BPMNEdge>`);
  }

  const name = esc(p.nome || "Processo");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="Prisma" exporterVersion="1.0">',
    '  <bpmn:collaboration id="Collaboration_1">',
    `    <bpmn:participant id="Participant_1" name="${name}" processRef="Process_1" />`,
    "  </bpmn:collaboration>",
    `  <bpmn:process id="Process_1" name="${name}" isExecutable="false">`,
    ...proc,
    "  </bpmn:process>",
    '  <bpmndi:BPMNDiagram id="Diagram_1">',
    '    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collaboration_1">',
    ...di,
    "    </bpmndi:BPMNPlane>",
    "  </bpmndi:BPMNDiagram>",
    "</bpmn:definitions>",
    "",
  ].join("\n");
}
