import React, { useEffect, useRef, useState } from 'react'
import { X, Pencil } from 'lucide-react'

// A strip of open papers above the editor, shaped like Chrome's tabs (the
// active one merges into the toolbar below; back/forward live there). Tabs are nothing more than an
// ordered list of paper ids — only one paper is ever loaded in memory, and
// switching tabs goes through the same save-then-load path as the sidebar.
export default function TabBar({
  tabs, papers, activePaperId, activeTitle, activeDirty,
  onSelect, onClose, onRename,
}) {
  // Right-click menu ({ id, x, y }) and the tab whose label is being edited.
  const [menu, setMenu] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  // Mirrors editingId so a blur that fires after Enter/Escape is a no-op.
  const editingRef = useRef(null)
  const startEditing = (id) => { editingRef.current = id; setEditingId(id) }
  const stopEditing = () => { editingRef.current = null; setEditingId(null) }

  const titles = new Map(papers.map((p) => [p.id, p.title]))

  // Tabs have a fixed width and the strip scrolls sideways, so
  // keep the active tab in view when it changes.
  const stripRef = useRef(null)
  useEffect(() => {
    const el = stripRef.current?.querySelector('.tab.active')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activePaperId])

  const hasTabs = tabs.length > 0
  // The strip has no scrollbar, so let an ordinary (vertical) mouse wheel
  // scroll it sideways. Non-passive so the page itself doesn't scroll too.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (strip.scrollWidth <= strip.clientWidth) return
      e.preventDefault()
      strip.scrollLeft += e.deltaY
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [hasTabs]) // the strip isn't rendered while there are no tabs

  const labelFor = (id) => {
    const title = id === activePaperId ? activeTitle : titles.get(id)
    return (title || '').trim() || 'Untitled'
  }

  // Enter or clicking away saves; an empty or unchanged name is ignored.
  const commitRename = () => {
    const id = editingRef.current
    if (id == null) return
    stopEditing()
    const name = draft.trim()
    if (name && name !== labelFor(id)) onRename(id, name)
  }

  // Drop ids for papers that no longer exist (the active one is always shown,
  // even if the papers list hasn't refreshed yet).
  const visible = tabs.filter((id) => id === activePaperId || titles.has(id))
  if (visible.length === 0) return null

  return (
    <div className="tab-bar">
      <div className="tab-strip" role="tablist" ref={stripRef}>
      {visible.map((id) => {
        const active = id === activePaperId
        const dirty = active && activeDirty
        const label = labelFor(id)
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            className={`tab ${active ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
            title={dirty ? `${label} (unsaved changes)` : label}
            onClick={() => { if (!active && editingId !== id) onSelect(id) }}
            onContextMenu={(e) => {
              if (!onRename) return
              e.preventDefault()
              setMenu({ id, x: e.clientX, y: e.clientY })
            }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(id) } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
          >
            {editingId === id ? (
              <input
                className="tab-rename-input"
                value={draft}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                  else if (e.key === 'Escape') { e.preventDefault(); stopEditing() }
                }}
                onBlur={commitRename}
              />
            ) : (
              <span className="tab-label">{label}</span>
            )}
            {/* The dot stands in for the close button until you hover. */}
            <span className="tab-dirty" aria-hidden="true" />
            <button
              className="tab-close"
              title="Close tab"
              aria-label={`Close ${label}`}
              onClick={(e) => { e.stopPropagation(); onClose(id) }}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      </div>

      {menu && (
        <>
          <div className="context-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="context-item" onClick={() => {
              setDraft(labelFor(menu.id) === 'Untitled' ? '' : labelFor(menu.id))
              startEditing(menu.id)
              setMenu(null)
            }}>
              <Pencil size={13} />
              <span>Rename</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
