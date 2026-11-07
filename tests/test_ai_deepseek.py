"""DeepSeek: the OpenAI-style chat API at DeepSeek's own address.

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.ai as ai  # noqa: E402


class FakeStream:
    """A streamed reply: one `data:` line per event, as a server sends them."""

    def __init__(self, events):
        self.lines = [f"data: {json.dumps(e)}\n".encode() for e in events] + [b"data: [DONE]\n"]

    def __iter__(self):
        return iter(self.lines)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _delta(**d):
    return {"choices": [{"delta": d}]}


class DeepSeek(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def _fake_request(self, events):
        def fake(method, url, headers, body=None, timeout=60.0):
            self.calls.append({"url": url, "headers": headers, "body": body})
            return FakeStream(events)
        return fake

    def test_is_a_provider_with_a_default_model(self):
        self.assertIn("deepseek", ai.PROVIDERS)
        self.assertEqual(ai.DEFAULT_MODELS["deepseek"], "deepseek-chat")

    def test_chat_goes_to_deepseek_with_the_key(self):
        events = [_delta(content="Q >> "), _delta(content="A"),
                  {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}]
        with mock.patch.object(ai, "_request", self._fake_request(events)):
            text, usage = ai.complete("deepseek", "sk-test", "deepseek-chat", "sys",
                                      [{"role": "user", "content": "hi"}])
        self.assertEqual(text, "Q >> A")
        self.assertEqual(usage, {"input": 12, "output": 3})
        (call,) = self.calls
        self.assertEqual(call["url"], "https://api.deepseek.com/chat/completions")
        self.assertEqual(call["headers"]["Authorization"], "Bearer sk-test")
        self.assertEqual(call["body"]["max_tokens"], 8192)

    def test_an_address_set_for_openai_is_not_used(self):
        with mock.patch.object(ai, "_request", self._fake_request([_delta(content="x")])):
            ai.complete("deepseek", "sk-test", "deepseek-chat", "sys",
                        [{"role": "user", "content": "hi"}], base_url="http://localhost:11434/v1")
        self.assertTrue(self.calls[0]["url"].startswith("https://api.deepseek.com/"))

    def test_the_reasoner_keeps_its_reasoning_out_of_the_answer(self):
        events = [_delta(reasoning_content="Let me think..."), _delta(content="Answer")]
        with mock.patch.object(ai, "_request", self._fake_request(events)):
            text, _ = ai.complete("deepseek", "sk-test", "deepseek-reasoner", "sys",
                                  [{"role": "user", "content": "hi"}])
        self.assertEqual(text, "Answer")
        self.assertEqual(self.calls[0]["body"]["max_tokens"], ai.DEEPSEEK_REASONER_MAX_TOKENS)

    def test_no_key_says_where_to_add_one(self):
        with self.assertRaises(ai.AIError) as ctx:
            ai.complete("deepseek", "", "deepseek-chat", "sys", [{"role": "user", "content": "hi"}])
        self.assertIn("DeepSeek API key", str(ctx.exception))

    def test_test_connection_lists_deepseek_models(self):
        seen = {}

        def fake_get(url, headers, timeout=20.0):
            seen["url"], seen["headers"] = url, headers
            return {"data": [{"id": "deepseek-reasoner"}, {"id": "deepseek-chat"}]}

        with mock.patch.object(ai, "_get_json", fake_get):
            models = ai.list_models("deepseek", "sk-test")
        self.assertEqual(models, ["deepseek-chat", "deepseek-reasoner"])
        self.assertEqual(seen["url"], "https://api.deepseek.com/models")
        self.assertEqual(seen["headers"]["Authorization"], "Bearer sk-test")


if __name__ == "__main__":
    unittest.main()
