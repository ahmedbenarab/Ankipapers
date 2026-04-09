/**
 * Client-side mirror of core/search_query.py for mock bridge / dev without Anki.
 */

const KNOWN = new Set(['title', 'content', 'folder', 'deck', 'tag']);

function haystack(p) {
  const tags = p.tags || [];
  return [p.title, p.content, p.folder_path, p.deck_name, tags.join(' ')]
    .map((x) => String(x || '').toLowerCase())
    .join('\n');
}

function fieldText(p, fname) {
  if (fname === 'title') return String(p.title || '').toLowerCase();
  if (fname === 'content') return String(p.content || '').toLowerCase();
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

function snippetAround(content, idx, len, radius = 48) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + len + radius);
  const frag = content.slice(start, end).replace(/\n/g, ' ');
  return `${start > 0 ? '...' : ''}${frag}${end < content.length ? '...' : ''}`;
}

function buildSnippet(p, b) {
  const content = p.content || '';
  if (!content) return '';
  const cl = content.toLowerCase();
  for (const [f, needle] of b.fields) {
    if (f === 'content' && needle && cl.includes(needle)) {
      return snippetAround(content, cl.indexOf(needle), needle.length);
    }
  }
  for (const t of b.terms) {
    if (t && cl.includes(t)) return snippetAround(content, cl.indexOf(t), t.length);
  }
  for (const [f, needle] of b.fields) {
    if (f !== 'content' && needle && cl.includes(needle)) {
      return snippetAround(content, cl.indexOf(needle), needle.length);
    }
  }
  return '';
}

function matchFlags(p, b) {
  const titleL = String(p.title || '').toLowerCase();
  const cl = String(p.content || '').toLowerCase();
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
    out.push({
      id: p.id,
      title: p.title,
      folder_path: p.folder_path,
      deck_name: p.deck_name || '',
      snippet: buildSnippet(p, matched),
      ...flags,
    });
  }
  return out;
}
