"""
Which image occlusion cards were made from a paper's pictures.

Anki's built-in image occlusion keeps the picture in the note's Image field as
<img src="name">. A picture that is already in the media folder keeps its
name when it is occluded (Anki reuses a file whose name and contents match),
so the field names the same file the paper shows.

One note holds every mask drawn on its picture and makes one card per mask
or group, so a picture's count is the cards of all its notes, not the notes.
"""

from html import unescape
from typing import Dict, Iterable, List, Tuple
from urllib.parse import unquote

from .media_refs import media_names, nfc


def _key(name: str) -> str:
    # The field may hold the name URL-quoted or HTML-escaped; the paper holds
    # it as typed. Compare them as one.
    return nfc(unquote(unescape(name or "")))


def tally_occlusions(
    rows: Iterable[Tuple[int, str, int]], wanted: List[str]
) -> Dict[str, dict]:
    """Cards and note ids per picture, for the pictures in `wanted`.

    rows are (note_id, image_field_html, card_count), one per occlusion note.
    Only pictures with at least one note appear in the result, keyed by the
    name exactly as the paper wrote it.
    """
    want = {_key(n): n for n in wanted}
    out: Dict[str, dict] = {}
    for note_id, image_html, cards in rows:
        for src in media_names(image_html):
            name = want.get(_key(src))
            if name is None:
                continue
            entry = out.setdefault(name, {"cards": 0, "note_ids": []})
            if note_id not in entry["note_ids"]:
                entry["note_ids"].append(note_id)
                entry["cards"] += int(cards or 0)
            break
    return out
