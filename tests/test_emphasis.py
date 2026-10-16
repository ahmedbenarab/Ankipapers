"""One-time conversion of Markdown bold/italic (**x**, *x*) to <b>/<i> tags.

The rule: convert exactly what the editor already shows as bold or italic --
the same pairing patterns it renders with -- and touch nothing else. Code
spans, fenced code blocks and maths keep their asterisks.

Run with:  python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core.emphasis import convert_emphasis_to_tags as conv  # noqa: E402


class Converts(unittest.TestCase):
    def test_bold_and_italic(self):
        self.assertEqual(conv("a **big** and *small* word"), ("a <b>big</b> and <i>small</i> word", 1, 1))

    def test_italic_inside_bold(self):
        self.assertEqual(conv("**a *b* c**"), ("<b>a <i>b</i> c</b>", 1, 1))

    def test_card_syntax_survives(self):
        self.assertEqual(conv("What is **ALF**? >> *acute* liver failure"),
                         ("What is <b>ALF</b>? >> <i>acute</i> liver failure", 1, 1))
        self.assertEqual(conv("{{c1::**HLA**}} and *x*"), ("{{c1::<b>HLA</b>}} and <i>x</i>", 1, 1))

    def test_many_lines_and_indentation(self):
        src = "# **Title**\n    - *nested* item\nplain"
        self.assertEqual(conv(src), ("# <b>Title</b>\n    - <i>nested</i> item\nplain", 1, 1))


class LeavesAlone(unittest.TestCase):
    def test_lone_asterisk(self):
        for s in ("HLA-B*57:01 testing", "{{c1::*}} is multiplication", "(*already assigned earlier)"):
            self.assertEqual(conv(s), (s, 0, 0))

    def test_italic_then_lone_asterisk(self):
        # Exactly what the editor shows today: the first pair is italic.
        self.assertEqual(conv("For list, *L*, the method {{c1::sorted(*L)}}"),
                         ("For list, <i>L</i>, the method {{c1::sorted(*L)}}", 0, 1))

    def test_inline_code(self):
        s = "`square = value ** 2`|`a*b*c`"
        self.assertEqual(conv(s), (s, 0, 0))
        self.assertEqual(conv("**bold** then `x ** y`"), ("<b>bold</b> then `x ** y`", 1, 0))

    def test_fenced_code_block(self):
        s = "```\nx = a * b * c\n**not bold**\n```\n**bold**"
        self.assertEqual(conv(s), ("```\nx = a * b * c\n**not bold**\n```\n<b>bold</b>", 1, 0))

    def test_math(self):
        for s in ("$a*b*c$", "$$x**2 + y**2$$"):
            self.assertEqual(conv(s), (s, 0, 0))

    def test_hidden_anchor_and_existing_tags(self):
        s = "## **Head**<!--ap:11111111-1111-4111-8111-111111111111-->"
        self.assertEqual(conv(s), ("## <b>Head</b><!--ap:11111111-1111-4111-8111-111111111111-->", 1, 0))
        self.assertEqual(conv("<b>already</b> <i>done</i>"), ("<b>already</b> <i>done</i>", 0, 0))

    def test_idempotent(self):
        once = conv("**a** *b* `*c*`")[0]
        self.assertEqual(conv(once), (once, 0, 0))

    def test_empty(self):
        self.assertEqual(conv(""), ("", 0, 0))


if __name__ == "__main__":
    unittest.main()
