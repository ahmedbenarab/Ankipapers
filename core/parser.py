"""
Syntax parser for Anki Papers.

Parses paper content and extracts flashcard definitions using special syntax:

- Basic cards:      Question >> Answer
- Reversible cards: Front <> Back  (creates forward AND reverse cards)
- Cloze cards:      Text with {{cloze deletion}} in it
- Numbered cloze:   Text with {{c1::first}} and {{c2::second}}
- Headings:         # Heading (not a card, used for organization)
"""

import re
import hashlib
from typing import List, Tuple, Optional
from dataclasses import dataclass

try:
    from .code_blocks import code_block_crumb_html, code_line_map
except ImportError:
    # Loaded as a single file rather than as part of the package (see
    # tests/test_sub_sup.py, which can point at the installed add-on's copy).
    import importlib.util as _ilu
    import os as _os

    _spec = _ilu.spec_from_file_location(
        "ap_code_blocks", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "code_blocks.py")
    )
    _cb = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_cb)
    code_block_crumb_html, code_line_map = _cb.code_block_crumb_html, _cb.code_line_map

try:
    from .qbank import inherited_tag_marks, strip_tag_marks
    from .flags import flag_in, inherited_flag, strip_flag_comments
except ImportError:
    # Same single-file fallback as code_blocks above.
    import importlib.util as _ilu
    import os as _os

    def _load(name):
        spec = _ilu.spec_from_file_location(
            "ap_" + name, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), name + ".py")
        )
        mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    _qb, _fl = _load("qbank"), _load("flags")
    inherited_tag_marks, strip_tag_marks = _qb.inherited_tag_marks, _qb.strip_tag_marks
    inherited_flag, strip_flag_comments = _fl.inherited_flag, _fl.strip_flag_comments
    flag_in = _fl.flag_in


@dataclass
class ParsedCard:
    """Represents a parsed card extracted from text."""

    line_index: int
    card_type: str  # "basic", "reversible", or "cloze"
    raw_text: str
    front: str  # For basic cards
    back: str  # For basic cards
    cloze_text: str  # For cloze cards (with Anki {{c1::...}} syntax)
    content_hash: str
    block_id: Optional[str] = None  # stable id from <!--ap:uuid--> suffix
    supplement: str = ""
    inline_tags: List[str] = None  # Add this to store our [[tags]]
    tag_marks: List[str] = None  # "uw::3252" marks from this line and its parents (core/qbank.py)
    flag: int = 0  # Anki flag from the nearest <!--flag:...--> (core/flags.py)
    flag_line: Optional[int] = None  # the line that flag comes from
    # List cards only (card_type "list"): the parent line's text, and one
    # ListItem per "+ " child, in paper order.
    list_prompt: str = ""
    list_items: List["ListItem"] = None

    @property
    def is_valid(self) -> bool:
        if self.card_type in ("basic", "reversible"):
            return bool(self.front.strip() and self.back.strip())
        elif self.card_type == "cloze":
            return bool(self.cloze_text.strip())
        elif self.card_type == "list":
            return bool(self.list_items)
        return False


@dataclass
class ListItem:
    """One "+ " line under a list card's parent.

    block_id is the item's own <!--ap:uuid--> anchor. It is what ties an item
    to its card in Anki, so rewording, reordering or inserting items never
    hands one item's review history to another.
    """

    line_index: int
    text: str
    block_id: Optional[str] = None
    # The item's Anki flag: its own <!--flag:...--> if it has one, otherwise
    # the list's (from the parent line or a heading above). flag_line is the
    # line that flag comes from, as for ParsedCard.
    flag: int = 0
    flag_line: Optional[int] = None


@dataclass
class ParsedLine:
    """Represents a parsed line from the document."""

    index: int
    raw_text: str
    line_type: str  # "heading", "basic", "reversible", "cloze", "text"
    heading_level: int  # 0 if not a heading
    indent_level: int  # Number of indent levels
    card: Optional[ParsedCard]


# ─── Regex Patterns ────────────────────────────────────────────

# Basic card: "Question >> Answer"
# The (?<!</su[bp]) and (?<!</[bui]) guards: a subscript, superscript, bold,
# underline or italic
# closing tag written flush against the separator ("CO<sub>2</sub>>> gas") puts
# a ">" right before it, and without the guards the split would land inside the
# tag. Mirrors BASIC_CARD_RE in web_src/src/blockFormat.js -- the two have to
# agree.
BASIC_CARD_PATTERN = re.compile(r"^(.*?)(?<!</su[bp])(?<!</[bui])\s*>>\s*(.+)$")

# Reversible card: "Front <> Back"
REVERSIBLE_CARD_PATTERN = re.compile(r"^(.*?)\s*<>\s*(.+)$")

# Cloze with explicit numbering: {{c1::text}}
CLOZE_NUMBERED_PATTERN = re.compile(r"\{\{c(\d+)::(.+?)\}\}")

# Cloze without numbering: {{text}}
CLOZE_SIMPLE_PATTERN = re.compile(r"\{\{([^}:]+?)\}\}")

# Heading: # Heading, ## Heading, etc.
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+)$")

# Bullet point: - text or * text
BULLET_PATTERN = re.compile(r"^(\s*)([-*])\s+(.+)$")

# List item: "+ text" under a parent line. The parent becomes a list card and
# each item one card of it, recalled in order (see extract_cards). Mirrors
# LIST_ITEM_RE in web_src/src/blockFormat.js.
LIST_ITEM_PATTERN = re.compile(r"^\+\s+(.*\S.*)$")

# The suffix that turns a parent line's anchor into its list card's block id.
# A parent that is itself a card ("Q >> A" with "+ " children) keeps its own
# note under the bare anchor; the list note is a second identity on the same
# line, so it needs a name of its own.
LIST_BLOCK_SUFFIX = "/list"

# Stable block id suffix (hidden in source; stripped before card patterns / hash).
# A run of the same anchor repeated counts as one: older Tab / Shift+Tab code
# re-appended the anchor on every press, and the copies must not reach Anki.
BLOCK_ID_SUFFIX = re.compile(
    r"\s*<!--ap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-->(?:<!--ap:\1-->)*\s*$",
    re.IGNORECASE,
)

# Inline tags: [[tag]]
INLINE_TAG_PATTERN = re.compile(r"\[\[(.*?)\]\]")


# ─── Inline markdown ────────────────────────────────────────────────────────
#
# These live here rather than in card_manager because breadcrumbs need them
# too, and card_manager already imports from this module — the reverse would
# be circular. card_manager imports them back out, so there is still exactly
# one definition of what a bold or a code span turns into.

IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
# Document links: [phrase](ap://paperId#blockId). Rendered as styled text —
# they are not clickable inside Anki, but the phrase must never show up as raw
# markdown on a card.
AP_LINK_RE = re.compile(r"(?<!!)\[([^\]\[]+)\]\(ap://([^)\s]+)\)")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
STRIKE_RE = re.compile(r"~~(.+?)~~")
CODE_RE = re.compile(r"`([^`]+?)`")
MATH_BLOCK_RE = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
MATH_INLINE_RE = re.compile(r"(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)")


def md_inline_to_html(text: str) -> str:
    """Convert lightweight inline markdown to HTML."""
    if not text:
        return text
    r = text
    r = MATH_BLOCK_RE.sub(r"\\[\1\\]", r)
    r = MATH_INLINE_RE.sub(r"\\(\1\\)", r)
    r = IMG_RE.sub(r'<img src="\2">', r)
    r = AP_LINK_RE.sub(r'<span class="ap-link">\1</span>', r)
    r = BOLD_RE.sub(r"<b>\1</b>", r)
    r = ITALIC_RE.sub(r"<i>\1</i>", r)
    r = STRIKE_RE.sub(r"<s>\1</s>", r)
    r = CODE_RE.sub(r"<code>\1</code>", r)
    return r

# Supplement marker at the start of a line: "&& background text".
# The space after && is optional — "&&text" was previously matched by nothing
# at all, so the line became neither a card nor a supplement and quietly
# reached Anki by no route whatsoever.
SUPPLEMENT_PREFIX = re.compile(r"^&&[ \t]*")

# A line holding nothing but an image. Such a line cannot be a card and has no
# other meaning in the format, so the only thing its author can have intended
# is "show this picture with the card above".
IMAGE_ONLY_LINE = re.compile(r"^!\[[^\]]*\]\([^)]+\)$")


def split_stable_block_id(text: str) -> Tuple[str, Optional[str]]:
    """Remove trailing <!--ap:uuid--> from a line; return (body, uuid or None)."""
    if not text:
        return text, None
    m = BLOCK_ID_SUFFIX.search(text)
    if not m:
        return text, None
    return text[: m.start()].rstrip(), m.group(1)


def inject_stable_block_id(content: str, line_index: int, block_id: str) -> str:
    """Append <!--ap:uuid--> to a line if not already present.

    The anchor is written flush against the text, with no separating space.
    This matches ensureApBlockId() in web_src/src/docLinks.js, and it is not
    cosmetic: the editor's AP_BLOCK_ID_TAIL regex deliberately does not
    swallow whitespace in front of the anchor (a space typed at the end of a
    line is the last character at the moment it is pressed, so stripping it
    made the space bar appear dead on any anchored line). An anchor written
    as "text <!--ap:...-->" would therefore leave a trailing space visible in
    the editor on every card line. Write it the way the editor writes it.
    """
    lines = content.split("\n")
    if line_index < 0 or line_index >= len(lines):
        return content
    line = lines[line_index]
    if BLOCK_ID_SUFFIX.search(line):
        return content
    lines[line_index] = line.rstrip() + f"<!--ap:{block_id}-->"
    return "\n".join(lines)


def inject_stable_block_ids(content: str, assignments) -> str:
    """Apply inject_stable_block_id for many (line_index, block_id) pairs.

    Injection never changes the number of lines, so line indices stay valid
    across the whole batch. Lines that already carry an anchor are left
    untouched, so this is idempotent.
    """
    for line_index, block_id in assignments:
        if not block_id:
            continue
        content = inject_stable_block_id(content, line_index, block_id)
    return content


def compute_hash(text: str) -> str:
    """Compute a content hash for change detection."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


def parse_line(index: int, line: str) -> ParsedLine:
    """Parse a single line and determine its type and card content."""

    stripped = line.rstrip()

    # Count indent level (tabs or 4 spaces)
    indent_level = 0
    temp = stripped
    while temp.startswith("    ") or temp.startswith("\t"):
        indent_level += 1
        if temp.startswith("\t"):
            temp = temp[1:]
        else:
            temp = temp[4:]

    content = stripped.lstrip()

    # Empty line
    if not content:
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="text",
            heading_level=0,
            indent_level=indent_level,
            card=None,
        )

    # Check for heading
    heading_match = HEADING_PATTERN.match(content)
    if heading_match:
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="heading",
            heading_level=len(heading_match.group(1)),
            indent_level=indent_level,
            card=None,
        )

    # A "+ " list item is part of its parent's list card, never a card of its
    # own, whatever it happens to contain.
    if LIST_ITEM_PATTERN.match(content):
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="list_item",
            heading_level=0,
            indent_level=indent_level,
            card=None,
        )

    # Strip bullet prefix for card detection
    bullet_match = BULLET_PATTERN.match(stripped)
    card_content = content
    if bullet_match:
        card_content = bullet_match.group(3)
        indent_level = len(bullet_match.group(1)) // 4

    card_content, stable_block_id = split_stable_block_id(card_content)
    # Question-bank ids and flags are for Anki, never card text (core/qbank.py, core/flags.py).
    card_content = strip_flag_comments(strip_tag_marks(card_content))

    # If the line is meant to be a Supplement (&&), treat it as plain text 
    # so it bypasses the card-creation regex below.
    if SUPPLEMENT_PREFIX.match(card_content):
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="text",
            heading_level=0,
            indent_level=indent_level,
            card=None,
        )
        
    # Extract and remove inline tags (e.g., [[nh]])
    inline_tags = []
    def extract_tag(match):
        inline_tags.append(match.group(1).strip())
        return ""
        
    card_content = INLINE_TAG_PATTERN.sub(extract_tag, card_content).strip()
    
    # Check for reversible card (Front <> Back) - must check before basic
    reversible_match = REVERSIBLE_CARD_PATTERN.match(card_content)
    if reversible_match:
        front = reversible_match.group(1).strip()
        back = reversible_match.group(2).strip()        
        content_hash = compute_hash(card_content)
        card = ParsedCard(
            line_index=index,
            card_type="reversible",
            raw_text=card_content,
            front=front,
            back=back,
            cloze_text="",
            content_hash=content_hash,
            block_id=stable_block_id,
            inline_tags=inline_tags,
        )
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="reversible",
            heading_level=0,
            indent_level=indent_level,
            card=card,
        )

    # Check for basic card (Question >> Answer)
    basic_match = BASIC_CARD_PATTERN.match(card_content)
    if basic_match:
        front = basic_match.group(1).strip()
        back = basic_match.group(2).strip()
        content_hash = compute_hash(card_content)
        card = ParsedCard(
            line_index=index,
            card_type="basic",
            raw_text=card_content,
            front=front,
            back=back,
            cloze_text="",
            content_hash=content_hash,
            block_id=stable_block_id,
            inline_tags=inline_tags,
        )
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="basic",
            heading_level=0,
            indent_level=indent_level,
            card=card,
        )

    # Check for cloze card ({{...}} syntax)
    has_numbered = CLOZE_NUMBERED_PATTERN.search(card_content)
    has_simple = CLOZE_SIMPLE_PATTERN.search(card_content)

    if has_numbered or has_simple:
        cloze_text = convert_to_anki_cloze(card_content)
        content_hash = compute_hash(card_content)
        card = ParsedCard(
            line_index=index,
            card_type="cloze",
            raw_text=card_content,
            front="",
            back="",
            cloze_text=cloze_text,
            content_hash=content_hash,
            block_id=stable_block_id,
            inline_tags=inline_tags,
        )
        return ParsedLine(
            index=index,
            raw_text=line,
            line_type="cloze",
            heading_level=0,
            indent_level=indent_level,
            card=card,
        )

    # Plain text (not a card)
    return ParsedLine(
        index=index,
        raw_text=line,
        line_type="text",
        heading_level=0,
        indent_level=indent_level,
        card=None,
    )


def convert_to_anki_cloze(text: str) -> str:
    """
    Convert paper cloze syntax to Anki cloze format.

    - {{c1::text}} → {{c1::text}}  (already in Anki format)
    - {{text}} → {{c<N>::text}}  (auto-numbered)
    """
    result = text

    # First pass: leave already-numbered clozes as-is, find max number
    numbered_matches = list(CLOZE_NUMBERED_PATTERN.finditer(result))
    max_num = 0
    for match in numbered_matches:
        num = int(match.group(1))
        max_num = max(max_num, num)

    # Second pass: auto-number simple clozes
    counter = max_num

    def replace_simple(match):
        nonlocal counter
        counter += 1
        return "{{" + f"c{counter}::{match.group(1)}" + "}}"

    result = CLOZE_SIMPLE_PATTERN.sub(replace_simple, result)

    return result


def parse_document(content: str) -> List[ParsedLine]:
    """Parse an entire document and return a list of ParsedLine objects."""
    lines = content.split("\n")
    parsed = [parse_line(i, line) for i, line in enumerate(lines)]
    # Inside a ``` block nothing is card syntax: ">>" is a shift, "{{" is a
    # Rust format escape, "#" is a comment. The fences and code lines become
    # plain text lines.
    for i in code_line_map(lines):
        parsed[i].card = None
        parsed[i].line_type = "code"
        parsed[i].heading_level = 0
    return parsed


def supplement_text_from_child(child_content: str) -> Optional[str]:
    """What a child line contributes to its parent card's Supplement, or None.

    Two shapes qualify:

      "&& background text"   the explicit marker (the space after && is
                             optional)
      "![alt](picture.png)"  a line that is nothing but an image

    The second is here because such a line used to reach Anki through no path
    at all: it is not a card, and without the "&&" it was not collected as a
    supplement either, so a picture placed under a card rendered in the editor
    and then silently failed to appear on the card. Bare *text* lines are
    still ignored on purpose — those are notes the author deliberately kept
    off the card.
    """
    text = (child_content or "").strip()
    if not text:
        return None

    marker = SUPPLEMENT_PREFIX.match(text)
    if marker:
        return text[marker.end():].strip()

    # An image line may carry a hidden <!--ap:uuid--> anchor if something links
    # to it, so test (and store) the line with the anchor removed — otherwise
    # the anchor both defeats the match and lands in the card's HTML.
    body, _ = split_stable_block_id(text)
    body = body.strip()
    if IMAGE_ONLY_LINE.match(body):
        return body

    return None


def extract_cards(content: str) -> List[ParsedCard]:
    """Extract all cards from a document."""
    parsed_lines = parse_document(content)
    raw_lines = content.split("\n")
    code_lines = code_line_map(raw_lines)
    cards = []
    for i, line in enumerate(parsed_lines):
        if line.card and line.card.is_valid:
            line.card.tag_marks = inherited_tag_marks(raw_lines, i, code_lines)
            line.card.flag, line.card.flag_line = inherited_flag(raw_lines, i, code_lines)
            line.card.supplement = _supplement_for(parsed_lines, i)
            cards.append(line.card)

        # A line with "+ " children is also a list card. It comes right after
        # the line's own card, if it has one, which generate_cards relies on
        # when both need the same new anchor.
        items = list_items_for(parsed_lines, i)
        if items:
            card = _list_card(line, items)
            card.tag_marks = inherited_tag_marks(raw_lines, i, code_lines)
            card.flag, card.flag_line = inherited_flag(raw_lines, i, code_lines)
            for item in card.list_items:
                own = flag_in(raw_lines[item.line_index])
                item.flag, item.flag_line = (own, item.line_index) if own else (card.flag, card.flag_line)
            card.supplement = _supplement_for(parsed_lines, i)
            cards.append(card)

    return cards


def _supplement_for(parsed_lines: List[ParsedLine], i: int) -> str:
    """The Supplement of the card on line i: its "&&" and image-only children."""
    supplement_texts = []
    card_indent = parsed_lines[i].indent_level
    for j in range(i + 1, len(parsed_lines)):
        next_line = parsed_lines[j]
        stripped_raw = next_line.raw_text.rstrip()

        # Skip completely empty lines
        if not stripped_raw.strip():
            continue

        # Stop if we hit a line at the same or higher hierarchy level
        if next_line.indent_level <= card_indent:
            break

        # Process ONLY direct children (exactly 1 level deeper)
        if next_line.indent_level == card_indent + 1:
            # Extract content (removing potential bullet prefixes)
            child_content = stripped_raw.lstrip()
            bullet_match = BULLET_PATTERN.match(stripped_raw)
            if bullet_match:
                child_content = bullet_match.group(3)

            supp = supplement_text_from_child(child_content)
            if supp:
                supplement_texts.append(supp)
    return "<br>".join(supplement_texts)


def _list_item_from(line: ParsedLine) -> ListItem:
    """The text and anchor of a "+ " line, with Anki Papers' marks removed."""
    body, block_id = split_stable_block_id(line.raw_text.strip())
    m = LIST_ITEM_PATTERN.match(body)
    text = m.group(1) if m else body
    text = strip_flag_comments(strip_tag_marks(text))
    text = INLINE_TAG_PATTERN.sub("", text).strip()
    return ListItem(line_index=line.index, text=text, block_id=block_id)


def list_items_for(parsed_lines: List[ParsedLine], i: int) -> List[ListItem]:
    """The "+ " items that make line i a list card, in paper order.

    An item is a "+ " line one level deeper than the parent. A heading's
    content is often written flush under it rather than indented, so for a
    heading the "+ " lines straight after it, at its own level, count too.
    Other children (bullets, "&&" supplements, plain notes) may sit between
    items without breaking the list. Lines nested under an item are not items.
    """
    parent = parsed_lines[i]
    if parent.line_type in ("code", "list_item") or not parent.raw_text.strip():
        return []
    base = parent.indent_level
    items: List[ListItem] = []
    j = i + 1
    n = len(parsed_lines)
    if parent.line_type == "heading":
        while j < n and parsed_lines[j].line_type == "list_item" and parsed_lines[j].indent_level == base:
            items.append(_list_item_from(parsed_lines[j]))
            j += 1
    for k in range(j, n):
        child = parsed_lines[k]
        if not child.raw_text.strip():
            continue
        if child.indent_level <= base:
            break
        if child.indent_level == base + 1 and child.line_type == "list_item":
            items.append(_list_item_from(child))
    return [it for it in items if it.text]


_PROMPT_CLOZE_RE = re.compile(r"\{\{(?:c\d+::)?(.+?)(?:::[^}]*)?\}\}")
_PROMPT_LEAD_RE = re.compile(r"^(?:#{1,6}\s+|[-*]\s+|\d+\.\s+|&&[ \t]*)")


def _list_card(parent: ParsedLine, items: List[ListItem]) -> ParsedCard:
    """The list card for a parent line and its "+ " items."""
    body, anchor = split_stable_block_id(parent.raw_text.strip())
    inline_tags: List[str] = []

    def take_tag(match):
        inline_tags.append(match.group(1).strip())
        return ""

    if parent.card is not None and parent.card.card_type in ("basic", "reversible"):
        # The parent is a card too; its question side asks for the list.
        prompt = parent.card.front
        inline_tags = list(parent.card.inline_tags or [])
    else:
        text = strip_flag_comments(strip_tag_marks(_PROMPT_LEAD_RE.sub("", body)))
        text = INLINE_TAG_PATTERN.sub(take_tag, text)
        prompt = _PROMPT_CLOZE_RE.sub(r"\1", text).strip()

    signature = "\x00".join(["list", prompt] + [it.text for it in items])
    return ParsedCard(
        line_index=parent.index,
        card_type="list",
        raw_text=body,
        front="",
        back="",
        cloze_text="",
        content_hash=compute_hash(signature),
        block_id=(anchor + LIST_BLOCK_SUFFIX) if anchor else None,
        inline_tags=inline_tags,
        list_prompt=prompt,
        list_items=items,
    )

# Card syntax that should read as an arrow inside a breadcrumb: a parent line
# which is itself a card shows as "Question → Answer", the way the editor
# draws it.
_CRUMB_ARROWS = ((">>", "\u2192"), ("<>", "\u21D4"))
_CODE_SPAN_SPLIT = re.compile(r"(`[^`]+`)")

# What separates one block crumb from the next on a card. Emitted here rather
# than joining with " > " and having card_manager rewrite that to <br>: any
# crumb whose own text contained " > " (say "use when x > y") had that turned
# into a line break too.
BREADCRUMB_SEP = "<br>"


def render_breadcrumb_crumb(text: str) -> str:
    """One breadcrumb crumb, rendered the way the card should show it.

    Two jobs, both of which used to be done badly somewhere else.

    Card syntax becomes arrows. That was a chain of str.replace() applied to
    the finished HTML in card_manager, so it rewrote every ">>", " > " and "<>"
    it could find anywhere in the string — inside markup, inside attributes and
    inside code.

    Inline markdown becomes HTML. That was four regexes that threw the
    formatting away — bold and italic markers were deleted and the text kept —
    and backticks were not in the list at all, so `code` reached the card with
    its backticks intact.

    Code spans are held out of the arrow substitution: between backticks, ">>"
    is a shift operator and "<>" is not-equal, neither of them a card.

    Underscores are deliberately not treated as emphasis, here or on a card
    body: "__init__" and "my_var" are far more common in these notes than
    _emphasis_, and italicizing them would corrupt the code they appear in.
    """
    if not text:
        return text
    parts = _CODE_SPAN_SPLIT.split(text)
    for i, part in enumerate(parts):
        if len(part) > 1 and part.startswith("`") and part.endswith("`"):
            continue
        for src, dst in _CRUMB_ARROWS:
            part = part.replace(src, dst)
        parts[i] = part
    return md_inline_to_html("".join(parts))


def _strip_breadcrumb_tags(text: str) -> str:
    """Remove [[tags]], <!--uw::...--> tag marks and <!--flag:...--> from a breadcrumb line.

    A tag such as [[NH]] is an instruction to Anki Papers, not something the
    author wrote to read back. It already does its job by tagging the card, so
    printing the literal "[[NH]]" in a child card's breadcrumb is just noise.
    Everything else on the line is kept exactly as written -- that text is the
    context the breadcrumb exists to show.
    """
    cleaned = INLINE_TAG_PATTERN.sub(" ", strip_flag_comments(strip_tag_marks(text)))
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def get_block_breadcrumbs(content: str, line_index: int) -> List[str]:
    lines = content.split("\n")
    if line_index >= len(lines):
        return []

    def get_indent(text: str) -> int:
        stripped = text.rstrip()
        indent = 0
        while stripped.startswith("    ") or stripped.startswith("\t"):
            indent += 1
            stripped = stripped[1:] if stripped.startswith("\t") else stripped[4:]
        return indent

    card_level = get_indent(lines[line_index])
    if card_level == 0:
        return []

    breadcrumbs = []
    current_indent = card_level
    code_lines = code_line_map(lines)

    i = line_index
    while i > 0:
        i -= 1
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            continue

        # A ``` block is one unit: its parent level is its opening fence's,
        # and the whole block becomes a single code crumb. Nothing inside it
        # is examined line by line -- a Python "# comment" is not a heading.
        block = code_lines.get(i)
        if block is not None:
            block_level = get_indent(lines[block.open])
            if block_level < current_indent:
                breadcrumbs.insert(0, code_block_crumb_html(lines, block))
                current_indent = block_level
            i = block.open
            if current_indent == 0:
                break
            continue

        if stripped.startswith('#'):
            break

        line_level = get_indent(line)
            
        # Look for ANY strictly smaller indent to catch skipped levels
        if line_level < current_indent:
            # Remove bullet/number prefixes
            clean_text = re.sub(r'^[-*+]\s+', '', stripped)
            clean_text = re.sub(r'^\d+\.\s+', '', clean_text)
            # A supplement line ("&& a note") can be the parent of a card. The
            # ampersands are Anki Papers syntax marking the line as a comment,
            # not part of what was written, so they must not show up in the
            # breadcrumb on the card. Stripped after the bullet prefixes, which
            # is the same order parse_line() uses.
            clean_text = re.sub(r'^&&\s*', '', clean_text)
            clean_text = _strip_breadcrumb_tags(clean_text)

            # ----- IMPROVED IMAGE HANDLING (Markdown + HTML) -----
            def markdown_replacer(m):
                alt = m.group(1).strip()
                url = m.group(2).strip()
                if url.startswith('data:'):
                    filename = 'screenshot'
                else:
                    filename = url.split('/')[-1].split('?')[0] or 'image'
                # Show filename, optionally with alt if it's meaningful
                if alt and alt.lower() not in ('', 'pasted', 'image', 'screenshot'):
                    return f"[Image: {alt} ({filename})]"
                return f"[Image: {filename}]"

            clean_text = re.sub(r'!\[([^\]]*)\]\(([^\)]+)\)', markdown_replacer, clean_text)

            def html_img_replacer(m):
                attrs = m.group(0)
                # Try src first, then alt, then title
                src_match = re.search(r'src=["\']([^"\']+)["\']', attrs, re.I)
                filename = ''
                if src_match:
                    url = src_match.group(1)
                    filename = url.split('/')[-1].split('?')[0] if not url.startswith('data:') else 'screenshot'
                alt_match = re.search(r'alt=["\']([^"\']+)["\']', attrs, re.I)
                alt = alt_match.group(1) if alt_match else ''
                if alt and alt.lower() not in ('', 'pasted', 'image', 'screenshot') and filename:
                    return f"[Image: {alt} ({filename})]"
                elif filename:
                    return f"[Image: {filename}]"
                elif alt:
                    return f"[Image: {alt}]"
                return "[Image]"

            clean_text = re.sub(r'<img[^>]*>', html_img_replacer, clean_text, flags=re.IGNORECASE)

            # Clean up any remaining empty placeholder
            clean_text = re.sub(r'\[Image:\s*\]', '[Image]', clean_text)

            # Render what the author wrote, rather than deleting the markers.
            # Runs after the image handling above so the [Image: …] placeholders
            # it produces are never re-matched as markdown.
            clean_text = render_breadcrumb_crumb(clean_text)

            if clean_text:
                breadcrumbs.insert(0, clean_text)

            # Update current indent so we only look for even higher parents
            current_indent = line_level

        if current_indent == 0:
            break

    return breadcrumbs

def get_context_heading(content: str, line_index: int) -> str:
    """
    Get the full heading breadcrumb path above a given line index.
    Walks upward collecting the nearest heading at each level,
    AND the parent indented blocks leading down to the line.
    """
    lines = content.split("\n")
    headings = {}  # level -> heading text
    current_min_level = 4  # Track the highest hierarchy level we've seen (1 is highest)
    code_lines = code_line_map(lines)

    for i in range(line_index, -1, -1):
        if i in code_lines:
            continue
        heading_match = HEADING_PATTERN.match(lines[i].strip())
        if heading_match:
            level = len(heading_match.group(1))
            # Restrict to H1-H3, and ONLY accept if it's a structural parent of what we already have
            if level <= 3 and level < current_min_level:
                text = render_breadcrumb_crumb(_strip_breadcrumb_tags(heading_match.group(2)))
                headings[level] = text
                current_min_level = level
                if level == 1:
                    break

    # 1. Build the heading path: one span per level so the card CSS can size
    #    H1/H2/H3 differently (.ap-crumb-h1/2/3 in card_manager._ANKIPAPERS_CSS).
    #    Levels stack one per line, as the card has always shown them; the
    #    separator span carries the line break so the crumbs keep that layout
    #    and the H1 underline cannot bleed into a separator.
    heading_path = ""
    if headings:
        sorted_levels = sorted(headings.keys())
        crumbs = [
            f'<span class="ap-crumb ap-crumb-h{l}">{headings[l]}</span>'
            for l in sorted_levels
        ]
        heading_path = '<span class="ap-crumb-sep"><br></span>'.join(crumbs)

    # 2. Get the block parent path
    block_path_list = get_block_breadcrumbs(content, line_index)

    # 3. Stitch them together using distinct HTML elements for separate styling
    context_html = ""
    if heading_path:
        context_html += f'<div class="ap-meta-heading">{heading_path}</div>'
    if block_path_list:
        # A code crumb is a block element; a <br> beside it would only add a
        # blank line.
        block_path_str = ""
        for k, crumb in enumerate(block_path_list):
            if k and not crumb.startswith("<div") and not block_path_list[k - 1].startswith("<div"):
                block_path_str += BREADCRUMB_SEP
            block_path_str += crumb
        context_html += f'<div class="ap-meta-block">{block_path_str}</div>'
        
    return context_html
