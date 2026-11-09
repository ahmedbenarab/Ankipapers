"""Anki flags from a heading: <!--flag:red--> on a heading flags its cards.

Generate sets the heading's flag on every card under it (nearest flagged
heading wins), but only when the paper's flag changed since the last
Generate, so a flag cleared in Anki stays cleared. When every card under a
heading has been cleared in Anki, the comment comes off the heading too.

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
from core import flags  # noqa: E402
from core.paper import CardReference, Paper  # noqa: E402
from core.parser import extract_cards  # noqa: E402
from test_no_heading import FakeCol, FakeNote  # noqa: E402


class FakeCard:
    def __init__(self, cid):
        self.id = cid
        self.flags = 0

    def user_flag(self):
        return self.flags & 0b111


class FlagCol(FakeCol):
    """FakeCol with cards: two per reversible note, one otherwise."""

    def __init__(self):
        super().__init__()
        self.cards = {}
        self._next_card = 50000

    def add_note(self, note, deck_id):
        super().add_note(note, deck_id)
        count = 2 if "Reversible" in note.model()["name"] else 1
        ids = []
        for _ in range(count):
            self._next_card += 1
            self.cards[self._next_card] = FakeCard(self._next_card)
            ids.append(self._next_card)
        note.card_ids = lambda ids=ids: list(ids)

    def get_card(self, cid):
        return self.cards[cid]

    def set_user_flag_for_cards(self, flag, cids):
        for cid in cids:
            self.cards[cid].flags = flag


DOC = """# Cardiology<!--flag:green-->
    ## Aortic stenosis<!--flag:red-->
        Crescendo-decrescendo murmur >> AS
        Pulsus parvus et tardus <> AS
    Murmur louder with Valsalva >> HCM
Unflagged >> nothing
"""


class Parsing(unittest.TestCase):
    def test_nearest_heading_wins(self):
        by_front = {c.front: c for c in extract_cards(DOC)}
        self.assertEqual(by_front["Crescendo-decrescendo murmur"].flag, 1)
        self.assertEqual(by_front["Crescendo-decrescendo murmur"].flag_line, 1)
        self.assertEqual(by_front["Murmur louder with Valsalva"].flag, 3)
        self.assertEqual(by_front["Unflagged"].flag, 0)

    def test_names_and_numbers(self):
        self.assertEqual(flags.flag_number("Turquoise"), 6)
        self.assertEqual(flags.flag_number("2"), 2)
        self.assertEqual(flags.flag_number("none"), 0)
        self.assertEqual(flags.flag_number("9"), 0)


class Generating(unittest.TestCase):
    def setUp(self):
        self.col = FlagCol()
        self.paper = Paper(title="Cards", content=DOC)
        self.report = {}
        cm.generate_cards(self.paper, self.col, report=self.report)

    def flags_of(self, front):
        note = next(n for n in self.col.notes.values() if n.fields[0] == front)
        return [self.col.cards[cid].user_flag() for cid in note.card_ids()]

    def generate(self):
        self.report = {}
        return cm.generate_cards(self.paper, self.col, report=self.report)

    def test_new_cards_get_the_flag_on_every_card(self):
        self.assertEqual(self.flags_of("Crescendo-decrescendo murmur"), [1])
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [1, 1])
        self.assertEqual(self.flags_of("Murmur louder with Valsalva"), [3])
        self.assertEqual(self.flags_of("Unflagged"), [0])

    def test_flag_never_reaches_card_or_context(self):
        note = next(n for n in self.col.notes.values() if n.fields[0] == "Crescendo-decrescendo murmur")
        self.assertNotIn("flag:", "".join(note.fields))

    def test_a_second_generate_is_quiet(self):
        self.assertEqual(self.generate(), (0, 0, 0))
        self.assertEqual(self.report["flags_changed"], 0)

    def test_changing_the_heading_flag_changes_the_cards(self):
        self.paper.content = self.paper.content.replace("<!--flag:red-->", "<!--flag:orange-->")
        self.generate()
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [2, 2])
        self.assertEqual(self.report["flags_changed"], 2)

    def test_removing_the_comment_unflags_but_keeps_a_users_own_flag(self):
        note = next(n for n in self.col.notes.values() if n.fields[0] == "Pulsus parvus et tardus")
        self.col.cards[note.card_ids()[1]].flags = 4  # blue, set by hand in Anki
        self.paper.content = self.paper.content.replace("<!--flag:red-->", "")
        self.paper.content = self.paper.content.replace("<!--flag:green-->", "")
        self.generate()
        self.assertEqual(self.flags_of("Crescendo-decrescendo murmur"), [0])
        self.assertEqual(self.flags_of("Murmur louder with Valsalva"), [0])
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [0, 4])

    def test_removing_an_inner_flag_hands_the_cards_to_the_outer_one(self):
        self.paper.content = self.paper.content.replace("<!--flag:red-->", "")
        self.generate()
        self.assertEqual(self.flags_of("Crescendo-decrescendo murmur"), [3])

    def test_flag_cleared_on_some_cards_stays_cleared_and_comment_stays(self):
        note = next(n for n in self.col.notes.values() if n.fields[0] == "Crescendo-decrescendo murmur")
        self.col.cards[note.card_ids()[0]].flags = 0
        self.generate()
        self.assertEqual(self.flags_of("Crescendo-decrescendo murmur"), [0])
        self.assertIn("<!--flag:red-->", self.paper.content)
        self.assertEqual(self.report["unflagged_headings"], [])

    def test_cleared_on_every_card_takes_the_comment_off_the_heading(self):
        for front in ("Crescendo-decrescendo murmur", "Pulsus parvus et tardus"):
            note = next(n for n in self.col.notes.values() if n.fields[0] == front)
            for cid in note.card_ids():
                self.col.cards[cid].flags = 0
        self.generate()
        self.assertNotIn("<!--flag:red-->", self.paper.content)
        self.assertIn("## Aortic stenosis", self.paper.content)
        self.assertEqual(self.report["unflagged_headings"], ["Aortic stenosis"])
        # Cleared in Anki, so the green heading above does not flag them either.
        self.assertEqual(self.flags_of("Pulsus parvus et tardus"), [0, 0])
        self.assertEqual(self.generate(), (0, 0, 0))
        self.assertEqual(self.report["flags_changed"], 0)
        self.assertIn("<!--flag:green-->", self.paper.content)  # Valsalva is still green

    def test_clearing_the_rest_then_takes_the_outer_comment_off(self):
        for note in self.col.notes.values():
            for cid in note.card_ids():
                self.col.cards[cid].flags = 0
        self.generate()
        self.assertNotIn("<!--flag:red-->", self.paper.content)
        self.generate()
        self.assertNotIn("<!--flag:green-->", self.paper.content)

    def test_newly_flagged_heading_is_not_mistaken_for_cleared(self):
        self.paper.content = self.paper.content.replace("Unflagged >> nothing", "# New<!--flag:purple-->\n    Unflagged >> nothing")
        self.generate()
        self.assertIn("<!--flag:purple-->", self.paper.content)
        self.assertEqual(self.flags_of("Unflagged"), [7])

    def test_flag_applied_round_trips(self):
        ref = CardReference.from_dict(CardReference(0, "basic", 1, flag_applied=2).to_dict())
        self.assertEqual(ref.flag_applied, 2)


JS = """
import { findFlagShortcut, setFlagComment, stripFlagComments, flagWordIn } from %s
console.log(JSON.stringify({
  red: findFlagShortcut('## AS flag:red'),
  num: findFlagShortcut('## AS flag:2'),
  none: findFlagShortcut('## AS flag:none'),
  noHit: findFlagShortcut('## AS redflag:red'),
  set: setFlagComment('    ## AS<!--uw:1-->', 'red'),
  replace: setFlagComment('    ## AS<!--flag:red-->', '3'),
  clear: setFlagComment('    ## AS<!--flag:red-->', '0'),
  strip: stripFlagComments('## AS<!--flag:red-->'),
  word: flagWordIn('## AS<!--flag:green-->'),
}))
""" % json.dumps((ROOT / "web_src" / "src" / "cardFlags.js").as_uri())


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EditorHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", JS],
                             capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def test_shortcut(self):
        self.assertEqual(self.r["red"], {"start": 5, "flag": 1})
        self.assertEqual(self.r["num"]["flag"], 2)
        self.assertEqual(self.r["none"]["flag"], 0)
        self.assertIsNone(self.r["noHit"])

    def test_set_replace_clear(self):
        self.assertEqual(self.r["set"], "    ## AS<!--uw:1--><!--flag:red-->")
        self.assertEqual(self.r["replace"], "    ## AS<!--flag:green-->")
        self.assertEqual(self.r["clear"], "    ## AS")
        self.assertEqual(self.r["strip"], "## AS")
        self.assertEqual(self.r["word"], "green")


if __name__ == "__main__":
    unittest.main()
