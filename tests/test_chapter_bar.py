"""A paper's own "show the chapter bar" choice is saved with it, on disk too.

Run with:  python3 -m unittest discover -s tests
"""
import pathlib
import shutil
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.storage as st  # noqa: E402
from core.paper import Paper  # noqa: E402


class ChapterBarChoice(unittest.TestCase):
    def test_defaults_off_and_round_trips(self):
        p = Paper(title="1. Getting Started", folder_path="Python/Fundamentals")
        self.assertFalse(p.show_chapter_bar)
        p.show_chapter_bar = True
        self.assertTrue(Paper.from_dict(p.to_dict()).show_chapter_bar)
        self.assertFalse(Paper.from_dict({"title": "Old paper"}).show_chapter_bar)

    def test_saved_in_the_files_on_disk(self):
        root = tempfile.mkdtemp()
        try:
            p = Paper(title="1. Getting Started", content="# Getting Started\n", folder_path="Python/Fundamentals")
            p.show_chapter_bar = True
            info = st.write_paper_files(p, root=root)
            back = st._read_paper_from_files(info["md"], root)
            self.assertTrue(back.show_chapter_bar)
            p.show_chapter_bar = False
            st.write_paper_files(p, root=root)
            self.assertFalse(st._read_paper_from_files(info["md"], root).show_chapter_bar)
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
