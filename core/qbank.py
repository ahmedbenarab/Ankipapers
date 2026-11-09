"""Question-bank tags: tie a heading to qbank questions, tag its cards in Anki.

A heading carries the question ids in a hidden comment, written flush after
its text (before the line's own <!--ap:uuid--> anchor, which stays last):

    ## Hypertrophic cardiomyopathy<!--uw:3252,4410-->

The comment never shows in the rendered paper, in breadcrumbs, search, print
or on a card; the editor shows it only while the line is being edited. Every
card under the line -- by the same rule folding uses: each line above it with
a smaller indent is one of its parents -- is tagged "<prefix>::3252" and
"<prefix>::4410" in Anki, and those tags are kept in step with the paper on
every generate: an id taken off the heading comes off the cards. Only tags
under the current prefix are touched; anything else on a note is the user's.

The prefix ("UWorldABIM" by default) is chosen per paper, then per folder
(nearest folder up the tree), then in Settings, so the same comment can feed
MKSAP or Board Vitals tags in another folder.
"""
import json
import os
import re
from typing import Dict, Iterable, List, Optional, Tuple

DEFAULT_PREFIX = "UWorldABIM"

# <!--uw:3252,4410--> anywhere on a line; ids separated by commas or spaces.
QBANK_COMMENT_RE = re.compile(r"<!--uw:([^>]*?)-->", re.IGNORECASE)
_ID_RE = re.compile(r"[A-Za-z0-9_.-]+")

# Folder-level settings live in the folder itself, so a rename or a move
# carries them along without any bookkeeping.
FOLDER_SETTINGS_NAME = ".ankipapers-folder.json"


def qbank_ids_in(line: str) -> List[str]:
    """The ids in every <!--uw:...--> comment on `line`, in order, no repeats."""
    ids: List[str] = []
    for m in QBANK_COMMENT_RE.finditer(line or ""):
        for qid in _ID_RE.findall(m.group(1)):
            if qid not in ids:
                ids.append(qid)
    return ids


def strip_qbank_comments(text: str) -> str:
    """`text` without its <!--uw:...--> comments."""
    return QBANK_COMMENT_RE.sub("", text or "")


def _indent(line: str) -> int:
    """Outline level: four spaces or a tab each (parser.get_indent's rule)."""
    s = (line or "").rstrip()
    level = 0
    while s.startswith("    ") or s.startswith("\t"):
        level += 1
        s = s[1:] if s.startswith("\t") else s[4:]
    return level


def inherited_qbank_ids(lines: List[str], index: int, code_lines: Optional[Dict] = None) -> List[str]:
    """Question ids for the card on lines[index]: its own, then every parent's.

    Parents are found the way breadcrumbs and folding find them: walking up,
    blank lines are skipped and each line with a smaller indent than the last
    parent is the next parent. Unlike breadcrumbs the walk does not stop at a
    heading -- a heading is exactly where the ids are expected. A ``` block
    counts as one line at its opening fence's level, and never holds ids.
    """
    code_lines = code_lines or {}
    ids = qbank_ids_in(lines[index])
    current = _indent(lines[index])
    i = index
    while i > 0 and current > 0:
        i -= 1
        line = lines[i]
        if not line.strip():
            continue
        block = code_lines.get(i)
        if block is not None:
            current = min(current, _indent(lines[block.open]))
            i = block.open
            continue
        level = _indent(line)
        if level < current:
            for qid in qbank_ids_in(line):
                if qid not in ids:
                    ids.append(qid)
            current = level
    return ids


def clean_prefix(prefix: Optional[str]) -> str:
    """A prefix as Anki can use it: no spaces, no stray "::" at either end."""
    p = re.sub(r"\s+", "_", (prefix or "").strip())
    return p.strip(":")


def qbank_tags(ids: Iterable[str], prefix: str) -> List[str]:
    p = clean_prefix(prefix) or DEFAULT_PREFIX
    return [f"{p}::{qid}" for qid in ids]


def sync_qbank_tags(tags: List[str], ids: Iterable[str], prefix: str) -> Tuple[List[str], bool]:
    """`tags` with exactly the question tags for `ids` under `prefix`.

    Returns (new_tags, changed). Tags under other prefixes, and every tag that
    is not a question tag, are left as they are.
    """
    wanted = qbank_tags(ids, prefix)
    head = (clean_prefix(prefix) or DEFAULT_PREFIX).lower() + "::"
    wanted_lower = {t.lower() for t in wanted}
    kept = [t for t in tags if not t.lower().startswith(head) or t.lower() in wanted_lower]
    have = {t.lower() for t in kept}
    new = kept + [t for t in wanted if t.lower() not in have]
    return new, [t.lower() for t in new] != [t.lower() for t in tags]


# ─── Prefix: paper, then folder, then Settings ──────────────────────────

def _folder_settings_path(papers_root: str, folder_path: str) -> str:
    return os.path.join(papers_root, *[p for p in (folder_path or "").split("/") if p], FOLDER_SETTINGS_NAME)


def get_folder_prefix(papers_root: str, folder_path: str) -> str:
    """The prefix set on this folder itself ('' when none)."""
    try:
        with open(_folder_settings_path(papers_root, folder_path), encoding="utf-8") as f:
            return clean_prefix(json.load(f).get("qbank_prefix"))
    except (OSError, ValueError, AttributeError):
        return ""


def set_folder_prefix(papers_root: str, folder_path: str, prefix: Optional[str]) -> None:
    """Set this folder's prefix; '' or None clears it (and the file, if empty)."""
    path = _folder_settings_path(papers_root, folder_path)
    data: Dict = {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    p = clean_prefix(prefix)
    if p:
        data["qbank_prefix"] = p
    else:
        data.pop("qbank_prefix", None)
    if data:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    elif os.path.exists(path):
        os.remove(path)


def inherited_folder_prefix(papers_root: str, folder_path: str) -> str:
    """The nearest prefix set on this folder or one above it ('' when none)."""
    parts = [p for p in (folder_path or "").split("/") if p]
    while parts:
        p = get_folder_prefix(papers_root, "/".join(parts))
        if p:
            return p
        parts.pop()
    return ""


def resolve_prefix(paper_prefix: Optional[str], papers_root: str, folder_path: str,
                   settings_prefix: Optional[str]) -> str:
    return (clean_prefix(paper_prefix)
            or inherited_folder_prefix(papers_root, folder_path)
            or clean_prefix(settings_prefix)
            or DEFAULT_PREFIX)
