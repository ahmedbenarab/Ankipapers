import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { GripVertical, ExternalLink, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { openInBrowser, pasteImage, getClipboardText } from '../bridge'
import WeakSpotHover from './WeakSpotHover'
import DraftGroup from './DraftGroup'
import { buildCardRefIndex, resolveNoteIdFromIndex } from '../crossLink'
import {
  formatInlineRaw,
  resolveMediaSrc,
  getBlockType,
  parseTableRow,
  isTableSeparatorRow,
  tableSizeOf,
  withTableSize,
  TABLE_SIZES,
  TABLE_SIZE_DEFAULT,
  BASIC_CARD_RE,
  toggleTagSegment,
  findTextReplacement,
} from '../blockFormat'

const TABLE_SIZE_LABELS = { s: '40%', m: '60%', l: '80%', full: 'full width' }
import {
  AP_LINK_RE,
  stripApBlockId,
  extractApBlockSuffix,
  mergeEditedWithApSuffix,
  ensureApBlockId,
  buildApUrl,
  reindentKeepingAnchor,
} from '../docLinks'

import {
  ARROW,
  ARROWS_RE,
  codeLineMap,
  splitCodeLine,
  codePrefix,
  outlineIndent,
  highlightLines,
  isFenceOpenLine,
  isFenceCloseLine,
  arrowsFromSpaces,
} from '../codeBlocks'

// Shown next to "Paste blocks" and used in its error message.
const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
const PASTE_HINT = IS_MAC ? '\u2318V' : 'Ctrl+V'
// Modifier on its own, for the menu row that tells you how to paste.
const PASTE_MOD = IS_MAC ? '\u2318' : 'Ctrl'

function ZettelkastenSearch({ query, selected, papers }) {
  const results = useMemo(() => {
    return papers.filter(p => p.title.toLowerCase().includes(query.toLowerCase()))
  }, [papers, query])

  if (results.length === 0) {
    return (
      <div className="zettel-popup">
        <div className="zettel-popup-item" style={{ opacity: 0.5 }}>No papers found</div>
      </div>
    )
  }

  return (
    <div className="zettel-popup">
      {results.map((p, i) => (
        <div key={p.id} className={`zettel-popup-item ${i === selected ? 'selected' : ''}`}>
          {p.title}
        </div>
      ))}
    </div>
  )
}

/**
 * Block Editor — Notion-like editing experience.
 * Each line is a "block" that shows rendered content.
 * Clicking a block makes it editable inline.
 */

// Stable block-id suffix (hidden in editor UI; kept in stored markdown)
function findTableBounds(lines, rowIndex) {
  const isTableRow = (ln) => parseTableRow(ln) !== null
  if (!isTableRow(lines[rowIndex])) return null
  let start = rowIndex
  while (start > 0 && isTableRow(lines[start - 1])) start--
  let end = rowIndex
  while (end + 1 < lines.length && isTableRow(lines[end + 1])) end++
  if (start + 1 > end || !isTableSeparatorRow(lines[start + 1])) return null
  return { start, end }
}

function isTableHeadRow(lines, rowIndex) {
  const b = findTableBounds(lines, rowIndex)
  return !!b && b.start === rowIndex
}

function getNextClozeNumberInLine(line) {
  const matches = [...(line || '').matchAll(/\{\{c(\d+)::/g)]
  let max = 0
  for (const m of matches) max = Math.max(max, parseInt(m[1], 10) || 0)
  return max + 1
}

function countCards(blocks) {
  let basic = 0, reversible = 0, cloze = 0
  for (const b of blocks) {
    if (b.type === 'basic') basic++
    else if (b.type === 'reversible') reversible++
    else if (b.type === 'cloze') cloze++
  }
  return { basic, reversible, cloze }
}

/** Wrap selection in a single-line block (same idea as SourceEditor textarea). */
function wrapLineSegment(line, selStart, selEnd, prefix, suffix, emptyPlaceholder = 'text') {
  const len = line.length
  let a = Math.max(0, Math.min(selStart ?? 0, len))
  let b = Math.max(0, Math.min(selEnd ?? 0, len))
  if (b < a) [a, b] = [b, a]
  const before = line.slice(0, a)
  const selected = line.slice(a, b)
  const after = line.slice(b)
  if (selected.length > 0) {
    return {
      line: before + prefix + selected + suffix + after,
      selStart: a + prefix.length,
      selEnd: a + prefix.length + selected.length,
    }
  }
  const ph = emptyPlaceholder
  return {
    line: before + prefix + ph + suffix + after,
    selStart: a + prefix.length,
    selEnd: a + prefix.length + ph.length,
  }
}

/**
 * Flatten clipboard text copied from a PDF or textbook into one line.
 *
 * Typeset text arrives with a hard line break at the end of every rendered
 * line, plus hyphens where words were split across those lines. This undoes
 * both so a pasted excerpt reads as the single paragraph it actually is.
 */
function normalizePastedText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')                    // normalize CRLF / CR
    .replace(/\u00AD/g, '')                     // drop soft hyphens outright
    // Word split across a line break: "propa-" + newline + "gation" -> "propagation".
    // Lowercase on both sides only, so hyphenated abbreviations that wrap
    // ("ST-" + newline + "elevation", "AV-" + newline + "nodal") keep their hyphen.
    .replace(/([a-z])[-\u2010\u2011]\n\s*([a-z])/g, '$1$2')
    // Any other hyphen sitting at a line end is a real compound hyphen that
    // happened to wrap, so close the break without inserting a space:
    // "ST-" + newline + "elevation" -> "ST-elevation", not "ST- elevation".
    .replace(/([A-Za-z])([-\u2010\u2011])\n\s*([A-Za-z])/g, '$1$2$3')
    .replace(/\s*\n\s*/g, ' ')                  // every remaining break -> one space
    .replace(/[ \t\u00A0\u2000-\u200A]+/g, ' ') // collapse spaces/tabs/NBSP runs
    .trim()
}

function scheduleRestoreSelection(inputRef, start, end) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el || typeof el.setSelectionRange !== 'function') return
      const max = el.value.length
      const s = Math.max(0, Math.min(start, max))
      const e = Math.max(0, Math.min(end, max))
      el.focus()
      el.setSelectionRange(s, e)
    })
  })
}

// ─── Inline formatting ─────────────────────────────
// formatInline() is called from every card/heading/bullet/paragraph render
// (12 call sites in RenderBlock below) — including for blocks whose text
// hasn't changed but whose position in the document has (e.g. every line
// after a single Enter/paste/drag-reorder/duplicate/merge/delete). It's a
// pure function — the same (text, mediaDir) always produces the same HTML —
// so those re-renders can hit a cache instead of re-running the full regex
// chain above. No eviction: at realistic document sizes the memory cost is
// negligible (roughly 200 bytes/line — even tens of thousands of distinct
// lines across a long session stays in the tens-of-MB range).
//
// Critically, what is cached is the whole `{ __html }` PROP OBJECT, not just
// the HTML string. React 19 decides whether to touch dangerouslySetInnerHTML
// by comparing that prop by OBJECT IDENTITY, not by the string inside it: a
// fresh `{ __html: sameString }` literal on each render makes React re-set
// innerHTML anyway, and the browser then destroys and re-parses the whole
// subtree. On a large document that was thousands of DOM nodes torn down and
// rebuilt per keystroke. Handing React back the identical object lets it skip
// the DOM entirely whenever a block's text has not changed.
const formatInlineCache = new Map()
function formatInlineProp(text, mediaDir) {
  const cacheKey = (mediaDir || '') + '\u0000' + text
  let prop = formatInlineCache.get(cacheKey)
  if (prop === undefined) {
    prop = { __html: formatInlineRaw(text, mediaDir) }
    formatInlineCache.set(cacheKey, prop)
  }
  return prop
}

// Kept for callers that want the HTML string rather than the prop object.
function formatInline(text, mediaDir) {
  return formatInlineProp(text, mediaDir).__html
}

// ─── Link Preview ─────────────────────────────────────
function LinkPreview({ url }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  
  useEffect(() => {
    let active = true
    fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`)
      .then(res => res.json())
      .then(json => {
         if (active && json.status === 'success') setData(json.data)
         else if (active) setError(true)
      })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [url])

  if (error) return <a href={url} target="_blank" rel="noopener noreferrer" className="block-link-fallback">{url}</a>
  if (!data) return <div className="block-link-loading">Loading preview... <span className="block-link-url">{url}</span></div>
  
  return (
    <a className="block-link-card" href={url} target="_blank" rel="noopener noreferrer">
      <div className="block-link-content">
         <div className="block-link-title">{data.title || url}</div>
         <div className="block-link-desc">{data.description || ''}</div>
         <div className="block-link-url-text">{url}</div>
      </div>
      {data.image && (
         <div className="block-link-image" style={{ backgroundImage: `url(${data.image.url})` }} />
      )}
    </a>
  )
}

// ─── Rendered block ─────────────────────────────────
function RenderBlock({ line, type, mediaDir, onResize, onTableResize, noteId, weakStatus, weakLapses }) {
  const t = stripApBlockId(line).trim()

  // Cells come from the shared parseTableRow rather than a local copy. The
  // copy that used to live here stripped a trailing "|" with /\|$/ — which
  // stops matching the moment a size marker sits after it, leaving the
  // marker visible inside the last column. One definition, in blockFormat.
  const parseTableCells = (rowLine) => parseTableRow(rowLine) || []

  if (type === 'empty') return <div className="block-spacer" />

  if (type === 'divider') return <hr className="block-divider" />

  if (type === 'heading') {
    const m = t.match(/^(#{1,6})\s+(.+)$/)
    const level = m[1].length
    const Tag = `h${level}`
    return <Tag className={`block-heading block-h${level}`} dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} />
  }

  if (type === 'blockquote') {
    return <blockquote className="block-blockquote" dangerouslySetInnerHTML={formatInlineProp(t.slice(2), mediaDir)} />
  }

  if (type === 'link-preview') {
    return <LinkPreview url={t} />
  }

  if (type === 'image') {
    // Support ![alt|width](src) syntax (use raw line so filenames stay intact)
    const m = stripApBlockId(line).trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (m) {
      let altText = m[1]
      let width = null
      // Parse width from alt: ![alt|300](src)
      const widthMatch = altText.match(/^(.+?)\|(\d+)$/)
      if (widthMatch) {
        altText = widthMatch[1]
        width = parseInt(widthMatch[2])
      }
      const src = resolveMediaSrc(m[2], mediaDir)
      const imgStyle = { maxWidth: width ? `${width}px` : '400px' }
      return (
        <div className="block-image">
          <img src={src} alt={altText} style={imgStyle} />
          {altText && <div className="block-image-caption">{altText}{width && <span className="block-image-size"> · {width}px</span>}</div>}
          <div className="block-image-resize">
            <button className="resize-btn" onClick={() => onResize?.('150')}>S</button>
            <button className="resize-btn" onClick={() => onResize?.('300')}>M</button>
            <button className="resize-btn" onClick={() => onResize?.('500')}>L</button>
            <button className="resize-btn" onClick={() => onResize?.('')}>Full</button>
          </div>
        </div>
      )
    }
  }

  if (type === 'table') {
    const rows = line.split('\n').map((row) => stripApBlockId(row))
    // The width setting is recorded on the header row; default to L (80%).
    const size = tableSizeOf(rows[0]) || TABLE_SIZE_DEFAULT
    const hasHeader = rows.length > 1 && isTableSeparatorRow(rows[1])
    return (
      <div className="block-table-wrap">
        <div className={`block-table is-${size}`}>
          {rows.map((row, rowIdx) => {
            if (isTableSeparatorRow(row)) return null
            // parseTableRow already drops the size marker, so it can never
            // show up as text inside the last header cell.
            const cells = parseTableCells(row)
            const head = hasHeader && rowIdx === 0
            return (
              <div key={rowIdx} className={`block-table-row${head ? ' is-head' : ''}`}>
                {cells.map((cell, idx) => (
                  <div key={idx} className="block-table-cell" dangerouslySetInnerHTML={formatInlineProp(cell, mediaDir)} />
                ))}
              </div>
            )
          })}
        </div>
        <div className="block-table-resize">
          {TABLE_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={`resize-btn${s === size ? ' is-active' : ''}`}
              onClick={() => onTableResize?.(s)}
              title={`Table width: ${TABLE_SIZE_LABELS[s]}`}
            >
              {s === 'full' ? 'Full' : s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'basic') {
    const content = t.replace(/^\s*[-*]\s+/, '')
    const m = content.match(BASIC_CARD_RE)
    if (m) return (
      <div className={`block-card block-card-basic${weakStatus ? ' has-weak' : ''}`}>
        <div className="block-card-type">
          {weakStatus && (
            <i className={`weak-pill is-${weakStatus}`}>
              {weakStatus === 'leech' ? `Leech · ${weakLapses} lapses` : `${weakLapses} lapses`}
            </i>
          )}
          <span>BASIC</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-card-front" dangerouslySetInnerHTML={formatInlineProp(m[1], mediaDir)} />
        <div className="block-card-sep">▼</div>
        <div className="block-card-back" dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} />
      </div>
    )
  }

  if (type === 'reversible') {
    const content = t.replace(/^\s*[-*]\s+/, '')
    const m = content.match(/^(.+?)\s*<>\s*(.+)$/)
    if (m) return (
      <div className={`block-card block-card-reversible${weakStatus ? ' has-weak' : ''}`}>
        <div className="block-card-type reversible">
          {weakStatus && (
            <i className={`weak-pill is-${weakStatus}`}>
              {weakStatus === 'leech' ? `Leech · ${weakLapses} lapses` : `${weakLapses} lapses`}
            </i>
          )}
          <span>REVERSIBLE</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-card-front" dangerouslySetInnerHTML={formatInlineProp(m[1], mediaDir)} />
        <div className="block-card-sep">⇅</div>
        <div className="block-card-back" dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} />
      </div>
    )
  }

  if (type === 'cloze') {
    return (
      <div className={`block-cloze-wrapper${weakStatus ? ' has-weak' : ''}`}>
        {/* Injected the standard card type container with a specific cloze class */}
        <div className="block-card-type cloze-type">
          {weakStatus && (
            <i className={`weak-pill is-${weakStatus}`}>
              {weakStatus === 'leech' ? `Leech · ${weakLapses} lapses` : `${weakLapses} lapses`}
            </i>
          )}
          <span>CLOZE</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-cloze" dangerouslySetInnerHTML={formatInlineProp(t, mediaDir)} />
      </div>
    )
  }

  if (type === 'bullet') {
    const m = t.match(/^\s*[-*]\s+(.+)$/)
    return <div className="block-list-item"><span className="block-bullet">•</span><span dangerouslySetInnerHTML={formatInlineProp(m[1], mediaDir)} /></div>
  }

  if (type === 'numbered') {
    const m = t.match(/^\s*(\d+)\.\s+(.+)$/)
    return <div className="block-list-item"><span className="block-num">{m[1]}.</span><span dangerouslySetInnerHTML={formatInlineProp(m[2], mediaDir)} /></div>
  }

  if (t.startsWith('&& ')) {
    return (
      <p className="block-paragraph block-supplement">
        <em dangerouslySetInnerHTML={formatInlineProp(t.slice(3), mediaDir)} />
      </p>
    )
  }

  // Default: paragraph
  return <p className="block-paragraph" dangerouslySetInnerHTML={formatInlineProp(t, mediaDir)} />
}


// ─── Block context menu ─────────────────────────────
function BlockContextMenu({
  x,
  y,
  menuRef,
  onClose,
  onEdit,
  onCopy,
  onPasteBlocks,
  onPastePlain,
  onDuplicate,
  onMerge,
  onDelete,
  onEditTable,
  canEditTable,
  onGoToSource,
  canGoToSource,
  onCreateLink,
  canCreateLink,
  createLinkHint,
  selectionCount,
  onDraftCards,
}) {
  const multi = selectionCount > 1
  useEffect(() => {
    let canceled = false
    const onDocPointer = (e) => {
      if (canceled) return
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const raf = requestAnimationFrame(() => {
      if (!canceled) {
        document.addEventListener('pointerdown', onDocPointer, true)
        document.addEventListener('keydown', onKey, true)
      }
    })
    return () => {
      canceled = true
      cancelAnimationFrame(raf)
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuRef, onClose])

  const pad = 8
  const w = 200
  const h = 200
  const left = Math.max(pad, Math.min(x, window.innerWidth - w - pad))
  const top = Math.max(pad, Math.min(y, window.innerHeight - h - pad))

  return (
    <div
      ref={menuRef}
      className="block-context-menu"
      style={{ left, top }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {multi && (
        <div className="block-context-menu-hint" role="presentation">
          {selectionCount} blocks selected
        </div>
      )}
      <button
        type="button"
        className="block-context-menu-item"
        role="menuitem"
        disabled={multi}
        onClick={onEdit}
      >
        Edit block
      </button>
      {createLinkHint !== null && (
        <button
          type="button"
          className="block-context-menu-item"
          role="menuitem"
          disabled={multi || !canCreateLink}
          title={canCreateLink ? 'Point this phrase at a header or document' : createLinkHint}
          onClick={onCreateLink}
        >
          Create link…
        </button>
      )}
      {onDraftCards && (
        <button
          type="button"
          className="block-context-menu-item ai"
          role="menuitem"
          onClick={onDraftCards}
          title="Turn the selected lines into card drafts you can accept or discard"
        >
          {multi ? `Draft cards from ${selectionCount} lines` : 'Draft cards from this line'}
        </button>
      )}
      {canEditTable && (
        <button
          type="button"
          className="block-context-menu-item"
          role="menuitem"
          disabled={multi}
          onClick={onEditTable}
        >
          Edit table
        </button>
      )}
      {canGoToSource && (
        <button
          type="button"
          className="block-context-menu-item"
          role="menuitem"
          disabled={multi}
          onClick={onGoToSource}
        >
          Go to source
        </button>
      )}
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onPasteBlocks}>
        Press {PASTE_MOD} + V to Paste
      </button>
      <button
        type="button"
        className="block-context-menu-item has-key"
        role="menuitem"
        onClick={onPastePlain}
        title="Paste the clipboard as one line, turning line breaks into spaces"
      >
        Paste as plain text
        <span className="block-context-menu-key">⇧ {PASTE_MOD} V</span>
      </button>
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onCopy}>
        {multi ? 'Copy blocks' : 'Copy line'}
      </button>
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onDuplicate}>
        Duplicate below
      </button>
      {multi && (
        <button type="button" className="block-context-menu-item" role="menuitem" onClick={onMerge}>
          Merge into one block
        </button>
      )}
      <div className="block-context-menu-sep" />
      <button type="button" className="block-context-menu-item danger" role="menuitem" onClick={onDelete}>
        {multi ? 'Delete blocks' : 'Delete block'}
      </button>
    </div>
  )
}

// ─── Single Block Component ─────────────────────────
// ─── Code blocks ───────────────────────────────────
// A ``` block is drawn as one panel across its rows. With the caret outside
// it the fences fold into a header (language, Copy) and a bottom edge; with
// the caret inside, the fences show as text so the language or the end of
// the block can be edited. Code lines never show their ➵: each one is drawn
// as an indent step of the language (codeBlocks.js).
function copyToClipboard(text) {
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* nothing else to try */ }
    ta.remove()
  }
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback)
    else fallback()
  } catch { fallback() }
}

function CodeRow({ type, info, active, text, depth }) {
  const [copied, setCopied] = useState(false)
  if (type === 'code-open') {
    if (active) return <div className="code-fence-text">{text}</div>
    return (
      <div className="code-head">
        <span className="code-head-label">{info.label || 'Code'}</span>
        <button type="button" className="code-copy" title="Copy the code"
          onClick={(e) => {
            e.stopPropagation()
            copyToClipboard(info.copyText || '')
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    )
  }
  if (type === 'code-close') return active ? <div className="code-fence-text">{text}</div> : <div className="code-foot" />
  return (
    <div className="code-line" style={{ paddingLeft: `calc(8px + ${depth * info.step}ch)` }}
      dangerouslySetInnerHTML={{ __html: info.html || '\u200b' }} />
  )
}

function syncBlockTextareaHeight(el) {
  if (!el || el.tagName !== 'TEXTAREA') return
  el.style.height = 'auto'
  const max = Math.min(Math.floor(window.innerHeight * 0.55), 520)
  el.style.maxHeight = `${max}px`
  const h = Math.min(el.scrollHeight, max)
  el.style.height = `${h}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

const Block = React.memo(function Block({
  blockId,
  line,
  type,
  focused,
  isSelected,
  isRevealed,
  dragDisabled,
  onRowClick,
  onChange,
  onKeyDown,
  mediaDir,
  onImageResize,
  onTableResize,
  noteId,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
  onBlockContextMenu,
  onOpenLink,
  activeBlockInputRef,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
  blockKey,
  onZettelSearch,
  weakStatus = null,
  weakLapses = 0,
  codeInfo = null,
  codeActive = false,
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (!focused) return
    const el = inputRef.current
    if (!el) return
    if (activeBlockInputRef) activeBlockInputRef.current = el
    return () => {
      if (activeBlockInputRef && activeBlockInputRef.current === el) activeBlockInputRef.current = null
    }
  }, [focused, activeBlockInputRef])

  useEffect(() => {
    if (focused && inputRef.current) {
      inputRef.current.focus()
      // Put cursor at end
      const len = inputRef.current.value.length
      inputRef.current.setSelectionRange(len, len)
    }
  }, [focused])

  useLayoutEffect(() => {
    if (!focused) return
    syncBlockTextareaHeight(inputRef.current)
  }, [focused, line])

  const rawDisplay = stripApBlockId(line)
  const spacesMatch = type !== 'table' ? rawDisplay.match(/^[ \t]*/) : null
  const outlineSpaces = spacesMatch ? spacesMatch[0] : ''
  // A code line hides its run of ➵ along with the outline's spaces: the
  // textarea holds only the code, drawn at the indent the ➵ stand for.
  const codeSplit = type === 'code-line' && codeInfo ? splitCodeLine(rawDisplay, codeInfo.fenceIndent) : null
  const leadingSpaces = codeSplit ? codeSplit.prefix : outlineSpaces
  const actualText = type !== 'table' ? rawDisplay.slice(leadingSpaces.length) : rawDisplay
  const indentLevel = Math.floor((codeSplit ? codeInfo.fenceIndent : outlineSpaces).replace(/\t/g, '    ').length / 4)
  const indentPx = indentLevel * 24

  return (
    <div
      className={`block-row ${isDragOver ? 'drag-over' : ''} ${isSelected && !focused ? 'block-row-selected' : ''} ${isRevealed ? 'block-row-revealed' : ''} ${weakStatus ? `block-row-${weakStatus}` : ''} ${codeInfo ? `block-row-code block-row-${type}${codeActive ? ' block-row-code-active' : ''}` : ''}`}
      style={{ marginLeft: indentPx }}
      data-block-id={blockId}
      draggable={!focused && !dragDisabled}
      onClick={(e) => {
        const zettelEl = e.target.closest('.block-zettel-link')
        if (zettelEl) {
          // Allow jump if not focused OR if Ctrl/Cmd is held while focused
          if (!focused || e.ctrlKey || e.metaKey) {
            e.preventDefault()
            e.stopPropagation()
            if (window.openZettel) window.openZettel(zettelEl.dataset.title)
            return
          }
        }
        // Document links open on DOUBLE-click (see onDoubleClick below), so a
        // single click on one must not swap the block into an editing textarea
        // — the second click would then have no link element to land on. To
        // edit a line containing a link, click it anywhere outside the link,
        // or use "Edit block" in the right-click menu.
        if (!focused && e.target.closest('.ap-link')) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (!focused) {
          onRowClick(e, blockId, type)
        }
      }}
      onDoubleClick={(e) => {
        const linkEl = e.target.closest('.ap-link')
        if (!linkEl) return
        e.preventDefault()
        e.stopPropagation()
        onOpenLink?.(linkEl.dataset.apTarget)
      }}
      onDragStart={(e) => onDragStart(e, blockId)}
      onDragOver={(e) => onDragOver(e, blockId)}
      onDrop={(e) => onDrop(e, blockId)}
      onContextMenu={(e) => {
        e.preventDefault()
        onBlockContextMenu?.(e, blockId)
      }}
    >
      {Array.from({ length: indentLevel }).map((_, i) => (
         <div 
           key={i} 
           className="thread-line" 
           style={{ left: (i - indentLevel) * 24 + 8 }} 
         />
      ))}
      <div className="block-collapse-wrapper">
         {hasChildren && (
            <div className="block-collapse-btn" onClick={(e) => onToggleCollapse(e, blockKey)}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
         )}
      </div>
      <div className="block-handle"><GripVertical size={12} /></div>
      {/* Keeps the gap where an outliner dot used to mark plain and empty
          lines; the line numbers do that job now, so the text stays put. */}
      <div className="block-bullet-indicator" />
      <div className={`block type-${type} ${focused ? 'block-editing' : ''} ${focused && isSelected ? 'block-editing-selected' : ''}`}>
        {focused ? (
          <textarea
            ref={inputRef}
            className={`block-input block-input-textarea${codeInfo ? ' block-input-code' : ''}`}
            style={codeSplit ? { paddingLeft: `calc(8px + ${codeSplit.depth * codeInfo.step}ch)` } : undefined}
            value={actualText}
            rows={1}
            wrap="soft"
            spellCheck={!codeInfo}
            autoComplete="off"
            onChange={e => {
              const val = type !== 'table' ? leadingSpaces + e.target.value : e.target.value
              onChange(blockId, mergeEditedWithApSuffix(val, line))
              if (codeSplit) {
                // A ➵ typed or pasted at the start turns into indentation and
                // leaves the textarea; keep the caret on the same character.
                const absorbed = (e.target.value.match(ARROWS_RE) || [''])[0].length
                if (absorbed) {
                  const at = Math.max(0, e.target.selectionStart - absorbed)
                  scheduleRestoreSelection(inputRef, at, at)
                }
              }
              if (onZettelSearch) {
                const selStart = e.target.selectionStart
                const textBefore = e.target.value.slice(0, selStart)
                const lastO = textBefore.lastIndexOf('[[')
                const lastC = textBefore.lastIndexOf(']]')
                if (lastO !== -1 && lastO > lastC) {
                  onZettelSearch(blockId, textBefore.slice(lastO + 2))
                } else {
                  onZettelSearch(blockId, null)
                }
              }
            }}
            onInput={(e) => syncBlockTextareaHeight(e.target)}
            onKeyDown={e => onKeyDown(e, blockId)}
          />
        ) : codeInfo ? (
          <CodeRow type={type} info={codeInfo} active={codeActive} text={actualText} depth={codeSplit ? codeSplit.depth : 0} />
        ) : (
          <RenderBlock line={actualText} type={type} mediaDir={mediaDir} onResize={(w) => onImageResize(blockId, w)} onTableResize={(sz) => onTableResize?.(blockId, sz)} noteId={noteId} weakStatus={weakStatus} weakLapses={weakLapses} />
        )}
      </div>
    </div>
  )
})


function getBlockRangeAndIndent(lines, idx) {
  // Any line of a ``` block stands for the whole block (and the cards under
  // its closing fence): moving one fence or code line alone would break it.
  const code = codeLineMap(lines).get(idx)
  if (code) idx = code.open
  const spaces = (lines[idx].match(/^[ \t]*/) || [''])[0]
  const indent = Math.floor(spaces.replace(/\t/g, '    ').length / 4)
  let end = code ? code.close : idx
  while (end + 1 < lines.length) {
    const nextIndent = Math.floor((lines[end + 1].match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length / 4)
    if (nextIndent > indent) end++
    else break
  }
  return { start: idx, end, indent }
}

/**
 * Where accepted draft cards go, given the line they were drafted at.
 *
 * A blank line is filled in place: it is usually the empty line you opened
 * for the cards. Any other line gets them after it and everything nested
 * under it, so they don't adopt its children. Either way the cards take THAT
 * line's indent (none under a heading) — not the indent of its last nested
 * line, which used to drop them one or more levels too deep.
 *
 * `after` is the line the cards (and the draft box) sit below; when filling,
 * it is the blank line itself.
 */
function draftPlacement(lines, at) {
  const display = stripApBlockId(lines[at] || '')
  const indent = (display.match(/^[ \t]*/) || [''])[0]
  if (!display.trim()) return { fill: true, after: at, indent }
  const isHeading = /^\s*#{1,6}\s/.test(display)
  return { fill: false, after: getBlockRangeAndIndent(lines, at).end, indent: isHeading ? '' : indent }
}

// ─── Block Editor ───────────────────────────────────
const BlockEditor = forwardRef(function BlockEditor({ content, onChange, onCardCountChange, settings, mediaDir, cardRefs, onTableEditRequest, onGoToSource, onOpenDocLink, onRequestCreateLink, onNotify, papers = [], textReplacements = null, onHistoryCheckpoint, noteStats = null, weakOnly = false, onUnsuspendNote, onVisibleLineChange, draftGroup = null, onRequestDraft, onDraftAccept, onDraftDiscard, onDraftRedo, onDraftEdit, onDraftRedraft, onDraftCancel, onOpenAiSettings }, ref) {
  const [focusedIndex, setFocusedIndex] = useState(null)
  const [selectedIndices, setSelectedIndices] = useState(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [blockMenu, setBlockMenu] = useState(null)
  // ── Stable per-line identity for React keys ──────────────────────────
  // Keying blocks by array position means that inserting or deleting a line
  // hands every block below it a DIFFERENT line's text, forcing them all to
  // re-render (and re-parse their HTML). Instead, give each line an id that
  // survives edits above it: match the unchanged prefix and suffix of the
  // document against the previous version, and reuse ids positionally in the
  // changed middle. Typing reuses the id for the edited line (so the focused
  // textarea is never remounted and never loses the cursor), and pressing
  // Enter reuses every id below the insertion point.
  const lineIdsRef = useRef({ lines: [], ids: [] })
  const nextLineIdRef = useRef(1)
  const lineIds = useMemo(() => {
    const newLines = content.split('\n')
    const { lines: oldLines, ids: oldIds } = lineIdsRef.current
    const n = newLines.length
    const m = oldLines.length
    // Longest common prefix, then longest common suffix of what remains.
    // Bounding the suffix by (n - p) and (m - p) keeps the two regions from
    // overlapping, which guarantees no id is reused twice.
    let p = 0
    while (p < n && p < m && newLines[p] === oldLines[p]) p++
    let suf = 0
    while (suf < (n - p) && suf < (m - p) && newLines[n - 1 - suf] === oldLines[m - 1 - suf]) suf++
    const ids = new Array(n)
    for (let i = 0; i < p; i++) ids[i] = oldIds[i]
    for (let i = 0; i < suf; i++) ids[n - 1 - i] = oldIds[m - 1 - i]
    const newMid = n - p - suf
    const oldMid = m - p - suf
    // In the changed middle, a line whose text is unchanged keeps its own id
    // first, so a block that is dragged or moved takes its id -- and with it
    // its folded state -- along. Whatever is left is matched by position, so
    // the line being typed in keeps its id.
    const byText = new Map()
    for (let k = 0; k < oldMid; k++) {
      const t = oldLines[p + k]
      if (!byText.has(t)) byText.set(t, [])
      byText.get(t).push(oldIds[p + k])
    }
    const used = new Set()
    for (let i = 0; i < newMid; i++) {
      const q = byText.get(newLines[p + i])
      if (q && q.length) { ids[p + i] = q.shift(); used.add(ids[p + i]) }
    }
    for (let i = 0; i < newMid; i++) {
      if (ids[p + i]) continue
      const pos = i < oldMid ? oldIds[p + i] : null
      ids[p + i] = pos && !used.has(pos) ? pos : 'L' + (nextLineIdRef.current++)
      used.add(ids[p + i])
    }
    lineIdsRef.current = { lines: newLines, ids }
    return ids
  }, [content])

  // ── Collapse-by-default: compute which lines should start collapsed ─────────
  // Folding is remembered per LINE (its id, above), not per line text. Keyed
  // by "indent:text", every closing ``` fence at the same level -- and any two
  // identical lines, like two "Treatment" bullets -- shared one fold state,
  // so opening one opened them all.
  //
  // A block is auto-collapsed on mount if it has at least one child (i.e. the
  // next line is indented deeper).  We only re-run this initializer when the
  // *identity* of the content prop changes (new document loaded), not on every
  // keystroke — that's why we track a stable "document id" via useRef so the
  // reset effect below can distinguish a real document swap from an edit.
  const computeInitialCollapsed = useCallback((rawContent) => {
    const lines = rawContent.split('\n')
    const ids = lineIdsRef.current.ids
    const initial = new Set()
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]
      const rawDisplay = stripApBlockId(line)
      const spacesMatch = rawDisplay.match(/^[ \t]*/)
      const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
      const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const nextLine = lines[i + 1]
      const nextSpacesMatch = stripApBlockId(nextLine).match(/^[ \t]*/)
      const nextLeading = nextSpacesMatch ? nextSpacesMatch[0] : ''
      const nextIndent = Math.floor(nextLeading.replace(/\t/g, '    ').length / 4)
      if (nextIndent > indentLevel && ids[i]) {
        initial.add(ids[i])
      }
    }
    return initial
  }, [])

  const [collapsedIds, setCollapsedIds] = useState(() => computeInitialCollapsed(content))

  // Collapse-by-default is applied ONCE, by the useState initializer above.
  //
  // There is deliberately no effect here that re-applies it when `content`
  // changes. App renders this component with key={paper.id}, so opening a
  // different paper unmounts and remounts it and the initializer runs again
  // against the new document -- which is the only moment collapse-by-default
  // should ever be applied. Every change that keeps the same paper open is an
  // edit (typing, undo/redo, pasting, the anchors Generate writes back), and an
  // edit must never re-fold sections the reader has opened.
  //
  // An earlier version tried to spot a document swap by measuring how much
  // `content` had changed, treating a jump of 15+ lines as a new document.
  // Pasting anything long from outside -- anywhere in the paper, even the last
  // line -- cleared that bar and folded the whole document up mid-edit.

  const [lasso, setLasso] = useState(null)
  const [zettelSearch, setZettelSearch] = useState(null)
  const containerRef = useRef(null)
  const blockMenuRef = useRef(null)
  const activeBlockInputRef = useRef(null)

  useEffect(() => {
    if (!lasso) return
    const onMouseMove = (e) => {
      e.preventDefault()
      setLasso(prev => prev ? { ...prev, curX: e.clientX, curY: e.clientY } : null)
      if (!containerRef.current) return
      const startX = lasso.startX
      const startY = lasso.startY
      const curX = e.clientX
      const curY = e.clientY
      const top = Math.min(startY, curY)
      const bottom = Math.max(startY, curY)
      const left = Math.min(startX, curX)
      const right = Math.max(startX, curX)

      const nextSelection = new Set()
      const children = containerRef.current.querySelectorAll('.block-row')
      children.forEach((child) => {
        const cRect = child.getBoundingClientRect()
        // Determine overlap
        if (cRect.top <= bottom && cRect.bottom >= top && cRect.left <= right && cRect.right >= left) {
          const idx = idToIndexRef.current.get(child.dataset.blockId)
          if (idx !== undefined) nextSelection.add(idx)
        }
      })
      setSelectedIndices(nextSelection)
    }
    const onMouseUp = () => {
      setLasso(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [lasso])

// ── Expand All / Collapse All Shortcuts ──────────────────────────
  useEffect(() => {
    const handleFoldShortcut = (e) => {
      if (!e.shiftKey || !(e.ctrlKey || e.metaKey)) return

      // Ctrl+Shift+Down, and Shift+Cmd+Down on a Mac. Every other shortcut in
      // the app uses Ctrl on macOS too, so accepting Ctrl here makes this one
      // consistent with them and gives Windows and Linux the shortcut at all --
      // it previously tested metaKey alone, which those platforms never set.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        // Passing an empty Set clears all collapsed states globally
        setCollapsedIds(new Set())
        return
      }

      // Ctrl/Cmd+Shift+Up is the mirror image: collapse every block that has
      // children, i.e. the same state a document opens in. Reading the content
      // from a ref keeps this listener registered once rather than re-attaching
      // on every keystroke.
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        // Focus would otherwise be stranded inside a row that just got hidden.
        setFocusedIndex(null)
        setCollapsedIds(computeInitialCollapsed(contentRef.current))
      }
    }

    // Attach to the window to catch the command even if a specific block isn't focused
    window.addEventListener('keydown', handleFoldShortcut)

    return () => {
      window.removeEventListener('keydown', handleFoldShortcut)
    }
  }, [computeInitialCollapsed])

  const toggleCollapse = useCallback((e, id) => {
    e.stopPropagation()
    setFocusedIndex(null)
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Built once per cardRefs change (not per keystroke — cardRefs only
  // changes after generating/syncing cards) so note-ID lookups below are
  // O(1) Map reads instead of rescanning the whole card_refs array for
  // every card line in the document. See crossLink.js for details.
  const cardRefIndex = useMemo(() => buildCardRefIndex(cardRefs), [cardRefs])


  // id -> current line index. Callbacks below take a stable blockId and look
  // the index up here at event time, so they never need the index as a prop
  // (a prop that shifts for every block below an edit, which would defeat
  // Block's React.memo and re-render the whole document).
  const idToIndex = useMemo(() => {
    const m = new Map()
    for (let i = 0; i < lineIds.length; i++) m.set(lineIds[i], i)
    return m
  }, [lineIds])
  const idToIndexRef = useRef(idToIndex)
  idToIndexRef.current = idToIndex

  // Entrance-animation delay, assigned once per line id and then held steady.
  // Deriving it from the row's position meant the inline style changed for
  // every block below an edit, causing a wave of style writes.
  const staggerRef = useRef(new Map())
  const staggerDelays = useMemo(() => {
    const m = staggerRef.current
    lineIds.forEach((id, i) => {
      if (!m.has(id)) m.set(id, Math.min((i % 40) * 25, 800))
    })
    return m
  }, [lineIds])

  const blocks = useMemo(() => {
    const lines = content.split('\n')
    const parsed = lines.map((line, i) => {
      const type = getBlockType(line)
      const rawDisplay = stripApBlockId(line)
      const spacesMatch = type !== 'table' ? rawDisplay.match(/^[ \t]*/) : null
      const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
      const actualText = type !== 'table' ? rawDisplay.slice(leadingSpaces.length) : rawDisplay
      const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const key = `${indentLevel}:${actualText.trim()}`
      // Resolve the linked Anki note ID here, in the single pass we already
      // make over every line, instead of a separate lookup per card block
      // during render (which used to re-split the whole document and
      // rescan card_refs for every single card — see crossLink.js).
      const noteId = (type === 'basic' || type === 'reversible' || type === 'cloze')
        ? resolveNoteIdFromIndex(i, line, cardRefIndex)
        : null
      return { line, type, key, indentLevel, actualText, noteId, id: lineIds[i] }
    })

    // ``` blocks: their lines are code, not cards or headings, whatever they
    // look like. Highlight each block as a whole (a comment or string can run
    // across lines) and hand every row its own slice.
    for (const blk of new Set(codeLineMap(lines).values())) {
      const fenceIndent = outlineIndent(stripApBlockId(lines[blk.open]))
      const parts = []
      for (let i = blk.open + 1; i < blk.close; i++) parts.push(splitCodeLine(stripApBlockId(lines[i]), fenceIndent))
      const html = highlightLines(parts.map((p) => p.text).join('\n'), blk.lang)
      const base = { open: blk.open, close: blk.close, lang: blk.lang, label: blk.label, step: blk.step, fenceIndent }
      const copyText = parts.map((p) => ' '.repeat(p.depth * blk.step) + p.text).join('\n')
      parsed[blk.open] = { ...parsed[blk.open], type: 'code-open', noteId: null, code: { ...base, copyText } }
      parsed[blk.close] = { ...parsed[blk.close], type: 'code-close', noteId: null, code: base }
      for (let i = blk.open + 1; i < blk.close; i++) {
        parsed[i] = { ...parsed[i], type: 'code-line', noteId: null, code: { ...base, html: html[i - blk.open - 1] } }
      }
    }

    const hiddenIndices = new Set()
    for (let i = 0; i < parsed.length; i++) {
        const current = parsed[i]
        
        let hasChildren = false
        if (i < parsed.length - 1) {
            const next = parsed[i + 1]
            if (next.indentLevel > current.indentLevel) {
               hasChildren = true
            }
        }
        current.hasChildren = hasChildren

        if (hasChildren && collapsedIds.has(current.id)) {
            for (let j = i + 1; j < parsed.length; j++) {
                if (parsed[j].indentLevel <= current.indentLevel) break
                hiddenIndices.add(j)
            }
        }
    }
    
    parsed.forEach((b, i) => { b.isHidden = hiddenIndices.has(i) })
    
    return parsed
  }, [content, collapsedIds, cardRefIndex, lineIds])

  // Update card counts
  useEffect(() => {
    onCardCountChange(countCards(blocks))
  }, [blocks])

  // ── "Latest value" refs ──────────────────────────────────────────
  // content/cardRefs/papers/blocks/zettelSearch all change frequently
  // (content on every keystroke, blocks right alongside it). The
  // callbacks below used to close over those values directly and list
  // them as useCallback deps — which meant the callbacks were rebuilt
  // every keystroke too, handing every <Block/> a brand-new
  // onChange/onRowClick/onKeyDown/onImageResize prop each time and
  // defeating Block's React.memo for the whole document. Reading from
  // refs (kept in sync every render, below) lets these callbacks stay
  // referentially stable while still always seeing the latest value.
  const contentRef = useRef(content)
  contentRef.current = content
  const papersRef = useRef(papers)
  papersRef.current = papers
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const zettelSearchRef = useRef(zettelSearch)
  zettelSearchRef.current = zettelSearch
  const focusedIndexRef = useRef(focusedIndex)
  focusedIndexRef.current = focusedIndex
  const selectionAnchorRef = useRef(selectionAnchor)
  selectionAnchorRef.current = selectionAnchor
  const textReplacementsRef = useRef(textReplacements)
  textReplacementsRef.current = textReplacements
  const onHistoryCheckpointRef = useRef(onHistoryCheckpoint)
  onHistoryCheckpointRef.current = onHistoryCheckpoint

  const handleZettelSearch = useCallback((blockId, query) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    if (query !== null) {
      setZettelSearch(prev => (prev?.index === index && prev?.query === query) ? prev : { index, query, selected: 0 })
    } else {
      setZettelSearch(null)
    }
  }, [])

  const handleBlockChange = useCallback((blockId, newValue) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    const lines = contentRef.current.split('\n')
    const b = findTableBounds(lines, index)
    if (b && b.start === index) {
      lines.splice(b.start, b.end - b.start + 1, ...newValue.split('\n'))
    } else {
      lines[index] = newValue
      // Typing the closing ``` of a block whose closing fence Enter added
      // for you leaves that one behind, unpaired, right below: drop it.
      if (isFenceCloseLine(newValue) && isFenceCloseLine(lines[index + 1] ?? '')) {
        const map = codeLineMap(lines)
        const blk = map.get(index)
        if (blk && blk.close === index && !map.has(index + 1)) lines.splice(index + 1, 1)
      }
    }
    onChange(lines.join('\n'))
  }, [onChange])

  const handleBlockRowClick = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    if (e.button !== 0) return
    const el = e.target
    if (el.closest && el.closest('button, a, [role="button"]')) return

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setFocusedIndex(null)
      setSelectedIndices((prev) => {
        const next = new Set(prev)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
      setSelectionAnchor(index)
      return
    }
    if (e.shiftKey) {
      const anchor = selectionAnchorRef.current !== null ? selectionAnchorRef.current : focusedIndexRef.current
      if (anchor !== null && anchor !== undefined) {
        e.preventDefault()
        setFocusedIndex(null)
        const a = Math.min(anchor, index)
        const b = Math.max(anchor, index)
        const next = new Set()
        for (let i = a; i <= b; i++) next.add(i)
        setSelectedIndices(next)
        return
      }
    }
    const lines = contentRef.current.split('\n')
    const b = findTableBounds(lines, index)
    const targetIndex = b ? b.start : index
    setSelectedIndices(new Set())
    setSelectionAnchor(targetIndex)
    setFocusedIndex(targetIndex)
  }, [])

  const handleImageResize = useCallback((blockId, newWidth) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    const lines = contentRef.current.split('\n')
    const line = lines[index]
    // Parse existing image syntax
    const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (!m) return
    let alt = m[1]
    const src = m[2]
    // Remove existing width from alt
    alt = alt.replace(/\|\d+$/, '')
    // Build new line
    if (newWidth) {
      lines[index] = `![${alt}|${newWidth}](${src})`
    } else {
      lines[index] = `![${alt}](${src})`
    }
    onChange(lines.join('\n'))
  }, [onChange])

  /** Write a table's width setting onto its header row. */
  const handleTableResize = useCallback((blockId, size) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    const lines = contentRef.current.split('\n')
    const b = findTableBounds(lines, index)
    if (!b) return
    const header = lines[b.start]
    // The ap anchor is defined as the last thing on a line, so lift it off,
    // set the marker, and put it back.
    const apSuf = extractApBlockSuffix(header)
    lines[b.start] = withTableSize(stripApBlockId(header), size, apSuf)
    onChange(lines.join('\n'))
  }, [onChange])

  const handleKeyDown = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    // Read the latest values via ref instead of closing over the state/props
    // directly. This keeps the callback's identity stable across keystrokes
    // (see the refs declared above) instead of rebuilding it — and every
    // <Block/>'s onKeyDown prop along with it — on every character typed.
    // blocks/zettelSearch/papers were never in the old dependency array
    // either, so simply dropping `content` from it without doing this would
    // have frozen this closure on stale collapse/autocomplete state instead.
    const content = contentRef.current
    const blocks = blocksRef.current
    const zettelSearch = zettelSearchRef.current
    const papers = papersRef.current
    const lines = content.split('\n')

    const currentLine = lines[index]
    const currentApSuf = extractApBlockSuffix(currentLine)
    const currentDisplay = stripApBlockId(currentLine)
    const currentSpacesMatch = currentDisplay.match(/^[ \t]*/)
    // In a ``` block a code line's hidden prefix is the outline's spaces plus
    // its run of ➵, exactly as Block draws it, so the generic paths below
    // (Enter, text replacements) keep the code's indent without knowing it.
    const codeMap = codeLineMap(lines)
    const codeBlk = codeMap.get(index) || null
    const codeRole = codeBlk ? (index === codeBlk.open ? 'open' : index === codeBlk.close ? 'close' : 'line') : null
    const codeFi = codeBlk ? outlineIndent(stripApBlockId(lines[codeBlk.open])) : ''
    const codeSplitK = codeRole === 'line' ? splitCodeLine(currentDisplay, codeFi) : null
    const leadingSpaces = codeSplitK ? codeSplitK.prefix : (currentSpacesMatch ? currentSpacesMatch[0] : '')
    const actualText = currentDisplay.slice(leadingSpaces.length)

    if (zettelSearch && zettelSearch.index === index) {
      const results = papers.filter(p => p.title.toLowerCase().includes(zettelSearch.query.toLowerCase()))
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setZettelSearch(prev => ({ ...prev, selected: Math.min(prev.selected + 1, results.length - 1) }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setZettelSearch(prev => ({ ...prev, selected: Math.max(prev.selected - 1, 0) }))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setZettelSearch(null)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const chosen = results[zettelSearch.selected]
        if (chosen) {
          const selStart = e.target.selectionStart
          const before = e.target.value.slice(0, selStart)
          const lastOpen = before.lastIndexOf('[[')
          const startStr = e.target.value.slice(0, lastOpen)
          const endStr = e.target.value.slice(selStart)
          
          const finalVal = startStr + `[[${chosen.title}]]` + endStr
          lines[index] = mergeEditedWithApSuffix(leadingSpaces + finalVal, currentLine)
          onChange(lines.join('\n'))
          
          const nxtPos = startStr.length + 4 + chosen.title.length
          scheduleRestoreSelection(activeBlockInputRef, nxtPos, nxtPos)
        }
        setZettelSearch(null)
        return
      }
    }

    // ── Tables: the textarea holds every row joined by newlines, while
    // lines[index] is only the FIRST row. A caret offset taken from the
    // textarea therefore means nothing when applied to lines[index], and the
    // generic Enter below used it to splice a blank line in at index + 1 —
    // which is between the header and the separator row. findTableBounds
    // requires those two to be adjacent, so the table silently stopped being
    // a table and its rows fell back to plain text. Handle both keys here,
    // in the table's own coordinates, before the generic paths see them.
    const tableBounds = findTableBounds(lines, index)
    const inTable = !!tableBounds && tableBounds.start === index

    // ── macOS Text Replacements ──────────────────────
    // Space or Return right after a shortcut swaps in its phrase, as macOS
    // does in its own apps. Plain keys only (Shift is fine with Space), no
    // input-method composition, nothing selected. Rules for what counts as a
    // shortcut: findTextReplacement.
    const isSpaceKey = e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
    const isReturnKey = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
    const replacements = textReplacementsRef.current
    const canReplace = (isSpaceKey || isReturnKey) && replacements && !e.nativeEvent?.isComposing
      && e.target.selectionStart === e.target.selectionEnd
    // Set when a shortcut is expanded in a table on Return, so the table's own
    // Return below works on the expanded text rather than the stale textarea.
    let tableText = null
    let tableCaret = null

    // A table's textarea holds every row joined by newlines, so the shortcut
    // is looked for in the caret's row of that text, not in lines[index].
    if (canReplace && inTable) {
      const full = e.target.value ?? ''
      const caret = e.target.selectionStart
      const rowStart = full.lastIndexOf('\n', caret - 1) + 1
      const hit = findTextReplacement(full.slice(rowStart, caret), caret - rowStart, replacements)
      if (hit) {
        e.preventDefault()
        onHistoryCheckpointRef.current?.()
        // A line break would split the row and break the table, so a phrase
        // written on several lines goes in as one.
        const insert = hit.phrase.replace(/\s*\n\s*/g, ' ') + (isSpaceKey ? ' ' : '')
        const at = rowStart + hit.start
        tableText = full.slice(0, at) + insert + full.slice(caret)
        tableCaret = at + insert.length
        lines.splice(tableBounds.start, tableBounds.end - tableBounds.start + 1, ...tableText.split('\n'))
        if (isSpaceKey) {
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, tableCaret, tableCaret)
          return
        }
      }
    }

    // ── Code blocks ──────────────────────────────────
    if (codeRole === 'line') {
      const selS = e.target.selectionStart
      const selE = e.target.selectionEnd
      const withDepth = (d) => codePrefix(codeFi, Math.max(0, d)) + actualText + currentApSuf

      // The ➵ text replacement at the start of the code indents the line; no
      // ➵ is ever left showing.
      if (canReplace) {
        const hit = findTextReplacement(actualText, selS, replacements)
        if (hit && hit.start === 0 && new RegExp(`^(?:${ARROW}\\s*)+$`).test(hit.phrase)) {
          e.preventDefault()
          onHistoryCheckpointRef.current?.()
          const add = (hit.phrase.match(new RegExp(ARROW, 'g')) || []).length
          const rest = actualText.slice(hit.end).replace(/^[ \t]+/, '')
          lines[index] = codePrefix(codeFi, codeSplitK.depth + add) + rest + currentApSuf
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, 0, 0)
          return
        }
      }

      // Tab / Shift+Tab indent the code, one step of its language.
      if (e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey && codeSplitK.depth === 0) return
        lines[index] = withDepth(codeSplitK.depth + (e.shiftKey ? -1 : 1))
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, selS, selE)
        return
      }

      if (e.key === 'Backspace' && selS === 0 && selE === 0) {
        e.preventDefault()
        // Out one step, as in a code editor.
        if (codeSplitK.depth > 0) {
          lines[index] = withDepth(codeSplitK.depth - 1)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, 0, 0)
          return
        }
        // Never join code onto the opening fence; an empty first line just goes.
        if (index - 1 === codeBlk.open) {
          if (!actualText) {
            lines.splice(index, 1)
            onChange(lines.join('\n'))
            setFocusedIndex(index - 1)
          }
          return
        }
        // Join onto the code line above.
        const prevDisplay = stripApBlockId(lines[index - 1])
        const prevSuf = extractApBlockSuffix(lines[index - 1])
        const joinAt = splitCodeLine(prevDisplay, codeFi).text.length
        lines[index - 1] = prevDisplay + actualText + prevSuf
        lines.splice(index, 1)
        onChange(lines.join('\n'))
        setFocusedIndex(index - 1)
        scheduleRestoreSelection(activeBlockInputRef, joinAt, joinAt)
        return
      }
    }

    if (codeRole === 'open' || codeRole === 'close') {
      // Backspace at the start of a fence would join it onto the line above
      // or pull it out of line with its code.
      if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
        e.preventDefault()
        return
      }
      // Tab on a fence moves the whole block, and the cards under it, one
      // outline level -- never a fence on its own.
      if (e.key === 'Tab') {
        e.preventDefault()
        const { start, end } = getBlockRangeAndIndent(lines, index)
        const levelOf = (l) => Math.floor(outlineIndent(stripApBlockId(l)).replace(/\t/g, '    ').length / 4)
        const fenceLevel = levelOf(lines[start])
        if (e.shiftKey ? fenceLevel === 0 : fenceLevel >= (start > 0 ? levelOf(lines[start - 1]) : -1) + 1) return
        for (let i = start; i <= end; i++) {
          lines[i] = reindentKeepingAnchor(lines[i], (l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l))
        }
        onChange(lines.join('\n'))
        return
      }
    }

    if (canReplace && !inTable) {
      const hit = findTextReplacement(actualText, e.target.selectionStart, replacements)
      if (hit) {
        e.preventDefault()
        // Record the text with the shortcut still in it, so the first Ctrl+Z
        // brings the shortcut back.
        onHistoryCheckpointRef.current?.()
        const before = actualText.slice(0, hit.start)
        const after = actualText.slice(hit.end)
        // A phrase with line breaks becomes several lines, like a paste, each
        // at this line's indentation.
        const phraseLines = hit.phrase.split('\n')
        const last = phraseLines.length - 1
        const out = phraseLines.map((pl, i) => leadingSpaces + (i === 0 ? before : '') + pl)
        if (isSpaceKey) {
          out[last] += ' ' + after
          out[0] += currentApSuf   // the hidden anchor stays on the block's own line
          lines.splice(index, 1, ...out)
          onChange(lines.join('\n'))
          const caret = (last === 0 ? before.length : 0) + phraseLines[last].length + 1
          if (last === 0) scheduleRestoreSelection(activeBlockInputRef, caret, caret)
          else setTimeout(() => { setFocusedIndex(index + last); scheduleRestoreSelection(activeBlockInputRef, caret, caret) }, 10)
        } else {
          // Return: the phrase, then the editor's usual split -- whatever
          // followed the cursor moves onto a new line below.
          out[0] = currentApSuf ? out[0].replace(/\s+$/, '') + currentApSuf : out[0]
          lines.splice(index, 1, ...out, leadingSpaces + after)
          onChange(lines.join('\n'))
          setTimeout(() => setFocusedIndex(index + last + 1), 10)
        }
        return
      }
    }

    if (inTable && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const full = tableText ?? e.target.value ?? ''
      const caret = tableCaret ?? e.target.selectionStart ?? full.length
      // Everything added here inherits the table's own indentation. The
      // generic Enter path below does this via `leadingSpaces + after`; a
      // table has no single "current line" to take it from, so read it off
      // the table's first row. Without this a new line after an indented
      // table jumped out to the left margin, level with the H1s.
      const tableIndent = (lines[tableBounds.start].match(/^[ \t]*/) || [''])[0]

      if (caret >= full.length) {
        // At the end of the table: step out of it and open a fresh line below.
        lines.splice(tableBounds.end + 1, 0, tableIndent)
        onChange(lines.join('\n'))
        setTimeout(() => setFocusedIndex(tableBounds.end + 1), 10)
        return
      }

      // Inside the table: add an empty row with the right number of columns,
      // below the row the caret sits in. Never above the separator, or we
      // would recreate the very break this function exists to prevent.
      const caretRow = full.slice(0, caret).split('\n').length - 1
      const cols = (parseTableRow(lines[tableBounds.start]) || []).length || 2
      const blank = tableIndent + '|' + ' |'.repeat(cols)
      const insertAt = Math.min(
        tableBounds.start + Math.max(caretRow, 1) + 1,
        tableBounds.end + 1,
      )
      lines.splice(insertAt, 0, blank)
      onChange(lines.join('\n'))
      setTimeout(() => setFocusedIndex(tableBounds.start), 10)
      return
    }

    if (inTable && e.key === 'Backspace'
        && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      // Caret at the very start of the table. The generic handler below would
      // read this as "start of lines[index]" and merge the header row into
      // whatever sits above, orphaning the rest of the table. Do nothing.
      e.preventDefault()
      return
    }

    // Enter at the end of a ``` line that nothing closes yet: open the block
    // and close it, with the caret on its first code line.
    if (!codeRole && e.key === 'Enter' && !e.shiftKey && isFenceOpenLine(currentDisplay)
        && e.target.selectionStart === actualText.length) {
      e.preventDefault()
      lines.splice(index + 1, 0, leadingSpaces, leadingSpaces + '```')
      onChange(lines.join('\n'))
      setTimeout(() => setFocusedIndex(index + 1), 10)
      return
    }

    // Backspace at the start of the line under a block would join it onto
    // the closing fence. An empty line just goes.
    if (!codeRole && e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0
        && !leadingSpaces.length && index > 0 && codeMap.has(index - 1)) {
      e.preventDefault()
      if (!actualText) {
        lines.splice(index, 1)
        onChange(lines.join('\n'))
        setFocusedIndex(index - 1)
      }
      return
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) return
      e.preventDefault()
      const cursorPos = e.target.selectionStart
      const before = actualText.slice(0, cursorPos)
      const after = actualText.slice(cursorPos)
      const newLineBefore = leadingSpaces + before
      const newLineAfter = leadingSpaces + after
      
      lines[index] = currentApSuf ? newLineBefore.replace(/\s+$/, '') + currentApSuf : newLineBefore
      lines.splice(index + 1, 0, newLineAfter)
      onChange(lines.join('\n'))
      setTimeout(() => setFocusedIndex(index + 1), 10)
      return
    }

    if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      if (leadingSpaces.length > 0) {
        e.preventDefault()
        lines[index] = reindentKeepingAnchor(lines[index], (l) => l.replace(/^( {1,4}|\t)/, ''))
        onChange(lines.join('\n'))
        return
      }
      if (index > 0) {
        e.preventDefault()
        const prevLine = lines[index - 1]
        const suf = extractApBlockSuffix(prevLine)
        const prevDisplay = stripApBlockId(prevLine)
        
        const merged = prevDisplay + actualText
        lines[index - 1] = suf ? merged.replace(/\s+$/, '') + suf : merged
        
        lines.splice(index, 1)
        
        onChange(lines.join('\n'))
        setFocusedIndex(index - 1)
        return
      }
    }

    if (e.key === 'ArrowUp' && index > 0) {
      const ta = e.target
      const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0
      if (atStart) {
        e.preventDefault()
        let nextIndex = index - 1
        while (nextIndex > 0 && blocks[nextIndex]?.isHidden) {
           nextIndex--
        }
        setFocusedIndex(nextIndex)
      }
    }

    if (e.key === 'ArrowDown' && index < lines.length - 1) {
      const ta = e.target
      const len = ta.value.length
      const atEnd = ta.selectionStart === len && ta.selectionEnd === len
      if (atEnd) {
        e.preventDefault()
        let nextIndex = index + 1
        while (nextIndex < lines.length - 1 && blocks[nextIndex]?.isHidden) {
           nextIndex++
        }
        setFocusedIndex(nextIndex)
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      
      const currentIndent = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const prevIndent = index > 0 ? Math.floor((lines[index - 1].match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length / 4) : -1
      const maxAllowed = prevIndent + 1
      
      // A line with text carries its children: it and everything nested under
      // it move together, which is what makes Tab useful for reorganizing.
      //
      // A blank line has no children. It is not the parent of what follows —
      // it just happens to sit above it, usually at indent 0, which made the
      // sweep below collect the entire indented section beneath and drag text
      // the user never touched. So a blank line moves alone.
      //
      // "Blank" is whitespace-only rather than strictly empty, which covers a
      // line that was indented and then emptied, and the indented line Enter
      // opens after a table. The anchor comes off first so a blank line that
      // is someone's link target still reads as blank.
      const isBlankLine = currentDisplay.trim() === ''

      const toIndent = [index]
      if (!isBlankLine) {
        for (let i = index + 1; i < lines.length; i++) {
          const iSpaces = (lines[i].match(/^[ \t]*/) || [''])[0]
          const iIndent = Math.floor(iSpaces.replace(/\t/g, '    ').length / 4)
          if (iIndent > currentIndent) toIndent.push(i)
          else break
        }
      }
      
      if (e.shiftKey) {
        if (currentIndent === 0) return
        toIndent.forEach(i => { lines[i] = reindentKeepingAnchor(lines[i], (l) => l.replace(/^( {1,4}|\t)/, '')) })
      } else {
        if (currentIndent >= maxAllowed) return
        toIndent.forEach(i => { lines[i] = reindentKeepingAnchor(lines[i], (l) => '    ' + l) })
      }
      onChange(lines.join('\n'))
    }
  }, [onChange])

  const handleDragStart = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    e.dataTransfer.setData('text/plain', index.toString())
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((e, blockId) => {
    const targetIndex = idToIndexRef.current.get(blockId)
    if (targetIndex === undefined) return
    e.preventDefault()
    setDragOverIndex(null)
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'))
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return

    let lines = contentRef.current.split('\n')
    
    // Logic for dragging block & children under target block
    const { start: sStart, end: sEnd, indent: sIndent } = getBlockRangeAndIndent(lines, sourceIndex)
    if (targetIndex >= sStart && targetIndex <= sEnd) return // Cannot drop into itself!

    const { indent: tIndent, end: tEnd } = getBlockRangeAndIndent(lines, targetIndex)
    
    // Desired new indent is the target block's indent + 1
    const diffIndent = (tIndent + 1) - sIndent
    const diffSpaces = diffIndent >= 0 ? ' '.repeat(diffIndent * 4) : ''
    
    let extracted = lines.splice(sStart, sEnd - sStart + 1)
    
    extracted = extracted.map(line => {
       const curSpacesMatch = line.match(/^[ \t]*/)
       const curSpaces = curSpacesMatch ? curSpacesMatch[0] : ''
       const curIndent = Math.floor(curSpaces.replace(/\t/g, '    ').length / 4)
       const newIndent = Math.max(0, curIndent + diffIndent)
       return ' '.repeat(newIndent * 4) + line.slice(curSpaces.length)
    })

    const adjustedTEnd = sStart < targetIndex ? tEnd - (sEnd - sStart + 1) : tEnd
    const insertPos = adjustedTEnd + 1

    lines.splice(insertPos, 0, ...extracted)
    onChange(lines.join('\n'))
    setSelectedIndices(new Set())
  }, [onChange])

  // Opening a document link is delegated to App, which owns paper switching.
  // Kept stable via a ref so every <Block/> keeps its memoized props.
  const onOpenDocLinkRef = useRef(onOpenDocLink)
  onOpenDocLinkRef.current = onOpenDocLink
  const handleOpenLink = useCallback((target) => {
    if (target) onOpenDocLinkRef.current?.(target)
  }, [])

  // Transient highlight used when arriving at a line (a link's target, a
  // search result, back/forward), so the reader's eye lands on the right line
  // without the block flipping into edit mode.
  //
  // A line inside a folded section would be invisible, so it is unfolded
  // first: `expandAll` (sidebar search) opens every section in the paper;
  // otherwise only the sections the line sits inside are opened.
  const [revealedIndex, setRevealedIndex] = useState(null)
  const revealTimerRef = useRef(null)
  const revealStepRef = useRef(null)
  const revealBlock = useCallback((index, { expandAll = false, align = 'center' } = {}) => {
    const all = blocksRef.current
    if (index == null || index < 0 || index >= all.length) return
    setSelectedIndices(new Set())
    setFocusedIndex(null)

    let unfolding = false
    if (expandAll) {
      unfolding = all.some((b) => b.isHidden)
      setCollapsedIds(new Set())
    } else if (all[index].isHidden) {
      // Walk up collecting each enclosing line (the nearest one above with a
      // smaller indent), the same parent rule the folding itself uses.
      const parents = []
      let indent = all[index].indentLevel
      for (let j = index - 1; j >= 0 && indent > 0; j--) {
        if (all[j].indentLevel < indent) {
          parents.push(all[j].id)
          indent = all[j].indentLevel
        }
      }
      unfolding = true
      setCollapsedIds((prev) => {
        const next = new Set(prev)
        parents.forEach((k) => next.delete(k))
        return next
      })
    }

    // A table draws all its rows in its first line's block, so a hit on any
    // row lands on the table.
    const bounds = findTableBounds(all.map((b) => b.line), index)
    const target = bounds ? bounds.start : index
    const blockId = all[target].id

    // Clear first so the highlight replays when the same line is revealed
    // twice in a row; wait out the unfold animation (0.3s) before scrolling.
    setRevealedIndex(null)
    clearTimeout(revealStepRef.current)
    clearTimeout(revealTimerRef.current)
    revealStepRef.current = setTimeout(() => {
      setRevealedIndex(target)
      const el = blockId && containerRef.current?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)
      // The outline jumps a heading to the top of the view (its section reads
      // down from there); everything else lands mid-screen.
      if (el) el.scrollIntoView({ behavior: 'smooth', block: align === 'start' ? 'start' : 'center' })
      revealTimerRef.current = setTimeout(() => setRevealedIndex(null), 2400)
    }, unfolding ? 340 : 50)
  }, [])
  useEffect(() => () => { clearTimeout(revealTimerRef.current); clearTimeout(revealStepRef.current) }, [])

  const closeBlockMenu = useCallback(() => setBlockMenu(null), [])

  // ── Draft cards ──────────────────────────────────────────────────
  // The lines to draft from: the multi-selection, else the line being edited
  // or right-clicked. A heading on its own means "this whole section".
  const draftContext = useCallback((indices) => {
    const lines = contentRef.current.split('\n')
    let idx = [...(indices || [])].filter((i) => i >= 0 && i < lines.length).sort((a, b) => a - b)
    if (!idx.length) return null
    const levelOf = (l) => { const m = stripApBlockId(l).trim().match(/^(#{1,6})\s/); return m ? m[1].length : 0 }
    if (idx.length === 1 && levelOf(lines[idx[0]])) {
      const lvl = levelOf(lines[idx[0]])
      let end = idx[0]
      while (end + 1 < lines.length && !(levelOf(lines[end + 1]) && levelOf(lines[end + 1]) <= lvl)) end++
      idx = Array.from({ length: end - idx[0] + 1 }, (_, k) => idx[0] + k)
    }
    const first = idx[0], last = idx[idx.length - 1]
    // Heading path above the first line, outermost first.
    const path = []
    for (let i = first - 1; i >= 0; i--) {
      const lv = levelOf(lines[i])
      if (lv && (!path.length || lv < path[0].lv)) path.unshift({ lv, t: stripApBlockId(lines[i]).trim().replace(/^#+\s*/, '') })
      if (lv === 1) break
    }
    const text = idx.map((i) => stripApBlockId(lines[i])).filter((l) => l.trim()).join('\n')
    // Cards already written in the same section, so drafts don't repeat them.
    let s0 = first, s1 = last
    while (s0 > 0 && !levelOf(lines[s0])) s0--
    while (s1 + 1 < lines.length && !levelOf(lines[s1 + 1])) s1++
    const existing = []
    for (let i = s0; i <= s1; i++) {
      const t = getBlockType(lines[i])
      if ((t === 'basic' || t === 'reversible' || t === 'cloze') && !idx.includes(i)) existing.push(stripApBlockId(lines[i]).trim())
    }
    // Drafts land after the shallowest line drafted from (the last one, if
    // several share that depth), so a selection of a line and its children
    // gets cards at the line's level, and a heading's section gets them after
    // the section. Blank lines don't count: an empty line reads as indent 0.
    const indentOf = (l) => (stripApBlockId(l).match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length
    const filled = idx.filter((i) => stripApBlockId(lines[i]).trim())
    const minIndent = Math.min(...filled.map((i) => indentOf(lines[i])))
    const anchorLine = [...filled].reverse().find((i) => indentOf(lines[i]) === minIndent) ?? last
    return {
      text,
      headingPath: path.map((p) => p.t),
      existing,
      anchorId: lineIdsRef.current.ids[anchorLine],
      label: first === last ? `line ${first + 1}` : `lines ${first + 1}–${last + 1}`,
    }
  }, [])

  const onRequestDraftRef = useRef(onRequestDraft)
  onRequestDraftRef.current = onRequestDraft
  const draftAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    closeBlockMenu()
    const ctx = draftContext(sel)
    if (ctx) onRequestDraftRef.current?.(ctx)
  }, [blockMenu, closeBlockMenu, draftContext])

  // Where a draft group sits: under the line with this id. Accepting moves it
  // down past the lines just inserted, so the next accepted card goes below.
  const [movedDraftAnchor, setMovedDraftAnchor] = useState({ key: null, id: null })
  const draftAnchorId = (movedDraftAnchor.key === draftGroup?.family && movedDraftAnchor.id) || draftGroup?.anchorId || null
  const pendingDraftAnchorRef = useRef(null)
  useEffect(() => {
    const pending = pendingDraftAnchorRef.current
    if (pending == null) return
    pendingDraftAnchorRef.current = null
    if (lineIds[pending.index]) setMovedDraftAnchor({ key: pending.key, id: lineIds[pending.index] })
  }, [lineIds])

  const acceptDrafts = useCallback((ids, overrides = {}) => {
    const group = draftGroup
    if (!group || !ids?.length) return
    const items = group.items.filter((it) => ids.includes(it.id) && !it.busy)
    if (!items.length) return
    const lines = contentRef.current.split('\n')
    let at = idToIndexRef.current.get(draftAnchorId)
    if (at === undefined) at = lines.length - 1
    const place = draftPlacement(lines, at)
    // A blank line being filled may be a link target: its anchor moves onto
    // the card that replaces it rather than being lost.
    const fillSuf = place.fill ? extractApBlockSuffix(lines[at]) : ''
    const inserted = items.map((it, k) => {
      const text = place.indent + (overrides[it.id] ?? it.text) + (k === 0 ? fillSuf : '')
      // Lines drafted from an attached source get an anchor, so App can
      // remember which page they came from ("Go to source").
      if (group.source) {
        const a = ensureApBlockId(text)
        return { id: it.id, line: a.line, blockId: a.blockId, text: overrides[it.id] ?? it.text }
      }
      return { id: it.id, line: text, blockId: null, text: overrides[it.id] ?? it.text }
    })
    const first = place.fill ? at : place.after + 1
    lines.splice(first, place.fill ? 1 : 0, ...inserted.map((x) => x.line))
    pendingDraftAnchorRef.current = { key: group.family, index: first + inserted.length - 1 }
    onChange(lines.join('\n'))
    onDraftAccept?.(inserted)
  }, [draftGroup, draftAnchorId, onChange, onDraftAccept])

  const draftAnchorIndex = draftGroup ? idToIndex.get(draftAnchorId) : undefined
  // The draft box sits where accepted cards will land.
  const draftBoxIndex = useMemo(
    () => (draftAnchorIndex === undefined ? undefined : draftPlacement(content.split('\n'), draftAnchorIndex).after),
    [content, draftAnchorIndex],
  )

  const handleBlockContextMenu = useCallback((e, blockId) => {
    const index = idToIndexRef.current.get(blockId)
    if (index === undefined) return
    e.preventDefault()
    e.stopPropagation()
    // Snapshot the highlighted phrase now: opening the menu moves focus away
    // from the textarea, so reading its selection later is unreliable.
    const input = activeBlockInputRef.current
    const isFocusedBlock = focusedIndexRef.current === index && !!input
    const textSel =
      isFocusedBlock && input.selectionStart !== input.selectionEnd
        ? {
            start: input.selectionStart,
            end: input.selectionEnd,
            text: input.value.slice(input.selectionStart, input.selectionEnd),
          }
        : null
    setSelectedIndices((prev) => {
      const next = prev.has(index) && prev.size > 1 ? new Set(prev) : new Set([index])
      queueMicrotask(() => {
        const sorted = [...next].sort((a, b) => a - b)
        setBlockMenu({ x: e.clientX, y: e.clientY, index, selection: sorted, textSel })
      })
      return next
    })
  }, [])

  // Hand the request up to App, which owns the picker and paper switching.
  const onRequestCreateLinkRef = useRef(onRequestCreateLink)
  onRequestCreateLinkRef.current = onRequestCreateLink
  const createLinkAtMenu = useCallback(() => {
    const menu = blockMenu
    if (!menu?.textSel?.text) return
    closeBlockMenu()
    onRequestCreateLinkRef.current?.({
      phrase: menu.textSel.text,
      index: menu.index,
      selStart: menu.textSel.start,
      selEnd: menu.textSel.end,
    })
  }, [blockMenu, closeBlockMenu])

  /**
   * Write the link into the document in ONE content update:
   *   - anchor the target header when it lives in this same document,
   *   - replace the highlighted phrase with [phrase](ap://…),
   *   - anchor the SOURCE line too, so a future graph can address both ends.
   * Doing it as a single edit avoids a half-applied link if anything throws.
   */
  const insertDocLink = useCallback((opts) => {
    const { index, selStart, selEnd, targetPaperId, targetLineIndex } = opts || {}
    const lines = contentRef.current.split('\n')
    if (index == null || index < 0 || index >= lines.length) return null

    let blockId = opts.targetBlockId || ''
    if (targetLineIndex != null && targetLineIndex >= 0 && targetLineIndex < lines.length
        && targetLineIndex !== index) {
      const anchored = ensureApBlockId(lines[targetLineIndex])
      lines[targetLineIndex] = anchored.line
      blockId = anchored.blockId
    }

    const full = lines[index]
    const apSuffix = extractApBlockSuffix(full)
    const display = stripApBlockId(full)
    const spaces = (display.match(/^[ \t]*/) || [''])[0]
    const body = display.slice(spaces.length)
    // Never let a link swallow the line's markdown marker. Wrapping the "##"
    // of a header (or a bullet's "-") in link syntax would stop the line being
    // a header/bullet at all, so the selection is clamped past the marker.
    const markerMatch = body.match(/^(#{1,6}\s+|[-*]\s+|\d+\.\s+|>\s+)/)
    const markerLen = markerMatch ? markerMatch[0].length : 0
    const from = Math.max(markerLen, Math.min(selStart ?? 0, body.length))
    const to = Math.max(from, Math.min(selEnd ?? 0, body.length))
    const phrase = body.slice(from, to)
    if (!phrase) return null

    const url = buildApUrl(targetPaperId, blockId)
    const newBody = `${body.slice(0, from)}[${phrase}](${url})${body.slice(to)}`
    let newLine = spaces + newBody
    if (apSuffix) newLine = newLine.replace(/\s+$/, '') + apSuffix
    const withSourceAnchor = ensureApBlockId(newLine)
    lines[index] = withSourceAnchor.line

    onChange(lines.join('\n'))
    setFocusedIndex(null)
    return { targetBlockId: blockId, sourceBlockId: withSourceAnchor.blockId }
  }, [onChange])

  const editBlockAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length !== 1) return
    const idx = sel[0]
    const lines = content.split('\n')
    const b = findTableBounds(lines, idx)
    setFocusedIndex(b ? b.start : idx)
    setSelectedIndices(new Set())
    closeBlockMenu()
  }, [blockMenu, closeBlockMenu, content])

  const editTableAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length !== 1) return
    const idx = sel[0]
    const lines = content.split('\n')
    const t = getBlockType(lines[idx] || '')
    if (t !== 'table-row' && t !== 'table-separator') return
    const bounds = findTableBounds(lines, idx)
    if (!bounds) return
    // Lock editing target to this table head so dialog "Apply" updates same table.
    setFocusedIndex(bounds.start)
    setSelectionAnchor(bounds.start)
    setSelectedIndices(new Set([bounds.start]))
    const cols = (parseTableRow(lines[bounds.start]) || []).length
    const rows = Math.max(1, bounds.end - bounds.start)
    onTableEditRequest?.({ rows, cols, mode: 'edit' })
    closeBlockMenu()
  }, [blockMenu, content, onTableEditRequest, closeBlockMenu])

  const goToSourceAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length !== 1) return
    onGoToSource?.({ lineIndex: sel[0] })
    closeBlockMenu()
  }, [blockMenu, onGoToSource, closeBlockMenu])

  const copyBlockAtMenu = useCallback(async () => {
    const sel = blockMenu?.selection
    if (!sel?.length) return
    const lines = content.split('\n')
    const text = [...sel].sort((a, b) => a - b).map((i) => stripApBlockId(lines[i] ?? '')).join('\n')
    
    closeBlockMenu()
    // In QtWebEngine (Anki), navigator.clipboard and window.isSecureContext are
    // both unreliable. Always use the execCommand path; just force focus first.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, ta.value.length) // iOS + QtWebEngine belt-and-suspenders
    try { document.execCommand('copy') } catch (err) { console.error('copy failed', err) }
    document.body.removeChild(ta)
  }, [blockMenu, content, closeBlockMenu])

  /**
   * Insert the clipboard's lines as blocks BELOW the selection.
   *
   * Non-destructive on purpose: it never overwrites what you right-clicked,
   * matching "Duplicate below". Any hidden <!--ap:…--> anchors are stripped so
   * a pasted copy can never claim the same link anchor as the line it came
   * from (Copy strips them too — this is belt-and-braces for text pasted in
   * from elsewhere).
   */
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify

  /** Insert `text` as blocks directly below the last selected block. */
  const pasteLinesBelow = useCallback((text, selection) => {
    const cleaned = String(text || '').replace(/\r\n/g, '\n').replace(/\n+$/, '')
    if (!cleaned || !selection || !selection.length) return false
    const lines = contentRef.current.split('\n')
    const sorted = [...selection].sort((a, b) => a - b)
    const insertAt = Math.min(lines.length, sorted[sorted.length - 1] + 1)
    const pasted = cleaned.split('\n').map((l) => stripApBlockId(l))
    lines.splice(insertAt, 0, ...pasted)
    onChange(lines.join('\n'))
    setSelectedIndices(new Set())
    setFocusedIndex(null)
    return true
  }, [onChange])

  /** Clipboard text via the Qt bridge, falling back to the web API. */
  const readClipboardText = useCallback(async () => {
    let text = ''
    try {
      const res = await getClipboardText()
      text = (res && res.text) || ''
    } catch { /* fall through */ }
    if (!text) {
      try { text = (await navigator.clipboard.readText()) || '' } catch { /* fall through */ }
    }
    return text
  }, [])

  /**
   * Insert already-flattened text at a cursor position captured earlier.
   *
   * `target` is {index, selStart, selEnd} read synchronously at keydown time.
   * It cannot be read here: this runs after an await, by which point focus and
   * the selection may have moved. Content is read from contentRef for the same
   * reason — the `content` prop closed over at render time may be stale.
   */
  const insertFlatTextAtCursor = useCallback((flat, target) => {
    if (!flat || !target) return
    const lines = contentRef.current.split('\n')
    const i = target.index
    if (i < 0 || i >= lines.length) return

    const full = lines[i] ?? ''
    const apSuf = extractApBlockSuffix(full)
    const display = stripApBlockId(full)
    const leadingSpaces = (display.match(/^[ \t]*/) || [''])[0]
    // The block's textarea holds the line WITHOUT its indent (see the
    // `value={actualText}` textarea below), so selStart/selEnd index this
    // string, not the stored line.
    const actualText = display.slice(leadingSpaces.length)

    const before = actualText.slice(0, target.selStart)
    const after = actualText.slice(target.selEnd)
    const merged = leadingSpaces + before + flat + after
    lines[i] = apSuf ? merged.replace(/\s+$/, '') + apSuf : merged
    onChange(lines.join('\n'))

    // Cursor offset is into the textarea's value, which has no indent — so the
    // indent width is deliberately NOT added here.
    const pos = before.length + flat.length
    setFocusedIndex(i)
    scheduleRestoreSelection(activeBlockInputRef, pos, pos)
  }, [onChange])

  /** Fetch the clipboard, flatten it, and put it where the keystroke pointed. */
  const pastePlainText = useCallback(async (target, blocks) => {
    const text = await readClipboardText()
    if (!text) {
      notifyRef.current?.("Couldn't read the clipboard", 'error')
      return
    }
    const flat = normalizePastedText(text)
    if (!flat) return
    if (target) insertFlatTextAtCursor(flat, target)
    else if (blocks && blocks.length) pasteLinesBelow(flat, blocks)
  }, [readClipboardText, insertFlatTextAtCursor, pasteLinesBelow])

  // ── Shift+Ctrl/Cmd+V — paste as plain text, flattened onto one line ──────
  //
  // This deliberately does NOT wait for a `paste` event. Only a chord the
  // engine recognizes as paste fires one, and on macOS that is Cmd+V alone:
  // Cmd+Shift+V produces a keydown and nothing else. The previous approach
  // armed a flag here and read it back inside the paste handler, which made
  // the whole feature a silent no-op on macOS — the flag armed, no event ever
  // arrived, and the safety timer cleared it a second later.
  //
  // Reading the clipboard through the Qt bridge instead removes the
  // dependency on what the engine binds, so this behaves identically on
  // macOS, Windows and Linux.
  const plainPasteGuardRef = useRef(0)
  useEffect(() => {
    const onKey = (e) => {
      if (!((e.key === 'V' || e.key === 'v') && e.shiftKey && (e.ctrlKey || e.metaKey))) return
      e.preventDefault()
      e.stopPropagation()

      // On Windows and Linux this chord IS bound to paste, and preventDefault
      // above already suppresses it. This timestamp is the belt to that
      // braces: a paste event that still slips through within the window
      // below is ignored rather than inserted a second time.
      plainPasteGuardRef.current = Date.now()

      // Captured now, synchronously. The clipboard read that follows is async.
      const idx = focusedIndexRef.current
      const input = activeBlockInputRef.current
      const target = (idx !== null && input)
        ? {
            index: idx,
            selStart: input.selectionStart ?? 0,
            selEnd: input.selectionEnd ?? input.selectionStart ?? 0,
          }
        : null
      const sel = selectedIndicesRef.current
      const blocks = (!target && sel && sel.size) ? [...sel] : null
      if (!target && !blocks) return

      pastePlainText(target, blocks)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pastePlainText])

  /** True when a paste event is the tail of a Shift+V we already handled. */
  const consumePlainPasteGuard = useCallback(() => {
    if (!plainPasteGuardRef.current) return false
    if (Date.now() - plainPasteGuardRef.current > 500) {
      plainPasteGuardRef.current = 0
      return false
    }
    plainPasteGuardRef.current = 0
    return true
  }, [])

  // ⌘V / Ctrl+V with whole blocks selected pastes them below the selection.
  //
  // This listens for the real paste EVENT on the window rather than reading
  // the clipboard on demand: the event carries the data with it, so it works
  // even where programmatic clipboard reads are blocked. It deliberately does
  // nothing while a block's textarea has focus, so ordinary text pasting into
  // a line is untouched.
  const selectedIndicesRef = useRef(selectedIndices)
  selectedIndicesRef.current = selectedIndices
  useEffect(() => {
    const onWindowPaste = (e) => {
      const sel = selectedIndicesRef.current
      if (!sel || sel.size === 0) return
      const active = document.activeElement
      if (active && active.classList && active.classList.contains('block-input')) return
      // Tail of a Shift+Ctrl/Cmd+V we already served from the bridge.
      if (consumePlainPasteGuard()) {
        e.preventDefault()
        return
      }
      const text = e.clipboardData?.getData('text/plain') || ''
      if (!text) return
      e.preventDefault()
      pasteLinesBelow(text, [...sel])
    }
    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [pasteLinesBelow, consumePlainPasteGuard])

  const pasteBlocksAtMenu = useCallback(async () => {
    const sel = blockMenu?.selection
    closeBlockMenu()
    if (!sel?.length) return
    // Reading the clipboard programmatically is unreliable inside Anki's
    // webview, so try the Qt bridge, then the web API, and if neither can
    // read it, SAY so and point at the keystroke — which always works,
    // because a real paste event carries the data with it.
    let text = ''
    try {
      const res = await getClipboardText()
      text = (res && res.text) || ''
    } catch { /* fall through */ }
    if (!text) {
      try { text = (await navigator.clipboard.readText()) || '' } catch { /* fall through */ }
    }
    if (!text) {
      notifyRef.current?.(`Couldn't read the clipboard — press ${PASTE_HINT} instead`, 'error')
      return
    }
    pasteLinesBelow(text, sel)
  }, [blockMenu, closeBlockMenu, pasteLinesBelow])

  // Same as Shift+Ctrl/Cmd+V, reached from the menu instead of the keyboard —
  // so the behavior stays available whatever a platform does with the chord.
  const pastePlainAtMenu = useCallback(async () => {
    const sel = blockMenu?.selection
    const idx = focusedIndexRef.current
    const input = activeBlockInputRef.current
    const target = (idx !== null && input && sel?.includes?.(idx))
      ? {
          index: idx,
          selStart: input.selectionStart ?? 0,
          selEnd: input.selectionEnd ?? input.selectionStart ?? 0,
        }
      : null
    closeBlockMenu()
    if (!target && !sel?.length) return
    await pastePlainText(target, target ? null : sel)
  }, [blockMenu, closeBlockMenu, pastePlainText])

  const duplicateBlockAtMenu = useCallback(() => {
  const sel = blockMenu?.selection
  if (!sel?.length) return
  const lines = content.split('\n')
  const sorted = [...sel].sort((a, b) => a - b)
  
  // FIX: Strip the ID so the new block generates a fresh Anki Note
  const slice = sorted.map((i) => stripApBlockId(lines[i] ?? ''))
  
  const insertAt = sorted[sorted.length - 1] + 1
  lines.splice(insertAt, 0, ...slice)
  onChange(lines.join('\n'))
  setSelectedIndices(new Set())
  setFocusedIndex(null)
  closeBlockMenu()
}, [blockMenu, content, onChange, closeBlockMenu])

  const mergeBlocksAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel || sel.length < 2) return
    const lines = content.split('\n')
    const sorted = [...sel].sort((a, b) => a - b)
    const keep = sorted[0]
    const keepSuf = extractApBlockSuffix(lines[keep] ?? '')
    const merged = sorted.map((i) => stripApBlockId(lines[i] ?? '')).join(' ').replace(/\s+/g, ' ').trim()
    const mergedLine = keepSuf ? merged.replace(/\s+$/, '') + keepSuf : merged
    const toRemove = sorted.slice(1).sort((a, b) => b - a)
    toRemove.forEach((i) => lines.splice(i, 1))
    lines[keep] = mergedLine
    onChange(lines.join('\n'))
    setSelectedIndices(new Set())
    setFocusedIndex(keep)
    closeBlockMenu()
  }, [blockMenu, content, onChange, closeBlockMenu])

  const deleteBlockAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel?.length) return
    const lines = content.split('\n')
    
    let indicesToRemove = new Set()
    sel.forEach(idx => {
       const { start, end } = getBlockRangeAndIndent(lines, idx)
       for (let i = start; i <= end; i++) {
          indicesToRemove.add(i)
       }
    })

    const sortedDesc = [...indicesToRemove].sort((a, b) => b - a)
    sortedDesc.forEach((i) => lines.splice(i, 1))

    if (lines.length === 0) {
      onChange('')
      setFocusedIndex(0)
      setSelectedIndices(new Set())
      closeBlockMenu()
      return
    }

    onChange(lines.join('\n'))
    const minIdx = Math.min(...sel)
    setFocusedIndex(Math.min(minIdx, lines.length - 1))
    setSelectedIndices(new Set())
    closeBlockMenu()
  }, [blockMenu, content, onChange, closeBlockMenu])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || blockMenu) return
      setSelectedIndices((prev) => (prev.size ? new Set() : prev))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blockMenu])

  useEffect(() => {
    if (!blockMenu || !containerRef.current) return
    const el = containerRef.current
    const onScroll = () => closeBlockMenu()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [blockMenu, closeBlockMenu])

  const handlePaste = useCallback(async (e) => {
    const items = Array.from((e.clipboardData ?? e.nativeEvent?.clipboardData)?.items ?? [])
    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault()
        const result = await pasteImage()
        if (result.markdown) {
          const lines = content.split('\n')
          if (focusedIndex !== null) {
            const tableBounds = findTableBounds(lines, focusedIndex)
            const tableHead = tableBounds && tableBounds.start === focusedIndex
            
            let apSuffix = ''
            let fullText = tableHead
              ? lines.slice(tableBounds.start, tableBounds.end + 1).join('\n')
              : (() => {
                  const full = lines[focusedIndex]
                  apSuffix = extractApBlockSuffix(full)
                  return stripApBlockId(full)
                })()

            const spacesMatch = fullText.match(/^[ \t]*/)
            const leadingSpaces = tableHead ? '' : (spacesMatch ? spacesMatch[0] : '')
            let actualText = tableHead ? fullText : fullText.slice(leadingSpaces.length)

            const input = activeBlockInputRef.current
            let selStart = 0
            let selEnd = 0
            if (input && typeof input.selectionStart === 'number') {
              selStart = input.selectionStart
              selEnd = input.selectionEnd
            }

            const before = actualText.slice(0, selStart)
            const after = actualText.slice(selEnd)
            actualText = before + result.markdown + after

            const storeLine = (s) => (apSuffix ? s.replace(/\s+$/, '') + apSuffix : s)
            const newLine = tableHead ? actualText : leadingSpaces + actualText

            if (tableHead) {
              lines.splice(tableBounds.start, tableBounds.end - tableBounds.start + 1, ...newLine.split('\n'))
            } else {
              lines[focusedIndex] = storeLine(newLine)
            }
            
            onChange(lines.join('\n'))
            
            const pos = selStart + result.markdown.length
            scheduleRestoreSelection(activeBlockInputRef, pos, pos)
          } else {
            lines.push(result.markdown)
            onChange(lines.join('\n'))
            setFocusedIndex(lines.length - 1)
          }
        }
        return
      }
    }
    // ── Plain text ───────────────────────────────────────────────────────
    // Only intercept when a block textarea is focused; otherwise let the
    // browser handle it so native undo inside a focused textarea is preserved.
    if (focusedIndex === null) return

    // Shift+Ctrl/Cmd+V is served on keydown, straight from the Qt bridge. On
    // Windows and Linux the chord is also a native paste, so an event can
    // arrive here for a paste that has already been handled — drop it rather
    // than insert the text twice.
    if (consumePlainPasteGuard()) {
      e.preventDefault()
      return
    }

    // Read synchronously. The old code used items.getAsString(), whose
    // callback runs after the event has been dispatched, making the
    // preventDefault() inside it a no-op and risking a double insert.
    const cd = e.clipboardData || e.nativeEvent?.clipboardData
    const pastedText = cd?.getData('text/plain') ?? ''
    if (!pastedText) return

    if (!pastedText.includes('\n')) return // single line: browser handles it
    e.preventDefault()

    const lines = content.split('\n')
    const input = activeBlockInputRef.current
    const cursorPos = input ? input.selectionStart ?? 0 : 0
    const cursorEnd = input ? input.selectionEnd ?? cursorPos : cursorPos

    const full = lines[focusedIndex] ?? ''
    const apSuf = extractApBlockSuffix(full)
    const display = stripApBlockId(full)
    const spacesMatch = display.match(/^[ \t]*/)
    const codeBlkP = codeLineMap(lines).get(focusedIndex)
    const inCodeLine = !!codeBlkP && focusedIndex !== codeBlkP.open && focusedIndex !== codeBlkP.close
    const codeFiP = inCodeLine ? outlineIndent(stripApBlockId(lines[codeBlkP.open])) : ''
    const codeSplitP = inCodeLine ? splitCodeLine(display, codeFiP) : null
    const leadingSpaces = codeSplitP ? codeSplitP.prefix : (spacesMatch ? spacesMatch[0] : '')
    const actualText = display.slice(leadingSpaces.length)

    const beforeCursor = actualText.slice(0, cursorPos)
    const afterCursor = actualText.slice(cursorEnd)

    // Code pasted into a code line: its leading spaces become ➵, measured in
    // the pasted code's own step and added to this line's depth. Pasted
    // Markdown with ``` blocks gets the same conversion inside each block.
    let pastedLines
    let linePrefixes
    if (inCodeLine) {
      const raw = pastedText.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\t/g, ' '.repeat(codeBlkP.step)))
      const widths = raw.slice(1).filter((l) => l.trim()).map((l) => l.length - l.replace(/^ +/, '').length).filter((w) => w > 0)
      const step = widths.length ? Math.min(...widths) : codeBlkP.step
      pastedLines = raw.map((l, k) => (k === 0 ? l : l.replace(/^ +/, '')))
      linePrefixes = raw.map((l) => codePrefix(codeFiP, codeSplitP.depth + Math.floor((l.length - l.replace(/^ +/, '').length) / step)))
    } else {
      pastedLines = arrowsFromSpaces(pastedText.replace(/\r\n?/g, '\n')).split('\n')
      linePrefixes = pastedLines.map(() => leadingSpaces)
    }
    const lastK = pastedLines.length - 1
    // First pasted segment is appended to the current block's text before cursor
    const firstSegment = leadingSpaces + beforeCursor + pastedLines[0]
    // Last pasted segment gets the text that was after the cursor
    const lastSegment = linePrefixes[lastK] + pastedLines[lastK] + afterCursor

    const newLines = [
      apSuf ? firstSegment.replace(/\s+$/, '') + apSuf : firstSegment,
      ...pastedLines.slice(1, -1).map((seg, k) => linePrefixes[k + 1] + seg),
      lastSegment,
    ]

    lines.splice(focusedIndex, 1, ...newLines)
    onChange(lines.join('\n'))
    // Move focus to the end of the last inserted segment
    const newFocusIndex = focusedIndex + newLines.length - 1
    const newCursorPos = inCodeLine
      ? pastedLines[lastK].length
      : leadingSpaces.length + pastedLines[pastedLines.length - 1].length + afterCursor.length
    setTimeout(() => {
      setFocusedIndex(newFocusIndex)
      scheduleRestoreSelection(activeBlockInputRef, newCursorPos, newCursorPos)
    }, 10)
  }, [content, onChange, focusedIndex, consumePlainPasteGuard])

  // Apply formatting to focused block
  const applyFormat = useCallback((action, extra) => {
    if (focusedIndex === null) {
      // No block has been focused yet (e.g. image inserted before clicking
      // into the editor) — fall back to appending at the end instead of
      // silently doing nothing.
      if (action === 'insertImageMd' && extra) {
        const lines = content.split('\n')
        lines.push(extra)
        onChange(lines.join('\n'))
      }
      return
    }
    const lines = content.split('\n')
    const focusedTable = findTableBounds(lines, focusedIndex)
    const tableHead = focusedTable && focusedTable.start === focusedIndex
    let apSuffix = ''
    let fullText = tableHead
      ? lines.slice(focusedTable.start, focusedTable.end + 1).join('\n')
      : (() => {
          const full = lines[focusedIndex]
          apSuffix = extractApBlockSuffix(full)
          return stripApBlockId(full)
        })()
        
    const spacesMatch = fullText.match(/^[ \t]*/)
    const leadingSpaces = tableHead ? '' : (spacesMatch ? spacesMatch[0] : '')
    let line = tableHead ? fullText : fullText.slice(leadingSpaces.length)

    const input = activeBlockInputRef.current
    let selStart = 0
    let selEnd = 0
    if (input && typeof input.selectionStart === 'number') {
      selStart = input.selectionStart
      selEnd = input.selectionEnd
    }

    const storeLine = (s) => (apSuffix ? s.replace(/\s+$/, '') + apSuffix : s)

    const applyWrap = (prefix, suffix, emptyPh) => {
      const r = wrapLineSegment(line, selStart, selEnd, prefix, suffix, emptyPh)
      const newLine = tableHead ? r.line : leadingSpaces + r.line
      if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
      else lines[focusedIndex] = storeLine(newLine)
      onChange(lines.join('\n'))
      scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
    }

    switch (action) {
      case 'strikethrough':
        applyWrap('~~', '~~', 'text')
        return
      case 'inlineCode':
        applyWrap('`', '`', 'code')
        return
      case 'math': {
        const r = wrapLineSegment(line, selStart, selEnd, '$', '$', 'x^2')
        const newLine = tableHead ? r.line : leadingSpaces + r.line
        if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
        else lines[focusedIndex] = storeLine(newLine)
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        return
      }
      // Toggles like Word: wraps the selection, removes the tag if it is
      // already there, and swaps sub <-> sup. Goes through the same
      // leadingSpaces + storeLine path as math, so indentation and the hidden
      // anchor survive.
      case 'bold':
      case 'italic':
      case 'subscript':
      case 'superscript':
      case 'underline': {
        const tag = { bold: 'b', italic: 'i', subscript: 'sub', superscript: 'sup', underline: 'u' }[action]
        const r = toggleTagSegment(line, selStart, selEnd, tag)
        const newLine = tableHead ? r.line : leadingSpaces + r.line
        if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
        else lines[focusedIndex] = storeLine(newLine)
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        return
      }
      case 'cloze': {
        const hasSel = selStart !== selEnd
        if (hasSel) {
          const r = wrapLineSegment(line, selStart, selEnd, '{{', '}}', 'cloze text')
          const newLine = tableHead ? r.line : leadingSpaces + r.line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        } else {
          line = line + ' {{cloze text}}'
          const newLine = tableHead ? line : leadingSpaces + line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
        }
        return
      }
      case 'multiCloze': {
        const next = getNextClozeNumberInLine(line)
        if (selStart !== selEnd) {
          const selected = line.slice(selStart, selEnd)
          const before = line.slice(0, selStart)
          const after = line.slice(selEnd)
          const inserted = `{{c${next}::${selected}}}`
          line = before + inserted + after
          const newLine = tableHead ? line : leadingSpaces + line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          const caret = before.length + inserted.length
          scheduleRestoreSelection(activeBlockInputRef, caret, caret)
        } else {
          const snippet = `{{c${next}::cloze text}}`
          line = line ? `${line} ${snippet}` : snippet
          const newLine = tableHead ? line : leadingSpaces + line
          if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...newLine.split('\n'))
          else lines[focusedIndex] = storeLine(newLine)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
        }
        return
      }
      case 'insertTable': {
        lines.splice(
          focusedIndex + 1,
          0,
          leadingSpaces + '| Column 1 | Column 2 |',
          leadingSpaces + '| --- | --- |',
          leadingSpaces + '| Value 1 | Value 2 |'
        )
        onChange(lines.join('\n'))
        setFocusedIndex(focusedIndex + 1)
        return
      }
      case 'tableApply': {
        const targetRows = Math.max(1, parseInt(extra?.rows || 2, 10))
        const targetCols = Math.max(1, parseInt(extra?.cols || 2, 10))
        const bounds = findTableBounds(lines, focusedIndex ?? 0)
        if (!bounds) {
          const newBlock = [
            `| ${Array.from({ length: targetCols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`,
            `| ${Array.from({ length: targetCols }, () => '---').join(' | ')} |`,
            ...Array.from({ length: Math.max(0, targetRows - 1) }, (_, r) =>
              `| ${Array.from({ length: targetCols }, (_, c) => `Value ${r + 1}.${c + 1}`).join(' | ')} |`
            ),
          ].map(s => leadingSpaces + s)
          const at = focusedIndex !== null ? focusedIndex + 1 : lines.length
          lines.splice(at, 0, ...newBlock)
          onChange(lines.join('\n'))
          setFocusedIndex(at)
          return
        }

        const current = lines.slice(bounds.start, bounds.end + 1).map((ln) => parseTableRow(ln) || [])
        const currentCols = (parseTableRow(lines[bounds.start]) || []).length
        const currentBodyRows = Math.max(0, bounds.end - (bounds.start + 1))
        const rebuilt = []
        const header = Array.from({ length: targetCols }, (_, i) => (
          i < currentCols ? (current[0][i] || `Column ${i + 1}`) : `Column ${i + 1}`
        ))
        rebuilt.push(`| ${header.join(' | ')} |`)
        rebuilt.push(`| ${Array.from({ length: targetCols }, () => '---').join(' | ')} |`)
        for (let r = 0; r < Math.max(0, targetRows - 1); r++) {
          const old = r < currentBodyRows ? current[r + 2] : []
          const row = Array.from({ length: targetCols }, (_, c) => (
            c < currentCols ? (old[c] || `Value ${r + 1}.${c + 1}`) : `Value ${r + 1}.${c + 1}`
          ))
          rebuilt.push(`| ${row.join(' | ')} |`)
        }
        lines.splice(bounds.start, bounds.end - bounds.start + 1, ...rebuilt)
        onChange(lines.join('\n'))
        setFocusedIndex(bounds.start)
        return
      }
      case 'tableAddRow': {
        const bounds = findTableBounds(lines, focusedIndex)
        if (!bounds) return
        const headerCells = parseTableRow(lines[bounds.start]) || []
        const newRow = `| ${headerCells.map((_, i) => `Value ${i + 1}`).join(' | ')} |`
        const insertAt = Math.max(focusedIndex + 1, bounds.start + 2)
        lines.splice(insertAt, 0, newRow)
        onChange(lines.join('\n'))
        setFocusedIndex(insertAt)
        return
      }
      case 'tableAddColumn': {
        const bounds = findTableBounds(lines, focusedIndex)
        if (!bounds) return
        for (let i = bounds.start; i <= bounds.end; i++) {
          const cells = parseTableRow(lines[i])
          if (!cells) continue
          if (i === bounds.start) cells.push(`Column ${cells.length + 1}`)
          else if (i === bounds.start + 1) cells.push('---')
          else cells.push(`Value ${cells.length + 1}`)
          lines[i] = `| ${cells.join(' | ')} |`
        }
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, 0, 0)
        return
      }
      case 'h1': line = '# ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'h2': line = '## ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'h3': line = '### ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'bullet': line = line.startsWith('- ') ? line.slice(2) : '- ' + line; break
      case 'numbered': line = line.match(/^\d+\.\s/) ? line.replace(/^\d+\.\s/, '') : '1. ' + line; break
      case 'blockquote': line = line.startsWith('> ') ? line.slice(2) : '> ' + line; break
      case 'hr':
        lines.splice(focusedIndex + 1, 0, leadingSpaces + '---')
        onChange(lines.join('\n'))
        return
      case 'codeBlock':
        lines.splice(focusedIndex + 1, 0, leadingSpaces + '```', leadingSpaces + '', leadingSpaces + '```')
        onChange(lines.join('\n'))
        setFocusedIndex(focusedIndex + 2)
        return
      case 'basicCard': line = 'Question >> Answer'; break
      case 'reversibleCard': line = 'Term <> Definition'; break
      case 'insertImageMd':
        if (extra) {
          const before = line.slice(0, selStart)
          const after = line.slice(selEnd)
          line = before + extra + after
          const pos = selStart + extra.length
          // `line` was de-indented at the top of applyFormat, so the leading
          // whitespace has to go back on before it is stored -- otherwise the
          // line snaps to the left margin. The clipboard-paste path in
          // handlePaste does the same thing. `pos` is deliberately left alone:
          // the block's textarea holds the de-indented text, so the caret
          // offset is already correct against it.
          lines[focusedIndex] = storeLine(tableHead ? line : leadingSpaces + line)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, pos, pos)
        }
        return
      default: break
    }

    // Every case that reaches here edited the de-indented `line`, so the
    // leading whitespace is restored once for all of them. The card actions
    // replace the line wholesale and still keep their indentation, staying
    // where the cursor was.
    if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...line.split('\n'))
    else lines[focusedIndex] = storeLine(leadingSpaces + line)
    onChange(lines.join('\n'))
    scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
  }, [content, onChange, focusedIndex])

  // Expose applyFormat via ref
  useImperativeHandle(ref, () => ({
    applyFormat,
    getTableContext: () => {
      const lines = content.split('\n')
      const idx = focusedIndex ?? 0
      const bounds = findTableBounds(lines, idx)
      if (!bounds) return null
      const cols = (parseTableRow(lines[bounds.start]) || []).length
      const rows = Math.max(1, bounds.end - bounds.start)
      return { rows, cols }
    },
    focusBlock: (index) => {
      setSelectedIndices(new Set())
      setFocusedIndex(index)
      setTimeout(() => {
        const el = containerRef.current?.children[index]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    },
    revealBlock,
    insertDocLink,
    // What "Draft cards" (toolbar / Ctrl+Shift+D) works on right now.
    getDraftContext: () => {
      if (selectedIndices.size) return draftContext([...selectedIndices])
      if (focusedIndex != null) return draftContext([focusedIndex])
      return null
    },
    // Insert lines under the line with this id (end of its block), giving each
    // an anchor so a source link can be saved for it. Returns their block ids.
    insertLinesAfter: (anchorId, newLines) => {
      const lines = contentRef.current.split('\n')
      let at = idToIndexRef.current.get(anchorId)
      if (at === undefined) at = lines.length - 1
      const end = getBlockRangeAndIndent(lines, at).end
      const anchored = newLines.map((l) => ensureApBlockId(l))
      lines.splice(end + 1, 0, ...anchored.map((a) => a.line))
      onChange(lines.join('\n'))
      return anchored.map((a) => a.blockId)
    },
    // Anchor for a known line (an Ask answer that cites [line N]).
    getAnchorForLine: (index) => {
      const lines = content.split('\n')
      if (index == null || index < 0 || index >= lines.length) return null
      return { anchorId: lineIdsRef.current.ids[index], headingPath: draftContext([index])?.headingPath || [] }
    },
    // Where text drafted from a source panel selection should land: at the
    // line being edited (see draftPlacement), else at the end of the section
    // in view. insertLinesAfter puts text after the anchor line's nested
    // lines, as before.
    getDraftAnchor: (visibleLine) => {
      const lines = content.split('\n')
      if (focusedIndex != null) return { anchorId: lineIdsRef.current.ids[focusedIndex], headingPath: draftContext([focusedIndex])?.headingPath || [] }
      let i = Math.max(0, Math.min(visibleLine ?? 0, lines.length - 1))
      const levelOf = (l) => { const m = stripApBlockId(l).trim().match(/^(#{1,6})\s/); return m ? m[1].length : 0 }
      // A heading with nothing under it before the next heading (a title over
      // its first section): use that first section instead.
      while (levelOf(lines[i]) && i + 1 < lines.length && levelOf(lines[i + 1])) i++
      while (i + 1 < lines.length && !levelOf(lines[i + 1])) i++
      while (i > 0 && !stripApBlockId(lines[i]).trim()) i--
      return { anchorId: lineIdsRef.current.ids[i], headingPath: draftContext([i])?.headingPath || [] }
    },
  }), [applyFormat, content, focusedIndex, selectedIndices, revealBlock, insertDocLink, draftContext, onChange])

  const multiSelectCount = selectedIndices.size

  const handleEditorMouseDown = (e) => {
    // Only capture background clicks, not input or inner elements
    if (e.target.closest('button, a, [role="button"], .block-input, .block-handle, .block-collapse-btn')) return
    if (e.button === 0) {
      setLasso({ startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY })
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setSelectedIndices(new Set())
        setFocusedIndex(null)
      }
    }
  }

  const allLines = useMemo(() => blocks.map(b => b.line), [blocks])
  const showLineNumbers = settings?.show_line_numbers !== false

  // ── Weak spots (Settings → Weak-Spot Markers) ──
  // noteStats comes from Anki's review history, keyed by note id; a card
  // line is weak or a leech when its note's status says so.
  const showWeakMarkers = settings?.weak_spot_markers !== false
  const weakOf = useCallback((b) => {
    if (!showWeakMarkers || b?.noteId == null || !noteStats) return null
    const st = noteStats[String(b.noteId)]
    return st && st.status ? st : null
  }, [showWeakMarkers, noteStats])

  // "Weak lines only" (the bottom-bar button): weak lines plus the headings
  // they sit under, whatever is folded. null when the filter is off.
  const weakVisible = useMemo(() => {
    if (!weakOnly) return null
    const visible = new Set()
    const path = [] // open headings, outermost first: { level, index }
    blocks.forEach((b, i) => {
      if (b.type === 'heading') {
        const level = (b.actualText.match(/^#+/) || ['#'])[0].length
        while (path.length && path[path.length - 1].level >= level) path.pop()
        path.push({ level, index: i })
        return
      }
      if (weakOf(b)) {
        visible.add(i)
        path.forEach((h) => visible.add(h.index))
      }
    })
    return visible
  }, [weakOnly, blocks, weakOf])

  // The draft box goes under the nearest line that is actually drawn. Under
  // a line that isn't (folded away, filtered out, or a table row drawn as
  // part of its table) it would never show. Where the cards land is unchanged.
  const draftBoxRow = useMemo(() => {
    if (draftBoxIndex === undefined) return undefined
    const drawn = (j) => {
      const b = blocks[j]
      if (!b) return false
      if (weakVisible ? !weakVisible.has(j) : b.isHidden) return false
      const tableRow = b.type === 'table-row' || b.type === 'table-separator'
      return !tableRow || isTableHeadRow(allLines, j) || focusedIndex === j
    }
    let j = draftBoxIndex
    while (j > 0 && !drawn(j)) j--
    return j
  }, [draftBoxIndex, blocks, weakVisible, allLines, focusedIndex])

  // ── Weak-spot hover: a weak line's review history, above the line ──
  const [hover, setHover] = useState(null) // { index, rect }
  const hoverOpenTimer = useRef(null)
  const hoverCloseTimer = useRef(null)
  const closeHover = useCallback(() => {
    clearTimeout(hoverOpenTimer.current)
    clearTimeout(hoverCloseTimer.current)
    setHover(null)
  }, [])
  const scheduleHover = (i, el) => {
    clearTimeout(hoverOpenTimer.current)
    const b = blocks[i]
    // Only a line that opens its own box cancels the pending close; moving
    // onto an ordinary line lets the previous box close as normal.
    if (!b || focusedIndex === i || !weakOf(b)) return
    clearTimeout(hoverCloseTimer.current)
    // A short rest before opening, so it doesn't flicker past as you move.
    hoverOpenTimer.current = setTimeout(() => {
      if (el?.isConnected) setHover({ index: i, rect: el.getBoundingClientRect() })
    }, 450)
  }
  const leaveHover = () => {
    clearTimeout(hoverOpenTimer.current)
    clearTimeout(hoverCloseTimer.current)
    hoverCloseTimer.current = setTimeout(() => setHover(null), 160)
  }
  const keepHover = () => clearTimeout(hoverCloseTimer.current)
  // Editing, typing or switching papers closes it.
  useEffect(() => { closeHover() }, [content, closeHover])
  useEffect(() => { if (focusedIndex != null) closeHover() }, [focusedIndex, closeHover])
  useEffect(() => () => { clearTimeout(hoverOpenTimer.current); clearTimeout(hoverCloseTimer.current) }, [])

  // ── Which line is at the top of the view (for the outline's highlight) ──
  const visibleLineRaf = useRef(0)
  const reportVisibleLine = useCallback(() => {
    if (!onVisibleLineChange) return
    cancelAnimationFrame(visibleLineRaf.current)
    visibleLineRaf.current = requestAnimationFrame(() => {
      const box = containerRef.current
      if (!box) return
      const top = box.getBoundingClientRect().top + 24
      for (const el of box.querySelectorAll('[data-line]')) {
        if (el.classList.contains('block-row-hidden')) continue
        if (el.getBoundingClientRect().bottom > top) { onVisibleLineChange(Number(el.dataset.line)); return }
      }
    })
  }, [onVisibleLineChange])
  useEffect(() => { reportVisibleLine() }, [blocks, reportVisibleLine])
  useEffect(() => () => cancelAnimationFrame(visibleLineRaf.current), [])

  return (
    <div className={`block-editor ${showLineNumbers ? 'with-line-numbers' : ''}`} ref={containerRef} onPaste={handlePaste}
      onScroll={() => { if (hover) closeHover(); reportVisibleLine() }}
      onMouseDown={(e) => { closeHover(); handleEditorMouseDown(e) }} onClick={(e) => {
      if ((e.target === containerRef.current || e.target.classList.contains('block-editor-pad')) && selectedIndices.size === 0) {
        const lines = content.split('\n')
        if (lines[lines.length - 1].trim() !== '') {
          onChange(content + '\n')
          setTimeout(() => setFocusedIndex(lines.length), 10)
        } else {
          setFocusedIndex(lines.length - 1)
        }
      }
    }}>
      {blocks.map((b, i) => {
        if (!b.code && (b.type === 'table-row' || b.type === 'table-separator') && !isTableHeadRow(allLines, i)) {
          if (focusedIndex !== i && b.isHidden) return null // Hide nested table rows strictly
          if (focusedIndex !== i) return null
        }
        const bounds = b.code ? null : findTableBounds(allLines, i)
        const isTableHead = !!bounds && bounds.start === i
        const displayLine = isTableHead ? allLines.slice(bounds.start, bounds.end + 1).join('\n') : b.line
        const displayType = isTableHead ? 'table' : b.type
        // The weak-only filter decides visibility on its own (weak lines show
        // even inside folded sections); otherwise folding does.
        const hidden = weakVisible ? !weakVisible.has(i) : b.isHidden
        const weak = weakOf(b)
        return (
          <div key={b.id} data-line={i}
            className={`block-row-wrapper ${hidden ? 'block-row-hidden' : 'stagger-in'}`}
            style={{ animationDelay: `${staggerDelays.get(b.id) ?? 0}ms` }}
            onMouseEnter={(e) => scheduleHover(i, e.currentTarget)}
            onMouseLeave={leaveHover}>
            <div className="block-row-inner">
              {/* The line's real number in the paper (Source view counts the
                  same way), so folded sections leave a gap. */}
              {showLineNumbers && <div className="block-line-number" aria-hidden="true">{i + 1}</div>}
              <Block
                blockId={b.id}
                line={displayLine}
                type={displayType}
                focused={focusedIndex === i}
                isSelected={selectedIndices.has(i)}
                isRevealed={revealedIndex === i}
                dragDisabled={multiSelectCount > 1}
                onRowClick={handleBlockRowClick}
                onChange={handleBlockChange}
                onKeyDown={handleKeyDown}
                mediaDir={mediaDir}
                onImageResize={handleImageResize}
                onTableResize={handleTableResize}
                noteId={(displayType === 'basic' || displayType === 'reversible' || displayType === 'cloze') ? b.noteId : null}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDragOver={dragOverIndex === i}
                onBlockContextMenu={handleBlockContextMenu}
                onOpenLink={handleOpenLink}
                activeBlockInputRef={activeBlockInputRef}
                hasChildren={b.hasChildren}
                isCollapsed={collapsedIds.has(b.id)}
                onToggleCollapse={toggleCollapse}
                blockKey={b.id}
                onZettelSearch={handleZettelSearch}
                weakStatus={weak?.status || null}
                weakLapses={weak?.lapses || 0}
                codeInfo={b.code || null}
                codeActive={!!b.code && focusedIndex !== null && focusedIndex >= b.code.open && focusedIndex <= b.code.close}
              />
              {zettelSearch?.index === i && (
                 <ZettelkastenSearch 
                    query={zettelSearch.query} 
                    selected={zettelSearch.selected} 
                    papers={papers} 
                 />
              )}
            </div>
            {draftGroup && draftBoxRow === i && (
              <DraftGroup group={draftGroup} settings={settings}
                onAccept={acceptDrafts} onDiscard={onDraftDiscard} onRedo={onDraftRedo}
                onEdit={onDraftEdit} onRedraft={onDraftRedraft} onCancel={onDraftCancel} onOpenSettings={onOpenAiSettings} />
            )}
          </div>
        )
      })}
      {draftGroup && draftBoxRow === undefined && (
        <DraftGroup group={draftGroup} settings={settings}
          onAccept={acceptDrafts} onDiscard={onDraftDiscard} onRedo={onDraftRedo}
          onEdit={onDraftEdit} onRedraft={onDraftRedraft} onCancel={onDraftCancel} onOpenSettings={onOpenAiSettings} />
      )}
      <div className="block-editor-pad" />
      {hover && weakOf(blocks[hover.index]) && (
        <WeakSpotHover
          rect={hover.rect}
          stats={weakOf(blocks[hover.index])}
          onEnter={keepHover}
          onLeave={leaveHover}
          onOpenInAnki={() => { openInBrowser(blocks[hover.index].noteId); closeHover() }}
          onUnsuspend={() => { onUnsuspendNote?.(blocks[hover.index].noteId); closeHover() }}
        />
      )}
      {blockMenu && (
        <BlockContextMenu
          x={blockMenu.x}
          y={blockMenu.y}
          menuRef={blockMenuRef}
          onClose={closeBlockMenu}
          onEdit={editBlockAtMenu}
          onCopy={copyBlockAtMenu}
          onPasteBlocks={pasteBlocksAtMenu}
          onPastePlain={pastePlainAtMenu}
          onDuplicate={duplicateBlockAtMenu}
          onMerge={mergeBlocksAtMenu}
          onDelete={deleteBlockAtMenu}
          onEditTable={editTableAtMenu}
          onGoToSource={goToSourceAtMenu}
          canEditTable={(() => {
            const sel = blockMenu.selection
            if (!sel || sel.length !== 1) return false
            const idx = sel[0]
            const lines = content.split('\n')
            return !!findTableBounds(lines, idx)
          })()}
          canGoToSource={blockMenu.selection?.length === 1}
          onCreateLink={createLinkAtMenu}
          canCreateLink={!!blockMenu.textSel?.text}
          createLinkHint={
            blockMenu.textSel?.text
              ? ''
              : 'Click into the line, highlight a phrase, then right-click it'
          }
          selectionCount={blockMenu.selection?.length ?? 1}
          onDraftCards={onRequestDraft ? draftAtMenu : null}
        />
      )}
      {lasso && (
        <div
          className="lasso-selection-box"
          style={{
            position: 'fixed',
            top: Math.min(lasso.startY, lasso.curY),
            left: Math.min(lasso.startX, lasso.curX),
            width: Math.abs(lasso.curX - lasso.startX),
            height: Math.abs(lasso.curY - lasso.startY),
            backgroundColor: 'rgba(116, 185, 255, 0.25)',
            border: '1px solid rgba(116, 185, 255, 0.5)',
            pointerEvents: 'none',
            zIndex: 9999
          }}
        />
      )}
    </div>
  )
})

export default BlockEditor
