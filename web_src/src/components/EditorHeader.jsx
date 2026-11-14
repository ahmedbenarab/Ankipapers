import React, { useEffect, useId, useRef } from 'react'
import { Pencil, Eye, FileInput, FileText, Link2, ChevronLeft, ChevronRight, Sparkles, MessageCircle, Paperclip, BookOpen, Globe, Share } from 'lucide-react'
import FormattingButtons from './FormattingToolbar'

// Lucide has no PDF icon, so this one is drawn to match its icons: a page in
// a 2px outline with a solid "PDF" label across its lower half. The letters
// are cut out of the label rather than painted in a color, so whatever is
// behind the button shows through them in both themes.
function PdfIcon({ size = 16 }) {
  const mask = `pdf-label-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 9.5V4a2 2 0 0 1 2-2h8l5 5v2.5" />
      <path d="M15 2v5h5" />
      <path d="M5 21v.2A.8.8 0 0 0 5.8 22h13.4a.8.8 0 0 0 .8-.8V21" />
      <mask id={mask}>
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <text x="12" y="18.3" textAnchor="middle" fontSize="8.6" fontWeight="800"
          fontFamily="Arial, Helvetica, sans-serif" fill="#000" stroke="none" letterSpacing="0.2">PDF</text>
      </mask>
      <rect x="0.5" y="10.5" width="23" height="10" rx="2" fill="currentColor" stroke="none" mask={`url(#${mask})`} />
    </svg>
  )
}

// The one toolbar under the tabs: back/forward, deck picker and formatting
// buttons on the left (the deck picker stretches to fill the row), view
// mode / import-export / panel toggles pinned to the right. The paper is
// renamed from its tab (right-click → Rename), not from here.
export default function EditorHeader({ canBack, canForward, onBack, onForward, deckName, decks, viewMode, showSourcePanel, showLinksPanel, onFormat, onDeckChange, onViewChange, onToggleSource, onToggleLinks, onExportPdf, onExportMarkdown, onImportMarkdown, onShare, aiEnabled = true, onDraftCards, showAskPanel, onToggleAsk, showWebBrowser = false, onToggleWebBrowser, sourceCount = 0, scrollable = false, chapterBar = null, showFeynman = false, onToggleFeynman = null }) {
  // Settings → Toolbar → Scroll sideways: one row that scrolls instead of
  // wrapping. A mouse wheel scrolls it too, like the tab strip.
  const barRef = useRef(null)
  useEffect(() => {
    const bar = barRef.current
    if (!bar || !scrollable) return
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (bar.scrollWidth <= bar.clientWidth) return
      e.preventDefault()
      bar.scrollLeft += e.deltaY
    }
    bar.addEventListener('wheel', onWheel, { passive: false })
    return () => bar.removeEventListener('wheel', onWheel)
  }, [scrollable])

  return (
    <div className={`editor-toolbar ${scrollable ? 'scrollable' : ''}`} ref={barRef}>
      <button className="header-icon-btn" title="Back (Ctrl+Alt+←)" aria-label="Back"
        disabled={!canBack} onClick={onBack}>
        <ChevronLeft size={16} />
      </button>
      <button className="header-icon-btn" title="Forward (Ctrl+Alt+→)" aria-label="Forward"
        disabled={!canForward} onClick={onForward}>
        <ChevronRight size={16} />
      </button>

      <div className="fmt-sep" />

      <label className="header-label">Deck:</label>
      <select className="deck-select" value={deckName} title={deckName}
        onChange={e => onDeckChange(e.target.value)}>
        {decks.map(d => <option key={d} value={d}>{d}</option>)}
        {!decks.includes(deckName) && <option value={deckName}>{deckName}</option>}
      </select>

      <div className="fmt-sep" />

      <FormattingButtons onFormat={onFormat} />

      {aiEnabled && onDraftCards && (
        <>
          <div className="fmt-sep" />
          <button className="header-ai-btn" title="Draft cards from the selected lines (Ctrl+Shift+D)" onClick={onDraftCards}>
            <Sparkles size={14} />
            <span>Draft cards</span>
          </button>
        </>
      )}

      {/* margin-left: auto pushes this group to the right end, and it wraps
          as one unit when the window is too narrow for a single row. */}
      <div className="editor-toolbar-end">
        <div className="fmt-sep" />

        <div className="view-toggle">
          <button className={`view-toggle-btn ${viewMode === 'blocks' ? 'active' : ''}`}
            onClick={() => onViewChange('blocks')}>
            <Eye size={13} />
            <span>Editor</span>
          </button>
          <button className={`view-toggle-btn ${viewMode === 'source' ? 'active' : ''}`}
            onClick={() => onViewChange('source')}>
            <Pencil size={13} />
            <span>Source</span>
          </button>
        </div>

        <div className="fmt-sep" />

        <button className="header-icon-btn" title="Import Markdown or a shared paper" onClick={onImportMarkdown}>
          <FileInput size={16} />
        </button>
        <button className="header-icon-btn" title="Export Markdown" onClick={onExportMarkdown}>
          <FileText size={16} />
        </button>
        <button className="header-icon-btn" title="Export PDF" onClick={onExportPdf}>
          <PdfIcon size={16} />
        </button>
        {onShare && (
          <button className="header-icon-btn" title="Share this paper with its pictures (.zip)" onClick={onShare}>
            <Share size={16} />
          </button>
        )}

        <div className="fmt-sep" />

        <button
          className={`header-icon-btn ${showLinksPanel ? 'active' : ''}`}
          title="Links to and from this document"
          onClick={onToggleLinks}
        >
          <Link2 size={16} />
        </button>

        {/* Only on a paper that is a chapter of its folder's book or course:
            shows the chapter bar for this paper. Grayed out while Settings →
            Chapter bar shows it on every paper. */}
        {chapterBar && (
          <button
            className={`header-icon-btn ${chapterBar.on ? 'active' : ''}`}
            disabled={chapterBar.global}
            title={chapterBar.global
              ? 'The chapter bar is on for every paper (Settings → Chapter Bar)'
              : chapterBar.on ? 'Hide the chapter bar for this paper' : 'Show the chapter bar for this paper'}
            onClick={chapterBar.onToggle}
          >
            <BookOpen size={16} />
          </button>
        )}

        {aiEnabled && onToggleAsk && (
          <button
            className={`header-icon-btn ${showAskPanel ? 'active' : ''}`}
            title="Ask about this paper (Ctrl+Shift+A)"
            onClick={onToggleAsk}
          >
            <MessageCircle size={16} />
          </button>
        )}

        {/* Settings → AI → Feynman panel: off by default, so the F is only
            here once it's turned on. */}
        {aiEnabled && onToggleFeynman && (
          <button
            className={`header-icon-btn header-feynman-btn ${showFeynman ? 'active' : ''}`}
            title={showFeynman ? 'Close the Feynman panel' : 'Feynman: explain a heading out loud and see how much of it you covered'}
            aria-label="Feynman"
            onClick={onToggleFeynman}
          >
            F
          </button>
        )}

        <button
          className={`header-icon-btn ${showSourcePanel ? 'active' : ''}`}
          title="Sources: files and web pages for this paper"
          onClick={onToggleSource}
        >
          <Paperclip size={16} />
          {sourceCount > 0 && <span className="badge">{sourceCount}</span>}
        </button>

        {onToggleWebBrowser && (
          <button
            className={`header-icon-btn ${showWebBrowser ? 'active' : ''}`}
            title={showWebBrowser ? 'Close the web browser' : 'Open a web browser beside the editor'}
            onClick={onToggleWebBrowser}
          >
            <Globe size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
