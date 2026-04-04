import React, { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { GripVertical, ExternalLink } from 'lucide-react'
import { openInBrowser, pasteImage } from '../bridge'
import { resolveNoteIdForLine } from '../crossLink'

/**
 * Block Editor — Notion-like editing experience.
 * Each line is a "block" that shows rendered content.
 * Clicking a block makes it editable inline.
 */

// ─── Block type detection ───────────────────────────
function getBlockType(line) {
  const t = line.trim()
  if (!t) return 'empty'
  if (t.match(/^#{1,6}\s/)) return 'heading'
  if (t.match(/^```/)) return 'code-fence'
  if (t.match(/^---$|^\*\*\*$|^___$/)) return 'divider'
  if (t.match(/^>\s/)) return 'blockquote'
  const stripped = t.replace(/^\s*[-*]\s+/, '')
  if (stripped.match(/^.+?\s*<>\s*.+$/)) return 'reversible'
  if (stripped.match(/^.+?\s*>>\s*.+$/)) return 'basic'
  if (t.match(/\{\{.+?\}\}/)) return 'cloze'
  if (t.match(/^!\[/)) return 'image'
  if (t.match(/^\s*[-*]\s+/)) return 'bullet'
  if (t.match(/^\s*\d+\.\s+/)) return 'numbered'
  return 'text'
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
  return r
}

// ─── Rendered block ─────────────────────────────────
function RenderBlock({ line, type, mediaDir, onResize, noteId }) {
  const t = line.trim()

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

  if (type === 'image') {
    // Support ![alt|width](src) syntax (use raw line so filenames stay intact)
    const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
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
function BlockContextMenu({ x, y, menuRef, onClose, onEdit, onCopy, onDuplicate, onDelete }) {
  useEffect(() => {
    let cancelled = false
    const onDocPointer = (e) => {
      if (cancelled) return
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
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
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onEdit}>Edit block</button>
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onCopy}>Copy line</button>
      <button type="button" className="block-context-menu-item" role="menuitem" onClick={onDuplicate}>Duplicate below</button>
      <div className="block-context-menu-sep" />
      <button type="button" className="block-context-menu-item danger" role="menuitem" onClick={onDelete}>Delete block</button>
    </div>
  )
}

// ─── Single Block Component ─────────────────────────
function Block({ index, line, type, focused, onFocus, onChange, onKeyDown, mediaDir, onImageResize, noteId, onDragStart, onDragOver, onDrop, dragOverIndex, onBlockContextMenu, activeBlockInputRef }) {
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

  if (focused) {
    return (
      <div
        className={`block block-editing type-${type}`}
        onContextMenu={(e) => {
          e.preventDefault()
          onBlockContextMenu?.(e, index)
        }}
      >
        <input
          ref={inputRef}
          className="block-input"
          value={line}
          onChange={e => onChange(index, e.target.value)}
          onKeyDown={e => onKeyDown(e, index)}
          spellCheck={false}
        />
      </div>
    )
  }

  return (
    <div 
      className={`block-row ${dragOverIndex === index ? 'drag-over' : ''}`}
      draggable={!focused}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onContextMenu={(e) => {
        e.preventDefault()
        onBlockContextMenu?.(e, index)
      }}
    >
      <div className="block-handle"><GripVertical size={12} /></div>
      <div className={`block type-${type}`} onClick={() => onFocus(index)}>
        <RenderBlock line={line} type={type} mediaDir={mediaDir} onResize={(w) => onImageResize(index, w)} noteId={noteId} />
      </div>
    </div>
  )
}


// ─── Block Editor ───────────────────────────────────
const BlockEditor = forwardRef(function BlockEditor({ content, onChange, onCardCountChange, settings, mediaDir, cardRefs }, ref) {
  const [focusedIndex, setFocusedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [blockMenu, setBlockMenu] = useState(null)
  const containerRef = useRef(null)
  const blockMenuRef = useRef(null)
  const activeBlockInputRef = useRef(null)

  const blocks = useMemo(() => {
    const lines = content.split('\n')
    return lines.map((line) => {
      return { line, type: getBlockType(line) }
    })
  }, [content])

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

  const handleBlockChange = useCallback((index, newValue) => {
    const lines = content.split('\n')
    lines[index] = newValue
    onChange(lines.join('\n'))
  }, [content, onChange])

  const handleFocus = useCallback((index) => {
    setFocusedIndex(index)
  }, [])

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

    if (e.key === 'Enter') {
      e.preventDefault()
      const currentLine = lines[index]
      const cursorPos = e.target.selectionStart
      const before = currentLine.slice(0, cursorPos)
      const after = currentLine.slice(cursorPos)
      lines[index] = before
      lines.splice(index + 1, 0, after)
      onChange(lines.join('\n'))
      // Focus next block
      setTimeout(() => setFocusedIndex(index + 1), 10)
    }

    if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0 && index > 0) {
      e.preventDefault()
      const prevLine = lines[index - 1]
      lines[index - 1] = prevLine + lines[index]
      lines.splice(index, 1)
      onChange(lines.join('\n'))
      setFocusedIndex(index - 1)
    }

    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault()
      setFocusedIndex(index - 1)
    }

    if (e.key === 'ArrowDown' && index < lines.length - 1) {
      e.preventDefault()
      setFocusedIndex(index + 1)
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      lines[index] = '    ' + lines[index]
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

    const lines = content.split('\n')
    const item = lines.splice(sourceIndex, 1)[0]
    lines.splice(targetIndex, 0, item)
    onChange(lines.join('\n'))
  }

  const closeBlockMenu = useCallback(() => setBlockMenu(null), [])

  const handleBlockContextMenu = useCallback((e, index) => {
    e.preventDefault()
    e.stopPropagation()
    setBlockMenu({ x: e.clientX, y: e.clientY, index })
  }, [])

  const menuIndex = blockMenu?.index
  const editBlockAtMenu = useCallback(() => {
    if (menuIndex == null) return
    setFocusedIndex(menuIndex)
    closeBlockMenu()
  }, [menuIndex, closeBlockMenu])

  const copyBlockAtMenu = useCallback(async () => {
    if (menuIndex == null) return
    const lines = content.split('\n')
    const line = lines[menuIndex] ?? ''
    try {
      await navigator.clipboard.writeText(line)
    } catch {
      /* ignore */
    }
    closeBlockMenu()
  }, [menuIndex, content, closeBlockMenu])

  const duplicateBlockAtMenu = useCallback(() => {
    if (menuIndex == null) return
    const lines = content.split('\n')
    const line = lines[menuIndex] ?? ''
    lines.splice(menuIndex + 1, 0, line)
    onChange(lines.join('\n'))
    closeBlockMenu()
  }, [menuIndex, content, onChange, closeBlockMenu])

  const deleteBlockAtMenu = useCallback(() => {
    if (menuIndex == null) return
    const lines = content.split('\n')
    if (lines.length <= 1) {
      onChange('')
      setFocusedIndex(0)
      closeBlockMenu()
      return
    }
    lines.splice(menuIndex, 1)
    onChange(lines.join('\n'))
    setFocusedIndex((fi) => {
      if (fi === null) return null
      if (fi === menuIndex) return Math.min(menuIndex, lines.length - 1)
      if (fi > menuIndex) return fi - 1
      return fi
    })
    closeBlockMenu()
  }, [menuIndex, content, onChange, closeBlockMenu])

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
          const pos = focusedIndex !== null ? focusedIndex + 1 : lines.length
          lines.splice(pos, 0, result.markdown)
          onChange(lines.join('\n'))
          setFocusedIndex(pos)
        }
        return
      }
    }
  }, [content, onChange, focusedIndex])

  // Apply formatting to focused block
  const applyFormat = useCallback((action, extra) => {
    if (focusedIndex === null) return
    const lines = content.split('\n')
    let line = lines[focusedIndex]
    const input = activeBlockInputRef.current
    let selStart = 0
    let selEnd = 0
    if (input && typeof input.selectionStart === 'number') {
      selStart = input.selectionStart
      selEnd = input.selectionEnd
    }

    const applyWrap = (prefix, suffix, emptyPh) => {
      const r = wrapLineSegment(line, selStart, selEnd, prefix, suffix, emptyPh)
      lines[focusedIndex] = r.line
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
        lines[focusedIndex] = r.line
        onChange(lines.join('\n'))
        scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        return
      }
      case 'cloze': {
        const hasSel = selStart !== selEnd
        if (hasSel) {
          const r = wrapLineSegment(line, selStart, selEnd, '{{', '}}', 'cloze text')
          lines[focusedIndex] = r.line
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, r.selStart, r.selEnd)
        } else {
          line = line + ' {{cloze text}}'
          lines[focusedIndex] = line
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
        }
        return
      }
      case 'h1': line = '# ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'h2': line = '## ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'h3': line = '### ' + line.replace(/^#{1,6}\s*/, ''); break
      case 'bullet': line = line.startsWith('- ') ? line.slice(2) : '- ' + line; break
      case 'numbered': line = line.match(/^\d+\.\s/) ? line.replace(/^\d+\.\s/, '') : '1. ' + line; break
      case 'blockquote': line = line.startsWith('> ') ? line.slice(2) : '> ' + line; break
      case 'hr':
        lines.splice(focusedIndex + 1, 0, '---')
        onChange(lines.join('\n'))
        return
      case 'codeBlock':
        lines.splice(focusedIndex + 1, 0, '```', '', '```')
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
          lines[focusedIndex] = line
          onChange(lines.join('\n'))
          scheduleRestoreSelection(activeBlockInputRef, pos, pos)
        }
        return
      default: break
    }

    lines[focusedIndex] = line
    onChange(lines.join('\n'))
    scheduleRestoreSelection(activeBlockInputRef, line.length, line.length)
  }, [content, onChange, focusedIndex])

  // Expose applyFormat via ref
  useImperativeHandle(ref, () => ({
    applyFormat,
    focusBlock: (index) => {
      setFocusedIndex(index)
      setTimeout(() => {
        const el = containerRef.current?.children[index]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }
  }), [applyFormat])

  return (
    <div className="block-editor" ref={containerRef} onPaste={handlePaste} onClick={(e) => {
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
      {blocks.map((b, i) => (
        <Block
          key={i}
          index={i}
          line={b.line}
          type={b.type}
          focused={focusedIndex === i}
          onFocus={handleFocus}
          onChange={handleBlockChange}
          onKeyDown={handleKeyDown}
          mediaDir={mediaDir}
          onImageResize={handleImageResize}
          noteId={(b.type === 'basic' || b.type === 'reversible' || b.type === 'cloze') ? getNoteId(i) : null}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          dragOverIndex={dragOverIndex}
          onBlockContextMenu={handleBlockContextMenu}
          activeBlockInputRef={activeBlockInputRef}
        />
      ))}
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
          onDelete={deleteBlockAtMenu}
        />
      )}
    </div>
  )
})

export default BlockEditor
