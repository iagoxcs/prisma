"""Testes offline do @prisma nos canais (P11, DP6) e das descrições da Onda 7 (P10, P13).

Sem rede: gateway, Discord e contexto de sessão do Hermes são simulados.
Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/plugin-prisma -p "test_*.py" -v
"""
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

_spec = importlib.util.spec_from_file_location("prisma_plugin_channels", Path(__file__).with_name("__init__.py"))
p = importlib.util.module_from_spec(_spec)
sys.modules["prisma_plugin_channels"] = p
_spec.loader.exec_module(p)

AUTHOR = "123456789012345678"
OTHER = "223456789012345678"
BOT = "323456789012345678"
CHANNEL = "423456789012345678"
DM = "523456789012345678"
IN_DM = ("discord", "dm", AUTHOR)
IN_CHANNEL = ("discord", "group", AUTHOR)


class RequestGateTests(unittest.TestCase):
    def test_channel_session_reaches_the_gateway_as_the_author(self):
        with mock.patch.object(p, "_session", return_value=IN_CHANNEL), \
             mock.patch.object(p, "_post", return_value={"ok": True}) as post:
            res = p._request("list_tasks", {"project_id": "x"})
        self.assertTrue(res["ok"])
        self.assertEqual(post.call_args.args[0]["discord_user_id"], AUTHOR)

    def test_dm_session_still_works(self):
        with mock.patch.object(p, "_session", return_value=IN_DM), \
             mock.patch.object(p, "_post", return_value={"ok": True}) as post:
            p._request("list_projects", {})
        post.assert_called_once()

    def test_outside_discord_is_refused_without_calling_the_gateway(self):
        with mock.patch.object(p, "_session", return_value=("telegram", "dm", AUTHOR)), \
             mock.patch.object(p, "_post") as post:
            res = p._request("list_projects", {})
        self.assertEqual(res["code"], "discord_only")
        post.assert_not_called()

    def test_author_must_come_from_the_session(self):
        with mock.patch.object(p, "_session", return_value=("discord", "group", "")), \
             mock.patch.object(p, "_post") as post:
            res = p._request("list_projects", {})
        self.assertEqual(res["code"], "no_author")
        post.assert_not_called()


class ConversationChannelTests(unittest.TestCase):
    def test_dm_goes_to_the_dm(self):
        with mock.patch.object(p, "_session", return_value=IN_DM), \
             mock.patch.object(p, "_session_channel", return_value=CHANNEL), \
             mock.patch.object(p, "_dm_channel", return_value=DM):
            self.assertEqual(p._conversation_channel(AUTHOR), DM)

    def test_channel_goes_to_the_channel(self):
        with mock.patch.object(p, "_session", return_value=IN_CHANNEL), \
             mock.patch.object(p, "_session_channel", return_value=CHANNEL), \
             mock.patch.object(p, "_dm_channel") as dm:
            self.assertEqual(p._conversation_channel(AUTHOR), CHANNEL)
        dm.assert_not_called()

    def test_channel_without_id_falls_back_to_the_dm(self):
        with mock.patch.object(p, "_session", return_value=IN_CHANNEL), \
             mock.patch.object(p, "_session_channel", return_value=None), \
             mock.patch.object(p, "_dm_channel", return_value=DM):
            self.assertEqual(p._conversation_channel(AUTHOR), DM)

    def test_session_channel_prefers_the_thread_and_needs_a_snowflake(self):
        env = {"HERMES_SESSION_THREAD_ID": "", "HERMES_SESSION_CHAT_ID": CHANNEL}
        fake = mock.MagicMock()
        fake.get_session_env.side_effect = lambda name, default="": env.get(name, default)
        with mock.patch.dict(sys.modules, {"gateway": mock.MagicMock(), "gateway.session_context": fake}):
            self.assertEqual(p._session_channel(), CHANNEL)
            env["HERMES_SESSION_THREAD_ID"] = "623456789012345678"
            self.assertEqual(p._session_channel(), "623456789012345678")
            env.update({"HERMES_SESSION_THREAD_ID": "abc", "HERMES_SESSION_CHAT_ID": "12"})
            self.assertIsNone(p._session_channel())


class ProposeInChannelTests(unittest.TestCase):
    def test_preview_is_posted_in_the_channel_of_the_request(self):
        calls = []

        def fake_request(tool, args, **_kw):
            calls.append((tool, args))
            if tool == "propose":
                return {"ok": True, "data": {"pending_id": "p-1", "confirm_code": "segredo", "summary": "Criar a tarefa"}}
            return {"ok": True}

        self.addCleanup(p._PENDING.clear)
        with mock.patch.object(p, "_session", return_value=IN_CHANNEL), \
             mock.patch.object(p, "_session_channel", return_value=CHANNEL), \
             mock.patch.object(p, "_dm_channel") as dm, \
             mock.patch.object(p, "_request", side_effect=fake_request), \
             mock.patch.object(p, "_post_message", return_value="723456789012345678") as post, \
             mock.patch.object(p, "_react"), \
             mock.patch.object(p.threading, "Thread"):
            out = json.loads(p._propose("create_task", {"project_id": "x", "title": "Revisar POP"}))
        self.assertTrue(out["ok"])
        self.assertNotIn("segredo", json.dumps(out))  # o segredo nunca vai ao LLM
        self.assertEqual(post.call_args.args[0], CHANNEL)
        dm.assert_not_called()
        self.assertIn(("preview_posted", {"pending_id": "p-1", "channel_id": CHANNEL,
                                          "message_id": "723456789012345678"}), calls)
        self.assertEqual(p._PENDING["p-1"]["user_id"], AUTHOR)


class ConfirmationInChannelTests(unittest.TestCase):
    def _entry(self):
        return {"user_id": AUTHOR, "channel_id": CHANNEL, "message_id": "823456789012345678"}

    def test_text_answer_with_bot_mention_counts(self):
        self.assertEqual(p.decision_from_text(f"<@{BOT}> sim"), "yes")
        self.assertEqual(p.decision_from_text(f"<@!{BOT}> não"), "no")
        self.assertIsNone(p.decision_from_text(f"<@{BOT}> sim, mas muda o prazo"))

    def _reaction(self, who_reacted: list[str]):
        msg = {"reactions": [{"emoji": {"name": p.YES}, "count": len(who_reacted)}]}

        def fake_discord(method, path, *a, **kw):
            if "/reactions/" in path:
                emoji = p.urllib.parse.unquote(path.split("/reactions/")[1].split("?")[0])
                return [{"id": u} for u in who_reacted] if emoji == p.YES else []
            return msg

        with mock.patch.object(p, "_discord", side_effect=fake_discord):
            return p._user_reaction(self._entry())

    def test_someone_else_reacting_does_not_confirm(self):
        self.assertIsNone(self._reaction([BOT, OTHER]))

    def test_the_author_reacting_confirms(self):
        self.assertEqual(self._reaction([BOT, OTHER, AUTHOR]), "yes")

    def test_someone_elses_yes_in_text_does_not_confirm(self):
        msgs = [{"id": "923456789012345678", "author": {"id": OTHER}, "content": f"<@{BOT}> sim"}]

        def fake_discord(method, path, *a, **kw):
            return [] if "/reactions/" in path else msgs

        with mock.patch.object(p, "_discord", side_effect=fake_discord):
            self.assertIsNone(p._decision("p-2", self._entry()))


class TranscriptionStaysInDmTests(unittest.TestCase):
    def test_voice_in_a_channel_is_not_sent_anywhere(self):
        with mock.patch.object(p, "_session", return_value=IN_CHANNEL), \
             mock.patch.object(p, "_request") as req, \
             mock.patch.object(p, "_to_mp3") as to_mp3:
            out = p.transcribe_voice("audio.ogg")
        self.assertFalse(out["success"])
        req.assert_not_called()
        to_mp3.assert_not_called()


class DescriptionTests(unittest.TestCase):
    def _desc(self, name: str) -> str:
        return next(schema["description"] for n, _, _, schema in p.TOOLS if n == name)

    def test_no_tool_says_dm_only(self):
        for name, _, _, schema in p.TOOLS:
            self.assertNotIn("Só funciona em DM", schema["description"], name)

    def test_tasks_show_the_assignee_name(self):
        for name in ("prisma_listar_tarefas", "prisma_ver_tarefa"):
            self.assertIn("assignee_name", self._desc(name))
            self.assertIn("client_owner", self._desc(name))

    def test_projects_are_cited_as_project_dash_client(self):
        for name in ("prisma_listar_projetos", "prisma_listar_tarefas", "prisma_ver_tarefa", "prisma_buscar_contexto"):
            self.assertIn("Projeto - Cliente", self._desc(name))


if __name__ == "__main__":
    unittest.main()
