import React from 'react'
import { Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Minus, Braces, ChevronsRight, ArrowLeftRight, Image, Sigma, Table2, Rows3, Columns3 } from 'lucide-react'

const buttons = [
  { action: 'bold', icon: Bold, title: 'Bold (Ctrl+B)' },
  { action: 'italic', icon: Italic, title: 'Italic (Ctrl+I)' },
  { action: 'strikethrough', icon: Strikethrough, title: 'Strikethrough' },
  { action: 'inlineCode', icon: Code, title: 'Inline Code' },
  { action: 'math', icon: Sigma, title: 'Inline Math ($...$)' },
  'sep',
  { action: 'h1', icon: Heading1, title: 'Heading 1' },
  { action: 'h2', icon: Heading2, title: 'Heading 2' },
  { action: 'h3', icon: Heading3, title: 'Heading 3' },
  'sep',
  { action: 'bullet', icon: List, title: 'Bullet List' },
  { action: 'numbered', icon: ListOrdered, title: 'Numbered List' },
  { action: 'blockquote', icon: Quote, title: 'Blockquote' },
  { action: 'hr', icon: Minus, title: 'Divider' },
  { action: 'codeBlock', icon: Braces, title: 'Code Block' },
  'sep',
  { action: 'basicCard', icon: ChevronsRight, title: 'Basic Card (>>)', className: 'accent-green' },
  { action: 'reversibleCard', icon: ArrowLeftRight, title: 'Reversible Card (<>)', className: 'accent-blue' },
  { action: 'cloze', label: '{{}}', title: 'Cloze Deletion', className: 'accent-pink' },
  { action: 'multiCloze', label: 'c+', title: 'Add Next Cloze Number', className: 'accent-pink' },
  { action: 'insertTable', icon: Table2, title: 'Insert Table' },
  { action: 'tableAddRow', icon: Rows3, title: 'Table: Add Row' },
  { action: 'tableAddColumn', icon: Columns3, title: 'Table: Add Column' },
  'sep',
  { action: 'insertImage', icon: Image, title: 'Insert Image' },
]

export default function FormattingToolbar({ onFormat }) {
  return (
    <div className="formatting-toolbar">
      {buttons.map((btn, i) => {
        if (btn === 'sep') return <div key={i} className="fmt-sep" />
        const Icon = btn.icon
        return (
          <button
            key={btn.action}
            className={`fmt-btn ${btn.className || ''}`}
            title={btn.title}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFormat(btn.action)}
          >
            {Icon ? <Icon size={14} /> : <span style={{ fontSize: 11, fontWeight: 700 }}>{btn.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
