"""Question tags: a shortcut on a line, a hierarchical tag on its cards.

Any line of text -- a heading, a card, a bullet -- carries tag marks in a
hidden comment, written flush after its text (before the line's own
<!--ap:uuid--> anchor, which stays last):

    ## Hypertrophic cardiomyopathy<!--uw::3252,4410-->
        Murmur increases with Valsalva >> HCM<!--uw::5120-->

The word before "::" is a shortcut from Settings -> Cards -> Tag Shortcuts.
At Generate it is swapped for its tag and everything after the "::" is kept,
so with uw -> UWorldABIM the card on the second line is tagged
UWorldABIM::5120, UWorldABIM::3252 and UWorldABIM::4410: tags add up from the
card's own line and every parent (each line above it with a smaller indent,
the rule folding uses). Deeper levels work too: uw::Cardio::2434 gives
UWorldABIM::Cardio::2434. A shortcut that is not in the table tags nothing,
and Generate names the lines that use it.

The table is one-to-one both ways: no shortcut twice, no tag twice, and no
tag nested inside another (UWorld and UWorld::ABIM could both make the same
tag). Capitals don't count, as in Anki. flag, ap and nh are taken.

A paper or folder may give a shortcut its own tag (an override): the paper's
own first, then the nearest folder's, then Settings. Each row and each
override remembers its earlier tags, so a rename moves the cards' tags to the
new name at the next Generate instead of leaving the old ones behind.

Every Generate keeps the tags in step with the paper: an id taken off a line
comes off its cards. Only tags under a name this paper's table uses, or used
before a rename, are touched; anything else on a note is the user's.

The comment never shows in the rendered paper, in breadcrumbs, search, print
or on a card; the editor shows it only while the line is being edited.
"""
import json
import os
import re
from typing import Dict, Iterable, List, Optional, Tuple

DEFAULT_SHORTCUT = "uw"
DEFAULT_PREFIX = "UWorldABIM"
RESERVED_SHORTCUTS = ("flag", "ap", "nh")

# <!--uw::3252,4410--> anywhere on a line; values separated by commas or spaces.
TAG_MARK_RE = re.compile(r"<!--([A-Za-z][A-Za-z0-9_]*)::([^>]*?)-->")
SHORTCUT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_VALUE_RE = re.compile(r"[^\s,]+")

# Folder-level settings live in the folder itself, so a rename or a move
# carries them along without any bookkeeping.
FOLDER_SETTINGS_NAME = ".ankipapers-folder.json"


# ─── Marks on a line ────────────────────────────────────────────────────

def tag_marks_in(line: str) -> List[str]:
    """Every mark on `line` as "shortcut::value" (shortcut in lower case),
    in order, no repeats."""
    marks: List[str] = []
    seen = set()
    for m in TAG_MARK_RE.finditer(line or ""):
        shortcut = m.group(1).lower()
        for value in _VALUE_RE.findall(m.group(2)):
            value = value.strip(":")
            mark = f"{shortcut}::{value}"
            if value and mark.lower() not in seen:
                seen.add(mark.lower())
                marks.append(mark)
    return marks


def strip_tag_marks(text: str) -> str:
    """`text` without its <!--shortcut::...--> comments."""
    return TAG_MARK_RE.sub("", text or "")


def _indent(line: str) -> int:
    """Outline level: four spaces or a tab each (parser.get_indent's rule)."""
    s = (line or "").rstrip()
    level = 0
    while s.startswith("    ") or s.startswith("\t"):
        level += 1
        s = s[1:] if s.startswith("\t") else s[4:]
    return level


def inherited_tag_marks(lines: List[str], index: int, code_lines: Optional[Dict] = None) -> List[str]:
    """Tag marks for the card on lines[index]: its own, then every parent's.

    Parents are found the way breadcrumbs and folding find them: walking up,
    blank lines are skipped and each line with a smaller indent than the last
    parent is the next parent. Unlike breadcrumbs the walk does not stop at a
    heading -- a heading is exactly where the marks are expected. A ``` block
    counts as one line at its opening fence's level, and never holds marks.
    """
    code_lines = code_lines or {}
    marks = tag_marks_in(lines[index])
    seen = {m.lower() for m in marks}
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
            for mark in tag_marks_in(line):
                if mark.lower() not in seen:
                    seen.add(mark.lower())
                    marks.append(mark)
            current = level
    return marks


def unknown_mark_lines(content: str, table: Dict[str, str]) -> List[Tuple[int, str]]:
    """(index, line) for each line outside ``` blocks whose marks use a
    shortcut the table doesn't have."""
    found = []
    fenced = False
    for i, line in enumerate((content or "").split("\n")):
        if line.strip().startswith("```"):
            fenced = not fenced
            continue
        if fenced:
            continue
        if any(m.split("::", 1)[0] not in table for m in tag_marks_in(line)):
            found.append((i, line))
    return found


# ─── The shortcut table ─────────────────────────────────────────────────

def clean_tag(tag: Optional[str]) -> str:
    """A tag name as Anki can use it: no spaces, no stray "::" at either end."""
    t = re.sub(r"\s+", "_", str(tag or "").strip())
    return t.strip(":")


def _nested(a: str, b: str) -> bool:
    """The same tag, or one inside the other (capitals don't count)."""
    a, b = a.lower(), b.lower()
    return a == b or a.startswith(b + "::") or b.startswith(a + "::")


def shortcut_rows(config: Dict) -> List[Dict]:
    """The Tag Shortcuts table from the add-on config, cleaned:
    [{"shortcut": "uw", "tag": "UWorldABIM", "old": [...]}, ...].

    A config from before the table had one "qbank_tag_prefix"; that becomes
    the uw row. An earlier tag that is now some row's live tag is dropped
    from "old", so cleaning up after a rename never touches a live tag.
    """
    raw = (config or {}).get("tag_shortcuts")
    if not isinstance(raw, list):
        prefix = clean_tag((config or {}).get("qbank_tag_prefix")) or DEFAULT_PREFIX
        return [{"shortcut": DEFAULT_SHORTCUT, "tag": prefix, "old": []}]
    rows = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        rows.append({
            "shortcut": str(r.get("shortcut") or "").strip(),
            "tag": clean_tag(r.get("tag")),
            "old": [clean_tag(o) for o in (r.get("old") or []) if clean_tag(o)],
        })
    live = [r["tag"] for r in rows if r["tag"]]
    for r in rows:
        r["old"] = [o for o in dict.fromkeys(r["old"]) if not any(_nested(o, t) for t in live)]
    return rows


def table_problem(rows: List[Dict]) -> Optional[str]:
    """Why the table isn't one-to-one, in words; None when it is."""
    seen: Dict[str, str] = {}
    for n, r in enumerate(rows, 1):
        sc, tag = r.get("shortcut") or "", r.get("tag") or ""
        if not sc:
            return f"Row {n} needs a shortcut."
        if not SHORTCUT_RE.match(sc):
            return f"“{sc}” can't be a shortcut: use letters, digits and _, starting with a letter."
        if sc.lower() in RESERVED_SHORTCUTS:
            return f"“{sc}” is taken: flag, ap and nh already mean something in a paper."
        if re.match(r"^c\d+$", sc, re.IGNORECASE):
            return f"“{sc}” is taken: {{{{{sc}::…}}}} is a cloze."
        if sc.lower() in seen:
            return f"“{sc}” is used twice. Each shortcut can be used only once."
        if not tag:
            return f"“{sc}” needs a tag."
        seen[sc.lower()] = tag
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if a["tag"].lower() == b["tag"].lower():
                return (f"“{a['shortcut']}” and “{b['shortcut']}” both make "
                        f"{a['tag']} tags. Each tag can belong to only one shortcut.")
            if _nested(a["tag"], b["tag"]):
                return (f"{a['tag']} and {b['tag']} sit inside one another, so "
                        f"“{a['shortcut']}” and “{b['shortcut']}” could make the same tag.")
    return None


def clean_overrides(data: Optional[Dict]) -> Dict:
    """A paper's or folder's overrides: {"tags": {shortcut: tag}, "old": [...]}."""
    data = data if isinstance(data, dict) else {}
    tags = {}
    for sc, tag in (data.get("tags") or {}).items():
        sc, tag = str(sc or "").strip().lower(), clean_tag(tag)
        if sc and tag:
            tags[sc] = tag
    old = [clean_tag(o) for o in (data.get("old") or []) if clean_tag(o)]
    old = [o for o in dict.fromkeys(old) if not any(_nested(o, t) for t in tags.values())]
    return {"tags": tags, "old": old}


def updated_overrides(previous: Optional[Dict], tags: Dict[str, str]) -> Dict:
    """The overrides after setting `tags`: a tag that changed or was removed
    joins "old", so the next Generate moves the cards off it."""
    prev = clean_overrides(previous)
    new = clean_overrides({"tags": tags})["tags"]
    old = list(prev["old"])
    for sc, tag in prev["tags"].items():
        if new.get(sc, "").lower() != tag.lower():
            old.append(tag)
    return clean_overrides({"tags": new, "old": old})


def resolve_table(rows: List[Dict], layers: Iterable[Dict]) -> Tuple[Dict[str, str], List[str]]:
    """The table in force for one paper, and every tag name it keeps in step.

    `layers` are overrides from the folder nearest the root down to the paper;
    a nearer one wins. An override that would break one-to-one with the rest
    of the table is skipped. The names kept in step are every tag in the
    table, every Settings tag an override replaced and every earlier name,
    so a rename or a new override moves the cards' tags.
    """
    table = {r["shortcut"].lower(): r["tag"] for r in rows if r.get("shortcut") and r.get("tag")}
    heads = list(table.values()) + [o for r in rows for o in r.get("old") or []]
    for layer in layers:
        layer = clean_overrides(layer)
        for sc, tag in layer["tags"].items():
            if sc not in table:
                continue
            if any(_nested(tag, t) for s, t in table.items() if s != sc):
                continue
            table[sc] = tag
            heads.append(tag)
        heads.extend(layer["old"])
    return table, list(dict.fromkeys(h for h in heads if h))


def overrides_problem(rows: List[Dict], layers: List[Dict]) -> Optional[str]:
    """Why the last layer's overrides would break one-to-one; None if fine."""
    base, _ = resolve_table(rows, layers[:-1])
    own = clean_overrides(layers[-1])["tags"] if layers else {}
    table = dict(base)
    for sc, tag in own.items():
        if sc not in table:
            return f"“{sc}” isn't in your Tag Shortcuts."
        table[sc] = tag
    named = [{"shortcut": sc, "tag": tag} for sc, tag in table.items()]
    return table_problem(named)


def question_tags(marks: Iterable[str], table: Dict[str, str]) -> List[str]:
    """The Anki tags for `marks`: shortcut swapped for its tag, the rest kept.
    Marks whose shortcut isn't in the table give nothing."""
    tags: List[str] = []
    seen = set()
    for mark in marks:
        sc, _, rest = mark.partition("::")
        tag = table.get(sc.lower())
        if tag and rest:
            t = f"{tag}::{rest}"
            if t.lower() not in seen:
                seen.add(t.lower())
                tags.append(t)
    return tags


def sync_question_tags(tags: List[str], wanted: Iterable[str], heads: Iterable[str]) -> Tuple[List[str], bool]:
    """`tags` with exactly the `wanted` question tags under the names in `heads`.

    Returns (new_tags, changed). A tag under none of those names is left as
    it is.
    """
    wanted = list(wanted)
    starts = tuple(h.lower() + "::" for h in heads if h)
    wanted_lower = {t.lower() for t in wanted}
    kept = [t for t in tags if not t.lower().startswith(starts) or t.lower() in wanted_lower]
    have = {t.lower() for t in kept}
    new = kept + [t for t in wanted if t.lower() not in have]
    return new, [t.lower() for t in new] != [t.lower() for t in tags]


# ─── Overrides on folders ───────────────────────────────────────────────

def _folder_settings_path(papers_root: str, folder_path: str) -> str:
    return os.path.join(papers_root, *[p for p in (folder_path or "").split("/") if p], FOLDER_SETTINGS_NAME)


def _read_folder_settings(path: str) -> Dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get_folder_overrides(papers_root: str, folder_path: str) -> Dict:
    """The overrides set on this folder itself."""
    path = _folder_settings_path(papers_root, folder_path)
    return clean_overrides(_read_folder_settings(path).get("tag_shortcuts"))


def set_folder_overrides(papers_root: str, folder_path: str, overrides: Optional[Dict]) -> None:
    """Store this folder's overrides; none at all clears them (and the file,
    if nothing else is in it)."""
    path = _folder_settings_path(papers_root, folder_path)
    data = _read_folder_settings(path)
    data.pop("qbank_prefix", None)   # the single prefix the table replaced
    o = clean_overrides(overrides)
    if o["tags"] or o["old"]:
        data["tag_shortcuts"] = o
    else:
        data.pop("tag_shortcuts", None)
    if data:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    elif os.path.exists(path):
        os.remove(path)


def folder_layers(papers_root: str, folder_path: str) -> List[Dict]:
    """Overrides of this folder and every folder above it, root first."""
    parts = [p for p in (folder_path or "").split("/") if p]
    return [get_folder_overrides(papers_root, "/".join(parts[:n])) for n in range(1, len(parts) + 1)]
