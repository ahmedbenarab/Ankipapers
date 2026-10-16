/**
 * Client-side mirror of core/search_query.py for mock bridge / dev without Anki.
 */

const KNOWN = new Set(['title', 'content', 'folder', 'deck', 'tag']);

function haystack(p) {
  const tags = p.tags || [];
  return [String(p.title || '').toLowerCase(), searchable(p.content), String(p.folder_path || '').toLowerCase(),
    String(p.deck_name || '').toLowerCase(), tags.join(' ').toLowerCase()]
    .join('\n');
}

function fieldText(p, fname) {
  if (fname === 'title') return String(p.title || '').toLowerCase();
  if (fname === 'content') return searchable(p.content);
  if (fname === 'folder') return String(p.folder_path || '').toLowerCase();
  if (fname === 'deck') return String(p.deck_name || '').toLowerCase();
  if (fname === 'tag') return (p.tags || []).map((t) => String(t || '').toLowerCase()).join(' ');
  return '';
}

function splitOrBranches(q) {
  const s = q.trim();
  if (!s) return [];
  const parts = [];
  const buf = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      buf.push(ch);
      i++;
      while (i < n && s[i] !== quote) {
        buf.push(s[i]);
        i++;
      }
      if (i < n) buf.push(s[i]);
      i++;
      continue;
    }
    if (
      i + 3 < n &&
      s.slice(i, i + 4).toUpperCase() === ' OR ' &&
      (i === 0 || /\s/.test(s[i - 1]))
    ) {
      const j = i + 4;
      if (j >= n || /\s/.test(s[j])) {
        const chunk = buf.join('').trim();
        if (chunk) parts.push(chunk);
        buf.length = 0;
        i = j;
        while (i < n && /\s/.test(s[i])) i++;
        continue;
      }
    }
    buf.push(ch);
    i++;
  }
  const tail = buf.join('').trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [s];
}

function parseBranch(s) {
  const branch = {
    terms: [],
    fields: [],
    negTerms: [],
    negFields: [],
  };
  let i = 0;
  const n = s.length;
  const skipWs = () => {
    while (i < n && /\s/.test(s[i])) i++;
  };
  const fieldRe = /^(title|content|folder|deck|tag):/i;

  while (true) {
    skipWs();
    if (i >= n) break;
    let neg = false;
    if (s[i] === '-') {
      neg = true;
      i++;
      skipWs();
    }
    if (i >= n) break;
    const rest = s.slice(i);
    const fm = rest.match(fieldRe);
    if (fm) {
      const fname = fm[1].toLowerCase();
      i += fm[0].length;
      skipWs();
      if (i >= n) break;
      let val;
      if (s[i] === '"' || s[i] === "'") {
        const quote = s[i];
        i++;
        const start = i;
        while (i < n && s[i] !== quote) i++;
        val = s.slice(start, i).toLowerCase();
        if (i < n) i++;
      } else {
        const start = i;
        while (i < n && !/\s/.test(s[i])) i++;
        val = s.slice(start, i).toLowerCase();
      }
      if (KNOWN.has(fname) && val !== '') {
        if (neg) branch.negFields.push([fname, val]);
        else branch.fields.push([fname, val]);
      }
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      i++;
      const start = i;
      while (i < n && s[i] !== quote) i++;
      const val = s.slice(start, i).toLowerCase();
      if (i < n) i++;
      if (val) {
        if (neg) branch.negTerms.push(val);
        else branch.terms.push(val);
      }
      continue;
    }
    const start = i;
    while (i < n && !/\s/.test(s[i])) i++;
    const val = s.slice(start, i).toLowerCase();
    if (val) {
      if (neg) branch.negTerms.push(val);
      else branch.terms.push(val);
    }
  }
  return branch;
}

function branchMatches(p, b) {
  const h = haystack(p);
  for (const t of b.terms) if (!h.includes(t)) return false;
  for (const [f, needle] of b.fields) if (!fieldText(p, f).includes(needle)) return false;
  for (const t of b.negTerms) if (h.includes(t)) return false;
  for (const [f, needle] of b.negFields) if (fieldText(p, f).includes(needle)) return false;
  return true;
}

// ─── Line-level hits (mirror of find_line_hits in core/search_query.py) ───
// Every matching line, with the H1–H3 path above it — the same rule as a
// card's breadcrumb, including the line itself if it is a heading.

const MAX_LINE_HITS = 200;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const FENCE_RE = /^\s*(```|~~~)/;
const AP_COMMENT_RE = /<!--ap(?:-[a-z]+)?:[^>]*-->/gi;
const MD_LINK_RE = /(?<!!)\[([^\][]+)\]\([^)\s]+\)/g;
const TAG_RE = /\[\[[^\]]*\]\]/g;
const HTML_TAG_RE = /<[^>]+>/g;
const MARKS_RE = /\*\*|__|~~|`|\$|(?<![\w])\*|\*(?![\w])/g;

// Hidden anchors and link targets removed, so a search never "finds" a uuid
// or an ap:// address the reader can't see.
function searchable(text) {
  return String(text || '').replace(AP_COMMENT_RE, '').replace(MD_LINK_RE, '$1').toLowerCase();
}

function headingText(raw) {
  return raw.replace(AP_COMMENT_RE, '').replace(MD_LINK_RE, '$1').replace(TAG_RE, '')
    .replace(HTML_TAG_RE, '').replace(MARKS_RE, '').split(/\s+/).filter(Boolean).join(' ');
}

function findLineHits(p, b, limit = MAX_LINE_HITS) {
  const needles = [...b.terms.filter(Boolean), ...b.fields.filter(([f, n]) => f === 'content' && n).map(([, n]) => n)];
  if (!needles.length) return { lines: [], total: 0 };
  const lines = [];
  let total = 0;
  const path = [null, null, null];
  let inFence = false;
  String(p.content || '').split('\n').forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const m = line.trim().match(HEADING_RE);
      if (m && m[1].length <= 3) {
        const level = m[1].length;
        path[level - 1] = headingText(m[2]) || null;
        for (let d = level; d < 3; d++) path[d] = null;
      }
    }
    const text = searchable(line);
    if (needles.some((n) => text.includes(n))) {
      total++;
      if (lines.length < limit) lines.push({ line: i, path: path.filter(Boolean) });
    }
  });
  return { lines, total };
}

function matchFlags(p, b) {
  const titleL = String(p.title || '').toLowerCase();
  const cl = searchable(p.content);
  const folderL = String(p.folder_path || '').toLowerCase();
  const deckL = String(p.deck_name || '').toLowerCase();
  const tagsL = (p.tags || []).map((t) => String(t || '').toLowerCase()).join(' ');

  const titleMatch =
    b.terms.some((t) => titleL.includes(t)) ||
    b.fields.some(([f, n]) => f === 'title' && titleL.includes(n));
  const contentMatch =
    b.terms.some((t) => cl.includes(t)) || b.fields.some(([f, n]) => f === 'content' && cl.includes(n));
  const folderMatch =
    b.terms.some((t) => folderL.includes(t)) ||
    b.fields.some(([f, n]) => f === 'folder' && folderL.includes(n));
  const deckMatch =
    b.terms.some((t) => deckL.includes(t)) || b.fields.some(([f, n]) => f === 'deck' && deckL.includes(n));
  const tagMatch =
    b.terms.some((t) => tagsL.includes(t)) || b.fields.some(([f, n]) => f === 'tag' && tagsL.includes(n));

  return { title_match: titleMatch, content_match: contentMatch, folder_match: folderMatch, deck_match: deckMatch, tag_match: tagMatch };
}

export function searchPapersAdvanced(papers, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const branches = splitOrBranches(q).map(parseBranch);
  const out = [];
  for (const p of papers) {
    let matched = null;
    for (const br of branches) {
      if (branchMatches(p, br)) {
        matched = br;
        break;
      }
    }
    if (!matched) continue;
    const flags = matchFlags(p, matched);
    const { lines, total } = findLineHits(p, matched);
    out.push({
      id: p.id,
      title: p.title,
      folder_path: p.folder_path,
      deck_name: p.deck_name || '',
      lines,
      lines_total: total,
      ...flags,
    });
  }
  return out;
}
