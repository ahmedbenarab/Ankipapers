"""Hidden <!--ap:uuid--> anchors survive Tab / Shift+Tab as exactly one copy.

Tab and Shift+Tab used to re-append a line's anchor without removing it
first, adding a copy per press; only the last copy was hidden, so the rest
showed in the editor and went on to Anki with the card text. These tests
cover the fixed re-indent (docLinks.js, run under node) and the healing of
lines that were already damaged, in both the editor and the card parser.

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
from core.parser import split_stable_block_id  # noqa: E402

DOC_LINKS = ROOT / "web_src" / "src" / "docLinks.js"
ID = "12345678-1234-4234-8234-123456789abc"
OTHER = "87654321-4321-4321-8321-cba987654321"
A = f"<!--ap:{ID}-->"

# Runs in node: re-indents a line in and out, and strips / extracts anchors
# from already-damaged lines, printing the results as JSON.
JS = """
import { reindentKeepingAnchor, stripApBlockId, extractApBlockSuffix, getApBlockId } from %s
const A = %s
const indent = (l) => '    ' + l
const outdent = (l) => l.replace(/^( {1,4}|\\t)/, '')
let line = '            Q >> A' + A
const steps = []
for (const f of [outdent, outdent, outdent, indent, indent]) {
  line = reindentKeepingAnchor(line, f)
  steps.push(line)
}
const damaged = 'Q >> A' + A + A + A
const mixed = 'Q >> A<!--ap:%s-->' + A
console.log(JSON.stringify({
  steps,
  plain: reindentKeepingAnchor('    no anchor', outdent),
  damagedStrip: stripApBlockId(damaged),
  damagedSuffix: extractApBlockSuffix(damaged),
  damagedHealed: stripApBlockId(damaged) + extractApBlockSuffix(damaged),
  damagedId: getApBlockId(damaged),
  mixedStrip: stripApBlockId(mixed),
}))
""" % (json.dumps(DOC_LINKS.as_uri()), json.dumps(A), OTHER)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EditorAnchors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(
            ["node", "--input-type=module", "-e", JS],
            capture_output=True, text=True, check=True,
        )
        cls.r = json.loads(out.stdout)

    def test_tab_and_shift_tab_keep_one_anchor(self):
        expected = [
            "        Q >> A" + A,
            "    Q >> A" + A,
            "Q >> A" + A,
            "    Q >> A" + A,
            "        Q >> A" + A,
        ]
        self.assertEqual(self.r["steps"], expected)

    def test_line_without_anchor_is_just_reindented(self):
        self.assertEqual(self.r["plain"], "no anchor")

    def test_repeated_anchor_is_hidden_and_heals_to_one(self):
        self.assertEqual(self.r["damagedStrip"], "Q >> A")
        self.assertEqual(self.r["damagedSuffix"], A)
        self.assertEqual(self.r["damagedHealed"], "Q >> A" + A)
        self.assertEqual(self.r["damagedId"], ID)

    def test_different_anchors_are_not_merged(self):
        # Only copies of the same anchor are collapsed; a different id in
        # front stays as text, as it always did.
        self.assertEqual(self.r["mixedStrip"], f"Q >> A<!--ap:{OTHER}-->")


class ParserAnchors(unittest.TestCase):
    def test_single_anchor(self):
        self.assertEqual(split_stable_block_id("Q >> A" + A), ("Q >> A", ID))

    def test_repeated_anchor_does_not_reach_the_card(self):
        self.assertEqual(split_stable_block_id("Q >> A" + A * 4), ("Q >> A", ID))


if __name__ == "__main__":
    unittest.main()
