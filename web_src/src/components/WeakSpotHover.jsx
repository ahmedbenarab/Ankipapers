import React, { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ExternalLink, PlayCircle } from 'lucide-react'

// The review history of a weak line, opened ABOVE it when you rest the pointer
// on it (Settings → Weak-Spot Markers). Portaled to <body> and placed against
// the line's on-screen rectangle so the editor's scrolling can't clip it; a
// line at the very top of the window has no room above, so it opens below.

const GAP = 6
const EDGE = 8
const EASE_LABEL = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

function dueText(s) {
  if (s.suspended) return 'Suspended'
  const d = s.next_due_days
  if (d == null) return s.is_new ? 'Not studied yet' : '—'
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? '' : 's'}`
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `In ${d} days`
}

function lastReviewText(s) {
  if (!s.last_review) return 'Never'
  const date = new Date(s.last_review * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return s.last_ease ? `${date} · ${EASE_LABEL[s.last_ease] || ''}` : date
}

export default function WeakSpotHover({ rect, stats, onEnter, onLeave, onOpenInAnki, onUnsuspend }) {
  const ref = useRef(null)

  // Measured first, then placed directly on the element.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight, w = el.offsetWidth
    let top = rect.top - GAP - h
    if (top < EDGE) top = rect.bottom + GAP
    el.style.top = `${top}px`
    el.style.left = `${Math.max(EDGE, Math.min(rect.left + 40, window.innerWidth - w - EDGE))}px`
    el.style.visibility = 'visible'
  }, [rect, stats])

  return createPortal(
    <div ref={ref} className={`hover-box hover-weak is-${stats.status}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="hover-weak-title">
        <AlertTriangle size={13} />
        {stats.status === 'leech' ? 'Leech — Anki has suspended this card' : `Struggling — ${stats.lapses} lapses`}
      </div>
      <div className="hover-weak-row"><span>Pressed Again</span><b>{stats.again} of {stats.reviews} reviews</b></div>
      {stats.ease ? <div className="hover-weak-row"><span>Ease</span><b>{stats.ease}%</b></div> : null}
      <div className="hover-weak-row"><span>Last review</span><b>{lastReviewText(stats)}</b></div>
      <div className="hover-weak-row"><span>Next due</span><b>{dueText(stats)}</b></div>
      {stats.status === 'leech' && (
        <div className="hover-weak-row"><span>Tip</span><b>Split it into smaller cards</b></div>
      )}
      <div className="hover-weak-actions">
        <button type="button" onClick={onOpenInAnki}><ExternalLink size={12} /> Open in Anki</button>
        {stats.suspended && (
          <button type="button" onClick={onUnsuspend}><PlayCircle size={12} /> Unsuspend</button>
        )}
      </div>
    </div>,
    document.body,
  )
}
