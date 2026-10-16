/**
 * Turns a paper into standalone HTML for "Export to PDF".
 *
 * The point of this module is that it is NOT a second implementation of the
 * document format. It classifies lines with the same getBlockType() the editor
 * uses and formats their text with the same formatInlineRaw(), so the PDF and
 * the document view cannot disagree about what a line means. gui/bridge.py used
 * to render the PDF with its own parallel markdown converter, which had drifted
 * badly: it discarded indentation, printed "x::hint" instead of "x [hint]",
 * printed ap:// links as raw markdown, printed [[NH]] and && literally, and —
 * because it never escaped HTML — silently deleted the remainder of any line
 * containing a "<" followed by a letter.
 *
 * Deliberate differences from the editor, all of them "print, not edit":
 *   - always light, whatever theme the app is in;
 *   - cards print as a plain question/answer pair, with no BASIC/CLOZE/
 *     REVERSIBLE badge, no ▼/⇅ separator and no "open in Anki" button;
 *   - [[tags]] and hidden <!--ap:uuid--> anchors are removed, being editing
 *     metadata rather than content.
 */
import {
  formatInlineRaw, getBlockType, parseTableRow, isTableSeparatorRow, resolveMediaSrc,
  tableSizeOf, stripTableSize, TABLE_SIZE_DEFAULT, BASIC_CARD_RE,
} from './blockFormat'
import { stripApBlockId } from './docLinks'
import { findCodeBlocks, blockCodeText, highlightLines } from './codeBlocks'

/** Width of one indent level in the printed document, in px. */
const INDENT_PX = 22

/** Remove [[tag]] markers, collapsing the space they leave behind. */
export function stripInlineTags(text) {
  return String(text ?? '')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

/** The editor's own indent rule: four spaces (or a tab) per level. */
function indentLevelOf(line) {
  const lead = (String(line ?? '').match(/^[ \t]*/) || [''])[0]
  return Math.floor(lead.replace(/\t/g, '    ').length / 4)
}

/** Everything the printed page should not show, removed before formatting. */
function printableBody(line) {
  return stripInlineTags(stripApBlockId(String(line ?? '')).trim())
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * One line → one row of HTML. Returns '' for a line that prints nothing.
 * `fmt` is formatInlineRaw bound to the media directory; `mediaDir` is passed
 * separately because the block-image branch needs to resolve paths itself.
 */
function renderLine(line, fmt, mediaDir) {
  const body = printableBody(line)
  const type = getBlockType(body)
  const indent = indentLevelOf(line)
  const pad = indent ? ` style="margin-left:${indent * INDENT_PX}px"` : ''
  const row = (inner, cls = '') => `<div class="row${cls ? ' ' + cls : ''}"${pad}>${inner}</div>`

  if (!body) return '<div class="row spacer"></div>'

  if (type === 'divider') return row('<hr class="divider"/>')

  if (type === 'heading') {
    const m = body.match(/^(#{1,6})\s+(.+)$/)
    const level = m[1].length
    return row(`<h${level} class="h h${level}">${fmt(m[2])}</h${level}>`)
  }

  if (type === 'blockquote') return row(`<blockquote>${fmt(body.slice(2))}</blockquote>`)

  if (type === 'image') {
    const m = body.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (m) {
      let alt = m[1], width = null
      const wm = alt.match(/^(.+?)\|(\d+)$/)
      if (wm) { alt = wm[1]; width = parseInt(wm[2], 10) }
      // Via the shared resolver, not by hand: a bare filename means a file in
      // Anki's collection.media folder, and getting that wrong here is what
      // made images on their own line print as broken-image icons.
      const src = resolveMediaSrc(m[2], mediaDir)
      const style = ` style="max-width:${width ? width + 'px' : '400px'}"`
      return row(
        `<figure class="figure"><img src="${esc(src)}" alt="${esc(alt)}"${style}/>` +
        (alt ? `<figcaption>${esc(alt)}</figcaption>` : '') + `</figure>`
      )
    }
  }

  if (type === 'link-preview') return row(`<p class="para link-preview">${esc(body)}</p>`)

  // Cards print as a clean question/answer pair — no type badge, no separator.
  if (type === 'basic' || type === 'reversible') {
    const sep = type === 'reversible' ? '<>' : '>>'
    const content = body.replace(/^\s*[-*]\s+/, '')
    const m = content.match(
      type === 'reversible' ? /^(.+?)\s*<>\s*(.+)$/ : BASIC_CARD_RE
    )
    if (m) {
      return row(
        `<div class="card card-${type}">` +
        `<div class="card-q">${fmt(m[1])}</div>` +
        `<div class="card-a">${fmt(m[2])}</div>` +
        `</div>`
      )
    }
  }

  if (type === 'cloze') return row(`<div class="cloze">${fmt(body)}</div>`)

  if (type === 'bullet') {
    const m = body.match(/^\s*[-*]\s+(.+)$/)
    if (m) return row(`<div class="li"><span class="marker">•</span><span>${fmt(m[1])}</span></div>`)
  }

  if (type === 'numbered') {
    const m = body.match(/^\s*(\d+)\.\s+(.+)$/)
    if (m) return row(`<div class="li"><span class="marker num">${esc(m[1])}.</span><span>${fmt(m[2])}</span></div>`)
  }

  if (body.startsWith('&& ')) {
    return row(`<p class="para supplement"><em>${fmt(body.slice(3))}</em></p>`, 'supplement-row')
  }

  return row(`<p class="para">${fmt(body)}</p>`)
}

/** A run of consecutive table lines → one <table>. */
function renderTable(lines, fmt, indent) {
  const pad = indent ? ` style="margin-left:${indent * INDENT_PX}px"` : ''
  const rows = []
  const size = tableSizeOf(stripApBlockId(lines[0] ?? '')) || TABLE_SIZE_DEFAULT
  let isHeader = lines.length > 1 && isTableSeparatorRow(lines[1])
  lines.forEach((ln, i) => {
    if (isTableSeparatorRow(ln)) return
    const cells = parseTableRow(printableBody(ln)) || []
    const tag = (isHeader && i === 0) ? 'th' : 'td'
    rows.push('<tr>' + cells.map((c) => `<${tag}>${fmt(c)}</${tag}>`).join('') + '</tr>')
  })
  return `<div class="row"${pad}><table class="table is-${size}">${rows.join('')}</table></div>`
}

/** The document body: every line, in order. Exported for testing. */
export function renderBody(content, mediaDir = '') {
  const fmt = (t) => formatInlineRaw(t, mediaDir)
  const lines = String(content ?? '').split('\n')
  const out = []
  // A ``` block prints as one code box, its ➵ turned back into indentation.
  const codeAt = new Map(findCodeBlocks(lines).map((b) => [b.open, b]))
  for (let i = 0; i < lines.length; i++) {
    const code = codeAt.get(i)
    if (code) {
      const html = highlightLines(blockCodeText(lines, code), code.lang).join('\n')
      out.push(`<div class="row codeblock" style="margin-left:${indentLevelOf(lines[i]) * INDENT_PX}px"><pre><code>${html}</code></pre></div>`)
      i = code.close
      continue
    }
    const body = printableBody(lines[i])
    const type = getBlockType(body)
    if (type === 'table-row' || type === 'table-separator') {
      const start = i
      while (i + 1 < lines.length) {
        const nextType = getBlockType(printableBody(lines[i + 1]))
        if (nextType !== 'table-row' && nextType !== 'table-separator') break
        i++
      }
      out.push(renderTable(lines.slice(start, i + 1), fmt, indentLevelOf(lines[start])))
      continue
    }
    out.push(renderLine(lines[i], fmt, mediaDir))
  }
  return out.join('\n')
}

/* The editor's light palette, copied from styles/global.css. Hard-coded rather
   than referenced because the printed page has no app stylesheet and always
   prints light, whatever theme the window is in. */
const PRINT_CSS = `
sub, sup { line-height: 0; }
:root{
  --bg:#ffffff; --border:#cfdcec;
  --text-primary:#0f2a55; --text-secondary:#34507a; --text-muted:#6a80a3;
  --accent:#19468d; --accent-light:#23599f; --h3:#2f6fb3;
  --green:#00a884; --blue:#a8620a; --pink:#c2185b; --pink-hint:#b01e63;
  --code:#c2410c; --ap-link:#7a3fb8;
}
@page{ size:Letter; margin:0.5in; }
*{ box-sizing:border-box; margin:0; padding:0; }
body{
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
  background:var(--bg); color:var(--text-primary);
  font-size:12.5px; line-height:1.65;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.page{ max-width:820px; margin:0 auto; }
/* The first block must not add its own space on top of the page margin,
   or the content starts lower than the 0.5in the page is set to. */
.page > *:first-child{ margin-top:0; }
.page > .row:first-child .h{ margin-top:0; }
.doc-title{
  font-size:22px; font-weight:700; color:var(--accent);
  padding-bottom:8px; border-bottom:2px solid var(--border); margin-bottom:16px;
}
.row{ margin:1px 0; }
.row.spacer{ height:7px; }
.h{ margin:10px 0 4px; break-after:avoid; page-break-after:avoid; }
.h1{ font-size:20px; font-weight:700; color:var(--accent);
     padding-bottom:5px; border-bottom:2px solid var(--border); }
.h2{ font-size:17px; font-weight:600; color:var(--accent-light);
     padding-bottom:3px; border-bottom:1px solid var(--border); }
.h3{ font-size:15px; font-weight:600; color:var(--h3); }
.h4,.h5,.h6{ font-size:13.5px; font-weight:600; color:var(--text-secondary); }
.para{ color:var(--text-secondary); margin:2px 0; }
.para strong{ color:var(--text-primary); font-weight:700; }
.para em{ color:var(--text-primary); font-style:italic; }
.para del{ color:var(--text-muted); }
.supplement em{ color:var(--text-muted); font-style:italic; }
.supplement-row{ break-inside:avoid; page-break-inside:avoid; }
blockquote{
  border-left:3px solid var(--accent); padding:5px 12px;
  background:rgba(75,156,211,0.08); color:var(--text-muted);
  font-style:italic; border-radius:0 5px 5px 0; margin:4px 0;
  break-inside:avoid; page-break-inside:avoid;
}
.card{ break-inside:avoid; page-break-inside:avoid; margin:3px 0; }
.card-q{ font-weight:600; color:var(--text-primary); }
.card-a{ color:var(--text-secondary); padding-left:14px;
         border-left:2px solid var(--green); margin-top:1px; }
.card-reversible .card-a{ border-left-color:var(--blue); }
.cloze{ color:var(--text-primary); break-inside:avoid; page-break-inside:avoid; }
.cloze-badge{ display:none; }
.cloze-text{ color:var(--pink); font-weight:600; }
.cloze-hint{ color:var(--pink-hint); font-weight:600; }
.li{ display:flex; gap:7px; color:var(--text-secondary); padding:1px 0; }
.marker{ color:var(--accent); font-weight:700; flex-shrink:0; }
.marker.num{ min-width:18px; }
.divider{ border:none; height:1px; background:var(--border); margin:10px 0; }
.figure{ margin:8px 0; break-inside:avoid; page-break-inside:avoid; }
.figure img{ max-width:100%; border-radius:5px; display:block; }
figcaption{ font-size:11px; color:var(--text-muted); margin-top:3px; }
.table{ border-collapse:collapse; margin:5px auto; break-inside:avoid; page-break-inside:avoid;
        width:max-content; max-width:80%; table-layout:auto; }
.table.is-s{ max-width:40%; } .table.is-m{ max-width:60%; }
.table.is-l{ max-width:80%; } .table.is-full{ max-width:100%; }
.table th,.table td{ border:1px solid var(--border); padding:4px 9px;
                     text-align:left; color:var(--text-secondary); }
.table th{ font-weight:600; color:var(--text-primary); background:#f5f5f8; }
code{ background:#f2f2f6; color:var(--code); padding:1px 5px; border-radius:4px;
      font-family:'JetBrains Mono',ui-monospace,Consolas,monospace; font-size:11.5px; }
.codeblock{ margin:5px 0; break-inside:avoid; page-break-inside:avoid; }
.codeblock pre{ background:#f6f8fa; border:1px solid var(--border); border-radius:6px;
                padding:7px 10px; white-space:pre-wrap; color:#1f2328;
                font-family:'JetBrains Mono',ui-monospace,Consolas,monospace; font-size:11px; line-height:1.5; }
.codeblock code{ background:none; color:inherit; padding:0; font-size:inherit; }
.tok-kw{color:#8250df} .tok-str{color:#0a7d32} .tok-com{color:#6e7781;font-style:italic}
.tok-num{color:#b35900} .tok-fn{color:#0550ae} .tok-type{color:#953800}
.tok-tag{color:#116329} .tok-attr{color:#953800} .tok-prop{color:#0550ae}
.ap-link{ color:var(--ap-link); text-decoration:underline;
          text-decoration-thickness:1.5px; text-underline-offset:2px; }
.math-inline,.math-block{ font-family:'JetBrains Mono',ui-monospace,monospace;
                          color:var(--accent); }
.inline-img{ max-width:280px; vertical-align:middle; border-radius:4px; }
.link-preview{ color:var(--ap-link); word-break:break-all; }
.footer{ margin-top:26px; padding-top:9px; border-top:1px solid var(--border);
         font-size:10px; color:var(--text-muted); text-align:center; }
`

/**
 * Build the complete standalone HTML document handed to Qt for printing.
 *
 * @param {{title?:string, content?:string}} paper
 * @param {{mediaDir?:string}} [options]
 * @returns {string} a full HTML document
 */
export function renderPrintHtml(paper, options = {}) {
  const title = (paper && paper.title) || 'Untitled'
  const content = paper && paper.content
  const body = renderBody(content, options.mediaDir || '')
  // Most papers open with a "# Same Title" heading. Printing the paper title
  // above it as well just prints the same word twice, which is what the old
  // exporter did. Show the title block only when it adds something.
  const heading = repeatsTitle(content, title) ? '' : `<div class="doc-title">${esc(title)}</div>\n`
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${PRINT_CSS}</style></head>
<body><div class="page">
${heading}${body}
<div class="footer">Generated by Anki Papers</div>
</div></body></html>`
}

/** True when the document already opens with a heading naming the paper. */
export function repeatsTitle(content, title) {
  const wanted = String(title ?? '').trim().toLowerCase()
  if (!wanted) return false
  for (const line of String(content ?? '').split('\n')) {
    const body = printableBody(line)
    if (!body) continue
    const m = body.match(/^#{1,6}\s+(.+)$/)
    return !!m && m[1].trim().toLowerCase() === wanted
  }
  return false
}
