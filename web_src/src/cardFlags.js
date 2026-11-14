// An Anki flag on a line (a heading, a card, any line of text), kept in a
// hidden comment written flush after its text, like the question ids
// (qbankTags.js):
//
//   ## Aortic stenosis<!--flag:red-->
//
// The paper never shows it; the editor's textarea does while the line is
// being edited. At Generate the line's own card and every card under it get
// the flag (a card's own line beats its heading), and a line whose cards were
// all unflagged in Anki loses the comment (core/flags.py, which this mirrors).

export const FLAG_NUMBERS = { red: 1, orange: 2, green: 3, blue: 4, pink: 5, turquoise: 6, purple: 7 }
export const FLAG_NAMES = Object.fromEntries(Object.entries(FLAG_NUMBERS).map(([k, v]) => [v, k]))

export const FLAG_COMMENT_RE = /<!--flag:([a-z0-9]+)-->/gi

/** 'red' / '1' -> 1; 'none', '0' or anything unknown -> 0. */
export function flagNumber(word) {
  const w = String(word ?? '').trim().toLowerCase()
  if (/^\d+$/.test(w)) { const n = Number(w); return n >= 0 && n <= 7 ? n : 0 }
  return FLAG_NUMBERS[w] || 0
}

export function stripFlagComments(text) {
  return String(text ?? '').replace(FLAG_COMMENT_RE, '')
}

/** The word in the text's last flag comment ('red'), or '' when it has none. */
export function flagWordIn(text) {
  const all = [...String(text ?? '').matchAll(FLAG_COMMENT_RE)]
  return all.length ? all[all.length - 1][1] : ''
}

/**
 * Typing shortcut: "flag:red" (any flag name, a number 0-7, or "none") as the
 * last word before the caret on a line (lineMarks.takesLineMarks). Returns { start, flag } -- where
 * the word starts, counting any space in front -- or null.
 */
export function findFlagShortcut(textBeforeCaret) {
  const m = String(textBeforeCaret ?? '').match(/\s*\bflag:(red|orange|green|blue|pink|turquoise|purple|none|[0-7])$/i)
  return m ? { start: m.index, flag: flagNumber(m[1]) } : null
}

/**
 * The body with its flag set to `word` (replacing any it had), placed straight
 * after the text; a flag of none (0) just takes the comment off.
 */
export function setFlagComment(body, word) {
  const n = flagNumber(word)
  const bare = stripFlagComments(body)
  return n ? bare.replace(/\s+$/, '') + `<!--flag:${FLAG_NAMES[n]}-->` : bare
}
