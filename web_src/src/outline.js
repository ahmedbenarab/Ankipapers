import { getBlockType } from './blockFormat'
import { stripApBlockId } from './docLinks'

/**
 * The open paper's outline for the sidebar: every H1–H3 heading with how many
 * card lines sit under it (until the next heading of the same or a higher
 * level) and whether any of those lines are weak spots or leeches.
 *
 * `statusOf(index, line)` returns 'weak' or 'leech' for a card line (from
 * Anki's review stats), or nothing when the line is fine.
 */
const CARD_TYPES = new Set(['basic', 'reversible', 'cloze'])

function headingText(line) {
  return stripApBlockId(line).trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/(?<!!)\[([^\][]+)\]\([^)\s]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|~~|`/g, '')
    .trim()
}

export function buildOutline(content, statusOf = () => null) {
  const lines = String(content || '').split('\n')
  const items = []
  const open = [] // headings still collecting lines, outermost first
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const type = getBlockType(stripApBlockId(line))
    if (type === 'heading') {
      const level = (line.trim().match(/^#+/) || ['#'])[0].length
      while (open.length && open[open.length - 1].level >= level) open.pop()
      if (level <= 3) {
        const item = { index: i, level, text: headingText(line) || 'Untitled heading', cards: 0, weak: false, leech: false }
        items.push(item)
        open.push(item)
      }
      continue
    }
    if (CARD_TYPES.has(type)) {
      const status = statusOf(i, line)
      for (const h of open) {
        h.cards++
        if (status === 'leech') h.leech = true
        else if (status === 'weak') h.weak = true
      }
    }
  }
  return items
}

/** The heading a line sits under (the last outline item at or above it). */
export function currentHeadingIndex(items, lineIndex) {
  let found = -1
  for (const it of items) {
    if (it.index <= lineIndex) found = it.index
    else break
  }
  return found
}
