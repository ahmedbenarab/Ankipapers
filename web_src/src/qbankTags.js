// Question tags on a line (a heading, a card, any line of text), kept in a
// hidden comment written flush after its text (before the line's own
// <!--ap:uuid--> anchor):
//
//   ## Hypertrophic cardiomyopathy<!--uw::3252,4410-->
//
// "uw" is a shortcut from Settings -> Cards -> Tag Shortcuts. At Generate it
// is swapped for its tag and the rest is kept, so with uw -> UWorldABIM the
// line's own card and every card under it are tagged UWorldABIM::3252 and
// UWorldABIM::4410 (core/qbank.py, which this mirrors). The paper never shows
// the comment; the editor's textarea does, while the line is being edited.

export const TAG_MARK_RE = /<!--([A-Za-z][A-Za-z0-9_]*)::([^>]*?)-->/g
export const SHORTCUT_RE = /^[A-Za-z][A-Za-z0-9_]*$/
export const RESERVED_SHORTCUTS = ['flag', 'ap', 'nh', 'lastfeynmandate', 'lastfeynmanscore']
// Same shape, not question tags: a heading's last Feynman session (feynman.js).
export const NOT_TAG_MARKS = ['lastfeynmandate', 'lastfeynmanscore']
const NOT_TAG_MARK_RE = /<!--(?:LastFeynmanDate|LastFeynmanScore)::[^>]*?-->/gi

/** The line's Feynman comments as written, so code that rewrites its tag marks can keep them. */
export function otherMarkComments(text) {
  return (String(text ?? '').match(NOT_TAG_MARK_RE) || []).join('')
}
export const DEFAULT_SHORTCUTS = [{ shortcut: 'uw', tag: 'UWorldABIM', old: [] }]

/** The text with its <!--shortcut::...--> comments taken out. */
export function stripTagMarks(text) {
  return String(text ?? '').replace(TAG_MARK_RE, '')
}

/** Every mark on the line as "shortcut::value" (shortcut lower-cased), in order, no repeats. */
export function tagMarksIn(text) {
  const marks = []
  const seen = new Set()
  for (const m of String(text ?? '').matchAll(TAG_MARK_RE)) {
    const shortcut = m[1].toLowerCase()
    if (NOT_TAG_MARKS.includes(shortcut)) continue
    for (let value of m[2].match(/[^\s,]+/g) || []) {
      value = value.replace(/^:+|:+$/g, '')
      const mark = `${shortcut}::${value}`
      if (value && !seen.has(mark.toLowerCase())) {
        seen.add(mark.toLowerCase())
        marks.push(mark)
      }
    }
  }
  return marks
}

/**
 * Typing shortcut: "uw::3252" (or "uw::3252,4410", "uw::Cardio::3252") as
 * the last word before the caret on a line (lineMarks.takesLineMarks), where
 * "uw" is one of `shortcuts` (the Tag Shortcuts rows). Returns
 * { start, marks } -- where the word starts, counting any space in front of
 * it -- or null when the text before the caret doesn't end that way.
 */
export function findTagShortcut(textBeforeCaret, shortcuts) {
  const m = String(textBeforeCaret ?? '').match(/\s*(?<![\w:])([A-Za-z][A-Za-z0-9_]*)::([^\s,<>{}]+(?:,[^\s,<>{}]+)*)$/)
  if (!m) return null
  const shortcut = m[1].toLowerCase()
  if (!(shortcuts || []).some((r) => String(r?.shortcut ?? '').toLowerCase() === shortcut)) return null
  const marks = m[2].split(',').map((v) => v.replace(/^:+|:+$/g, '')).filter(Boolean)
    .map((v) => `${shortcut}::${v}`)
  return marks.length ? { start: m.index, marks } : null
}

/**
 * The body with `marks` added: merged into the comment its shortcut already
 * has, each shortcut keeping one comment, all placed straight after the text
 * (trailing spaces dropped, so they sit flush, like the anchor does).
 */
export function addTagMarks(body, marks) {
  const all = tagMarksIn(body)
  const seen = new Set(all.map((m) => m.toLowerCase()))
  for (const mark of marks) {
    if (!seen.has(mark.toLowerCase())) { seen.add(mark.toLowerCase()); all.push(mark) }
  }
  const groups = new Map()
  for (const mark of all) {
    const i = mark.indexOf('::')
    const sc = mark.slice(0, i)
    if (!groups.has(sc)) groups.set(sc, [])
    groups.get(sc).push(mark.slice(i + 2))
  }
  const comments = [...groups].map(([sc, values]) => `<!--${sc}::${values.join(',')}-->`).join('')
  return stripTagMarks(body).replace(/\s+$/, '') + comments + otherMarkComments(body)
}

// ── The Tag Shortcuts table (mirrors core/qbank.py) ─────────────────────

/** A tag as Anki can use it: no spaces, no stray "::" at either end. */
export function cleanTag(tag) {
  return String(tag ?? '').trim().replace(/\s+/g, '_').replace(/^:+|:+$/g, '')
}

/** The same tag, or one inside the other (capitals don't count). */
export function tagsNest(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase()
  return a === b || a.startsWith(b + '::') || b.startsWith(a + '::')
}

/** Why the rows aren't one-to-one, in words; null when they are. */
export function shortcutTableProblem(rows) {
  const seen = new Set()
  for (const [n, r] of (rows || []).entries()) {
    const sc = String(r?.shortcut ?? '').trim()
    const tag = cleanTag(r?.tag)
    if (!sc) return `Row ${n + 1} needs a shortcut.`
    if (!SHORTCUT_RE.test(sc)) return `“${sc}” can't be a shortcut: use letters, digits and _, starting with a letter.`
    if (RESERVED_SHORTCUTS.includes(sc.toLowerCase())) return `“${sc}” is taken: flag, ap, nh, LastFeynmanDate and LastFeynmanScore already mean something in a paper.`
    if (/^c\d+$/i.test(sc)) return `“${sc}” is taken: {{${sc}::…}} is a cloze.`
    if (seen.has(sc.toLowerCase())) return `“${sc}” is used twice. Each shortcut can be used only once.`
    if (!tag) return `“${sc}” needs a tag.`
    seen.add(sc.toLowerCase())
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]
      const ta = cleanTag(a.tag), tb = cleanTag(b.tag)
      if (ta.toLowerCase() === tb.toLowerCase()) {
        return `“${a.shortcut}” and “${b.shortcut}” both make ${ta} tags. Each tag can belong to only one shortcut.`
      }
      if (tagsNest(ta, tb)) {
        return `${ta} and ${tb} sit inside one another, so “${a.shortcut}” and “${b.shortcut}” could make the same tag.`
      }
    }
  }
  return null
}

/**
 * The rows to save: tags cleaned, and a row whose tag was renamed since it
 * was loaded (`saved`, the rows as they were) remembers the earlier tag in
 * "old", so the next Generate moves its cards to the new name. An earlier
 * tag that is now any row's live tag is dropped from "old".
 */
export function rowsToSave(rows, saved) {
  const before = new Map((saved || []).map((r) => [String(r.shortcut ?? '').toLowerCase(), r]))
  const out = (rows || []).map((r) => {
    const tag = cleanTag(r.tag)
    const old = [...(r.old || [])]
    const prev = r._key != null ? (saved || [])[r._key] : before.get(String(r.shortcut ?? '').toLowerCase())
    if (prev && cleanTag(prev.tag) && cleanTag(prev.tag).toLowerCase() !== tag.toLowerCase()) {
      old.push(cleanTag(prev.tag), ...(prev.old || []))
    }
    return { shortcut: String(r.shortcut ?? '').trim(), tag, old }
  })
  const live = out.map((r) => r.tag).filter(Boolean)
  for (const r of out) {
    r.old = [...new Set(r.old.map(cleanTag).filter(Boolean))].filter((o) => !live.some((t) => tagsNest(o, t)))
  }
  return out
}
