"""
Image occlusion cards from a paper's pictures, made with Anki's built-in tool.

Right-clicking a picture opens Anki's Add window on the Image Occlusion note
type, set to the paper's deck, with the picture already in the mask editor.
A badge on the picture counts the cards made from it; clicking the badge
opens those notes in the Browser, whose editor shows their masks.

Anki 26.9 opens the classic Add window unless its experimental Svelte editor
is switched on, so this drives the classic one: AddCards.set_note_type(),
set_deck() and Editor.setup_mask_editor_for_new_note(), the same calls the
Add window's own "Image Occlusion" button ends in.

Mixed into AnkiPapersBridge; see _occlusion_dispatch().
"""

import traceback
from typing import Any, Dict, List

from aqt import mw
from aqt.utils import tooltip

from ..core.card_manager import get_deck_id
from ..core.media_refs import find_media_file
from ..core.occlusion import tally_occlusions
from ..core.storage import load_paper


def _io_notetypes(col) -> List[dict]:
    """Every image occlusion note type, found the way Anki finds them.

    Note types can be renamed, so they are matched on the stock kind they
    were made from, not on their name.
    """
    from anki.models import StockNotetype

    kind = StockNotetype.OriginalStockKind.ORIGINAL_STOCK_KIND_IMAGE_OCCLUSION
    return [m for m in col.models.all() if m.get("originalStockKind") == kind]


def _image_field_index(col, notetype: dict) -> int:
    try:
        return int(col._backend.get_image_occlusion_fields(notetype["id"]).image)
    except Exception:
        names = [f["name"] for f in notetype.get("flds", [])]
        return names.index("Image") if "Image" in names else 1


def _occlusion_counts(col, names: List[str]) -> Dict[str, dict]:
    rows = []
    for nt in _io_notetypes(col):
        index = _image_field_index(col, nt)
        for note_id, flds, cards in col.db.all(
            "select n.id, n.flds, (select count() from cards c where c.nid = n.id) "
            "from notes n where n.mid = ?",
            nt["id"],
        ):
            parts = flds.split("\x1f")
            rows.append((note_id, parts[index] if index < len(parts) else "", cards))
    return tally_occlusions(rows, names)


def notify_occlusions_changed(changes, handler) -> None:
    """operation_did_execute hook: tell an open Anki Papers page to recount.

    Adding a note in the Add window, editing masks in the Browser and
    deleting notes all run as collection operations, so this one hook keeps
    the badges current.
    """
    try:
        if not (changes.note_text or changes.card):
            return
        from .webview import AnkiPapersWindow

        win = AnkiPapersWindow._instance
        if win is None or not win.isVisible():
            return
        win.webview.eval(
            "window.ankiPapersOcclusionsChanged && window.ankiPapersOcclusionsChanged()"
        )
    except Exception:
        traceback.print_exc()


class OcclusionMixin:
    """Methods added to AnkiPapersBridge; see _occlusion_dispatch()."""

    def _occlusion_dispatch(self) -> Dict[str, Any]:
        return {
            "occlusion_counts": self.occlusion_counts,
            "occlusion_create": self.occlusion_create,
            "occlusion_edit": self.occlusion_edit,
        }

    def occlusion_counts(self, args):
        """{counts: {name: {cards, note_ids}}} for the pictures named."""
        try:
            names = [n for n in (args.get("names") or []) if isinstance(n, str) and n]
            if not names or not (mw and mw.col):
                return {"counts": {}}
            return {"counts": _occlusion_counts(mw.col, names)}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def occlusion_create(self, args):
        """Open the Add window's mask editor on a picture, in the paper's deck."""
        try:
            col = mw.col
            name = args.get("name") or ""
            path = find_media_file(col.media.dir(), name)
            if not path:
                return {"error": "That picture is not in Anki's media folder."}

            notetypes = _io_notetypes(col)
            if not notetypes:
                col.add_image_occlusion_notetype()
                notetypes = _io_notetypes(col)
            if not notetypes:
                return {"error": "Anki could not make an Image Occlusion note type."}
            # Prefer the stock one when several were made (e.g. by shared decks).
            notetype = next((m for m in notetypes if m["name"] == "Image Occlusion"), notetypes[0])

            # The paper's deck is the whole point; never fall back to Default.
            paper = load_paper(args.get("paper_id") or "")
            if paper is None:
                return {"error": "Could not find this paper, so the deck is unknown. Save the paper and try again."}
            deck_id = get_deck_id(col, paper.deck_name)

            from aqt import dialogs

            add = dialogs.open("AddCards", mw)
            # Reopening an Add window that holds a note in progress keeps that
            # note; switching it to Image Occlusion would throw the note away.
            if not add.editor.fieldsAreBlank():
                tooltip("Add or clear the note in the Add window first, then try again.", parent=add)
                return {"error": "add_window_busy"}
            # Load the note with the picture already in its Image field. Left
            # to the mask editor, the picture goes into whichever field the
            # page thinks is Image -- and right after a note type switch the
            # page has not looked that up yet, so it lands in the Occlusion
            # field, the masks overwrite it on Add, and the cards are added
            # without their picture.
            note = col.new_note(notetype)
            note.fields[_image_field_index(col, notetype)] = add.editor.fnameToLink(col.media.add_file(path))
            note.tags = list(add.editor.note.tags) if add.editor.note else []
            # set_note() switches the note type first and the deck after it
            # (switching moves the deck to the one last used with that type).
            add.set_note(note, deck_id=deck_id)
            add.editor.setup_mask_editor_for_new_note(image_path=path, notetype_id=notetype["id"])
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}

    def occlusion_edit(self, args):
        """Show a picture's occlusion notes in the Browser, first one selected."""
        try:
            name = args.get("name") or ""
            entry = _occlusion_counts(mw.col, [name]).get(name)
            if not entry:
                return {"error": "No image occlusion cards were made from this picture."}
            note_ids = entry["note_ids"]
            query = "nid:" + ",".join(str(n) for n in note_ids)
            self._show_notes_in_browser(query, note_ids[0])
            return {"ok": True}
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e)}
