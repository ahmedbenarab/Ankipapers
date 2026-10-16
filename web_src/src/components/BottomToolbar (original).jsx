import React from 'react'
import { Save, Zap } from 'lucide-react'

export default function BottomToolbar({ cardCounts, onSave, onGenerate }) {
  const total = (cardCounts?.basic || 0) + (cardCounts?.reversible || 0) + (cardCounts?.cloze || 0)
  const parts = []
  if (cardCounts?.basic) parts.push(`${cardCounts.basic} basic`)
  if (cardCounts?.reversible) parts.push(`${cardCounts.reversible} reversible`)
  if (cardCounts?.cloze) parts.push(`${cardCounts.cloze} cloze`)

  return (
    <div className="bottom-toolbar">
      <span className="card-count">
        {total > 0 ? (
          <>
            <Zap size={13} className="card-count-icon" />
            {total} cards ({parts.join(', ')})
          </>
        ) : (
          <span className="no-cards">No cards detected</span>
        )}
      </span>
      <div className="spacer" />
      <button className="toolbar-btn" onClick={onSave} title="Save (Ctrl+S)">
        <Save size={14} />
        <span>Save</span>
      </button>
      <button className="generate-btn" onClick={onGenerate} title="Generate Cards (Ctrl+G)">
        <Zap size={14} />
        <span>Generate Cards</span>
      </button>
    </div>
  )
}
