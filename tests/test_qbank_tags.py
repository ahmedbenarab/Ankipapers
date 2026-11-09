"""Question-bank tags: <!--uw:3252--> on a heading tags every card under it.

The ids live in a hidden comment on the heading (core/qbank.py). Every card
the heading folds over gets "<prefix>::<id>" in Anki, kept in step with the
paper on every Generate -- including cards whose own text never changed,
which an id added to a heading does not touch. The prefix comes from the
paper, else the nearest folder, else Settings.

Run with:  python3 -m unittest discover -s tests
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
import core.card_manager as cm  # noqa: E402
from core import qbank  # noqa: E402
from core.paper import Paper  # noqa: E402
from core.parser import extract_cards  # noqa: E402
from core.storage import prune_folder_dir  # noqa: E402
from test_no_heading import FakeCol  # noqa: E402

DOC = """# Cardiology<!--uw:111-->
    ## Hypertrophic cardiomyopathy<!--uw:3252,4410-->
        Septal thickness >= 15 mm >> HCM

        Most common cause of sudden death in young athletes >> HCM
    Murmur louder with Valsalva >> HCM
## Same-level heading<!--uw:999-->
Not indented under it >> no tags
"""


def _notes_by_front(col):
    return {n.fields[0]: n for n in col.notes.values()}


class Parsing(unittest.TestCase):
    def setUp(self):
        self.cards = {c.front: c for c in extract_cards(DOC)}

    def test_cards_inherit_every_parents_ids(self):
        self.assertEqual(self.cards["Septal thickness >= 15 mm"].qbank_ids, ["3252", "4410", "111"])
        self.assertEqual(self.cards["Most common cause of sudden death in young athletes"].qbank_ids,
                         ["3252", "4410", "111"])
        self.assertEqual(self.cards["Murmur louder with Valsalva"].qbank_ids, ["111"])

    def test_children_follow_the_folding_rule(self):
        # Not indented under the heading, so not folded by it: no ids.
        self.assertEqual(self.cards["Not indented under it"].qbank_ids, [])

    def test_ids_never_reach_card_text(self):
        for c in extract_cards("# H\n    Q >> A<!--uw:5-->"):
            self.assertEqual((c.front, c.back), ("Q", "A"))

    def test_ids_parse_with_commas_or_spaces(self):
        self.assertEqual(qbank.qbank_ids_in("## X<!--uw:1, 2 3,2-->"), ["1", "2", "3"])


class Generating(unittest.TestCase):
    def setUp(self):
        self.col = FakeCol()
        self.paper = Paper(title="Cards", content=DOC)
        cm.generate_cards(self.paper, self.col)
        self.notes = _notes_by_front(self.col)
        self.septal = self.notes["Septal thickness >= 15 mm"]

    def test_new_cards_are_tagged(self):
        self.assertIn("UWorldABIM::3252", self.septal.tags)
        self.assertIn("UWorldABIM::4410", self.septal.tags)
        self.assertIn("UWorldABIM::111", self.septal.tags)
        self.assertNotIn("UWorldABIM::3252", self.notes["Murmur louder with Valsalva"].tags)

    def test_breadcrumb_hides_the_comment(self):
        self.assertNotIn("uw:", self.septal.fields[2])
        self.assertIn("Hypertrophic cardiomyopathy", self.septal.fields[2])

    def test_adding_an_id_to_a_heading_tags_existing_cards(self):
        self.paper.content = self.paper.content.replace("<!--uw:3252,4410-->", "<!--uw:3252,4410,7777-->")
        created, updated, deleted = cm.generate_cards(self.paper, self.col)
        self.assertEqual((created, deleted), (0, 0))
        self.assertEqual(updated, 2)  # the two cards under that heading
        self.assertIn("UWorldABIM::7777", self.septal.tags)

    def test_removing_an_id_untags_and_keeps_other_tags(self):
        self.septal.tags += ["my_own_tag", "MKSAP::12"]
        self.paper.content = self.paper.content.replace("<!--uw:3252,4410-->", "<!--uw:4410-->")
        cm.generate_cards(self.paper, self.col)
        self.assertNotIn("UWorldABIM::3252", self.septal.tags)
        self.assertIn("UWorldABIM::4410", self.septal.tags)
        self.assertIn("my_own_tag", self.septal.tags)
        self.assertIn("MKSAP::12", self.septal.tags)

    def test_a_second_generate_is_quiet(self):
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))

    def test_adding_an_id_does_not_rewrite_the_context(self):
        before = self.septal.fields[2]
        self.paper.content = self.paper.content.replace("<!--uw:3252,4410-->", "<!--uw:3252-->")
        cm.generate_cards(self.paper, self.col)
        self.assertEqual(self.septal.fields[2], before)

    def test_prefix_is_used(self):
        col = FakeCol()
        cm.generate_cards(Paper(title="M", content=DOC), col, qbank_prefix="MKSAP")
        self.assertIn("MKSAP::3252", _notes_by_front(col)["Septal thickness >= 15 mm"].tags)


class Prefixes(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)

    def test_paper_then_nearest_folder_then_settings(self):
        os.makedirs(os.path.join(self.root, "ABIM", "Cardio"))
        qbank.set_folder_prefix(self.root, "ABIM", "UWorldABIM")
        self.assertEqual(qbank.resolve_prefix("", self.root, "ABIM/Cardio", "Other"), "UWorldABIM")
        self.assertEqual(qbank.resolve_prefix("MKSAP", self.root, "ABIM/Cardio", "Other"), "MKSAP")
        self.assertEqual(qbank.resolve_prefix("", self.root, "", "Other"), "Other")
        self.assertEqual(qbank.resolve_prefix("", self.root, "", ""), qbank.DEFAULT_PREFIX)

    def test_clearing_a_folder_prefix_removes_its_file(self):
        os.makedirs(os.path.join(self.root, "F"))
        qbank.set_folder_prefix(self.root, "F", "Board Vitals")
        self.assertEqual(qbank.get_folder_prefix(self.root, "F"), "Board_Vitals")
        qbank.set_folder_prefix(self.root, "F", "")
        self.assertFalse(os.path.exists(os.path.join(self.root, "F", qbank.FOLDER_SETTINGS_NAME)))

    def test_a_folder_holding_only_its_settings_is_empty(self):
        os.makedirs(os.path.join(self.root, "F"))
        qbank.set_folder_prefix(self.root, "F", "X")
        self.assertTrue(prune_folder_dir("F", self.root))
        self.assertFalse(os.path.exists(os.path.join(self.root, "F")))


JS = """
import { stripQbankComments, qbankIdsIn, findQbankShortcut, addQbankIds } from %s
console.log(JSON.stringify({
  strip: stripQbankComments('## HCM<!--uw:3252-->'),
  ids: qbankIdsIn('## HCM<!--uw:3252,4410-->'),
  hit: findQbankShortcut('## HCM uw3252'),
  hitMany: findQbankShortcut('## HCM uw3252,4410'),
  noHit: findQbankShortcut('## Kuwait3252'),
  add: addQbankIds('    ## HCM', ['3252']),
  merge: addQbankIds('    ## HCM<!--uw:3252-->', ['4410', '3252']),
}))
""" % json.dumps((ROOT / "web_src" / "src" / "qbankTags.js").as_uri())


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EditorHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", JS],
                             capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def test_strip_and_read(self):
        self.assertEqual(self.r["strip"], "## HCM")
        self.assertEqual(self.r["ids"], ["3252", "4410"])

    def test_shortcut(self):
        self.assertEqual(self.r["hit"], {"start": 6, "ids": ["3252"]})
        self.assertEqual(self.r["hitMany"]["ids"], ["3252", "4410"])
        self.assertIsNone(self.r["noHit"])

    def test_adding_merges_into_one_comment(self):
        self.assertEqual(self.r["add"], "    ## HCM<!--uw:3252-->")
        self.assertEqual(self.r["merge"], "    ## HCM<!--uw:3252,4410-->")


if __name__ == "__main__":
    unittest.main()
