"""Testes offline do gerador de BPMN (files.make_bpmn), visual 0.14.0.

Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/plugin-prisma -p "test_*.py" -v
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

_spec = importlib.util.spec_from_file_location("prisma_files_bpmn", Path(__file__).with_name("files.py"))
f = importlib.util.module_from_spec(_spec)
sys.modules["prisma_files_bpmn"] = f
_spec.loader.exec_module(f)

B = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"
DI = "{http://www.omg.org/spec/BPMN/20100524/DI}"
DC = "{http://www.omg.org/spec/DD/20100524/DC}"
DDI = "{http://www.omg.org/spec/DD/20100524/DI}"

# Recorte do Contas a Receber (As Is) gerado no Discord em 26/11/2026.
RECEBER = {
    "nome": "Contas a Receber - As Is",
    "raias": ["Comercial", "Faturamento", "Financeiro - Contas a Receber"],
    "elementos": [
        {"id": "ini", "tipo": "inicio", "nome": "Pedido de venda lançado", "raia": "Comercial"},
        {"id": "gw_ant", "tipo": "gateway", "nome": "Cliente com pagamento antecipado?", "raia": "Comercial"},
        {"id": "t_fat", "tipo": "tarefa", "nome": "Faturar pedido e emitir nota fiscal", "raia": "Faturamento",
         "nota": "Gera título a receber no Proteus"},
        {"id": "t_ver", "tipo": "tarefa", "nome": "Verificar se o crédito caiu na conta",
         "raia": "Financeiro - Contas a Receber",
         "nota": "⚠️ GAP: pedido antecipado só chega ao Financeiro se o cliente estiver como risco"},
        {"id": "t_lib", "tipo": "tarefa", "nome": "Liberar pedido no Proteus", "raia": "Financeiro - Contas a Receber"},
        {"id": "t_reg", "tipo": "tarefa", "nome": "Registrar boleto no banco", "raia": "Financeiro - Contas a Receber",
         "nota": "⚠️ GAP: manual, só às terças e quintas"},
        {"id": "gw_pago", "tipo": "gateway", "nome": "Título pago?", "raia": "Financeiro - Contas a Receber"},
        {"id": "t_bx", "tipo": "tarefa", "nome": "Baixar título", "raia": "Financeiro - Contas a Receber"},
        {"id": "t_cob", "tipo": "tarefa", "nome": "Cobrar cliente", "raia": "Financeiro - Contas a Receber"},
        {"id": "fim", "tipo": "fim", "nome": "Título baixado", "raia": "Financeiro - Contas a Receber",
         "nota": "Conciliado no dia seguinte"},
    ],
    "fluxos": [
        {"de": "ini", "para": "gw_ant"},
        {"de": "gw_ant", "para": "t_ver", "rotulo": "Sim"},
        {"de": "gw_ant", "para": "t_fat", "rotulo": "Não"},
        {"de": "t_ver", "para": "t_lib"},
        {"de": "t_fat", "para": "t_reg"},
        {"de": "t_lib", "para": "gw_pago"},
        {"de": "t_reg", "para": "gw_pago"},
        {"de": "gw_pago", "para": "t_bx", "rotulo": "Sim"},
        {"de": "gw_pago", "para": "t_cob", "rotulo": "Não"},
        {"de": "t_bx", "para": "fim"},
        {"de": "t_cob", "para": "gw_pago"},
    ],
}


def parse(processo):
    return ET.fromstring(f.make_bpmn(processo))


def bounds(el):
    b = el.find(DC + "Bounds")
    return tuple(float(b.get(k)) for k in ("x", "y", "width", "height"))


def overlap(a, b):
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


class BpmnVisualTests(unittest.TestCase):
    def setUp(self):
        self.root = parse(RECEBER)
        self.proc = self.root.find(B + "process")
        self.shapes = {s.get("bpmnElement"): s for s in self.root.iter(DI + "BPMNShape")}
        self.edges = {e.get("bpmnElement"): e for e in self.root.iter(DI + "BPMNEdge")}

    def test_tarefas_largas(self):
        for t in self.proc.iter(B + "task"):
            x, y, w, h = bounds(self.shapes[t.get("id")])
            self.assertEqual((w, h), (200, 80))

    def test_nota_vira_anotacao_ligada_por_associacao(self):
        anns = {a.get("id"): a.find(B + "text").text for a in self.proc.iter(B + "textAnnotation")}
        self.assertEqual(len(anns), 4)
        self.assertIn("⚠️ GAP: manual, só às terças e quintas", anns.values())
        assocs = list(self.proc.iter(B + "association"))
        self.assertEqual(len(assocs), 4)
        for a in assocs:
            self.assertIn(a.get("targetRef"), anns)
            self.assertIn(a.get("id"), self.edges)  # linha pontilhada desenhada
            self.assertIn(a.get("targetRef"), self.shapes)  # caixa da anotação desenhada
        # anotação fica fora das caixas das etapas
        task_boxes = [bounds(self.shapes[t.get("id")]) for t in self.proc.iter(B + "task")]
        for aid in anns:
            for tb in task_boxes:
                self.assertFalse(overlap(bounds(self.shapes[aid]), tb))

    def test_anotacao_dentro_da_raia(self):
        lane_of = {}
        for lane in self.proc.iter(B + "lane"):
            for ref in lane.findall(B + "flowNodeRef"):
                lane_of[ref.text] = bounds(self.shapes[lane.get("id")])
        for a in self.proc.iter(B + "association"):
            lx, ly, lw, lh = lane_of[a.get("sourceRef")]
            ax, ay, aw, ah = bounds(self.shapes[a.get("targetRef")])
            self.assertTrue(ly <= ay and ay + ah <= ly + lh, a.get("targetRef"))

    def test_rotulos_das_saidas_do_gateway_nao_se_sobrepoem(self):
        labels = []
        for e in self.edges.values():
            lab = e.find(DI + "BPMNLabel")
            if lab is not None:
                labels.append(bounds(lab))
        self.assertEqual(len(labels), 4)
        for i in range(len(labels)):
            for j in range(i + 1, len(labels)):
                self.assertFalse(overlap(labels[i], labels[j]), (labels[i], labels[j]))

    def test_linhas_nao_atravessam_caixas(self):
        flows = {s.get("id"): (s.get("sourceRef"), s.get("targetRef")) for s in self.proc.iter(B + "sequenceFlow")}
        nodes = [el.get("id") for el in self.proc if el.tag in (B + "task", B + "exclusiveGateway", B + "startEvent", B + "endEvent")]
        for fid, (s, t) in flows.items():
            pts = [(float(w.get("x")), float(w.get("y"))) for w in self.edges[fid].findall(DDI + "waypoint")]
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                for n in nodes:
                    if n in (s, t):
                        continue
                    bx, by, bw, bh = bounds(self.shapes[n])
                    if x1 == x2:
                        hit = bx + 2 < x1 < bx + bw - 2 and min(y1, y2) < by + bh - 2 and max(y1, y2) > by + 2
                    else:
                        hit = by + 2 < y1 < by + bh - 2 and min(x1, x2) < bx + bw - 2 and max(x1, x2) > bx + 2
                    self.assertFalse(hit, f"{fid} atravessa {n}")

    def test_sem_nota_continua_igual_ao_contrato(self):
        p = {"nome": "P", "raias": ["A"], "elementos": [
            {"id": "i", "tipo": "inicio", "nome": "Início", "raia": "A"},
            {"id": "t", "tipo": "tarefa", "nome": "Fazer", "raia": "A"},
            {"id": "e", "tipo": "fim", "nome": "Fim", "raia": "A"}],
            "fluxos": [{"de": "i", "para": "t"}, {"de": "t", "para": "e"}]}
        root = parse(p)
        self.assertEqual(len(list(root.iter(B + "textAnnotation"))), 0)
        self.assertEqual(len(list(root.iter(B + "sequenceFlow"))), 2)
        self.assertEqual(root.find(B + "collaboration").find(B + "participant").get("processRef"), "Process_1")

    def test_nota_com_caracteres_especiais(self):
        p = {"nome": "P", "raias": ["A"], "elementos": [
            {"id": "i", "tipo": "inicio", "nome": "Início", "raia": "A"},
            {"id": "t", "tipo": "tarefa", "nome": "Fazer", "raia": "A", "nota": "<b>R&D</b> \"x\" 'y'"},
            {"id": "e", "tipo": "fim", "nome": "Fim", "raia": "A"}],
            "fluxos": [{"de": "i", "para": "t"}, {"de": "t", "para": "e"}]}
        root = parse(p)
        self.assertEqual(root.find(".//" + B + "textAnnotation/" + B + "text").text, "<b>R&D</b> \"x\" 'y'")

    def test_leitura_mostra_nota_com_a_etapa(self):
        try:
            import lxml  # noqa: F401
        except ImportError:
            self.skipTest("lxml ausente (presente no container do Hermes)")
        text = f._bpmn_text(f.make_bpmn(RECEBER))
        self.assertIn("## Anotações", text)
        self.assertIn("- ⚠️ GAP: manual, só às terças e quintas (etapa: Registrar boleto no banco)", text)

    def test_leitura_nomeia_juncoes_sem_nome(self):
        try:
            import lxml  # noqa: F401
        except ImportError:
            self.skipTest("lxml ausente (presente no container do Hermes)")
        p = {"nome": "P", "raias": ["A"], "elementos": [
            {"id": "i", "tipo": "inicio", "nome": "Início", "raia": "A"},
            {"id": "gw_ok", "tipo": "gateway", "nome": "Aprovado?", "raia": "A"},
            {"id": "t1", "tipo": "tarefa", "nome": "Corrigir", "raia": "A"},
            {"id": "gw_jx", "tipo": "gateway", "nome": "", "raia": "A"},
            {"id": "gw_jy", "tipo": "gateway", "raia": "A"},
            {"id": "e", "tipo": "fim", "nome": "Fim", "raia": "A"}],
            "fluxos": [{"de": "i", "para": "gw_ok"},
                       {"de": "gw_ok", "para": "gw_jx", "rotulo": "Sim"},
                       {"de": "gw_ok", "para": "t1", "rotulo": "Não"},
                       {"de": "t1", "para": "gw_jx"},
                       {"de": "gw_jx", "para": "gw_jy"},
                       {"de": "gw_jy", "para": "e"}]}
        text = f._bpmn_text(f.make_bpmn(p))
        self.assertNotIn("gw_jx", text)
        self.assertNotIn("gw_jy", text)
        self.assertIn("- [Gateway exclusivo] Junção 1", text)
        self.assertIn("- Corrigir → Junção 1", text)
        self.assertIn("- Junção 1 → Junção 2", text)
        self.assertIn("- [Gateway exclusivo] Aprovado?", text)

    def test_muitas_notas_na_mesma_faixa_empilham_sem_sobrepor(self):
        els = [{"id": "i", "tipo": "inicio", "nome": "Início", "raia": "A", "nota": "Nota do início " * 3}]
        fl = []
        prev = "i"
        for n in range(6):
            els.append({"id": f"t{n}", "tipo": "tarefa", "nome": f"Etapa {n}", "raia": "A",
                        "nota": f"⚠️ GAP: problema número {n} com um texto um pouco mais comprido para quebrar"})
            fl.append({"de": prev, "para": f"t{n}"})
            prev = f"t{n}"
        els.append({"id": "e", "tipo": "fim", "nome": "Fim", "raia": "A"})
        fl.append({"de": prev, "para": "e"})
        root = parse({"nome": "P", "raias": ["A"], "elementos": els, "fluxos": fl})
        shapes = {s.get("bpmnElement"): bounds(s) for s in root.iter(DI + "BPMNShape")}
        anns = [shapes[a.get("id")] for a in root.iter(B + "textAnnotation")]
        self.assertEqual(len(anns), 7)
        for i in range(len(anns)):
            for j in range(i + 1, len(anns)):
                self.assertFalse(overlap(anns[i], anns[j]))


if __name__ == "__main__":
    unittest.main()
