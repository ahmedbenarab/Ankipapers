// What the editor marks beside each line from heading flags and Anki's own
// state: the flag-colored rule in the gutter, a card's own Anki flag, and how
// much of a line is suspended.

import { codeLineMap } from './codeBlocks.js'
import { stripApBlockId } from './docLinks.js'
import { flagNumber, flagWordIn, stripFlagComments } from './cardFlags.js'
import { stripTagMarks } from './qbankTags.js'

function indentOf(line) {
  return Math.floor(((line.match(/^[ \t]*/) || [''])[0]).replace(/\t/g, '    ').length / 4)
}

/**
 * Whether the "uw::3252" / "flag:red" shortcuts may turn into a hidden comment
 * on this line. `text` is the line as edited (no indent, no anchor), `caret`
 * where Space or Return was pressed.
 *
 * Any line of text takes them: a heading, a card, a bullet, a sentence. Not
 * a picture, a bare link, a divider, a table row or a ``` fence, which are
 * recognized by their whole text and would stop being what they are with a
 * comment on the end (a picture under a card would no longer ride along to
 * it). Nor inside a {{cloze}} or `code`, where the words are the card's own.
 */
export function takesLineMarks(text, caret) {
  const body = stripFlagComments(stripTagMarks(String(text ?? ''))).trim()
  if (!body) return false
  if (/^\|/.test(body) || /^```/.test(body) || /^(---|\*\*\*|___)$/.test(body)) return false
  if (/^https?:\/\/\S+$/.test(body) || /^!\[[^\]]*\]\([^)]*\)/.test(body)) return false
  const before = String(text ?? '').slice(0, caret)
  const count = (s) => before.split(s).length - 1
  if (count('{{') > count('}}')) return false
  if (count('`') % 2) return false
  return true
}

/**
 * The flag in force on every line (0 = none), from the <!--flag:...-->
 * comments on headings: a line's own flag, else its nearest parent's -- the
 * lines above it with a smaller indent, the rule Generate and folding use
 * (core/flags.py). A ``` block takes its opening fence's flag. A blank line
 * takes the flag of the lines around it when both get it from the same
 * heading, so the gutter rule runs unbroken through a section.
 */
export function lineFlags(lines) {
  const n = lines.length
  const flag = new Array(n).fill(0)
  const source = new Array(n).fill(-1)
  const code = codeLineMap(lines)
  const stack = [] // { indent, flag, source } of the parents still open
  for (let i = 0; i < n; i++) {
    const block = code.get(i)
    if (block && i !== block.open) {
      flag[i] = flag[block.open]
      source[i] = source[block.open]
      continue
    }
    const display = stripApBlockId(lines[i])
    if (!display.trim()) continue
    const indent = indentOf(display)
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const own = flagNumber(flagWordIn(display))
    const parent = stack[stack.length - 1]
    flag[i] = own || (parent ? parent.flag : 0)
    source[i] = own ? i : (parent ? parent.source : -1)
    stack.push({ indent, flag: flag[i], source: source[i] })
  }
  // Blank lines between two lines flagged by the same heading.
  let prev = -1
  for (let i = 0; i < n; i++) {
    if (stripApBlockId(lines[i]).trim() || code.has(i)) { prev = i; continue }
    let next = i + 1
    while (next < n && !stripApBlockId(lines[next]).trim() && !code.has(next)) next++
    if (prev >= 0 && next < n && source[prev] >= 0 && source[prev] === source[next]) {
      for (let j = i; j < next; j++) flag[j] = flag[prev]
    }
    i = next - 1
  }
  return flag
}

/**
 * The Anki flag a card line's cards carry (0 = none): the one most of its
 * flagged cards share. `flags` is the per-card list from note stats.
 */
export function ankiFlagOf(flags) {
  const counts = new Map()
  for (const f of flags || []) if (f) counts.set(f, (counts.get(f) || 0) + 1)
  let best = 0
  let most = 0
  for (const [f, c] of counts) if (c > most) { best = f; most = c }
  return best
}
