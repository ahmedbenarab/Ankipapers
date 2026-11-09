"""Anki flags from a heading: <!--flag:red--> flags every card under it.

A heading carries one flag in a hidden comment, written flush after its text
like the question ids (core/qbank.py):

    ## Aortic stenosis<!--flag:red-->

At Generate every card the heading folds over gets that flag in Anki. A card
holds one flag, so when flagged headings nest, the nearest one wins.

The paper and Anki can both change a flag, so Generate goes by what it last
set on each card (CardReference.flag_applied), and the paper wins only when
it changed:

  * The heading's flag is new or different since the last Generate: the
    cards get it. Taken off the heading: the cards lose it, but only those
    still showing the flag Anki Papers set; one you set yourself stays.
  * Unchanged: Anki is left alone, so a flag cleared in Anki stays cleared.
  * Cleared in Anki on EVERY card under a heading: the comment comes off the
    heading too, so the paper stops claiming a flag Anki no longer has. A
    partly cleared heading keeps its comment.
"""
import re
from typing import Dict, List, Optional, Tuple

# Anki's flag numbers, by the names Anki shows.
FLAG_NUMBERS = {
    "red": 1, "orange": 2, "green": 3, "blue": 4,
    "pink": 5, "turquoise": 6, "purple": 7,
}
FLAG_NAMES = {n: name for name, n in FLAG_NUMBERS.items()}

FLAG_COMMENT_RE = re.compile(r"<!--flag:([a-z0-9]+)-->", re.IGNORECASE)


def flag_number(word: str) -> int:
    """'red' / '1' -> 1; 'none', '0' or anything unknown -> 0."""
    w = (word or "").strip().lower()
    if w.isdigit():
        n = int(w)
        return n if 0 <= n <= 7 else 0
    return FLAG_NUMBERS.get(w, 0)


def flag_in(line: str) -> int:
    """The flag in the line's comment, 0 when it has none (the last one wins)."""
    found = FLAG_COMMENT_RE.findall(line or "")
    return flag_number(found[-1]) if found else 0


def strip_flag_comments(text: str) -> str:
    return FLAG_COMMENT_RE.sub("", text or "")


def _indent(line: str) -> int:
    s = (line or "").rstrip()
    level = 0
    while s.startswith("    ") or s.startswith("\t"):
        level += 1
        s = s[1:] if s.startswith("\t") else s[4:]
    return level


def inherited_flag(lines: List[str], index: int, code_lines: Optional[Dict] = None) -> Tuple[int, Optional[int]]:
    """(flag, line it comes from) for the card on lines[index]; (0, None) if none.

    The card's own line first, then its parents nearest first, found the way
    folding and core/qbank.inherited_qbank_ids find them.
    """
    code_lines = code_lines or {}
    own = flag_in(lines[index])
    if own:
        return own, index
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
            f = flag_in(line)
            if f:
                return f, i
            current = level
    return 0, None


# ─── Anki side ───────────────────────────────────────────────────────────

def note_card_flags(col, note_id: int) -> Dict[int, int]:
    """{card id: flag} for every card of the note."""
    out: Dict[int, int] = {}
    try:
        note = col.get_note(note_id)
        for cid in note.card_ids():
            out[cid] = col.get_card(cid).user_flag()
    except Exception:
        pass
    return out


def set_flag(col, card_ids: List[int], flag: int) -> bool:
    if not card_ids:
        return False
    try:
        col.set_user_flag_for_cards(flag, list(card_ids))
        return True
    except Exception as e:
        print(f"[Anki Papers] Error setting flag: {e}")
        return False
