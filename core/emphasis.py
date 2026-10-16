"""Convert Markdown bold and italic (**x**, *x*) to HTML tags (<b>x</b>, <i>x</i>).

Anki Papers writes bold and italic as <b>/<i> tags, the same way it writes
<u>, <sub> and <sup>, and the same tags Anki's own editor produces. Papers
written before that used Markdown asterisks; this converts them once.

The rule is to convert exactly what the editor already shows as bold or italic
and touch nothing else, so nothing on screen or on a card changes:

  * the same patterns the editor renders with (blockFormat.js formatInlineRaw,
    and BOLD_RE / ITALIC_RE in parser.py): bold first, then italic, pairing
    asterisks on one line. A lone asterisk -- "HLA-B*57:01" -- has no partner,
    is not italic today, and is left exactly as it is;
  * code is never touched: inline `code` spans and ``` fenced blocks keep their
    asterisks ("value ** 2" stays code), as does maths ($...$, $$...$$).

Old asterisk formatting is still displayed correctly after this, so the
conversion is a tidy-up, not something the editor depends on.
"""
import re
from typing import Tuple

_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
# Spans whose asterisks must survive untouched, swapped out while converting.
_PROTECT = re.compile(r"`[^`]+`|\$\$.+?\$\$|(?<!\$)\$(?!\$).+?(?<!\$)\$(?!\$)")
_FENCE = re.compile(r"^\s*```")


def _convert_line(line: str) -> Tuple[str, int, int]:
    if "*" not in line:
        return line, 0, 0
    kept = []

    def hold(m):
        kept.append(m.group(0))
        return f"\x00{len(kept) - 1}\x00"

    work = _PROTECT.sub(hold, line)
    work, n_bold = _BOLD.subn(r"<b>\1</b>", work)
    work, n_italic = _ITALIC.subn(r"<i>\1</i>", work)
    work = re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], work)
    return work, n_bold, n_italic


def convert_emphasis_to_tags(content: str) -> Tuple[str, int, int]:
    """Return (converted content, bold spans converted, italic spans converted)."""
    if not content:
        return content or "", 0, 0
    out, bold, italic, in_fence = [], 0, 0, False
    for line in content.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue
        new, b, i = _convert_line(line)
        out.append(new)
        bold += b
        italic += i
    return "\n".join(out), bold, italic
