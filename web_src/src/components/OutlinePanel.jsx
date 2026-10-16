import React, { useEffect, useRef } from 'react'
import { currentHeadingIndex } from '../outline'

// The open paper's outline in the sidebar (Papers | Outline): its H1–H3
// headings, indented, with the number of cards under each and a dot when that
// section has weak spots (amber) or leeches (red). Click a heading to jump to
// it; the one you are reading is highlighted and kept in view as you scroll.
// (The sidebar's search box above it searches this paper on the Outline tab.)
export default function OutlinePanel({ items, title, totalCards = 0, currentLine, onJump }) {
  const listRef = useRef(null)

  const shown = items || []

  const current = currentHeadingIndex(items || [], currentLine ?? 0)

  useEffect(() => {
    listRef.current?.querySelector('.outline-item.current')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  // Always fills the sidebar's free space (like the folder tree does), so the
  // paper count and Ko-fi card stay at the bottom of the column.
  if (!items) {
    return (
      <div className="outline-panel">
        <div className="outline-empty">Open a paper to see its outline.</div>
      </div>
    )
  }

  return (
    <div className="outline-panel">
      <div className="outline-head">
        <span className="outline-title">{title || 'Untitled'}</span>
        <span>{totalCards} cards</span>
      </div>
      <div className="outline-list" ref={listRef}>
        {items.length === 0 && <div className="outline-empty">No headings yet. Lines starting with #, ## or ### appear here.</div>}
        {shown.map((it) => (
          <button
            key={it.index}
            type="button"
            className={`outline-item h${it.level}${it.index === current ? ' current' : ''}`}
            onClick={() => onJump?.(it.index)}
            title={it.text}
          >
            <span className="outline-text">{it.text}</span>
            {(it.leech || it.weak) && (
              <span className={`outline-dot${it.leech ? ' is-leech' : ''}`}
                title={it.leech ? 'Contains a leech' : 'Contains weak spots'} />
            )}
            {it.cards > 0 && <span className="outline-count">{it.cards}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
