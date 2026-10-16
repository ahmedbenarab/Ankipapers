import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback, useState, useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { openInBrowser } from '../bridge'
import { getLineIndexAtCursor, getLineTextAtIndex, resolveNoteIdForLine } from '../crossLink'
import { BASIC_CARD_RE, toggleTagSegment, findTextReplacement } from '../blockFormat'

// ─── Card Counting ──────────────────────────────────
function countCards(text) {
  const lines = text.split('\n')
  let basic = 0, reversible = 0, cloze = 0
  for (const line of lines) {
    const stripped = line.trim()
    if (!stripped) continue
    const cardContent = stripped.replace(/^\s*[-*]\s+/, '')
    // Reversible card: A <> B (check before basic)
    if (/^.+?\s*<>\s*.+$/.test(cardContent)) {
      reversible++
      continue
    }
    // Basic card: Q >> A
    if (BASIC_CARD_RE.test(cardContent)) {
      basic++
      continue
    }
    // Cloze: {{...}}
    if (/\{\{.+?\}\}/.test(stripped)) {
      cloze++
    }
  }
  return { basic, reversible, cloze }
}

// ─── Format Actions Map ─────────────────────────────
const formatActions = {
  bold: (ta) => toggleTagInTextarea(ta, 'b'),
  italic: (ta) => toggleTagInTextarea(ta, 'i'),
  strikethrough: (ta) => wrapSelection(ta, '~~', '~~'),
  subscript: (ta) => toggleTagInTextarea(ta, 'sub'),
  superscript: (ta) => toggleTagInTextarea(ta, 'sup'),
  underline: (ta) => toggleTagInTextarea(ta, 'u'),
  inlineCode: (ta) => wrapSelection(ta, '`', '`'),
  h1: (ta) => prefixLine(ta, '# '),
  h2: (ta) => prefixLine(ta, '## '),
  h3: (ta) => prefixLine(ta, '### '),
  bullet: (ta) => togglePrefix(ta, '- '),
  numbered: (ta) => togglePrefix(ta, '1. '),
  blockquote: (ta) => togglePrefix(ta, '> '),
  hr: (ta) => insertAtCursor(ta, '\n\n---\n\n'),
  codeBlock: (ta) => {
    const sel = getSelection(ta)
    if (sel) { wrapSelection(ta, '```\n', '\n```') }
    else { insertAtCursor(ta, '```\n\n```'); ta.selectionStart = ta.selectionEnd = ta.selectionStart - 4 }
  },
  basicCard: (ta) => insertAtCursor(ta, 'Question >> Answer'),
  reversibleCard: (ta) => insertAtCursor(ta, 'Term <> Definition'),
  cloze: (ta) => {
    const sel = getSelection(ta)
    if (sel) { wrapSelection(ta, '{{', '}}') }
    else { insertAtCursor(ta, '{{cloze text}}') }
  },
  multiCloze: (ta) => {
    const next = getNextClozeNumberAtCursor(ta)
    const sel = getSelection(ta)
    if (sel) { wrapSelection(ta, `{{c${next}::`, '}}') }
    else { insertAtCursor(ta, `{{c${next}::cloze text}}`) }
  },
  insertTable: (ta) => insertAtCursor(ta, '\n| Column 1 | Column 2 |\n| --- | --- |\n| Value 1 | Value 2 |\n'),
  tableAddRow: (ta) => addTableRowAtCursor(ta),
  tableAddColumn: (ta) => addTableColumnAtCursor(ta),
  math: (ta) => {
    const sel = getSelection(ta)
    if (sel) { wrapSelection(ta, '$', '$') }
    else { insertAtCursor(ta, '$x^2$') }
  },
  insertImageMd: (ta, markdown) => insertAtCursor(ta, markdown),
}

function getSelection(ta) { return ta.value.substring(ta.selectionStart, ta.selectionEnd) }

// Same toggle as the block editor, applied to the whole source text.
function toggleTagInTextarea(ta, tag) {
  const r = toggleTagSegment(ta.value, ta.selectionStart, ta.selectionEnd, tag)
  ta.value = r.line
  ta.selectionStart = r.selStart; ta.selectionEnd = r.selEnd
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function wrapSelection(ta, prefix, suffix) {
  const start = ta.selectionStart, end = ta.selectionEnd
  const selected = ta.value.substring(start, end)
  const before = ta.value.substring(0, start), after = ta.value.substring(end)
  if (selected) {
    ta.value = before + prefix + selected + suffix + after
    ta.selectionStart = start + prefix.length; ta.selectionEnd = end + prefix.length
  } else {
    const placeholder = 'text'
    ta.value = before + prefix + placeholder + suffix + after
    ta.selectionStart = start + prefix.length; ta.selectionEnd = start + prefix.length + placeholder.length
  }
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function prefixLine(ta, prefix) {
  const start = ta.selectionStart, text = ta.value
  let lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEnd = text.indexOf('\n', start)
  const actualEnd = lineEnd === -1 ? text.length : lineEnd
  const line = text.substring(lineStart, actualEnd)
  let cleanLine = line
  if (prefix.startsWith('#')) cleanLine = line.replace(/^#{1,6}\s*/, '')
  ta.value = text.substring(0, lineStart) + prefix + cleanLine + text.substring(actualEnd)
  ta.selectionStart = ta.selectionEnd = lineStart + prefix.length + cleanLine.length
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function togglePrefix(ta, prefix) {
  const start = ta.selectionStart, text = ta.value
  let lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEnd = text.indexOf('\n', start)
  const actualEnd = lineEnd === -1 ? text.length : lineEnd
  const line = text.substring(lineStart, actualEnd)
  if (line.trimStart().startsWith(prefix.trim())) {
    const idx = line.indexOf(prefix.trim())
    const newLine = line.substring(0, idx) + line.substring(idx + prefix.length)
    ta.value = text.substring(0, lineStart) + newLine + text.substring(actualEnd)
  } else {
    ta.value = text.substring(0, lineStart) + prefix + line + text.substring(actualEnd)
  }
  ta.selectionStart = ta.selectionEnd = ta.value.indexOf('\n', lineStart)
  if (ta.selectionStart === -1) ta.selectionStart = ta.selectionEnd = ta.value.length
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function insertAtCursor(ta, text) {
  const start = ta.selectionStart
  const before = ta.value.substring(0, start), after = ta.value.substring(ta.selectionEnd)
  ta.value = before + text + after
  ta.selectionStart = ta.selectionEnd = start + text.length
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function getLineRangeAtCursor(ta) {
  const start = ta.selectionStart
  const text = ta.value
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEnd = text.indexOf('\n', start)
  return [lineStart, lineEnd === -1 ? text.length : lineEnd]
}

function getNextClozeNumberAtCursor(ta) {
  const [lineStart, lineEnd] = getLineRangeAtCursor(ta)
  const line = ta.value.substring(lineStart, lineEnd)
  const matches = [...line.matchAll(/\{\{c(\d+)::/g)]
  let max = 0
  for (const m of matches) max = Math.max(max, parseInt(m[1], 10) || 0)
  return max + 1
}

function parseTableRow(line) {
  const s = line.trim()
  if (!(s.startsWith('|') && s.endsWith('|'))) return null
  return s.slice(1, -1).split('|').map((c) => c.trim())
}

function isTableSeparatorRow(line) {
  const cells = parseTableRow(line)
  if (!cells || cells.length < 2) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

function findTableBounds(lines, cursorLine) {
  const isTableRow = (ln) => parseTableRow(ln) !== null
  if (!isTableRow(lines[cursorLine])) return null
  let start = cursorLine
  while (start > 0 && isTableRow(lines[start - 1])) start--
  let end = cursorLine
  while (end + 1 < lines.length && isTableRow(lines[end + 1])) end++
  if (start + 1 > end || !isTableSeparatorRow(lines[start + 1])) return null
  return { start, end }
}

function addTableRowAtCursor(ta) {
  const text = ta.value
  const lineAtCursor = text.slice(0, ta.selectionStart).split('\n').length - 1
  const lines = text.split('\n')
  const bounds = findTableBounds(lines, lineAtCursor)
  if (!bounds) return

  const headerCells = parseTableRow(lines[bounds.start]) || []
  const newRow = `| ${headerCells.map((_, i) => `Value ${i + 1}`).join(' | ')} |`
  const insertAt = Math.max(lineAtCursor + 1, bounds.start + 2)
  lines.splice(insertAt, 0, newRow)
  ta.value = lines.join('\n')
  ta.focus()
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function addTableColumnAtCursor(ta) {
  const text = ta.value
  const lineAtCursor = text.slice(0, ta.selectionStart).split('\n').length - 1
  const lines = text.split('\n')
  const bounds = findTableBounds(lines, lineAtCursor)
  if (!bounds) return

  for (let i = bounds.start; i <= bounds.end; i++) {
    const cells = parseTableRow(lines[i])
    if (!cells) continue
    if (i === bounds.start) cells.push(`Column ${cells.length + 1}`)
    else if (i === bounds.start + 1) cells.push('---')
    else cells.push(`Value ${cells.length + 1}`)
    lines[i] = `| ${cells.join(' | ')} |`
  }
  ta.value = lines.join('\n')
  ta.focus()
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function ensureTableAtCursor(ta, rows, cols) {
  const text = ta.value
  const lineAtCursor = text.slice(0, ta.selectionStart).split('\n').length - 1
  const lines = text.split('\n')
  const bounds = findTableBounds(lines, lineAtCursor)

  const targetRows = Math.max(1, rows || 2)
  const targetCols = Math.max(1, cols || 2)

  if (!bounds) {
    const header = `| ${Array.from({ length: targetCols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`
    const sep = `| ${Array.from({ length: targetCols }, () => '---').join(' | ')} |`
    const body = Array.from({ length: Math.max(0, targetRows - 1) }, (_, r) =>
      `| ${Array.from({ length: targetCols }, (_, c) => `Value ${r + 1}.${c + 1}`).join(' | ')} |`
    )
    insertAtCursor(ta, `\n${header}\n${sep}${body.length ? '\n' + body.join('\n') : ''}\n`)
    return
  }

  const current = lines.slice(bounds.start, bounds.end + 1).map((ln) => parseTableRow(ln) || [])
  const currentCols = (parseTableRow(lines[bounds.start]) || []).length
  const currentBodyRows = Math.max(0, bounds.end - (bounds.start + 1))

  const newBlock = []
  const header = Array.from({ length: targetCols }, (_, i) => (i < currentCols ? (current[0][i] || `Column ${i + 1}`) : `Column ${i + 1}`))
  newBlock.push(`| ${header.join(' | ')} |`)
  newBlock.push(`| ${Array.from({ length: targetCols }, (_, i) => (i < currentCols ? '---' : '---')).join(' | ')} |`)

  for (let r = 0; r < Math.max(0, targetRows - 1); r++) {
    const old = r < currentBodyRows ? current[r + 2] : []
    const row = Array.from({ length: targetCols }, (_, c) => (c < currentCols ? (old[c] || `Value ${r + 1}.${c + 1}`) : `Value ${r + 1}.${c + 1}`))
    newBlock.push(`| ${row.join(' | ')} |`)
  }

  lines.splice(bounds.start, bounds.end - bounds.start + 1, ...newBlock)
  ta.value = lines.join('\n')
  ta.focus()
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Source view is plain black on white, so a line is just its escaped text.
// (The layer it goes in only positions line numbers and highlights; the
// visible text is the textarea's own.)
function highlightLine(line) {
  return escapeHtml(line)
}

// One block per line, so each line can be found (to center and highlight it
// when a search result lands here) and so a soft-wrapped line keeps a single
// number beside its first row; the number is drawn in the left padding by
// CSS (.with-line-numbers .src-line::before). An empty line holds a
// zero-width space so it keeps its height, and the extra empty block stands in
// for the trailing newline so caret alignment stays accurate.
function highlightMarkdown(text) {
  const lines = (text || '').split('\n')
  return lines
    .map((l, i) => `<span class="src-line" data-line="${i + 1}">${highlightLine(l) || '\u200b'}</span>`)
    .join('') + '<span class="src-line">\u200b</span>'
}

// ─── Component ──────────────────────────────────────
const SourceEditor = forwardRef(function SourceEditor({ content, onChange, onCardCountChange, settings, cardRefs, textReplacements = null, onHistoryCheckpoint }, ref) {
  const textareaRef = useRef(null)
  const overlayRef = useRef(null)
  const countTimerRef = useRef(null)
  const [cursorTick, setCursorTick] = useState(0)

  const noteIdAtCursor = useMemo(() => {
    const ta = textareaRef.current
    if (!ta) return null
    const text = ta.value
    const idx = getLineIndexAtCursor(text, ta.selectionStart)
    const line = getLineTextAtIndex(text, idx)
    return resolveNoteIdForLine(idx, line, cardRefs)
  }, [cardRefs, content, cursorTick])

  const bumpCursor = useCallback(() => setCursorTick((n) => n + 1), [])

  const handleOpenInBrowse = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const text = ta.value
    const idx = getLineIndexAtCursor(text, ta.selectionStart)
    const line = getLineTextAtIndex(text, idx)
    const nid = resolveNoteIdForLine(idx, line, cardRefs)
    if (nid != null) openInBrowser(nid)
  }, [cardRefs])

  useImperativeHandle(ref, () => ({
    // Put the caret at the start of a line (0-based), center it, and give it
    // the same brief highlight the editor uses. Used when a search result or
    // link lands while Source view is open.
    goToLine: (lineIndex) => {
      const ta = textareaRef.current
      if (!ta || lineIndex == null || lineIndex < 0) return
      const lines = ta.value.split('\n')
      const idx = Math.min(lineIndex, lines.length - 1)
      let offset = 0
      for (let i = 0; i < idx; i++) offset += lines[i].length + 1
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(offset, offset)
      const lineEl = overlayRef.current?.querySelector(`.src-line[data-line="${idx + 1}"]`)
      if (lineEl) {
        ta.scrollTop = Math.max(0, lineEl.offsetTop + lineEl.offsetHeight / 2 - ta.clientHeight / 2)
        overlayRef.current.scrollTop = ta.scrollTop // keep the highlight layer in step
        lineEl.classList.remove('src-line-revealed')
        void lineEl.offsetWidth // restart the animation if it is already running
        lineEl.classList.add('src-line-revealed')
        setTimeout(() => lineEl.classList.remove('src-line-revealed'), 2400)
      }
      bumpCursor()
    },
    applyFormat: (action, extra) => {
      if (textareaRef.current) {
        if (action === 'insertImageMd' && extra) {
          formatActions.insertImageMd(textareaRef.current, extra)
        } else if (action === 'tableApply' && extra) {
          ensureTableAtCursor(textareaRef.current, extra.rows, extra.cols)
        } else if (formatActions[action]) {
          formatActions[action](textareaRef.current)
        }
      }
    },
    getTableContext: () => {
      const ta = textareaRef.current
      if (!ta) return null
      const text = ta.value
      const lineAtCursor = text.slice(0, ta.selectionStart).split('\n').length - 1
      const lines = text.split('\n')
      const bounds = findTableBounds(lines, lineAtCursor)
      if (!bounds) return null
      const cols = (parseTableRow(lines[bounds.start]) || []).length
      const rows = Math.max(1, bounds.end - bounds.start)
      return { rows, cols }
    },
  }))

  const handleInput = useCallback((e) => {
    const val = e.target.value
    onChange(val)
    clearTimeout(countTimerRef.current)
    countTimerRef.current = setTimeout(() => onCardCountChange(countCards(val)), 300)
  }, [onChange, onCardCountChange])

  useEffect(() => { onCardCountChange(countCards(content)) }, []) // eslint-disable-line
  useEffect(() => { bumpCursor() }, [content, cardRefs, bumpCursor])

  const handleKeyDown = useCallback((e) => {
    // macOS Text Replacements: the same rules as the block editor (see
    // findTextReplacement), applied to the line the cursor is on.
    const isSpaceKey = e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
    const isReturnKey = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
    const ta = textareaRef.current
    if ((isSpaceKey || isReturnKey) && textReplacements && ta && !e.nativeEvent?.isComposing
        && ta.selectionStart === ta.selectionEnd) {
      const caret = ta.selectionStart
      const value = ta.value
      const lineStart = value.lastIndexOf('\n', caret - 1) + 1
      const lineEnd = value.indexOf('\n', caret)
      const lineText = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd)
      const hit = findTextReplacement(lineText, caret - lineStart, textReplacements)
      if (hit) {
        e.preventDefault()
        onHistoryCheckpoint?.()   // first Ctrl+Z brings the shortcut back
        const at = lineStart + hit.start
        // On a table row a line break would split the row and break the
        // table, so a phrase written on several lines goes in as one.
        const phrase = /^\s*\|/.test(lineText) ? hit.phrase.replace(/\s*\n\s*/g, ' ') : hit.phrase
        const insert = phrase + (isSpaceKey ? ' ' : '\n')
        ta.value = value.slice(0, at) + insert + value.slice(caret)
        ta.selectionStart = ta.selectionEnd = at + insert.length
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        bumpCursor()
        return
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current, start = ta.selectionStart, end = ta.selectionEnd
      ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end)
      ta.selectionStart = ta.selectionEnd = start + 4
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      bumpCursor()
    }
  }, [bumpCursor, textReplacements, onHistoryCheckpoint])

  const fontSize = settings?.font_size || 14
  const fontFamily = settings?.font_family || "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace"
  const showLineNumbers = settings?.show_line_numbers !== false
  // A stable object, not just a stable string: React re-sets innerHTML
  // whenever this prop's object changes, which on every cursor move would
  // rebuild the whole layer and wipe a line's highlight class.
  const highlightedHtml = useMemo(() => ({ __html: highlightMarkdown(content) }), [content])

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    const ov = overlayRef.current
    if (!ta || !ov) return
    ov.scrollTop = ta.scrollTop
    ov.scrollLeft = ta.scrollLeft
  }, [])

  return (
    <div className="source-editor-wrap">
      <div className="source-editor-crosslink">
        <button
          type="button"
          className="source-crosslink-btn"
          disabled={noteIdAtCursor == null}
          title={
            noteIdAtCursor != null
              ? `Open in Anki Browse (nid:${noteIdAtCursor})`
              : 'Place cursor on a line with a generated card, then run Generate cards if needed'
          }
          onClick={handleOpenInBrowse}
        >
          <ExternalLink size={14} />
          <span>Browse note</span>
          {noteIdAtCursor != null && <span className="source-crosslink-nid">nid:{noteIdAtCursor}</span>}
        </button>
      </div>
      <div className="source-editor-stack" style={{ fontSize, fontFamily }}>
        <pre
          ref={overlayRef}
          className={`source-editor-highlight ${showLineNumbers ? 'with-line-numbers' : ''}`}
          aria-hidden="true"
          dangerouslySetInnerHTML={highlightedHtml}
        />
        <textarea
          ref={textareaRef}
          className={`source-editor source-editor-overlay ${showLineNumbers ? 'with-line-numbers' : ''}`}
          value={content}
          onInput={handleInput}
          onScroll={syncScroll}
          onSelect={bumpCursor}
          onKeyUp={bumpCursor}
          onClick={bumpCursor}
          onKeyDown={handleKeyDown}
          placeholder={"Start writing your notes here...\n\nUse >> for basic cards\nUse <> for reversible cards\nUse {{text}} for cloze deletions"}
          spellCheck={false}
          style={{ fontSize, fontFamily }}
        />
      </div>
    </div>
  )
})

export default SourceEditor
