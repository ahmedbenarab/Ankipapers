"""
Advanced paper search: field filters, quoted phrases, negation, and OR branches.

Syntax (case-insensitive except quoted text is matched as given after lowercasing):
  • Free words — all must appear somewhere in title, content, folder, deck, or tags (AND).
  • "phrase" or 'phrase' — exact substring in that combined haystack.
  • title:text, content:text, folder:text, deck:text, tag:text — restrict to a field;
    use quotes for spaces: folder:"Cell Biology"
  • -word or -field:value — exclude papers that match.
  • OR — alternative branches:  a b OR c d  matches if (a AND b) OR (c AND d).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

KNOWN_FIELDS = frozenset({"title", "content", "folder", "deck", "tag"})


@dataclass
class SearchBranch:
    """One AND-group (terms + field filters + negations)."""

    terms: List[str] = field(default_factory=list)
    fields: List[Tuple[str, str]] = field(default_factory=list)
    neg_terms: List[str] = field(default_factory=list)
    neg_fields: List[Tuple[str, str]] = field(default_factory=list)

    def matches(self, paper: Any) -> bool:
        h = _haystack_default(paper)
        for t in self.terms:
            if t not in h:
                return False
        for fname, needle in self.fields:
            if needle not in _get_field_text(paper, fname):
                return False
        for t in self.neg_terms:
            if t in h:
                return False
        for fname, needle in self.neg_fields:
            if needle in _get_field_text(paper, fname):
                return False
        return True


def _get_field_text(paper: Any, fname: str) -> str:
    if fname == "title":
        return (paper.title or "").lower()
    if fname == "content":
        return (paper.content or "").lower()
    if fname == "folder":
        return (paper.folder_path or "").lower()
    if fname == "deck":
        return (paper.deck_name or "").lower()
    if fname == "tag":
        tags = getattr(paper, "tags", None) or []
        return " ".join((t or "").lower() for t in tags)
    return ""


def _haystack_default(paper: Any) -> str:
    tags = getattr(paper, "tags", None) or []
    parts = [
        paper.title or "",
        paper.content or "",
        paper.folder_path or "",
        paper.deck_name or "",
        " ".join(str(t) for t in tags if t),
    ]
    return "\n".join(parts).lower()


def split_or_branches(q: str) -> List[str]:
    """Split on top-level ` OR ` (not inside quotes)."""
    q = q.strip()
    if not q:
        return []
    parts: List[str] = []
    buf: List[str] = []
    i = 0
    n = len(q)
    while i < n:
        ch = q[i]
        if ch in "\"'":
            quote = ch
            buf.append(ch)
            i += 1
            while i < n and q[i] != quote:
                buf.append(q[i])
                i += 1
            if i < n:
                buf.append(q[i])
                i += 1
            continue
        if (
            i + 3 < n
            and q[i : i + 4].upper() == " OR "
            and (i == 0 or q[i - 1].isspace())
        ):
            j = i + 4
            if j >= n or q[j].isspace():
                chunk = "".join(buf).strip()
                if chunk:
                    parts.append(chunk)
                buf = []
                i = j
                while i < n and q[i].isspace():
                    i += 1
                continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts if parts else [q]


def parse_branch(s: str) -> SearchBranch:
    b = SearchBranch()
    i = 0
    n = len(s)

    def skip_ws() -> None:
        nonlocal i
        while i < n and s[i].isspace():
            i += 1

    while True:
        skip_ws()
        if i >= n:
            break
        neg = False
        if s[i] == "-":
            neg = True
            i += 1
            skip_ws()
        if i >= n:
            break
        m = re.match(r"(title|content|folder|deck|tag):", s[i:], re.I)
        if m:
            fname = m.group(1).lower()
            i += m.end()
            skip_ws()
            if i >= n:
                break
            if s[i] in "\"'":
                quote = s[i]
                i += 1
                start = i
                while i < n and s[i] != quote:
                    i += 1
                val = s[start:i].lower()
                if i < n:
                    i += 1
            else:
                start = i
                while i < n and not s[i].isspace():
                    i += 1
                val = s[start:i].lower()
            if fname in KNOWN_FIELDS and val != "":
                if neg:
                    b.neg_fields.append((fname, val))
                else:
                    b.fields.append((fname, val))
            continue
        if s[i] in "\"'":
            quote = s[i]
            i += 1
            start = i
            while i < n and s[i] != quote:
                i += 1
            val = s[start:i].lower()
            if i < n:
                i += 1
            if val:
                if neg:
                    b.neg_terms.append(val)
                else:
                    b.terms.append(val)
            continue
        start = i
        while i < n and not s[i].isspace():
            i += 1
        val = s[start:i].lower()
        if val:
            if neg:
                b.neg_terms.append(val)
            else:
                b.terms.append(val)
    return b


def parse_paper_search(query: str) -> List[SearchBranch]:
    return [parse_branch(part) for part in split_or_branches(query)]


def _snippet_around(content: str, idx: int, length: int, radius: int = 48) -> str:
    start = max(0, idx - radius)
    end = min(len(content), idx + length + radius)
    frag = content[start:end].replace("\n", " ")
    return ("..." if start > 0 else "") + frag + ("..." if end < len(content) else "")


def build_snippet(paper: Any, br: SearchBranch) -> str:
    content = paper.content or ""
    if not content:
        return ""
    cl = content.lower()
    for fname, needle in br.fields:
        if fname == "content" and needle and needle in cl:
            return _snippet_around(content, cl.index(needle), len(needle))
    for t in br.terms:
        if t and t in cl:
            return _snippet_around(content, cl.index(t), len(t))
    for fname, needle in br.fields:
        if fname != "content" and needle and needle in cl:
            return _snippet_around(content, cl.index(needle), len(needle))
    return ""


def match_flags(paper: Any, br: SearchBranch) -> Dict[str, bool]:
    title_l = (paper.title or "").lower()
    cl = (paper.content or "").lower()
    folder_l = (paper.folder_path or "").lower()
    deck_l = (paper.deck_name or "").lower()
    tags_l = " ".join((t or "").lower() for t in (getattr(paper, "tags", None) or []))

    title_match = any(t in title_l for t in br.terms) or any(
        f == "title" and n in title_l for f, n in br.fields
    )
    content_match = any(t in cl for t in br.terms) or any(
        f == "content" and n in cl for f, n in br.fields
    )
    folder_match = any(t in folder_l for t in br.terms) or any(
        f == "folder" and n in folder_l for f, n in br.fields
    )
    deck_match = any(t in deck_l for t in br.terms) or any(
        f == "deck" and n in deck_l for f, n in br.fields
    )
    tag_match = any(t in tags_l for t in br.terms) or any(
        f == "tag" and n in tags_l for f, n in br.fields
    )
    return {
        "title_match": title_match,
        "content_match": content_match,
        "folder_match": folder_match,
        "deck_match": deck_match,
        "tag_match": tag_match,
    }


def search_papers_advanced(papers: List[Any], query: str) -> List[Dict[str, Any]]:
    q = query.strip()
    if not q:
        return []
    branches = parse_paper_search(q)
    out: List[Dict[str, Any]] = []
    for p in papers:
        matched: Optional[SearchBranch] = None
        for br in branches:
            if br.matches(p):
                matched = br
                break
        if matched is None:
            continue
        flags = match_flags(p, matched)
        snippet = build_snippet(p, matched)
        out.append(
            {
                "id": p.id,
                "title": p.title,
                "folder_path": p.folder_path,
                "deck_name": getattr(p, "deck_name", "") or "",
                "snippet": snippet,
                **flags,
            }
        )
    return out
