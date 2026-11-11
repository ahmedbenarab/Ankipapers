/**
 * Cross-link: paper lines ↔ Anki notes via card_refs.
 * Matching, in order: the line's own hidden card ID (<!--ap:uuid-->, which
 * Generate records as block_id), then content_hash, then line_index -- the
 * last only for a line with no card ID of its own.
 * Python opens Browse with search_for("nid:" + id).
 */

import { getApBlockId, stripApBlockId } from './docLinks.js'
import { stripTagMarks } from './qbankTags.js'
import { stripFlagComments } from './cardFlags.js'

/** Cursor line index (0-based) for content split by \n */
export function getLineIndexAtCursor(text, cursorPos) {
  if (text == null || text === '') return 0
  const pos = Math.max(0, Math.min(cursorPos ?? 0, text.length))
  return (text.slice(0, pos).match(/\n/g) || []).length
}

export function getLineTextAtIndex(text, lineIndex) {
  const lines = (text ?? '').split('\n')
  return lineIndex >= 0 && lineIndex < lines.length ? lines[lineIndex] : ''
}

/**
 * Extract the "card content" from a line the same way the Python parser does:
 *   strip leading whitespace → strip bullet prefix (- or *) → result.
 */
function extractCardContent(line) {
  const stripped = (line ?? '').trim()
  const m = stripped.match(/^\s*[-*]\s+(.+)$/)
  return m ? m[1] : stripped
}

/**
 * Simple MD5-compatible content hash (must match Python's compute_hash).
 * Uses FNV-1a 64-bit folded to 48-bit hex — but we actually need to match
 * Python's hashlib.md5().hexdigest()[:12].
 *
 * Since we can't do MD5 cheaply in JS without a library, we match by
 * content_hash stored in card_refs using a two-pass strategy:
 *   1. Try line_index (fast, works right after generate)
 *   2. Try content_hash via JS md5 (robust when lines shift)
 */

/* Compact MD5 — produces same output as Python hashlib.md5().hexdigest() */
// K is a fixed constant table (derived from sin()) — build it once at module
// load instead of recomputing it on every md5() call. Same values, just not
// redone thousands of times per keystroke on documents with many cards.
const MD5_K = (() => {
  const k = []
  for (let i = 0; i < 64; i++) k[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
  return k
})()

function md5(str) {
  const k = MD5_K
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6)); bytes.push(0x80 | (c & 0x3f)) }
    else if (c < 0xd800 || c >= 0xe000) { bytes.push(0xe0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)) }
    else { const cp = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(++i) & 0x3ff)); bytes.push(0xf0 | (cp >> 18)); bytes.push(0x80 | ((cp >> 12) & 0x3f)); bytes.push(0x80 | ((cp >> 6) & 0x3f)); bytes.push(0x80 | (cp & 0x3f)) }
  }
  const len = bytes.length
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const bitLen = len * 8
  bytes.push(bitLen & 0xff, (bitLen >>> 8) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 24) & 0xff, 0, 0, 0, 0)

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21]

  for (let off = 0; off < bytes.length; off += 64) {
    const m = []
    for (let j = 0; j < 16; j++) m[j] = bytes[off + j * 4] | (bytes[off + j * 4 + 1] << 8) | (bytes[off + j * 4 + 2] << 16) | (bytes[off + j * 4 + 3] << 24)
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f, g
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      f = (f + a + k[i] + m[g]) >>> 0
      a = d; d = c; c = b; b = (b + ((f << s[i]) | (f >>> (32 - s[i])))) >>> 0
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0
  }

  const hex = (n) => Array.from({ length: 4 }, (_, i) => ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join('')
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

function computeHash(text) {
  return md5(text).slice(0, 12)
}

/**
 * A card line's text as Python hashes it (core/parser.parse_line): bullet,
 * hidden card ID, question ids, flag and [[tags]] removed. Hashing the raw
 * line instead -- card ID and all -- never matched a generated card, so every
 * line fell through to its saved line number, and once lines shifted it was
 * matched to its neighbor's note.
 */
function hashableContent(lineText) {
  const content = extractCardContent(stripApBlockId(lineText ?? ''))
  return stripFlagComments(stripTagMarks(content)).replace(/\[\[(.*?)\]\]/g, '').trim()
}

/** Resolve anki_note_id for a given line (see resolveNoteIdFromIndex). */
export function resolveNoteIdForLine(lineIndex, lineText, cardRefs) {
  return resolveNoteIdFromIndex(lineIndex, lineText, buildCardRefIndex(cardRefs))
}

/**
 * For callers that resolve the note ID for MANY lines against the same
 * card_refs array (e.g. rendering every card block in a document):
 * buildCardRefIndex() scans card_refs once, and resolveNoteIdFromIndex() then
 * does O(1) Map lookups per line. The first entry with a given card ID /
 * content_hash / line_index wins.
 */
export function buildCardRefIndex(cardRefs) {
  const byBlock = new Map()
  const byHash = new Map()
  const byLine = new Map()
  if (Array.isArray(cardRefs)) {
    for (const r of cardRefs) {
      if (r && r.block_id && !byBlock.has(r.block_id.toLowerCase())) byBlock.set(r.block_id.toLowerCase(), r)
      if (r && r.content_hash != null && !byHash.has(r.content_hash)) byHash.set(r.content_hash, r)
      if (r && r.line_index != null && !byLine.has(r.line_index)) byLine.set(r.line_index, r)
    }
  }
  return { byBlock, byHash, byLine }
}

export function resolveNoteIdFromIndex(lineIndex, lineText, index) {
  if (!index || (index.byBlock.size === 0 && index.byHash.size === 0 && index.byLine.size === 0)) return null

  // 1. The line's own card ID: exact, however far the line has moved.
  const blockId = getApBlockId(lineText)
  if (blockId) {
    const byBlock = index.byBlock.get(blockId)
    if (byBlock?.anki_note_id != null) return byBlock.anki_note_id
  }

  // 2. Its text, hashed the way Generate hashed it.
  const cardContent = hashableContent(lineText)
  if (cardContent) {
    const byHash = index.byHash.get(computeHash(cardContent))
    if (byHash?.anki_note_id != null) return byHash.anki_note_id
  }

  // 3. Its saved line number -- only for a line with no card ID, and only a
  //    record that has none either. A line with an ID that isn't in card_refs
  //    hasn't been generated yet, and a record with an ID belongs to the line
  //    carrying it, wherever that line is now.
  if (blockId) return null
  const byLine = index.byLine.get(lineIndex)
  return byLine?.anki_note_id != null && !byLine.block_id ? byLine.anki_note_id : null
}
