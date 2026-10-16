import React from 'react'
import { Zap, AlertTriangle, CheckCircle2 } from 'lucide-react'

/**
 * "Generate all cards in folder" — every screen except the conflict choice,
 * which reuses GenerateConflictModal. App.jsx drives it through `state`:
 *
 *   { phase: 'empty',    folder }
 *   { phase: 'confirm',  folder, papers, includesSubfolders }
 *   { phase: 'checking', folder, index, total }           // conflict check
 *   { phase: 'running',  folder, index, total, title }    // generating
 *   { phase: 'done',     folder, total, created, updated, deleted, failures }
 *
 * While checking or running there are no buttons and clicking outside does
 * nothing: the window must stay open until every paper is written.
 */
export default function FolderGenerateDialog({ state, onConfirm, onClose }) {
  if (!state) return null
  const folderName = state.folder.split('/').pop()
  const busy = state.phase === 'checking' || state.phase === 'running'
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal folder-gen-modal" onClick={(e) => e.stopPropagation()}>
        {state.phase === 'empty' && (
          <>
            <div className="modal-title"><Zap size={18} /> Generate all cards in folder</div>
            <p className="folder-gen-text">“{folderName}” has no papers.</p>
            <div className="generate-conflict-actions">
              <button type="button" className="modal-btn primary" onClick={onClose}>OK</button>
            </div>
          </>
        )}

        {state.phase === 'confirm' && (
          <>
            <div className="modal-title"><Zap size={18} /> Generate all cards in folder</div>
            <p className="folder-gen-text">
              Generate cards for {plural(state.papers.length, 'paper')} in “{folderName}”
              {state.includesSubfolders ? ', including subfolders' : ''}?
            </p>
            <div className="generate-conflict-actions">
              <button type="button" className="modal-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="modal-btn primary" onClick={onConfirm}>Generate</button>
            </div>
          </>
        )}

        {busy && (
          <>
            <div className="modal-title"><Zap size={18} /> Generating “{folderName}”</div>
            <p className="folder-gen-status">
              {state.phase === 'checking'
                ? `Checking for edits in Anki… ${state.index + 1} of ${state.total}`
                : `Generating ${state.index + 1} of ${state.total}: ${state.title}`}
            </p>
            <div className="folder-gen-bar" role="progressbar"
              aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.index}>
              <div
                className={`folder-gen-fill ${state.phase === 'checking' ? 'is-checking' : ''}`}
                style={{ width: `${(state.index / Math.max(1, state.total)) * 100}%` }}
              />
            </div>
            <p className="folder-gen-warning">
              <AlertTriangle size={14} /> Do Not Close AnkiPapers While Cards Are Being Generated.
            </p>
          </>
        )}

        {state.phase === 'done' && (
          <>
            <div className="modal-title">
              {state.failures.length
                ? <><AlertTriangle size={18} style={{ color: 'var(--orange)' }} /> Finished with problems</>
                : <><CheckCircle2 size={18} style={{ color: 'var(--green)' }} /> Done</>}
            </div>
            <p className="folder-gen-text">
              Done: {state.created} created, {state.updated} updated, {state.deleted} removed
              {' '}across {plural(state.total - state.failures.length, 'paper')}.
            </p>
            {state.failures.length > 0 && (
              <>
                <p className="folder-gen-text">
                  {plural(state.failures.length, 'paper')} could not be generated:
                </p>
                <ul className="generate-conflict-list">
                  {state.failures.map((f) => (
                    <li key={f.id}><strong>{f.title}</strong> — {f.reason}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="generate-conflict-actions">
              <button type="button" className="modal-btn primary" onClick={onClose}>OK</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
