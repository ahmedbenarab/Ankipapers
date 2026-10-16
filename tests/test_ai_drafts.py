"""Draft cards: reading card lines out of a model's reply, and the prompts.

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.ai as ai  # noqa: E402

SETTINGS = {"basic_separator": ">>", "reversible_separator": "<>"}


class ParseCards(unittest.TestCase):
    def test_json_in_a_code_fence(self):
        raw = '```json\n{"cards": ["- A >> B", "1. C {{c1::D}}", "junk", "A >> B", "E <> F"]}\n```'
        self.assertEqual(ai.parse_cards(raw, SETTINGS), ["A >> B", "C {{c1::D}}", "E <> F"])

    def test_plain_lines_when_not_json(self):
        self.assertEqual(ai.parse_cards("Q >> A\nnoise\n* R <> S", SETTINGS), ["Q >> A", "R <> S"])

    def test_empty_list(self):
        self.assertEqual(ai.parse_cards('{"cards": []}', SETTINGS), [])

    def test_one_line_per_card(self):
        self.assertEqual(ai.parse_cards('{"cards": ["Q\\n>> A"]}', SETTINGS), ["Q >> A"])

    def test_custom_separators(self):
        s = {"basic_separator": "::", "reversible_separator": "<=>"}
        self.assertEqual(ai.parse_cards('{"cards": ["Q :: A", "T <=> D", "X >> Y"]}', s), ["Q :: A", "T <=> D"])


class Prompts(unittest.TestCase):
    def test_only_allowed_card_types(self):
        p = ai.draft_system_prompt({**SETTINGS, "ai_card_types": {"basic": True, "reversible": False, "cloze": False}})
        self.assertIn("Question >> Answer", p)
        self.assertNotIn("Reversible", p)
        self.assertNotIn("{{c1::hidden}}", p)

    def test_user_rules_and_default(self):
        self.assertIn(ai.DEFAULT_CARD_RULES.splitlines()[0], ai.draft_system_prompt(SETTINGS))
        self.assertIn("Doses as cloze", ai.draft_system_prompt({**SETTINGS, "ai_card_rules": "Doses as cloze"}))

    def test_user_prompt_has_section_and_existing_cards(self):
        p = ai.draft_user_prompt("text", ["Heart failure", "HFrEF"], ["Q >> A"])
        self.assertIn("Heart failure › HFrEF", p)
        self.assertIn("Q >> A", p)

    def test_number_lines_drops_anchors_and_blanks(self):
        out = ai.number_lines("a\n\nb <!--ap:0f3c2a1e-1111-2222-3333-444455556666-->")
        self.assertEqual(out, "1: a\n3: b")


class _FakeStream:
    """Stands in for an HTTP response: yields server-sent-event lines."""
    def __init__(self, events):
        import json as _j
        self.lines = [("data: " + _j.dumps(e) + "\n").encode() for e in events]
    def __iter__(self):
        return iter(self.lines)
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


class ProviderRequests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self._orig = ai._request

    def tearDown(self):
        ai._request = self._orig

    def fake(self, events, fail_first=None):
        def _req(method, url, headers, body, timeout=60.0):
            self.sent.append(json.loads(json.dumps(body)))
            if fail_first and len(self.sent) == 1:
                raise ai.AIError(fail_first)
            return _FakeStream(events)
        ai._request = _req

    def test_claude_gets_no_temperature_and_room_to_think(self):
        self.fake([{"type": "message_start", "message": {"usage": {"input_tokens": 5}}},
                   {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hmm"}},
                   {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Q >> A"}},
                   {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 9}}])
        text, usage = ai.complete("anthropic", "k", "claude-sonnet-5-5", "sys",
                                  [{"role": "user", "content": "x"}], temperature=0.2)
        self.assertEqual(text, "Q >> A")  # thinking text is not part of the answer
        self.assertNotIn("temperature", self.sent[0])
        self.assertGreaterEqual(self.sent[0]["max_tokens"], 16000)
        self.assertEqual(usage, {"input": 5, "output": 9})

    def test_claude_refusal_is_reported(self):
        self.fake([{"type": "message_delta", "delta": {"stop_reason": "refusal"}, "usage": {"output_tokens": 1}}])
        with self.assertRaises(ai.AIError) as cm:
            ai.complete("anthropic", "k", "claude-opus-5-5", "s", [{"role": "user", "content": "x"}])
        self.assertIn("declined", str(cm.exception))

    def test_openai_drops_a_rejected_temperature(self):
        self.fake([{"choices": [{"delta": {"content": "ok"}}]}],
                  fail_first="The provider returned an error (400). Unsupported value: 'temperature'")
        text, _ = ai.complete("openai", "k", "m", "s", [{"role": "user", "content": "x"}],
                              base_url="https://example.com/v1", temperature=0.2)
        self.assertEqual(text, "ok")
        self.assertIn("temperature", self.sent[0])
        self.assertNotIn("temperature", self.sent[1])


if __name__ == "__main__":
    unittest.main()
