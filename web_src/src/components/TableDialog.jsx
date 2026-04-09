import React, { useEffect, useState } from 'react'
import { Table2 } from 'lucide-react'

export default function TableDialog({ initialRows = 2, initialCols = 2, mode = 'insert', onApply, onClose }) {
  const [rows, setRows] = useState(Math.max(1, initialRows || 2))
  const [cols, setCols] = useState(Math.max(1, initialCols || 2))

  useEffect(() => {
    setRows(Math.max(1, initialRows || 2))
    setCols(Math.max(1, initialCols || 2))
  }, [initialRows, initialCols, mode])

  const submit = (e) => {
    e.preventDefault()
    onApply?.({ rows: Math.max(1, rows), cols: Math.max(1, cols), mode })
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="modal-title">
          <Table2 size={18} />
          {mode === 'edit' ? 'Edit Table' : 'Insert Table'}
        </h3>
        <label className="settings-label">Rows</label>
        <input
          className="modal-input"
          type="number"
          min="1"
          value={rows}
          onChange={(e) => setRows(parseInt(e.target.value || '1', 10))}
        />
        <label className="settings-label">Columns</label>
        <input
          className="modal-input"
          type="number"
          min="1"
          value={cols}
          onChange={(e) => setCols(parseInt(e.target.value || '1', 10))}
        />
        <div className="modal-actions">
          <button type="button" className="modal-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="modal-btn primary">{mode === 'edit' ? 'Apply' : 'Insert'}</button>
        </div>
      </form>
    </div>
  )
}
