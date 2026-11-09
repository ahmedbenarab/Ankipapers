// Question-bank ids on a heading, kept in a hidden comment written flush
// after its text (before the line's own <!--ap:uuid--> anchor):
//
//   ## Hypertrophic cardiomyopathy<!--uw:3252,4410-->
//
// The paper never shows the comment; the editor's textarea does, while the
// line is being edited. At Generate, every card under the heading is tagged
// "<prefix>::3252" (core/qbank.py, which this mirrors).

export const QBANK_COMMENT_RE = /<!--uw:([^>]*?)-->/gi

/** The text with its <!--uw:...--> comments taken out. */
export function stripQbankComments(text) {
  return String(text ?? '').replace(QBANK_COMMENT_RE, '')
}

/** Every id in the line's <!--uw:...--> comments, in order, no repeats. */
export function qbankIdsIn(text) {
  const ids = []
  for (const m of String(text ?? '').matchAll(QBANK_COMMENT_RE)) {
    for (const id of m[1].match(/[A-Za-z0-9_.-]+/g) || []) {
      if (!ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * Typing shortcut: "uw3252" (or "uw3252,4410") as the last word before the
 * caret on a heading. Returns { start, ids } -- where the word starts, counting
 * any space in front of it -- or null when the text before the caret doesn't
 * end that way.
 */
export function findQbankShortcut(textBeforeCaret) {
  const m = String(textBeforeCaret ?? '').match(/\s*\buw(\d+(?:,\d+)*)$/i)
  return m ? { start: m.index, ids: m[1].split(',') } : null
}

/**
 * The body with `ids` added to its question comment: merged into the one it
 * has, or a new one placed straight after the text (trailing spaces dropped,
 * so the comment sits flush, like the anchor does).
 */
export function addQbankIds(body, ids) {
  const all = qbankIdsIn(body)
  for (const id of ids) if (!all.includes(id)) all.push(id)
  return stripQbankComments(body).replace(/\s+$/, '') + `<!--uw:${all.join(',')}-->`
}
