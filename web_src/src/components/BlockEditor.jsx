import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { GripVertical, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { openInBrowser, pasteImage } from '../bridge'
import { resolveNoteIdForLine } from '../crossLink'

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
const AP_BLOCK_ID_TAIL = /\s*<!--ap:[0-9a-f-]{36}-->\s*$/i

function stripApBlockId(line) {
  return (line ?? '').replace(AP_BLOCK_ID_TAIL, '')
}

function extractApBlockSuffix(line) {
  const m = (line ?? '').match(AP_BLOCK_ID_TAIL)
  return m ? m[0] : ''
}

function mergeEditedWithApSuffix(editedBody, originalLine) {
  const suf = extractApBlockSuffix(originalLine)
  if (!suf) return editedBody ?? ''
  return `${(editedBody ?? '').replace(/\s+$/, '')}${suf}`
}

// ─── Block type detection ───────────────────────────
function getBlockType(line) {
  const t = line.trim()
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
  if (stripped.match(/^.+?\s*>>\s*.+$/)) return 'basic'
  if (t.match(/\{\{.+?\}\}/)) return 'cloze'
  if (t.match(/^https?:\/\/[^\s]+$/)) return 'link-preview'
  if (t.match(/^!\[/)) return 'image'
  if (t.match(/^\s*[-*]\s+/)) return 'bullet'
  if (t.match(/^\s*\d+\.\s+/)) return 'numbered'
  return 'text'
}

function parseTableRow(line) {
  const t = (line || '').trim()
  if (!(t.startsWith('|') && t.endsWith('|'))) return null
  return t.slice(1, -1).split('|').map((c) => c.trim())
}

function isTableSeparatorRow(line) {
  const cells = parseTableRow(line)
  if (!cells || cells.length < 2) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

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
function formatInline(text, mediaDir) {
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
    if (mediaDir && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
      src = `file:///${mediaDir}/${src}`
    }
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
  // Cloze numbered
  r = r.replace(/\{\{(c\d+)::(.+?)\}\}/g, '<span class="cloze-badge">$1</span><span class="cloze-text">$2</span>')
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
  // Zettelkasten links
  r = r.replace(/\[\[(.+?)\]\]/g, '<span class="block-zettel-link" data-title="$1">[[$1]]</span>')
  return r
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
function RenderBlock({ line, type, mediaDir, onResize, noteId }) {
  const t = stripApBlockId(line).trim()

  const parseTableCells = (rowLine) => {
    const raw = rowLine.trim().replace(/^\|/, '').replace(/\|$/, '')
    return raw.split('|').map((cell) => cell.trim())
  }

  if (type === 'empty') return <div className="block-spacer" />

  if (type === 'divider') return <hr className="block-divider" />

  if (type === 'heading') {
    const m = t.match(/^(#{1,6})\s+(.+)$/)
    const level = m[1].length
    const Tag = `h${level}`
    return <Tag className={`block-heading block-h${level}`} dangerouslySetInnerHTML={{ __html: formatInline(m[2], mediaDir) }} />
  }

  if (type === 'blockquote') {
    return <blockquote className="block-blockquote" dangerouslySetInnerHTML={{ __html: formatInline(t.slice(2), mediaDir) }} />
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
      let src = m[2]
      if (mediaDir && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
        src = `file:///${mediaDir}/${src}`
      }
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
    return (
      <div>
        {rows.map((row, rowIdx) => {
          if (isTableSeparatorRow(row)) return <div key={rowIdx} className="block-table-separator" />
          const cells = parseTableCells(row)
          return (
            <div key={rowIdx} className="block-table-row">
              {cells.map((cell, idx) => (
                <div key={idx} className="block-table-cell" dangerouslySetInnerHTML={{ __html: formatInline(cell, mediaDir) }} />
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  if (type === 'basic') {
    const content = t.replace(/^\s*[-*]\s+/, '')
    const m = content.match(/^(.+?)\s*>>\s*(.+)$/)
    if (m) return (
      <div className="block-card block-card-basic">
        <div className="block-card-type">
          <span>BASIC</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-card-front" dangerouslySetInnerHTML={{ __html: formatInline(m[1], mediaDir) }} />
        <div className="block-card-sep">▼</div>
        <div className="block-card-back" dangerouslySetInnerHTML={{ __html: formatInline(m[2], mediaDir) }} />
      </div>
    )
  }

  if (type === 'reversible') {
    const content = t.replace(/^\s*[-*]\s+/, '')
    const m = content.match(/^(.+?)\s*<>\s*(.+)$/)
    if (m) return (
      <div className="block-card block-card-reversible">
        <div className="block-card-type reversible">
          <span>REVERSIBLE</span>
          {noteId && (
            <button className="block-card-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
              <ExternalLink size={10} />
            </button>
          )}
        </div>
        <div className="block-card-front" dangerouslySetInnerHTML={{ __html: formatInline(m[1], mediaDir) }} />
        <div className="block-card-sep">⇅</div>
        <div className="block-card-back" dangerouslySetInnerHTML={{ __html: formatInline(m[2], mediaDir) }} />
      </div>
    )
  }

  if (type === 'cloze') {
    return (
      <div className="block-cloze-wrapper">
        <div className="block-cloze" dangerouslySetInnerHTML={{ __html: formatInline(t, mediaDir) }} />
        {noteId && (
          <button className="block-cloze-browser-btn" onClick={(e) => { e.stopPropagation(); openInBrowser(noteId); }}>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    )
  }

  if (type === 'bullet') {
    const m = t.match(/^\s*[-*]\s+(.+)$/)
    return <div className="block-list-item"><span className="block-bullet">•</span><span dangerouslySetInnerHTML={{ __html: formatInline(m[1], mediaDir) }} /></div>
  }

  if (type === 'numbered') {
    const m = t.match(/^\s*(\d+)\.\s+(.+)$/)
    return <div className="block-list-item"><span className="block-num">{m[1]}.</span><span dangerouslySetInnerHTML={{ __html: formatInline(m[2], mediaDir) }} /></div>
  }

  // Default: paragraph
  return <p className="block-paragraph" dangerouslySetInnerHTML={{ __html: formatInline(t, mediaDir) }} />
}


// ─── Block context menu ─────────────────────────────
function BlockContextMenu({
  x,
  y,
  menuRef,
  onClose,
  onEdit,
  onCopy,
  onDuplicate,
  onMerge,
  onDelete,
  onEditTable,
  canEditTable,
  onGoToSource,
  canGoToSource,
  selectionCount,
}) {
  const multi = selectionCount > 1
  useEffect(() => {
    let cancelled = false
    const onDocPointer = (e) => {
      if (cancelled) return
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const raf = requestAnimationFrame(() => {
      if (!cancelled) {
        document.addEventListener('pointerdown', onDocPointer, true)
        document.addEventListener('keydown', onKey, true)
      }
    })
    return () => {
      cancelled = true
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
function syncBlockTextareaHeight(el) {
  if (!el || el.tagName !== 'TEXTAREA') return
  el.style.height = 'auto'
  const max = Math.min(Math.floor(window.innerHeight * 0.55), 520)
  el.style.maxHeight = `${max}px`
  const h = Math.min(el.scrollHeight, max)
  el.style.height = `${h}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

function Block({
  index,
  line,
  type,
  focused,
  isSelected,
  dragDisabled,
  onRowClick,
  onChange,
  onKeyDown,
  mediaDir,
  onImageResize,
  noteId,
  onDragStart,
  onDragOver,
  onDrop,
  dragOverIndex,
  onBlockContextMenu,
  activeBlockInputRef,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
  onZettelSearch,
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
  const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
  const actualText = type !== 'table' ? rawDisplay.slice(leadingSpaces.length) : rawDisplay
  const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
  const indentPx = indentLevel * 24

  return (
    <div
      className={`block-row ${dragOverIndex === index ? 'drag-over' : ''} ${isSelected && !focused ? 'block-row-selected' : ''}`}
      style={{ marginLeft: indentPx }}
      data-index={index}
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
        if (!focused) {
          onRowClick(e, index, type)
        }
      }}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onContextMenu={(e) => {
        e.preventDefault()
        onBlockContextMenu?.(e, index)
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
            <div className="block-collapse-btn" onClick={onToggleCollapse}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
         )}
      </div>
      <div className="block-handle"><GripVertical size={12} /></div>
      <div className="block-bullet-indicator">
         {(type === 'text' || type === 'empty') && <div className="block-dot" />}
      </div>
      <div className={`block type-${type} ${focused ? 'block-editing' : ''} ${focused && isSelected ? 'block-editing-selected' : ''}`}>
        {focused ? (
          <textarea
            ref={inputRef}
            className="block-input block-input-textarea"
            value={actualText}
            rows={1}
            wrap="soft"
            spellCheck={false}
            autoComplete="off"
            onChange={e => {
              const val = type !== 'table' ? leadingSpaces + e.target.value : e.target.value
              onChange(index, mergeEditedWithApSuffix(val, line))
              if (onZettelSearch) {
                const selStart = e.target.selectionStart
                const textBefore = e.target.value.slice(0, selStart)
                const lastO = textBefore.lastIndexOf('[[')
                const lastC = textBefore.lastIndexOf(']]')
                if (lastO !== -1 && lastO > lastC) {
                  onZettelSearch(index, textBefore.slice(lastO + 2))
                } else {
                  onZettelSearch(index, null)
                }
              }
            }}
            onInput={(e) => syncBlockTextareaHeight(e.target)}
            onKeyDown={e => onKeyDown(e, index)}
          />
        ) : (
          <RenderBlock line={actualText} type={type} mediaDir={mediaDir} onResize={(w) => onImageResize(index, w)} noteId={noteId} />
        )}
      </div>
    </div>
  )
}


function getBlockRangeAndIndent(lines, idx) {
  const spaces = (lines[idx].match(/^[ \t]*/) || [''])[0]
  const indent = Math.floor(spaces.replace(/\t/g, '    ').length / 4)
  let end = idx
  while (end + 1 < lines.length) {
    const nextIndent = Math.floor((lines[end + 1].match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length / 4)
    if (nextIndent > indent) end++
    else break
  }
  return { start: idx, end, indent }
}

// ─── Block Editor ───────────────────────────────────
const BlockEditor = forwardRef(function BlockEditor({ content, onChange, onCardCountChange, settings, mediaDir, cardRefs, onTableEditRequest, onGoToSource, papers = [] }, ref) {
  const [focusedIndex, setFocusedIndex] = useState(null)
  const [selectedIndices, setSelectedIndices] = useState(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [blockMenu, setBlockMenu] = useState(null)
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set())
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
          const idx = parseInt(child.dataset.index)
          if (!isNaN(idx)) nextSelection.add(idx)
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

  const toggleCollapse = useCallback((e, key) => {
    e.stopPropagation()
    setFocusedIndex(null)
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const blocks = useMemo(() => {
    const lines = content.split('\n')
    const parsed = lines.map((line) => {
      const type = getBlockType(line)
      const rawDisplay = stripApBlockId(line)
      const spacesMatch = type !== 'table' ? rawDisplay.match(/^[ \t]*/) : null
      const leadingSpaces = spacesMatch ? spacesMatch[0] : ''
      const actualText = type !== 'table' ? rawDisplay.slice(leadingSpaces.length) : rawDisplay
      const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '    ').length / 4)
      const key = `${indentLevel}:${actualText.trim()}`
      return { line, type, key, indentLevel, actualText }
    })

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

        if (hasChildren && collapsedKeys.has(current.key)) {
            for (let j = i + 1; j < parsed.length; j++) {
                if (parsed[j].indentLevel <= current.indentLevel) break
                hiddenIndices.add(j)
            }
        }
    }
    
    parsed.forEach((b, i) => { b.isHidden = hiddenIndices.has(i) })
    
    return parsed
  }, [content, collapsedKeys])

  // Update card counts
  useEffect(() => {
    onCardCountChange(countCards(blocks))
  }, [blocks])

  const getNoteId = useCallback(
    (index) => {
      const lines = content.split('\n')
      const lineText = lines[index] ?? ''
      return resolveNoteIdForLine(index, lineText, cardRefs)
    },
    [content, cardRefs]
  )

  const handleZettelSearch = useCallback((index, query) => {
    if (query !== null) {
      setZettelSearch(prev => (prev?.index === index && prev?.query === query) ? prev : { index, query, selected: 0 })
    } else {
      setZettelSearch(null)
    }
  }, [])

  const handleBlockChange = useCallback((index, newValue) => {
    const lines = content.split('\n')
    const b = findTableBounds(lines, index)
    if (b && b.start === index) {
      lines.splice(b.start, b.end - b.start + 1, ...newValue.split('\n'))
    } else {
      lines[index] = newValue
    }
    onChange(lines.join('\n'))
  }, [content, onChange])

  const handleBlockRowClick = useCallback((e, index) => {
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
      const anchor = selectionAnchor !== null ? selectionAnchor : focusedIndex
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
    const lines = content.split('\n')
    const b = findTableBounds(lines, index)
    const targetIndex = b ? b.start : index
    setSelectedIndices(new Set())
    setSelectionAnchor(targetIndex)
    setFocusedIndex(targetIndex)
  }, [selectionAnchor, focusedIndex, content])

  const handleImageResize = useCallback((index, newWidth) => {
    const lines = content.split('\n')
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
  }, [content, onChange])

  const handleKeyDown = useCallback((e, index) => {
    const lines = content.split('\n')

    const currentLine = lines[index]
    const currentApSuf = extractApBlockSuffix(currentLine)
    const currentDisplay = stripApBlockId(currentLine)
    const currentSpacesMatch = currentDisplay.match(/^[ \t]*/)
    const leadingSpaces = currentSpacesMatch ? currentSpacesMatch[0] : ''
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
        lines[index] = currentApSuf ? (lines[index].replace(/^( {1,4}|\t)/, '')).replace(/\s+$/, '') + currentApSuf : lines[index].replace(/^( {1,4}|\t)/, '')
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
        
        if (actualText.trim() === '') {
           const { start, end } = getBlockRangeAndIndent(lines, index)
           lines.splice(start, end - start + 1)
        } else {
           lines.splice(index, 1)
        }
        
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
      
      const toIndent = [index]
      for (let i = index + 1; i < lines.length; i++) {
        const iSpaces = (lines[i].match(/^[ \t]*/) || [''])[0]
        const iIndent = Math.floor(iSpaces.replace(/\t/g, '    ').length / 4)
        if (iIndent > currentIndent) toIndent.push(i)
        else break
      }
      
      if (e.shiftKey) {
        if (currentIndent === 0) return
        toIndent.forEach(i => {
           const iApSuf = extractApBlockSuffix(lines[i])
           lines[i] = iApSuf ? (lines[i].replace(/^( {1,4}|\t)/, '')).replace(/\s+$/, '') + iApSuf : lines[i].replace(/^( {1,4}|\t)/, '')
        })
      } else {
        if (currentIndent >= maxAllowed) return
        toIndent.forEach(i => {
           const iApSuf = extractApBlockSuffix(lines[i])
           lines[i] = iApSuf ? ('    ' + lines[i]).replace(/\s+$/, '') + iApSuf : '    ' + lines[i]
        })
      }
      onChange(lines.join('\n'))
    }
  }, [content, onChange])

  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index.toString())
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (e, targetIndex) => {
    e.preventDefault()
    setDragOverIndex(null)
    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'))
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return

    let lines = content.split('\n')
    
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
  }

  const closeBlockMenu = useCallback(() => setBlockMenu(null), [])

  const handleBlockContextMenu = useCallback((e, index) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedIndices((prev) => {
      const next = prev.has(index) && prev.size > 1 ? new Set(prev) : new Set([index])
      queueMicrotask(() => {
        const sorted = [...next].sort((a, b) => a - b)
        setBlockMenu({ x: e.clientX, y: e.clientY, index, selection: sorted })
      })
      return next
    })
  }, [])

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
    const text = [...sel].sort((a, b) => a - b).map((i) => lines[i] ?? '').join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
    closeBlockMenu()
  }, [blockMenu, content, closeBlockMenu])

  const duplicateBlockAtMenu = useCallback(() => {
    const sel = blockMenu?.selection
    if (!sel?.length) return
    const lines = content.split('\n')
    const sorted = [...sel].sort((a, b) => a - b)
    const slice = sorted.map((i) => lines[i])
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
    const items = (e.clipboardData || e.originalEvent.clipboardData).items
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
  }, [content, onChange, focusedIndex])

  // Apply formatting to focused block
  const applyFormat = useCallback((action, extra) => {
    if (focusedIndex === null) return
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
      case 'bold':
        applyWrap('**', '**', 'text')
        return
      case 'italic':
        applyWrap('*', '*', 'text')
        return
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
          lines[focusedIndex] = storeLine(line)
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, pos, pos)
        }
        return
      default: break
    }

    if (tableHead) lines.splice(focusedTable.start, focusedTable.end - focusedTable.start + 1, ...line.split('\n'))
    else lines[focusedIndex] = storeLine(line)
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
    }
  }), [applyFormat, content, focusedIndex])

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

  return (
    <div className="block-editor" ref={containerRef} onPaste={handlePaste} onMouseDown={handleEditorMouseDown} onClick={(e) => {
      if (e.target === containerRef.current || e.target.classList.contains('block-editor-pad')) {
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
        if ((b.type === 'table-row' || b.type === 'table-separator') && !isTableHeadRow(blocks.map(x => x.line), i)) {
          if (focusedIndex !== i && b.isHidden) return null // Hide nested table rows strictly
          if (focusedIndex !== i) return null
        }
        const bounds = findTableBounds(blocks.map(x => x.line), i)
        const isTableHead = !!bounds && bounds.start === i
        const displayLine = isTableHead ? blocks.slice(bounds.start, bounds.end + 1).map(x => x.line).join('\n') : b.line
        const displayType = isTableHead ? 'table' : b.type
        return (
          <div key={i} className={`block-row-wrapper ${b.isHidden ? 'block-row-hidden' : 'stagger-in'}`} style={{ animationDelay: `${Math.min((i % 40) * 25, 800)}ms` }}>
            <div className="block-row-inner">
              <Block
                index={i}
                line={displayLine}
                type={displayType}
                focused={focusedIndex === i}
                isSelected={selectedIndices.has(i)}
                dragDisabled={multiSelectCount > 1}
                onRowClick={handleBlockRowClick}
                onChange={handleBlockChange}
                onKeyDown={handleKeyDown}
                mediaDir={mediaDir}
                onImageResize={handleImageResize}
                noteId={(displayType === 'basic' || displayType === 'reversible' || displayType === 'cloze') ? getNoteId(i) : null}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                dragOverIndex={dragOverIndex}
                onBlockContextMenu={handleBlockContextMenu}
                activeBlockInputRef={activeBlockInputRef}
                hasChildren={b.hasChildren}
                isCollapsed={collapsedKeys.has(b.key)}
                onToggleCollapse={(e) => toggleCollapse(e, b.key)}
                onZettelSearch={handleZettelSearch}
              />
              {zettelSearch?.index === i && (
                 <ZettelkastenSearch 
                    query={zettelSearch.query} 
                    selected={zettelSearch.selected} 
                    papers={papers} 
                 />
              )}
            </div>
          </div>
        )
      })}
      <div className="block-editor-pad" />
      {blockMenu && (
        <BlockContextMenu
          x={blockMenu.x}
          y={blockMenu.y}
          menuRef={blockMenuRef}
          onClose={closeBlockMenu}
          onEdit={editBlockAtMenu}
          onCopy={copyBlockAtMenu}
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
          selectionCount={blockMenu.selection?.length ?? 1}
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
