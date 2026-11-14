"""The editor's flag rule (web_src/src/lineMarks.js).

lineFlags() decides which color the gutter rule beside each line takes: the
flag of the nearest flagged heading above it (the rule Generate uses), with
blank lines inside a section keeping the color so the rule is unbroken.
ankiFlagOf() picks the flag a card line's cards carry in Anki.

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "web_src" / "src"

JS = """
import { lineFlags, ankiFlagOf } from %s
const lines = [
  '# Aortic stenosis<!--flag:red-->',
  '    ## Presentation',
  '        Murmur >> AS',
  '',
  '        Pulsus parvus >> AS',
  '    ## Treatment<!--flag:orange-->',
  '        TAVR >> AS',
  '',
  '# Cardiomyopathy',
  '    HCM >> septum',
  '    ```py',
  '    x = 1',
  '    ```',
]
console.log(JSON.stringify({
  flags: lineFlags(lines),
  most: ankiFlagOf([0, 3, 3, 1]),
  none: ankiFlagOf([0, 0]),
}))
""" % json.dumps((SRC / "lineMarks.js").as_uri())

@unittest.skipUnless(shutil.which("node"), "node is not installed")
class LineFlags(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", JS], capture_output=True, text=True)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_nearest_heading_wins_and_blank_lines_keep_the_color(self):
        self.assertEqual(self.r["flags"][:8], [1, 1, 1, 1, 1, 2, 2, 0])

    def test_unflagged_topic_and_its_code_block_have_no_rule(self):
        self.assertEqual(self.r["flags"][8:], [0, 0, 0, 0, 0])

    def test_a_cards_anki_flag_is_the_most_common_one(self):
        self.assertEqual(self.r["most"], 3)
        self.assertEqual(self.r["none"], 0)
