"""
Fenced code blocks: ```language ... ```.

A paper is an outline, and leading spaces on a line mean "child of the line
above" in steps of four. Code has indentation of its own, so inside a block
the code's indentation is written with ➵ instead: each ➵ at the start of a
code line is one indent step of that language (4 for Python and Rust, 2 for
HTML, CSS and JavaScript). The only spaces in front of a code line are the
outline's, so nothing in the code is ever read as hierarchy.

Pairing rule: a line that is ``` (optionally followed by a language) opens a
block only when a later line that is exactly ``` closes it. An unclosed fence
is an ordinary line -- with the usual Markdown rule, one forgotten closing
fence would turn the rest of the paper into code and silently stop every card
below it from being made.

The editor implements the same rules in web_src/src/codeBlocks.js; keep the
two in step.
"""

import html
import re
from typing import Dict, List, NamedTuple, Optional, Tuple

ARROW = "\u27b5"  # ➵

_ANCHOR_TAIL = re.compile(r"(?:\s*<!--ap:[^>]*-->)+\s*$")
_FENCE_OPEN = re.compile(r"^```[ \t]*([A-Za-z0-9_+#.-]*)[ \t]*$")
_FENCE_CLOSE = re.compile(r"^```[ \t]*$")
_ARROWS = re.compile("^(?:" + ARROW + r"[ \t]*)+")

# name typed after ``` -> (canonical id, label, indent step)
_LANGS = {
    "python": ("python", "Python", 4),
    "py": ("python", "Python", 4),
    "rust": ("rust", "Rust", 4),
    "rs": ("rust", "Rust", 4),
    "html": ("html", "HTML", 2),
    "htm": ("html", "HTML", 2),
    "xml": ("html", "XML", 2),
    "css": ("css", "CSS", 2),
    "javascript": ("javascript", "JavaScript", 2),
    "js": ("javascript", "JavaScript", 2),
    "jsx": ("javascript", "JavaScript", 2),
    "typescript": ("javascript", "TypeScript", 2),
    "ts": ("javascript", "TypeScript", 2),
}


class CodeBlock(NamedTuple):
    open: int  # line index of the opening fence
    close: int  # line index of the closing fence
    lang: str  # canonical id, or "" when unknown / not given
    label: str  # what the header shows
    step: int  # spaces per ➵


def _bare(line: str) -> str:
    return _ANCHOR_TAIL.sub("", line or "").strip()


def outline_indent(line: str) -> str:
    m = re.match(r"^[ \t]*", line or "")
    return m.group(0) if m else ""


def language_info(name: str) -> Tuple[str, str, int]:
    name = (name or "").strip()
    known = _LANGS.get(name.lower())
    if known:
        return known
    return ("", name, 4)


def find_code_blocks(lines: List[str]) -> List[CodeBlock]:
    blocks = []
    i, n = 0, len(lines)
    while i < n:
        m = _FENCE_OPEN.match(_bare(lines[i]))
        if m:
            close = next((j for j in range(i + 1, n) if _FENCE_CLOSE.match(_bare(lines[j]))), None)
            if close is not None:
                lang, label, step = language_info(m.group(1))
                blocks.append(CodeBlock(i, close, lang, label, step))
                i = close + 1
                continue
        i += 1
    return blocks


def code_line_map(lines: List[str]) -> Dict[int, CodeBlock]:
    """Every line index that belongs to a block (fences included) -> its block."""
    out = {}
    for b in find_code_blocks(lines):
        for i in range(b.open, b.close + 1):
            out[i] = b
    return out


def split_code_line(line: str, fence_indent: str) -> Tuple[int, str]:
    """(➵ depth, code text) for one line inside a block.

    The fence's own outline indent is removed; any spaces beyond it are kept
    as part of the code, so code pasted with real spaces still reads right.
    """
    text = _ANCHOR_TAIL.sub("", line or "")
    if text.startswith(fence_indent):
        text = text[len(fence_indent):]
    else:
        text = text.lstrip(" \t")
    m = _ARROWS.match(text)
    if not m:
        return 0, text
    return m.group(0).count(ARROW), text[m.end():]


def block_code_text(lines: List[str], block: CodeBlock) -> str:
    """The block's code with ➵ turned into real indentation."""
    fence_indent = outline_indent(lines[block.open])
    out = []
    for i in range(block.open + 1, block.close):
        depth, text = split_code_line(lines[i], fence_indent)
        out.append(" " * (depth * block.step) + text)
    return "\n".join(out)


# ─── Highlighting ──────────────────────────────────────────────────────────
# Deliberately small: comments, strings, numbers, keywords, function and macro
# names, types, and tags/attributes/properties for HTML and CSS. Mirrors
# highlightCode() in web_src/src/codeBlocks.js.

_KEYWORDS = {
    "python": set("""False None True and as assert async await break class continue def del elif else except
        finally for from global if import in is lambda match case nonlocal not or pass raise return try while with
        yield self""".split()),
    "rust": set("""as async await break const continue crate dyn else enum extern false fn for if impl in let loop
        match mod move mut pub ref return self Self static struct super trait true type unsafe use where while
        Some None Ok Err""".split()),
    "javascript": set("""async await break case catch class const continue debugger default delete do else export
        extends false finally for function if import in instanceof let new null of return static super switch this
        throw true try typeof undefined var void while with yield""".split()),
}

_TOKEN_RES = {
    "python": re.compile(
        r"(?P<com>#[^\n]*)"
        r"|(?P<str>[rRbBfFuU]{0,2}(?:\"\"\"[\s\S]*?(?:\"\"\"|$)|'''[\s\S]*?(?:'''|$)|\"(?:\\.|[^\"\\\n])*\"?|'(?:\\.|[^'\\\n])*'?))"
        r"|(?P<dec>@[A-Za-z_][\w.]*)"
        r"|(?P<num>\b(?:0[xob][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?j?)\b)"
        r"|(?P<word>[A-Za-z_]\w*)"
    ),
    "rust": re.compile(
        r"(?P<com>//[^\n]*|/\*[\s\S]*?(?:\*/|$))"
        r"|(?P<str>b?\"(?:\\.|[^\"\\])*\"?|b?'(?:\\.|[^'\\])')"
        r"|(?P<life>'[A-Za-z_]\w*)"
        r"|(?P<num>\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b)"
        r"|(?P<word>[A-Za-z_]\w*!?)"
    ),
    "javascript": re.compile(
        r"(?P<com>//[^\n]*|/\*[\s\S]*?(?:\*/|$))"
        r"|(?P<str>\"(?:\\.|[^\"\\\n])*\"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)"
        r"|(?P<num>\b(?:0[xob][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b)"
        r"|(?P<word>[A-Za-z_$][\w$]*)"
    ),
}

_CSS_RE = re.compile(
    r"(?P<com>/\*[\s\S]*?(?:\*/|$))"
    r"|(?P<str>\"(?:\\.|[^\"\\\n])*\"?|'(?:\\.|[^'\\\n])*'?)"
    r"|(?P<at>@[\w-]+)"
    r"|(?P<open>\{)|(?P<close>\})"
    r"|(?P<num>#[\da-fA-F]{3,8}\b|-?\d*\.?\d+(?:%|[a-zA-Z]+)?)"
    r"|(?P<word>-?[A-Za-z_][\w-]*)"
)

_HTML_RE = re.compile(
    r"(?P<com><!--[\s\S]*?(?:-->|$))"
    r"|(?P<tag></?[A-Za-z][\w:-]*|/?>)"
    r"|(?P<str>\"[^\"]*\"?|'[^']*'?)"
    r"|(?P<attr>[A-Za-z_:][\w:.-]*)"
    r"|(?P<ent>&[#\w]+;)"
)


def _tokens_generic(code: str, lang: str) -> List[Tuple[Optional[str], str]]:
    rx, kws = _TOKEN_RES[lang], _KEYWORDS[lang]
    out, pos = [], 0
    for m in rx.finditer(code):
        if m.start() > pos:
            out.append((None, code[pos:m.start()]))
        kind, text = m.lastgroup, m.group(0)
        if kind == "word":
            after = code[m.end():m.end() + 1]
            prev = re.search(r"(\w+)\s*$", code[:m.start()])
            if text.endswith("!"):
                cls = "fn"
            elif text in kws:
                cls = "kw"
            elif prev and prev.group(1) in ("def", "fn", "function", "class", "struct", "enum", "trait"):
                cls = "fn" if prev.group(1) in ("def", "fn", "function") else "type"
            elif after == "(":
                cls = "fn"
            elif lang == "rust" and text[:1].isupper():
                cls = "type"
            else:
                cls = None
        elif kind == "dec":
            cls = "fn"
        elif kind == "life":
            cls = "kw"
        else:
            cls = kind
        out.append((cls, text))
        pos = m.end()
    if pos < len(code):
        out.append((None, code[pos:]))
    return out


def _tokens_css(code: str):
    out, pos, depth = [], 0, 0
    for m in _CSS_RE.finditer(code):
        if m.start() > pos:
            out.append((None, code[pos:m.start()]))
        kind, text = m.lastgroup, m.group(0)
        if kind == "open":
            depth += 1
            cls = None
        elif kind == "close":
            depth = max(0, depth - 1)
            cls = None
        elif kind == "at":
            cls = "kw"
        elif kind == "word":
            if depth == 0:
                cls = "tag"
            else:
                cls = "prop" if re.match(r"\s*:", code[m.end():]) else None
        else:
            cls = kind
        out.append((cls, text))
        pos = m.end()
    if pos < len(code):
        out.append((None, code[pos:]))
    return out


def _tokens_html(code: str):
    out, pos, in_tag = [], 0, False
    for m in _HTML_RE.finditer(code):
        kind, text = m.lastgroup, m.group(0)
        # Strings and attribute names only mean something inside a tag; in
        # the text between tags they are just words.
        if kind in ("str", "attr") and not in_tag:
            continue
        if m.start() > pos:
            out.append((None, code[pos:m.start()]))
        if kind == "tag":
            in_tag = not text.endswith(">")
        cls = {"com": "com", "tag": "tag", "str": "str", "attr": "attr", "ent": "num"}[kind]
        out.append((cls, text))
        pos = m.end()
    if pos < len(code):
        out.append((None, code[pos:]))
    return out


def highlight_tokens(code: str, lang: str) -> List[Tuple[Optional[str], str]]:
    if lang in _TOKEN_RES:
        return _tokens_generic(code, lang)
    if lang == "css":
        return _tokens_css(code)
    if lang == "html":
        return _tokens_html(code)
    return [(None, code)]


def _esc(text: str) -> str:
    # Braces and brackets as entities, so the breadcrumb's later cloze and
    # document-link passes (card_manager._render_context) can never match
    # inside code: Rust's format!("{{}}") is not a cloze.
    return (html.escape(text, quote=False)
            .replace("{", "&#123;").replace("}", "&#125;")
            .replace("[", "&#91;").replace("]", "&#93;"))


def highlight_html(code: str, lang: str) -> str:
    parts = []
    for cls, text in highlight_tokens(code, lang):
        # A token can span lines (a block comment, a triple-quoted string);
        # close and reopen it at each line break so every line is whole.
        pieces = text.split("\n")
        for k, piece in enumerate(pieces):
            if k:
                parts.append("\n")
            if piece:
                parts.append(f'<span class="ap-tok-{cls}">{_esc(piece)}</span>' if cls else _esc(piece))
    return "".join(parts)


def code_block_crumb_html(lines: List[str], block: CodeBlock) -> str:
    """A code block as one breadcrumb on a card."""
    code = block_code_text(lines, block)
    lang_attr = f' data-lang="{block.lang}"' if block.lang else ""
    return f'<div class="ap-crumb-code"{lang_attr}><pre><code>{highlight_html(code, block.lang)}</code></pre></div>'


def expand_arrows_in_markdown(content: str) -> str:
    """Markdown export: ➵ indentation becomes spaces so the code runs."""
    lines = (content or "").split("\n")
    for b in find_code_blocks(lines):
        fence_indent = outline_indent(lines[b.open])
        for i in range(b.open + 1, b.close):
            depth, text = split_code_line(lines[i], fence_indent)
            lines[i] = fence_indent + " " * (depth * b.step) + text
    return "\n".join(lines)


def arrows_from_spaces(content: str) -> str:
    """Import / paste: leading spaces inside a block become ➵.

    Each block's indent step is measured from its own code (the smallest
    non-zero indent), falling back to the language's convention.
    """
    lines = (content or "").split("\n")
    for b in find_code_blocks(lines):
        fence_indent = outline_indent(lines[b.open])
        body = []
        for i in range(b.open + 1, b.close):
            text = lines[i][len(fence_indent):] if lines[i].startswith(fence_indent) else lines[i].lstrip(" \t")
            body.append(text.replace("\t", " " * b.step))
        widths = [len(t) - len(t.lstrip(" ")) for t in body if t.strip()]
        step = min([w for w in widths if w > 0], default=b.step)
        for k, text in enumerate(body):
            spaces = len(text) - len(text.lstrip(" "))
            depth, extra = divmod(spaces, step)
            rest = " " * extra + text.lstrip(" ")
            lines[b.open + 1 + k] = fence_indent + (ARROW * depth + " " if depth else "") + rest
    return "\n".join(lines)
