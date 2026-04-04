/**
 * Cross-link: paper lines ↔ Anki notes via card_refs.
 * Matching uses content_hash (primary) and line_index (fallback).
 * Python opens Browse with search_for("nid:" + id).
 */

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
function md5(str) {
  const k = []
  for (let i = 0; i < 64; i++) k[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0

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
 * Resolve anki_note_id for a given line.
 * Strategy: content_hash match (robust to line moves) → line_index fallback.
 */
export function resolveNoteIdForLine(lineIndex, lineText, cardRefs) {
  if (!cardRefs || !Array.isArray(cardRefs) || !cardRefs.length) return null

  const cardContent = extractCardContent(lineText)
  if (cardContent) {
    const hash = computeHash(cardContent)
    const byHash = cardRefs.find((r) => r.content_hash === hash)
    if (byHash?.anki_note_id != null) return byHash.anki_note_id
  }

  const byLine = cardRefs.find((r) => r.line_index === lineIndex)
  return byLine?.anki_note_id != null ? byLine.anki_note_id : null
}
