/**
 * Block parsing and inline formatting — the single definition of how an
 * AnkiPapers document turns into HTML.
 *
 * This used to live inside BlockEditor.jsx, which meant the PDF exporter had
 * its own separate implementation in gui/bridge.py. The two drifted: the
 * exporter printed "dyspepsia::epigastric sx" instead of the hint form, showed
 * raw ap:// markup, discarded indentation, and — because it never escaped HTML
 * — silently deleted the rest of any line containing a "<" followed by a
 * letter ("Ferritin <normal range ..." printed as "Ferritin").
 *
 * Both the editor and the exporter now import from here, so the two views of a
 * document cannot disagree.
 */
import { AP_LINK_RE } from './docLinks'

// ─── Card separators ────────────────────────────────
// Basic card: "Question >> Answer", split at the first ">>". The
// (?<!<\/su[bp]) and (?<!<\/[bui]) guards stop a subscript, superscript,
// bold, underline or italic closing tag written flush against the separator
// ("CO<sub>2</sub>>> gas") from being read as the start of it -- without them
// the split lands inside the tag. Mirrors
// BASIC_CARD_PATTERN in core/parser.py; the two have to agree, or the editor
// and the generated card would split the same line differently.
export const BASIC_CARD_RE = /^(.+?)(?<!<\/su[bp])(?<!<\/[bui])\s*>>\s*(.+)$/

// ─── Bold / italic / underline / sub / superscript ─
// Stored as plain <b>/<i>/<u>/<sub>/<sup> HTML: Anki renders it natively, and so do other
// markdown apps (Obsidian, GitHub), so papers stay readable outside Anki Papers.

/**
 * Toggle <b>, <i>, <u>, <sub> or <sup> around a selection, Word-style:
 *   - selection already inside that tag pair (or spanning exactly one) -> unwrap
 *   - selection inside the OTHER pair -> swap it (sub <-> sup; the rest have none)
 *   - otherwise -> wrap; with nothing selected, insert a selected placeholder
 * Returns { line, selStart, selEnd }, the new selection covering the text.
 */
export function toggleTagSegment(line, selStart, selEnd, tag, emptyPlaceholder = 'text') {
  const other = tag === 'sub' ? 'sup' : tag === 'sup' ? 'sub' : null
  const open = `<${tag}>`
  const close = `</${tag}>`
  const len = line.length
  let a = Math.max(0, Math.min(selStart ?? 0, len))
  let b = Math.max(0, Math.min(selEnd ?? 0, len))
  if (b < a) [a, b] = [b, a]
  const selected = line.slice(a, b)

  // Same tag -> unwrap. Other tag -> swap for this one.
  const pairs = [[open, close, false]]
  if (other) pairs.push([`<${other}>`, `</${other}>`, true])
  for (const [o, c, swap] of pairs) {
    // Cursor or selection sits just inside a pair: <tag>|text|</tag>
    if (a >= o.length && line.slice(a - o.length, a) === o && line.slice(b, b + c.length) === c) {
      const before = line.slice(0, a - o.length)
      const after = line.slice(b + c.length)
      if (!swap) return { line: before + selected + after, selStart: before.length, selEnd: before.length + selected.length }
      return { line: before + open + selected + close + after, selStart: before.length + open.length, selEnd: before.length + open.length + selected.length }
    }
    // Selection includes exactly one pair: |<tag>text</tag>|
    if (selected.length >= o.length + c.length && selected.startsWith(o) && selected.endsWith(c)) {
      const inner = selected.slice(o.length, selected.length - c.length)
      if (!inner.includes(o) && !inner.includes(c)) {
        const before = line.slice(0, a)
        const after = line.slice(b)
        if (!swap) return { line: before + inner + after, selStart: a, selEnd: a + inner.length }
        return { line: before + open + inner + close + after, selStart: a + open.length, selEnd: a + open.length + inner.length }
      }
    }
  }

  const inner = selected.length ? selected : emptyPlaceholder
  return {
    line: line.slice(0, a) + open + inner + close + line.slice(b),
    selStart: a + open.length,
    selEnd: a + open.length + inner.length,
  }
}

// ─── macOS Text Replacements ────────────────────────
// macOS applies Text Replacements only inside apps built on Apple's own text
// views; Anki's web engine never asks for the list, so the editor does it.
// The list arrives from the Python side (gui/text_replacements.py).

/** Turn the bridge's [{shortcut, phrase}] list into a lookup Map. */
export function buildReplacementMap(items) {
  const m = new Map()
  for (const it of items || []) {
    if (it && it.shortcut && typeof it.phrase === 'string') m.set(it.shortcut, it.phrase)
  }
  return m
}

/**
 * The replacement to apply when Space or Return is pressed at `caret`, or
 * null. The candidate is the run of non-space characters just before the
 * caret, back to the previous space or the start of the line. The whole run
 * is tried first, then shorter endings of it, longest first -- but a shorter
 * ending only counts when the character in front of it is not a letter,
 * digit or underscore. So ",sig" fires, and so do "`,sig", "(,sig" and
 * "|,sig", while "word,sig" does not; a shortcut that is the start of a
 * longer one never fires early.
 *
 * It fires everywhere a line can hold text -- inline code, ``` blocks, $math$
 * and tables included -- as macOS does in every text field. Skipping code and
 * math used to make a shortcut typed after a stray backtick silently do
 * nothing.
 * Returns { start, end, shortcut, phrase }, positions within `text`.
 */
export function findTextReplacement(text, caret, replacements) {
  if (!replacements || !replacements.size || !(caret > 0)) return null
  const m = String(text).slice(0, caret).match(/\S+$/)
  if (!m) return null
  const word = m[0]
  for (let i = 0; i < word.length; i++) {
    if (i > 0 && /[\p{L}\p{N}_]/u.test(word[i - 1])) continue
    const shortcut = word.slice(i)
    const phrase = replacements.get(shortcut)
    if (phrase != null) return { start: caret - shortcut.length, end: caret, shortcut, phrase }
  }
  return null
}

// ─── Block type detection ───────────────────────────
export function getBlockType(line) {
  // The size marker lives past the header row's final pipe, so it has to come
  // off before the table test — otherwise a sized table stops being a table.
  const t = stripTableSize(String(line ?? '')).trim()
  if (!t) return 'empty'
  if (/^\|(?:[^|]*\|)+\s*$/.test(t) && /\|/.test(t.slice(1, -1))) {
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t)) return 'table-separator'
    return 'table-row'
  }
  if (t.match(/^#{1,6}\s/)) return 'heading'
  if (t.match(/^```/)) return 'code-fence'
  if (t.match(/^---$|^\*\*\*$|^___$/)) return 'divider'
  if (t.match(/^>\s/)) return 'blockquote'
  const stripped = t.replace(/^\s*[-*]\s+/, '')
  if (stripped.match(/^.+?\s*<>\s*.+$/)) return 'reversible'
  if (BASIC_CARD_RE.test(stripped)) return 'basic'
  if (t.match(/\{\{.+?\}\}/)) return 'cloze'
  if (t.match(/^https?:\/\/[^\s]+$/)) return 'link-preview'
  if (t.match(/^!\[/)) return 'image'
  if (t.match(/^\s*[-*]\s+/)) return 'bullet'
  if (t.match(/^\s*\d+\.\s+/)) return 'numbered'
  return 'text'
}

// ── Table size marker ──────────────────────────────────────────────────────
//
// A table's width setting rides on the end of its header row as
// "<!--ap-table:m-->". It sits there rather than on a line of its own so that
// it travels with the table when the table is moved, copied or re-indented.
//
// It goes BEFORE any <!--ap:uuid--> anchor, because the anchor is defined as
// the last thing on a line and the editor's AP_BLOCK_ID_TAIL regex is
// anchored to the end. Everything that reads a row therefore strips the
// anchor first and the size marker second.

export const TABLE_SIZES = ['s', 'm', 'l', 'full']
export const TABLE_SIZE_DEFAULT = 'l'
const TABLE_SIZE_TAIL = /<!--ap-table:(s|m|l|full)-->[ \t]*$/i

/** The size recorded on a line, or null. Expects the ap anchor already gone. */
export function tableSizeOf(line) {
  const m = String(line ?? '').match(TABLE_SIZE_TAIL)
  return m ? m[1].toLowerCase() : null
}

/** The line without its size marker. */
export function stripTableSize(line) {
  return String(line ?? '').replace(TABLE_SIZE_TAIL, '')
}

/**
 * Put `size` on a line, replacing any marker already there. A null size
 * removes it. The ap anchor is lifted off and put back last so it keeps its
 * end-of-line position.
 */
export function withTableSize(line, size, apSuffix = '') {
  const body = stripTableSize(String(line ?? '')).replace(/[ \t]+$/, '')
  const tag = size && TABLE_SIZES.includes(size) ? `<!--ap-table:${size}-->` : ''
  return `${body}${tag}${apSuffix}`
}

export function parseTableRow(line) {
  const t = stripTableSize(String(line ?? '')).trim()
  if (!(t.startsWith('|') && t.endsWith('|'))) return null
  return t.slice(1, -1).split('|').map((c) => c.trim())
}

export function isTableSeparatorRow(line) {
  const cells = parseTableRow(line)
  if (!cells || cells.length < 2) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

/**
 * An image's markdown source turned into a URL the webview can load.
 *
 * A bare filename in a document means "a file in Anki's collection.media
 * folder"; anything already carrying a scheme is passed through untouched.
 *
 * This lives here, exported, because the same four lines used to be written
 * out three times — in the editor's block-image branch, in formatInlineRaw
 * below, and in the PDF exporter. The exporter's copy was the one that was
 * missing, so an image on its own line printed as a broken-image icon while
 * the identical image inside a sentence printed fine. One definition now.
 */
export function resolveMediaSrc(src, mediaDir) {
  const s = String(src ?? '')
  if (s.startsWith('http') || s.startsWith('file://') || s.startsWith('data:') || s.startsWith('/')) return s
  if (!mediaDir) return s
  return mediaDir + encodeURIComponent(s)
}

export function formatInlineRaw(text, mediaDir) {
  let r = text
    .replace(/&/g, '&amp;')
  // Images inline — must run before < > escaping
  r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    let width = ''
    const wm = alt.match(/^(.+?)\|(\d+)$/)
    if (wm) {
      alt = wm[1]
      width = ` style="max-width:${wm[2]}px"`
    }
    src = resolveMediaSrc(src, mediaDir)
    return `<img src="${src}" alt="${alt}" class="inline-img"${width} />`
  })
  // Math: $$block$$ and $inline$ — before HTML escaping
  const mathBlocks = []
  r = r.replace(/\$\$(.+?)\$\$/gs, (_, tex) => {
    const idx = mathBlocks.length
    mathBlocks.push(`<span class="math-block" title="Block math">$$${tex}$$</span>`)
    return `\x00MATH${idx}\x00`
  })
  r = r.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, tex) => {
    const idx = mathBlocks.length
    mathBlocks.push(`<span class="math-inline" title="Inline math">$${tex}$</span>`)
    return `\x00MATH${idx}\x00`
  })
  // Escape HTML (after images and math extracted)
  r = r.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Restore img tags
  r = r.replace(/&lt;img /g, '<img ').replace(/\/&gt;/g, '/>')
  // Restore math placeholders
  mathBlocks.forEach((html, i) => { r = r.replace(`\x00MATH${i}\x00`, html) })
  // Cloze numbered. A cloze may carry a hint after a second "::", e.g.
  // {{c1::.title()::string method}}. Anki shows that hint as "[string method]"
  // while you review, so show it the same way here instead of printing the
  // raw "::" separator in the middle of the phrase.
  r = r.replace(/\{\{(c\d+)::(.+?)\}\}/g, (_m, num, body) => {
    const at = body.indexOf('::')
    const text = at === -1 ? body : body.slice(0, at)
    const hint = at === -1 ? '' : body.slice(at + 2)
    return `<span class="cloze-badge">${num}</span><span class="cloze-text">${text}</span>`
      + (hint ? ` <span class="cloze-hint">[${hint}]</span>` : '')
  })
  // Cloze simple
  r = r.replace(/\{\{([^}:]+?)\}\}/g, '<span class="cloze-badge">c</span><span class="cloze-text">$1</span>')
  // Bold
  r = r.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  r = r.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // Strikethrough
  r = r.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // Inline code
  r = r.replace(/`([^`]+?)`/g, '<code>$1</code>')
  // Bold / italic / underline / subscript / superscript tags. The text was
  // HTML-escaped above, so turn exactly these tag pairs back into markup.
  // (Old **bold** / *italic* asterisks are still rendered by the rules above.)
  // Code spans are skipped so that `<sub>` written inside backticks still reads
  // as literal code. Repeated until nothing changes, because one pass only
  // restores the outermost pair: <u>T<sub>4</sub></u> would otherwise show its
  // inner <sub> as literal text.
  const TAG_PAIR = /(<code>[\s\S]*?<\/code>)|&lt;(sub|sup|u|b|i)&gt;([\s\S]*?)&lt;\/\2&gt;/g
  for (let pass = 0; pass < 8; pass++) {
    const next = r.replace(TAG_PAIR, (_m, code, tag, inner) => (code ? code : `<${tag}>${inner}</${tag}>`))
    if (next === r) break
    r = next
  }
  // Zettelkasten links
  r = r.replace(/\[\[(.+?)\]\]/g, '<span class="block-zettel-link" data-title="$1">[[$1]]</span>')
  // Document links: [text](ap://paperId#blockId)
  r = r.replace(AP_LINK_RE, (_m, text, target) => {
    const safe = String(target).replace(/["'<>]/g, '')
    return `<span class="ap-link" data-ap-target="${safe}" title="Double-click to open">${text}</span>`
  })
  return r
}
