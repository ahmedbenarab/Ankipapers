import { findLists } from './blockFormat'
import { codeLineMap } from './codeBlocks'
import { getApBlockId } from './docLinks'

/**
 * List cards (a line with "+ " items) by line, with what Anki knows of them.
 *
 * A list is one Anki note with a card per item. Its reference in card_refs
 * carries the parent line's anchor plus "/list", so neither the parent line
 * nor its items are found by the per-line lookup in crossLink.js. This maps
 * every parent and item line to its list note, and noteStats to the numbers
 * for that line: the whole note for the parent, one card for an item
 * (note_review_stats sends those per item anchor, under "items").
 *
 * Returns Map(lineIndex -> { kind: 'parent' | 'item', noteId, anchor,
 * count and items (parents), parent (items), stats }).
 */
export function listLines(lines, cardRefIndex, noteStats = null) {
  const out = new Map()
  for (const { parent, items } of findLists(lines, codeLineMap(lines))) {
    const anchor = getApBlockId(lines[parent])
    const noteId = anchor ? (cardRefIndex?.byBlock?.get(`${anchor}/list`)?.anki_note_id ?? null) : null
    const noteStatsFor = noteId != null && noteStats ? noteStats[String(noteId)] || null : null
    out.set(parent, { kind: 'parent', noteId, anchor, count: items.length, items, stats: noteStatsFor })
    for (const i of items) {
      const itemAnchor = getApBlockId(lines[i])
      const stats = noteStatsFor && itemAnchor ? noteStatsFor.items?.[itemAnchor] || null : null
      out.set(i, { kind: 'item', noteId, anchor: itemAnchor, parent, stats })
    }
  }
  return out
}

/** How many cards Anki marks weak or leech, counting a list's items one by one. */
export function weakCardCount(noteStats) {
  let n = 0
  for (const st of Object.values(noteStats || {})) {
    if (!st) continue
    if (st.items) n += Object.values(st.items).filter((it) => it && it.status).length
    else if (st.status) n++
  }
  return n
}
