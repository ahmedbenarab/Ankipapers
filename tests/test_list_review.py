"""Reviewing a list card item by item (gui/list_review.py).

Drives the real v3 scheduler on a throwaway collection, the way the desktop
reviewer does: fetch the next card through the wrapped _get_next_v3_card,
answer it through build_answer/answer_card with the reviewer hooks around it.

Needs Anki's own Python (it imports aqt and opens a real collection):
    "$HOME/Library/Application Support/AnkiProgramFiles/.venv/bin/python" -m unittest tests.test_list_review
Plain python3 skips it.
"""
import pathlib
import sys
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent

try:
    from anki.collection import Collection
    from aqt.reviewer import Reviewer

    # Import the add-on's modules as a package without running its
    # __init__.py, which needs a running Anki.
    _pkg = types.ModuleType("ap_under_test")
    _pkg.__path__ = [str(ROOT)]
    sys.modules.setdefault("ap_under_test", _pkg)
    import ap_under_test.core.card_manager as cm
    import ap_under_test.gui.list_review as lr
    from ap_under_test.core.paper import Paper
except Exception:  # plain python3
    Collection = None

PAPER = """Layers of the epidermis
    + Basale
    + Spinosum
    + Granulosum
    + Corneum
Other >> card one
Another >> card two"""


class _MW:
    pass


class _Reviewer:
    def __init__(self, col):
        self.mw = _MW()
        self.mw.col = col
        self._v3 = None
        self.card = None


@unittest.skipIf(Collection is None, "needs Anki's Python")
class Walking(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.col = col = Collection(str(pathlib.Path(self.tmp.name) / "c.anki2"))
        self.paper = Paper(title="Skin", deck_name="Skin", content=PAPER)
        cm.generate_cards(self.paper, col)
        did = col.decks.id("Skin")
        col.decks.select(did)
        conf = col.decks.config_dict_for_deck_id(did)
        conf["new"]["bury"] = True  # Anki would bury items 2-4 after item 1
        conf["rev"]["bury"] = True
        col.decks.save(conf)
        ref = next(r for r in self.paper.card_refs if r.card_type == "list")
        self.note = col.get_note(ref.anki_note_id)
        self.label = {n - 1: h for _a, n, h in cm.list_item_ordinals(self.note["Items"])}
        self.r = _Reviewer(col)
        lr.mw = self.r.mw
        lr._will_end()
        self.next_card = lr._wrap_get_next_v3_card(Reviewer._get_next_v3_card)

    def tearDown(self):
        lr._will_end()
        self.col.close()
        self.tmp.cleanup()

    def _item(self, name):
        return next(c for c in self.note.cards() if self.label[c.ord] == name)

    def _name(self, card):
        if card.nid == self.note.id:
            return self.label[card.ord]
        return card.note().fields[0]

    def show(self):
        self.r.card = self.r._v3 = None
        self.next_card(self.r)
        return self.r.card and self._name(self.r.card)

    def answer(self, ease):
        card = self.r.card
        proceed, ease = lr._will_answer((True, ease), self.r, card)
        sched = self.col.sched
        sched.answer_card(sched.build_answer(card=card, states=self.r._v3.states,
                                             rating=self.r._v3.rating_from_ease(ease)))
        lr._did_answer(self.r, card, ease)

    def walk(self, ease=3, steps=10):
        seen = []
        for _ in range(steps):
            name = self.show()
            if not name:
                break
            seen.append(name)
            self.answer(ease)
        return seen

    def test_a_new_list_is_walked_in_order_despite_sibling_burying(self):
        self.assertEqual(self.walk()[:4], ["Basale", "Spinosum", "Granulosum", "Corneum"])

    def test_an_item_that_is_not_due_is_skipped(self):
        self.col.sched.set_due_date([self._item("Granulosum").id], "10")
        self.assertEqual(self.walk()[:3], ["Basale", "Spinosum", "Corneum"])

    def test_the_walk_starts_at_the_first_due_item_whatever_the_scheduler_offers(self):
        # Only Corneum and Spinosum due; the scheduler would offer whichever.
        for name in ("Basale", "Granulosum"):
            self.col.sched.set_due_date([self._item(name).id], "10")
        for name in ("Spinosum", "Corneum"):
            self.col.sched.set_due_date([self._item(name).id], "0")
        seen = self.walk()
        at = seen.index("Spinosum")  # other cards may come before the list
        self.assertEqual(seen[at:at + 2], ["Spinosum", "Corneum"])
        self.assertNotIn("Basale", seen)

    def test_each_item_keeps_its_own_rating(self):
        self.show(); self.answer(3)   # Basale: Good
        self.show(); self.answer(1)   # Spinosum: Again
        basale, spinosum = self._item("Basale"), self._item("Spinosum")
        self.assertEqual(basale.reps, 1)
        self.assertEqual(spinosum.reps, 1)
        self.assertEqual(spinosum.lapses, 0)  # a new card's Again is not a lapse
        log = self.col.db.list("select ease from revlog where cid in (?, ?) order by id",
                               basale.id, spinosum.id)
        self.assertEqual(log, [3, 1])

    def test_the_next_item_shows_the_ratings_above_it(self):
        self.col.sched.set_due_date([self._item("Spinosum").id], "10")
        self.show(); self.answer(2)  # Basale: Hard
        self.assertEqual(self.show(), "Granulosum")
        chips = lr._card_will_show("", self.r.card, "reviewQuestion")
        self.assertIn('"1": [2, "Hard"]', chips)
        self.assertIn('"2": [0, "not due"]', chips)

    def test_undo_steps_back_one_item(self):
        self.show(); self.answer(3)
        self.show(); self.answer(3)
        self.assertEqual(self.col.undo_status().undo, "Answer Card")
        self.col.undo()
        lr._did_undo(None)
        self.assertEqual(self.show(), "Spinosum")
        self.assertEqual(self._item("Spinosum").reps, 0)
        self.answer(3)
        self.assertEqual(self.show(), "Granulosum")

    def test_other_cards_come_after_the_list(self):
        seen = self.walk(steps=6)
        self.assertEqual(seen[:4], ["Basale", "Spinosum", "Granulosum", "Corneum"])
        self.assertEqual(sorted(seen[4:6]), ["Another", "Other"])


if __name__ == "__main__":
    unittest.main()
