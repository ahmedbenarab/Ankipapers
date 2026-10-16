"""[[NH]] — "no heading" — leaves a card's Context field empty.

[[NH]] used to work through a tag plus a script in the question template, and
adding it to a line that already had a card did nothing: [[tags]] are stripped
before content_hash, so Generate saw no change. It is now applied when the
note is written, so adding or removing it is an ordinary paper-side edit.

Run with:  python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.card_manager as cm  # noqa: E402
from core.paper import Paper, CardReference  # noqa: E402
from core.parser import extract_cards  # noqa: E402

NAMES = ("AnkiPapers Basic", "AnkiPapers Reversible", "AnkiPapers Cloze")
FIELD_COUNT = {"AnkiPapers Basic": 5, "AnkiPapers Reversible": 5, "AnkiPapers Cloze": 4}


class FakeNote:
    def __init__(self, model):
        self._model = model
        self.fields = [""] * FIELD_COUNT[model["name"]]
        self.tags = []
        self.id = None

    def model(self):
        return self._model


class FakeModels:
    def __init__(self):
        self.models = {
            n: {"name": n, "css": "", "flds": [{"name": "Supplement"}],
                "tmpls": [{"qfmt": "", "afmt": ""}, {"qfmt": "", "afmt": ""}]}
            for n in NAMES
        }

    def by_name(self, name):
        return self.models.get(name)

    def save(self, model):
        pass


class FakeDecks:
    def by_name(self, name):
        return {"id": 1}


class FakeCol:
    def __init__(self):
        self.models = FakeModels()
        self.decks = FakeDecks()
        self.notes = {}
        self._next = 1000

    def new_note(self, model):
        return FakeNote(model)

    def add_note(self, note, deck_id):
        self._next += 1
        note.id = self._next
        self.notes[note.id] = note

    def get_note(self, nid):
        return self.notes[nid]

    def update_note(self, note):
        self.notes[note.id] = note

    def remove_notes(self, ids):
        for i in ids:
            self.notes.pop(i, None)


PLAIN = "# Information Extraction\n    AI automates {{information extraction}} solutions."
TAGGED = "# Information Extraction\n    AI automates {{information extraction}} solutions. [[NH]]"


def _only_note(col):
    (note,) = col.notes.values()
    return note


class AddingAndRemovingNH(unittest.TestCase):
    def setUp(self):
        self.col = FakeCol()
        self.paper = Paper(title="AI", content=PLAIN)
        cm.generate_cards(self.paper, self.col)
        self.note = _only_note(self.col)
        self.assertIn("Information Extraction", self.note.fields[1])

    def _edit(self, old, new):
        # Keep the anchor Generate stamped on the line, as the editor would.
        self.paper.content = self.paper.content.replace(old, new)

    def test_adding_nh_to_an_existing_card_empties_its_context(self):
        self._edit("solutions.", "solutions. [[NH]]")
        created, updated, deleted = cm.generate_cards(self.paper, self.col)
        self.assertEqual((created, updated, deleted), (0, 1, 0))
        self.assertEqual(self.note.fields[1], "")
        self.assertIn(cm.NO_HEADING_TAG, self.note.tags)

    def test_removing_nh_puts_the_breadcrumb_back_and_drops_the_tag(self):
        self._edit("solutions.", "solutions. [[NH]]")
        cm.generate_cards(self.paper, self.col)
        self._edit(" [[NH]]", "")
        created, updated, deleted = cm.generate_cards(self.paper, self.col)
        self.assertEqual((created, updated, deleted), (0, 1, 0))
        self.assertIn("Information Extraction", self.note.fields[1])
        self.assertNotIn(cm.NO_HEADING_TAG, self.note.tags)

    def test_a_second_generate_is_quiet(self):
        self._edit("solutions.", "solutions. [[NH]]")
        cm.generate_cards(self.paper, self.col)
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))

    def test_lowercase_nh_works_too(self):
        self._edit("solutions.", "solutions. [[nh]]")
        cm.generate_cards(self.paper, self.col)
        self.assertEqual(self.note.fields[1], "")

    def test_other_tags_are_kept_when_nh_comes_off(self):
        self.note.tags.append("my_own_tag")
        self._edit("solutions.", "solutions. [[NH]]")
        cm.generate_cards(self.paper, self.col)
        self._edit(" [[NH]]", "")
        cm.generate_cards(self.paper, self.col)
        self.assertIn("my_own_tag", self.note.tags)

    def test_adding_nh_is_not_reported_as_an_anki_edit_conflict(self):
        self._edit("solutions.", "solutions. [[NH]]")
        self.assertEqual(cm.list_anki_edit_conflicts(self.paper, self.col), [])


class NewCardsWithNH(unittest.TestCase):
    def test_new_card_with_nh_has_empty_context(self):
        col = FakeCol()
        cm.generate_cards(Paper(title="AI", content=TAGGED), col)
        note = _only_note(col)
        self.assertEqual(note.fields[1], "")
        self.assertIn(cm.NO_HEADING_TAG, note.tags)

    def test_basic_card(self):
        col = FakeCol()
        cm.generate_cards(Paper(title="AI", content="# HCM\n    Murmur up with Valsalva >> HCM [[NH]]"), col)
        self.assertEqual(_only_note(col).fields[2], "")


class NotesWrittenByTheOldTemplateScript(unittest.TestCase):
    def test_tagged_note_with_full_context_is_emptied_on_next_generate(self):
        # What the old code left behind: NH tag on the note, the breadcrumb
        # still in the field (hidden only by the template script), and a
        # derived_hash taken from that full breadcrumb.
        col = FakeCol()
        paper = Paper(title="AI", content=PLAIN)
        cm.generate_cards(paper, col)
        note = _only_note(col)
        note.tags.append(cm.NO_HEADING_TAG)
        paper.content = paper.content.replace("solutions.", "solutions. [[NH]]")
        full = paper.card_refs[0].derived_hash
        self.assertTrue(full)

        created, updated, deleted = cm.generate_cards(paper, col)
        self.assertEqual(updated, 1)
        self.assertEqual(note.fields[1], "")


class Templates(unittest.TestCase):
    def test_no_template_hides_context_with_a_script(self):
        col = FakeCol()
        cm.ensure_note_types(col)
        for n in NAMES:
            for t in col.models.models[n]["tmpls"]:
                for side in ("qfmt", "afmt"):
                    html = t[side]
                    if not html:
                        continue
                    self.assertNotIn("<script", html, (n, side))
                    self.assertIn('{{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}', html, (n, side))


class ParserStillStripsTheTag(unittest.TestCase):
    def test_nh_is_not_part_of_the_card_text(self):
        (card,) = extract_cards(TAGGED)
        self.assertNotIn("[[NH]]", card.cloze_text)
        self.assertEqual(card.inline_tags, ["NH"])


if __name__ == "__main__":
    unittest.main()
