"""Counting the image occlusion cards made from a paper's pictures.

Run with:  python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core.occlusion import tally_occlusions  # noqa: E402


class Tally(unittest.TestCase):
    def test_counts_cards_of_every_note_on_the_picture(self):
        rows = [
            (1, '<img src="_ap_heart.png">', 4),
            (2, '<img src="_ap_heart.png">', 2),
            (3, '<img src="_ap_lung.png">', 5),
        ]
        self.assertEqual(
            tally_occlusions(rows, ["_ap_heart.png"]),
            {"_ap_heart.png": {"cards": 6, "note_ids": [1, 2]}},
        )

    def test_pictures_without_notes_are_left_out(self):
        rows = [(1, '<img src="a.png">', 3)]
        self.assertEqual(tally_occlusions(rows, ["b.png"]), {})
        self.assertEqual(tally_occlusions([], ["a.png"]), {})

    def test_quoted_and_escaped_names_match_the_paper(self):
        rows = [
            (1, '<img src="heart%20view.png">', 2),
            (2, '<img src="A&amp;P.png">', 1),
        ]
        out = tally_occlusions(rows, ["heart view.png", "A&P.png"])
        self.assertEqual(out["heart view.png"]["cards"], 2)
        self.assertEqual(out["A&P.png"]["cards"], 1)

    def test_decomposed_name_matches_composed(self):
        # macOS can hand back "é" as e + combining accent; Anki stores NFC.
        rows = [(1, '<img src="café.png">', 1)]
        out = tally_occlusions(rows, ["café.png"])
        self.assertEqual(out["café.png"]["cards"], 1)

    def test_a_note_is_counted_once(self):
        rows = [(1, '<img src="a.png">', 3), (1, '<img src="a.png">', 3)]
        self.assertEqual(tally_occlusions(rows, ["a.png"])["a.png"]["cards"], 3)

    def test_web_pictures_are_ignored(self):
        rows = [(1, '<img src="https://x.org/a.png">', 3)]
        self.assertEqual(tally_occlusions(rows, ["a.png"]), {})


if __name__ == "__main__":
    unittest.main()
