import React from 'react'
import { Pencil, Eye, FileDown, FileInput, FileText, PanelRight } from 'lucide-react'

export default function EditorHeader({ title, deckName, decks, viewMode, showSourcePanel, onTitleChange, onDeckChange, onViewChange, onToggleSource, onExportPdf, onExportMarkdown, onImportMarkdown }) {
  return (
    <div className="editor-header">
      <input className="paper-title-input" value={title}
        onChange={e => onTitleChange(e.target.value)} placeholder="Paper Title..." />

      <div className="header-separator" />

      <label className="header-label">Deck:</label>
      <select className="deck-select" value={deckName} onChange={e => onDeckChange(e.target.value)}>
        {decks.map(d => <option key={d} value={d}>{d}</option>)}
        {!decks.includes(deckName) && <option value={deckName}>{deckName}</option>}
      </select>

      <div className="header-separator" />

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

      <div className="header-separator" />

      <button className="header-icon-btn" title="Import Markdown" onClick={onImportMarkdown}>
        <FileInput size={16} />
      </button>
      <button className="header-icon-btn" title="Export Markdown" onClick={onExportMarkdown}>
        <FileText size={16} />
      </button>
      <button className="header-icon-btn" title="Export PDF" onClick={onExportPdf}>
        <FileDown size={16} />
      </button>

      <div className="header-separator" />

      <button
        className={`header-icon-btn ${showSourcePanel ? 'active' : ''}`}
        title="Toggle source panel"
        onClick={onToggleSource}
      >
        <PanelRight size={16} />
      </button>
    </div>
  )
}
