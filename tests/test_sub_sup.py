"""Subscript / superscript are stored as <sub>/<sup> HTML tags.

The card parser splits a basic card at its first ">>". A closing tag written
flush against the separator ("CO<sub>2</sub>>> a gas") puts a ">" right before
it, so a naive split lands one character early. These tests pin that down.

Run with:  python3 -m unittest discover -s tests
"""
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


import os
# AP_PARSER_PATH lets the same tests run against another copy, e.g. the
# installed add-on's parser.py.
parser = _load(os.environ.get("AP_PARSER_PATH") or ROOT / "core" / "parser.py", "ap_parser_under_test")


class BasicCardSplit(unittest.TestCase):
    def card(self, line):
        parsed = parser.parse_line(0, line)
        return parsed.line_type, (parsed.card.front if parsed.card else None), (parsed.card.back if parsed.card else None)

    def test_tag_flush_against_separator(self):
        self.assertEqual(self.card("CO<sub>2</sub>>> a gas"), ("basic", "CO<sub>2</sub>", "a gas"))

    def test_sup_flush_against_separator(self):
        self.assertEqual(self.card("x<sup>2</sup>>> x squared"), ("basic", "x<sup>2</sup>", "x squared"))

    def test_tag_with_space_before_separator(self):
        self.assertEqual(self.card("H<sub>2</sub>O >> water"), ("basic", "H<sub>2</sub>O", "water"))

    def test_tags_in_answer(self):
        self.assertEqual(self.card("Sodium ion >> Na<sup>+</sup>"), ("basic", "Sodium ion", "Na<sup>+</sup>"))

    def test_plain_card_unchanged(self):
        self.assertEqual(self.card("Question >> Answer"), ("basic", "Question", "Answer"))

    def test_closing_tag_then_greater_than_is_not_a_card(self):
        # "</sub>" followed by a literal ">" must not be read as a ">>" separator.
        kind, _, _ = self.card("x<sub>2</sub>> 3 is true")
        self.assertNotEqual(kind, "basic")

    def test_underline_flush_against_separator(self):
        self.assertEqual(self.card("<u>Insulin</u>>> lowers glucose"), ("basic", "<u>Insulin</u>", "lowers glucose"))

    def test_underline_with_space_before_separator(self):
        self.assertEqual(self.card("The <u>key</u> point >> answer"), ("basic", "The <u>key</u> point", "answer"))

    def test_underline_closing_tag_then_greater_than_is_not_a_card(self):
        kind, _, _ = self.card("<u>x</u>> 3 is true")
        self.assertNotEqual(kind, "basic")

    def test_bold_flush_against_separator(self):
        self.assertEqual(self.card("<b>ALF</b>>> acute liver failure"), ("basic", "<b>ALF</b>", "acute liver failure"))

    def test_italic_flush_against_separator(self):
        self.assertEqual(self.card("<i>E. coli</i>>> gram negative"), ("basic", "<i>E. coli</i>", "gram negative"))

    def test_bold_closing_tag_then_greater_than_is_not_a_card(self):
        kind, _, _ = self.card("<b>x</b>> 3 is true")
        self.assertNotEqual(kind, "basic")

    def test_reversible_with_tags(self):
        self.assertEqual(self.card("H<sub>2</sub>O<> water"), ("reversible", "H<sub>2</sub>O", "water"))


if __name__ == "__main__":
    unittest.main()
