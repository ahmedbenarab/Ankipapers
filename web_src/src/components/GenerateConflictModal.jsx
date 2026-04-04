import React from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * Shown when the paper line text is unchanged but Anki note fields were edited in Browse/Editor.
 */
export default function GenerateConflictModal({ conflicts, onCancel, onKeepAnki, onUsePaper }) {
  const n = conflicts?.length ?? 0
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal generate-conflict-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <AlertTriangle size={18} style={{ color: 'var(--orange)' }} />
          Cards edited in Anki
        </div>
        <p className="generate-conflict-intro">
          {n === 1
            ? 'One synced line still matches your paper, but its Anki note no longer matches (likely edited in Browse or the note editor).'
            : `${n} synced lines still match your paper, but their Anki notes no longer match.`}{' '}
          Choose how to continue.
        </p>
        <ul className="generate-conflict-list">
          {conflicts.map((c, i) => (
            <li key={`${c.anki_note_id}-${c.line_index}-${i}`}>
              <span className="generate-conflict-type">{c.card_type}</span>
              line {c.line_index + 1}
              {c.block_id ? <span className="generate-conflict-id"> · block {c.block_id.slice(0, 8)}…</span> : null}
              <span className="generate-conflict-nid"> · nid:{c.anki_note_id}</span>
            </li>
          ))}
        </ul>
        <div className="generate-conflict-actions">
          <button type="button" className="modal-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="modal-btn" onClick={onKeepAnki}>
            Keep Anki edits
          </button>
          <button type="button" className="modal-btn primary" onClick={onUsePaper}>
            Use paper text
          </button>
        </div>
      </div>
    </div>
  )
}
