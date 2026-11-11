"""Question tags: <!--uw::3252--> on a line tags its cards from the Tag Shortcuts.

"uw" is a shortcut in Settings -> Cards -> Tag Shortcuts. At Generate it is
swapped for its tag and the rest is kept: uw -> UWorldABIM makes
UWorldABIM::3252. Every card under the line gets it too, kept in step with
the paper on every Generate -- including cards whose own text never changed.
The table is one-to-one both ways; a paper or folder may give a shortcut its
own tag; a renamed tag moves the cards off the old name; a shortcut not in
the table tags nothing and its lines are reported (core/qbank.py).

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

DOC = """# Cardiology<!--uw::111-->
    ## Hypertrophic cardiomyopathy<!--uw::3252,4410--><!--ab::L22-->
        Septal thickness >= 15 mm >> HCM

        Most common cause of sudden death in young athletes >> HCM
    Murmur louder with Valsalva >> HCM
## Same-level heading<!--uw::999-->
Not indented under it >> no tags
"""

TABLE = {"uw": "UWorldABIM", "ab": "AMBOSS"}


def _notes_by_front(col):
    return {n.fields[0]: n for n in col.notes.values()}


def _rows(*pairs):
    return [{"shortcut": s, "tag": t, "old": []} for s, t in pairs]


class Parsing(unittest.TestCase):
    def setUp(self):
        self.cards = {c.front: c for c in extract_cards(DOC)}

    def test_cards_inherit_every_parents_marks(self):
        self.assertEqual(self.cards["Septal thickness >= 15 mm"].tag_marks,
                         ["uw::3252", "uw::4410", "ab::L22", "uw::111"])
        self.assertEqual(self.cards["Murmur louder with Valsalva"].tag_marks, ["uw::111"])

    def test_children_follow_the_folding_rule(self):
        self.assertEqual(self.cards["Not indented under it"].tag_marks, [])

    def test_marks_never_reach_card_text(self):
        for c in extract_cards("# H\n    Q >> A<!--uw::5-->"):
            self.assertEqual((c.front, c.back), ("Q", "A"))

    def test_values_parse_with_commas_or_spaces_and_keep_deeper_levels(self):
        self.assertEqual(qbank.tag_marks_in("## X<!--UW::1, 2 3,2--><!--uw::Cardio::7-->"),
                         ["uw::1", "uw::2", "uw::3", "uw::Cardio::7"])

    def test_the_single_colon_form_is_not_a_mark(self):
        # The old <!--uw:3252--> is gone, and flag / anchor comments use one colon.
        self.assertEqual(qbank.tag_marks_in("## X<!--uw:3252--><!--flag:red--><!--ap:abc-->"), [])

    def test_shortcut_swapped_for_its_tag(self):
        self.assertEqual(qbank.question_tags(["uw::2434", "uw::Cardio::7", "zz::1"], TABLE),
                         ["UWorldABIM::2434", "UWorldABIM::Cardio::7"])


class Generating(unittest.TestCase):
    def setUp(self):
        self.col = FakeCol()
        self.paper = Paper(title="Cards", content=DOC)
        self.generate()
        self.notes = _notes_by_front(self.col)
        self.septal = self.notes["Septal thickness >= 15 mm"]

    def generate(self, table=TABLE, heads=None):
        self.report = {}
        return cm.generate_cards(self.paper, self.col, tag_table=table, tag_heads=heads, report=self.report)

    def test_new_cards_are_tagged(self):
        for tag in ("UWorldABIM::3252", "UWorldABIM::4410", "UWorldABIM::111", "AMBOSS::L22"):
            self.assertIn(tag, self.septal.tags)
        self.assertNotIn("UWorldABIM::3252", self.notes["Murmur louder with Valsalva"].tags)

    def test_breadcrumb_hides_the_comment(self):
        self.assertNotIn("uw::", self.septal.fields[2])
        self.assertIn("Hypertrophic cardiomyopathy", self.septal.fields[2])

    def test_adding_an_id_to_a_heading_tags_existing_cards(self):
        self.paper.content = self.paper.content.replace("<!--uw::3252,4410-->", "<!--uw::3252,4410,7777-->")
        created, updated, deleted = self.generate()
        self.assertEqual((created, deleted), (0, 0))
        self.assertEqual(updated, 2)  # the two cards under that heading
        self.assertIn("UWorldABIM::7777", self.septal.tags)

    def test_removing_an_id_untags_and_keeps_other_tags(self):
        self.septal.tags += ["my_own_tag", "MKSAP::12"]
        self.paper.content = self.paper.content.replace("<!--uw::3252,4410-->", "<!--uw::4410-->")
        self.generate()
        self.assertNotIn("UWorldABIM::3252", self.septal.tags)
        self.assertIn("UWorldABIM::4410", self.septal.tags)
        self.assertIn("my_own_tag", self.septal.tags)
        self.assertIn("MKSAP::12", self.septal.tags)

    def test_a_second_generate_is_quiet(self):
        self.assertEqual(self.generate(), (0, 0, 0))
        self.assertEqual(self.report["unknown_tag_lines"], [])

    def test_a_renamed_tag_moves_the_cards(self):
        rows = [{"shortcut": "uw", "tag": "UWorld", "old": ["UWorldABIM"]}, {"shortcut": "ab", "tag": "AMBOSS"}]
        table, heads = qbank.resolve_table(rows, [])
        self.generate(table, heads)
        self.assertIn("UWorld::3252", self.septal.tags)
        self.assertFalse([t for t in self.septal.tags if t.startswith("UWorldABIM::")])
        self.assertIn("AMBOSS::L22", self.septal.tags)

    def test_a_shortcut_not_in_the_table_tags_nothing_and_is_reported(self):
        self.generate({"uw": "UWorldABIM"}, ["UWorldABIM"])
        self.assertIn("AMBOSS::L22", self.septal.tags)   # not a name this table keeps in step
        self.assertIn("UWorldABIM::3252", self.septal.tags)
        self.assertEqual(self.report["unknown_tag_lines"], ["Hypertrophic cardiomyopathy"])
        col = FakeCol()
        cm.generate_cards(Paper(title="N", content=DOC), col, tag_table={"uw": "UWorldABIM"})
        self.assertNotIn("AMBOSS::L22", _notes_by_front(col)["Septal thickness >= 15 mm"].tags)

    def test_the_default_table_is_uw(self):
        col = FakeCol()
        cm.generate_cards(Paper(title="D", content="# H<!--uw::5-->\n    Q >> A"), col)
        self.assertIn("UWorldABIM::5", _notes_by_front(col)["Q"].tags)


class Table(unittest.TestCase):
    def test_one_to_one_both_ways(self):
        self.assertIsNone(qbank.table_problem(_rows(("uw", "UWorldABIM"), ("ab", "AMBOSS"))))
        self.assertIn("used twice", qbank.table_problem(_rows(("uw", "A"), ("UW", "B"))))
        self.assertIn("only one shortcut", qbank.table_problem(_rows(("uw", "A"), ("ab", "a"))))
        self.assertIn("inside one another", qbank.table_problem(_rows(("uw", "UWorld"), ("ab", "UWorld::ABIM"))))

    def test_names_that_mean_something_else(self):
        for sc in ("flag", "AP", "nh", "c1", "C12"):
            self.assertIn("is taken", qbank.table_problem(_rows((sc, "X"))), sc)
        self.assertIn("can't be a shortcut", qbank.table_problem(_rows(("u w", "X"))))
        self.assertIn("can't be a shortcut", qbank.table_problem(_rows(("3uw", "X"))))
        self.assertIn("needs a tag", qbank.table_problem(_rows(("uw", ""))))

    def test_config_before_the_table_becomes_the_uw_row(self):
        self.assertEqual(qbank.shortcut_rows({"qbank_tag_prefix": "My Bank"}),
                         [{"shortcut": "uw", "tag": "My_Bank", "old": []}])
        self.assertEqual(qbank.shortcut_rows({})[0]["tag"], "UWorldABIM")

    def test_an_old_name_now_live_is_forgotten(self):
        rows = qbank.shortcut_rows({"tag_shortcuts": [
            {"shortcut": "uw", "tag": "UWorld", "old": ["UWorldABIM", "AMBOSS"]},
            {"shortcut": "ab", "tag": "AMBOSS"}]})
        self.assertEqual(rows[0]["old"], ["UWorldABIM"])


class Overrides(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        self.rows = _rows(("uw", "UWorldABIM"), ("ab", "AMBOSS"))

    def test_paper_then_nearest_folder_then_settings(self):
        os.makedirs(os.path.join(self.root, "Step1", "Cardio"))
        qbank.set_folder_overrides(self.root, "Step1", {"tags": {"uw": "UWorld_Step1"}})
        layers = qbank.folder_layers(self.root, "Step1/Cardio")
        table, heads = qbank.resolve_table(self.rows, layers)
        self.assertEqual(table, {"uw": "UWorld_Step1", "ab": "AMBOSS"})
        self.assertIn("UWorldABIM", heads)   # cards there move off the Settings tag
        table, _ = qbank.resolve_table(self.rows, layers + [{"tags": {"uw": "Mine"}}])
        self.assertEqual(table["uw"], "Mine")
        self.assertEqual(qbank.resolve_table(self.rows, [])[0]["uw"], "UWorldABIM")

    def test_an_override_must_keep_the_table_one_to_one(self):
        self.assertIn("only one shortcut", qbank.overrides_problem(self.rows, [{"tags": {"uw": "AMBOSS"}}]))
        self.assertIn("isn't in your Tag Shortcuts", qbank.overrides_problem(self.rows, [{"tags": {"zz": "Z"}}]))
        self.assertIsNone(qbank.overrides_problem(self.rows, [{"tags": {"uw": "UWorld_Step1"}}]))
        # One that slipped in anyway (Settings changed later) is skipped.
        table, _ = qbank.resolve_table(self.rows, [{"tags": {"uw": "AMBOSS"}}])
        self.assertEqual(table["uw"], "UWorldABIM")

    def test_a_changed_override_remembers_the_old_tag(self):
        o = qbank.updated_overrides({"tags": {"uw": "UWorld_Step1"}}, {"uw": "UWorld_S1"})
        self.assertEqual(o, {"tags": {"uw": "UWorld_S1"}, "old": ["UWorld_Step1"]})
        o = qbank.updated_overrides(o, {})
        self.assertEqual(o, {"tags": {}, "old": ["UWorld_Step1", "UWorld_S1"]})

    def test_clearing_a_folder_removes_its_file(self):
        os.makedirs(os.path.join(self.root, "F"))
        qbank.set_folder_overrides(self.root, "F", {"tags": {"uw": "Board Vitals"}})
        self.assertEqual(qbank.get_folder_overrides(self.root, "F")["tags"], {"uw": "Board_Vitals"})
        qbank.set_folder_overrides(self.root, "F", {})
        self.assertFalse(os.path.exists(os.path.join(self.root, "F", qbank.FOLDER_SETTINGS_NAME)))

    def test_a_folder_holding_only_its_settings_is_empty(self):
        os.makedirs(os.path.join(self.root, "F"))
        qbank.set_folder_overrides(self.root, "F", {"tags": {"uw": "X"}})
        self.assertTrue(prune_folder_dir("F", self.root))
        self.assertFalse(os.path.exists(os.path.join(self.root, "F")))


JS = """
import { stripTagMarks, tagMarksIn, findTagShortcut, addTagMarks, shortcutTableProblem, rowsToSave } from %s
const T = [{ shortcut: 'uw', tag: 'UWorldABIM' }, { shortcut: 'ab', tag: 'AMBOSS' }]
console.log(JSON.stringify({
  strip: stripTagMarks('## HCM<!--uw::3252--><!--flag:red-->'),
  marks: tagMarksIn('## HCM<!--uw::3252,4410--><!--ab::L1-->'),
  hit: findTagShortcut('## HCM uw::3252', T),
  hitMany: findTagShortcut('## HCM UW::3252,4410', T),
  hitDeep: findTagShortcut('## HCM uw::Cardio::3252', T),
  notInTable: findTagShortcut('## HCM zz::3252', T),
  cpp: findTagShortcut('Use std::vector', T),
  oldForm: findTagShortcut('## HCM uw3252', T),
  cloze: findTagShortcut('The {{c1::LA}}', [{ shortcut: 'c1', tag: 'X' }]),
  add: addTagMarks('    ## HCM', ['uw::3252']),
  merge: addTagMarks('    ## HCM<!--uw::3252-->', ['ab::L1', 'uw::4410', 'uw::3252']),
  dup: shortcutTableProblem([...T, { shortcut: 'UW', tag: 'Other' }]),
  dupTag: shortcutTableProblem([...T, { shortcut: 'nb', tag: 'amboss' }]),
  ok: shortcutTableProblem(T),
  renamed: rowsToSave([{ shortcut: 'uw', tag: 'UWorld', old: [], _key: 0 }, { shortcut: 'ab', tag: 'AMBOSS', _key: 1 }], T),
}))
""" % json.dumps((ROOT / "web_src" / "src" / "qbankTags.js").as_uri())


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EditorHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--input-type=module", "-e", JS], capture_output=True, text=True)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_strip_and_read(self):
        self.assertEqual(self.r["strip"], "## HCM<!--flag:red-->")
        self.assertEqual(self.r["marks"], ["uw::3252", "uw::4410", "ab::L1"])

    def test_shortcut_only_for_rows_in_the_table(self):
        self.assertEqual(self.r["hit"], {"start": 6, "marks": ["uw::3252"]})
        self.assertEqual(self.r["hitMany"]["marks"], ["uw::3252", "uw::4410"])
        self.assertEqual(self.r["hitDeep"]["marks"], ["uw::Cardio::3252"])
        for kind in ("notInTable", "cpp", "oldForm", "cloze"):
            self.assertIsNone(self.r[kind], kind)

    def test_adding_merges_into_one_comment_per_shortcut(self):
        self.assertEqual(self.r["add"], "    ## HCM<!--uw::3252-->")
        self.assertEqual(self.r["merge"], "    ## HCM<!--uw::3252,4410--><!--ab::L1-->")

    def test_table_checks_match_python(self):
        self.assertIn("used twice", self.r["dup"])
        self.assertIn("only one shortcut", self.r["dupTag"])
        self.assertIsNone(self.r["ok"])

    def test_a_renamed_row_remembers_its_old_tag(self):
        self.assertEqual(self.r["renamed"][0], {"shortcut": "uw", "tag": "UWorld", "old": ["UWorldABIM"]})
        self.assertEqual(self.r["renamed"][1]["old"], [])


if __name__ == "__main__":
    unittest.main()
