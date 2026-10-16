"""
Bridge for Anki Papers.

Exposes Python backend methods to the React frontend over AnkiWebView's
pycmd() channel. Each JS -> Python message is the string
"ankipapers:" + JSON.stringify({cmd, args}); handle() parses it, dispatches
to the matching method below, and returns a plain JSON-serializable value
(Anki's own bridge script does the json.dumps()/JSON.parse() on both ends).
"""

import os
import json
import shutil
import traceback
from datetime import datetime
import time
import re
import uuid
import urllib.request
from urllib.parse import urlparse
import html

from aqt.qt import QFileDialog, QApplication, QImage, QTimer, QBuffer, QIODevice
from aqt import mw

from ..core.paper import Paper
from ..core.emphasis import convert_emphasis_to_tags
from ..core.code_blocks import arrows_from_spaces, expand_arrows_in_markdown
from ..core.media_refs import content_name
from ..core.share import build_share, is_share, read_share, plan_import
from .text_replacements import get_text_replacements
from .ai_sources import AISourcesMixin
from ..core.search_query import search_papers_advanced
from ..core.storage import (
    save_paper,
    load_paper,
    delete_paper,
    list_papers,
    save_folder_structure,
    load_folder_structure,
    delete_folder_structure,
    rename_folder_structure,
    move_folder_structure,
    save_source_link,
    load_source_link,
    get_ankipapers_dir,
)
from ..core.card_manager import (
    generate_cards as run_generate_cards,
    ensure_note_types,
    remove_paper_cards,
    list_anki_edit_conflicts,
    AnkiEditConflictAbort,
    note_review_stats,
    unsuspend_note,
)

MAX_FOLDER_DEPTH = 10  # Maximum nesting level for sub-folders


# ─── D4 test seam ─────────────────────────────────────
#
# When ANKIPAPERS_TEST_DIALOG_PATH is set, every open/save file dialog in this
# module returns that path instead of showing a real dialog (empty string
# means "canceled", same as a real dialog). Read at call time (not import
# time) so Stage 4's automated driver can change the value while Anki is
# running, between one pick and the next.

def _ask_open_file(parent, caption, directory, filter):
    test_path = os.environ.get("ANKIPAPERS_TEST_DIALOG_PATH")
    if test_path is not None:
        return test_path, filter
    return QFileDialog.getOpenFileName(parent, caption, directory, filter)


def _ask_save_file(parent, caption, directory, filter):
    test_path = os.environ.get("ANKIPAPERS_TEST_DIALOG_PATH")
    if test_path is not None:
        return test_path, filter
    return QFileDialog.getSaveFileName(parent, caption, directory, filter)


def _select_note_card_in_browser_table(browser, note_id: int) -> dict:
    """
    After Browser.table.search(), Anki restores the previous row selection; that often
    leaves the wrong row focused (e.g. last card). Select the first card of this note.
    """
    out: dict = {"ok": False}
    try:
        if not mw or not mw.col:
            out["error"] = "no_collection"
            return out
        cids = mw.col.find_cards(f"nid:{note_id}")
        if not cids:
            out["error"] = "no_cards_for_nid"
            out["query"] = f"nid:{note_id}"
            return out
        table = getattr(browser, "table", None)
        fn = getattr(table, "select_single_card", None) if table else None
        if not callable(fn):
            out["error"] = "no_select_single_card"
            return out
        fn(cids[0])
        out["selected_cid"] = cids[0]
        out["card_count"] = len(cids)
        try:
            sel_nids = table.get_selected_note_ids()
            if sel_nids and note_id not in sel_nids:
                out["ok"] = False
                out["error"] = "selection_did_not_match_note"
                return out
        except Exception:
            pass
        out["ok"] = True
    except Exception as e:
        out["error"] = str(e)
        traceback.print_exc()
    return out


class AnkiPapersBridge(AISourcesMixin):
    """Bridge object exposed to JavaScript via AnkiWebView's pycmd() channel."""

    def __init__(self, window=None):
        # The window is used only by the PDF export helpers, which need the
        # main webview to render a temporary print page (self.parent()-style
        # access used to come from being a QObject child; now given explicitly).
        self.window = window
        self._dispatch = {
            "list_papers": self.list_papers,
            "load_paper": self.load_paper,
            "save_paper": self.save_paper,
            "create_paper": self.create_paper,
            "delete_paper": self.delete_paper,
            "move_paper_to_folder": self.move_paper_to_folder,
            "check_anki_edit_conflicts": self.check_anki_edit_conflicts,
            "generate_cards": self.generate_cards,
            "get_decks": self.get_decks,
            "get_folders": self.get_folders,
            "create_folder": self.create_folder,
            "delete_folder": self.delete_folder,
            "rename_folder": self.rename_folder,
            "move_folder": self.move_folder,
            "get_media_dir": self.get_media_dir,
            "pick_image": self.pick_image,
            "paste_image": self.paste_image,
            "get_clipboard_text": self.get_clipboard_text,
            "open_in_browser": self.open_in_browser,
            "diagnose_crosslink": self.diagnose_crosslink,
            "open_url": self.open_url,
            "pick_pdf_file": self.pick_pdf_file,
            "save_source_link": self.save_source_link,
            "load_source_link": self.load_source_link,
            "extract_pdf_text": self.extract_pdf_text,
            "extract_web_text": self.extract_web_text,
            "open_source_at_location": self.open_source_at_location,
            "move_cards_to_deck": self.move_cards_to_deck,
            "export_pdf_html": self.export_pdf_html,
            "export_pdf": self.export_pdf,
            "export_papers_to_disk": self.export_papers_to_disk,
            "search_papers": self.search_papers,
            "get_home_stats": self.get_home_stats,
            "get_note_stats": self.get_note_stats,
            "unsuspend_note": self.unsuspend_note,
            "import_markdown": self.import_markdown,
            "export_markdown": self.export_markdown,
            "get_settings": self.get_settings,
            "save_settings": self.save_settings,
            "pdf_viewer_url": self.pdf_viewer_url,
            "pdf_url": self.pdf_url,
            "get_text_replacements": self.get_text_replacements,
            "convert_emphasis_to_tags": self.convert_emphasis_to_tags,
            "share_paper": self.share_paper,
            "share_folder": self.share_folder,
            "set_web_browser": self.set_web_browser,
            "get_web_browser": self.get_web_browser,
        }
        self._dispatch.update(self._ai_sources_dispatch())

    def handle(self, cmd: str):
        """Entry point wired to AnkiWebView.set_bridge_command().

        Anything not addressed to us is left alone (returns None) so other
        add-ons' pycmd messages and AnkiWebView's own "domDone"/"close" are
        unaffected.
        """
        if not isinstance(cmd, str) or not cmd.startswith("ankipapers:"):
            return None
        try:
            payload = json.loads(cmd[len("ankipapers:"):])
            name = payload.get("cmd", "")
            args = payload.get("args") or {}
            method = self._dispatch.get(name)
            if method is None:
                return {"error": f"unknown command {name}"}
            return method(args)
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Paper CRUD ──────────────────────────────────

    def list_papers(self, args):
        try:
            papers = list_papers()
            return [p.to_dict() for p in papers]
        except Exception:
            traceback.print_exc()
            return []

    def load_paper(self, args):
        try:
            paper = load_paper(args.get("paper_id", ""))
            if paper:
                return paper.to_dict()
            return {"error": "Paper not found"}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def save_paper(self, args):
        try:
            data = args.get("paper") or {}
            paper = load_paper(data.get("id", ""))
            before = (paper.title, paper.folder_path) if paper else None
            if paper:
                paper.title = data.get("title", paper.title)
                paper.content = data.get("content", paper.content)
                paper.deck_name = data.get("deck_name", paper.deck_name)
                paper.folder_path = data.get("folder_path", paper.folder_path)
                paper.tags = data.get("tags", paper.tags)
                paper.show_chapter_bar = bool(data.get("show_chapter_bar", paper.show_chapter_bar))
            else:
                paper = Paper.from_dict(data)
            save_paper(paper)
            # Renamed or moved: it may now match a chapter waiting for a paper.
            if before is None or before != (paper.title, paper.folder_path):
                self._sources_after_paper_created(paper)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def get_clipboard_text(self, args):
        """Plain text from the system clipboard, for "Paste blocks".

        Reading the clipboard from JavaScript is unreliable inside Anki's
        webview (navigator.clipboard is permission-gated and
        execCommand('paste') is blocked), so this goes through Qt the same
        way image pasting already does.
        """
        try:
            return {"text": QApplication.clipboard().text() or ""}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def create_paper(self, args):
        try:
            title = args.get("title", "")
            folder_path = args.get("folder_path", "")
            paper = Paper(title=title, folder_path=folder_path)
            paper.content = f"# {title}\n\nStart writing your notes here...\n"
            save_paper(paper)
            # A chapter of a folder's book or course waiting for this title
            # gets linked to the new paper.
            self._sources_after_paper_created(paper)
            return paper.to_dict()
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def delete_paper(self, args):
        try:
            paper_id = args.get("paper_id", "")
            paper = load_paper(paper_id)
            if paper and mw and mw.col:
                remove_paper_cards(paper, mw.col)
                mw.reset()
            delete_paper(paper_id)
            self._sources_after_paper_deleted(paper_id)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def move_paper_to_folder(self, args):
        try:
            paper = load_paper(args.get("paper_id", ""))
            if paper:
                paper.folder_path = args.get("folder_path", "")
                save_paper(paper)
                self._sources_after_paper_created(paper)
                return {"ok": True}
            return {"error": "Paper not found"}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Card Generation ─────────────────────────────

    def check_anki_edit_conflicts(self, args):
        """List rows where the paper line is unchanged but the Anki note was edited."""
        try:
            if not mw or not mw.col:
                return {"error": "Anki collection not available"}
            paper = load_paper(args.get("paper_id", ""))
            if not paper:
                return {"error": "Paper not found"}
            conflicts = list_anki_edit_conflicts(paper, mw.col)
            return {"conflicts": conflicts}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def generate_cards(self, args):
        """
        anki_edit_conflict: preserve | overwrite | abort
        abort returns error payload if conflicts exist (no collection changes).
        """
        try:
            if not mw or not mw.col:
                return {"error": "Anki collection not available"}
            paper_id = args.get("paper_id", "")
            paper = load_paper(paper_id)
            if not paper:
                return {"error": "Paper not found"}
            policy = (args.get("anki_edit_conflict") or "preserve").strip().lower()
            if policy not in ("preserve", "overwrite", "abort"):
                policy = "preserve"
            try:
                created, updated, deleted = run_generate_cards(
                    paper, mw.col, policy, card_style=self._card_style(),
                    color_scheme=self._color_scheme(),
                )
            except AnkiEditConflictAbort as ex:
                return {
                    "error": "anki_edit_conflicts",
                    "conflicts": ex.conflicts,
                }
            save_paper(paper)
            mw.reset()
            return {"created": created, "updated": updated, "deleted": deleted}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Decks & Folders ─────────────────────────────

    def get_decks(self, args):
        try:
            if mw and mw.col:
                names = sorted([d.name for d in mw.col.decks.all_names_and_ids()])
                return names
            return ["Default"]
        except Exception:
            traceback.print_exc()
            return ["Default"]

    def get_folders(self, args):
        try:
            return load_folder_structure()
        except Exception:
            traceback.print_exc()
            return {"name": "Root", "children": []}

    def create_folder(self, args):
        try:
            name = args.get("name", "")
            parent_path = args.get("parent_path", "")
            # Check depth limit
            current_depth = len(parent_path.split("/")) if parent_path else 0
            if current_depth >= MAX_FOLDER_DEPTH:
                return {
                    "error": f"Maximum folder depth ({MAX_FOLDER_DEPTH}) reached"
                }

            folders = load_folder_structure()
            full_path = f"{parent_path}/{name}" if parent_path else name
            new_folder = {"type": "folder", "name": name, "path": full_path, "children": []}
            if not parent_path:
                folders.setdefault("children", []).append(new_folder)
            else:
                self._add_child(folders, parent_path, new_folder)
            save_folder_structure(folders)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def delete_folder(self, args):
        try:
            path = args.get("folder_path", "") or ""
            err = delete_folder_structure(path)
            if err:
                return {"error": err}
            self._sources_after_folder_deleted(path)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def rename_folder(self, args):
        try:
            old_path = args.get("old_path", "") or ""
            new_name = args.get("new_name", "") or ""
            err = rename_folder_structure(old_path, new_name)
            if err:
                return {"error": err}
            parent = old_path.rsplit("/", 1)[0] if "/" in old_path else ""
            self._sources_after_folder_moved(old_path, f"{parent}/{new_name}" if parent else new_name)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def move_folder(self, args):
        try:
            folder_path = args.get("folder_path", "") or ""
            new_parent = args.get("new_parent_path", "") or ""
            err = move_folder_structure(folder_path, new_parent, max_depth=MAX_FOLDER_DEPTH)
            if err:
                return {"error": err}
            name = folder_path.rsplit("/", 1)[-1]
            self._sources_after_folder_moved(folder_path, f"{new_parent}/{name}" if new_parent else name)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def _add_child(self, node, target_path, new_child):
        for child in node.get("children", []):
            if child.get("path") == target_path:
                child.setdefault("children", []).append(new_child)
                return True
            if self._add_child(child, target_path, new_child):
                return True
        return False

    # ─── Images ──────────────────────────────────────

    def get_media_dir(self, args):
        """Get the Anki collection media folder path and its http base URL."""
        try:
            if mw and mw.col:
                media_dir = mw.col.media.dir()
                return {
                    "path": media_dir.replace("\\", "/"),
                    "base_url": mw.serverURL(),
                }
            return {"path": "", "base_url": ""}
        except Exception:
            traceback.print_exc()
            return {"path": "", "base_url": ""}

    def pick_image(self, args):
        """Open file picker and copy image to Anki media folder."""
        try:
            file_path, _ = _ask_open_file(
                None, "Select Image", "",
                "Images (*.png *.jpg *.jpeg *.gif *.svg *.webp *.bmp);;All Files (*)",
            )
            if not file_path:
                return {"canceled": True}

            # Copy to Anki media folder
            if mw and mw.col:
                media_dir = mw.col.media.dir()
            else:
                addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                media_dir = os.path.join(addon_dir, "user_files", "images")
                os.makedirs(media_dir, exist_ok=True)

            basename = os.path.basename(file_path)
            name, ext = os.path.splitext(basename)
            with open(file_path, "rb") as f:
                data = f.read()
            # Named from its contents (core/media_refs.py): the same picture
            # always gets the same name, and the leading underscore keeps
            # Anki's Check Media from calling it unused.
            unique_name = self._write_media(media_dir, content_name(data, ext), data)

            return {
                "filename": unique_name,
                "markdown": f"![{name}]({unique_name})",
            }
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def _write_media(self, media_dir, name, data):
        """Put a picture in the media folder; returns the name it ended up with.

        Through Anki's media API when a collection is open, so the media
        database knows about it (and a different file already holding the
        name gets a renamed copy rather than being overwritten).
        """
        if mw and mw.col:
            return mw.col.media.write_data(name, data)
        path = os.path.join(media_dir, name)
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(data)
        return name

    def paste_image(self, args):
        """Save image from clipboard and return markdown."""
        try:
            clipboard = QApplication.clipboard()
            image = clipboard.image()
            if image.isNull():
                return {"error": "No image in clipboard"}

            if mw and mw.col:
                media_dir = mw.col.media.dir()
            else:
                addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                media_dir = os.path.join(addon_dir, "user_files", "images")
                os.makedirs(media_dir, exist_ok=True)

            # Named from its contents, not the clock: two pastes in the same
            # second used to get one name, and the second overwrote the first.
            buf = QBuffer()
            buf.open(QIODevice.OpenModeFlag.WriteOnly)
            image.save(buf, "PNG")
            data = bytes(buf.data())
            unique_name = self._write_media(media_dir, content_name(data, ".png"), data)

            return {
                "filename": unique_name,
                "markdown": f"![pasted]({unique_name})",
            }
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def open_in_browser(self, args):
        """Open the Anki browser and search for the note. Fire-and-forget."""
        note_id_str = args.get("note_id", "")
        if not mw:
            print("[Anki Papers] open_in_browser: main window not available")
            return {"ok": True}
        try:
            note_id = int(note_id_str)
        except (TypeError, ValueError):
            print(f"[Anki Papers] open_in_browser: invalid note id {note_id_str!r}")
            return {"ok": True}

        query = f"nid:{note_id}"

        browser = self._get_or_open_browser()
        if not browser:
            print("[Anki Papers] open_in_browser: could not open browser")
            return {"ok": True}

        def do_search_and_select():
            try:
                search_for = getattr(browser, "search_for", None)
                if callable(search_for):
                    search_for(query)
                else:
                    form = getattr(browser, "form", None)
                    edit = getattr(form, "searchEdit", None) if form else None
                    if edit is not None:
                        edit.setEditText(query)
                        activated = getattr(browser, "onSearchActivated", None)
                        if callable(activated):
                            activated()
            except Exception as e:
                print(f"[Anki Papers] search failed: {e}")
                traceback.print_exc()

            def select_card():
                r = _select_note_card_in_browser_table(browser, note_id)
                if not r.get("ok"):
                    QTimer.singleShot(150, lambda: _select_note_card_in_browser_table(browser, note_id))

            QTimer.singleShot(100, select_card)

        QTimer.singleShot(100, do_search_and_select)
        return {"ok": True}

    def _get_or_open_browser(self):
        """Open the Card Browser (or get existing) via aqt.dialogs."""
        try:
            from aqt import dialogs
            return dialogs.open("Browser", mw)
        except Exception:
            traceback.print_exc()
        try:
            mw.onBrowse()
        except Exception:
            traceback.print_exc()
            return None
        try:
            from aqt import dialogs as dlg
            entry = dlg._dialogs.get("Browser")
            if entry and len(entry) > 1:
                return entry[1]
        except Exception:
            pass
        return None

    def diagnose_crosslink(self, args):
        """
        Debug: verify nid resolution and Browser selection API (Settings → test field).
        """
        note_id_str = args.get("note_id", "")
        try:
            note_id = int(str(note_id_str).strip())
        except (TypeError, ValueError):
            return {"error": "invalid_note_id", "raw": note_id_str}

        query = f"nid:{note_id}"
        out: dict = {"note_id": note_id, "query": query}

        if not mw or not mw.col:
            out["error"] = "no_collection"
            return out

        try:
            mw.col.get_note(note_id)
            out["note_found"] = True
        except Exception as e:
            out["note_found"] = False
            out["get_note_error"] = str(e)

        cids = mw.col.find_cards(query)
        out["find_cards_count"] = len(cids)
        fid = cids[0] if cids else None
        out["first_card_id"] = fid
        out["first_cid"] = fid  # same value; kept for older screenshots/docs

        out["collection_ok"] = bool(out.get("note_found") and len(cids) > 0)

        browser = None
        try:
            from aqt import dialogs as dlg
            entry = dlg._dialogs.get("Browser")
            if entry and len(entry) > 1:
                browser = entry[1]
        except Exception:
            pass
        out["browser_open"] = browser is not None
        table = getattr(browser, "table", None) if browser else None
        out["has_select_single_card"] = bool(
            table and callable(getattr(table, "select_single_card", None))
        )
        if table is not None and hasattr(table, "len"):
            try:
                out["browser_table_rows"] = table.len()
            except Exception:
                pass

        if not browser:
            out["hint"] = (
                "browser_open is false: Card Browser is not open right now, so "
                "has_select_single_card is expected to be false. "
                "Your collection still resolves nid: correctly if note_found and find_cards_count >= 1. "
                "Use Open Browse to open the window and apply search + row selection."
            )

        return out

    def open_url(self, args):
        """Open a URL in the system browser. Fire-and-forget."""
        try:
            from aqt.utils import openLink
            openLink(args.get("url", ""))
        except Exception:
            traceback.print_exc()
        return {"ok": True}

    # ─── Source Panel APIs ───────────────────────────

    def pick_pdf_file(self, args):
        try:
            file_path, _ = _ask_open_file(
                None, "Select PDF", "", "PDF Files (*.pdf);;All Files (*)"
            )
            if not file_path:
                return {"canceled": True}
            path = file_path.replace("\\", "/")
            result = {"ok": True, "path": path, "name": os.path.basename(file_path)}
            url_result = self.pdf_url({"path": path})
            result["url"] = url_result.get("url")
            return result
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def _pdf_server(self):
        """Lazily import and start the add-on's own local PDF/viewer server.

        Imported inside the method (not at module import time) so gui/bridge.py
        still imports cleanly even while gui/pdf_server.py is being worked on,
        and so the server only starts on first actual use.
        """
        from .pdf_server import PdfServer

        viewer_html_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "web", "pdf_viewer.html"
        )
        return PdfServer.instance(viewer_html_path)

    def pdf_viewer_url(self, args):
        try:
            server = self._pdf_server()
            return {"url": server.viewer_url()}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def pdf_url(self, args):
        try:
            path = args.get("path", "") or ""
            if not path or not os.path.isfile(path):
                return {"error": "PDF file not found"}
            server = self._pdf_server()
            url = server.register(path)
            if not url:
                return {"error": "PDF file not found"}
            return {"url": url}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def save_source_link(self, args):
        try:
            data = args.get("link") or {}
            ok = save_source_link(
                paper_id=args.get("paper_id", "") or "",
                block_id=args.get("block_id", "") or "",
                source_type=data.get("source_type", ""),
                source_uri=data.get("source_uri", ""),
                locator=data.get("locator", {}) or {},
                captured_text=data.get("captured_text", ""),
            )
            return {"ok": bool(ok)}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def load_source_link(self, args):
        try:
            data = load_source_link(args.get("paper_id", "") or "", args.get("block_id", "") or "")
            if not data:
                return {"error": "Source link not found"}
            return data
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def extract_pdf_text(self, args):
        try:
            pdf_path = args.get("pdf_path", "")
            page = args.get("page", 1)
            if not pdf_path:
                return {"error": "Missing PDF path"}
            path = os.path.normpath(pdf_path)
            if not os.path.isfile(path):
                return {"error": "PDF file not found"}
            p = int(page or 1)
            if p < 1:
                p = 1
            title = os.path.basename(path)
            text = ""

            def _with_pypdf():
                nonlocal text, title
                from pypdf import PdfReader  # type: ignore

                try:
                    reader = PdfReader(path, strict=False)
                except TypeError:
                    reader = PdfReader(path)
                if not reader.pages:
                    return
                page_idx = min(max(0, p - 1), len(reader.pages) - 1)
                pg = reader.pages[page_idx]
                text = (pg.extract_text() or "").strip()
                meta_title = getattr(reader, "metadata", None)
                if meta_title and getattr(meta_title, "title", None):
                    title = str(meta_title.title)

            def _with_pymupdf():
                nonlocal text
                import fitz  # type: ignore  # PyMuPDF

                doc = fitz.open(path)
                try:
                    if doc.page_count < 1:
                        return
                    page_idx = min(max(0, p - 1), doc.page_count - 1)
                    t = doc.load_page(page_idx).get_text("text") or ""
                    if t.strip():
                        text = t.strip()
                finally:
                    doc.close()

            missing = {"pypdf": False, "pymupdf": False}
            for name, fn in (
                ("pypdf", _with_pypdf),
                ("pymupdf", _with_pymupdf),
            ):
                try:
                    fn()
                    if text:
                        break
                except ImportError:
                    missing[name] = True
                    text = ""
                except Exception:
                    text = ""

            if not text:
                if missing["pypdf"] and missing["pymupdf"]:
                    hint = (
                        "No PDF engine found. Install for this Anki’s Python: pip install pypdf pymupdf"
                    )
                elif not missing["pypdf"]:
                    hint = (
                        "No extractable text on this page (common for scanned PDFs). "
                        "Select text in the viewer and tap “Add to notes”, or try: pip install pymupdf"
                    )
                else:
                    hint = "Could not extract text (install: pip install pypdf)"
                return {"error": hint}
            return {"ok": True, "title": title, "text": text, "page": p, "path": path.replace("\\", "/")}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def extract_web_text(self, args):
        try:
            raw = (args.get("url", "") or "").strip()
            if not raw:
                return {"error": "Invalid URL"}
            if not raw.startswith(("http://", "https://", "//")):
                raw = "https://" + raw
            if raw.startswith("//"):
                raw = "https:" + raw
            try:
                p = urlparse(raw)
                if p.scheme not in ("http", "https") or not p.netloc:
                    return {"error": "Invalid URL"}
                url = p.geturl()
            except Exception:
                return {"error": "Invalid URL"}
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (AnkiPapers)"},
            )
            with urllib.request.urlopen(req, timeout=12) as r:
                raw = r.read().decode("utf-8", errors="ignore")
            t = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw)
            t = re.sub(r"(?is)<style.*?>.*?</style>", " ", t)
            title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
            title = html.unescape(title_m.group(1).strip()) if title_m else url
            body = re.sub(r"(?is)<[^>]+>", " ", t)
            body = html.unescape(re.sub(r"\s+", " ", body)).strip()
            return {"ok": True, "title": title, "text": body, "url": url}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def open_source_at_location(self, args):
        try:
            data = args.get("source") or {}
            st = (data.get("source_type") or "").lower()
            uri = data.get("source_uri") or ""
            locator = data.get("locator") or {}
            if st == "pdf":
                page = int(locator.get("page") or 1)
                from aqt.utils import openLink
                # Allowed file:/// use (contract check allow-list): opening the
                # PDF in the user's system viewer, not loading a webview page.
                file_url = f"file:///{uri.replace(chr(92), '/')}"
                if page > 1:
                    file_url = f"{file_url}#page={page}"
                openLink(file_url)
                return {"ok": True, "opened": file_url}
            if st == "web":
                target = uri
                anchor = locator.get("anchor")
                if anchor and "#" not in target:
                    target = f"{target}#{anchor}"
                from aqt.utils import openLink
                openLink(target)
                return {"ok": True, "opened": target}
            return {"error": "Unknown source type"}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def move_cards_to_deck(self, args):
        """Move all cards of a paper to a new deck."""
        try:
            paper_id = args.get("paper_id", "")
            deck_name = args.get("deck_name", "")
            paper = load_paper(paper_id)
            if not paper or not mw or not mw.col:
                return {"error": "Paper or collection not found"}

            from ..core.card_manager import get_deck_id
            deck_id = get_deck_id(mw.col, deck_name)

            card_ids = []
            for ref in paper.card_refs:
                if ref.anki_note_id:
                    try:
                        note = mw.col.get_note(ref.anki_note_id)
                        for card in note.cards():
                            card_ids.append(card.id)
                    except:
                        pass

            if card_ids:
                mw.col.set_deck(card_ids, deck_id)
                # after_deck_selection_change() removed from Collection in Anki 25+
                mw.reset()

            paper.deck_name = deck_name
            save_paper(paper)
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}
    # ─── PDF Export ──────────────────────────────────
    #
    # The page builds the printable HTML (web_src/src/printDocument.js) using
    # the same parsing and inline formatting the editor uses, and hands it to
    # export_pdf_html() below. Python's job is only the save dialog and
    # printToPdf().
    #
    # It used to render the markdown itself, in _markdown_to_html() further
    # down. That was a second, independent implementation of the document
    # format, and it had drifted a long way from the editor: it discarded all
    # indentation, printed "term::hint" instead of "term [hint]", printed
    # ap:// links as raw markdown complete with UUID, printed [[NH]] and &&
    # literally, printed the title twice — and, because it never escaped HTML,
    # silently dropped the rest of any line containing a "<" followed by a
    # letter, so "Ferritin <normal range suggests iron deficiency" printed as
    # "Ferritin". Those methods are kept only as a fallback for an install
    # whose web/ folder has not been updated yet.

    def export_pdf_html(self, args):
        """Export a paper to PDF from HTML the page has already rendered."""
        try:
            paper_id = args.get("paper_id", "")
            html = args.get("html", "")
            if not html:
                return self.export_pdf({"paper_id": paper_id})

            paper = load_paper(paper_id)
            title = paper.title if paper else "Untitled"

            file_path, _ = _ask_save_file(
                None, "Export to PDF", f"{title}.pdf",
                "PDF Files (*.pdf);;All Files (*)",
            )
            if not file_path:
                return {"canceled": True}

            return self._print_html_to_pdf(html, file_path)
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def _print_html_to_pdf(self, html, file_path):
        """Load HTML into an off-screen page and print it to `file_path`."""
        window = self.window
        if not (window and hasattr(window, "webview")):
            return {"error": "Webview not available"}

        try:
            from PyQt6.QtWebEngineCore import QWebEnginePage
        except ImportError:
            from PyQt5.QtWebEngineCore import QWebEnginePage

        from aqt.qt import QUrl

        # Embed the images before the page ever loads, so nothing has to be
        # fetched from disk while printing.
        html = self._inline_images_as_data_uris(html, self._media_dir())

        temp_page = QWebEnginePage(window.webview)
        self._pdf_path = file_path
        self._temp_page = temp_page

        def on_load_finished(ok):
            if ok:
                self._print_page_to_pdf(self._temp_page, self._pdf_path)

        temp_page.loadFinished.connect(on_load_finished)
        # A real directory as the base URL, not about:blank, so that any
        # local file:// image sources in the page are allowed to load.
        base = QUrl.fromLocalFile(os.path.dirname(file_path) + os.sep)
        temp_page.setHtml(html, base)

        return {"ok": True, "path": file_path}

    # ─── Page setup for printing ─────────────────────
    #
    # Half an inch on every side, given to printToPdf() explicitly.
    #
    # This has to be explicit. printToPdf()'s default page layout is
    # QPageLayout(QPageSize(A4), Portrait, QMarginsF()) — and QMarginsF()
    # default-constructs to zero on all four sides. QtWebEngine hands those to
    # Chromium as explicit custom margins, and custom margins from the embedder
    # take precedence over the stylesheet's "@page { margin }". So the printed
    # page ignored the margin printDocument.js asks for and ran text right to
    # the paper edge.
    #
    # Note the asymmetry that hid this: the CSS page SIZE *is* honored —
    # exports come out 612x792pt (Letter, from the stylesheet) rather than Qt's
    # default A4 — while the CSS margin beside it is discarded.

    PDF_MARGIN_INCHES = 0.5

    # ─── Images in the printed page ──────────────────
    #
    # Every <img> is read off disk here and embedded as a data: URI before the
    # HTML is handed to the print page.
    #
    # Loading them as local file:// URLs instead would depend on the temporary print
    # page being allowed local file access, which is a different page object
    # from the main webview and not something this add-on can check from the
    # outside. Reading the bytes ourselves removes the question: by the time
    # Chromium sees the page there are no external references left to resolve,
    # and the printed PDF is self-contained.
    #
    # Anything that cannot be read is left exactly as it was, so a missing file
    # degrades to the same broken-image icon as before rather than failing the
    # export.

    _IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]*)(")', re.IGNORECASE)

    _IMAGE_MIME = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".bmp": "image/bmp", ".avif": "image/avif", ".ico": "image/x-icon",
        ".tif": "image/tiff", ".tiff": "image/tiff",
    }

    MAX_INLINE_IMAGE_BYTES = 16 * 1024 * 1024   # per image
    MAX_INLINE_TOTAL_BYTES = 64 * 1024 * 1024   # per document

    def _local_path_for_src(self, src, media_dir):
        """The file an <img src> refers to, or None if it is not a local file."""
        if not src:
            return None

        # The src as it appears in the HTML is entity-escaped, so a file called
        # "figure & scan.png" arrives here as "figure &amp; scan.png". A browser
        # decodes that when parsing the attribute; reading the attribute text
        # directly, we have to do it ourselves or the file is never found.
        from html import unescape as _unescape
        src = _unescape(src)

        from urllib.parse import unquote, urlparse

        # A src served back from Anki's own media server (http://127.0.0.1:<port>/<name>)
        # is just a bare filename in collection.media, URL-encoded. Anything with a
        # "/" after the host is not one of ours (e.g. the add-on's own _addons/... export
        # or a sub-path we never generate), so leave that as "not a local file".
        _host_match = re.match(r"^http://127\.0\.0\.1:\d+/([^/]*)$", src)
        if _host_match:
            remainder = _host_match.group(1)
            if remainder and media_dir:
                return os.path.join(media_dir, unquote(remainder))
            return None

        low = src.lower()
        if low.startswith(("data:", "http://", "https://", "qrc:", "about:")):
            return None

        if low.startswith("file://"):
            path = unquote(urlparse(src).path)
            # "file:///x" and the "file:////x" form the editor builds both mean
            # the same absolute path.
            if os.name == "nt":
                path = path.lstrip("/")
            else:
                path = "/" + path.lstrip("/")
            return path

        path = unquote(src)
        if not os.path.isabs(path) and media_dir:
            # A bare filename in a document means a file in collection.media.
            path = os.path.join(media_dir, path)
        return path

    def _inline_images_as_data_uris(self, html, media_dir=""):
        """Replace local <img> sources with data: URIs. Returns the new HTML."""
        import base64

        budget = {"left": self.MAX_INLINE_TOTAL_BYTES}
        stats = {"inlined": 0, "skipped": 0}

        def replace(match):
            head, src, tail = match.group(1), match.group(2), match.group(3)
            try:
                path = self._local_path_for_src(src, media_dir)
                if not path or not os.path.isfile(path):
                    stats["skipped"] += 1
                    return match.group(0)

                size = os.path.getsize(path)
                if size > self.MAX_INLINE_IMAGE_BYTES or size > budget["left"]:
                    stats["skipped"] += 1
                    return match.group(0)

                mime = self._IMAGE_MIME.get(os.path.splitext(path)[1].lower())
                if not mime:
                    stats["skipped"] += 1
                    return match.group(0)

                with open(path, "rb") as fh:
                    data = base64.b64encode(fh.read()).decode("ascii")
                budget["left"] -= size
                stats["inlined"] += 1
                return f"{head}data:{mime};base64,{data}{tail}"
            except Exception:
                stats["skipped"] += 1
                return match.group(0)

        result = self._IMG_SRC_RE.sub(replace, html or "")
        if stats["inlined"] or stats["skipped"]:
            print(f"[Anki Papers] PDF images: {stats['inlined']} embedded, "
                  f"{stats['skipped']} left as-is")
        return result

    def _media_dir(self):
        try:
            if mw and mw.col:
                return mw.col.media.dir().replace("\\", "/")
        except Exception:
            pass
        return ""

    def _pdf_page_layout(self):
        """Letter portrait with PDF_MARGIN_INCHES margins, or None if the Qt
        bindings do not expose the page-layout classes."""
        try:
            from PyQt6.QtGui import QPageLayout, QPageSize
            from PyQt6.QtCore import QMarginsF
            page_size = QPageSize(QPageSize.PageSizeId.Letter)
            orientation = QPageLayout.Orientation.Portrait
            unit = QPageLayout.Unit.Inch
        except ImportError:
            try:
                from PyQt5.QtGui import QPageLayout, QPageSize
                from PyQt5.QtCore import QMarginsF
                page_size = QPageSize(QPageSize.Letter)
                orientation = QPageLayout.Portrait
                unit = QPageLayout.Inch
            except ImportError:
                return None

        m = self.PDF_MARGIN_INCHES
        return QPageLayout(page_size, orientation, QMarginsF(m, m, m, m), unit)

    def _print_page_to_pdf(self, page, file_path):
        """printToPdf() with our page layout, falling back to Qt's default if
        the layout cannot be built — never let margins stop an export."""
        layout = None
        try:
            layout = self._pdf_page_layout()
        except Exception:
            traceback.print_exc()
        if layout is None:
            page.printToPdf(file_path)
        else:
            page.printToPdf(file_path, layout)

    def export_pdf(self, args):
        """Fallback export, used only when the page supplied no HTML."""
        try:
            paper_id = args.get("paper_id", "")
            paper = load_paper(paper_id)
            if not paper:
                return {"error": "Paper not found"}

            file_path, _ = _ask_save_file(
                None, "Export to PDF", f"{paper.title}.pdf",
                "PDF Files (*.pdf);;All Files (*)",
            )
            if not file_path:
                return {"canceled": True}

            # Convert markdown to HTML for clean PDF
            html = self._markdown_to_html(paper)
            media_dir = self._media_dir()

            window = self.window
            if window and hasattr(window, 'webview'):
                # Load clean HTML into a temporary page and print to PDF
                from aqt.qt import QUrl
                try:
                    from PyQt6.QtWebEngineCore import QWebEnginePage
                except ImportError:
                    from PyQt5.QtWebEngineCore import QWebEnginePage

                html = self._inline_images_as_data_uris(html, media_dir)

                temp_page = QWebEnginePage(window.webview)
                self._pdf_path = file_path
                self._temp_page = temp_page

                def on_load_finished(ok):
                    if ok:
                        self._print_page_to_pdf(self._temp_page, self._pdf_path)

                temp_page.loadFinished.connect(on_load_finished)
                temp_page.setHtml(html, QUrl("about:blank"))

                return {"ok": True, "path": file_path}
            else:
                return {"error": "Webview not available"}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def _markdown_to_html(self, paper):
        """Convert paper content to clean HTML for PDF export."""
        content = paper.content
        lines = content.split("\n")
        body_parts = []
        media_dir = ""
        try:
            if mw and mw.col:
                media_dir = mw.col.media.dir().replace("\\", "/")
        except Exception:
            pass

        for line in lines:
            t = line.strip()
            if not t:
                body_parts.append("<br/>")
                continue

            # Headings
            hm = re.match(r'^(#{1,6})\s+(.+)$', t)
            if hm:
                level = len(hm.group(1))
                body_parts.append(f"<h{level}>{self._format_inline(hm.group(2), media_dir)}</h{level}>")
                continue

            # Divider
            if re.match(r'^---$|^\*\*\*$|^___$', t):
                body_parts.append("<hr/>")
                continue

            # Image
            im = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$', t)
            if im:
                alt = im.group(1)
                src = im.group(2)
                # Parse width
                width = ""
                wm = re.match(r'^(.+?)\|(\d+)$', alt)
                if wm:
                    alt = wm.group(1)
                    width = f' style="max-width:{wm.group(2)}px"'
                if media_dir and not src.startswith("http"):
                    src = f"file:///{media_dir}/{src}"
                body_parts.append(f'<div style="text-align:center;margin:12px 0"><img src="{src}" alt="{alt}"{width} style="max-width:100%;border-radius:6px"/></div>')
                continue

            # Blockquote
            if t.startswith("> "):
                body_parts.append(f"<blockquote>{self._format_inline(t[2:], media_dir)}</blockquote>")
                continue

            # List
            bm = re.match(r'^\s*[-*]\s+(.+)$', t)
            if bm:
                body_parts.append(f"<li>{self._format_inline(bm.group(1), media_dir)}</li>")
                continue

            # Numbered list
            nm = re.match(r'^\s*(\d+)\.\s+(.+)$', t)
            if nm:
                body_parts.append(f"<li>{self._format_inline(nm.group(2), media_dir)}</li>")
                continue

            # Basic/Reversible cards
            if ">>" in t or "<>" in t:
                card_content = re.sub(r'^\s*[-*]\s+', '', t)
                sep = "<>" if "<>" in card_content else ">>"
                parts = card_content.split(sep, 1)
                if len(parts) == 2:
                    card_type = "Reversible" if sep == "<>" else "Basic"
                    color = "#74b9ff" if sep == "<>" else "#00b894"
                    body_parts.append(
                        f'<div style="border-left:3px solid {color};padding:8px 16px;margin:8px 0;background:rgba(0,0,0,0.02);border-radius:4px">'
                        f'<div style="font-weight:600">{self._format_inline(parts[0].strip(), media_dir)}</div>'
                        f'<div style="color:{color};margin-top:4px">{self._format_inline(parts[1].strip(), media_dir)}</div>'
                        f'</div>'
                    )
                    continue

            # Default paragraph
            body_parts.append(f"<p>{self._format_inline(t, media_dir)}</p>")

        body_html = "\n".join(body_parts)
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{paper.title}</title></head>
<body style="font-family:'Segoe UI',system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.7;font-size:14px">
<h1 style="color:#2d3436;border-bottom:2px solid #6c5ce7;padding-bottom:8px;margin-bottom:24px">{paper.title}</h1>
{body_html}
<div style="margin-top:40px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#999;text-align:center">
Generated by Anki Papers
</div>
</body>
</html>"""

    def _format_inline(self, text, media_dir=""):
        """Format inline markdown elements."""
        r = text
        # Images inline
        def img_replace(m):
            alt, src = m.group(1), m.group(2)
            wm = re.match(r'^(.+?)\|(\d+)$', alt)
            style = ""
            if wm:
                alt = wm.group(1)
                style = f' style="max-width:{wm.group(2)}px"'
            if media_dir and not src.startswith("http"):
                src = f"file:///{media_dir}/{src}"
            return f'<img src="{src}" alt="{alt}"{style} style="max-width:300px;border-radius:4px;vertical-align:middle"/>'
        r = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', img_replace, r)
        # Cloze
        r = re.sub(r'\{\{(c\d+)::(.+?)\}\}', r'<u>\2</u>', r)
        r = re.sub(r'\{\{([^}:]+?)\}\}', r'<u>\1</u>', r)
        # Bold
        r = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', r)
        # Italic
        r = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', r)
        # Strikethrough
        r = re.sub(r'~~(.+?)~~', r'<del>\1</del>', r)
        # Inline code
        r = re.sub(r'`([^`]+?)`', r'<code style="background:#f0f0f0;padding:0 4px;border-radius:3px">\1</code>', r)
        return r

    # ─── Papers on disk (phase 1: write only) ────────

    def export_papers_to_disk(self, args):
        """Write every paper to the profile folder as .md + .ap.json.

        mode "preview" reports what would be written without touching the
        disk; mode "write" performs it. Either way the Anki collection is only
        read — it stays the source of truth, and nothing is deleted.
        """
        try:
            mode = args.get("mode", "preview")
            from ..core.storage import mirror_all_papers
            report = mirror_all_papers(dry_run=(mode != "write"))
            # Trim absolute paths down to what is useful in the UI.
            root = report.get("root", "")
            for entry in report.get("written", []):
                md = entry.get("md") or ""
                if root and md.startswith(root):
                    entry["path"] = md[len(root):].lstrip("/\\")
            return report
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Search ───────────────────────────────────────

    def search_papers(self, args):
        """
        Advanced search: field filters (title:, content:, folder:, deck:, tag:),
        quoted phrases, -negation, and OR branches. See core/search_query.py.
        """
        try:
            papers = list_papers()
            results = search_papers_advanced(papers, args.get("query", "") or "")
            return results
        except Exception:
            traceback.print_exc()
            return []

    # ─── Home page ────────────────────────────────────

    def get_home_stats(self, args):
        """Card-creation history for the home-page heatmap, and the paper whose
        cards were written most recently.

        A note's id is the moment it was created (epoch milliseconds), and each
        Anki Papers note is one marked line, so counting the notes of our three
        note types per local calendar day gives "lines turned into cards" per
        day -- no history of our own to keep, and it reaches back to the first
        card ever made. Notes that were deleted drop out. Generate updates
        notes in place, so editing a line never moves its day.

        last_generated is the newest note modification time, which Generate
        sets whenever it writes a note (editing a note in Anki's browser also
        sets it).
        """
        empty = {"days": {}, "first_day": None, "last_generated": None}
        try:
            col = mw.col
            if not col:
                return empty
            mids = []
            for name in ("AnkiPapers Basic", "AnkiPapers Reversible", "AnkiPapers Cloze"):
                model = col.models.by_name(name)
                if model:
                    mids.append(int(model["id"]))
            if not mids:
                return empty
            rows = col.db.all(
                "select id, mod from notes where mid in (%s)" % ",".join(str(m) for m in mids)
            )
            days = {}
            newest = None
            for nid, mod in rows:
                day = datetime.fromtimestamp(nid / 1000).strftime("%Y-%m-%d")
                days[day] = days.get(day, 0) + 1
                if newest is None or mod > newest[1]:
                    newest = (nid, mod)
            last = None
            if newest:
                owner = next(
                    (p for p in list_papers() if any(r.anki_note_id == newest[0] for r in p.card_refs)),
                    None,
                )
                last = {
                    "at": newest[1],
                    "paper_id": owner.id if owner else None,
                    "title": owner.title if owner else None,
                }
            return {"days": days, "first_day": min(days) if days else None, "last_generated": last}
        except Exception:
            traceback.print_exc()
            return empty

    # ─── Weak spots ──────────────────────────────────

    def get_note_stats(self, args):
        """Review stats for the given notes (see core.card_manager.note_review_stats)."""
        try:
            if not mw.col:
                return {"stats": {}}
            return {"stats": note_review_stats(mw.col, args.get("note_ids") or [])}
        except Exception as e:
            traceback.print_exc()
            return {"stats": {}, "error": str(e)}

    def unsuspend_note(self, args):
        try:
            n = unsuspend_note(mw.col, int(args.get("note_id")))
            return {"ok": True, "unsuspended": n}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Markdown Import/Export ────────────────────────

    def import_markdown(self, args):
        """Import a .md file as a new paper."""
        try:
            file_path, _ = _ask_open_file(
                None, "Import Markdown or a shared paper", "",
                "Markdown or Anki Papers shares (*.md *.markdown *.txt *.zip);;All Files (*)",
            )
            if not file_path:
                return {"canceled": True}
            if file_path.lower().endswith(".zip"):
                return self._import_share(file_path)
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            title = os.path.splitext(os.path.basename(file_path))[0]
            paper = Paper(title=title)
            # Code in ``` blocks arrives indented with spaces; inside a paper
            # its indentation is written with ➵ (core/code_blocks.py).
            paper.content = arrows_from_spaces(content)
            save_paper(paper)
            return paper.to_dict()
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Sharing (core/share.py) ─────────────────────

    def share_paper(self, args):
        """Save one paper, with every picture it shows, as a .zip."""
        try:
            paper = load_paper(args.get("paper_id", ""))
            if not paper:
                return {"error": "Paper not found"}
            return self._write_share([paper.to_dict()], "paper", "", paper.title)
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def share_folder(self, args):
        """Save a folder -- its subfolders, papers and pictures -- as a .zip."""
        try:
            folder = (args.get("folder_path") or "").strip("/")
            if not folder:
                return {"error": "No folder given"}
            papers = [p.to_dict() for p in list_papers()
                      if p.folder_path == folder or (p.folder_path or "").startswith(folder + "/")]
            if not papers:
                return {"error": "That folder has no papers to share yet."}
            return self._write_share(papers, "folder", folder, folder.rsplit("/", 1)[-1])
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def _write_share(self, papers, kind, root_folder, name):
        file_path, _ = _ask_save_file(
            None, "Share with pictures", f"{name}.zip", "Anki Papers share (*.zip)",
        )
        if not file_path:
            return {"canceled": True}
        if not file_path.lower().endswith(".zip"):
            file_path += ".zip"
        report = build_share(file_path, papers, self._media_dir(), kind=kind, root_folder=root_folder)
        report.update({"ok": True, "path": file_path})
        return report

    def _import_share(self, file_path):
        """Open a share: pictures into the media folder, then the papers."""
        if not is_share(file_path):
            return {"error": "That .zip wasn't made by Anki Papers' Share."}
        manifest, texts, media = read_share(file_path)

        # Pictures first. Anki's media API keeps an identical file under its
        # name and gives a different file that clashes a new name; papers are
        # rewritten to whatever name each picture ended up with.
        renamed = {}
        for name, data in media.items():
            final = self._write_media(self._media_dir(), name, data)
            if final != name:
                renamed[name] = final

        existing_ids = {p.id for p in list_papers()}
        planned = plan_import(manifest, texts, existing_ids, renamed)

        folder_root = ""
        if manifest.get("kind") == "folder":
            wanted = manifest.get("root_folder") or "Shared"
            folders = load_folder_structure()
            folder_root, k = wanted, 2
            while self._folder_exists(folders, folder_root):
                folder_root = f"{wanted} ({k})"
                k += 1

        created = []
        for item in planned:
            rel = item["folder"]
            if folder_root:
                rest = rel.split("/", 1)[1] if "/" in rel else ""
                folder_path = folder_root + ("/" + rest if rest else "")
                self._ensure_folder_path(folder_path)
            else:
                folder_path = ""
            paper = Paper(title=item["title"], content=item["content"], deck_name=item["deck_name"],
                          folder_path=folder_path, paper_id=item["id"])
            paper.tags = item["tags"]
            save_paper(paper)
            created.append(paper)

        if not created:
            return {"error": "The share had no papers in it."}
        result = created[0].to_dict()
        result.update({
            "share": True,
            "kind": manifest.get("kind") or "paper",
            "folder": folder_root,
            "papers": len(created),
            "pictures": len(media),
            "missing": manifest.get("missing") or [],
        })
        return result

    def _folder_exists(self, folders, path):
        def walk(node):
            for c in node.get("children", []):
                if isinstance(c, dict) and c.get("type") == "folder":
                    if c.get("path") == path or walk(c):
                        return True
            return False
        return walk(folders)

    def _ensure_folder_path(self, path):
        """Create every folder along `path` that doesn't exist yet."""
        folders = load_folder_structure()
        changed = False
        parent = folders
        built = ""
        for seg in [s for s in path.split("/") if s]:
            built = f"{built}/{seg}" if built else seg
            node = next((c for c in parent.get("children", [])
                         if isinstance(c, dict) and c.get("type") == "folder" and c.get("path") == built), None)
            if node is None:
                node = {"type": "folder", "name": seg, "path": built, "children": []}
                parent.setdefault("children", []).append(node)
                changed = True
            parent = node
        if changed:
            save_folder_structure(folders)

    def export_markdown(self, args):
        """Export a paper as a .md file."""
        try:
            paper = load_paper(args.get("paper_id", ""))
            if not paper:
                return {"error": "Paper not found"}
            file_path, _ = _ask_save_file(
                None, "Export Markdown", f"{paper.title}.md",
                "Markdown Files (*.md);;All Files (*)",
            )
            if not file_path:
                return {"canceled": True}
            with open(file_path, "w", encoding="utf-8") as f:
                # ➵ back to spaces, so the exported code runs anywhere.
                f.write(expand_arrows_in_markdown(paper.content))
            return {"ok": True, "path": file_path}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    # ─── Settings ────────────────────────────────────

    # ─── Web browser pane ────────────────────────────

    def set_web_browser(self, args):
        """Show or hide the browser docked beside the editor (gui/web_browser.py)."""
        if self.window is None:
            return {"open": False}
        theme = args.get("theme") if isinstance(args.get("theme"), dict) else None
        return {"open": self.window.set_web_browser_open(bool(args.get("open")), theme)}

    def get_web_browser(self, args):
        if self.window is None:
            return {"open": False}
        return {"open": self.window.web_browser_open()}

    def get_settings(self, args):
        try:
            config = mw.addonManager.getConfig(__name__.split(".")[0]) or {}
            defaults = {
                "default_deck": "Default",
                "auto_save_interval_seconds": 30,
                "font_size": 14,
                "font_family": "JetBrains Mono",
                "editor_theme": "dark",
                "show_card_indicators": True,
                "show_line_numbers": True,
                "anki_edit_conflict": "ask",
                "text_replacements_enabled": True,
                "card_style": "basic",
                "color_scheme": "carolina",
                "weak_spot_markers": True,
                "toolbar_scroll": False,
                "show_waiting_chapters": False,
                "show_chapter_bar": False,
            }
            for key, value in defaults.items():
                config.setdefault(key, value)
            return config
        except Exception:
            traceback.print_exc()
            return {}

    def convert_emphasis_to_tags(self, args):
        """One-time tidy-up: rewrite Markdown **bold** / *italic* in every paper
        as <b> / <i> tags (see core/emphasis.py for exactly what is converted).

        dry_run (the default) only reports what would change. A real run first
        writes a backup of EVERY paper to <profile>/ankipapers/backups/ --
        outside the papers folder, so it is never read as a paper -- and then
        saves each changed paper through the normal save path, so the file on
        disk and the copy in the collection stay identical.
        """
        try:
            dry_run = args.get("dry_run", True) is not False
            papers = [load_paper(p.id) or p for p in list_papers()]
            plan = []
            for paper in papers:
                old = paper.content or ""
                new, n_bold, n_italic = convert_emphasis_to_tags(old)
                if new != old:
                    plan.append((paper, new, n_bold, n_italic))
            report = {
                "scanned": len(papers),
                "papers": len(plan),
                "bold": sum(p[2] for p in plan),
                "italic": sum(p[3] for p in plan),
                "dry_run": dry_run or not plan,
            }
            if report["dry_run"]:
                return report

            backup_dir = os.path.join(get_ankipapers_dir(), "backups")
            os.makedirs(backup_dir, exist_ok=True)
            stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
            backup_path = os.path.join(backup_dir, f"bold-italic-conversion_{stamp}.json")
            with open(backup_path, "w", encoding="utf-8") as fh:
                json.dump([p.to_dict() for p in papers], fh, ensure_ascii=False, indent=1)

            failures = []
            for paper, new, _b, _i in plan:
                try:
                    paper.content = new
                    save_paper(paper)
                except Exception as e:
                    traceback.print_exc()
                    failures.append({"title": paper.title or "Untitled", "error": str(e)})
            report.update(backup=backup_path, failures=failures)
            return report
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def get_text_replacements(self, args):
        """The user's macOS Text Replacements, for the editor to apply as
        they type. Empty off macOS -- see gui/text_replacements.py."""
        try:
            return {"items": get_text_replacements()}
        except Exception as e:
            traceback.print_exc()
            return {"items": [], "error": str(e)}

    def _card_style(self) -> str:
        """The Card style setting: "basic" or "solarized"."""
        config = mw.addonManager.getConfig(__name__.split(".")[0]) or {}
        return config.get("card_style") or "basic"

    def _color_scheme(self) -> str:
        """The Color scheme setting: "carolina", "purple" or "mono"."""
        config = mw.addonManager.getConfig(__name__.split(".")[0]) or {}
        return config.get("color_scheme") or "carolina"

    def save_settings(self, args):
        try:
            settings = args.get("settings") or {}
            previous = (self._card_style(), self._color_scheme())
            mw.addonManager.writeConfig(__name__.split(".")[0], settings)
            result = {"ok": True}
            # A new card style or color scheme is written onto the note types
            # straight away, so every existing card changes look now rather
            # than at the next Generate. A failure here must not undo the
            # settings save.
            new_style = settings.get("card_style") or "basic"
            new_scheme = settings.get("color_scheme") or "carolina"
            if (new_style, new_scheme) != previous and mw.col:
                try:
                    ensure_note_types(mw.col, new_style, new_scheme)
                    result["card_style_applied"] = True
                except Exception as e:
                    traceback.print_exc()
                    result["card_style_error"] = str(e)
            return result
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}
