"""List cards: a line with "+ " children becomes one note with a card per item.

Each item is a cloze of an "AnkiPapers List" note, so it has its own schedule.
The cloze number is the item's identity in Anki and must follow the item, not
its position, through rewording, reordering, inserting and deleting.

Run with:  python3 -m unittest discover -s tests
The Generating tests need Anki's own Python (they open a real collection):
    "$HOME/Library/Application Support/AnkiProgramFiles/.venv/bin/python" -m unittest tests.test_list_cards
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.card_manager as cm  # noqa: E402
from core.paper import Paper  # noqa: E402
from core.parser import LIST_BLOCK_SUFFIX, LIST_ITEM_PATTERN, extract_cards  # noqa: E402

try:
    from anki.collection import Collection  # noqa: E402
except Exception:  # plain python3, not Anki's
    Collection = None

A1 = "11111111-1111-4111-8111-111111111111"
A2 = "22222222-2222-4222-8222-222222222222"
A3 = "33333333-3333-4333-8333-333333333333"
P = "99999999-9999-4999-8999-999999999999"

EPIDERMIS = """# Skin
Layers of the epidermis, deep to superficial
    + Stratum basale
    + Stratum spinosum
    + Stratum granulosum"""


def _lists(content):
    return [c for c in extract_cards(content) if c.card_type == "list"]


class Parsing(unittest.TestCase):
    def test_plus_children_make_one_list_card(self):
        cards = extract_cards(EPIDERMIS)
        self.assertEqual([c.card_type for c in cards], ["list"])
        (card,) = cards
        self.assertEqual(card.list_prompt, "Layers of the epidermis, deep to superficial")
        self.assertEqual([i.text for i in card.list_items],
                         ["Stratum basale", "Stratum spinosum", "Stratum granulosum"])
        self.assertEqual(card.line_index, 1)

    def test_an_item_is_never_a_card_of_its_own(self):
        cards = extract_cards("Prompt\n    + A >> B\n    + {{C}}\n    + D <> E")
        self.assertEqual([c.card_type for c in cards], ["list"])
        self.assertEqual([i.text for i in cards[0].list_items], ["A >> B", "{{C}}", "D <> E"])

    def test_heading_with_items_written_flush_under_it(self):
        (card,) = _lists("## Branches of the aortic arch\n+ Brachiocephalic\n+ Left common carotid\n+ Left subclavian")
        self.assertEqual(card.list_prompt, "Branches of the aortic arch")
        self.assertEqual(len(card.list_items), 3)

    def test_heading_with_indented_items(self):
        (card,) = _lists("# Arch\n    + One\n    + Two")
        self.assertEqual(card.list_prompt, "Arch")

    def test_a_card_line_with_items_is_both(self):
        cards = extract_cards("Layers of the epidermis >> five, deep to superficial\n    + Basale\n    + Spinosum")
        self.assertEqual([c.card_type for c in cards], ["basic", "list"])
        self.assertEqual(cards[1].list_prompt, "Layers of the epidermis")

    def test_other_children_keep_their_roles(self):
        content = "Prompt\n    + One\n    - a note to self\n    && why it matters\n    + Two"
        cards = extract_cards(content)
        self.assertEqual([c.card_type for c in cards], ["list"])
        self.assertEqual([i.text for i in cards[0].list_items], ["One", "Two"])
        self.assertEqual(cards[0].supplement, "why it matters")

    def test_lines_nested_under_an_item_are_not_items(self):
        (card,) = _lists("Prompt\n    + One\n        + not an item of Prompt\n    + Two")
        self.assertEqual([i.text for i in card.list_items], ["One", "Two"])

    def test_a_single_item_is_a_list(self):
        (card,) = _lists("Prompt\n    + Only")
        self.assertEqual(len(card.list_items), 1)

    def test_plus_needs_a_space_and_text(self):
        self.assertEqual(_lists("Prompt\n    +5 mmHg\n    +"), [])

    def test_inside_a_code_block_is_not_a_list(self):
        self.assertEqual(_lists("Prompt\n    ```\n    + x\n    ```"), [])

    def test_anchors_and_marks_are_read_but_kept_out_of_the_text(self):
        content = (f"Prompt<!--ap:{P}-->\n    + One [[x]]<!--ap:{A1}-->\n"
                   f"    + Two <!--flag:red--><!--ap:{A2}-->")
        (card,) = _lists(content)
        self.assertEqual(card.block_id, P + LIST_BLOCK_SUFFIX)
        self.assertEqual([(i.text, i.block_id) for i in card.list_items], [("One", A1), ("Two", A2)])

    def test_hash_follows_the_items_but_not_their_anchors(self):
        base = _lists("P\n    + One\n    + Two")[0].content_hash
        anchored = _lists(f"P<!--ap:{P}-->\n    + One<!--ap:{A1}-->\n    + Two<!--ap:{A2}-->")[0].content_hash
        self.assertEqual(base, anchored)
        self.assertNotEqual(base, _lists("P\n    + Two\n    + One")[0].content_hash)
        self.assertNotEqual(base, _lists("P\n    + One\n    + Too")[0].content_hash)


def _numbers(items_html):
    return [(a, n) for a, n, _h in cm.list_item_ordinals(items_html)]


def _list(content):
    return _lists(content)[0]


class Numbering(unittest.TestCase):
    def setUp(self):
        self.first, _ = cm.list_items_html(
            _list(f"P\n    + One<!--ap:{A1}-->\n    + Two<!--ap:{A2}-->"))

    def test_a_new_list_counts_from_one(self):
        self.assertEqual(_numbers(self.first), [(A1, 1), (A2, 2)])

    def test_an_inserted_item_gets_a_new_number(self):
        html, nums = cm.list_items_html(
            _list(f"P\n    + One<!--ap:{A1}-->\n    + New<!--ap:{A3}-->\n    + Two<!--ap:{A2}-->"), self.first)
        self.assertEqual(nums, [1, 3, 2])

    def test_a_deleted_number_is_not_reused(self):
        gone, _ = cm.list_items_html(_list(f"P\n    + Two<!--ap:{A2}-->"), self.first)
        self.assertEqual(_numbers(gone), [(A2, 2)])
        _, nums = cm.list_items_html(_list(f"P\n    + Two<!--ap:{A2}-->\n    + Three<!--ap:{A3}-->"), gone)
        self.assertEqual(nums, [2, 3])

    def test_reordering_carries_the_numbers(self):
        _, nums = cm.list_items_html(_list(f"P\n    + Two<!--ap:{A2}-->\n    + One<!--ap:{A1}-->"), self.first)
        self.assertEqual(nums, [2, 1])

    def test_rewording_keeps_the_number(self):
        _, nums = cm.list_items_html(_list(f"P\n    + Uno<!--ap:{A1}-->\n    + Two<!--ap:{A2}-->"), self.first)
        self.assertEqual(nums, [1, 2])

    def test_an_item_without_its_anchor_is_found_by_text(self):
        _, nums = cm.list_items_html(_list("P\n    + Two\n    + One"), self.first)
        self.assertEqual(nums, [2, 1])

    def test_item_text_cannot_break_the_cloze(self):
        html, _ = cm.list_items_html(_list("P\n    + a}}b::c"))
        self.assertEqual(len(re.findall(r"\{\{c\d+::", html)), 1)
        self.assertNotIn("a}}b", html)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class EditorAgrees(unittest.TestCase):
    """The editor (blockFormat.js) calls a line a list item exactly when Generate does."""

    LINES = ["+ Basale", "    + Spinosum", "+Basale", "+ ", "+   x", "- + x", "+ A >> B",
             "+ {{c1::x}}", "+ A <> B", "++ x", "> + x", "+\tTabbed"]

    def test_same_lines_are_items(self):
        # blockFormat.js imports './docLinks' without an extension, as Vite
        # allows; node needs the '.js' spelled out (as in test_replacement_matching).
        js = """
import { registerHooks } from 'node:module'
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx) } catch (e) {
      if (spec.startsWith('.') && !/\\.[a-z]+$/.test(spec)) return next(spec + '.js', ctx)
      throw e
    }
  },
})
const { getBlockType } = await import(%s)
console.log(JSON.stringify(%s.map((l) => getBlockType(l) === 'list-item')))
""" % (json.dumps((ROOT / "web_src" / "src" / "blockFormat.js").as_uri()), json.dumps(self.LINES))
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
        editor = json.loads(out.stdout)
        python = [bool(LIST_ITEM_PATTERN.match(l.strip())) for l in self.LINES]
        self.assertEqual(editor, python)

    DOC = "\n".join([
        "# Skin", "Layers", "    + Basale", "    - note", "    && why", "    + Spinosum",
        "        + nested, not an item", "## Arch", "+ Brachiocephalic", "+ Left carotid",
        "Q >> A", "    + one", "Plain", "+ flush under plain text is not an item",
        "```", "Code", "    + x", "```", "    - Bullet parent", "        + b1",
    ])

    def test_same_lists_and_counts(self):
        from core.parser import list_items_for, parse_document
        parsed = parse_document(self.DOC)
        python = {i: len(list_items_for(parsed, i)) for i in range(len(parsed)) if list_items_for(parsed, i)}
        js = """
import { registerHooks } from 'node:module'
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx) } catch (e) {
      if (spec.startsWith('.') && !/\\.[a-z]+$/.test(spec)) return next(spec + '.js', ctx)
      throw e
    }
  },
})
const { listItemCounts } = await import(%s)
const { codeLineMap } = await import(%s)
const lines = %s
console.log(JSON.stringify(Object.fromEntries(listItemCounts(lines, codeLineMap(lines)))))
""" % (json.dumps((ROOT / "web_src" / "src" / "blockFormat.js").as_uri()),
       json.dumps((ROOT / "web_src" / "src" / "codeBlocks.js").as_uri()), json.dumps(self.DOC.split("\n")))
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
        editor = {int(k): v for k, v in json.loads(out.stdout).items()}
        self.assertEqual(editor, python)
        self.assertEqual(python, {1: 2, 7: 2, 10: 1, 18: 1})


@unittest.skipIf(Collection is None, "needs Anki's Python")
class Generating(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.col = Collection(str(pathlib.Path(self.tmp.name) / "c.anki2"))
        self.paper = Paper(title="Skin", content=EPIDERMIS, deck_name="Skin")

    def tearDown(self):
        self.col.close()
        self.tmp.cleanup()

    def _note(self):
        (ref,) = [r for r in self.paper.card_refs if r.card_type == "list"]
        return self.col.get_note(ref.anki_note_id)

    def _items(self):
        """(item text, its card's ord) in list order."""
        return [(h, n - 1) for _a, n, h in cm.list_item_ordinals(self._note()["Items"])]

    def test_creates_one_note_with_a_card_per_item(self):
        self.assertEqual(cm.generate_cards(self.paper, self.col), (1, 0, 0))
        note = self._note()
        self.assertEqual(note.note_type()["name"], cm.LIST_NOTE_TYPE)
        self.assertEqual(sorted(c.ord for c in note.cards()), [0, 1, 2])
        self.assertEqual(self.col.decks.name(note.cards()[0].did), "Skin")

    def test_parent_and_items_are_anchored_and_second_generate_is_quiet(self):
        cm.generate_cards(self.paper, self.col)
        lines = self.paper.content.split("\n")
        for i in (1, 2, 3, 4):
            self.assertRegex(lines[i], r"<!--ap:[0-9a-f-]{36}-->$", lines[i])
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))

    def test_review_history_stays_with_its_item(self):
        cm.generate_cards(self.paper, self.col)
        spinosum = next(c for c in self._note().cards() if c.ord == 1)
        self.col.sched.set_due_date([spinosum.id], "5")
        # Insert an item at the top, delete the last, reword the middle one.
        lines = self.paper.content.split("\n")
        lines.insert(2, "    + Stratum corneum (wrong place, on purpose)")
        lines = [l for l in lines if "granulosum" not in l]
        lines = [l.replace("Stratum spinosum", "Stratum spinosum (prickle cells)") for l in lines]
        self.paper.content = "\n".join(lines)
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 1, 0))
        items = self._items()
        self.assertEqual([t for t, _o in items],
                         ["Stratum corneum (wrong place, on purpose)", "Stratum basale",
                          "Stratum spinosum (prickle cells)"])
        self.assertEqual([o for _t, o in items], [3, 0, 1])
        cards = {c.ord: c for c in self._note().cards()}
        self.assertEqual(sorted(cards), [0, 1, 3])  # granulosum's card (ord 2) is gone
        self.assertEqual(cards[1].id, spinosum.id)
        self.assertEqual(cards[1].type, 2)  # still a review card

    def test_a_card_line_with_items_gets_two_notes_and_one_anchor(self):
        self.paper.content = "Epidermis >> five layers\n    + Basale\n    + Spinosum"
        self.assertEqual(cm.generate_cards(self.paper, self.col), (2, 0, 0))
        first = self.paper.content.split("\n")[0]
        self.assertEqual(len(re.findall(r"<!--ap:", first)), 1)
        anchor = re.search(r"<!--ap:([0-9a-f-]{36})-->", first).group(1)
        self.assertEqual(sorted(r.block_id for r in self.paper.card_refs),
                         sorted([anchor, anchor + LIST_BLOCK_SUFFIX]))
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))
        self.assertEqual(cm.current_line_for_note(self.paper, self._note().id), 0)

    def test_removing_every_item_removes_the_note(self):
        cm.generate_cards(self.paper, self.col)
        self.paper.content = "\n".join(l for l in self.paper.content.split("\n") if "+ " not in l)
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 1))
        self.assertEqual(self.col.note_count(), 0)


    # ─── Flags, item by item ──────────────────────────────────────────────

    def _flags(self):
        """{item text: its card's flag} for the list note."""
        note = self._note()
        by_ord = {c.ord: c.user_flag() for c in note.cards()}
        return {h: by_ord[n - 1] for _a, n, h in cm.list_item_ordinals(note["Items"])}

    def test_an_items_own_flag_beats_the_lists(self):
        self.paper.content = ("Layers<!--flag:red-->\n    + Basale\n"
                              "    + Spinosum<!--flag:blue-->\n    + Granulosum")
        cm.generate_cards(self.paper, self.col)
        self.assertEqual(self._flags(), {"Basale": 1, "Spinosum": 4, "Granulosum": 1})

    def test_flag_typed_on_one_item_flags_only_that_card(self):
        cm.generate_cards(self.paper, self.col)
        self.paper.content = self.paper.content.replace("Stratum spinosum", "Stratum spinosum<!--flag:orange-->")
        cm.generate_cards(self.paper, self.col)
        self.assertEqual(self._flags(), {"Stratum basale": 0, "Stratum spinosum": 2, "Stratum granulosum": 0})
        self.assertEqual(cm.generate_cards(self.paper, self.col), (0, 0, 0))

    def test_flag_cleared_in_anki_comes_off_the_item_line(self):
        self.paper.content = self.paper.content.replace("Stratum spinosum", "Stratum spinosum<!--flag:red-->")
        cm.generate_cards(self.paper, self.col)
        cid = next(c.id for c in self._note().cards() if self._flags_by_id().get(c.id) == 1)
        self.col.set_user_flag_for_cards(0, [cid])
        report = {}
        cm.generate_cards(self.paper, self.col, report=report)
        self.assertNotIn("flag:red", self.paper.content)
        self.assertEqual(report["unflagged_headings"], ["+ Stratum spinosum"])
        self.assertEqual(self._flags()["Stratum spinosum"], 0)

    def test_an_item_cleared_in_anki_stays_cleared_while_the_list_keeps_its_flag(self):
        self.paper.content = self.paper.content.replace("deep to superficial", "deep to superficial<!--flag:red-->")
        cm.generate_cards(self.paper, self.col)
        basale = next(c.id for c in self._note().cards() if c.ord == 0)
        self.col.set_user_flag_for_cards(0, [basale])
        cm.generate_cards(self.paper, self.col)
        self.assertIn("flag:red", self.paper.content)  # other items still flagged
        self.assertEqual(self._flags(), {"Stratum basale": 0, "Stratum spinosum": 1, "Stratum granulosum": 1})

    def _flags_by_id(self):
        return {c.id: c.user_flag() for c in self._note().cards()}

    def test_item_flags_applied_round_trip_through_the_sidecar(self):
        from core.paper import CardReference
        self.paper.content = self.paper.content.replace("Stratum basale", "Stratum basale<!--flag:green-->")
        cm.generate_cards(self.paper, self.col)
        ref = next(r for r in self.paper.card_refs if r.card_type == "list")
        self.assertEqual(sorted(ref.item_flags_applied.values()), [0, 0, 3])
        again = CardReference.from_dict(ref.to_dict())
        self.assertEqual(again.item_flags_applied, {k: v for k, v in ref.item_flags_applied.items() if v})

    # ─── Review stats, item by item ───────────────────────────────────────

    def test_stats_give_each_item_its_own_numbers(self):
        cm.generate_cards(self.paper, self.col)
        note = self._note()
        spinosum = next(c for c in note.cards() if c.ord == 1)
        spinosum.lapses = 4
        spinosum.flags = 1
        self.col.update_card(spinosum)
        lucidum = next(c for c in note.cards() if c.ord == 2)
        self.col.sched.suspend_cards([lucidum.id])
        stats = cm.note_review_stats(self.col, [note.id])[str(note.id)]
        anchors = {h: a for a, _n, h in cm.list_item_ordinals(note["Items"])}
        items = stats["items"]
        self.assertEqual(set(items), set(anchors.values()))
        self.assertEqual(items[anchors["Stratum spinosum"]]["lapses"], 4)
        self.assertEqual(items[anchors["Stratum spinosum"]]["status"], "weak")
        self.assertEqual(items[anchors["Stratum spinosum"]]["flags"], [1])
        self.assertTrue(items[anchors["Stratum granulosum"]]["suspended"])
        self.assertEqual(items[anchors["Stratum basale"]]["lapses"], 0)
        # The note as a whole still reads as before.
        self.assertEqual((stats["lapses"], stats["cards"], stats["suspended_cards"]), (4, 3, 1))


if __name__ == "__main__":
    unittest.main()
