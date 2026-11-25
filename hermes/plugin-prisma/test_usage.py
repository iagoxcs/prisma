"""Testes offline da telemetria de uso do plugin (O5). Sem rede: o envio ao gateway é simulado.

Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/plugin-prisma -p "test_*.py" -v
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

_spec = importlib.util.spec_from_file_location("prisma_plugin", Path(__file__).with_name("__init__.py"))
p = importlib.util.module_from_spec(_spec)
sys.modules["prisma_plugin"] = p
_spec.loader.exec_module(p)

TODAY = "2026-11-23"


class NormalizeTests(unittest.TestCase):
    def test_hermes_canonical_usage(self):
        u = {"input_tokens": 120, "output_tokens": 30, "cache_read_tokens": 5000, "cache_write_tokens": 40,
             "reasoning_tokens": 7, "request_count": 1, "prompt_tokens": 5160, "total_tokens": 5190}
        self.assertEqual(p._normalize_usage(u), (120, 30, 5000, 40))

    def test_openai_format_subtracts_cached_tokens(self):
        u = {"prompt_tokens": 1000, "completion_tokens": 50, "prompt_tokens_details": {"cached_tokens": 800}}
        self.assertEqual(p._normalize_usage(u), (200, 50, 800, 0))

    def test_anthropic_raw_format(self):
        u = {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 300, "cache_creation_input_tokens": 20}
        self.assertEqual(p._normalize_usage(u), (10, 5, 300, 20))

    def test_garbage_is_ignored(self):
        for u in (None, "x", [], {}, {"foo": 1}):
            self.assertIsNone(p._normalize_usage(u))
        self.assertEqual(p._normalize_usage({"prompt_tokens": "abc", "completion_tokens": -4}), (0, 0, 0, 0))

    def test_model_name_is_sanitized(self):
        self.assertEqual(p._usage_model("claude-sonnet-5.5"), "claude-sonnet-5.5")
        self.assertEqual(p._usage_model("google/gemini 3.5"), "google/gemini_3.5")
        self.assertEqual(p._usage_model(None), "desconhecido")
        self.assertEqual(len(p._usage_model("a" * 300)), 100)


class BufferTests(unittest.TestCase):
    def setUp(self):
        p._USAGE.clear()
        self.today = mock.patch.object(p, "_today_brt", return_value=TODAY).start()
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(p._USAGE.clear)

    def test_hook_sums_calls_and_tokens_per_model(self):
        p._on_llm_usage(model="claude-sonnet-5.5", usage={"input_tokens": 10, "output_tokens": 2, "cache_read_tokens": 100})
        p._on_llm_usage(model="x", response_model="claude-sonnet-5.5", usage={"input_tokens": 5, "output_tokens": 1})
        p._on_llm_usage(model="claude-haiku-5.5", usage={"input_tokens": 1, "output_tokens": 1}, aux_task="title_generation")
        self.assertEqual(p._USAGE[(TODAY, "bot", "claude-sonnet-5.5")], [2, 15, 3, 100, 0])
        self.assertEqual(p._USAGE[(TODAY, "bot", "claude-haiku-5.5")], [1, 1, 1, 0, 0])

    def test_hook_never_raises(self):
        p._on_llm_usage()
        p._on_llm_usage(model=object(), usage={"input_tokens": object()})
        p._on_llm_usage(usage="nada", unexpected=1)
        self.assertTrue(all(k[1] == "bot" for k in p._USAGE))

    def test_buffer_cap(self):
        with mock.patch.object(p, "USAGE_MAX_KEYS", 2):
            for i in range(5):
                p._add_usage("bot", f"m{i}", {"input_tokens": 1})
        self.assertEqual(len(p._USAGE), 2)

    def test_flush_sends_rows_and_clears(self):
        p._add_usage("bot", "claude-sonnet-5.5", {"input_tokens": 10, "output_tokens": 2})
        p._add_usage("transcricao", "gemini-3.5-flash", {"prompt_tokens": 400, "completion_tokens": 20})
        sent = []
        with mock.patch.object(p, "_post", side_effect=lambda payload: sent.append(payload) or {"ok": True}):
            self.assertEqual(p._flush_usage(), 2)
        self.assertEqual(p._USAGE, {})
        self.assertEqual(len(sent), 1)
        payload = sent[0]
        self.assertEqual(payload["tool"], "record_usage")
        self.assertNotIn("discord_user_id", payload)
        rows = {r["source"]: r for r in payload["args"]["rows"]}
        self.assertEqual(rows["bot"], {"day": TODAY, "source": "bot", "model": "claude-sonnet-5.5", "calls": 1,
                                       "input_tokens": 10, "output_tokens": 2, "cache_read_tokens": 0, "cache_write_tokens": 0})
        self.assertEqual(rows["transcricao"]["input_tokens"], 400)

    def test_flush_splits_into_calls_of_50(self):
        for i in range(120):
            p._add_usage("bot", f"m{i}", {"input_tokens": 1})
        sizes = []
        with mock.patch.object(p, "_post", side_effect=lambda payload: sizes.append(len(payload["args"]["rows"])) or {"ok": True}):
            self.assertEqual(p._flush_usage(), 120)
        self.assertEqual(sizes, [50, 50, 20])

    def test_transient_failure_keeps_numbers_for_next_flush(self):
        p._add_usage("bot", "claude-sonnet-5.5", {"input_tokens": 10})
        with mock.patch.object(p, "_post", return_value={"ok": False, "code": "unavailable"}):
            self.assertEqual(p._flush_usage(), 0)
        p._add_usage("bot", "claude-sonnet-5.5", {"input_tokens": 5})
        self.assertEqual(p._USAGE[(TODAY, "bot", "claude-sonnet-5.5")], [2, 15, 0, 0, 0])

    def test_rejected_rows_are_dropped(self):
        p._add_usage("bot", "claude-sonnet-5.5", {"input_tokens": 10})
        with mock.patch.object(p, "_post", return_value={"ok": False, "code": "invalid_args"}):
            p._flush_usage()
        self.assertEqual(p._USAGE, {})

    def test_merge_back_drops_days_older_than_7(self):
        p._merge_back([(("2026-11-10", "bot", "m"), [1, 1, 0, 0, 0]), (("2026-11-20", "bot", "m"), [1, 2, 0, 0, 0])])
        self.assertEqual(list(p._USAGE), [("2026-11-20", "bot", "m")])

    def test_start_usage_only_in_gateway_run(self):
        ctx = mock.Mock()
        with mock.patch.object(p, "_should_resume", return_value=False), mock.patch.object(p, "_USAGE_STARTED", False):
            p._start_usage(ctx)
        ctx.register_hook.assert_not_called()
        with mock.patch.object(p, "_should_resume", return_value=True), mock.patch.object(p, "_USAGE_STARTED", False), \
                mock.patch.object(p.threading, "Thread") as thread, mock.patch("atexit.register") as at:
            p._start_usage(ctx)
        self.assertEqual([c.args[0] for c in ctx.register_hook.call_args_list], ["post_api_request", "post_auxiliary_call"])
        thread.return_value.start.assert_called_once()
        at.assert_called_once_with(p._flush_usage)


class TranscriptionUsageTests(unittest.TestCase):
    def _transcribe(self, reply: bytes, prompt=None):
        p._USAGE.clear()
        self.addCleanup(p._USAGE.clear)
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = reply
        with mock.patch.object(p, "_request", return_value={"ok": True}),                 mock.patch.object(p, "_session", return_value=("discord", "dm", "123")),                 mock.patch.object(p, "_env", return_value="chave") as env,                 mock.patch.object(p, "_to_mp3", return_value=__file__),                 mock.patch.object(p, "_remember_transcript") as remember,                 mock.patch.object(p, "_today_brt", return_value=TODAY),                 mock.patch.object(p.urllib.request, "urlopen", return_value=response) as urlopen:
            out = p.transcribe_voice("audio.ogg", prompt=prompt)
        return out, urlopen.call_args.args[0], env, remember

    def test_transcription_calls_openai_and_counts_usage(self):
        out, req, env, remember = self._transcribe(
            b'{"text": " bom dia ", "usage": {"type": "tokens", "input_tokens": 900, "output_tokens": 40,'
            b' "total_tokens": 940}}', prompt="Prisma, Geolab")
        self.assertTrue(out["success"], out)
        self.assertEqual(out["transcript"], "bom dia")
        remember.assert_called_once_with("123", "bom dia")
        env.assert_any_call("PRISMA_STT_OPENAI_KEY")
        self.assertEqual(req.full_url, "https://api.openai.com/v1/audio/transcriptions")
        self.assertEqual(req.get_header("Authorization"), "Bearer chave")
        self.assertTrue(req.get_header("Content-type").startswith("multipart/form-data; boundary=prisma"))
        body = req.data
        for part in (b'name="model"\r\n\r\ngpt-4o-transcribe\r\n', b'name="language"\r\n\r\npt\r\n',
                     b'name="prompt"\r\n\r\nVocabul', b'name="file"; filename="audio.mp3"'):
            self.assertIn(part, body)
        self.assertEqual(p._USAGE[(TODAY, "transcricao", "gpt-4o-transcribe")], [1, 900, 40, 0, 0])

    def test_empty_transcription_is_a_failure(self):
        out, _, _, remember = self._transcribe(b'{"text": "  "}')
        self.assertFalse(out["success"])
        remember.assert_not_called()


if __name__ == "__main__":
    unittest.main()
