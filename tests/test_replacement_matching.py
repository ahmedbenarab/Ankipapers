"""Which typed text expands into a macOS Text Replacement (findTextReplacement).

A shortcut fires after a space or at the start of a line, and also right
after punctuation such as a backtick, bracket, quote or table pipe. It fires
inside inline code, ``` blocks and $math$ too. It never fires when glued to a
letter or digit, so "word,sig" stays as typed.

Runs web_src/src/blockFormat.js under node; skipped when node is missing.
Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
BLOCK_FORMAT = ROOT / "web_src" / "src" / "blockFormat.js"

REPLACEMENTS = {",left": "←", ",sig": "σ", ",lilalpha": "α", "omw": "on my way"}

# (text typed so far, expected shortcut or None). The caret is at the end.
CASES = [
    (",left", ",left"),                      # start of line
    ("go ,left", ",left"),                   # after a space
    ("`,left", ",left"),                     # right after a backtick
    ("` ,left", ",left"),                    # inside an unclosed code span
    ("see `code ,left", ",left"),            # inside inline code
    ("(,left", ",left"),                     # after a bracket
    ('",left', ",left"),                     # after a quote
    ("| a |,left", ",left"),                 # after a table pipe
    ("$x + ,lilalpha", ",lilalpha"),         # inside inline math
    ("$$,lilalpha", ",lilalpha"),            # inside block math
    ("```,sig", ",sig"),                     # on a fence line
    ("(omw", "omw"),                         # letter shortcut after punctuation
    ("word,sig", None),                      # glued to a letter
    ("x2,sig", None),                        # glued to a digit
    ("snake_,sig", None),                    # glued to an underscore
    ("nomw", None),                          # a shortcut inside a word
    (",lef", None),                          # not a shortcut
    ("", None),
]

JS = """
import { registerHooks } from 'node:module'
// blockFormat.js imports './docLinks' without an extension, as Vite allows;
// node needs the '.js' spelled out.
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx) } catch (e) {
      if (spec.startsWith('.') && !/\\.[a-z]+$/.test(spec)) return next(spec + '.js', ctx)
      throw e
    }
  },
})
const { findTextReplacement, buildReplacementMap } = await import(%s)
const map = buildReplacementMap(Object.entries(%s).map(([shortcut, phrase]) => ({ shortcut, phrase })))
const out = %s.map((text) => {
  const hit = findTextReplacement(text, text.length, map)
  return hit && { shortcut: hit.shortcut, start: hit.start, end: hit.end, phrase: hit.phrase }
})
console.log(JSON.stringify(out))
""" % (
    json.dumps(BLOCK_FORMAT.as_uri()),
    json.dumps(REPLACEMENTS),
    json.dumps([c[0] for c in CASES]),
)


def _node_has_register_hooks():
    if not shutil.which("node"):
        return False
    out = subprocess.run(
        ["node", "-e", "process.stdout.write(String(typeof require('node:module').registerHooks))"],
        capture_output=True, text=True,
    )
    return out.stdout == "function"


@unittest.skipUnless(_node_has_register_hooks(), "needs node 23.5+ (module.registerHooks)")
class Matching(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(
            ["node", "--input-type=module", "-e", JS],
            capture_output=True, text=True, check=True,
        )
        cls.results = json.loads(out.stdout)

    def test_cases(self):
        for (text, expected), hit in zip(CASES, self.results):
            with self.subTest(text=text):
                if expected is None:
                    self.assertIsNone(hit)
                    continue
                self.assertIsNotNone(hit)
                self.assertEqual(hit["shortcut"], expected)
                # The span replaced is exactly the shortcut, at the end.
                self.assertEqual(hit["end"], len(text))
                self.assertEqual(hit["start"], len(text) - len(expected))
                self.assertEqual(hit["phrase"], REPLACEMENTS[expected])


if __name__ == "__main__":
    unittest.main()
