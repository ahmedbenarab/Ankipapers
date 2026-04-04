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

    @property
    def is_valid(self) -> bool:
        if self.card_type in ("basic", "reversible"):
            return bool(self.front.strip() and self.back.strip())
        elif self.card_type == "cloze":
            return bool(self.cloze_text.strip())
        return False


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
BASIC_CARD_PATTERN = re.compile(r"^(.*?)\s*>>\s*(.+)$")

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

# Stable block id suffix (hidden in source; stripped before card patterns / hash)
BLOCK_ID_SUFFIX = re.compile(
    r"\s*<!--ap:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-->\s*$",
    re.IGNORECASE,
)


def split_stable_block_id(text: str) -> Tuple[str, Optional[str]]:
    """Remove trailing <!--ap:uuid--> from a line; return (body, uuid or None)."""
    if not text:
        return text, None
    m = BLOCK_ID_SUFFIX.search(text)
    if not m:
        return text, None
    return text[: m.start()].rstrip(), m.group(1)


def inject_stable_block_id(content: str, line_index: int, block_id: str) -> str:
    """Append <!--ap:uuid--> to a line if not already present."""
    lines = content.split("\n")
    if line_index < 0 or line_index >= len(lines):
        return content
    line = lines[line_index]
    if BLOCK_ID_SUFFIX.search(line):
        return content
    lines[line_index] = line.rstrip() + f" <!--ap:{block_id}-->"
    return "\n".join(lines)


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

    # Strip bullet prefix for card detection
    bullet_match = BULLET_PATTERN.match(stripped)
    card_content = content
    if bullet_match:
        card_content = bullet_match.group(3)
        indent_level = len(bullet_match.group(1)) // 4

    card_content, stable_block_id = split_stable_block_id(card_content)

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
    return [parse_line(i, line) for i, line in enumerate(lines)]


def extract_cards(content: str) -> List[ParsedCard]:
    """Extract all cards from a document."""
    parsed_lines = parse_document(content)
    cards = []
    for line in parsed_lines:
        if line.card and line.card.is_valid:
            cards.append(line.card)
    return cards


def get_context_heading(content: str, line_index: int) -> str:
    """
    Get the nearest heading above a given line index.
    Used to provide context for generated cards.
    """
    lines = content.split("\n")
    for i in range(line_index, -1, -1):
        heading_match = HEADING_PATTERN.match(lines[i].strip())
        if heading_match:
            return heading_match.group(2).strip()
    return ""
