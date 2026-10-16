"""Sources: chapter/paper title matching, the registry, and the reader views.

Run with:  python3 -m unittest discover -s tests
"""
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.sources as S  # noqa: E402

FIX = ROOT / "tests" / "fixtures"


class Matching(unittest.TestCase):
    def test_abbreviations_and_numbers(self):
        self.assertEqual(S.title_similarity("Intro to AI concepts", "Introduction to AI concepts"), 1.0)
        self.assertEqual(S.title_similarity("Intro to NLP concepts", "Introduction to natural language processing concepts"), 1.0)
        self.assertEqual(S.title_similarity("4 · Heart failure", "Heart failure"), 1.0)
        self.assertEqual(S.title_similarity("Chapter 3 ECG", "Electrocardiography"), 1.0)
        self.assertLess(S.title_similarity("Intro to generative AI and agents", "Introduction to AI concepts"), 0.6)

    def test_each_paper_used_once(self):
        m = S.match_chapters(
            [{"key": "m1", "title": "Introduction to AI concepts"},
             {"key": "m2", "title": "Introduction to generative AI and agents"},
             {"key": "m3", "title": "Get started with generative AI and agents in Azure"}],
            [{"id": "p1", "title": "Intro to AI concepts"}, {"id": "p2", "title": "Intro to generative AI and agents"},
             {"id": "p3", "title": "Exam tips"}])
        self.assertEqual(m, {"m1": "p1", "m2": "p2"})


class Registry(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        store = {}
        self.reg = S.Registry(lambda k, d: json.loads(json.dumps(store.get(k, d))),
                              lambda k, v: store.__setitem__(k, json.loads(json.dumps(v))) or True,
                              lambda: self.root)

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_paper_and_folder_sources(self):
        item = self.reg.add_file(str(FIX / "fixture.docx"))
        self.assertEqual(self.reg.add_file(str(FIX / "fixture.docx"))["id"], item["id"])
        self.reg.attach_to_paper("pA", item["id"])
        web = self.reg.add_web("https://example.com/course", "Course")
        self.reg.attach_to_folder("SE/Azure/AI-901", web["id"], [
            {"key": "m1", "title": "Introduction to AI concepts", "paper_id": "pA"},
            {"key": "m2", "title": "Introduction to natural language processing concepts"},
        ], {})
        seen = self.reg.for_paper("pA", "SE/Azure/AI-901/Path")
        self.assertEqual([s["scope"] for s in seen], ["paper", "folder"])
        self.assertEqual(seen[1]["chapter"]["key"], "m1")
        self.assertEqual(self.reg.for_paper("pB", "SE/Azure"), [])

    def test_waiting_chapter_links_new_paper_once(self):
        web = self.reg.add_web("https://example.com", "C")
        self.reg.attach_to_folder("F", web["id"], [{"key": "m2", "title": "Introduction to NLP"}], {})
        self.assertEqual(self.reg.link_new_paper("pN", "Intro to NLP", "F")["chapter"]["key"], "m2")
        self.assertIsNone(self.reg.link_new_paper("pN", "Intro to NLP", "F"))
        self.assertEqual(self.reg.folders_summary()["waiting"], {})

    def test_folder_rename_delete_and_cleanup(self):
        item = self.reg.add_file(str(FIX / "fixture.pptx"))
        self.reg.attach_to_folder("A/B", item["id"], [], {})
        self.reg.rename_folder("A", "Z")
        self.assertIn("Z/B", self.reg.load()["folders"])
        self.reg.delete_folder("Z")
        self.assertEqual(self.reg.load()["items"], {})
        self.assertFalse(os.path.exists(os.path.join(self.root, "sources", item["file"])))


class LearningPathFolders(unittest.TestCase):
    F = "SE/Azure/AI-901"
    A = "AI concepts for developers and technology professionals"
    B = "Get started with AI applications and agents on Azure"

    def entry(self, papers=True):
        return {"chapters": [
            {"key": "a1", "title": "Introduction to AI concepts", "group": self.A, "paper_id": "p1" if papers else None},
            {"key": "a2", "title": "Introduction to NLP concepts", "group": self.A},
            {"key": "b1", "title": "Get started with AI in Azure", "group": self.B},
        ]}

    def ctx(self, where="1. AI Concepts"):
        return {"folders": [self.F, f"{self.F}/1. AI Concepts", f"{self.F}/2. AI Apps & Agents"],
                "paper_folders": {"p1": f"{self.F}/{where}"}}

    def test_by_name(self):
        m = S.group_folder_map(self.F, self.entry(papers=False), self.ctx())
        self.assertEqual(m, {self.A: f"{self.F}/1. AI Concepts", self.B: f"{self.F}/2. AI Apps & Agents"})

    def test_papers_outvote_names(self):
        m = S.group_folder_map(self.F, self.entry(), self.ctx(where="2. AI Apps & Agents"))
        self.assertEqual(m[self.A], f"{self.F}/2. AI Apps & Agents")

    def test_pinned_choice_wins(self):
        e = {**self.entry(), "group_folders": {self.A: ""}}
        self.assertNotIn(self.A, S.group_folder_map(self.F, e, self.ctx()))

    def test_waiting_chapters_listed_in_their_folder(self):
        root = tempfile.mkdtemp()
        store = {}
        reg = S.Registry(lambda k, d: json.loads(json.dumps(store.get(k, d))),
                         lambda k, v: store.__setitem__(k, json.loads(json.dumps(v))) or True, lambda: root)
        web = reg.add_web("https://example.com", "Course")
        reg.attach_to_folder(self.F, web["id"], self.entry()["chapters"], {})
        waiting = reg.folders_summary(self.ctx())["waiting"]
        self.assertEqual([w["key"] for w in waiting[f"{self.F}/1. AI Concepts"]], ["a2"])
        self.assertEqual([w["key"] for w in waiting[f"{self.F}/2. AI Apps & Agents"]], ["b1"])
        reg.rename_folder(self.F, "SE/Azure/AI-900")
        self.assertIn("SE/Azure/AI-900", reg.load()["folders"])
        shutil.rmtree(root)


class Readers(unittest.TestCase):
    def test_word(self):
        h = S.docx_pages(str(FIX / "fixture.docx"))[0]["html"]
        self.assertIn("<h2>Heart failure</h2>", h)
        self.assertIn("<b>ARNI</b>", h)
        self.assertIn("<sub>2</sub>", h)
        self.assertIn("<li>ACE inhibitor first</li>", h)

    def test_powerpoint(self):
        pages = S.pptx_pages(str(FIX / "fixture.pptx"))
        self.assertEqual([p["title"] for p in pages], ["HFrEF: drugs that save lives", "Switching ACEi to ARNI"])
        self.assertIn("Speaker notes", pages[0]["html"])
        self.assertIn('src="data:image/png;base64', pages[1]["html"])

    def test_html_is_cleaned(self):
        c = S.clean_html('<title>T &amp; U</title><body><nav>menu</nav><main><p>Text <a href="/x">link</a>'
                         '<script>bad()</script></p><div hidden>secret</div><img src="/i.png" onerror="x()"></main>',
                         "https://ex.com/a/")
        self.assertEqual(c["title"], "T & U")
        for gone in ("menu", "bad()", "secret", "onerror"):
            self.assertNotIn(gone, c["html"])
        self.assertIn('data-href="https://ex.com/x"', c["html"])
        self.assertIn('src="https://ex.com/i.png"', c["html"])

    def test_learn_unit_links(self):
        page = '<a href="1-introduction">Introduction</a><a href="2-generative-ai">Generative AI</a><a href="/x">no</a>'
        units = S._learn_units(page, "https://learn.microsoft.com/en-us/training/modules/m/")
        self.assertEqual([u["url"].rsplit("/", 1)[-1] for u in units], ["1-introduction", "2-generative-ai"])


if __name__ == "__main__":
    unittest.main()
