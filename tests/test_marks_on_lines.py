"""Flags and question tags on any line, not only headings.

<!--flag:blue--> or <!--uw::3252--> may sit on a card's own line or on any
line with cards under it. A card's own flag beats its heading's, and the
nearest flagged line wins; question tags add up from the card's line and all
of its parents. Clearing a card-line flag in Anki takes the comment off that
line, as it does for a heading. In the editor, "flag:blue" / "uw::3252" then
Space work on any line of text, but not on a picture, link, divider, table
or fence, nor inside a {{cloze}} or `code`.

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import shutil
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
import core.card_manager as cm  # noqa: E402
from core.paper import Paper  # noqa: E402
from core.parser import extract_cards  # noqa: E402
from test_flags import FlagCol  # noqa: E402

ANCHOR = "<!--ap:0b5e8f2a-3c4d-4e5f-8a9b-1c2d3e4f5a6b-->"

DOC = f"""# Cardiology<!--flag:red--><!--uw::111-->
    Pulsus parvus et tardus <> AS<!--flag:blue--><!--uw::3252-->{ANCHOR}
    Murmur louder with Valsalva >> HCM
    - Mitral stenosis<!--flag:green--><!--uw::4410-->
        Opening snap >> MS
"""


def _note(col, front):
    return next(n for n in col.notes.values() if n.fields[0] == front)


class Parsing(unittest.TestCase):
    def setUp(self):
        self.cards = {c.front: c for c in extract_cards(DOC)}

    def test_a_cards_own_flag_beats_its_heading(self):
        card = self.cards["Pulsus parvus et tardus"]
        self.assertEqual((card.flag, card.flag_line), (4, 1))
        self.assertEqual(self.cards["Murmur louder with Valsalva"].flag, 1)

    def test_a_flagged_bullet_flags_the_cards_under_it(self):
        card = self.cards["Opening snap"]
        self.assertEqual((card.flag, card.flag_line), (3, 3))

    def test_question_ids_add_up_from_the_line_and_its_parents(self):
        self.assertEqual(self.cards["Pulsus parvus et tardus"].tag_marks, ["uw::3252", "uw::111"])
        self.assertEqual(self.cards["Opening snap"].tag_marks, ["uw::4410", "uw::111"])
        self.assertEqual(self.cards["Murmur louder with Valsalva"].tag_marks, ["uw::111"])

    def test_the_marks_never_reach_the_card_and_the_anchor_still_reads(self):
        card = self.cards["Pulsus parvus et tardus"]
        self.assertEqual(card.back, "AS")
        self.assertEqual(card.block_id, "0b5e8f2a-3c4d-4e5f-8a9b-1c2d3e4f5a6b")

    def test_marking_a_card_line_is_not_an_edit_to_the_card(self):
        plain = extract_cards("# H\n    Q >> A")[0]
        marked = extract_cards("# H\n    Q >> A<!--flag:blue--><!--uw::5-->")[0]
        self.assertEqual(plain.content_hash, marked.content_hash)


class Generating(unittest.TestCase):
    def setUp(self):
        self.col = FlagCol()
        self.paper = Paper(title="Cards", content=DOC)
        self.report = {}
        cm.generate_cards(self.paper, self.col, report=self.report)

    def generate(self):
        self.report = {}
        return cm.generate_cards(self.paper, self.col, report=self.report)

    def flags_of(self, front):
        note = _note(self.col, front)
        return [self.col.cards[cid].user_flag() for cid in note.card_ids()]

    def test_cards_get_the_nearest_flag(self):
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [4, 4])
        self.assertEqual(self.flags_of("Murmur louder with Valsalva"), [1])
        self.assertEqual(self.flags_of("Opening snap"), [3])

    def test_cards_get_every_question_tag(self):
        tags = _note(self.col, "Pulsus parvus et tardus").tags
        self.assertIn("UWorldABIM::3252", tags)
        self.assertIn("UWorldABIM::111", tags)
        self.assertNotIn("UWorldABIM::4410", tags)

    def test_flagging_an_existing_card_line_keeps_its_note(self):
        note_id = _note(self.col, "Murmur louder with Valsalva").id
        self.paper.content = self.paper.content.replace(
            "Valsalva >> HCM", "Valsalva >> HCM<!--flag:purple--><!--uw::5120-->")
        created, _updated, deleted = self.generate()   # updated: the new tag is saved
        self.assertEqual((created, deleted), (0, 0))
        note = _note(self.col, "Murmur louder with Valsalva")
        self.assertEqual(note.id, note_id)
        self.assertEqual(self.flags_of("Murmur louder with Valsalva"), [7])
        self.assertIn("UWorldABIM::5120", note.tags)

    def test_taking_the_cards_flag_off_hands_it_to_the_heading(self):
        self.paper.content = self.paper.content.replace("AS<!--flag:blue-->", "AS")
        self.generate()
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [1, 1])

    def test_cleared_in_anki_takes_the_comment_off_the_card_line(self):
        for cid in _note(self.col, "Pulsus parvus et tardus").card_ids():
            self.col.cards[cid].flags = 0
        self.generate()
        self.assertNotIn("<!--flag:blue-->", self.paper.content)
        self.assertIn("Pulsus parvus et tardus <> AS<!--uw::3252-->" + ANCHOR, self.paper.content)
        self.assertEqual(self.report["unflagged_headings"], ["Pulsus parvus et tardus <> AS"])
        # Cleared in Anki, so the red heading does not flag it either.
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [0, 0])
        self.assertIn("<!--flag:red-->", self.paper.content)
        self.assertEqual(self.generate(), (0, 0, 0))
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [0, 0])

    def test_a_long_card_line_is_shortened_in_the_message(self):
        self.assertEqual(cm._line_label("    Q" * 30 + " >> A<!--flag:red-->")[-3:], "...")
        self.assertLessEqual(len(cm._line_label("x" * 200)), 60)


JS = """
import { takesLineMarks, lineFlags } from %s
const at = (s) => takesLineMarks(s, s.length)
console.log(JSON.stringify({
  heading: at('## Aortic stenosis flag:red'),
  card: at('Pulsus parvus <> AS flag:blue'),
  bullet: at('- Mitral stenosis uw::4410'),
  text: at('Murmurs to know uw::3252'),
  quote: at('> Remember this flag:red'),
  picture: at('![](scan.png) flag:red'),
  link: at('https://example.com'),
  divider: at('---'),
  table: at('| a | b | flag:red'),
  fence: at('```py flag:red'),
  blank: at(''),
  inCloze: takesLineMarks('The {{c1::flag:red}}', 15),
  afterCloze: at('The {{c1::LA}} enlarges flag:red'),
  inCode: takesLineMarks('Run `flag:red` now', 13),
  flags: lineFlags([
    '# Cardiology<!--flag:red-->',
    '    Pulsus parvus <> AS<!--flag:blue-->',
    '    Valsalva >> HCM',
    '    - Mitral stenosis<!--flag:green-->',
    '        Opening snap >> MS',
  ]),
}))
""" % json.dumps((ROOT / "web_src" / "src" / "lineMarks.js").as_uri())


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EditorHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", JS], capture_output=True, text=True)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_any_line_of_text_takes_the_shortcuts(self):
        for kind in ("heading", "card", "bullet", "text", "quote", "afterCloze"):
            self.assertTrue(self.r[kind], kind)

    def test_lines_a_comment_would_break_do_not(self):
        for kind in ("picture", "link", "divider", "table", "fence", "blank", "inCloze", "inCode"):
            self.assertFalse(self.r[kind], kind)

    def test_the_gutter_takes_a_lines_own_flag(self):
        self.assertEqual(self.r["flags"], [1, 4, 1, 3, 3])


if __name__ == "__main__":
    unittest.main()
