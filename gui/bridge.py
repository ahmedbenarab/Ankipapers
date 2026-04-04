"""
QWebChannel Bridge for Anki Papers.

Exposes Python backend methods to the React frontend via QWebChannel.
Each method takes/returns JSON strings for serialization.
"""

import os
import json
import shutil
import traceback
import time
import re
import uuid

from aqt.qt import QObject, pyqtSlot, pyqtSignal, QFileDialog, QApplication, QImage, QTimer
from aqt import mw

from ..core.paper import Paper
from ..core.storage import (
    save_paper,
    load_paper,
    delete_paper,
    list_papers,
    save_folder_structure,
    load_folder_structure,
)
from ..core.card_manager import (
    generate_cards as run_generate_cards,
    remove_paper_cards,
    list_anki_edit_conflicts,
    AnkiEditConflictAbort,
)

MAX_FOLDER_DEPTH = 3  # Maximum nesting level for sub-folders


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


class AnkiPapersBridge(QObject):
    """Bridge object exposed to JavaScript via QWebChannel."""

    papers_changed = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)

    # ─── Paper CRUD ──────────────────────────────────

    @pyqtSlot(result=str)
    def list_papers(self):
        try:
            papers = list_papers()
            return json.dumps([p.to_dict() for p in papers], ensure_ascii=False)
        except Exception:
            traceback.print_exc()
            return json.dumps([])

    @pyqtSlot(str, result=str)
    def load_paper(self, paper_id):
        try:
            paper = load_paper(paper_id)
            if paper:
                return json.dumps(paper.to_dict(), ensure_ascii=False)
            return json.dumps({"error": "Paper not found"})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str, result=str)
    def save_paper(self, paper_json):
        try:
            data = json.loads(paper_json)
            paper = load_paper(data.get("id", ""))
            if paper:
                paper.title = data.get("title", paper.title)
                paper.content = data.get("content", paper.content)
                paper.deck_name = data.get("deck_name", paper.deck_name)
                paper.folder_path = data.get("folder_path", paper.folder_path)
                paper.tags = data.get("tags", paper.tags)
            else:
                paper = Paper.from_dict(data)
            save_paper(paper)
            return json.dumps({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str, str, result=str)
    def create_paper(self, title, folder_path):
        try:
            paper = Paper(title=title, folder_path=folder_path)
            paper.content = f"# {title}\n\nStart writing your notes here...\n"
            save_paper(paper)
            return json.dumps(paper.to_dict(), ensure_ascii=False)
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str, result=str)
    def delete_paper(self, paper_id):
        try:
            paper = load_paper(paper_id)
            if paper and mw and mw.col:
                remove_paper_cards(paper, mw.col)
                mw.reset()
            delete_paper(paper_id)
            return json.dumps({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str, str, result=str)
    def move_paper_to_folder(self, paper_id, folder_path):
        try:
            paper = load_paper(paper_id)
            if paper:
                paper.folder_path = folder_path
                save_paper(paper)
                return json.dumps({"ok": True})
            return json.dumps({"error": "Paper not found"})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    # ─── Card Generation ─────────────────────────────

    @pyqtSlot(str, result=str)
    def check_anki_edit_conflicts(self, paper_id):
        """List rows where the paper line is unchanged but the Anki note was edited."""
        try:
            if not mw or not mw.col:
                return json.dumps({"error": "Anki collection not available"})
            paper = load_paper(paper_id)
            if not paper:
                return json.dumps({"error": "Paper not found"})
            conflicts = list_anki_edit_conflicts(paper, mw.col)
            return json.dumps({"conflicts": conflicts}, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str, str, result=str)
    def generate_cards(self, paper_id, anki_edit_conflict):
        """
        anki_edit_conflict: preserve | overwrite | abort
        abort returns error payload if conflicts exist (no collection changes).
        """
        try:
            if not mw or not mw.col:
                return json.dumps({"error": "Anki collection not available"})
            paper = load_paper(paper_id)
            if not paper:
                return json.dumps({"error": "Paper not found"})
            policy = (anki_edit_conflict or "preserve").strip().lower()
            if policy not in ("preserve", "overwrite", "abort"):
                policy = "preserve"
            try:
                created, updated, deleted = run_generate_cards(paper, mw.col, policy)
            except AnkiEditConflictAbort as ex:
                return json.dumps(
                    {
                        "error": "anki_edit_conflicts",
                        "conflicts": ex.conflicts,
                    },
                    ensure_ascii=False,
                )
            save_paper(paper)
            mw.reset()
            return json.dumps({"created": created, "updated": updated, "deleted": deleted})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    # ─── Decks & Folders ─────────────────────────────

    @pyqtSlot(result=str)
    def get_decks(self):
        try:
            if mw and mw.col:
                names = sorted([d.name for d in mw.col.decks.all_names_and_ids()])
                return json.dumps(names)
            return json.dumps(["Default"])
        except Exception:
            traceback.print_exc()
            return json.dumps(["Default"])

    @pyqtSlot(result=str)
    def get_folders(self):
        try:
            return json.dumps(load_folder_structure(), ensure_ascii=False)
        except Exception:
            traceback.print_exc()
            return json.dumps({"name": "Root", "children": []})

    @pyqtSlot(str, str, result=str)
    def create_folder(self, name, parent_path):
        try:
            # Check depth limit
            current_depth = len(parent_path.split("/")) if parent_path else 0
            if current_depth >= MAX_FOLDER_DEPTH:
                return json.dumps({
                    "error": f"Maximum folder depth ({MAX_FOLDER_DEPTH}) reached"
                })

            folders = load_folder_structure()
            full_path = f"{parent_path}/{name}" if parent_path else name
            new_folder = {"type": "folder", "name": name, "path": full_path, "children": []}
            if not parent_path:
                folders.setdefault("children", []).append(new_folder)
            else:
                self._add_child(folders, parent_path, new_folder)
            save_folder_structure(folders)
            return json.dumps({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    def _add_child(self, node, target_path, new_child):
        for child in node.get("children", []):
            if child.get("path") == target_path:
                child.setdefault("children", []).append(new_child)
                return True
            if self._add_child(child, target_path, new_child):
                return True
        return False

    # ─── Images ──────────────────────────────────────

    @pyqtSlot(result=str)
    def get_media_dir(self):
        """Get the Anki collection media folder path."""
        try:
            if mw and mw.col:
                media_dir = mw.col.media.dir()
                return json.dumps({"path": media_dir.replace("\\", "/")})
            return json.dumps({"path": ""})
        except Exception:
            traceback.print_exc()
            return json.dumps({"path": ""})

    @pyqtSlot(result=str)
    def pick_image(self):
        """Open file picker and copy image to Anki media folder."""
        try:
            file_path, _ = QFileDialog.getOpenFileName(
                None, "Select Image", "",
                "Images (*.png *.jpg *.jpeg *.gif *.svg *.webp *.bmp);;All Files (*)",
            )
            if not file_path:
                return json.dumps({"cancelled": True})

            # Copy to Anki media folder
            if mw and mw.col:
                media_dir = mw.col.media.dir()
            else:
                addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                media_dir = os.path.join(addon_dir, "user_files", "images")
                os.makedirs(media_dir, exist_ok=True)

            basename = os.path.basename(file_path)
            name, ext = os.path.splitext(basename)
            unique_name = f"ankipapers_{name}_{int(time.time())}{ext}"
            dest_path = os.path.join(media_dir, unique_name)
            shutil.copy2(file_path, dest_path)

            return json.dumps({
                "filename": unique_name,
                "markdown": f"![{name}]({unique_name})",
            })
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})
    @pyqtSlot(result=str)
    def paste_image(self):
        """Save image from clipboard and return markdown."""
        try:
            clipboard = QApplication.clipboard()
            image = clipboard.image()
            if image.isNull():
                return json.dumps({"error": "No image in clipboard"})

            if mw and mw.col:
                media_dir = mw.col.media.dir()
            else:
                addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                media_dir = os.path.join(addon_dir, "user_files", "images")
                os.makedirs(media_dir, exist_ok=True)

            unique_name = f"ankipapers_paste_{int(time.time())}.png"
            dest_path = os.path.join(media_dir, unique_name)
            image.save(dest_path, "PNG")

            return json.dumps({
                "filename": unique_name,
                "markdown": f"![pasted]({unique_name})",
            })
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str)
    def open_in_browser(self, note_id_str):
        """Open the Anki browser and search for the note."""
        if not mw:
            print("[Anki Papers] open_in_browser: main window not available")
            return
        try:
            note_id = int(note_id_str)
        except (TypeError, ValueError):
            print(f"[Anki Papers] open_in_browser: invalid note id {note_id_str!r}")
            return

        query = f"nid:{note_id}"

        browser = self._get_or_open_browser()
        if not browser:
            print("[Anki Papers] open_in_browser: could not open browser")
            return

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

    @pyqtSlot(str, result=str)
    def diagnose_crosslink(self, note_id_str):
        """
        Debug: verify nid resolution and Browser selection API (Settings → test field).
        """
        try:
            note_id = int(note_id_str.strip())
        except (TypeError, ValueError):
            return json.dumps({"error": "invalid_note_id", "raw": note_id_str})

        query = f"nid:{note_id}"
        out: dict = {"note_id": note_id, "query": query}

        if not mw or not mw.col:
            out["error"] = "no_collection"
            return json.dumps(out, ensure_ascii=False)

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

        return json.dumps(out, ensure_ascii=False)

    @pyqtSlot(str)
    def open_url(self, url):
        """Open a URL in the system browser."""
        try:
            from aqt.utils import openLink
            openLink(url)
        except Exception:
            traceback.print_exc()

    @pyqtSlot(str, str, result=str)
    def move_cards_to_deck(self, paper_id, deck_name):
        """Move all cards of a paper to a new deck."""
        try:
            paper = load_paper(paper_id)
            if not paper or not mw or not mw.col:
                return json.dumps({"error": "Paper or collection not found"})
            
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
            return json.dumps({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})
    # ─── PDF Export ──────────────────────────────────

    @pyqtSlot(str, result=str)
    def export_pdf(self, paper_id):
        """Export a paper to a clean PDF document."""
        try:
            paper = load_paper(paper_id)
            if not paper:
                return json.dumps({"error": "Paper not found"})

            file_path, _ = QFileDialog.getSaveFileName(
                None, "Export to PDF", f"{paper.title}.pdf",
                "PDF Files (*.pdf);;All Files (*)",
            )
            if not file_path:
                return json.dumps({"cancelled": True})

            # Convert markdown to HTML for clean PDF
            html = self._markdown_to_html(paper)

            parent = self.parent()
            if parent and hasattr(parent, 'webview'):
                # Load clean HTML into a temporary page and print to PDF
                from aqt.qt import QUrl
                try:
                    from PyQt6.QtWebEngineCore import QWebEnginePage
                except ImportError:
                    from PyQt5.QtWebEngineCore import QWebEnginePage

                temp_page = QWebEnginePage(parent.webview)
                self._pdf_path = file_path
                self._temp_page = temp_page

                def on_load_finished(ok):
                    if ok:
                        self._temp_page.printToPdf(self._pdf_path)

                temp_page.loadFinished.connect(on_load_finished)
                temp_page.setHtml(html, QUrl("about:blank"))

                return json.dumps({"ok": True, "path": file_path})
            else:
                return json.dumps({"error": "Webview not available"})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

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

    # ─── Search ───────────────────────────────────────

    @pyqtSlot(str, result=str)
    def search_papers(self, query):
        """Full-text search across all papers. Returns matching paper IDs + snippets."""
        try:
            papers = list_papers()
            q = query.strip().lower()
            if not q:
                return json.dumps([])
            results = []
            for p in papers:
                title_match = q in p.title.lower()
                content_lower = p.content.lower()
                content_match = q in content_lower
                if title_match or content_match:
                    snippet = ""
                    if content_match:
                        idx = content_lower.index(q)
                        start = max(0, idx - 40)
                        end = min(len(p.content), idx + len(q) + 40)
                        snippet = ("..." if start > 0 else "") + p.content[start:end].replace("\n", " ") + ("..." if end < len(p.content) else "")
                    results.append({
                        "id": p.id,
                        "title": p.title,
                        "folder_path": p.folder_path,
                        "snippet": snippet,
                        "title_match": title_match,
                        "content_match": content_match,
                    })
            return json.dumps(results, ensure_ascii=False)
        except Exception as e:
            traceback.print_exc()
            return json.dumps([])

    # ─── Markdown Import/Export ────────────────────────

    @pyqtSlot(result=str)
    def import_markdown(self):
        """Import a .md file as a new paper."""
        try:
            file_path, _ = QFileDialog.getOpenFileName(
                None, "Import Markdown", "",
                "Markdown Files (*.md *.markdown *.txt);;All Files (*)",
            )
            if not file_path:
                return json.dumps({"cancelled": True})
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
            title = os.path.splitext(os.path.basename(file_path))[0]
            paper = Paper(title=title)
            paper.content = content
            save_paper(paper)
            return json.dumps(paper.to_dict(), ensure_ascii=False)
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    @pyqtSlot(str, result=str)
    def export_markdown(self, paper_id):
        """Export a paper as a .md file."""
        try:
            paper = load_paper(paper_id)
            if not paper:
                return json.dumps({"error": "Paper not found"})
            file_path, _ = QFileDialog.getSaveFileName(
                None, "Export Markdown", f"{paper.title}.md",
                "Markdown Files (*.md);;All Files (*)",
            )
            if not file_path:
                return json.dumps({"cancelled": True})
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(paper.content)
            return json.dumps({"ok": True, "path": file_path})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})

    # ─── Settings ────────────────────────────────────

    @pyqtSlot(result=str)
    def get_settings(self):
        try:
            config = mw.addonManager.getConfig(__name__.split(".")[0]) or {}
            defaults = {
                "default_deck": "Default",
                "auto_save_interval_seconds": 30,
                "font_size": 14,
                "font_family": "JetBrains Mono",
                "editor_theme": "dark",
                "show_card_indicators": True,
                "anki_edit_conflict": "ask",
            }
            for key, value in defaults.items():
                config.setdefault(key, value)
            return json.dumps(config, ensure_ascii=False)
        except Exception:
            traceback.print_exc()
            return json.dumps({})

    @pyqtSlot(str, result=str)
    def save_settings(self, settings_json):
        try:
            settings = json.loads(settings_json)
            mw.addonManager.writeConfig(__name__.split(".")[0], settings)
            return json.dumps({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return json.dumps({"error": str(e)})
