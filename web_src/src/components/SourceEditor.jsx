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

// ─── Component ──────────────────────────────────────
const SourceEditor = forwardRef(function SourceEditor({ content, onChange, onCardCountChange, settings, cardRefs }, ref) {
  const textareaRef = useRef(null)
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
        } else if (formatActions[action]) {
          formatActions[action](textareaRef.current)
        }
      }
    }
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
      <textarea
        ref={textareaRef}
        className="source-editor"
        defaultValue={content}
        onInput={handleInput}
        onSelect={bumpCursor}
        onKeyUp={bumpCursor}
        onClick={bumpCursor}
        onKeyDown={handleKeyDown}
        placeholder={"Start writing your notes here...\n\nUse >> for basic cards\nUse <> for reversible cards\nUse {{text}} for cloze deletions"}
        spellCheck={false}
        style={{ fontSize, fontFamily }}
      />
    </div>
  )
})

export default SourceEditor
