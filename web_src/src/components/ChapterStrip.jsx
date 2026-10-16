import React from 'react'
import { BookOpen, Globe, ChevronLeft, ChevronRight, FilePlus } from 'lucide-react'

/**
 * Above a paper that is a chapter of its folder's book or course: where it sits
 * in the book, and a step to the previous / next chapter. A chapter with no
 * paper yet is created (already linked) when you step to it.
 */
export default function ChapterStrip({ entry, onGo }) {
  if (!entry?.chapter) return null
  const nb = entry.neighbors || {}
  const isBook = entry.source.kind === 'pdf'
  const Icon = isBook ? BookOpen : Globe
  const off = entry.page_offset || 0
  const ch = entry.chapter
  const count = nb.count || entry.chapter_count
  const index = (nb.index ?? entry.chapter_index ?? 0) + 1
  const side = (c, dir) => {
    if (!c) return null
    const label = c.paper_title || c.title
    return (
      <button title={c.paper_id ? `Open “${label}”` : `Create a paper for “${c.title}”`} onClick={() => onGo(entry, c)}>
        {dir < 0 && <ChevronLeft size={14} />}
        {!c.paper_id && <FilePlus size={12} />}
        <span>{label}</span>
        {dir > 0 && <ChevronRight size={14} />}
      </button>
    )
  }
  return (
    <div className="chapter-strip">
      <Icon size={14} style={{ color: 'var(--accent)', flex: 'none' }} />
      <span className="grow">
        <b>{entry.source.title}</b>
        {ch.group ? ` · ${ch.group}` : ''}
        {` · ${isBook ? 'Chapter' : 'Module'} ${index}${count ? ` of ${count}` : ''}`}
        {isBook && ch.start ? ` · pp. ${ch.start - off}–${(ch.end || ch.start) - off}` : ''}
      </span>
      {side(nb.prev, -1)}
      {side(nb.next, 1)}
    </div>
  )
}
