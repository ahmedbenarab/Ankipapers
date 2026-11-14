import React, { useEffect, useState } from 'react'
import { Tag, ArrowRight } from 'lucide-react'
import { getTagOverrides, setTagOverrides } from '../bridge'
import { cleanTag } from '../qbankTags'

/**
 * A paper's or folder's own tags for the Tag Shortcuts (right-click it in the
 * sidebar). Each shortcut from Settings gets a box; an empty box uses the tag
 * shown faintly in it, which comes from the nearest folder above, else
 * Settings. The paper's own beats its folder's, and a folder's beats the
 * folders above it (core/qbank.py).
 *
 * target: { type: 'paper', id, name } or { type: 'folder', path, name }
 */
export default function TagShortcutsDialog({ target, onClose, onSaved }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = target.type === 'paper' ? { paper_id: target.id } : { folder_path: target.path }

  useEffect(() => {
    let live = true
    getTagOverrides(ask).then((r) => {
      if (!live) return
      if (!r || r.error) setError(r?.error || 'Could not read the tag shortcuts.')
      else setRows(r.rows || [])
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.type, target.id, target.path])

  const submit = async (e) => {
    e.preventDefault()
    if (!rows || busy) return
    const tags = {}
    for (const r of rows) if (cleanTag(r.own)) tags[r.shortcut.toLowerCase()] = cleanTag(r.own)
    setBusy(true)
    const res = await setTagOverrides({ ...ask, tags })
    setBusy(false)
    if (!res || res.error) { setError(res?.error || 'Could not save.'); return }
    onSaved?.()
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <form className="modal tag-overrides-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="modal-title"><Tag size={18} /> Tag shortcuts for “{target.name}”</h3>
        <p className="settings-field-hint">
          Give a shortcut its own tag in this {target.type === 'paper' ? 'paper' : 'folder and the papers in it'}.
          Leave a box empty to use the tag shown in it. Tags change at the next Add to Anki, and
          cards move off the tag they had before.
        </p>
        {rows == null && !error && <p className="settings-field-hint">Loading…</p>}
        {rows && rows.length === 0 && (
          <p className="settings-field-hint">No Tag Shortcuts yet: add them in Settings → Cards.</p>
        )}
        {rows && rows.length > 0 && (
          <div className="tag-shortcuts">
            <div className="tag-shortcuts-head">
              <span>Shortcut</span><span /><span>Tag here</span><span />
            </div>
            {rows.map((r, i) => (
              <div className="tag-shortcuts-row" key={r.shortcut}>
                <span className="tag-overrides-key">{r.shortcut}</span>
                <ArrowRight size={14} className="tag-shortcuts-arrow" aria-hidden="true" />
                <input className="modal-input" value={r.own} placeholder={r.inherited}
                  aria-label={`Tag for ${r.shortcut} here`} spellCheck={false} autoCapitalize="off"
                  autoFocus={i === 0}
                  onChange={(e) => {
                    const own = e.target.value
                    setError('')
                    setRows((all) => all.map((x, j) => (j === i ? { ...x, own } : x)))
                  }} />
                <span />
                <span className="tag-shortcuts-example">
                  {r.shortcut}::3252 <ArrowRight size={11} aria-hidden="true" /> {cleanTag(r.own) || r.inherited}::3252
                </span>
              </div>
            ))}
          </div>
        )}
        {error && <p className="tag-shortcuts-problem" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="modal-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="modal-btn primary" disabled={!rows || busy}>Save</button>
        </div>
      </form>
    </div>
  )
}
