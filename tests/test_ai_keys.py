"""API keys off macOS live in a file of their own, so Save Settings (which
writes the whole add-on config back) can never erase one.

Run with:  python3 -m unittest discover -s tests
"""
import importlib
import json
import os
import pathlib
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKAGE = "ankipapers_under_test"


class FakeAddonManager:
    def __init__(self):
        self.config = {}

    def getConfig(self, name):
        return json.loads(json.dumps(self.config))

    def writeConfig(self, name, cfg):
        self.config = json.loads(json.dumps(cfg))


def _load_ai_sources(addons):
    """gui.ai_sources with a stand-in for Anki's aqt module."""
    aqt = types.ModuleType("aqt")
    aqt.mw = types.SimpleNamespace(addonManager=addons, col=None, pm=None)
    sys.modules["aqt"] = aqt
    # The add-on as a package, without running its __init__.py, which wires
    # itself into Anki's hooks.
    pkg = types.ModuleType("ankipapers_under_test")
    pkg.__path__ = [str(ROOT)]
    sys.modules["ankipapers_under_test"] = pkg
    try:
        return importlib.import_module("ankipapers_under_test.gui.ai_sources")
    except Exception as e:  # pragma: no cover - depends on what's installed
        raise unittest.SkipTest(f"gui.ai_sources needs more of Anki than the stand-in gives: {e}")


class LocalKeys(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addons = FakeAddonManager()
        self.mod = _load_ai_sources(self.addons)
        self.mod.mw.addonManager = self.addons
        p = mock.patch.object(self.mod, "get_ankipapers_dir", return_value=self.dir)
        p.start()
        self.addCleanup(p.stop)
        k = mock.patch.object(self.mod.AI, "keychain_available", return_value=False)
        k.start()
        self.addCleanup(k.stop)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_a_saved_key_survives_the_config_being_rewritten(self):
        self.mod.KEYS.set("deepseek", "sk-real-key")
        # Save Settings: the page's snapshot of the config, without keys.
        self.addons.writeConfig(PACKAGE, {"ai_provider": "deepseek"})
        self.assertEqual(self.mod.KEYS.get("deepseek"), "sk-real-key")

    def test_the_key_is_not_written_into_the_config(self):
        self.mod.KEYS.set("deepseek", "sk-real-key")
        self.assertNotIn("sk-real-key", json.dumps(self.addons.config))
        self.assertTrue(os.path.exists(os.path.join(self.dir, "ai_keys.json")))

    def test_a_key_kept_in_the_config_is_still_read_and_moves_on_the_next_save(self):
        self.addons.config = {"ai_keys_local": {"gemini": "old-key"}}
        self.assertEqual(self.mod.KEYS.get("gemini"), "old-key")
        self.mod.KEYS.set("deepseek", "sk-new")
        self.assertEqual(self.mod.KEYS.get("gemini"), "old-key")
        self.assertEqual(self.mod.KEYS.get("deepseek"), "sk-new")
        self.assertNotIn("ai_keys_local", self.addons.config)

    def test_removing_a_key(self):
        self.mod.KEYS.set("deepseek", "sk-real-key")
        self.mod.KEYS.delete("deepseek")
        self.assertEqual(self.mod.KEYS.get("deepseek"), "")


if __name__ == "__main__":
    unittest.main()
