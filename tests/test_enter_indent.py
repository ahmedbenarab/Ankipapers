"""Enter on a card line keeps the indentation, and the anchor follows the text.

Enter at the start of a line that carries a hidden <!--ap:uuid--> anchor used
to trim the whole blank line it left behind (nothing but indentation) before
putting the anchor back on it, so the blank line landed at the left margin,
level with the H1s, and kept the anchor while the text moved down without it.
Tab on such a line did nothing, because the four spaces it added were trimmed
straight back off. These tests cover the helpers in docLinks.js (run under
node) that the editor's Enter and Tab now go through.

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC_LINKS = ROOT / "web_src" / "src" / "docLinks.js"
ID = "12345678-1234-4234-8234-123456789abc"
A = f"<!--ap:{ID}-->"

JS = """
import { attachApSuffix, splitLineKeepingAnchor, reindentKeepingAnchor, ensureApBlockId } from %s
const A = %s
const indent = (l) => '    ' + l
const split = (before, after, suf) => splitLineKeepingAnchor('        ', before, after, suf)
console.log(JSON.stringify({
  attachBlank: attachApSuffix('        ', A),
  attachText: attachApSuffix('    Q >> A   ', A),
  attachNone: attachApSuffix('    Q >> A   ', ''),
  enterAtStart: split('', 'Q >> A', A),
  enterInMiddle: split('Q >> ', 'A', A),
  enterAtEnd: split('Q >> A', '', A),
  enterOnBlank: split('', '', A),
  enterNoAnchor: split('', 'plain', ''),
  tabOnStrandedAnchor: reindentKeepingAnchor(A, indent),
  ensureOnBlank: ensureApBlockId('        ').line.startsWith('        <!--ap:'),
}))
""" % (json.dumps(DOC_LINKS.as_uri()), json.dumps(A))


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EnterKeepsIndent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(
            ["node", "--input-type=module", "-e", JS],
            capture_output=True, text=True, check=True,
        )
        cls.r = json.loads(out.stdout)

    def test_blank_line_keeps_its_indentation(self):
        self.assertEqual(self.r["attachBlank"], "        " + A)

    def test_whitespace_after_text_is_still_dropped(self):
        self.assertEqual(self.r["attachText"], "    Q >> A" + A)
        self.assertEqual(self.r["attachNone"], "    Q >> A   ")

    def test_enter_at_start_moves_anchor_down_with_the_text(self):
        self.assertEqual(self.r["enterAtStart"], ["        ", "        Q >> A" + A])

    def test_enter_elsewhere_leaves_anchor_on_top_line(self):
        self.assertEqual(self.r["enterInMiddle"], ["        Q >>" + A, "        A"])
        self.assertEqual(self.r["enterAtEnd"], ["        Q >> A" + A, "        "])
        self.assertEqual(self.r["enterOnBlank"], ["        " + A, "        "])

    def test_enter_without_anchor(self):
        self.assertEqual(self.r["enterNoAnchor"], ["        ", "        plain"])

    def test_tab_indents_a_blank_line_holding_an_anchor(self):
        # Lines the old Enter left behind: just an anchor at the left margin.
        self.assertEqual(self.r["tabOnStrandedAnchor"], "    " + A)

    def test_new_anchor_on_blank_line_keeps_indentation(self):
        self.assertTrue(self.r["ensureOnBlank"])


if __name__ == "__main__":
    unittest.main()
