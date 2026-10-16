/**
 * Bridge module — talks to the Python backend over AnkiWebView's pycmd()
 * channel (aqt.webview.AnkiWebView injects window.pycmd(arg, cb) once its
 * internal message channel is up; cb receives the handler's return value
 * already JSON.parse()'d — see gui/bridge.py's handle()).
 *
 * Every command is sent as "ankipapers:" + JSON.stringify({cmd, args}); the
 * prefix keeps our messages from being mistaken for another add-on's or for
 * AnkiWebView's own "domDone"/"close" commands.
 */

import { searchPapersAdvanced } from './searchQuery.js';
import { createAiSourcesMock } from './aiBridge.js';

const CMD_PREFIX = 'ankipapers:';
const PYCMD_POLL_MS = 25;
const PYCMD_WARN_MS = 10000;

let _mockBridge = null;
let _readyPromise = null;
let _warnedSlow = false;

function _sendToPycmd(name, args) {
  return new Promise((resolve) => {
    window.pycmd(CMD_PREFIX + JSON.stringify({ cmd: name, args }), resolve);
  });
}

/** Core transport: one call for every bridge command. */
export function call(name, args = {}) {
  if (typeof window.pycmd === 'function') {
    return _sendToPycmd(name, args);
  }

  // Vite dev server with no Anki behind it: use the mock table so the UI is
  // usable standalone. Never falls back to the mock in a production build —
  // if pycmd hasn't shown up yet there, we just keep waiting for it.
  if (import.meta.env.DEV) {
    if (!_mockBridge) { _mockBridge = createMockBridge(); window.__mockBridge = _mockBridge; }  // dev-only: tests can stub calls
    const fn = _mockBridge[name];
    if (!fn) return Promise.resolve({ error: `${name} not available (mock bridge)` });
    return Promise.resolve(fn(args));
  }

  return new Promise((resolve) => {
    let waited = 0;
    const iv = setInterval(() => {
      if (typeof window.pycmd === 'function') {
        clearInterval(iv);
        _sendToPycmd(name, args).then(resolve);
        return;
      }
      waited += PYCMD_POLL_MS;
      if (!_warnedSlow && waited >= PYCMD_WARN_MS) {
        _warnedSlow = true;
        console.error('[AnkiPapers] window.pycmd has not appeared after 10s; still waiting (cmd:', name, ')');
      }
    }, PYCMD_POLL_MS);
  });
}

/** Resolves once the bridge (real pycmd, or the DEV mock) is usable. */
export function initBridge() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = new Promise((resolve) => {
    if (typeof window.pycmd === 'function') {
      resolve();
      return;
    }
    if (import.meta.env.DEV) {
      if (!_mockBridge) { _mockBridge = createMockBridge(); window.__mockBridge = _mockBridge; }
      resolve();
      return;
    }
    const iv = setInterval(() => {
      if (typeof window.pycmd === 'function') {
        clearInterval(iv);
        resolve();
      }
    }, PYCMD_POLL_MS);
  });
  return _readyPromise;
}

// Paper API
export async function listPapers() {
  return call('list_papers');
}
export async function loadPaper(id) {
  const d = await call('load_paper', { paper_id: id });
  return d && d.error ? null : d;
}
export async function savePaper(data) {
  return call('save_paper', { paper: data });
}
export async function createPaper(title, folderPath = '') {
  return call('create_paper', { title, folder_path: folderPath });
}
export async function deletePaper(id) {
  return call('delete_paper', { paper_id: id });
}
export async function movePaperToFolder(id, folder) {
  return call('move_paper_to_folder', { paper_id: id, folder_path: folder });
}
/** @param {string} ankiEditConflict preserve | overwrite | abort */
export async function generateCards(id, ankiEditConflict = 'preserve') {
  const policy = ankiEditConflict || 'preserve';
  return call('generate_cards', { paper_id: id, anki_edit_conflict: policy });
}

export async function checkAnkiEditConflicts(paperId) {
  return call('check_anki_edit_conflicts', { paper_id: paperId });
}

// Decks & Folders
export async function getDecks() {
  return call('get_decks');
}
export async function getFolders() {
  return call('get_folders');
}
export async function createFolder(name, parentPath = '') {
  return call('create_folder', { name, parent_path: parentPath });
}
export async function deleteFolder(folderPath) {
  return call('delete_folder', { folder_path: folderPath || '' });
}
export async function renameFolder(oldPath, newName) {
  return call('rename_folder', { old_path: oldPath || '', new_name: (newName || '').trim() });
}
export async function moveFolder(folderPath, newParentPath) {
  return call('move_folder', { folder_path: folderPath || '', new_parent_path: newParentPath || '' });
}

// Images
export async function getMediaDir() {
  return call('get_media_dir');
}
export async function pickImage() {
  return call('pick_image');
}
/** Plain text from the system clipboard, for "Paste blocks". */
export async function getClipboardText() {
  return call('get_clipboard_text');
}

export async function pasteImage() {
  return call('paste_image');
}

// Browser linking — Python runs Browser.search_for("nid:" + id), same as manual Anki search
export async function openInBrowser(noteId) {
  const n = Number(noteId);
  if (noteId == null || noteId === '' || !Number.isFinite(n) || n <= 0) {
    console.warn('[AnkiPapers] openInBrowser: invalid note id', noteId);
    return;
  }
  await call('open_in_browser', { note_id: String(Math.trunc(n)) });
}

/** Parsed object: verify nid: search and Browser APIs (Settings debug). */
export async function diagnoseCrosslink(noteId) {
  return call('diagnose_crosslink', { note_id: String(noteId).trim() });
}

export async function moveCardsToDeck(paperId, deckName) {
  return call('move_cards_to_deck', { paper_id: paperId, deck_name: deckName });
}

// Search
export async function searchPapers(query) {
  return call('search_papers', { query });
}

// Markdown Import/Export
export async function importMarkdown() {
  return call('import_markdown');
}
export async function exportMarkdown(id) {
  return call('export_markdown', { paper_id: id });
}

// PDF Export
//
// `html` is the printable document built by printDocument.js, using the same
// parsing and inline formatting the editor uses. Python receives it through
// export_pdf_html() and only runs the save dialog and printToPdf().
//
// The older export_pdf() slot — where Python rendered the markdown itself with
// a separate, long-since-drifted converter — stays as a fallback, so a new web/
// build still exports on an install whose gui/ has not been replaced yet. The
// two halves are copied into the add-on by hand and can lag each other.
export async function exportPdf(id, html = '') {
  if (html) {
    return call('export_pdf_html', { paper_id: id, html });
  }
  return call('export_pdf', { paper_id: id });
}

// Papers on disk (phase 1: write only — the collection stays authoritative)
export async function exportPapersToDisk(mode = 'preview') {
  return call('export_papers_to_disk', { mode });
}

// Settings
/** One-time **bold** / *italic* → <b> / <i> conversion; dryRun only reports. */
export async function convertEmphasisToTags(dryRun = true) {
  return call('convert_emphasis_to_tags', { dry_run: dryRun });
}
/** The user's macOS Text Replacements: { items: [{ shortcut, phrase }] }. */
export async function getTextReplacements() {
  return call('get_text_replacements');
}
// Per-day count of lines turned into cards ({ "YYYY-MM-DD": n }), the first
// such day, and the paper whose cards were written most recently.
// Weak-spot markers: Anki review stats per note id ({ stats: { [nid]: {...} } }).
export async function getNoteStats(noteIds) {
  return call('get_note_stats', { note_ids: noteIds || [] });
}
export async function unsuspendNote(noteId) {
  return call('unsuspend_note', { note_id: noteId });
}

export async function getHomeStats() {
  return call('get_home_stats');
}

export async function getSettings() {
  return call('get_settings');
}
export async function saveSettings(settings) {
  return call('save_settings', { settings });
}

export async function openUrl(url) {
  await call('open_url', { url });
}

// Sharing: a .zip with the paper (or folder) and every picture it shows
// (core/share.py). Importing one goes through importMarkdown().
export async function sharePaper(paperId) {
  return call('share_paper', { paper_id: paperId });
}
export async function shareFolder(folderPath) {
  return call('share_folder', { folder_path: folderPath });
}

// The web browser docked beside the editor is a native Qt view
// (gui/web_browser.py); these only show or hide it and pass the colors.
export async function setWebBrowser(open, theme = null) {
  return call('set_web_browser', { open, theme });
}
export async function getWebBrowser() {
  return call('get_web_browser');
}

// Source panel
export async function pickPdfFile() {
  return call('pick_pdf_file');
}
export async function getPdfViewerUrl() {
  return call('pdf_viewer_url');
}
export async function getPdfUrl(path) {
  return call('pdf_url', { path });
}
export async function extractPdfText(path, page = 1) {
  return call('extract_pdf_text', { pdf_path: path, page: Number(page || 1) });
}
export async function extractWebText(url) {
  return call('extract_web_text', { url });
}
export async function saveSourceLink(paperId, blockId, linkData) {
  return call('save_source_link', { paper_id: paperId, block_id: blockId, link: linkData || {} });
}
export async function loadSourceLink(paperId, blockId) {
  return call('load_source_link', { paper_id: paperId, block_id: blockId });
}
export async function openSourceAtLocation(linkData) {
  return call('open_source_at_location', { source: linkData || {} });
}

// ─── Mock Bridge (Vite dev server only; import.meta.env.DEV) ──────────────
// Table shape: { [name]: (args) => value }, mirroring the real dispatch dict
// in gui/bridge.py so `call(name, args)` can use either transparently.
function createMockBridge() {
  const papers = [
    {
      id: 'demo-1', title: 'Cell Biology',
      content: '# Cell Biology\n\n## Organelles\n\nWhat is the powerhouse of the cell? >> Mitochondria\n\nATP <> Adenosine Triphosphate\n\nThe {{mitochondria}} is the powerhouse of the cell.\n\n{{c1::ATP}} is produced through {{c2::oxidative phosphorylation}}.\n\n## Cell Membrane\n\n- **Phospholipid bilayer** forms the basic structure\n\n> The fluid mosaic model describes membrane structure\n\n---\n\nWhat is endocytosis? >> The process by which cells absorb molecules\n',
      deck_name: 'Biology', folder_path: 'Biology', tags: [],
      // Pretend these lines were generated, so weak spots have notes to show.
      card_refs: [4, 6, 8, 10, 22].map((line_index, i) => ({ line_index, card_type: ['basic', 'reversible', 'cloze', 'cloze', 'basic'][i], anki_note_id: 1001 + i, content_hash: '', synced: true })),
      created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
    },
    // Dev-only papers for the draft-cards, sources and chat screens.
    {
      id: 'demo-hf', title: 'Cardiology',
      content: '# Heart failure\n## HFrEF\nFirst-line drugs in HFrEF >> ACEi/ARB/ARNI, β-blocker, MRA, SGLT2i\nEjection fraction cut-off for HFrEF >> ≤ 40%\nSacubitril/valsartan (an ARNI) reduces mortality in HFrEF compared with enalapril.\nNever start it within 36 hours of the last ACE inhibitor dose (angioedema risk).\n## HFpEF\nSGLT2 inhibitors in HFpEF >> fewer HF hospitalizations\n',
      deck_name: 'Medicine', folder_path: 'Medicine', tags: [], card_refs: [],
      created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
    },
    ...['1. Getting Started', '2. Variable & Simple Data Types', '3. Lists', '4. Working With Lists', '5. If Statements'].map((title, i) => ({
      id: 'demo-py' + i, title, content: `# ${title}\n`, deck_name: 'Default', folder_path: 'Software Engineering/Python/Fundamentals',
      tags: [], card_refs: [], created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
    })),
    ...['1. Introduction to AI Concept', '2. Introduction to Generative AI and Agents', 'Exam tips'].map((title, i) => ({
      id: 'demo-ai' + i, title,
      content: `# ${title}\n## What is AI\nArtificial intelligence <> software that imitates human behavior and capabilities\n`,
      deck_name: 'Default', folder_path: i < 2 ? 'Software Engineering/Azure/AI-901/1. AI Concepts' : 'Software Engineering/Azure/AI-901', tags: [], card_refs: [],
      created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
    })),
  ];
  const folderTree = { name: 'Root', children: [
    { type: 'folder', name: 'Biology', path: 'Biology', children: [] },
    { type: 'folder', name: 'Medicine', path: 'Medicine', children: [] },
    { type: 'folder', name: 'Software Engineering', path: 'Software Engineering', children: [
      { type: 'folder', name: 'Azure', path: 'Software Engineering/Azure', children: [
        { type: 'folder', name: 'AI-901', path: 'Software Engineering/Azure/AI-901', children: [
          { type: 'folder', name: '1. AI Concepts', path: 'Software Engineering/Azure/AI-901/1. AI Concepts', children: [] },
          { type: 'folder', name: '2. AI Apps & Agents', path: 'Software Engineering/Azure/AI-901/2. AI Apps & Agents', children: [] },
        ] },
        { type: 'folder', name: 'AZ-104', path: 'Software Engineering/Azure/AZ-104', children: [] },
      ] },
      { type: 'folder', name: 'Python', path: 'Software Engineering/Python', children: [
        { type: 'folder', name: 'Fundamentals', path: 'Software Engineering/Python/Fundamentals', children: [] },
      ] },
    ] },
  ] };
  const sourceLinks = {};
  return {
    ...createAiSourcesMock(papers),
    list_papers: () => papers,
    load_paper: ({ paper_id }) => papers.find(x => x.id === paper_id) || { error: 'not found' },
    save_paper: ({ paper }) => {
      const i = papers.findIndex(x => x.id === paper.id);
      if (i >= 0) Object.assign(papers[i], paper);
      return { ok: true };
    },
    create_paper: ({ title, folder_path }) => {
      const p = {
        id: 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), title, content: `# ${title}\n\n`, deck_name: 'Default',
        folder_path, card_refs: [], tags: [], created_at: Date.now() / 1000, modified_at: Date.now() / 1000,
      };
      papers.push(p);
      return p;
    },
    delete_paper: ({ paper_id }) => {
      const i = papers.findIndex(x => x.id === paper_id);
      if (i >= 0) papers.splice(i, 1);
      return { ok: true };
    },
    move_paper_to_folder: ({ paper_id, folder_path }) => {
      const p = papers.find(x => x.id === paper_id);
      if (p) p.folder_path = folder_path;
      return { ok: true };
    },
    // Slightly slow, like the real thing, so progress is visible in dev.
    generate_cards: () => new Promise((r) => setTimeout(() => r({ created: 3, updated: 1, deleted: 0 }), 250)),
    check_anki_edit_conflicts: () => ({ conflicts: [] }),
    get_decks: () => ['Default', 'Biology', 'Medicine'],
    get_folders: () => folderTree,
    create_folder: () => ({ ok: true }),
    delete_folder: () => ({ ok: true }),
    rename_folder: () => ({ ok: true }),
    move_folder: () => ({ ok: true }),
    get_media_dir: () => ({ path: '', base_url: '' }),
    pick_image: () => ({ canceled: true }),
    paste_image: () => ({ canceled: true }),
    get_clipboard_text: () => ({ text: (typeof window !== 'undefined' && window.__clipboardText) || '' }),
    open_in_browser: ({ note_id }) => { console.log('Mock: Open in browser', note_id); return { ok: true }; },
    diagnose_crosslink: ({ note_id }) => ({
      note_id: Number(note_id) || 0,
      query: `nid:${note_id}`,
      note_found: true,
      find_cards_count: 1,
      first_cid: 1,
      browser_open: false,
      has_select_single_card: true,
    }),
    move_cards_to_deck: () => ({ ok: true }),
    search_papers: ({ query }) => searchPapersAdvanced(papers, query),
    get_note_stats: ({ note_ids }) => {
      const sample = {
        1001: { status: 'weak', lapses: 3, reviews: 9, again: 3, ease: 170, last_review: Date.now() / 1000 - 2 * 86400, last_ease: 1, next_due_days: 1, is_new: false, suspended: false },
        1004: { status: 'leech', lapses: 8, reviews: 14, again: 8, ease: 130, last_review: Date.now() / 1000 - 5 * 86400, last_ease: 1, next_due_days: null, is_new: false, suspended: true },
      }
      const stats = {}
      for (const n of note_ids || []) stats[n] = sample[n] || { status: null, lapses: 0, reviews: 4, again: 0, ease: 250, last_review: Date.now() / 1000 - 86400, last_ease: 3, next_due_days: 6, is_new: false, suspended: false }
      return { stats }
    },
    unsuspend_note: () => ({ ok: true, unsuspended: 1 }),
    get_home_stats: () => {
      // Sample history so the heatmap has something to show without Anki.
      const days = {}
      let seed = 7
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const d = new Date(today); d.setMonth(d.getMonth() - 14)
      const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
      for (; d <= today; d.setDate(d.getDate() + 1)) {
        const daysAgo = Math.round((today - d) / 86400000)
        if (daysAgo < 9 || rnd() > 0.4) days[iso(d)] = 1 + Math.round(rnd() * rnd() * 40)
      }
      const first = papers[0]
      return {
        days,
        first_day: Object.keys(days).sort()[0] || null,
        last_generated: first ? { at: Date.now() / 1000 - 7200, paper_id: first.id, title: first.title } : null,
      }
    },
    import_markdown: () => ({ canceled: true }),
    export_markdown: () => ({ canceled: true }),
    export_pdf: () => ({ canceled: true }),
    export_pdf_html: () => ({ canceled: true }),
    export_papers_to_disk: () => ({ root: '', written: [] }),
    share_paper: () => ({ canceled: true }),
    share_folder: () => ({ canceled: true }),
    set_web_browser: ({ open }) => ({ open: !!open }),
    get_web_browser: () => ({ open: false }),
    get_settings: () => ({
      default_deck: 'Default', auto_save_interval_seconds: 30, font_size: 14,
      font_family: 'JetBrains Mono', editor_theme: 'dark', show_card_indicators: true, show_line_numbers: true, color_scheme: 'carolina', weak_spot_markers: true,
      anki_edit_conflict: 'ask',
    }),
    // Mirrors gui/bridge.py: a changed card_style reports it was applied.
    save_settings: ({ settings }) => {
      const prev = createMockBridge._cardStyle || 'basic|carolina'
      const next = `${(settings && settings.card_style) || 'basic'}|${(settings && settings.color_scheme) || 'carolina'}`
      createMockBridge._cardStyle = next
      return next !== prev ? { ok: true, card_style_applied: true } : { ok: true }
    },
    convert_emphasis_to_tags: ({ dry_run }) => {
      // Dev stand-in for core/emphasis.py (no code/maths protection here).
      let bold = 0, italic = 0, changed = 0
      const plan = papers.map((p) => {
        let c = p.content
        c = c.replace(/\*\*(.+?)\*\*/g, (_m, t) => { bold++; return `<b>${t}</b>` })
        c = c.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_m, t) => { italic++; return `<i>${t}</i>` })
        if (c !== p.content) changed++
        return [p, c]
      })
      if (dry_run !== false || !changed) return { scanned: papers.length, papers: changed, bold, italic, dry_run: true }
      plan.forEach(([p, c]) => { p.content = c })
      return { scanned: papers.length, papers: changed, bold, italic, dry_run: false, backup: '(dev) no backup', failures: [] }
    },
    get_text_replacements: () => ({ items: [
      { shortcut: ',sig', phrase: 'Signed, Trevor' },
      { shortcut: ',ab', phrase: 'abbreviation' },
      { shortcut: ',abc', phrase: 'alphabet' },
      { shortcut: ',2l', phrase: 'line one\nline two' },
    ] }),
    open_url: ({ url }) => { console.log('Mock: Open URL', url); return { ok: true }; },
    pick_pdf_file: () => ({ canceled: true }),
    // The viewer from public/, and a test book under web_src/.devtest/ if one is there.
    pdf_viewer_url: () => ({ url: '/pdf_viewer.html' }),
    pdf_url: () => ({ error: 'not implemented' }),
    extract_pdf_text: ({ pdf_path, page }) => ({ ok: true, title: 'Demo PDF', text: `Extracted text from page ${page}`, path: pdf_path, page }),
    extract_web_text: ({ url }) => ({ ok: true, title: url, text: 'Extracted web content demo', url }),
    save_source_link: ({ paper_id, block_id, link }) => { sourceLinks[`${paper_id}:${block_id}`] = link; return { ok: true } },
    load_source_link: ({ paper_id, block_id }) => sourceLinks[`${paper_id}:${block_id}`] || { error: 'Source link not found' },
    open_source_at_location: () => ({ ok: true }),
  };
}

// Expose the wrapper module on window for the Stage 4 automated regression
// driver (drives the UI purely through window.ankiPapersBridge via CDP).
if (typeof window !== 'undefined') {
  window.ankiPapersBridge = {
    call,
    initBridge,
    listPapers, loadPaper, savePaper, createPaper, deletePaper, movePaperToFolder,
    generateCards, checkAnkiEditConflicts,
    getDecks, getFolders, createFolder, deleteFolder, renameFolder, moveFolder,
    getMediaDir, pickImage, getClipboardText, pasteImage,
    openInBrowser, diagnoseCrosslink, moveCardsToDeck,
    searchPapers, getHomeStats, getNoteStats, unsuspendNote,
    importMarkdown, exportMarkdown, exportPdf, exportPapersToDisk,
    getSettings, saveSettings, openUrl, setWebBrowser, getWebBrowser, sharePaper, shareFolder,
    pickPdfFile, getPdfViewerUrl, getPdfUrl, extractPdfText, extractWebText,
    saveSourceLink, loadSourceLink, openSourceAtLocation,
  };
}
