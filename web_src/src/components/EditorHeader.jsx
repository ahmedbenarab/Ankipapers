import React, { useEffect, useRef } from 'react'
import { Pencil, Eye, FileDown, FileInput, FileText, Link2, ChevronLeft, ChevronRight, Sparkles, MessageCircle, Paperclip, BookOpen, Globe, Share } from 'lucide-react'
import FormattingButtons from './FormattingToolbar'

// The one toolbar under the tabs: back/forward, deck picker and formatting
// buttons on the left (the deck picker stretches to fill the row), view
// mode / import-export / panel toggles pinned to the right. The paper is
// renamed from its tab (right-click → Rename), not from here.
export default function EditorHeader({ canBack, canForward, onBack, onForward, deckName, decks, viewMode, showSourcePanel, showLinksPanel, onFormat, onDeckChange, onViewChange, onToggleSource, onToggleLinks, onExportPdf, onExportMarkdown, onImportMarkdown, onShare, aiEnabled = true, onDraftCards, showAskPanel, onToggleAsk, showWebBrowser = false, onToggleWebBrowser, sourceCount = 0, scrollable = false, chapterBar = null }) {
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
          <FileDown size={16} />
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
