"""Generate keeps each card in a note of the right type, and a paper is read
from whichever of its two copies was saved last.

Run with:  python3 -m unittest discover -s tests
"""
import os
import pathlib
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.card_manager as cm  # noqa: E402
import core.storage as st  # noqa: E402
from core.paper import Paper  # noqa: E402

from test_no_heading import FakeCol  # noqa: E402


def _only_note(col):
    (note,) = col.notes.values()
    return note


class ChangingACardsType(unittest.TestCase):
    def setUp(self):
        self.col = FakeCol()
        self.paper = Paper(title="Cardio", content="# Heart\nMurmur with Valsalva >> HCM")
        cm.generate_cards(self.paper, self.col)
        self.old = _only_note(self.col)
        self.assertEqual(self.old.model()["name"], "AnkiPapers Basic")

    def _edit(self, old, new):
        # Keep the anchor Generate stamped on the line, as the editor would.
        self.assertIn(old, self.paper.content)
        self.paper.content = self.paper.content.replace(old, new)

    def test_basic_to_cloze_makes_a_cloze_note(self):
        self._edit("Murmur with Valsalva >> HCM", "Murmur with Valsalva: {{c1::HCM}}")
        created, updated, deleted = cm.generate_cards(self.paper, self.col)
        self.assertEqual((created, updated, deleted), (1, 0, 1))
        note = _only_note(self.col)
        self.assertEqual(note.model()["name"], "AnkiPapers Cloze")
        self.assertIn("{{c1::HCM}}", note.fields[0])
        self.assertIn("Heart", note.fields[1])   # the breadcrumb, in Context

    def test_basic_to_reversible_makes_a_reversible_note(self):
        self._edit(">>", "<>")
        self.assertEqual(cm.generate_cards(self.paper, self.col), (1, 0, 1))
        self.assertEqual(_only_note(self.col).model()["name"], "AnkiPapers Reversible")

    def test_the_line_keeps_its_anchor(self):
        anchor = self.paper.card_refs[0].block_id
        self._edit(">>", "<>")
        cm.generate_cards(self.paper, self.col)
        self.assertEqual(self.paper.card_refs[0].block_id, anchor)
        self.assertEqual(self.paper.content.count("<!--ap:"), 1)

    def test_an_edit_that_keeps_the_type_still_updates_in_place(self):
        self._edit("HCM", "hypertrophic cardiomyopathy")
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 1, 0))
        self.assertIs(_only_note(self.col), self.old)


class SourceAndTitleTag(unittest.TestCase):
    def setUp(self):
        self.col = FakeCol()
        self.paper = Paper(title="Heart failure", content="# HF\nFirst-line drug >> ARNI")
        cm.generate_cards(self.paper, self.col)
        self.note = _only_note(self.col)

    def test_a_line_added_above_moves_the_source_without_counting_an_update(self):
        self.paper.content = "Intro line\n" + self.paper.content
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))
        self.assertEqual(self.note.fields[3], f"{self.paper.id}:2")

    def test_the_jump_finds_the_line_before_generate_runs_again(self):
        self.paper.content = "Intro\nMore intro\n" + self.paper.content
        self.assertEqual(cm.current_line_for_note(self.paper, self.note.id), 3)

    def test_the_jump_knows_nothing_of_another_note(self):
        self.assertIsNone(cm.current_line_for_note(self.paper, 999999))

    def test_a_rename_swaps_the_title_tag(self):
        self.assertIn("AnkiPapers::Heart_failure", self.note.tags)
        self.paper.title = "HFrEF"
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))
        self.assertIn("AnkiPapers::HFrEF", self.note.tags)
        self.assertNotIn("AnkiPapers::Heart_failure", self.note.tags)

    def test_other_tags_survive_a_rename(self):
        self.note.tags.append("my_own_tag")
        self.paper.title = "HFrEF"
        cm.generate_cards(self.paper, self.col)
        self.assertIn("my_own_tag", self.note.tags)
        self.assertIn("AnkiPapers", self.note.tags)

    def test_a_paper_from_before_title_tag_gains_the_tag_and_keeps_the_old(self):
        self.paper.title_tag = None
        self.paper.title = "HFrEF"
        cm.generate_cards(self.paper, self.col)
        self.assertIn("AnkiPapers::HFrEF", self.note.tags)
        self.assertIn("AnkiPapers::Heart_failure", self.note.tags)

    def test_title_tag_survives_a_round_trip(self):
        self.assertEqual(Paper.from_dict(self.paper.to_dict()).title_tag, "AnkiPapers::Heart_failure")


class FakeConfigCol:
    def __init__(self):
        self.config = {}
        self.fail_writes = False

    def get_config(self, key):
        return self.config.get(key)

    def set_config(self, key, value):
        import copy
        self.config[key] = copy.deepcopy(value)


class ReadingTheCurrentCopy(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.col = FakeConfigCol()
        self.col.config[st.COLLECTION_MIGRATION_KEY] = True
        patches = [
            mock.patch.object(st, "get_storage_dir", return_value=self.root),
            mock.patch.object(st, "_get_collection", return_value=self.col),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        shutil.rmtree(self.root)

    def _save(self, paper):
        st.save_paper(paper)
        return paper

    def test_a_failed_file_write_does_not_bring_the_old_paper_back(self):
        paper = self._save(Paper(title="HF", content="first"))
        paper.content = "second"
        with mock.patch.object(st, "write_paper_files", side_effect=OSError("locked")):
            st.save_paper(paper)
        self.assertEqual(st.load_paper(paper.id).content, "second")
        self.assertEqual([p.content.strip() for p in st.list_papers()], ["second"])

    def test_the_stale_files_are_rewritten(self):
        paper = self._save(Paper(title="HF", content="first"))
        paper.content = "second"
        with mock.patch.object(st, "write_paper_files", side_effect=OSError("locked")):
            st.save_paper(paper)
        st.load_paper(paper.id)
        md = st.index_papers_on_disk(self.root)[paper.id]
        with open(md, encoding="utf-8") as f:
            self.assertIn("second", f.read())

    def test_files_win_when_both_were_saved_together(self):
        paper = self._save(Paper(title="HF", content="text"))
        # Moved in the file manager: only the files know the new folder.
        os.makedirs(os.path.join(self.root, "Cardio"))
        md = st.index_papers_on_disk(self.root)[paper.id]
        for path in (md, md[:-3] + ".ap.json"):
            shutil.move(path, os.path.join(self.root, "Cardio", os.path.basename(path)))
        self.assertEqual(st.load_paper(paper.id).folder_path, "Cardio")

    def test_papers_saved_before_saved_at_read_from_disk(self):
        paper = self._save(Paper(title="HF", content="on disk"))
        data = self.col.config[st.COLLECTION_PAPERS_KEY][paper.id]
        data.pop("saved_at")
        data["content"] = "collection"
        md = st.index_papers_on_disk(self.root)[paper.id]
        meta = md[:-3] + ".ap.json"
        import json
        with open(meta, encoding="utf-8") as f:
            m = json.load(f)
        m.pop("saved_at")
        with open(meta, "w", encoding="utf-8") as f:
            json.dump(m, f)
        self.assertEqual(st.load_paper(paper.id).content.strip(), "on disk")


if __name__ == "__main__":
    unittest.main()
