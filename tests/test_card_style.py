"""The "Solarized Styling" card style option (Settings → Card style).

Card styling lives on the three Anki Papers note types. The chosen style is
written onto all three whenever note types are ensured (every Generate, and
when the setting changes), so switching restyles every existing card at once.

Run with:  python3 -m unittest discover -s tests
"""
import copy
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.card_manager as cm  # noqa: E402

NAMES = ("AnkiPapers Basic", "AnkiPapers Reversible", "AnkiPapers Cloze")
FIELDS = ["Front", "Back", "Text", "Context", "AnkiPapers_Source", "Supplement"]


class FakeModels:
    """Just enough of col.models for ensure_note_types on existing types."""
    def __init__(self):
        self.models = {
            n: {"name": n, "css": "old", "flds": [{"name": f} for f in FIELDS],
                "tmpls": [{"qfmt": "", "afmt": ""}, {"qfmt": "", "afmt": ""}]}
            for n in NAMES
        }
        self.saved = []

    def by_name(self, name):
        return self.models.get(name)

    def save(self, model):
        self.saved.append(model["name"])

    def __getattr__(self, name):  # anything that would create/alter structure
        raise AssertionError(f"unexpected col.models.{name} call")


class FakeCol:
    def __init__(self):
        self.models = FakeModels()


class CardCss(unittest.TestCase):
    def test_basic_is_the_builtin_stylesheet_unchanged(self):
        self.assertEqual(cm.card_css("basic"), cm._ANKIPAPERS_CSS)

    def test_solarized_layers_on_top_of_basic(self):
        css = cm.card_css("solarized")
        self.assertTrue(css.startswith(cm._ANKIPAPERS_CSS))
        self.assertIn("--ap-bg", css)
        self.assertIn(".card.nightMode", css)          # dark version in dark mode
        self.assertGreater(len(css), len(cm._ANKIPAPERS_CSS))

    def test_unknown_or_missing_style_falls_back_to_basic(self):
        for s in (None, "", "nope", "SOLARIZED "):
            self.assertEqual(cm.card_css(s), cm._ANKIPAPERS_CSS if s != "SOLARIZED " else cm.card_css("solarized"))


class EnsureNoteTypes(unittest.TestCase):
    def test_style_is_written_to_all_three_note_types(self):
        for style in ("solarized", "basic"):
            col = FakeCol()
            cm.ensure_note_types(col, style)
            for n in NAMES:
                self.assertEqual(col.models.models[n]["css"], cm.card_css(style), (style, n))
            self.assertEqual(sorted(col.models.saved), sorted(NAMES))

    def test_default_is_basic(self):
        col = FakeCol()
        cm.ensure_note_types(col)
        self.assertEqual(col.models.models["AnkiPapers Basic"]["css"], cm._ANKIPAPERS_CSS)

    def test_switching_back_restores_basic_exactly(self):
        col = FakeCol()
        cm.ensure_note_types(col, "solarized")
        cm.ensure_note_types(col, "basic")
        for n in NAMES:
            self.assertEqual(col.models.models[n]["css"], cm._ANKIPAPERS_CSS)



class ColorSchemes(unittest.TestCase):
    """Settings → Color scheme also colors the Basic card style. Carolina is
    the base stylesheet itself; the others layer on top of it; Solarized comes
    last so it looks the same in every scheme."""

    def test_carolina_is_the_base_stylesheet(self):
        self.assertEqual(cm.card_css("basic", "carolina"), cm._ANKIPAPERS_CSS)

    def test_other_schemes_layer_after_the_base(self):
        for scheme, layer in (("purple", cm._PURPLE_CSS), ("mono", cm._MONO_CSS),
                              ("crimson", cm._CRIMSON_CSS)):
            css = cm.card_css("basic", scheme)
            self.assertEqual(css, cm._ANKIPAPERS_CSS + layer, scheme)

    def test_purple_restores_the_original_colors(self):
        css = cm.card_css("basic", "purple")
        for color in ("#6c5ce7", "#4169E1", "#123a8a", "#7aa7ff"):
            self.assertIn(color, css)

    def test_mono_keeps_the_answer_colors(self):
        # Grayscale chrome, but the card-type colors come from the base sheet.
        self.assertNotIn("ap-answer-basic", cm._MONO_CSS)
        self.assertNotIn("ap-answer-reversible", cm._MONO_CSS)
        self.assertNotIn(".cloze", cm._MONO_CSS)

    def test_crimson_moves_cloze_and_links_off_red(self):
        # Cloze becomes violet and links blue in day and night mode, so
        # neither blends into the crimson; basic / reversible stay as they are.
        for color in ("#7a3fb8", "#c4a5f5", "#1d5fbf", "#7fb2ff"):
            self.assertIn(color, cm._CRIMSON_CSS)
        self.assertNotIn("ap-answer-basic", cm._CRIMSON_CSS)
        self.assertNotIn("ap-answer-reversible", cm._CRIMSON_CSS)

    def test_solarized_layers_its_scheme_palette_last(self):
        for scheme in cm.COLOR_SCHEMES:
            css = cm.card_css("solarized", scheme)
            expected = (cm._ANKIPAPERS_CSS + cm._SCHEME_CSS[scheme] + "\n"
                        + cm._SOLARIZED_CSS + cm._SOLARIZED_PALETTES[scheme])
            self.assertEqual(css, expected, scheme)

    def test_purple_solarized_is_the_classic_solarized(self):
        # The original scheme keeps the original Solarized palette untouched.
        self.assertEqual(cm._SOLARIZED_PALETTES["purple"], "")
        self.assertTrue(cm.card_css("solarized", "purple").endswith(cm._SOLARIZED_CSS))

    def test_each_solarized_palette_sets_day_and_night(self):
        for scheme in ("carolina", "crimson", "mono"):
            pal = cm._SOLARIZED_PALETTES[scheme]
            self.assertIn(".card {", pal, scheme)
            self.assertIn(cm._SOLARIZED_NIGHT + " {", pal, scheme)
            for var in ("--ap-bg", "--ap-fg", "--ap-bold", "--ap-cloze", "--ap-rev", "--ap-link"):
                self.assertEqual(pal.count(var + ":"), 2, (scheme, var))

    def test_classic_solarized_slots_default_to_its_own_colors(self):
        # Cloze stays green, reversible answers and links blue, underline
        # colored rather than drawn, unless a palette re-points them.
        for decl in ("--ap-cloze: var(--ap-green)", "--ap-rev: var(--ap-blue)",
                     "--ap-link: var(--ap-blue)", "--ap-u-deco: none"):
            self.assertIn(decl, cm._SOLARIZED_CSS)

    def test_carolina_and_crimson_solarized_have_dark_day_breadcrumbs(self):
        self.assertIn("--ap-crumb: var(--ap-muted)", cm._SOLARIZED_CSS)  # classic unchanged
        for scheme, day in (("carolina", "#19468D"), ("crimson", "#7A1426")):
            pal = cm._SOLARIZED_PALETTES[scheme]
            day_block, night_block = pal.split(cm._SOLARIZED_NIGHT)
            self.assertIn(f"--ap-crumb: {day};", day_block, scheme)
            # Night sets its own (soft) crumb so the dark day color can't carry over.
            self.assertIn("--ap-crumb:", night_block, scheme)
            self.assertNotIn(day, night_block, scheme)

    def test_carolina_and_crimson_solarized_day_is_black_on_white(self):
        for scheme in ("carolina", "crimson"):
            day_block = cm._SOLARIZED_PALETTES[scheme].split(cm._SOLARIZED_NIGHT)[0]
            self.assertIn("--ap-bg: #FFFFFF;", day_block, scheme)
            self.assertIn("--ap-fg: #000000;", day_block, scheme)

    def test_basic_text_is_black_in_carolina_and_crimson_only(self):
        self.assertIn("color: #000000;", cm._ANKIPAPERS_CSS.split(".ankipapers-card {")[1].split("}")[0])
        # Crimson has no day-mode text rule of its own, so it inherits black.
        self.assertNotIn("\n.ankipapers-card { color:", cm._CRIMSON_CSS)
        for layer in (cm._PURPLE_CSS, cm._MONO_CSS):                     # keep dark navy
            self.assertIn("\n.ankipapers-card { color: #1a1a2e; }", layer)

    def test_mono_solarized_draws_a_real_underline(self):
        self.assertIn("--ap-u-deco: underline", cm._SOLARIZED_PALETTES["mono"])

    def test_unknown_scheme_falls_back_to_carolina(self):
        for scheme in (None, "", "nope"):
            self.assertEqual(cm.card_css("basic", scheme), cm._ANKIPAPERS_CSS)
        self.assertEqual(cm.card_css("basic", " PURPLE "), cm.card_css("basic", "purple"))

    def test_scheme_is_written_to_all_three_note_types(self):
        col = FakeCol()
        cm.ensure_note_types(col, "basic", "mono")
        for n in NAMES:
            self.assertEqual(col.models.models[n]["css"], cm.card_css("basic", "mono"))


if __name__ == "__main__":
    unittest.main()
