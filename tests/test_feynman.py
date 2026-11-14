"""Feynman practice: the answer key, the score, and the marks on a heading.

An answer is the hidden part of one card: the back of a basic card, a
reversible pair, each cloze deletion, each "+ " list item. A heading's section
runs to the next heading of the same or a higher level. The model only gives
a verdict per answer; the score is described / total, counted here. The
LastFeynmanDate / LastFeynmanScore marks on a heading are never tags
(core/feynman.py, core/qbank.py).

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core import feynman as F  # noqa: E402
from core import qbank  # noqa: E402
from core.parser import extract_cards  # noqa: E402

PAPER = "\n".join([
    "# Heart failure<!--ap:11111111-1111-1111-1111-111111111111-->",           # 0
    "Heart failure >> inadequate output or high filling pressures",            # 1
    "## HFrEF<!--uw::3252--><!--LastFeynmanDate::11_02_2026--><!--LastFeynmanScore::52%-->",  # 2
    "EF ≤ 40% >> **HFrEF**",                                                    # 3
    "Drugs with a mortality benefit",                                           # 4
    "    + ARNI",                                                               # 5
    "    + β-blocker",                                                          # 6
    "    + MRA",                                                                # 7
    "    + SGLT2i",                                                             # 8
    "Sacubitril-valsartan <> ARNI",                                             # 9
    "&& a supplement >> is not a card",                                         # 10
    "### Device therapy",                                                       # 11
    "ICD if EF ≤ {{35%}} despite {{c2::3 mo::time}} of GDMT",                   # 12
    "CRT if LBBB with QRS ≥ {{150 ms}}",                                        # 13
    "Picture >> ![x](a.png)",                                                   # 14
    "```",                                                                      # 15
    "a >> b",                                                                   # 16
    "```",                                                                      # 17
    "## HFpEF",                                                                 # 18
    "EF ≥ {{50%}} with diastolic dysfunction",                                  # 19
    "SGLT2i in HFpEF >> fewer hospitalisations",                                # 20
    "#### Too deep",                                                            # 21
    "x >> y",                                                                   # 22
])


class AnswerKey(unittest.TestCase):
    def test_counts_per_heading(self):
        # H1: everything (12). H2 HFrEF includes its H3 (6 + 3). H4 isn't a topic.
        self.assertEqual(F.answer_counts(PAPER), {0: 13, 2: 9, 11: 3, 18: 3})

    def test_each_card_type_counts_its_answers(self):
        key = F.answer_key(PAPER, 2)
        self.assertEqual(key["heading"], "HFrEF")
        self.assertEqual(key["level"], 2)
        got = [(it["id"], it["kind"], it["context"], it["answer"]) for it in key["items"]]
        self.assertEqual(got, [
            (1, "basic", "EF ≤ 40%", "HFrEF"),
            (2, "list", "Drugs with a mortality benefit", "ARNI"),
            (3, "list", "Drugs with a mortality benefit", "β-blocker"),
            (4, "list", "Drugs with a mortality benefit", "MRA"),
            (5, "list", "Drugs with a mortality benefit", "SGLT2i"),
            (6, "reversible", "", "Sacubitril-valsartan <> ARNI"),
            (7, "cloze", "ICD if EF ≤ ___ despite 3 mo of GDMT", "35%"),
            (8, "cloze", "ICD if EF ≤ 35% despite ___ of GDMT", "3 mo"),
            (9, "cloze", "CRT if LBBB with QRS ≥ ___", "150 ms"),
        ])

    def test_picture_answers_supplements_and_code_are_not_counted(self):
        answers = [it["answer"] for it in F.answer_key(PAPER, 11)["items"]]
        self.assertEqual(answers, ["35%", "3 mo", "150 ms"])

    def test_section_stops_at_same_or_higher_heading(self):
        key = F.answer_key(PAPER, 18)
        self.assertEqual([it["answer"] for it in key["items"]], ["50%", "fewer hospitalisations", "y"])

    def test_not_a_heading(self):
        self.assertIn("error", F.answer_key(PAPER, 3))

    def test_heading_list_items_count(self):
        doc = "## Causes\n+ Ischemia\n+ Hypertension\n## Next\n+ Other"
        self.assertEqual(F.answer_counts(doc), {0: 2, 3: 1})


class EditablePrompt(unittest.TestCase):
    def test_default_rules_then_the_reply_format(self):
        p = F.grading_system_prompt("")
        self.assertTrue(p.startswith(F.DEFAULT_GRADING_RULES))
        self.assertTrue(p.rstrip().endswith(F.GRADING_OUTPUT.rstrip()))

    def test_own_rules_keep_the_reply_format(self):
        p = F.grading_system_prompt("  Be generous with synonyms.  ")
        self.assertTrue(p.startswith("Be generous with synonyms.\n\nOUTPUT"))
        self.assertNotIn("THE NOTES ARE THE ONLY SOURCE OF TRUTH", p)
        self.assertIn('"verdict"', p)

    def test_rules_dont_contain_the_reply_format(self):
        self.assertNotIn("Reply with JSON only", F.DEFAULT_GRADING_RULES)


class Score(unittest.TestCase):
    def key(self):
        return F.answer_key(PAPER, 11)

    def test_score_is_covered_over_total(self):
        reply = json.dumps({"items": [
            {"id": 1, "verdict": "covered", "heard": "thirty-five"},
            {"id": 2, "verdict": "contradicted", "note": "You said six months"},
            {"id": 3, "verdict": "missed", "note": "QRS width not mentioned"},
        ]})
        r = F.score_reply(self.key(), reply)
        self.assertEqual((r["covered"], r["total"], r["score"]), (1, 3, 33))
        self.assertEqual([it["verdict"] for it in r["items"]], ["covered", "contradicted", "missed"])
        self.assertEqual(r["items"][1]["note"], "You said six months")

    def test_fenced_reply_and_missing_or_odd_verdicts_count_as_missed(self):
        reply = "```json\n" + json.dumps({"items": [
            {"id": 1, "verdict": "Covered"},
            {"id": 2, "verdict": "partially"},
        ]}) + "\n```"
        r = F.score_reply(self.key(), reply)
        self.assertEqual([it["verdict"] for it in r["items"]], ["covered", "missed", "missed"])
        self.assertEqual(r["score"], 33)

    def test_extra_ids_are_ignored(self):
        reply = json.dumps({"items": [{"id": n, "verdict": "covered"} for n in range(1, 9)]})
        r = F.score_reply(self.key(), reply)
        self.assertEqual((r["covered"], r["total"], r["score"]), (3, 3, 100))

    def test_bad_reply_raises(self):
        with self.assertRaises(F.AI.AIError):
            F.score_reply(self.key(), "I think they did well.")

    def test_percent_rounds_halves_up(self):
        self.assertEqual([F.percent(2, 3), F.percent(1, 8), F.percent(0, 0)], [67, 13, 0])


class Prompt(unittest.TestCase):
    def test_user_prompt_lists_the_numbered_key_and_transcript(self):
        text = F.grading_user_prompt(F.answer_key(PAPER, 11), "ICD at thirty-five percent")
        self.assertIn("Section: ### Device therapy", text)
        self.assertIn("Answer key (3 answers):", text)
        self.assertIn("1. [cloze] Context: ICD if EF ≤ ___ despite 3 mo of GDMT  |  Answer: 35%", text)
        self.assertTrue(text.rstrip().endswith('ICD at thirty-five percent\n"""'))

    def test_system_prompt_grades_only_against_the_notes(self):
        p = F.GRADING_SYSTEM_PROMPT
        self.assertIn("Do not use your own knowledge", p)
        self.assertIn("The accuracy of the notes is the student's responsibility", p)
        self.assertIn("covered answers divided by the total number of answers", p)


class Retry(unittest.TestCase):
    def test_busy_provider_is_retried_then_gives_up(self):
        calls, waits = [], []

        def busy():
            calls.append(1)
            raise F.AI.AIError("The provider returned an error (503). This model is currently experiencing high demand.")

        with self.assertRaises(F.AI.AIError):
            F._retry_busy(busy, sleep=waits.append)
        self.assertEqual((len(calls), waits), (3, [2.0, 5.0]))

    def test_busy_then_ok(self):
        tries = iter([F.AI.AIError("error (503)"), "the transcript"])

        def flaky():
            r = next(tries)
            if isinstance(r, Exception):
                raise r
            return r

        self.assertEqual(F._retry_busy(flaky, sleep=lambda _w: None), "the transcript")

    def test_bad_key_is_not_retried(self):
        calls = []

        def bad():
            calls.append(1)
            raise F.AI.AIError("The provider rejected the API key (401).")

        with self.assertRaises(F.AI.AIError):
            F._retry_busy(bad, sleep=lambda _w: None)
        self.assertEqual(len(calls), 1)


class TranscribeSetup(unittest.TestCase):
    def test_gemini_needs_its_key(self):
        with self.assertRaises(F.AI.AIError) as cm:
            F.transcribe("gemini", "", b"x")
        self.assertIn("Google AI Studio", str(cm.exception))

    def test_local_server_needs_no_key(self):
        self.assertFalse(F.needs_key("openai", "http://localhost:8000/v1"))
        self.assertTrue(F.needs_key("openai", ""))
        self.assertTrue(F.needs_key("gemini", ""))

    def test_openai_sends_audio_to_chat_completions(self):
        from unittest import mock
        sent = {}

        class Resp:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"choices": [{"message": {"content": "Voriconazole first line."}}]}).encode()

        def fake(method, url, headers, body, timeout):
            sent.update(url=url, body=body, headers=headers)
            return Resp()

        with mock.patch.object(F.AI, "_request", fake):
            text = F.transcribe("openai", "sk-x", b"RIFFwav", "audio/wav", "", "")
        self.assertEqual(text, "Voriconazole first line.")
        self.assertTrue(sent["url"].endswith("/v1/chat/completions"))
        self.assertEqual(sent["body"]["model"], "gpt-audio-1.5")
        part = sent["body"]["messages"][0]["content"][1]
        self.assertEqual((part["type"], part["input_audio"]["format"]), ("input_audio", "wav"))

    def test_unknown_provider(self):
        with self.assertRaises(F.AI.AIError):
            F.transcribe("anthropic", "k", b"x")

    def test_default_models(self):
        self.assertEqual(F.DEFAULT_FEYNMAN_MODELS, {"gemini": "gemini-3.8-flash", "openai": "gpt-audio-1.5"})
        self.assertEqual(F.AI.DEFAULT_MODELS["gemini"], "gemini-3.8-flash")


class Microphones(unittest.TestCase):
    def test_inputs_only_with_the_default_marked(self):
        raw = json.dumps({"SPAudioDataType": [{"_items": [
            {"_name": "Trevor’s AirPods Max", "coreaudio_device_input": 1,
             "coreaudio_default_audio_input_device": "spaudio_yes"},
            {"_name": "Trevor’s AirPods Max", "coreaudio_device_output": 1},
            {"_name": "MacBook Pro Microphone", "coreaudio_device_input": 1},
            {"_name": "BenQ GW2480"},
        ]}]})
        self.assertEqual(F.parse_system_inputs(raw), [
            {"name": "Trevor’s AirPods Max", "default": True},
            {"name": "MacBook Pro Microphone", "default": False},
        ])

    def test_garbage_is_no_inputs(self):
        self.assertEqual(F.parse_system_inputs("not json"), [])


class NotTags(unittest.TestCase):
    def test_feynman_marks_tag_nothing(self):
        line = "## HFrEF<!--uw::3252--><!--LastFeynmanDate::11_02_2026--><!--LastFeynmanScore::52%-->"
        self.assertEqual(qbank.tag_marks_in(line), ["uw::3252"])

    def test_feynman_marks_are_never_unknown_shortcuts(self):
        self.assertEqual(qbank.unknown_mark_lines(PAPER, {"uw": "UWorldABIM"}), [])

    def test_cards_under_the_heading_get_only_real_tags(self):
        # Tags pass to lines indented under the heading (core/qbank.py).
        doc = ("## HFrEF<!--uw::3252--><!--LastFeynmanDate::11_02_2026--><!--LastFeynmanScore::52%-->\n"
               "    EF ≤ 40% >> HFrEF")
        card = extract_cards(doc)[0]
        self.assertEqual(card.tag_marks, ["uw::3252"])
        self.assertNotIn("Feynman", card.front + card.back)

    def test_names_are_reserved_as_shortcuts(self):
        rows = [{"shortcut": "LastFeynmanScore", "tag": "X", "old": []}]
        self.assertIn("is taken", qbank.table_problem(rows))


if __name__ == "__main__":
    unittest.main()
