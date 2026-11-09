"""Each paper line finds its own Anki note (web_src/src/crossLink.js).

A line is matched to its note by its hidden card ID first, then by its text
hashed the way Generate hashes it, then -- only for a line with no card ID --
by its saved line number. The editor used to hash the raw line, card ID
included, which never matched; every line fell through to its saved line
number, and once lines shifted it showed its neighbor's note (its suspension,
flag and weak-spot state, and opened that note in Anki).

Run with:  python3 -m unittest discover -s tests
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core.parser import extract_cards  # noqa: E402

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"


def _hash(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


# What the paper looked like at Generate: line numbers 1 and 2.
GENERATED = [
    "# Trichomonas<!--uw:3252--><!--flag:red-->",
    f"    What type of organism is this? >> Protozoan [[NH]]<!--ap:{A}-->",
    f"    Treatment options? >> Metronidazole<!--ap:{B}-->",
    "    - Old card without an ID >> answer",
]
REFS = [
    {"line_index": 1, "anki_note_id": 101, "block_id": A, "content_hash": "x"},
    {"line_index": 2, "anki_note_id": 102, "block_id": B, "content_hash": "y"},
    {"line_index": 3, "anki_note_id": 103, "content_hash": _hash("Old card without an ID >> answer")},
]
# And now: a line added at the top, so every saved line number is one short.
NOW = ["New first line"] + GENERATED + [f"    Never generated >> yet<!--ap:{'3' * 8}-3333-4333-8333-{'3' * 12}-->"]

JS = """
import { buildCardRefIndex, resolveNoteIdFromIndex, resolveNoteIdForLine } from %s
const refs = %s
const lines = %s
const idx = buildCardRefIndex(refs)
console.log(JSON.stringify({
  now: lines.map((l, i) => resolveNoteIdFromIndex(i, l, idx)),
  single: resolveNoteIdForLine(2, lines[2], refs),
}))
""" % (json.dumps((ROOT / "web_src" / "src" / "crossLink.js").as_uri()), json.dumps(REFS), json.dumps(NOW))


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class LinesFindTheirOwnNotes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", JS], capture_output=True, text=True)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_shifted_lines_keep_their_own_notes(self):
        # [new line, heading, card A, card B, old card, never generated]
        self.assertEqual(self.r["now"], [None, None, 101, 102, 103, None])

    def test_single_lookup_agrees(self):
        self.assertEqual(self.r["single"], 101)

    def test_hash_matches_generate(self):
        # The old card has no ID, so it is found by text: the JS hash must
        # equal the one Generate stored for the same line.
        (card,) = [c for c in extract_cards("\n".join(GENERATED)) if c.front.startswith("Old")]
        self.assertEqual(card.content_hash, REFS[2]["content_hash"])


if __name__ == "__main__":
    unittest.main()
