"""gui/text_replacements.py reads the user's macOS Text Replacements.

These tests never print the user's entries -- only their shape.
Run with:  python3 -m unittest discover -s tests
"""
import importlib.util
import pathlib
import sqlite3
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ap_text_repl", ROOT / "gui" / "text_replacements.py")
tr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tr)

DB = pathlib.Path.home() / "Library" / "KeyboardServices" / "TextReplacements.db"


@unittest.skipUnless(sys.platform == "darwin", "macOS only")
class ReadsTheSystemList(unittest.TestCase):
    def test_shape(self):
        items = tr.get_text_replacements()
        self.assertIsInstance(items, list)
        for it in items:
            self.assertEqual(set(it), {"shortcut", "phrase"})
            self.assertIsInstance(it["shortcut"], str)
            self.assertIsInstance(it["phrase"], str)
            self.assertTrue(it["shortcut"])

    @unittest.skipUnless(DB.exists(), "no local replacements database to compare against")
    def test_matches_the_system_database(self):
        # Cross-check the documented API against macOS's own store: same
        # shortcuts, same phrases.
        with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as con:
            rows = con.execute(
                "select ZSHORTCUT, ZPHRASE from ZTEXTREPLACEMENTENTRY where ZWASDELETED = 0"
            ).fetchall()
        expected = {s: p for s, p in rows if s and s != p}
        got = {it["shortcut"]: it["phrase"] for it in tr.get_text_replacements()}
        self.assertEqual(got, expected)


class OtherPlatforms(unittest.TestCase):
    def test_non_mac_returns_empty(self):
        real = sys.platform
        try:
            sys.platform = "linux"
            self.assertEqual(tr.get_text_replacements(), [])
        finally:
            sys.platform = real


if __name__ == "__main__":
    unittest.main()
