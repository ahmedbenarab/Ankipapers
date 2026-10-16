"""Search lists each matching line with its Document › H1 › H2 › H3 path.

The path follows the card breadcrumb rule: the nearest H1–H3 above the line
that is a structural parent of it (a later H2 drops an earlier H3), including
the line itself when it is a heading. Headings inside code fences don't count,
and hidden anchors / link targets are never searchable.

Run with:  python3 -m unittest discover -s tests
"""
import importlib.util
import pathlib
import sys
import unittest
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location("ap_search_under_test", ROOT / "core" / "search_query.py")
sq = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = sq
spec.loader.exec_module(sq)

CONTENT = "\n".join([
    "intro mentions calcium",                                  # 0
    "# Endocrinology<!--ap:11111111-1111-1111-1111-111111111111-->",  # 1
    "## Hyperparathyroidism",                                  # 2
    "    Labs: high **calcium** >> yes",                       # 3
    "### Workup",                                              # 4
    "        PTH and calcium",                                 # 5
    "## Hypercalcemia [[NH]]",                                 # 6
    "```",                                                     # 7
    "# calcium comment in code",                               # 8
    "```",                                                     # 9
    "    Treat calcium with fluids",                           # 10
    "see [the page](ap://abc#def)",                            # 11
])


def paper(content=CONTENT, title="Endo"):
    return SimpleNamespace(id="p1", title=title, content=content,
                           folder_path="ABIM", deck_name="D", tags=[])


def lines_for(query, p=None):
    res = sq.search_papers_advanced([p or paper()], query)
    return {h["line"]: h["path"] for h in res[0]["lines"]} if res else None


class LineHits(unittest.TestCase):
    def test_paths(self):
        hits = lines_for("calcium")
        self.assertEqual(hits[0], [])
        self.assertEqual(hits[3], ["Endocrinology", "Hyperparathyroidism"])
        self.assertEqual(hits[5], ["Endocrinology", "Hyperparathyroidism", "Workup"])
        # A later H2 drops the earlier H3; [[NH]] and anchors are stripped.
        self.assertEqual(hits[10], ["Endocrinology", "Hypercalcemia"])

    def test_heading_inside_code_fence_is_not_a_heading(self):
        self.assertEqual(lines_for("calcium")[8], ["Endocrinology", "Hypercalcemia"])

    def test_heading_line_includes_itself(self):
        self.assertEqual(lines_for("workup")[4], ["Endocrinology", "Hyperparathyroidism", "Workup"])

    def test_hidden_anchor_and_link_target_not_searchable(self):
        self.assertEqual(sq.search_papers_advanced([paper()], "1111"), [])
        self.assertEqual(sq.search_papers_advanced([paper()], "ap://"), [])
        self.assertEqual(list(lines_for("the page")), [11])

    def test_title_only_match_has_no_lines(self):
        res = sq.search_papers_advanced([paper()], "title:endo")
        self.assertEqual(res[0]["lines"], [])
        self.assertTrue(res[0]["title_match"])

    def test_cap_reports_true_total(self):
        p = paper("\n".join(["calcium"] * 250))
        res = sq.search_papers_advanced([p], "calcium")[0]
        self.assertEqual(len(res["lines"]), sq.MAX_LINE_HITS)
        self.assertEqual(res["lines_total"], 250)


if __name__ == "__main__":
    unittest.main()
