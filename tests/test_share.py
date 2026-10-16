"""Sharing papers with their pictures, content-based names, and Check Media.

Run with:  python3 -m unittest discover -s tests
"""
import json
import pathlib
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core.media_refs import (  # noqa: E402
    content_name,
    filter_check_media,
    media_names,
    rename_media,
)
from core.share import build_share, is_share, plan_import, read_share  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\nfake-bytes"


class References(unittest.TestCase):
    def test_finds_markdown_and_html_pictures_once(self):
        text = ("![probe|300](probe.png) and ![](probe.png)\n"
                '<img src="heart view.jpg" width="200"> '
                "![web](https://x.org/a.png) ![d](data:image/png;base64,AA)")
        self.assertEqual(media_names(text), ["probe.png", "heart view.jpg"])

    def test_rename_keeps_alt_and_width(self):
        text = '![probe|300](probe.png) <img src="probe.png">'
        self.assertEqual(rename_media(text, {"probe.png": "probe-2.png"}),
                         '![probe|300](probe-2.png) <img src="probe-2.png">')

    def test_content_names(self):
        a = content_name(PNG, ".PNG")
        self.assertTrue(a.startswith("_ap_") and a.endswith(".png"))
        self.assertEqual(a, content_name(PNG, ".png"))  # same picture, same name
        self.assertNotEqual(a, content_name(PNG + b"x", ".png"))
        self.assertTrue(content_name(PNG, ".jpeg").endswith(".jpg"))


class ShareRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.media = pathlib.Path(self.tmp.name) / "media"
        self.media.mkdir()
        (self.media / "probe.png").write_bytes(PNG)
        (self.media / "valve.png").write_bytes(PNG + b"2")

    def tearDown(self):
        self.tmp.cleanup()

    def papers(self):
        return [
            {"id": "p1", "title": "Cardiac", "folder_path": "Med/Ultrasound",
             "content": "![](probe.png)\nsee [lung](ap://p2#b1)", "deck_name": "US", "tags": ["x"]},
            {"id": "p2", "title": "Lung", "folder_path": "Med/Ultrasound/Chest",
             "content": "![](valve.png) ![](gone.png)", "deck_name": "US", "tags": []},
        ]

    def test_folder_share_carries_pictures_and_structure(self):
        out = str(pathlib.Path(self.tmp.name) / "share.zip")
        report = build_share(out, self.papers(), str(self.media), kind="folder", root_folder="Med/Ultrasound")
        self.assertEqual((report["papers"], report["pictures"], report["missing"]), (2, 2, ["gone.png"]))
        self.assertTrue(is_share(out))
        manifest, texts, media = read_share(out)
        self.assertEqual(manifest["root_folder"], "Ultrasound")
        self.assertEqual([e["folder"] for e in manifest["papers"]], ["Ultrasound", "Ultrasound/Chest"])
        self.assertEqual(set(media), {"probe.png", "valve.png"})
        self.assertEqual(media["probe.png"], PNG)

    def test_import_renames_clashing_pictures_and_keeps_links(self):
        out = str(pathlib.Path(self.tmp.name) / "share.zip")
        build_share(out, self.papers(), str(self.media), kind="folder", root_folder="Med/Ultrasound")
        manifest, texts, _ = read_share(out)
        # p2 already exists on the receiver; probe.png clashed and was renamed.
        planned = plan_import(manifest, texts, {"p2"}, {"probe.png": "probe-ab12.png"})
        self.assertEqual(planned[0]["id"], "p1")
        self.assertNotEqual(planned[1]["id"], "p2")
        self.assertIn("![](probe-ab12.png)", planned[0]["content"])
        self.assertIn(f"(ap://{planned[1]['id']}#b1)", planned[0]["content"])

    def test_rejects_unsafe_picture_names(self):
        out = str(pathlib.Path(self.tmp.name) / "evil.zip")
        with zipfile.ZipFile(out, "w") as z:
            z.writestr("manifest.json", json.dumps({
                "format": "ankipapers-share", "version": 1, "kind": "paper",
                "papers": [], "media": ["../escape.png", "ok.png"]}))
            z.writestr("media/../escape.png", b"x")
            z.writestr("media/ok.png", b"y")
        _, _, media = read_share(out)
        self.assertEqual(list(media), ["ok.png"])

    def test_plain_zip_is_not_a_share(self):
        out = str(pathlib.Path(self.tmp.name) / "plain.zip")
        with zipfile.ZipFile(out, "w") as z:
            z.writestr("notes.md", "hi")
        self.assertFalse(is_share(out))


class CheckMedia(unittest.TestCase):
    REPORT = ("Missing files: ⁨0⁩\nUnused files: ⁨3⁩\n\n"
              "The following files were found in the media folder, but do not appear to be used on any cards:\n"
              "Unused: old scan.png\nUnused: probe.png\nUnused: truly_unused.png\n")

    def test_keeps_paper_pictures_out_of_unused(self):
        unused = ["old scan.png", "probe.png", "truly_unused.png"]
        kept, report = filter_check_media(unused, self.REPORT, ["probe.png", "old scan.png", "other.png"])
        self.assertEqual(kept, ["old scan.png", "probe.png"])
        self.assertNotIn("Unused: probe.png", report)
        self.assertIn("Unused: truly_unused.png", report)
        self.assertIn("Unused files: ⁨1⁩", report)
        self.assertTrue(report.startswith("Anki Papers kept 2 pictures"))

    def test_nothing_to_keep_leaves_report_alone(self):
        kept, report = filter_check_media(["a.png"], self.REPORT, ["b.png"])
        self.assertEqual((kept, report), ([], self.REPORT))


if __name__ == "__main__":
    unittest.main()
