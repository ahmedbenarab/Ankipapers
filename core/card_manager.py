"""
Card Manager for Anki Papers.

Handles creating, updating, and deleting Anki notes based on parsed cards.
Manages the synchronization between paper content and the Anki collection.
"""

import re
import uuid
from typing import List, Tuple, Optional, Dict, Any
from .paper import Paper, CardReference
from .parser import (
    ParsedCard,
    extract_cards,
    get_context_heading,
    inject_stable_block_ids,
    compute_hash,
    md_inline_to_html,
    render_breadcrumb_crumb,
    IMG_RE,
    AP_LINK_RE,
    CODE_RE,
)


ANKIPAPERS_TAG = "AnkiPapers"
ANKIPAPERS_FIELD = "AnkiPapers_Source"

# Shared card styling — elegant, minimalistic, works in both Anki light & dark modes
_ANKIPAPERS_CSS = """
/* ─── Base Card ─────────────────────────────────── */
.ankipapers-card {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 20px;
  line-height: 1.65;
  color: #000000;  /* pitch black in day mode (purple / mono keep #1a1a2e) */
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 28px;
  text-align: left;
}

/* ─── Context / Heading ─────────────────────────── */
.ap-meta {
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(0,0,0,0.1);
}

.ap-meta-heading {
  font-size: 18px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #19468d;
  margin-bottom: 4px;
}
/* #19468D is too dark to read on Anki's night background; use pale Carolina. */
.nightMode .ap-meta-heading,
.night_mode .ap-meta-heading {
  color: #7bafd4;
}

/* Per-level breadcrumb crumbs (see parser.get_context_heading). Weight,
   uppercase, letter-spacing and color are inherited from .ap-meta-heading. */
.ap-crumb-h1 {
  font-size: 22px;
  text-decoration: underline;
}
.ap-crumb-h2 {
  font-size: 18px;
}
.ap-crumb-h3 {
  font-size: 16px;
}
.ap-crumb-sep {
  text-decoration: none;
}

.ap-meta-block {
  font-size: 16px;
  font-weight: 600;
  color: #000000;
}

/* Inline code inside a breadcrumb. The card's own `code` rule is a white chip
   with a border, which at the breadcrumb's 16px competes with the answer for
   attention — a breadcrumb is meant to be quiet context. Keep the color that
   marks it as code and drop the chip. */
.ap-meta-block code,
.ap-meta-heading code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.92em;
}
.nightMode .ap-meta-block code,
.nightMode .ap-meta-heading code,
.night_mode .ap-meta-block code,
.night_mode .ap-meta-heading code {
  background: none;
  border: none;
}

/* ─── Code block in the breadcrumb ─────────────── */
/* A ``` block that a card is indented under (parser.code_block_crumb_html).
   A block of its own, so the crumbs before and after it stay on their own
   centered lines (as an inline-block it shared a line with the crumb above,
   which dropped to its bottom edge). fit-content keeps it shrink-wrapped and
   centered like the rest of the breadcrumb; the code itself reads
   left-aligned, in its own colors, whatever the card style. */
.ap-crumb-code {
  display: block;
  width: fit-content;
  max-width: 100%;
  margin: 8px auto 4px;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
}
.ap-crumb-code pre {
  margin: 0;
  padding: 10px 14px;
  overflow-x: auto;
  white-space: pre;
  font-family: Menlo, 'SF Mono', Monaco, Consolas, monospace;
  font-size: 14px;
  line-height: 1.55;
  color: #1f2328;
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
}
.ap-crumb-code code,
.card .ap-crumb-code code {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
}
.ap-tok-kw { color: #8250df; }
.ap-tok-str { color: #0a7d32; }
.ap-tok-com { color: #6e7781; font-style: italic; }
.ap-tok-num { color: #b35900; }
.ap-tok-fn { color: #0550ae; }
.ap-tok-type { color: #953800; }
.ap-tok-tag { color: #116329; }
.ap-tok-attr { color: #953800; }
.ap-tok-prop { color: #0550ae; }
.nightMode .ap-crumb-code pre,
.night_mode .ap-crumb-code pre {
  color: #e6edf3;
  background: #1e2430;
  border-color: #3a4250;
}
.nightMode .ap-tok-kw, .night_mode .ap-tok-kw { color: #c792ea; }
.nightMode .ap-tok-str, .night_mode .ap-tok-str { color: #c3e88d; }
.nightMode .ap-tok-com, .night_mode .ap-tok-com { color: #8b97a3; }
.nightMode .ap-tok-num, .night_mode .ap-tok-num { color: #f78c6c; }
.nightMode .ap-tok-fn, .night_mode .ap-tok-fn { color: #82aaff; }
.nightMode .ap-tok-type, .night_mode .ap-tok-type { color: #ffcb6b; }
.nightMode .ap-tok-tag, .night_mode .ap-tok-tag { color: #f07178; }
.nightMode .ap-tok-attr, .night_mode .ap-tok-attr { color: #ffcb6b; }
.nightMode .ap-tok-prop, .night_mode .ap-tok-prop { color: #82aaff; }

/* ─── Context Image ─────────────────────────────── */
.ap-meta-image {
  max-width: 100%;
  max-height: 250px;
  border-radius: 6px;
  display: block;
  margin: 10px 0;
}

/* Dark Mode Meta Support */
.nightMode .ap-meta {
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.nightMode .ap-meta-block {
  color: #e0e0e0;
}

/* ─── Revealed Text Colors ──────────────────────── */

/* Basic Cards (Default/Light: deep green) */
.ap-answer-basic {
  color: #1e7a45;
}
/* Basic Cards (Dark: light green) */
.nightMode .ap-answer-basic {
  color: #5fd39a;
}

/* Reversible Cards: amber, kept apart from the Carolina / #19468D blues */
.ap-answer-reversible {
  color: #a8620a;
}
.nightMode .ap-answer-reversible {
  color: #f0b45a;
}

/* Cloze Deletions (Reddish/Pink) */
.cloze {
  color: #c2306f;
  font-weight: 600;
}
.nightMode .cloze {
  color: #ff8fb3; 
}

/* ─── Question (Front) ──────────────────────────── */
.ap-question {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.55;
  color: inherit;
}

/* ─── Answer (Back) ─────────────────────────────── */
.ap-answer {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.55;
}

/* ─── Cloze ─────────────────────────────────────── */
.ap-cloze {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.55;
  color: inherit;
}

/* ─── Supplement ────────────────────────────────── */
.ap-supplement {
  font-size: 18px;
  line-height: 1.5;
  margin-top: 24px;
  padding: 16px 20px;
  background: rgba(75, 156, 211, 0.08);
  border-left: 4px solid #4b9cd3;
  border-radius: 4px;
  color: inherit;
}
.nightMode .ap-supplement {
  background: rgba(25, 70, 141, 0.35);
}

/* ─── Divider ───────────────────────────────────── */
.ap-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(75, 156, 211, 0.55), transparent);
  margin: 28px 0;
  border: none;
}

/* ─── Direction Badge (Reversible) ──────────────── */
.ap-direction {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #19468d;
  background: rgba(75, 156, 211, 0.12);
  padding: 4px 10px;
  border-radius: 6px;
  margin-bottom: 14px;
}

/* ─── Footer & Jump Button ──────────────────────── */
.ap-footer {
  margin-top: 32px;
  text-align: center;
}
.ap-jump {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: transparent;
  border: 1px solid rgba(75, 156, 211, 0.35);
  border-radius: 8px;
  color: #19468d;
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.2s ease;
}
.ap-jump:hover {
  background: rgba(75, 156, 211, 0.1);
  border-color: #4b9cd3;
}
.ap-jump svg {
  opacity: 0.7;
}

/* ─── Inline Elements ───────────────────────────── */
b, strong { font-weight: 700; }
i, em { font-style: italic; }
/* Inline code chip: white surface, orange text — the same pairing as
   .block-paragraph code in the document editor. The faint border keeps the
   white chip visible on a white card. Deliberately left white in night mode. */
code {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.82em;
  background: #ffffff;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(0,0,0,0.08);
  color: #e17055;
}
img {
  max-width: 100%;
  border-radius: 8px;
  margin: 10px 0;
}

/* ─── Markdown Table ────────────────────────────── */
.ankipapers-md-table {
  width: max-content;      /* only as wide as the content needs… */
  max-width: 80%;          /* …then cap it and let the cells wrap */
  border-collapse: collapse;
  margin: 16px auto;       /* centered, like a picture */
  font-size: 16px;
  table-layout: auto;
}
.ankipapers-md-table.is-s { max-width: 40%; }
.ankipapers-md-table.is-m { max-width: 60%; }
.ankipapers-md-table.is-l { max-width: 80%; }
.ankipapers-md-table.is-full { max-width: 100%; }
.ankipapers-md-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 2px solid rgba(75, 156, 211, 0.35);
  font-weight: 600;
  color: #19468d;
}
.ankipapers-md-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

/* ─── Dark Mode (Anki native .nightMode / .night_mode) ─── */
.nightMode .ankipapers-card,
.night_mode .ankipapers-card {
  color: #e9f1fb;
}
/* The #19468D accents above lightened to pale Carolina for night mode. */
.nightMode .ap-direction,
.night_mode .ap-direction,
.nightMode .ap-jump,
.night_mode .ap-jump,
.nightMode .ankipapers-md-table th,
.night_mode .ankipapers-md-table th {
  color: #7bafd4;
}
.nightMode .ap-answer,
.night_mode .ap-answer {
  color: #6ecf8a;
}
.nightMode .ankipapers-md-table td,
.night_mode .ankipapers-md-table td {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

/* ─── Document links ─── */
/* A phrase that points at a header elsewhere in Anki Papers. It is not
   clickable inside Anki, but it keeps the visual cue that it is a link.
   Violet, so a link never reads as a heading in the card's blues. */
.ankipapers-card .ap-link {
  color: #7a3fb8;
  text-decoration: underline;
  text-decoration-color: rgba(122, 63, 184, 0.85);
  text-underline-offset: 2px;
  text-decoration-thickness: 2px;
}
.nightMode .ankipapers-card .ap-link,
.night_mode .ankipapers-card .ap-link {
  color: #c4a5f5;
  text-decoration-color: rgba(196, 165, 245, 0.75);
}

/* ─── Cloze hints ─── */
/* The "[hint]" that follows a cloze phrase in the breadcrumb. Dark pink on a
   light card, light pink on a dark one. */
.ankipapers-card .ap-cloze-hint {
  color: #b01e63;
  font-weight: 600;
}
.nightMode .ankipapers-card .ap-cloze-hint,
.night_mode .ankipapers-card .ap-cloze-hint {
  color: #ffa8cd;
}
"""

_SOLARIZED_CSS = """
/* ═══ Solarized Styling ═════════════════════════════════════════════════
   Optional card style (Settings → Card style), layered on top of the
   built-in stylesheet above. Inspired by Shamim Ahmed's "How to Design
   Beautiful Anki Cards" (medshamim.com, 2018): his slate palette is the dark
   version, used when Anki is in dark mode; the light version keeps his hues,
   deepened so every text color clears the WCAG 4.5:1 contrast minimum on the
   light background. */
.card {
  --ap-bg: #F5F7FA;
  --ap-fg: #333B45;
  --ap-muted: #5F6775;
  --ap-bold: #8A4A8A;
  --ap-italic: #B23A3A;
  --ap-underline: #1D7676;
  --ap-green: #1E7A45;
  --ap-blue: #2A5F9E;
  --ap-code: #A8480C;
  --ap-code-bg: #E6EAF0;
  --ap-rule: rgba(51,59,69,0.14);
  /* Slots a color scheme can re-point (see _SOLARIZED_PALETTES); the classic
     look takes cloze from green and reversible answers and links from blue. */
  --ap-cloze: var(--ap-green);
  --ap-rev: var(--ap-blue);
  --ap-link: var(--ap-blue);
  --ap-u-deco: none;
  --ap-crumb: var(--ap-muted);  /* the breadcrumb above the card */
}
.card.nightMode, .card.night_mode, .nightMode .card, .night_mode .card {
  --ap-bg: #333B45;
  --ap-fg: #D7DEE9;
  --ap-muted: #A6ABB9;
  --ap-bold: #C695C6;
  --ap-italic: #CD5C5C;
  --ap-underline: #5EB3B3;
  --ap-green: #3CB371;
  --ap-blue: #6699CC;
  --ap-code: #F99157;
  --ap-code-bg: #3E4651;
  --ap-rule: rgba(215,222,233,0.14);
}

/* ── Solarized theme layer (inspired by Shamim Ahmed's Anki design) ──
   Appended after the built-in stylesheet; every color comes from the
   --ap-* variables above, so the dark and light versions share one ruleset. */
.card { background: var(--ap-bg) !important; color: var(--ap-fg); }
.card .ankipapers-card {
  font-family: Menlo, 'SF Mono', Monaco, Consolas, monospace;
  font-size: 18px; line-height: 1.6; color: var(--ap-fg);
  text-align: left; max-width: 700px; word-wrap: break-word;
}
.card .ap-question, .card .ap-answer, .card .ap-cloze { font-size: 18px; font-weight: 400; color: var(--ap-fg); }
/* Only the breadcrumb (and the Papers button) is centered; everything below
   the breadcrumb's rule reads left-aligned. Pictures and tables stay centered
   by their own auto margins. */
.card .ap-meta { border-bottom: 1px solid var(--ap-rule); text-align: center; }
.card .ap-meta-heading { color: var(--ap-crumb); letter-spacing: 0.08em; }
.card .ap-crumb-h1 { font-size: 17px; text-decoration: none; }
.card .ap-crumb-h2 { font-size: 15px; }
.card .ap-crumb-h3 { font-size: 14px; }
.card .ap-meta-block { color: var(--ap-crumb); font-size: 16px; font-weight: 400; }
.card b, .card strong { color: var(--ap-bold); }
.card i, .card em { color: var(--ap-italic); }
.card u { text-decoration: var(--ap-u-deco); color: var(--ap-underline); }
.card .cloze, .card .cloze b, .card .cloze i, .card .cloze u { color: var(--ap-cloze); font-weight: 700; }
.card .ap-answer-basic { color: var(--ap-green); }
.card .ap-answer-reversible { color: var(--ap-rev); }
.card .ap-supplement {
  background: none; border-left: none; padding: 0; margin-top: 20px;
  font-size: 15px; font-style: italic; color: var(--ap-fg);
}
.card .ap-divider { background: var(--ap-rule); margin: 20px 0; }
.card code { background: var(--ap-code-bg); color: var(--ap-code); border-color: transparent; }
.card .ap-link, .card .ankipapers-card .ap-link { color: var(--ap-link); }
.card .ap-cloze-hint { color: var(--ap-muted); }
.card .ap-direction { color: var(--ap-muted); background: var(--ap-rule); }
.card .ankipapers-md-table { font-size: 14px; }
.card .ankipapers-md-table th { color: var(--ap-underline); border-bottom-color: var(--ap-rule); }
.card .ankipapers-md-table td { border-bottom-color: var(--ap-rule); }
.card .ap-jump { color: var(--ap-muted); border-color: var(--ap-rule); }
.card .ap-jump:hover { background: var(--ap-rule); border-color: var(--ap-muted); }
.card img { display: block; margin: 10px auto; }
"""

CARD_STYLES = ("basic", "solarized")

# ═══ Color schemes ═══════════════════════════════════════════════════════
# The app's color scheme (Settings → Color scheme) also colors the Basic
# card style. _ANKIPAPERS_CSS above is the Carolina blue / #19468D look; the
# other schemes are layered on top of it here, repeating each selector of the
# base sheet (day and night) so they win on order alone. Solarized is appended
# after the scheme layer and overrides every one of these colors, so it is
# the same in every scheme.
_PURPLE_CSS = """
/* ═══ Color scheme: original purple ═══ */
.ankipapers-card { color: #1a1a2e; }
.ap-meta-heading { color: #6c5ce7; }
.nightMode .ap-meta-heading,
.night_mode .ap-meta-heading { color: #6c5ce7; }
.ap-answer-basic { color: #228B22; }
.nightMode .ap-answer-basic { color: #82E0AA; }
.ap-answer-reversible { color: #4169E1; }
.nightMode .ap-answer-reversible { color: #4B9CD3; }
.cloze { color: #e83e8c; }
.ap-supplement { background: rgba(108, 92, 231, 0.05); border-left-color: #6c5ce7; }
.nightMode .ap-supplement { background: rgba(108, 92, 231, 0.15); }
.ap-divider { background: linear-gradient(90deg, transparent, rgba(108, 92, 231, 0.35), transparent); }
.ap-direction { color: #6c5ce7; background: rgba(108, 92, 231, 0.08); }
.ap-jump { border-color: rgba(108, 92, 231, 0.22); color: #6c5ce7; }
.ap-jump:hover { background: rgba(108, 92, 231, 0.08); border-color: #6c5ce7; }
.ankipapers-md-table th { border-bottom-color: rgba(108, 92, 231, 0.25); color: #6c5ce7; }
.nightMode .ankipapers-card,
.night_mode .ankipapers-card { color: #e8e8f0; }
.nightMode .ap-direction,
.night_mode .ap-direction,
.nightMode .ap-jump,
.night_mode .ap-jump,
.nightMode .ankipapers-md-table th,
.night_mode .ankipapers-md-table th { color: #6c5ce7; }
.ankipapers-card .ap-link { color: #123a8a; text-decoration-color: rgba(18, 58, 138, 0.85); }
.nightMode .ankipapers-card .ap-link,
.night_mode .ankipapers-card .ap-link { color: #7aa7ff; text-decoration-color: rgba(122, 167, 255, 0.75); }
"""

# Grayscale, except the answer colors, which tell card types apart.
_MONO_CSS = """
/* ═══ Color scheme: black & white ═══ */
.ankipapers-card { color: #1a1a2e; }
.ap-meta-heading { color: #111111; }
.nightMode .ap-meta-heading,
.night_mode .ap-meta-heading { color: #f0f0f0; }
.ap-supplement { background: rgba(0, 0, 0, 0.04); border-left-color: #555555; }
.nightMode .ap-supplement { background: rgba(255, 255, 255, 0.06); border-left-color: #aaaaaa; }
.ap-divider { background: linear-gradient(90deg, transparent, rgba(128, 128, 128, 0.45), transparent); }
.ap-direction { color: #333333; background: rgba(0, 0, 0, 0.06); }
.ap-jump { border-color: rgba(0, 0, 0, 0.2); color: #333333; }
.ap-jump:hover { background: rgba(0, 0, 0, 0.05); border-color: #333333; }
.ankipapers-md-table th { border-bottom-color: rgba(0, 0, 0, 0.2); color: #111111; }
.nightMode .ankipapers-card,
.night_mode .ankipapers-card { color: #ececec; }
.nightMode .ap-direction,
.night_mode .ap-direction,
.nightMode .ap-jump,
.night_mode .ap-jump,
.nightMode .ankipapers-md-table th,
.night_mode .ankipapers-md-table th { color: #dddddd; }
.ankipapers-card .ap-link { color: #111111; text-decoration-color: rgba(0, 0, 0, 0.6); }
.nightMode .ankipapers-card .ap-link,
.night_mode .ankipapers-card .ap-link { color: #eeeeee; text-decoration-color: rgba(255, 255, 255, 0.6); }
"""

# Crimson & white. Cloze turns violet and links blue, so neither reads as
# part of the red; basic (green) and reversible (amber) are unchanged.
_CRIMSON_CSS = """
/* ═══ Color scheme: crimson & white ═══ */
.ap-meta-heading { color: #9e1b32; }
.nightMode .ap-meta-heading,
.night_mode .ap-meta-heading { color: #ff8a9a; }
.cloze { color: #7a3fb8; }
.nightMode .cloze { color: #c4a5f5; }
.ap-supplement { background: rgba(158, 27, 50, 0.05); border-left-color: #9e1b32; }
.nightMode .ap-supplement { background: rgba(158, 27, 50, 0.3); border-left-color: #e0475f; }
.ap-divider { background: linear-gradient(90deg, transparent, rgba(158, 27, 50, 0.4), transparent); }
.ap-direction { color: #9e1b32; background: rgba(158, 27, 50, 0.08); }
.ap-jump { border-color: rgba(158, 27, 50, 0.25); color: #9e1b32; }
.ap-jump:hover { background: rgba(158, 27, 50, 0.07); border-color: #9e1b32; }
.ankipapers-md-table th { border-bottom-color: rgba(158, 27, 50, 0.3); color: #9e1b32; }
.nightMode .ankipapers-card,
.night_mode .ankipapers-card { color: #f5eced; }
.nightMode .ap-direction,
.night_mode .ap-direction,
.nightMode .ap-jump,
.night_mode .ap-jump,
.nightMode .ankipapers-md-table th,
.night_mode .ankipapers-md-table th { color: #ff8a9a; }
.ankipapers-card .ap-link { color: #1d5fbf; text-decoration-color: rgba(29, 95, 191, 0.85); }
.nightMode .ankipapers-card .ap-link,
.night_mode .ankipapers-card .ap-link { color: #7fb2ff; text-decoration-color: rgba(127, 178, 255, 0.75); }
.ankipapers-card .ap-cloze-hint { color: #5b2a91; }
.nightMode .ankipapers-card .ap-cloze-hint,
.night_mode .ankipapers-card .ap-cloze-hint { color: #d9c6fa; }
"""

# Solarized in each color scheme: the same Solarized rules, re-pointed to the
# scheme's palette by redefining the --ap-* variables (day, then night). Each
# block repeats Solarized's own selectors and comes after it, so it wins on
# order. Original purple keeps the classic Solarized palette untouched.
_SOLARIZED_NIGHT = ".card.nightMode, .card.night_mode, .nightMode .card, .night_mode .card"


def _solarized_palette(name: str, day: dict, night: dict) -> str:
    def block(sel, vals):
        return sel + " {\n" + "".join(f"  --ap-{k}: {v};\n" for k, v in vals.items()) + "}\n"
    return f"\n/* ═══ Solarized, {name} palette ═══ */\n" + block(".card", day) + block(_SOLARIZED_NIGHT, night)


_SOLARIZED_PALETTES = {
    "purple": "",
    "carolina": _solarized_palette(
        "Carolina blue",
        # Day: a white card with pitch-black text.
        {"bg": "#FFFFFF", "fg": "#000000", "muted": "#5D728E", "bold": "#19468D", "italic": "#B23A3A",
         "underline": "#1D7676", "green": "#1E7A45", "cloze": "#1F6FAE", "rev": "#A8620A", "link": "#7A3FB8",
         "code": "#A8480C", "code-bg": "#E1EAF4", "rule": "rgba(25,70,141,0.14)", "crumb": "#19468D"},
        {"bg": "#1B2A44", "fg": "#D6E4F2", "muted": "#9FB4CC", "bold": "#9CC9EA", "italic": "#E07A7A",
         "underline": "#5EB3B3", "green": "#4CC38A", "cloze": "#4B9CD3", "rev": "#F0B45A", "link": "#C4A5F5",
         "code": "#F99157", "code-bg": "#24375A", "rule": "rgba(156,201,234,0.16)", "crumb": "#9FB4CC"},
    ),
    "crimson": _solarized_palette(
        "crimson",
        # Italics move off Solarized's red to slate blue, apart from the crimson bold.
        # Day: a white card with pitch-black text.
        {"bg": "#FFFFFF", "fg": "#000000", "muted": "#7A5A61", "bold": "#9E1B32", "italic": "#3D6A8F",
         "underline": "#1D7676", "green": "#1E7A45", "cloze": "#7A3FB8", "rev": "#A8620A", "link": "#1D5FBF",
         "code": "#A8480C", "code-bg": "#F2E6E8", "rule": "rgba(158,27,50,0.14)", "crumb": "#7A1426"},
        {"bg": "#2E1C21", "fg": "#F0E2E5", "muted": "#B79CA2", "bold": "#FF8A9A", "italic": "#8FB8DE",
         "underline": "#5EB3B3", "green": "#4CC38A", "cloze": "#C4A5F5", "rev": "#F0B45A", "link": "#7FB2FF",
         "code": "#F99157", "code-bg": "#3D262C", "rule": "rgba(255,138,154,0.16)", "crumb": "#B79CA2"},
    ),
    "mono": _solarized_palette(
        "black & white",
        # Grayscale, keeping the answer colors; underline is a real underline.
        {"bg": "#F7F7F7", "fg": "#222222", "muted": "#6B6B6B", "bold": "#000000", "italic": "#555555",
         "underline": "#222222", "u-deco": "underline", "green": "#1E7A45", "cloze": "#C2306F",
         "rev": "#A8620A", "link": "#111111", "code": "#222222", "code-bg": "#E8E8E8",
         "rule": "rgba(0,0,0,0.12)"},
        {"bg": "#262626", "fg": "#E4E4E4", "muted": "#A0A0A0", "bold": "#FFFFFF", "italic": "#BDBDBD",
         "underline": "#E4E4E4", "u-deco": "underline", "green": "#4CC38A", "cloze": "#FF8FB3",
         "rev": "#F0B45A", "link": "#EEEEEE", "code": "#E4E4E4", "code-bg": "#363636",
         "rule": "rgba(255,255,255,0.12)"},
    ),
}

COLOR_SCHEMES = ("carolina", "purple", "mono", "crimson")
_SCHEME_CSS = {"carolina": "", "purple": _PURPLE_CSS, "mono": _MONO_CSS, "crimson": _CRIMSON_CSS}


def card_css(style: Optional[str] = "basic", color_scheme: Optional[str] = "carolina") -> str:
    """The stylesheet for a card style in a color scheme. "basic" is the
    built-in look colored by the scheme; "solarized" layers Solarized Styling
    on top, in the scheme's Solarized palette (original purple keeps the
    classic one). Anything unrecognized falls back to basic / carolina, so a
    bad config value can never break the cards."""
    style = (style or "basic").strip().lower()
    scheme = (color_scheme or "carolina").strip().lower()
    if scheme not in _SCHEME_CSS:
        scheme = "carolina"
    css = _ANKIPAPERS_CSS + _SCHEME_CSS[scheme]
    if style == "solarized":
        return css + "\n" + _SOLARIZED_CSS + _SOLARIZED_PALETTES[scheme]
    return css


# The inline-markdown renderer and its patterns live in parser.py — breadcrumbs
# need them too, and this module already imports from there. Re-exported under
# the old private names so the rest of this file reads unchanged.
_IMG_RE = IMG_RE
_AP_LINK_RE = AP_LINK_RE
_CODE_RE = CODE_RE
_md_inline_to_html = md_inline_to_html


# A table's width setting rides on the end of its header row. Mirrors
# TABLE_SIZE_TAIL in web_src/src/blockFormat.js — the two have to agree, or a
# marker written in the editor shows up as text inside a card's last column.
_TABLE_SIZE_RE = re.compile(r"<!--ap-table:(s|m|l|full)-->[ \t]*$", re.IGNORECASE)
_TABLE_SIZES = ("s", "m", "l", "full")
_TABLE_SIZE_DEFAULT = "l"


def _table_size_of(line: str) -> str:
    m = _TABLE_SIZE_RE.search((line or "").strip())
    return m.group(1).lower() if m else _TABLE_SIZE_DEFAULT


def _strip_table_size(line: str) -> str:
    return _TABLE_SIZE_RE.sub("", line or "")


def _split_md_table_row(line: str) -> List[str]:
    raw = _strip_table_size(line).strip()
    if raw.startswith("|"):
        raw = raw[1:]
    if raw.endswith("|"):
        raw = raw[:-1]
    return [c.strip() for c in raw.split("|")]


def _is_md_table_separator(line: str) -> bool:
    cells = _split_md_table_row(line)
    if len(cells) < 2:
        return False
    for c in cells:
        cc = c.strip()
        if not cc:
            return False
        if not re.fullmatch(r":?-{3,}:?", cc):
            return False
    return True


def _is_md_table_row(line: str) -> bool:
    s = _strip_table_size(line).strip()
    return s.startswith("|") and s.endswith("|") and "|" in s[1:-1]


def _md_to_html(text: str) -> str:
    """Convert lightweight markdown (including tables) to HTML for note fields."""
    if not text:
        return text

    lines = text.split("\n")
    out: List[str] = []
    i = 0
    n = len(lines)

    while i < n:
        if (
            i + 1 < n
            and _is_md_table_row(lines[i])
            and _is_md_table_separator(lines[i + 1])
        ):
            header_cells = _split_md_table_row(lines[i])
            body_rows: List[List[str]] = []
            j = i + 2
            while j < n and _is_md_table_row(lines[j]):
                body_rows.append(_split_md_table_row(lines[j]))
                j += 1

            head_html = "".join(
                f"<th>{_md_inline_to_html(cell)}</th>" for cell in header_cells
            )
            body_html = "".join(
                "<tr>"
                + "".join(f"<td>{_md_inline_to_html(cell)}</td>" for cell in row)
                + "</tr>"
                for row in body_rows
            )
            size = _table_size_of(lines[i])
            out.append(
                f'<table class="ankipapers-md-table is-{size}"><thead><tr>'
                + head_html
                + "</tr></thead><tbody>"
                + body_html
                + "</tbody></table>"
            )
            i = j
            continue

        out.append(_md_inline_to_html(lines[i]))
        i += 1

    return "\n".join(out)


class AnkiEditConflictAbort(Exception):
    """Raised when generate_cards(..., anki_edit_conflict='abort') and conflicts exist."""

    def __init__(self, conflicts: List[Dict[str, Any]]):
        self.conflicts = conflicts
        super().__init__(f"{len(conflicts)} anki_edit_conflicts")


_IMG_TAG_RE = re.compile(
    r"""<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>""",
    re.IGNORECASE,
)


def _normalize_field_value(text: str) -> str:
    """Compare Anki field HTML to plain paper text more reliably.

    Images are reduced to a [img:filename] token BEFORE the general tag strip.
    They carry their meaning in the src attribute rather than in text, so
    stripping every tag turned <img src="brain.png"> into the empty string —
    which made an image-only field compare equal to a blank one. Generate
    could then never see an image added, swapped or removed, on any conflict
    policy, and deleting the card was the only way to get the picture onto it.
    """
    if not text:
        return ""

    def _img_token(m):
        src = m.group(1) or m.group(2) or m.group(3) or ""
        return f" [img:{src.strip()}] "

    s = _IMG_TAG_RE.sub(_img_token, text)
    s = re.sub(r"<[^>]+>", " ", s)
    return " ".join(s.split()).strip()


_CONTEXT_CLOZE_RE = re.compile(r"\{\{(?:c\d+::)?(.+?)\}\}")


def _render_context(text: str) -> str:
    """Render the Anki Papers syntax that can appear inside a breadcrumb.

    A parent line is shown verbatim, so anything written in it arrives here as
    raw source. Two things need translating, exactly as the editor shows them:

      * a cloze, which may carry a hint after a second "::", as in
        {{c1::.title()::string method}}. Anki shows that hint as
        "[string method]" while you review, so the breadcrumb reads the same
        way instead of printing the raw "::" in the middle of the phrase;

      * a document link, [phrase](ap://paper#block), which should read as the
        phrase alone — underlined and blue, the way it looks in the editor —
        rather than spelling out the ap:// address.
    """
    def cloze(match):
        head, sep, hint = match.group(1).partition("::")
        if not sep:
            return f"<b>{match.group(1)}</b>"
        return f'<b>{head}</b> <span class="ap-cloze-hint">[{hint}]</span>'

    text = _AP_LINK_RE.sub(r'<span class="ap-link">\1</span>', text)
    return _CONTEXT_CLOZE_RE.sub(cloze, text)


NO_HEADING_TAG = "AnkiPapers::NH"


def _hides_context(card: ParsedCard) -> bool:
    """True when the card's line carries [[NH]] (any case)."""
    return any((t or "").lower() == "nh" for t in (getattr(card, "inline_tags", None) or []))


def _card_context(card: ParsedCard, paper: Paper) -> str:
    """The Context field for a card: its breadcrumb, or empty under [[NH]].

    [[NH]] is applied here, when the note is written, rather than by a script
    in the card template that hid the field when the note had the NH tag. Two
    things were wrong with the script. It only ran on the question side, so the
    answer still showed the breadcrumb. And Generate could not see the tag
    being added or removed — [[tags]] are stripped before content_hash, and
    derived_hash covered only the field text — so adding [[NH]] to a line that
    already had a card never reached Anki. An empty Context changes
    derived_hash, so adding or removing [[NH]] is now an ordinary paper-side
    edit that Generate always applies.
    """
    if _hides_context(card):
        return ""
    return _render_context(get_context_heading(paper.content, card.line_index))


def _paper_context_and_supplement(card: ParsedCard, paper: Paper) -> Tuple[str, str]:
    """The two note fields that come from the paper but not from the card's line."""
    context = _card_context(card, paper)
    supp = _md_to_html(getattr(card, "supplement", ""))
    return context, supp


def _paper_derived_field_values(card: ParsedCard, paper: Paper) -> List[str]:
    """What the note fields would contain if generated right now."""
    context, supp = _paper_context_and_supplement(card, paper)

    if card.card_type in ("basic", "reversible"):
        return [_md_to_html(card.front), _md_to_html(card.back), context, supp]
    if card.card_type == "cloze":
        return [_md_to_html(card.cloze_text), context, supp]
    return []


def derived_hash_for(card: ParsedCard, paper: Paper) -> str:
    """Hash of the note parts the card's own line does not determine.

    content_hash covers the card line and nothing else, so editing a "&&"
    supplement or renaming a heading above the card leaves it identical. This
    is the companion signal: stored on the CardReference when a note is
    written, it says what the supplement and breadcrumb were at that moment.
    """
    context, supp = _paper_context_and_supplement(card, paper)
    return compute_hash(f"{context}\x00{supp}")


def _note_field_diff(note, card: ParsedCard, paper: Paper) -> set:
    """Which parts of the note disagree with what the paper would generate now.

    A subset of {"body", "context", "supplement"}. Knowing *which* part
    differs is what lets generate_cards tell a paper-side change (the
    supplement or the heading above the card moved) from an Anki-side one
    (someone retyped the question in the Browser).
    """
    context, supp = _paper_context_and_supplement(card, paper)

    if card.card_type in ("basic", "reversible"):
        # Front(0), Back(1), Context(2), Source(3), Supplement(4)
        exp_body = [_md_to_html(card.front), _md_to_html(card.back)]
        act_body = [note.fields[0], note.fields[1]]
        act_context = note.fields[2] if len(note.fields) > 2 else ""
        act_supp = note.fields[4] if len(note.fields) > 4 else ""
    elif card.card_type == "cloze":
        # Text(0), Context(1), Source(2), Supplement(3)
        exp_body = [_md_to_html(card.cloze_text)]
        act_body = [note.fields[0]]
        act_context = note.fields[1] if len(note.fields) > 1 else ""
        act_supp = note.fields[3] if len(note.fields) > 3 else ""
    else:
        return set()

    diff = set()
    if len(act_body) != len(exp_body) or any(
        _normalize_field_value(a) != _normalize_field_value(e)
        for a, e in zip(act_body, exp_body)
    ):
        diff.add("body")
    if _normalize_field_value(act_context) != _normalize_field_value(context):
        diff.add("context")
    if _normalize_field_value(act_supp) != _normalize_field_value(supp):
        diff.add("supplement")
    return diff


def _note_semantic_match(note, card: ParsedCard, paper: Paper) -> bool:
    """True if note fields match what the current paper line would produce."""
    return not _note_field_diff(note, card, paper)


def _is_paper_side_change(existing_ref, derived: str, diff: set) -> bool:
    """True when the note differs from the paper because the PAPER moved on.

    Only called when the card's own line is unchanged, so the difference has
    to come from the supplement or the breadcrumb \u2014 unless the note was edited
    in Anki. derived_hash separates the two: it records what this note was
    written with last time.
    """
    stored = getattr(existing_ref, "derived_hash", None)
    if stored:
        # We know what we last wrote. Still matching the paper means the note
        # itself was edited; no longer matching means the paper changed.
        return stored != derived
    # Written before derived_hash existed, so there is nothing to compare.
    # Fall back to what differs: no earlier version of Generate could push a
    # supplement or breadcrumb change, so the paper is the only plausible
    # source of one. A changed question or answer, on an unchanged line, is
    # Anki's doing and stays subject to the conflict policy.
    return "body" not in diff


def _ref_is_claimed(ref: Optional[CardReference], claimed_note_ids) -> bool:
    """True when this Anki note has already been taken by an earlier card."""
    if ref is None or claimed_note_ids is None:
        return False
    return bool(ref.anki_note_id) and ref.anki_note_id in claimed_note_ids


def _resolve_existing_ref_for_card(
    card: ParsedCard,
    refs_by_block_id: Dict[str, CardReference],
    existing_by_hash: Dict[str, CardReference],
    claimed_note_ids=None,
) -> Optional[CardReference]:
    """Find the stored reference this card corresponds to, if any.

    Anchor first, then exact text. The hash fallback is what keeps papers
    written before anchors existed working: their cards carry no anchor, so
    identical text is the only handle available for the one generate that
    adopts them.

    claimed_note_ids, when given, is the set of Anki notes already taken by
    an earlier card in this same pass. Two lines with identical text share a
    content_hash and would otherwise both resolve to the same stored
    reference — so both would claim the same note, and both would be stamped
    with the same anchor, permanently fusing two separate cards into one
    identity. Skipping a claimed note lets the second line be created as a
    card of its own, which is what the document says it is.
    """
    if card.block_id:
        ref = refs_by_block_id.get(card.block_id)
        if ref is not None and not _ref_is_claimed(ref, claimed_note_ids):
            return ref
    ref = existing_by_hash.get(card.content_hash)
    if ref is not None and not _ref_is_claimed(ref, claimed_note_ids):
        return ref
    return None


def list_anki_edit_conflicts(paper: Paper, col) -> List[Dict[str, Any]]:
    """
    Cards whose paper line text is unchanged (same content_hash as ref) but the Anki
    note's front/back/cloze/context no longer matches the paper (edited in Browser/Editor).
    """
    cards = extract_cards(paper.content)
    refs_by_block_id: Dict[str, CardReference] = {}
    existing_by_hash: Dict[str, CardReference] = {}
    for ref in paper.card_refs:
        if ref.block_id:
            refs_by_block_id[ref.block_id] = ref
        if ref.content_hash:
            existing_by_hash[ref.content_hash] = ref

    out: List[Dict[str, Any]] = []
    for card in cards:
        existing_ref = _resolve_existing_ref_for_card(
            card, refs_by_block_id, existing_by_hash
        )
        if not existing_ref or not existing_ref.anki_note_id:
            continue
        if existing_ref.content_hash != card.content_hash:
            continue
        try:
            note = col.get_note(existing_ref.anki_note_id)
        except Exception:
            continue
        diff = _note_field_diff(note, card, paper)
        if not diff:
            continue
        # A supplement or breadcrumb the paper has moved on from is not a
        # conflict — Generate applies those itself. Reporting them here would
        # put the "edited in Anki" modal in front of edits the user just made
        # in the paper.
        if _is_paper_side_change(existing_ref, derived_hash_for(card, paper), diff):
            continue
        out.append(
            {
                "line_index": card.line_index,
                "block_id": existing_ref.block_id or card.block_id,
                "anki_note_id": existing_ref.anki_note_id,
                "card_type": card.card_type,
            }
        )
    return out


def ensure_note_types(col, card_style: str = "basic", color_scheme: str = "carolina"):
    """Ensure the required note types exist, with up-to-date templates and the
    stylesheet for `card_style` in `color_scheme` (see card_css). Runs on every
    Generate and when either setting changes, so it applies to every card at once."""
    css = card_css(card_style, color_scheme)
    _ensure_basic_type(col, css)
    _ensure_reversible_type(col, css)
    _ensure_cloze_type(col, css)


def _ensure_basic_type(col, css: str = _ANKIPAPERS_CSS):
    """Create the AnkiPapers Basic note type if it doesn't exist."""
    model_name = "AnkiPapers Basic"
    model = col.models.by_name(model_name)

    if model is None:
        model = col.models.new(model_name)

        # Add fields
        front_field = col.models.new_field("Front")
        col.models.add_field(model, front_field)

        back_field = col.models.new_field("Back")
        col.models.add_field(model, back_field)

        context_field = col.models.new_field("Context")
        col.models.add_field(model, context_field)

        source_field = col.models.new_field(ANKIPAPERS_FIELD)
        col.models.add_field(model, source_field)
        
        supplement_field = col.models.new_field("Supplement")
        col.models.add_field(model, supplement_field)

        # Add template
        tmpl = col.models.new_template("Card 1")
        tmpl["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
<div class="ap-question">{{Front}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-basic">{{Back}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl)

        model["css"] = css
        col.models.add(model)
    else:
        model["css"] = css
        
        # Ensure Supplement field exists on older installs
        if not any(f["name"] == "Supplement" for f in model["flds"]):
            supplement_field = col.models.new_field("Supplement")
            col.models.add_field(model, supplement_field)
            
        tmpl = model["tmpls"][0]
        tmpl["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
<div class="ap-question">{{Front}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-basic">{{Back}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.save(model)


def _ensure_cloze_type(col, css: str = _ANKIPAPERS_CSS):
    """Create the AnkiPapers Cloze note type if it doesn't exist."""
    model_name = "AnkiPapers Cloze"
    model = col.models.by_name(model_name)

    if model is None:
        model = col.models.new(model_name)
        model["type"] = 1  # Cloze type

        # Add fields
        text_field = col.models.new_field("Text")
        col.models.add_field(model, text_field)

        context_field = col.models.new_field("Context")
        col.models.add_field(model, context_field)

        source_field = col.models.new_field(ANKIPAPERS_FIELD)
        col.models.add_field(model, source_field)
        
        supplement_field = col.models.new_field("Supplement")
        col.models.add_field(model, supplement_field)

        # Add template
        tmpl = col.models.new_template("Cloze")
        tmpl["qfmt"] = '''<div class="ankipapers-card">
    {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
    <div class="ap-cloze">{{cloze:Text}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-cloze">{{cloze:Text}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl)

        model["css"] = css
        col.models.add(model)
    else:
        model["css"] = css
        
        # Ensure Supplement field exists on older installs
        if not any(f["name"] == "Supplement" for f in model["flds"]):
            supplement_field = col.models.new_field("Supplement")
            col.models.add_field(model, supplement_field)
            
        tmpl = model["tmpls"][0]
        tmpl["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-cloze">{{cloze:Text}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-cloze">{{cloze:Text}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.save(model)


def _ensure_reversible_type(col, css: str = _ANKIPAPERS_CSS):
    """Create the AnkiPapers Reversible note type if it doesn't exist."""
    model_name = "AnkiPapers Reversible"
    model = col.models.by_name(model_name)

    if model is None:
        model = col.models.new(model_name)

        # Add fields
        front_field = col.models.new_field("Front")
        col.models.add_field(model, front_field)

        back_field = col.models.new_field("Back")
        col.models.add_field(model, back_field)

        context_field = col.models.new_field("Context")
        col.models.add_field(model, context_field)

        source_field = col.models.new_field(ANKIPAPERS_FIELD)
        col.models.add_field(model, source_field)
        
        supplement_field = col.models.new_field("Supplement")
        col.models.add_field(model, supplement_field)

        # Forward template (Front → Back)
        tmpl1 = col.models.new_template("Forward")
        tmpl1["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl1["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Back}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl1)

        # Reverse template (Back → Front)
        tmpl2 = col.models.new_template("Reverse")
        tmpl2["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl2["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Front}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.add_template(model, tmpl2)

        model["css"] = css
        col.models.add(model)
    else:
        model["css"] = css
        
        # Ensure Supplement field exists on older installs
        if not any(f["name"] == "Supplement" for f in model["flds"]):
            supplement_field = col.models.new_field("Supplement")
            col.models.add_field(model, supplement_field)
            
        tmpl1 = model["tmpls"][0]
        tmpl1["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl1["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Forward</div>
  <div class="ap-question">{{Front}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Back}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        
        tmpl2 = model["tmpls"][1]
        tmpl2["qfmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        tmpl2["afmt"] = '''<div class="ankipapers-card">
  {{#Context}}<div class="ap-meta">{{Context}}</div>{{/Context}}
  <div class="ap-direction">Reverse</div>
  <div class="ap-question">{{Back}}</div>
  <div class="ap-divider"></div>
  <div class="ap-answer ap-answer-reversible">{{Front}}</div>
  {{#Supplement}}<div class="ap-supplement">{{Supplement}}</div>{{/Supplement}}
  <div class="ap-footer">
    <button class="ap-jump" onclick="pycmd('ankipapers_jump:'+'{{AnkiPapers_Source}}'); event.stopPropagation();">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Papers
    </button>
  </div>
</div>'''
        col.models.save(model)


def get_deck_id(col, deck_name: str) -> int:
    """Get or create a deck and return its ID.

    col.decks.id() is the call that CREATES a missing deck, along with any
    missing parents in a "A::B::C" name. id_for_name() only looks one up and
    returns None when it does not exist — so naming a deck that was not
    already in the collection handed None to add_note(), and every card for
    that paper landed in Default with no error and no warning.
    """
    name = (deck_name or "").strip() or "Default"

    deck = col.decks.by_name(name)
    if deck:
        return deck["id"]

    did = col.decks.id(name)
    if did:
        return did

    # Never return None. Falling back to Default is the same place the bug
    # used to put these cards, but as a decision rather than an accident.
    fallback = col.decks.by_name("Default")
    return fallback["id"] if fallback else 1


def _update_note_from_card(col, note, card: ParsedCard, paper: Paper, deck_id: int) -> bool:
    """Apply parsed card fields to an existing note. Returns True on success."""
    try:
        context = _card_context(card, paper)
        source_ref = f"{paper.id}:{card.line_index}"
        supp = _md_to_html(getattr(card, "supplement", ""))

        if card.card_type == "basic":
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref
            if len(note.fields) > 4:
                note.fields[4] = supp
                
        elif card.card_type == "reversible":
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref
            if len(note.fields) > 4:
                note.fields[4] = supp
                
        elif card.card_type == "cloze":
            note.fields[0] = _md_to_html(card.cloze_text)
            note.fields[1] = context
            note.fields[2] = source_ref
            if len(note.fields) > 3:
                note.fields[3] = supp
                
        else:
            return False
          
        # Ensure inline tags are synced on updates
        if hasattr(card, 'inline_tags') and card.inline_tags:
            for itag in card.inline_tags:
                formatted_tag = f"AnkiPapers::{itag}"
                if formatted_tag not in note.tags:
                    note.tags.append(formatted_tag)

        # Tags above are only ever added, so the NH tag is the one that must
        # also come off when [[NH]] is removed from the line. Other tags are
        # left alone: one added by hand in Anki is the user's to keep.
        if not _hides_context(card):
            note.tags = [t for t in note.tags if t.lower() != NO_HEADING_TAG.lower()]

        note.model()["did"] = deck_id
        if hasattr(col, "update_note"):
            col.update_note(note)
        else:
            note.flush()
        return True
    except Exception as e:
        print(f"[Anki Papers] Error updating note: {e}")
        return False


def generate_cards(
    paper: Paper,
    col,
    anki_edit_conflict: str = "preserve",
    card_style: str = "basic",
    color_scheme: str = "carolina",
) -> Tuple[int, int, int]:
    """
    Generate/update Anki cards from a paper.

    anki_edit_conflict:
        preserve — if the paper line is unchanged but Anki was edited, leave Anki as-is.
        overwrite — push paper text into Anki for those rows.
        abort — if any such conflict exists, raise AnkiEditConflictAbort before changes.

    Returns:
        Tuple of (created, updated, deleted) counts.
    """
    ensure_note_types(col, card_style, color_scheme)

    if anki_edit_conflict not in ("preserve", "overwrite", "abort"):
        anki_edit_conflict = "preserve"

    conflicts = list_anki_edit_conflicts(paper, col)
    if anki_edit_conflict == "abort" and conflicts:
        raise AnkiEditConflictAbort(conflicts)

    cards = extract_cards(paper.content)
    deck_id = get_deck_id(col, paper.deck_name)

    created = 0
    updated = 0
    deleted = 0

    old_refs = list(paper.card_refs)
    refs_by_block_id: Dict[str, CardReference] = {}
    existing_by_hash: Dict[str, CardReference] = {}
    for ref in old_refs:
        if ref.block_id:
            refs_by_block_id[ref.block_id] = ref
        if ref.content_hash:
            existing_by_hash[ref.content_hash] = ref

    new_card_refs: List[CardReference] = []

    # (line_index, block_id) pairs for card lines that carry no <!--ap:uuid-->
    # anchor yet. Applied to paper.content at the end of this function, so a
    # card's identity survives later edits to its text.
    #
    # Why this matters: _resolve_existing_ref_for_card() matches on the anchor
    # first and falls back to content_hash. A card with no anchor is therefore
    # recognized only by its text being byte-for-byte identical, so editing
    # the line orphans its note — the old note is no longer claimed and a new
    # one is created in its place. Anchoring the line makes the match survive
    # any edit to the wording.
    #
    # Anchors do not disturb the hash: parse_line() calls
    # split_stable_block_id() before compute_hash(), so content_hash is taken
    # from text that already has the anchor removed. Stamping a line does not
    # make it look "changed" on the next generate.
    pending_anchors: List[Tuple[int, str]] = []

    # Anki notes already taken by an earlier card in this pass, and block ids
    # already spoken for. Both stop two lines from collapsing onto one card.
    claimed_note_ids = set()
    used_block_ids = set()

    for card in cards:
        existing_ref = _resolve_existing_ref_for_card(
            card, refs_by_block_id, existing_by_hash, claimed_note_ids
        )

        reused = False
        if existing_ref and existing_ref.anki_note_id:
            try:
                note = col.get_note(existing_ref.anki_note_id)
            except Exception:
                note = None
            if note is not None:
                bid = card.block_id or existing_ref.block_id
                derived = derived_hash_for(card, paper)
                # Whether this note actually got rewritten on this pass. Only
                # then may the fresh derived_hash be recorded: the hash means
                # "what was last written to this note", and stamping it after a
                # write that did not happen told every later run the note was
                # already current. One failed write left a note permanently
                # stale, because nothing ever asked again.
                written = False
                if existing_ref.content_hash != card.content_hash:
                    if _update_note_from_card(col, note, card, paper, deck_id):
                        updated += 1
                        written = True
                else:
                    diff = _note_field_diff(note, card, paper)
                    # A paper-side change (the supplement or the heading above
                    # this card moved) is just an edit waiting to be applied,
                    # not a conflict — it needs no policy and no permission.
                    # Only a genuine Anki-side edit consults the policy.
                    #
                    # diff compares fields with their markup stripped, so a
                    # change that is only markup — the breadcrumb gaining its
                    # per-level spans, say — leaves it empty even though the
                    # note is stale. derived_hash covers exactly that case: it
                    # hashes the raw context and supplement, so it moves when
                    # the markup does. A moved derived_hash opens the gate on
                    # its own. A ref with no derived_hash at all was written
                    # before the hash existed and has never had its context
                    # refreshed, so it counts as moved once; the hash is
                    # stored below and later runs go quiet.
                    stored_derived = getattr(existing_ref, "derived_hash", None)
                    derived_moved = stored_derived != derived
                    if (diff or derived_moved) and (
                        _is_paper_side_change(existing_ref, derived, diff)
                        or anki_edit_conflict == "overwrite"
                    ):
                        if _update_note_from_card(col, note, card, paper, deck_id):
                            updated += 1
                            written = True
                    elif not diff and not derived_moved:
                        # Nothing to write because nothing differs — the note
                        # already matches the paper, so the current hash is
                        # genuinely what it holds.
                        written = True
                if not bid or bid in used_block_ids:
                    bid = str(uuid.uuid4())
                # Backfill. This card already exists in Anki and keeps its
                # note — it is only being given a permanent name. When the
                # stored reference already carried a block id (every paper
                # migrated to disk has them in its .ap.json), that same id is
                # written into the document, so the anchor and the sidecar
                # agree and nothing is recreated. The hash is computed with
                # the anchor stripped, so this does not count as an edit.
                if not card.block_id:
                    pending_anchors.append((card.line_index, bid))
                used_block_ids.add(bid)
                claimed_note_ids.add(existing_ref.anki_note_id)
                new_card_refs.append(
                    CardReference(
                        line_index=card.line_index,
                        card_type=card.card_type,
                        anki_note_id=existing_ref.anki_note_id,
                        content_hash=card.content_hash,
                        synced=True,
                        block_id=bid,
                        derived_hash=(
                            derived if written
                            else (getattr(existing_ref, "derived_hash", None) or derived)
                        ),
                    )
                )
                reused = True
        if reused:
            continue

        note_id = _create_note(col, card, paper, deck_id)
        if note_id:
            bid = card.block_id or str(uuid.uuid4())
            if bid in used_block_ids:
                bid = str(uuid.uuid4())
            if not card.block_id:
                pending_anchors.append((card.line_index, bid))
            used_block_ids.add(bid)
            claimed_note_ids.add(note_id)
            new_card_refs.append(
                CardReference(
                    line_index=card.line_index,
                    card_type=card.card_type,
                    anki_note_id=note_id,
                    content_hash=card.content_hash,
                    synced=True,
                    block_id=bid,
                    derived_hash=derived_hash_for(card, paper),
                )
            )
            created += 1

    kept = {r.anki_note_id for r in new_card_refs if r.anki_note_id}
    for old_ref in old_refs:
        if old_ref.anki_note_id and old_ref.anki_note_id not in kept:
            try:
                col.remove_notes([old_ref.anki_note_id])
                deleted += 1
            except Exception:
                pass

    # Stamp anchors last, so a failure anywhere above leaves the document
    # exactly as the user wrote it. The caller (bridge.generate_cards) saves
    # the paper after this returns, and the web side reloads it, so the
    # anchored content reaches disk and the editor together.
    if pending_anchors:
        paper.content = inject_stable_block_ids(paper.content, pending_anchors)

    paper.card_refs = new_card_refs
    return created, updated, deleted


def _create_note(col, card: ParsedCard, paper: Paper, deck_id: int) -> Optional[int]:
    """Create a single Anki note from a ParsedCard."""
    try:
        context = _card_context(card, paper)
        source_ref = f"{paper.id}:{card.line_index}"
        supp = _md_to_html(getattr(card, "supplement", ""))

        # Build tags
        tags = [ANKIPAPERS_TAG]
        if paper.tags:
            tags.extend(paper.tags)
        # Add paper title as tag (sanitized)
        paper_tag = f"AnkiPapers::{paper.title.replace(' ', '_')}"
        tags.append(paper_tag)
        
        # Apply line-specific [[tags]]
        if hasattr(card, 'inline_tags') and card.inline_tags:
            for itag in card.inline_tags:
                tags.append(f"AnkiPapers::{itag}")

        if card.card_type == "basic":
            model = col.models.by_name("AnkiPapers Basic")
            if not model:
                return None
            note = col.new_note(model)
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref
            if len(note.fields) > 4:
                note.fields[4] = supp

        elif card.card_type == "reversible":
            model = col.models.by_name("AnkiPapers Reversible")
            if not model:
                return None
            note = col.new_note(model)
            note.fields[0] = _md_to_html(card.front)
            note.fields[1] = _md_to_html(card.back)
            note.fields[2] = context
            note.fields[3] = source_ref
            if len(note.fields) > 4:
                note.fields[4] = supp

        elif card.card_type == "cloze":
            model = col.models.by_name("AnkiPapers Cloze")
            if not model:
                return None
            note = col.new_note(model)
            note.fields[0] = _md_to_html(card.cloze_text)
            note.fields[1] = context
            note.fields[2] = source_ref
            if len(note.fields) > 3:
                note.fields[3] = supp

        else:
            return None

        note.tags = tags

        # Set the deck
        note.model()["did"] = deck_id

        col.add_note(note, deck_id)
        return note.id

    except Exception as e:
        print(f"[Anki Papers] Error creating note: {e}")
        return None


# ═══ Review stats for weak-spot markers ══════════════════════════════════
# Read-only: how each line's cards are doing in Anki, so the editor can mark
# lines you keep missing. A note is "weak" once any of its cards has lapsed
# WEAK_LAPSES times, and a "leech" when Anki has tagged it leech and
# suspended it.

WEAK_LAPSES = 3


def classify_note(lapses: int, tags: str, suspended: bool) -> Optional[str]:
    """'leech', 'weak' or None for a note, from its worst card's lapses, its
    tags (Anki's space-separated tag string) and whether a card is suspended."""
    tagset = {t.lower() for t in (tags or "").split()}
    if "leech" in tagset and suspended:
        return "leech"
    if lapses >= WEAK_LAPSES:
        return "weak"
    return None


def note_review_stats(col, note_ids: List[int]) -> Dict[str, Dict[str, Any]]:
    """Per note: worst lapses, Again presses / reviews, ease, last review,
    next due, suspended and status ('weak' / 'leech' / None). Keyed by the
    note id as a string (JSON object keys)."""
    nids = sorted({int(n) for n in note_ids if n})
    if not nids:
        return {}
    nid_list = ",".join(str(n) for n in nids)
    today = col.sched.today
    cards = col.db.all(
        f"select id, nid, lapses, factor, queue, type, due from cards where nid in ({nid_list})"
    )
    by_note: Dict[int, List[tuple]] = {}
    for row in cards:
        by_note.setdefault(row[1], []).append(row)
    cids = [r[0] for r in cards]
    reviews: Dict[int, Tuple[int, int, int, int]] = {}  # cid -> (reviews, again, last_id, last_ease)
    if cids:
        cid_list = ",".join(str(c) for c in cids)
        for cid, n, again, last_id in col.db.all(
            f"select cid, count(), sum(case when ease = 1 then 1 else 0 end), max(id) "
            f"from revlog where cid in ({cid_list}) and ease > 0 group by cid"
        ):
            reviews[cid] = (n or 0, again or 0, last_id or 0, 0)
        last_ids = [v[2] for v in reviews.values() if v[2]]
        if last_ids:
            for cid, ease in col.db.all(
                f"select cid, ease from revlog where id in ({','.join(str(i) for i in last_ids)})"
            ):
                n, again, last_id, _ = reviews[cid]
                reviews[cid] = (n, again, last_id, ease)
    tags_by_note = dict(col.db.all(f"select id, tags from notes where id in ({nid_list})"))

    out: Dict[str, Dict[str, Any]] = {}
    for nid in nids:
        rows = by_note.get(nid)
        if not rows:
            continue
        lapses = max(r[2] for r in rows)
        suspended = any(r[4] == -1 for r in rows)
        n_reviews = sum(reviews.get(r[0], (0, 0, 0, 0))[0] for r in rows)
        n_again = sum(reviews.get(r[0], (0, 0, 0, 0))[1] for r in rows)
        factors = [r[3] for r in rows if r[3]]
        last = max((reviews[r[0]] for r in rows if r[0] in reviews), key=lambda v: v[2], default=None)
        # Next due across cards still in rotation: review cards count days
        # from today, learning cards are due within the day, new cards wait.
        next_due: Optional[int] = None
        is_new = False
        for _cid, _nid, _lapses, _factor, queue, _ctype, due in rows:
            if queue == 2 or queue == 3:
                days = int(due) - today
            elif queue == 1:
                days = 0
            elif queue == 0:
                is_new = True
                continue
            else:
                continue
            next_due = days if next_due is None else min(next_due, days)
        out[str(nid)] = {
            "status": classify_note(lapses, tags_by_note.get(nid, ""), suspended),
            "lapses": lapses,
            "reviews": n_reviews,
            "again": n_again,
            "ease": round(min(factors) / 10) if factors else None,  # percent; None under FSRS-only
            "last_review": (last[2] // 1000) if last else None,      # epoch seconds
            "last_ease": last[3] if last else None,                  # 1 Again … 4 Easy
            "next_due_days": next_due,
            "is_new": is_new and next_due is None,
            "suspended": suspended,
        }
    return out


def unsuspend_note(col, note_id: int) -> int:
    """Unsuspend every card of a note; returns how many cards were suspended."""
    cids = col.db.list(f"select id from cards where nid = {int(note_id)} and queue = -1")
    if cids:
        col.sched.unsuspend_cards(cids)
    return len(cids)


def remove_paper_cards(paper: Paper, col) -> int:
    """Remove all Anki cards associated with a paper."""
    removed = 0
    note_ids = []
    for ref in paper.card_refs:
        if ref.anki_note_id:
            note_ids.append(ref.anki_note_id)

    if note_ids:
        try:
            col.remove_notes(note_ids)
            removed = len(note_ids)
        except Exception as e:
            print(f"[Anki Papers] Error removing notes: {e}")

    paper.clear_card_refs()
    return removed