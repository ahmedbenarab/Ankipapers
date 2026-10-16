import React, { useEffect, useRef, useState } from 'react'
import { Sparkles, Check, CheckCheck, X, RefreshCw, Loader2, BookOpen, Globe, FileText } from 'lucide-react'

/**
 * AI-drafted card lines waiting under the passage they came from.
 *
 * Drafts are not part of the paper: they aren't saved and Generate never sees
 * them. Accepting one hands its text to the editor, which inserts it as an
 * ordinary line. Click a draft to edit it; Enter saves and accepts it, Escape
 * stops editing.
 */

// One line of card syntax, colored like the editor colors card lines.
// Plain text nodes only -- the model's output is never put into innerHTML.
export function CardSyntax({ text, basicSep = '>>', revSep = '<>' }) {
  const t = text || ''
  if (/\{\{(?:c\d+::)?.+?\}\}/.test(t)) {
    const parts = t.split(/(\{\{(?:c\d+::)?.+?\}\})/g)
    return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="draft-cz">{p}</span> : p))}</>
  }
  for (const [sep, cls] of [[revSep, 'rev'], [basicSep, 'basic']]) {
    const at = sep ? t.indexOf(sep) : -1
    if (at > 0) {
      return <>{t.slice(0, at)} <span className={`draft-sep ${cls}`}>{sep}</span> <span className={`draft-ans ${cls}`}>{t.slice(at + sep.length).trim()}</span></>
    }
  }
  return t
}

const SOURCE_ICON = { pdf: BookOpen, web: Globe }

function DraftLine({ item, settings, onAccept, onDiscard, onRedo, onEdit }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.text)
  const ref = useRef(null)
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus()
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length)
    }
  }, [editing])

  const commit = (accept) => {
    const v = value.replace(/\s*\n+\s*/g, ' ').trim()
    setEditing(false)
    if (!v) return
    if (v !== item.text) onEdit(item.id, v)
    if (accept) onAccept([item.id], { [item.id]: v })
  }

  return (
    <div className={`draft-line ${editing ? 'editing' : ''} ${item.busy ? 'busy' : ''}`}>
      {editing ? (
        <textarea
          ref={ref}
          className="draft-input"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Keep the editor's own shortcuts (select all blocks, undo, ...) out of this box.
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(true) }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false); setValue(item.text) }
          }}
          onBlur={() => commit(false)}
        />
      ) : (
        <span className="draft-text" title="Click to edit" onClick={() => { if (item.busy) return; setValue(item.text); setEditing(true) }}>
          {item.busy ? <><Loader2 size={12} className="spin" /> Redrafting…</> : (
            <CardSyntax text={item.text} basicSep={settings?.basic_separator || '>>'} revSep={settings?.reversible_separator || '<>'} />
          )}
          {item.pageLabel ? <span className="draft-page">{item.pageLabel}</span> : null}
        </span>
      )}
      <span className="draft-actions">
        <button type="button" className="ok" title="Accept (Enter while editing)" disabled={item.busy}
          onMouseDown={(e) => e.preventDefault()} onClick={() => (editing ? commit(true) : onAccept([item.id]))}><Check size={14} /></button>
        <button type="button" title="Discard" onMouseDown={(e) => e.preventDefault()} onClick={() => onDiscard([item.id])}><X size={14} /></button>
        <button type="button" title="Redo this card" disabled={item.busy} onMouseDown={(e) => e.preventDefault()} onClick={() => onRedo(item.id)}><RefreshCw size={13} /></button>
      </span>
    </div>
  )
}

export default function DraftGroup({ group, settings, onAccept, onDiscard, onRedo, onEdit, onRedraft, onCancel, onOpenSettings }) {
  if (!group) return null
  const SrcIcon = group.sourceKind ? (SOURCE_ICON[group.sourceKind] || FileText) : null
  const pending = group.items.length

  if (group.status === 'loading') {
    return (
      <div className="draft-group">
        <div className="draft-head">
          <Loader2 size={14} className="spin" />
          <span className="grow">Drafting cards from {group.label}…</span>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }
  if (group.status === 'error') {
    return (
      <div className="draft-group error">
        <div className="draft-head">
          <X size={14} />
          <span className="grow">{group.error}</span>
          {onOpenSettings && /Settings → AI/.test(group.error || '') ? (
            <button type="button" className="primary" onClick={onOpenSettings}>Open Settings → AI</button>
          ) : (
            <button type="button" onClick={onRedraft}><RefreshCw size={13} /> Try again</button>
          )}
          <button type="button" onClick={onCancel}>Close</button>
        </div>
      </div>
    )
  }
  if (!pending) {
    return (
      <div className="draft-group">
        <div className="draft-head">
          <Sparkles size={14} />
          <span className="grow">{group.accepted ? `${group.accepted} accepted. ` : ''}No drafts left from {group.label}.</span>
          <button type="button" onClick={onCancel}>Close</button>
        </div>
      </div>
    )
  }
  return (
    <div className="draft-group">
      <div className="draft-head">
        <Sparkles size={14} />
        <span className="grow">
          {pending} {pending === 1 ? 'card' : 'cards'} drafted from {SrcIcon ? <SrcIcon size={12} style={{ verticalAlign: '-2px' }} /> : null} {group.label}
          {group.model ? <span className="draft-model"> · {group.model}</span> : null}
        </span>
        <button type="button" className="primary" onClick={() => onAccept(group.items.filter((i) => !i.busy).map((i) => i.id))}><CheckCheck size={14} /> Accept all</button>
        <button type="button" onClick={() => onDiscard(group.items.map((i) => i.id))}><X size={14} /> Discard all</button>
        <button type="button" onClick={onRedraft}><RefreshCw size={13} /> Redraft</button>
      </div>
      {group.items.map((item) => (
        <DraftLine key={item.id} item={item} settings={settings}
          onAccept={onAccept} onDiscard={onDiscard} onRedo={onRedo} onEdit={onEdit} />
      ))}
    </div>
  )
}
