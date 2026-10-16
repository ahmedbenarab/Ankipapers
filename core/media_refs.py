"""
The pictures a paper uses, and the names new pictures are given.

A paper shows a picture with ![alt](name) or <img src="name">, where name is
a file in Anki's media folder (collection.media). Everything that needs to
know which pictures belong to papers -- sharing, and keeping Anki's
Check Media from deleting them -- reads them through media_names() here.

New pictures are named from their contents: _ap_<hash>.<ext>.
  * The same picture gets the same name on every computer, so sharing never
    duplicates it and two different pictures can never collide.
  * The leading underscore is Anki's own rule for "used by something other
    than a card": Check Media never lists such a file as unused, on desktop,
    AnkiMobile or AnkiDroid alike.
"""

import hashlib
import os
import re
import unicodedata
from typing import Dict, Iterable, List
from urllib.parse import unquote

# ![alt](src) -- the alt may carry a width, ![alt|300](src)
_MD_IMG = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
# <img ... src="src" ...>
_HTML_IMG = re.compile(r"""(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2""", re.IGNORECASE)

_REMOTE = ("http://", "https://", "data:", "file:", "//", "blob:")


def is_media_name(src: str) -> bool:
    """True for a file in the media folder rather than a web or data image."""
    s = (src or "").strip()
    if not s or s.lower().startswith(_REMOTE) or s.startswith("/"):
        return False
    return "/" not in s and "\\" not in s


def nfc(name: str) -> str:
    # Anki stores media names NFC-normalized; a name typed or pasted on macOS
    # can arrive decomposed. Compare the two forms as one.
    return unicodedata.normalize("NFC", name or "")


def media_names(content: str) -> List[str]:
    """Every media-folder picture the text uses, in order, each once."""
    seen, out = set(), []
    text = content or ""
    srcs = [m.group(2).strip() for m in _MD_IMG.finditer(text)]
    srcs += [m.group(3).strip() for m in _HTML_IMG.finditer(text)]
    for src in srcs:
        if is_media_name(src) and src not in seen:
            seen.add(src)
            out.append(src)
    return out


def all_media_names(contents: Iterable[str]) -> List[str]:
    seen, out = set(), []
    for c in contents:
        for n in media_names(c):
            if n not in seen:
                seen.add(n)
                out.append(n)
    return out


def rename_media(content: str, mapping: Dict[str, str]) -> str:
    """Point picture references at new names (both ![]() and <img src>)."""
    if not mapping:
        return content

    def md(m):
        src = m.group(2).strip()
        new = mapping.get(src)
        return f"![{m.group(1)}]({new})" if new else m.group(0)

    def tag(m):
        new = mapping.get(m.group(3).strip())
        return f"{m.group(1)}{m.group(2)}{new}{m.group(2)}" if new else m.group(0)

    return _HTML_IMG.sub(tag, _MD_IMG.sub(md, content or ""))


def find_media_file(media_dir: str, name: str):
    """Path of a referenced picture in the media folder, or None."""
    for candidate in (name, unquote(name), nfc(name), nfc(unquote(name))):
        path = os.path.join(media_dir, candidate)
        if os.path.isfile(path):
            return path
    return None


_IMG_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".tif", ".tiff"}


def content_name(data: bytes, ext: str) -> str:
    """_ap_<hash><ext> for a new picture, from its bytes."""
    ext = (ext or "").lower()
    if ext not in _IMG_EXTS:
        ext = ".png"
    if ext == ".jpeg":
        ext = ".jpg"
    return f"_ap_{hashlib.sha1(data).hexdigest()[:16]}{ext}"


def filter_check_media(unused: List[str], report: str, used_names: Iterable[str]):
    """What Anki's Check Media should show once papers' pictures are kept.

    Returns (kept, report): `kept` are the names in `unused` that papers use
    (remove them from the list Delete Unused acts on); `report` is the text
    without their "Unused: <name>" lines, with the count fixed and a note on
    what was kept. Used by gui/media_protect.py.
    """
    used = {nfc(n) for n in used_names}
    kept = [n for n in unused if nfc(n) in used]
    if not kept:
        return [], report
    kept_set = set(kept)
    lines = []
    for line in (report or "").split("\n"):
        # One "Unused: <name>" line per file. The label is translated, so
        # match on what follows the first ": ".
        _, sep, rest = line.partition(": ")
        if sep and rest in kept_set:
            continue
        lines.append(line)
    out = "\n".join(lines)
    left = len(unused) - len(kept)
    # English count line, "Unused files: ⁨N⁩"; other languages keep theirs.
    out = re.sub(r"(Unused files: ⁨?)(\d+)(⁩?)",
                 lambda m: f"{m.group(1)}{left}{m.group(3)}", out, count=1)
    noun = "picture" if len(kept) == 1 else "pictures"
    note = (f"Anki Papers kept {len(kept)} {noun} that your papers show. "
            "They aren't listed as unused, and Delete Unused won't remove them.\n\n")
    return kept, note + out
