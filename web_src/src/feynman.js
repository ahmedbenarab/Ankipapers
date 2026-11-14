// A heading's last Feynman session, kept in hidden marks on its line:
//
//   ## HFrEF<!--LastFeynmanDate::11_13_2026--><!--LastFeynmanScore::67%-->
//
// They sit after the text (and any question-tag marks), before the line's own
// <!--ap:uuid--> anchor, which stays last. A new session replaces them: only
// the latest is kept. They look like question-tag marks, so qbankTags.js and
// core/qbank.py reserve both names and never turn them into tags. The answer
// key and the grading live in core/feynman.py.

import { AP_BLOCK_ID_TAIL } from './docLinks.js'

const DATE_RE = /<!--LastFeynmanDate::(\d{1,2})_(\d{1,2})_(\d{4})-->/i
const SCORE_RE = /<!--LastFeynmanScore::(\d{1,3})%-->/i
const BOTH_RE = /<!--(?:LastFeynmanDate|LastFeynmanScore)::[^>]*?-->/gi

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "11_13_2026": month_day_year, as the mark stores it. */
export function feynmanDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}_${pad(date.getDate())}_${date.getFullYear()}`
}

/** The line's last session: { score, date: 'Nov 13, 2026', stamp: '11_13_2026' }, or null. */
export function readFeynman(line) {
  const s = String(line ?? '').match(SCORE_RE)
  if (!s) return null
  const d = String(line ?? '').match(DATE_RE)
  const score = Math.min(100, Number(s[1]))
  if (!d) return { score, date: '', stamp: '' }
  const month = MONTHS[Number(d[1]) - 1] || d[1]
  return { score, date: `${month} ${Number(d[2])}, ${d[3]}`, stamp: `${d[1]}_${d[2]}_${d[3]}` }
}

/** The tooltip on a heading's score. */
export function feynmanTip(info) {
  if (!info) return ''
  const when = info.date ? ` (${info.date})` : ''
  return `On your last recorded Feynman response${when}, you scored ${info.score}%.`
}

/** The line with its Feynman marks set to this session, replacing any earlier ones. */
export function setFeynmanMarks(line, stamp, score) {
  const text = String(line ?? '')
  const m = text.match(AP_BLOCK_ID_TAIL)
  const anchor = m ? text.slice(m.index).trim() : ''
  const body = (m ? text.slice(0, m.index) : text).replace(BOTH_RE, '').replace(/\s+$/, '')
  return `${body}<!--LastFeynmanDate::${stamp}--><!--LastFeynmanScore::${Math.round(score)}%-->${anchor}`
}

/**
 * A microphone's name for the panel's menu.
 *
 * The web engine gives a page shortened names: any AirPods, whatever the
 * model or owner, are just "AirPods", and the system default comes as
 * "Default - AirPods" (in Anki, with the word missing: "- AirPods").
 * `systemNames` are the Mac's own names for its inputs (core/feynman.py); when
 * exactly one of them contains the short name, that one is shown instead.
 */
export function micLabel(label, systemNames = [], isDefault = false) {
  let name = String(label ?? '').replace(/^(?:Default)?\s*-\s+/i, '').trim()
  const lower = name.toLowerCase()
  const names = (systemNames || []).map(String)
  if (name && !names.some((n) => n.toLowerCase() === lower)) {
    const hits = names.filter((n) => n.toLowerCase().includes(lower))
    if (hits.length === 1) name = hits[0]
  }
  if (isDefault) return `System default (${name || 'microphone'})`
  return name || 'Microphone'
}
