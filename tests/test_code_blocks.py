"""``` code blocks: no cards inside, the block as a breadcrumb, ➵ indentation.

Run with:  python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core.code_blocks import (  # noqa: E402
    ARROW,
    arrows_from_spaces,
    expand_arrows_in_markdown,
    find_code_blocks,
    highlight_tokens,
)
from core.parser import extract_cards, get_context_heading  # noqa: E402

A = ARROW

DOC = f"""# Python basics
- Loops
    ```python
    # not a heading
    for n in nums:
    {A} if n > 1:
    {A} {A} print(n >> 1, "{{{{x}}}}")
    ```
        What prints for [1, 2]? >> 4
        {{{{c1::print}}}} writes each value
            deeper <> card
    sibling >> no code
"""


def card_at(doc, text):
    return next(c for c in extract_cards(doc) if text in (c.front or c.cloze_text))


class Pairing(unittest.TestCase):
    def test_closed_block(self):
        lines = ["```rust", "fn main() {}", "```"]
        (b,) = find_code_blocks(lines)
        self.assertEqual((b.open, b.close, b.lang, b.label, b.step), (0, 2, "rust", "Rust", 4))

    def test_unclosed_fence_is_plain_text(self):
        doc = "```js\nQuestion >> Answer\n"
        self.assertEqual(find_code_blocks(doc.split("\n")), [])
        self.assertEqual([c.front for c in extract_cards(doc)], ["Question"])

    def test_language_steps(self):
        for name, step in (("py", 4), ("rs", 4), ("html", 2), ("css", 2), ("js", 2), ("sql", 4)):
            (b,) = find_code_blocks([f"```{name}", "x", "```"])
            self.assertEqual(b.step, step, name)

    def test_fence_with_anchor_still_closes(self):
        lines = ["```py", "x", "```<!--ap:0b7c1d4e-1111-4222-8333-944455556666-->"]
        self.assertEqual(len(find_code_blocks(lines)), 1)


class Cards(unittest.TestCase):
    def test_nothing_inside_a_block_is_a_card(self):
        fronts = [c.front or c.cloze_text for c in extract_cards(DOC)]
        self.assertFalse(any("print(n" in f for f in fronts))
        self.assertEqual(len(fronts), 4)

    def test_every_card_type_under_the_block_gets_the_code(self):
        for text in ("What prints", "c1::print", "deeper"):
            ctx = get_context_heading(DOC, card_at(DOC, text).line_index)
            self.assertIn('class="ap-crumb-code"', ctx, text)
            self.assertIn("Loops", ctx)
            self.assertIn("Python basics", ctx)

    def test_sibling_of_the_block_does_not(self):
        ctx = get_context_heading(DOC, card_at(DOC, "sibling").line_index)
        self.assertNotIn("ap-crumb-code", ctx)

    def test_python_comment_is_not_a_heading(self):
        ctx = get_context_heading(DOC, card_at(DOC, "What prints").line_index)
        self.assertNotIn("ap-crumb-h", ctx.split("ap-crumb-code")[1])
        self.assertIn('ap-crumb-h1">Python basics', ctx)

    def test_arrows_become_indentation_and_braces_are_safe(self):
        ctx = get_context_heading(DOC, card_at(DOC, "What prints").line_index)
        self.assertNotIn(A, ctx)
        self.assertIn("\n        <span", ctx)  # two ➵ -> eight spaces
        self.assertNotIn("{{", ctx)  # the card's cloze pass can't match code
        self.assertNotIn("\u2192", ctx.split("ap-crumb-code")[1])  # >> stays >>

    def test_blank_line_before_card_is_fine(self):
        doc = "- t\n    ```py\n    x\n    ```\n\n        Q >> A\n"
        ctx = get_context_heading(doc, card_at(doc, "Q").line_index)
        self.assertIn("ap-crumb-code", ctx)


class Conversions(unittest.TestCase):
    def test_round_trip(self):
        md = "- t\n    ```python\n    for n in x:\n        if n:\n            print(n)\n    ```\n"
        papered = arrows_from_spaces(md)
        self.assertIn(f"    {A} if n:", papered)
        self.assertIn(f"    {A}{A} print(n)", papered)
        self.assertEqual(expand_arrows_in_markdown(papered), md)

    def test_two_space_html(self):
        md = "```html\n<ul>\n  <li>a</li>\n</ul>\n```"
        self.assertIn(f"{A} <li>a</li>", arrows_from_spaces(md))


class Highlight(unittest.TestCase):
    def classes(self, code, lang):
        return [(c, t) for c, t in highlight_tokens(code, lang) if c]

    def test_python(self):
        toks = self.classes('def f(x):  # hi\n    return "s"', "python")
        self.assertIn(("kw", "def"), toks)
        self.assertIn(("fn", "f"), toks)
        self.assertIn(("com", "# hi"), toks)
        self.assertIn(("str", '"s"'), toks)

    def test_rust(self):
        toks = self.classes('let s = String::from("a"); println!("{}", s);', "rust")
        self.assertIn(("type", "String"), toks)
        self.assertIn(("fn", "println!"), toks)

    def test_css_and_html(self):
        css = self.classes("a:hover { color: #fff; }", "css")
        self.assertIn(("tag", "a"), css)
        self.assertIn(("prop", "color"), css)
        html = self.classes('<a href="x">say "hi"</a>', "html")
        self.assertIn(("attr", "href"), html)
        self.assertNotIn(("str", '"hi"'), html)


if __name__ == "__main__":
    unittest.main()
