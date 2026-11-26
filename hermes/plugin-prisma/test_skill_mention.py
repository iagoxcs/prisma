"""Testes offline da skill citada na mensagem (0.13.0): hook pre_gateway_dispatch.

Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/plugin-prisma -p "test_*.py" -v
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

_spec = importlib.util.spec_from_file_location("prisma_plugin_skills", Path(__file__).with_name("__init__.py"))
p = importlib.util.module_from_spec(_spec)
sys.modules["prisma_plugin_skills"] = p
_spec.loader.exec_module(p)

KNOWN = {"bpmn-generator", "status-report", "ata-de-reuniao", "conselho", "hermes-agent"}


class FakeEvent:
    """Imita o MessageEvent do Hermes no que o hook usa."""

    def __init__(self, text, user_text=None, platform="discord", internal=False, control=True):
        self.text = text
        self.raw_message = SimpleNamespace(content=text if user_text is None else user_text)
        self.source = SimpleNamespace(platform=SimpleNamespace(value=platform))
        self.internal = internal
        self.allow_gateway_control = control

    def get_command(self):
        t = self.text.lstrip()
        return t.split(maxsplit=1)[0][1:].lower() if t.startswith("/") else None


def rw(event):
    return p._skill_rewrite(event, known_fn=lambda: KNOWN)


class SkillMentionTests(unittest.TestCase):
    def test_skill_no_meio_da_frase(self):
        txt = ", utilize a /bpmn-generator e crie os fluxogramas de Contas a Pagar"
        names, new = rw(FakeEvent(txt))
        self.assertEqual(names, ["bpmn-generator"])
        self.assertEqual(new, "/bpmn-generator " + txt)

    def test_anexo_txt_inline_antes_do_texto(self):
        user = "/bpmn-generator crie os fluxogramas a partir da transcrição anexada"
        text = "[Content of Mapeamento.txt]:\nfala 1\nfala 2\n\n" + user
        names, new = rw(FakeEvent(text, user_text=user))
        self.assertEqual(names, ["bpmn-generator"])
        self.assertTrue(new.startswith("/bpmn-generator [Content of Mapeamento.txt]:"))
        self.assertIn("fala 2", new)

    def test_ja_comeca_pelo_comando_fica_com_o_hermes(self):
        self.assertIsNone(rw(FakeEvent("/bpmn-generator crie o fluxo")))

    def test_conteudo_do_anexo_nao_dispara(self):
        text = "[Content of a.txt]:\nveja a /status-report\n\nresuma o arquivo"
        self.assertIsNone(rw(FakeEvent(text, user_text="resuma o arquivo")))

    def test_varias_skills_sem_repetir(self):
        names, new = rw(FakeEvent("use /ata-de-reuniao e depois /status-report, de novo /ata-de-reuniao"))
        self.assertEqual(names, ["ata-de-reuniao", "status-report"])
        self.assertTrue(new.startswith("/ata-de-reuniao /status-report use "))

    def test_underscore_vira_hifen(self):
        names, _ = rw(FakeEvent("rode a /bpmn_generator"))
        self.assertEqual(names, ["bpmn-generator"])

    def test_caminhos_links_e_desconhecidas_nao_disparam(self):
        for t in ("salve em docs/bpmn-generator", "https://x.com/conselho", "veja /desconhecida",
                  "arquivo /bpmn-generator.bpmn/x", "a/status-report", "/bpmn-generatorx"):
            self.assertIsNone(rw(FakeEvent("ok " + t)), t)

    def test_pontuacao_depois_do_nome(self):
        names, _ = rw(FakeEvent("pode usar a /conselho?"))
        self.assertEqual(names, ["conselho"])

    def test_fora_do_discord_ou_interno(self):
        self.assertIsNone(rw(FakeEvent("use /conselho", platform="telegram")))
        self.assertIsNone(rw(FakeEvent("use /conselho", internal=True)))
        self.assertIsNone(rw(FakeEvent("use /conselho", control=False)))

    def test_sem_raw_message(self):
        e = FakeEvent("use /conselho")
        e.raw_message = None
        self.assertIsNone(rw(e))

    def test_limite_de_cinco(self):
        names = p._cited_skills(" ".join("/" + n for n in sorted(KNOWN)) + " /conselho", KNOWN)
        self.assertEqual(len(names), 5)

    def test_hook_devolve_rewrite_e_nunca_quebra(self):
        orig = p._known_skill_commands
        try:
            p._known_skill_commands = lambda: KNOWN
            p._skill_rewrite.__defaults__ = (p._known_skill_commands,)
            out = p._on_pre_gateway_dispatch(event=FakeEvent("use a /conselho"), gateway=None)
            self.assertEqual(out, {"action": "rewrite", "text": "/conselho use a /conselho"})

            def boom():
                raise RuntimeError("x")
            p._skill_rewrite.__defaults__ = (boom,)
            self.assertIsNone(p._on_pre_gateway_dispatch(event=FakeEvent("use a /conselho")))
        finally:
            p._known_skill_commands = orig
            p._skill_rewrite.__defaults__ = (orig,)


if __name__ == "__main__":
    unittest.main()
