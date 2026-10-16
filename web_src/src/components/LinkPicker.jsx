import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Search, FileText, CornerDownLeft } from 'lucide-react'
import { buildTargetIndex, searchTargets, targetBreadcrumb } from '../docLinks'

/**
 * Choose what a highlighted phrase should point at.
 *
 * Targets are headers (1st/2nd/3rd degree, shown with their full ancestor
 * chain so duplicates like "Typical" are distinguishable) and whole documents.
 * The index is built from the papers already loaded in memory and memoized on
 * the papers array, so reopening the picker is free.
 */
export default function LinkPicker({ phrase, papers, onPick, onClose }) {
  const [query, setQuery] = useState(phrase || '')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const index = useMemo(() => buildTargetIndex(papers), [papers])
  const results = useMemo(() => searchTargets(index, query), [index, query])

  useEffect(() => { setSelected(0) }, [query])
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  // Keep the highlighted row in view while arrowing through results.
  useEffect(() => {
    const el = listRef.current?.children[selected]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const choose = (t) => {
    if (!t) return
    onPick({
      paperId: t.paperId,
      lineIndex: t.lineIndex,
      isDocument: !!t.isDocument,
      label: t.text,
    })
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[selected]); return }
  }

  return (
    <div className="link-picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="link-picker" role="dialog" aria-label="Create link">
        <div className="link-picker-head">
          <Search size={14} />
          <input
            ref={inputRef}
            className="link-picker-input"
            value={query}
            placeholder="Search headers and documents…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="link-picker-phrase">
          Linking: <span className="link-picker-phrase-text">{phrase}</span>
        </div>

        <div className="link-picker-results" ref={listRef}>
          {results.length === 0 && (
            <div className="link-picker-empty">No matching headers or documents</div>
          )}
          {results.map((t, i) => {
            const crumbs = targetBreadcrumb(t)
            return (
              <div
                key={t.key}
                className={`link-picker-row ${i === selected ? 'is-selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(t) }}
              >
                <span className={`link-picker-badge level-${t.isDocument ? 'doc' : t.level}`}>
                  {t.isDocument ? <FileText size={11} /> : `H${t.level}`}
                </span>
                <span className="link-picker-main">
                  <span className="link-picker-title">{t.text}</span>
                  <span className="link-picker-crumbs">
                    {crumbs.map((c, ci) => (
                      <span key={ci}>
                        {ci > 0 && <span className="link-picker-sep"> › </span>}
                        {c}
                      </span>
                    ))}
                  </span>
                </span>
                {i === selected && <CornerDownLeft size={12} className="link-picker-enter" />}
              </div>
            )
          })}
        </div>

        <div className="link-picker-foot">
          <span>↑↓ to move · Enter to link · Esc to cancel</span>
          <span>{results.length} match{results.length === 1 ? '' : 'es'}</span>
        </div>
      </div>
    </div>
  )
}
