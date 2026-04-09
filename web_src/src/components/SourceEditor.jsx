import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback, useState, useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { openInBrowser } from '../bridge'
import { getLineIndexAtCursor, getLineTextAtIndex, resolveNoteIdForLine } from '../crossLink'

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
    if (/^.+?\s*>>\s*.+$/.test(cardContent)) {
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
  bold: (ta) => wrapSelection(ta, '**', '**'),
  italic: (ta) => wrapSelection(ta, '*', '*'),
  strikethrough: (ta) => wrapSelection(ta, '~~', '~~'),
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

function highlightLine(line) {
  let h = escapeHtml(line)

  h = h.replace(/(\{\{c\d+::.+?\}\}|\{\{.+?\}\})/g, '<span class="src-syn-cloze">$1</span>')
  h = h.replace(/(\s&lt;&gt;\s)/g, '<span class="src-syn-reversible">$1</span>')
  h = h.replace(/(\s&gt;&gt;\s)/g, '<span class="src-syn-basic">$1</span>')
  h = h.replace(/(\*\*[^*]+\*\*)/g, '<span class="src-syn-bold">$1</span>')
  h = h.replace(/(^|[^*])(\*[^*\n]+\*)/g, '$1<span class="src-syn-italic">$2</span>')

  if (/^#{1,6}\s/.test(line)) {
    h = `<span class="src-syn-heading">${h}</span>`
  }
  return h
}

function highlightMarkdown(text) {
  const lines = (text || '').split('\n')
  const html = lines.map(highlightLine).join('\n')
  // Keep trailing newline visible in overlay so caret alignment stays accurate.
  return html + '\n'
}

// ─── Component ──────────────────────────────────────
const SourceEditor = forwardRef(function SourceEditor({ content, onChange, onCardCountChange, settings, cardRefs }, ref) {
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
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current, start = ta.selectionStart, end = ta.selectionEnd
      ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end)
      ta.selectionStart = ta.selectionEnd = start + 4
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      bumpCursor()
    }
  }, [bumpCursor])

  const fontSize = settings?.font_size || 14
  const fontFamily = settings?.font_family || "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace"
  const highlightedHtml = useMemo(() => highlightMarkdown(content), [content])

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
          className="source-editor-highlight"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
        <textarea
          ref={textareaRef}
          className="source-editor source-editor-overlay"
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
