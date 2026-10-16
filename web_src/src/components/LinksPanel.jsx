import React, { useMemo } from 'react'
import { ArrowUpRight, ArrowDownLeft, AlertTriangle, Share2 } from 'lucide-react'
import { collectLinks, backlinksFor, outgoingFrom } from '../docLinks'

/**
 * "What links here", and what this document links out to.
 *
 * Both directions are read off the derived index, which is rebuilt from the
 * markdown — so this can never disagree with what's actually in the text.
 */
export default function LinksPanel({ papers, paperId, onOpenLink, onGoToLine, onOpenGraph, onClose }) {
  const links = useMemo(() => collectLinks(papers), [papers])
  const incoming = useMemo(() => backlinksFor(links, paperId), [links, paperId])
  const outgoing = useMemo(() => outgoingFrom(links, paperId), [links, paperId])

  const renderPhrase = (l) => {
    // Show the sentence the link sits in, with the linked phrase picked out.
    const text = l.sourceLineText.replace(/\[([^\][]+)\]\(ap:\/\/[^)\s]+\)/g, '$1')
    const at = text.indexOf(l.phrase)
    if (at === -1) return <span>{text}</span>
    return (
      <span>
        {text.slice(0, at)}
        <mark className="links-panel-hit">{l.phrase}</mark>
        {text.slice(at + l.phrase.length)}
      </span>
    )
  }

  return (
    <div className="links-panel">
      <div className="links-panel-head">
        <span className="links-panel-title">Links</span>
        <button className="links-panel-graph-btn" onClick={onOpenGraph} title="Open the graph view">
          <Share2 size={13} /> Graph
        </button>
        <button className="links-panel-close" onClick={onClose} title="Close">×</button>
      </div>

      <div className="links-panel-body">
        <div className="links-panel-section">
          <div className="links-panel-section-head">
            <ArrowDownLeft size={12} />
            Linked from ({incoming.length})
          </div>
          {incoming.length === 0 && (
            <div className="links-panel-empty">Nothing links here yet</div>
          )}
          {incoming.map((l) => (
            <button
              key={l.id}
              className="links-panel-item"
              onClick={() => onGoToLine(l.sourcePaperId, l.sourceLineIndex)}
              title={`Go to this line in ${l.sourcePaperTitle}`}
            >
              <div className="links-panel-item-top">{l.sourcePaperTitle}</div>
              <div className="links-panel-item-text">{renderPhrase(l)}</div>
              {l.targetLabel && (
                <div className="links-panel-item-sub">→ {l.targetLabel}</div>
              )}
            </button>
          ))}
        </div>

        <div className="links-panel-section">
          <div className="links-panel-section-head">
            <ArrowUpRight size={12} />
            Links out ({outgoing.length})
          </div>
          {outgoing.length === 0 && (
            <div className="links-panel-empty">This document doesn’t link anywhere yet</div>
          )}
          {outgoing.map((l) => (
            <button
              key={l.id}
              className={`links-panel-item ${l.dangling ? 'is-dangling' : ''}`}
              onClick={() => (l.dangling ? null : onOpenLink(l.rawTarget))}
              title={l.dangling ? 'This target no longer exists' : `Open ${l.targetLabel}`}
            >
              <div className="links-panel-item-top">
                {l.dangling ? (
                  <span className="links-panel-warn"><AlertTriangle size={11} /> missing target</span>
                ) : (
                  <>{l.targetPaperTitle}{l.targetLabel && l.targetLabel !== l.targetPaperTitle ? ` › ${l.targetLabel}` : ''}</>
                )}
              </div>
              <div className="links-panel-item-text">{renderPhrase(l)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
