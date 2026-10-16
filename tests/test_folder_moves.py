"""Moving or renaming a folder moves its directory on disk, contents and all.

Run with:  python3 -m unittest discover -s tests
"""
import os
import pathlib
import shutil
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import core.storage as st  # noqa: E402


class MoveFolderDir(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.root)

    def mk(self, rel, text="x"):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)

    def files(self):
        return sorted(os.path.relpath(os.path.join(d, f), self.root)
                      for d, _, fs in os.walk(self.root) for f in fs)

    def test_everything_moves_and_parent_stays(self):
        self.mk("Med/Cardio/HF.md")
        self.mk("Med/Cardio/.DS_Store")
        self.mk("Med/Cardio/my-notes.pdf")
        os.makedirs(os.path.join(self.root, "Med/Cardio/Valves"))
        os.makedirs(os.path.join(self.root, "Bio"))
        self.assertTrue(st.move_folder_dir("Med/Cardio", "Bio/Cardio", self.root))
        self.assertEqual(self.files(), ["Bio/Cardio/.DS_Store", "Bio/Cardio/HF.md", "Bio/Cardio/my-notes.pdf"])
        self.assertTrue(os.path.isdir(os.path.join(self.root, "Bio/Cardio/Valves")))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "Med")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "Med/Cardio")))

    def test_merge_never_overwrites(self):
        self.mk("Med/Cardio/a.md", "mine")
        self.mk("Med/Cardio/sub/b.md")
        self.mk("Bio/Cardio/a.md", "theirs")
        self.assertTrue(st.move_folder_dir("Med/Cardio", "Bio/Cardio", self.root))
        with open(os.path.join(self.root, "Bio/Cardio/a.md")) as f:
            self.assertEqual(f.read(), "theirs")
        with open(os.path.join(self.root, "Med/Cardio/a.md")) as f:
            self.assertEqual(f.read(), "mine")
        self.assertTrue(os.path.isfile(os.path.join(self.root, "Bio/Cardio/sub/b.md")))

    def test_case_only_rename(self):
        self.mk("Cardio/HF.md")
        self.assertTrue(st.move_folder_dir("Cardio", "cardio", self.root))
        self.assertIn("cardio", os.listdir(self.root))

    def test_refuses_unsafe_moves(self):
        os.makedirs(os.path.join(self.root, "A/B"))
        self.assertFalse(st.move_folder_dir("A", "A/B/C", self.root))
        self.assertFalse(st.move_folder_dir("Missing", "X", self.root))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "A/B")))


if __name__ == "__main__":
    unittest.main()
