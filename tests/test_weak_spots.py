"""Weak-spot review stats (a read-only view of Anki).

note_review_stats() summarizes each line's note from Anki's cards / revlog /
notes tables; it runs here against a small fake collection.

Run with:  python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.card_manager as cm  # noqa: E402


class Classify(unittest.TestCase):
    def test_weak_from_three_lapses(self):
        self.assertIsNone(cm.classify_note(2, "", False))
        self.assertEqual(cm.classify_note(3, "", False), "weak")

    def test_leech_needs_the_tag_and_a_suspended_card(self):
        self.assertEqual(cm.classify_note(8, "AnkiPapers leech", True), "leech")
        self.assertEqual(cm.classify_note(8, "AnkiPapers Leech", True), "leech")
        # Unsuspended after being a leech: still weak from its lapses.
        self.assertEqual(cm.classify_note(8, "AnkiPapers leech", False), "weak")
        # Suspended by hand, no leech tag, few lapses: not flagged.
        self.assertIsNone(cm.classify_note(1, "AnkiPapers", True))


class FakeDB:
    """Answers the three queries note_review_stats makes."""
    def __init__(self, cards, revlog, notes):
        self.cards, self.revlog, self.notes = cards, revlog, notes

    def all(self, sql):
        if "from cards" in sql:
            return self.cards
        if "from notes" in sql:
            return self.notes
        if "group by cid" in sql:
            out = {}
            for rid, cid, ease in self.revlog:
                n, again, last = out.get(cid, (0, 0, 0))
                out[cid] = (n + 1, again + (ease == 1), max(last, rid))
            return [(cid, *v) for cid, v in out.items()]
        if "from revlog where id in" in sql:
            ids = {int(x) for x in sql.split("(")[1].split(")")[0].split(",")}
            return [(cid, ease) for rid, cid, ease in self.revlog if rid in ids]
        raise AssertionError(sql)


class ReviewStats(unittest.TestCase):
    def setUp(self):
        # Note 10: a reversible note, one card lapsed 4x. Note 20: a suspended leech.
        cards = [
            # id, nid, lapses, factor, queue, type, due
            (101, 10, 4, 1700, 2, 2, 105),
            (102, 10, 1, 2500, 2, 2, 110),
            (201, 20, 8, 1300, -1, 2, 90),
        ]
        revlog = [  # id (ms), cid, ease
            (1_000_000, 101, 1), (2_000_000, 101, 3), (3_000_000, 101, 1),
            (4_000_000, 102, 3),
            (5_000_000, 201, 1), (6_000_000, 201, 1),
        ]
        notes = [(10, " AnkiPapers "), (20, " AnkiPapers leech ")]
        self.col = SimpleNamespace(db=FakeDB(cards, revlog, notes), sched=SimpleNamespace(today=100))

    def test_summary_per_note(self):
        stats = cm.note_review_stats(self.col, [10, 20, 10])
        a = stats["10"]
        self.assertEqual(a["status"], "weak")
        self.assertEqual(a["lapses"], 4)            # worst card
        self.assertEqual(a["reviews"], 4)           # all cards of the note
        self.assertEqual(a["again"], 2)
        self.assertEqual(a["ease"], 170)            # lowest ease, in percent
        self.assertEqual(a["last_review"], 4000)    # newest revlog id, in seconds
        self.assertEqual(a["last_ease"], 3)
        self.assertEqual(a["next_due_days"], 5)     # earliest card: due 105, today 100
        self.assertFalse(a["suspended"])
        b = stats["20"]
        self.assertEqual(b["status"], "leech")
        self.assertTrue(b["suspended"])
        self.assertIsNone(b["next_due_days"])        # suspended cards aren't due

    def test_no_notes_no_queries(self):
        self.assertEqual(cm.note_review_stats(SimpleNamespace(), []), {})


if __name__ == "__main__":
    unittest.main()
