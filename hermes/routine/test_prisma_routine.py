"""Testes offline da rotina diária (sem Discord, LLM nem gateway: tudo simulado).

Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/routine -v
"""
from __future__ import annotations

import unittest
from datetime import date
from unittest import mock

import prisma_routine as r

DAY = date(2026, 11, 20)
CH_SHARED = "157079655081535492"
CH_SOLO = "157079655081535499"
CHANNELS = [
    {"project_id": "p-a", "name": "Projeto A", "discord_channel_id": CH_SHARED},
    {"project_id": "p-b", "name": "Projeto B", "discord_channel_id": CH_SHARED},
    {"project_id": "p-c", "name": "Projeto C", "discord_channel_id": CH_SOLO},
]
MESSAGES = [
    {"id": "1", "timestamp": "2026-11-20T13:00:00+00:00", "author": {"username": "ana"}, "content": "Fechamos o escopo."},
    {"id": "2", "timestamp": "2026-11-20T13:05:00+00:00", "author": {"username": "bot", "bot": True}, "content": "ok"},
]
SUMMARY = {"resumo": "Escopo fechado.", "decisoes": ["Escopo fechado"], "pendencias": []}


class FakeGateway:
    def __init__(self, channels: list[dict], fail_projects: set[str] | None = None):
        self.channels = channels
        self.fail_projects = fail_projects or set()
        self.upserts: list[dict] = []

    def __call__(self, tool: str, args: dict | None = None) -> dict:
        if tool == "routine_list_channels":
            return {"ok": True, "data": self.channels}
        assert tool == "routine_upsert_context"
        if args["project_id"] in self.fail_projects:
            raise r.RoutineError("http_500")
        self.upserts.append(args)
        return {"ok": True, "data": {"created": True}}


class RunTests(unittest.TestCase):
    def setUp(self):
        self.read = mock.patch.object(r, "day_messages", return_value=MESSAGES).start()
        self.summarize = mock.patch.object(r, "summarize", return_value=SUMMARY).start()
        self.notify = mock.patch.object(r, "notify").start()
        self.unmapped = mock.patch.object(r, "unmapped_channels", return_value=[]).start()
        self.addCleanup(mock.patch.stopall)

    def report(self) -> str:
        return "\n".join(self.notify.call_args.args[0])

    def test_shared_channel_read_and_summarized_once_saved_per_project(self):
        gw = FakeGateway(CHANNELS)
        with mock.patch.object(r, "gateway", gw):
            self.assertEqual(r.run(DAY, dry_run=False), 0)

        self.assertEqual([c.args[0] for c in self.read.call_args_list], [CH_SHARED, CH_SOLO])
        self.assertEqual([c.args[0] for c in self.summarize.call_args_list],
                         [["Projeto A", "Projeto B"], ["Projeto C"]])
        self.assertEqual([u["project_id"] for u in gw.upserts], ["p-a", "p-b", "p-c"])
        a, b, c = gw.upserts
        self.assertEqual(a["body"], b["body"])
        self.assertEqual((a["channel_id"], b["channel_id"], c["channel_id"]), (CH_SHARED, CH_SHARED, CH_SOLO))
        self.assertEqual({u["date"] for u in gw.upserts}, {"2026-11-20"})
        self.assertEqual(a["participants"], "ana")
        self.assertIn("compartilhado pelos projetos Projeto A e Projeto B", a["body"])
        self.assertIn("do canal do projeto no Discord", c["body"])
        self.unmapped.assert_called_once_with({CH_SHARED, CH_SOLO})
        self.assertIn("- Projeto B: 2 mensagens, resumo criado (canal compartilhado)", self.report())

    def test_one_project_failing_does_not_block_the_others(self):
        gw = FakeGateway(CHANNELS, fail_projects={"p-a"})
        with mock.patch.object(r, "gateway", gw):
            self.assertEqual(r.run(DAY, dry_run=False), 1)
        self.assertEqual([u["project_id"] for u in gw.upserts], ["p-b", "p-c"])
        self.assertIn("- Projeto A: falha (http_500) (canal compartilhado)", self.report())
        self.assertIn("Concluída com 1 falha(s)", self.report())

    def test_read_failure_counts_for_every_project_of_the_channel(self):
        self.read.side_effect = lambda ch, day: (_ for _ in ()).throw(r.RoutineError("http_403")) if ch == CH_SHARED else MESSAGES
        gw = FakeGateway(CHANNELS)
        with mock.patch.object(r, "gateway", gw):
            self.assertEqual(r.run(DAY, dry_run=False), 1)
        self.assertEqual([u["project_id"] for u in gw.upserts], ["p-c"])
        self.assertIn("- Projeto A, Projeto B: falha (http_403)", self.report())
        self.assertIn("Concluída com 2 falha(s)", self.report())

    def test_empty_channel_writes_nothing(self):
        self.read.return_value = []
        gw = FakeGateway(CHANNELS)
        with mock.patch.object(r, "gateway", gw):
            self.assertEqual(r.run(DAY, dry_run=False), 0)
        self.summarize.assert_not_called()
        self.assertEqual(gw.upserts, [])
        self.assertIn("- Projeto A, Projeto B: sem mensagens", self.report())

    def test_dry_run_summarizes_without_writing(self):
        gw = FakeGateway(CHANNELS)
        with mock.patch.object(r, "gateway", gw):
            self.assertEqual(r.run(DAY, dry_run=True), 0)
        self.assertEqual(self.summarize.call_count, 2)
        self.assertEqual(gw.upserts, [])
        self.assertIn("- Projeto A, Projeto B: 2 mensagens, resumo gerado (não gravado)", self.report())


class HelperTests(unittest.TestCase):
    def test_group_by_channel_keeps_order(self):
        groups = r.group_by_channel(CHANNELS)
        self.assertEqual(list(groups), [CH_SHARED, CH_SOLO])
        self.assertEqual([p["project_id"] for p in groups[CH_SHARED]], ["p-a", "p-b"])

    @staticmethod
    def _claude_reply(text, stop="end_turn"):
        # Resposta da API de Mensagens: o bloco de pensamento vem antes do texto.
        return {"stop_reason": stop, "content": [{"type": "thinking", "thinking": "", "signature": "s"},
                                                 {"type": "text", "text": text}]}

    def _summarize_with(self, replies):
        calls = []

        def fake_http(method, url, headers, body, timeout=60):
            calls.append({"url": url, "headers": headers, "body": body})
            return replies[min(len(calls), len(replies)) - 1]

        with mock.patch.object(r, "http_json", fake_http), mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "k"}):
            try:
                return r.summarize(["Projeto A", "Projeto B"], DAY, "[10:00] ana: oi"), calls
            except r.RoutineError as e:
                return e, calls

    def test_summarize_calls_claude_messages_api(self):
        out, calls = self._summarize_with([self._claude_reply('{"resumo": "ok", "decisoes": [], "pendencias": []}')])
        self.assertEqual(out["resumo"], "ok")
        sent = calls[0]
        self.assertEqual(sent["url"], "https://api.anthropic.com/v1/messages")
        self.assertEqual(sent["headers"], {"x-api-key": "k", "anthropic-version": "2026-10-21"})
        self.assertEqual(sent["body"]["model"], "claude-haiku-5-5")
        self.assertEqual(sent["body"]["system"], r.SYSTEM_PROMPT)
        self.assertNotIn("temperature", sent["body"])
        self.assertEqual([m["role"] for m in sent["body"]["messages"]], ["user"])
        self.assertIn("Projetos do canal: Projeto A; Projeto B", sent["body"]["messages"][0]["content"])

    def test_summarize_refusal_is_an_error_code(self):
        out, calls = self._summarize_with([{"stop_reason": "refusal", "content": []}])
        self.assertIsInstance(out, r.RoutineError)
        self.assertEqual(out.code, "llm_recusou")
        self.assertEqual(len(calls), 2)

    def test_summarize_retries_once_on_invalid_json(self):
        out, calls = self._summarize_with([self._claude_reply("sem json"),
                                           self._claude_reply('{"resumo": "ok", "decisoes": [], "pendencias": []}')])
        self.assertEqual(out["resumo"], "ok")
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
