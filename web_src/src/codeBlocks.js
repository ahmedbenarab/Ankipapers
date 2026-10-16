/**
 * Fenced code blocks: ```language … ```.
 *
 * The same rules as core/code_blocks.py -- keep the two in step.
 *
 * A paper's leading spaces mean outline level, so inside a block the code's
 * own indentation is written with ➵: each ➵ at the start of a code line is one
 * indent step of that language (4 for Python and Rust, 2 for HTML, CSS and
 * JavaScript). The editor never shows the ➵; it draws the indentation.
 *
 * A fence opens a block only when a later line that is exactly ``` closes it.
 * An unclosed fence is an ordinary line, so one forgotten fence can never turn
 * the rest of the paper into code.
 */

export const ARROW = '\u27b5' // ➵

const ANCHOR_TAIL = /(?:\s*<!--ap:[^>]*-->)+\s*$/
const FENCE_OPEN = /^```[ \t]*([A-Za-z0-9_+#.-]*)[ \t]*$/
const FENCE_CLOSE = /^```[ \t]*$/
export const ARROWS_RE = new RegExp(`^(?:${ARROW}[ \\t]*)+`)

const LANGS = {
  python: ['python', 'Python', 4], py: ['python', 'Python', 4],
  rust: ['rust', 'Rust', 4], rs: ['rust', 'Rust', 4],
  html: ['html', 'HTML', 2], htm: ['html', 'HTML', 2], xml: ['html', 'XML', 2],
  css: ['css', 'CSS', 2],
  javascript: ['javascript', 'JavaScript', 2], js: ['javascript', 'JavaScript', 2], jsx: ['javascript', 'JavaScript', 2],
  typescript: ['javascript', 'TypeScript', 2], ts: ['javascript', 'TypeScript', 2],
}

const bare = (line) => String(line ?? '').replace(ANCHOR_TAIL, '').trim()
export const outlineIndent = (line) => (String(line ?? '').match(/^[ \t]*/) || [''])[0]

export function languageInfo(name) {
  const n = (name || '').trim()
  const known = LANGS[n.toLowerCase()]
  if (known) return { lang: known[0], label: known[1], step: known[2] }
  return { lang: '', label: n, step: 4 }
}

/** True for a line that could open a block (``` with an optional language). */
export const isFenceOpenLine = (line) => FENCE_OPEN.test(bare(line))
export const isFenceCloseLine = (line) => FENCE_CLOSE.test(bare(line))

/** [{ open, close, lang, label, step }] for every closed block. */
export function findCodeBlocks(lines) {
  const blocks = []
  const n = lines.length
  let i = 0
  while (i < n) {
    const m = bare(lines[i]).match(FENCE_OPEN)
    if (m) {
      let close = -1
      for (let j = i + 1; j < n; j++) {
        if (FENCE_CLOSE.test(bare(lines[j]))) { close = j; break }
      }
      if (close !== -1) {
        blocks.push({ open: i, close, ...languageInfo(m[1]) })
        i = close + 1
        continue
      }
    }
    i++
  }
  return blocks
}

/** Map of line index -> its block, for every line of every block. */
export function codeLineMap(lines) {
  const map = new Map()
  for (const b of findCodeBlocks(lines)) {
    for (let i = b.open; i <= b.close; i++) map.set(i, b)
  }
  return map
}

/**
 * One code line, taken apart: `prefix` is everything the textarea hides (the
 * outline's spaces and the ➵ run), `depth` the number of ➵, `text` the code.
 * Spaces beyond the fence's own indent stay part of the code, so code pasted
 * with real spaces still reads right.
 */
export function splitCodeLine(line, fenceIndent) {
  const raw = String(line ?? '').replace(ANCHOR_TAIL, '')
  let head = ''
  let text = raw
  if (raw.startsWith(fenceIndent)) { head = fenceIndent; text = raw.slice(fenceIndent.length) }
  else { head = outlineIndent(raw); text = raw.slice(head.length) }
  const m = text.match(ARROWS_RE)
  if (!m) return { prefix: head, depth: 0, text }
  return { prefix: head + m[0], depth: (m[0].match(new RegExp(ARROW, 'g')) || []).length, text: text.slice(m[0].length) }
}

/** The prefix for `depth` arrows on a line at `fenceIndent`. */
export const codePrefix = (fenceIndent, depth) => fenceIndent + (depth > 0 ? ARROW.repeat(depth) + ' ' : '')

/** The block's code with ➵ turned into real spaces (Copy, export). */
export function blockCodeText(lines, block) {
  const fi = outlineIndent(lines[block.open])
  const out = []
  for (let i = block.open + 1; i < block.close; i++) {
    const { depth, text } = splitCodeLine(lines[i], fi)
    out.push(' '.repeat(depth * block.step) + text)
  }
  return out.join('\n')
}

/** Markdown export: ➵ becomes spaces so the code runs elsewhere. */
export function expandArrowsInMarkdown(content) {
  const lines = String(content ?? '').split('\n')
  for (const b of findCodeBlocks(lines)) {
    const fi = outlineIndent(lines[b.open])
    for (let i = b.open + 1; i < b.close; i++) {
      const { depth, text } = splitCodeLine(lines[i], fi)
      lines[i] = fi + ' '.repeat(depth * b.step) + text
    }
  }
  return lines.join('\n')
}

/**
 * Pasted / imported Markdown: leading spaces inside a block become ➵. The
 * step is measured from the block's own code (its smallest non-zero indent),
 * falling back to the language's convention.
 */
export function arrowsFromSpaces(content) {
  const lines = String(content ?? '').split('\n')
  for (const b of findCodeBlocks(lines)) {
    const fi = outlineIndent(lines[b.open])
    const body = []
    for (let i = b.open + 1; i < b.close; i++) {
      const l = lines[i]
      const t = l.startsWith(fi) ? l.slice(fi.length) : l.replace(/^[ \t]+/, '')
      body.push(t.replace(/\t/g, ' '.repeat(b.step)))
    }
    if (body.some((t) => ARROWS_RE.test(t))) continue // already converted
    const widths = body.filter((t) => t.trim()).map((t) => t.length - t.replace(/^ +/, '').length).filter((w) => w > 0)
    const step = widths.length ? Math.min(...widths) : b.step
    body.forEach((t, k) => {
      const spaces = t.length - t.replace(/^ +/, '').length
      const depth = Math.floor(spaces / step)
      const rest = ' '.repeat(spaces % step) + t.replace(/^ +/, '')
      lines[b.open + 1 + k] = codePrefix(fi, depth) + rest
    })
  }
  return lines.join('\n')
}

// ─── Highlighting ──────────────────────────────────────────────────────────
// Deliberately small, and the same as highlight_tokens() in
// core/code_blocks.py: comments, strings, numbers, keywords, function and
// macro names, types, and tags / attributes / properties for HTML and CSS.

const words = (s) => new Set(s.split(/\s+/).filter(Boolean))
const KEYWORDS = {
  python: words(`False None True and as assert async await break class continue def del elif else except
    finally for from global if import in is lambda match case nonlocal not or pass raise return try while with
    yield self`),
  rust: words(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop
    match mod move mut pub ref return self Self static struct super trait true type unsafe use where while
    Some None Ok Err`),
  javascript: words(`async await break case catch class const continue debugger default delete do else export
    extends false finally for function if import in instanceof let new null of return static super switch this
    throw true try typeof undefined var void while with yield`),
}

const TOKEN_RES = {
  python: /(#[^\n]*)|([rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[A-Za-z_][\w.]*)|(\b(?:0[xob][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?j?)\b)|([A-Za-z_]\w*)/g,
  rust: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(b?"(?:\\.|[^"\\])*"?|b?'(?:\\.|[^'\\])')|('[A-Za-z_]\w*)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?(?:[iu](?:8|16|32|64|128|size)|f32|f64)?\b)|([A-Za-z_]\w*!?)/g,
  javascript: /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|()(\b(?:0[xob][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b)|([A-Za-z_$][\w$]*)/g,
}
// Group order in every TOKEN_RES: 1 comment, 2 string, 3 decorator/lifetime
// (empty for JavaScript), 4 number, 5 word.

function tokensGeneric(code, lang) {
  const rx = new RegExp(TOKEN_RES[lang].source, 'g')
  const kws = KEYWORDS[lang]
  const out = []
  let pos = 0
  let m
  while ((m = rx.exec(code))) {
    if (m[0] === '') { rx.lastIndex++; continue }
    if (m.index > pos) out.push([null, code.slice(pos, m.index)])
    const text = m[0]
    let cls = null
    if (m[1]) cls = 'com'
    else if (m[2]) cls = 'str'
    else if (m[3]) cls = lang === 'rust' ? 'kw' : 'fn'
    else if (m[4]) cls = 'num'
    else if (m[5]) {
      const after = code.charAt(rx.lastIndex)
      const prev = code.slice(0, m.index).match(/(\w+)\s*$/)
      const p = prev && prev[1]
      if (text.endsWith('!')) cls = 'fn'
      else if (kws.has(text)) cls = 'kw'
      else if (p === 'def' || p === 'fn' || p === 'function') cls = 'fn'
      else if (p === 'class' || p === 'struct' || p === 'enum' || p === 'trait') cls = 'type'
      else if (after === '(') cls = 'fn'
      else if (lang === 'rust' && /^[A-Z]/.test(text)) cls = 'type'
    }
    out.push([cls, text])
    pos = rx.lastIndex
  }
  if (pos < code.length) out.push([null, code.slice(pos)])
  return out
}

const CSS_RE = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[\w-]+)|(\{)|(\})|(#[\da-fA-F]{3,8}\b|-?\d*\.?\d+(?:%|[a-zA-Z]+)?)|(-?[A-Za-z_][\w-]*)/g

function tokensCss(code) {
  const rx = new RegExp(CSS_RE.source, 'g')
  const out = []
  let pos = 0
  let depth = 0
  let m
  while ((m = rx.exec(code))) {
    if (m[0] === '') { rx.lastIndex++; continue }
    if (m.index > pos) out.push([null, code.slice(pos, m.index)])
    let cls = null
    if (m[1]) cls = 'com'
    else if (m[2]) cls = 'str'
    else if (m[3]) cls = 'kw'
    else if (m[4]) depth++
    else if (m[5]) depth = Math.max(0, depth - 1)
    else if (m[6]) cls = 'num'
    else if (m[7]) cls = depth === 0 ? 'tag' : (/^\s*:/.test(code.slice(rx.lastIndex)) ? 'prop' : null)
    out.push([cls, m[0]])
    pos = rx.lastIndex
  }
  if (pos < code.length) out.push([null, code.slice(pos)])
  return out
}

const HTML_RE = /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][\w:-]*|\/?>)|("[^"]*"?|'[^']*'?)|([A-Za-z_:][\w:.-]*)|(&[#\w]+;)/g

function tokensHtml(code) {
  const rx = new RegExp(HTML_RE.source, 'g')
  const out = []
  let pos = 0
  let inTag = false
  let m
  while ((m = rx.exec(code))) {
    if (m[0] === '') { rx.lastIndex++; continue }
    // Strings and attribute names only mean something inside a tag.
    if ((m[3] || m[4]) && !inTag) continue
    if (m.index > pos) out.push([null, code.slice(pos, m.index)])
    let cls
    if (m[1]) cls = 'com'
    else if (m[2]) { cls = 'tag'; inTag = !m[2].endsWith('>') }
    else if (m[3]) cls = 'str'
    else if (m[4]) cls = 'attr'
    else cls = 'num'
    out.push([cls, m[0]])
    pos = rx.lastIndex
  }
  if (pos < code.length) out.push([null, code.slice(pos)])
  return out
}

export function highlightTokens(code, lang) {
  if (TOKEN_RES[lang]) return tokensGeneric(code, lang)
  if (lang === 'css') return tokensCss(code)
  if (lang === 'html') return tokensHtml(code)
  return [[null, code]]
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One HTML string per line of `code`, each line's spans closed on that line. */
export function highlightLines(code, lang) {
  const lines = ['']
  for (const [cls, text] of highlightTokens(code, lang)) {
    text.split('\n').forEach((piece, k) => {
      if (k) lines.push('')
      if (piece) lines[lines.length - 1] += cls ? `<span class="tok-${cls}">${esc(piece)}</span>` : esc(piece)
    })
  }
  return lines
}
