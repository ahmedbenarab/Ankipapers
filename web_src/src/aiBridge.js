/**
 * Bridge wrappers for AI (draft cards, chat, Settings → AI) and sources
 * (files and web pages attached to papers and folders). See gui/ai_sources.py.
 *
 * Anything that goes over the network is a background job in Python: the
 * command answers {job} straight away and runJob() polls "ai_poll" until it's
 * finished, passing streamed text to onText as it arrives.
 */
import { call } from './bridge.js'

const POLL_MS = 200

/** Start a job command and wait for it. Resolves to the job's result, or {error}. */
export function runJob(cmd, args = {}, { onText, signal } = {}) {
  return new Promise((resolve) => {
    call(cmd, args).then((started) => {
      if (!started || started.error) { resolve({ error: started?.error || 'Couldn’t start the request.' }); return }
      if (!started.job) { resolve(started); return }
      const job = started.job
      let lastLen = 0
      const tick = async () => {
        if (signal?.aborted) {
          await call('ai_cancel', { job })
          resolve({ canceled: true })
          return
        }
        const st = await call('ai_poll', { job })
        if (st?.text && st.text.length !== lastLen) { lastLen = st.text.length; onText?.(st.text) }
        if (!st || st.status === 'missing') { resolve({ error: 'The request was lost. Try again.' }); return }
        if (st.status === 'running') { setTimeout(tick, POLL_MS); return }
        if (st.status === 'error') { resolve({ error: st.error }); return }
        if (st.status === 'canceled') { resolve({ canceled: true }); return }
        resolve({ ...(st.result || {}), _text: st.text })
      }
      setTimeout(tick, POLL_MS)
    })
  })
}

// Settings → AI
export const aiStatus = () => call('ai_status')
export const aiSaveKey = (provider, key) => call('ai_save_key', { provider, key })
export const aiDeleteKey = (provider) => call('ai_delete_key', { provider })
export const aiTest = (provider, { key = '', baseUrl = '' } = {}) =>
  runJob('ai_test', { provider, key, base_url: baseUrl })

// Draft cards and chat
export const aiDraft = (payload, opts) => runJob('ai_draft', payload, opts)
export const aiChat = (payload, opts) => runJob('ai_chat', payload, opts)

// Sources
export const srcForPaper = (paperId, folderPath = '') => call('src_for_paper', { paper_id: paperId, folder_path: folderPath })
export const srcAttachPaperFile = (paperId) => call('src_attach_paper_file', { paper_id: paperId })
export const srcAttachPaperWeb = (paperId, url) => runJob('src_attach_paper_web', { paper_id: paperId, url })
export const srcDetachPaper = (paperId, sourceId) => call('src_detach_paper', { paper_id: paperId, source_id: sourceId })
export const srcPickFile = (caption) => call('src_pick_file', { caption })
export const srcFolderList = (folder) => call('src_folder_list', { folder })
export const srcFolderAttachFile = (folder) => call('src_folder_attach_file', { folder })
export const srcFolderAttachBook = (payload) => call('src_folder_attach_book', payload)
export const srcFolderAttachWeb = (payload) => call('src_folder_attach_web', payload)
export const srcFolderDetach = (folder, sourceId) => call('src_folder_detach', { folder, source_id: sourceId })
export const srcWebInspect = (url) => runJob('src_web_inspect', { url })
export const srcMatch = (folder, chapters) => call('src_match', { folder, chapters })
export const srcSetChapterPaper = (folder, sourceId, key, paperId) =>
  call('src_set_chapter_paper', { folder, source_id: sourceId, key, paper_id: paperId })
export const srcCreateChapterPaper = (folder, sourceId, key) =>
  call('src_create_chapter_paper', { folder, source_id: sourceId, key })
export const srcFoldersSummary = () => call('src_folders_summary')
export const srcGroupFolders = (folder, sourceId) => call('src_group_folders', { folder, source_id: sourceId })
export const srcSetGroupFolder = (folder, sourceId, group, target) => call('src_set_group_folder', { folder, source_id: sourceId, group, target })
export const srcSubfolders = (folder, chapters = []) => call('src_subfolders', { folder, chapters })
export const srcFileUrl = (sourceId) => call('src_file_url', { source_id: sourceId })
export const srcPathUrl = (path) => call('src_path_url', { path })
export const srcPages = (sourceId) => call('src_pages', { source_id: sourceId })
export const srcWebUnits = (sourceId, url, refresh = false) => runJob('src_web_units', { source_id: sourceId, url, refresh })
export const srcWebPage = (sourceId, url, refresh = false) => runJob('src_web_page', { source_id: sourceId, url, refresh })

// ─── Dev mock (Vite only) ──────────────────────────────────────────────
// Lets the whole AI and sources UI run in a browser with no Anki behind it.
export function createAiSourcesMock(papers) {
  const jobs = {}
  let n = 0
  const startJob = (result, text = '', ms = 700) => {
    const id = 'job' + (++n)
    const t0 = Date.now()
    jobs[id] = () => {
      const p = Math.min(1, (Date.now() - t0) / ms)
      if (p < 1) return { status: 'running', text: text.slice(0, Math.floor(text.length * p)) }
      return typeof result === 'function' ? result() : result
    }
    return { job: id }
  }
  const keys = {}
  const reg = { items: {}, papers: {}, folders: {} }
  const cfg = { provider: 'anthropic', model: 'claude-sonnet-5-5' }
  const pub = (it) => ({ ...it, available: true })
  const course = {
    title: 'AI-901T00: Introduction to AI in Azure', kind: 'learn-course', url: 'https://learn.microsoft.com/en-us/training/courses/ai-901t00',
    groups: [
      { title: 'AI concepts for developers and technology professionals', chapters: [
        'Introduction to AI concepts', 'Introduction to generative AI and agents', 'Introduction to natural language processing concepts',
        'Introduction to AI speech concepts', 'Introduction to computer vision concepts', 'Introduction to AI-powered information extraction concepts',
        'Introduction to retrieval-augmented generation concepts'].map((t, i) => ({ key: 'a' + i, title: t, url: 'https://learn.microsoft.com/m/a' + i, group: 'AI concepts for developers and technology professionals' })) },
      { title: 'Get started with AI applications and agents on Azure', chapters: [
        'Get started with AI in Azure', 'Get started with generative AI and agents in Azure', 'Get started with text analysis in Azure',
        'Get started with speech in Azure', 'Get started with computer vision in Azure', 'Get started with AI-powered information extraction in Azure',
        'Get started with Microsoft Foundry IQ'].map((t, i) => ({ key: 'b' + i, title: t, url: 'https://learn.microsoft.com/m/b' + i, group: 'Get started with AI applications and agents on Azure' })) },
    ],
  }
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/^intro\b/, 'introduction').replace(/s\b/g, '').replace(/\s+/g, ' ')
  return {
    ai_status: () => ({ provider: cfg.provider, model: cfg.model, base_url: '', key_store: 'keychain',
      keys: Object.fromEntries(['anthropic', 'gemini', 'openai'].map((p) => [p, { saved: !!keys[p], hint: keys[p] ? '••••••••' + keys[p].slice(-4) : '' }])),
      usage: { drafts: 12, chats: 4, input_tokens: 18230, output_tokens: 4120 }, default_rules: 'One fact per card; keep answers under 8 words.\nPrefer cloze for numbers, doses, cut-offs and short lists.\nKeep the source\'s wording. Don\'t add facts that aren\'t in the selected text.\nNever invent a heading or a tag.', ready: true }),
    ai_save_key: ({ provider, key }) => { keys[provider] = key; return { ok: true, hint: '••••••••' + key.slice(-4), where: 'keychain' } },
    ai_delete_key: ({ provider }) => { delete keys[provider]; return { ok: true } },
    ai_test: ({ provider }) => startJob(provider === 'anthropic'
      ? { status: 'done', result: { models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] } }
      : { status: 'done', result: { models: ['model-a', 'model-b'] } }),
    ai_draft: ({ text, redo_of }) => {
      const cards = redo_of
        ? ['Sacubitril/valsartan <> ARNI (angiotensin receptor–neprilysin inhibitor)']
        : /sacubitril|arni/i.test(text)
          ? ['Drug class of sacubitril/valsartan >> ARNI (angiotensin receptor–neprilysin inhibitor)',
             'Mortality with sacubitril/valsartan vs enalapril in HFrEF >> lower',
             'Start sacubitril/valsartan no sooner than {{c1::36 hours}} after the last ACE inhibitor dose',
             'ACE inhibitor + neprilysin inhibitor overlap <> angioedema']
          : [`Key idea of "${(text || '').slice(0, 40)}" >> (mock answer)`, 'A {{c1::mock}} cloze card']
      return startJob({ status: 'done', result: { cards, model: cfg.model } }, JSON.stringify({ cards }), 900)
    },
    ai_chat: ({ messages }) => {
      const q = messages[messages.length - 1]?.content || ''
      const text = /arb/i.test(q)
        ? 'No. ARBs don\'t affect bradykinin breakdown, so switching from an ARB needs no washout. (general knowledge)'
        : 'ACE inhibitors and neprilysin inhibitors both slow the breakdown of bradykinin. Together, bradykinin builds up and can cause angioedema [line 15]. The 36-hour gap lets the ACE inhibitor clear first [S1 p. 98].'
      return startJob({ status: 'done', result: { text, model: cfg.model } }, text, 1500)
    },
    ai_poll: ({ job }) => (jobs[job] ? jobs[job]() : { status: 'missing' }),
    ai_cancel: ({ job }) => { jobs[job] = () => ({ status: 'canceled' }); return { ok: true } },
    src_for_paper: ({ paper_id }) => {
      const p = papers.find((x) => x.id === paper_id)
      const out = (reg.papers[paper_id] || []).map((sid) => ({ source: pub(reg.items[sid]), scope: 'paper' }))
      const parts = (p?.folder_path || '').split('/').filter(Boolean)
      for (let i = parts.length; i > 0; i--) {
        const folder = parts.slice(0, i).join('/')
        for (const e of reg.folders[folder] || []) {
          const chs = e.chapters.filter((c) => !c.skip)
          const idx = chs.findIndex((c) => c.paper_id === paper_id)
          const title = (pid) => papers.find((x) => x.id === pid)?.title
          out.push({ source: pub(reg.items[e.source_id]), scope: 'folder', folder, chapter: idx >= 0 ? chs[idx] : null,
            chapter_count: chs.length, page_offset: e.page_offset || 0,
            neighbors: idx >= 0 ? { index: idx, count: chs.length,
              prev: chs[idx - 1] ? { ...chs[idx - 1], paper_title: title(chs[idx - 1].paper_id) } : null,
              next: chs[idx + 1] ? { ...chs[idx + 1], paper_title: title(chs[idx + 1].paper_id) } : null } : undefined,
            chapters: idx >= 0 ? undefined : chs.map((c) => ({ ...c, paper_title: title(c.paper_id) })) })
        }
      }
      return { sources: out }
    },
    src_attach_paper_file: ({ paper_id }) => {
      const id = 's' + (++n)
      reg.items[id] = { id, kind: 'pptx', title: 'HF lecture', original_name: 'HF lecture.pptx' }
      ;(reg.papers[paper_id] ||= []).push(id)
      return { ok: true, source: pub(reg.items[id]) }
    },
    src_attach_paper_web: ({ paper_id, url }) => {
      const id = 's' + (++n)
      reg.items[id] = { id, kind: 'web', title: 'ESC heart failure guideline', url }
      ;(reg.papers[paper_id] ||= []).push(id)
      return startJob({ status: 'done', result: { source: pub(reg.items[id]) } })
    },
    src_detach_paper: ({ paper_id, source_id }) => { reg.papers[paper_id] = (reg.papers[paper_id] || []).filter((s) => s !== source_id); return { ok: true } },
    src_pick_file: () => ({ path: '/Users/me/Books/Python Crash Course.pdf', name: 'Python Crash Course.pdf', url: '/.devtest/book.pdf' }),
    src_folder_list: ({ folder }) => ({ sources: (reg.folders[folder] || []).map((e) => ({ ...e, source: pub(reg.items[e.source_id]) })) }),
    src_folder_attach_file: ({ folder }) => {
      const id = 's' + (++n)
      reg.items[id] = { id, kind: 'pdf', title: 'AI-901 study guide', original_name: 'AI-901 study guide.pdf' }
      ;(reg.folders[folder] ||= []).push({ source_id: id, chapters: [] })
      return { ok: true, source: pub(reg.items[id]) }
    },
    src_folder_attach_book: ({ folder, chapters, page_offset, title }) => {
      const id = 's' + (++n)
      reg.items[id] = { id, kind: 'pdf', title: title || 'Book' }
      ;(reg.folders[folder] ||= []).push({ source_id: id, chapters, page_offset })
      return { ok: true, source: pub(reg.items[id]), created: 0, moved: 0 }
    },
    src_folder_attach_web: ({ folder, chapters, title, url, unmatched, group_folders }) => {
      const id = 's' + (++n)
      reg.items[id] = { id, kind: 'web', title, url, web_kind: 'learn-course' }
      let created = 0
      if (unmatched === 'create') for (const c of chapters) if (!c.paper_id && !c.skip) {
        const p = { id: 'p' + (++n), title: c.title, content: `# ${c.title}\n\n`, folder_path: folder, deck_name: 'Default', card_refs: [], tags: [] }
        papers.push(p); c.paper_id = p.id; created++
      }
      ;(reg.folders[folder] ||= []).push({ source_id: id, chapters, unmatched, group_folders: Object.fromEntries(Object.entries(group_folders || {}).map(([g, v]) => [g, String(v).startsWith('new:') ? folder + '/' + v.slice(4) : v])) })
      return { ok: true, source: pub(reg.items[id]), created, moved: 0 }
    },
    src_folder_detach: ({ folder, source_id }) => { reg.folders[folder] = (reg.folders[folder] || []).filter((e) => e.source_id !== source_id); return { ok: true } },
    src_web_inspect: () => startJob({ status: 'done', result: course }, '', 900),
    src_match: ({ folder, chapters }) => {
      const inFolder = papers.filter((p) => p.folder_path === folder || (p.folder_path || '').startsWith(folder + '/'))
      // Rough stand-in for core/sources.py title_similarity.
      const toks = (s) => new Set(norm(s).split(' ').filter((t) => t && !['to', 'and', 'the', 'a', 'of', 'with', 'in', 'on'].includes(t) && !/^\d+$/.test(t)).map((t) => t.replace(/s$/, '')))
      const sim = (a, b) => { const x = toks(a), y = toks(b); if (!x.size || !y.size) return 0; let n = 0; x.forEach((t) => { if (y.has(t)) n++ }); return 2 * n / (x.size + y.size) }
      const pairs = []
      for (const c of chapters) for (const p of inFolder) { const s = sim(c.title, p.title); if (s >= 0.6) pairs.push([s, c.key, p.id]) }
      pairs.sort((a, b) => b[0] - a[0])
      const matches = {}, usedP = new Set()
      for (const [, k, pid] of pairs) if (!matches[k] && !usedP.has(pid)) { matches[k] = pid; usedP.add(pid) }
      return { matches, papers: inFolder.map((p) => ({ id: p.id, title: p.title })) }
    },
    src_set_chapter_paper: () => ({ ok: true }),
    src_create_chapter_paper: ({ folder, source_id, key }) => {
      const e = (reg.folders[folder] || []).find((x) => x.source_id === source_id)
      const c = e?.chapters.find((x) => x.key === key)
      const p = { id: 'p' + (++n), title: c?.title || 'Untitled', content: `# ${c?.title}\n\n`, folder_path: folder, deck_name: 'Default', card_refs: [], tags: [], created_at: Date.now() / 1000, modified_at: Date.now() / 1000 }
      papers.push(p); if (c) c.paper_id = p.id
      return p
    },
    src_folders_summary: () => {
      const folders = {}, waiting = {}
      for (const [f, es] of Object.entries(reg.folders)) {
        if (!es.length) continue
        folders[f] = { kinds: es.map((e) => reg.items[e.source_id]?.kind), chapters: es.reduce((a, e) => a + e.chapters.length, 0),
          sources: es.map((e) => ({ id: e.source_id, title: reg.items[e.source_id]?.title, kind: reg.items[e.source_id]?.kind })) }
        for (const e of es) e.chapters.forEach((c, order) => {
          if (c.paper_id || c.skip) return
          const home = (e.group_folders || {})[c.group] || f
          ;(waiting[home] ||= []).push({ source_id: e.source_id, key: c.key, title: c.title, group: c.group, folder: f, order })
        })
      }
      return { folders, waiting }
    },
    src_subfolders: ({ folder, chapters }) => {
      const subs = ['Software Engineering/Azure/AI-901/1. AI Concepts', 'Software Engineering/Azure/AI-901/2. AI Apps & Agents']
        .filter((p) => p && p.startsWith(folder + '/') && !p.slice(folder.length + 1).includes('/'))
      const uniq = [...new Set(subs)]
      const groups = [...new Set((chapters || []).map((c) => c.group).filter(Boolean))]
      const map = {}
      for (const g of groups) map[g] = /concepts for developers/i.test(g) ? uniq[0] : /applications and agents/i.test(g) ? uniq[1] : ''
      return { subfolders: uniq, map }
    },
    src_group_folders: ({ folder, source_id }) => {
      const e = (reg.folders[folder] || []).find((x) => x.source_id === source_id) || { chapters: [] }
      const groups = [...new Set(e.chapters.map((c) => c.group).filter(Boolean))]
      return { groups, map: e.group_folders || {}, pinned: e.group_folders || {}, subfolders: ['Software Engineering/Azure/AI-901/1. AI Concepts', 'Software Engineering/Azure/AI-901/2. AI Apps & Agents'] }
    },
    src_set_group_folder: ({ folder, source_id, group, target }) => {
      const e = (reg.folders[folder] || []).find((x) => x.source_id === source_id)
      if (e) { e.group_folders ||= {}; if (target === 'auto') delete e.group_folders[group]; else e.group_folders[group] = target }
      return { ok: true }
    },
    src_file_url: () => ({ error: 'PDF viewing needs Anki (dev mock)' }),
    src_path_url: () => ({ error: 'PDF viewing needs Anki (dev mock)' }),
    src_pages: () => ({ pages: [
      { title: 'HFrEF: drugs that save lives', html: '<h2>HFrEF: drugs that save lives</h2><ul><li>ARNI (or ACEi/ARB)</li><li>Evidence-based β-blocker</li><li>Mineralocorticoid receptor antagonist</li><li>SGLT2 inhibitor</li></ul><div class="rd-notes"><b>Speaker notes:</b> start all four early.</div>', text: 'HFrEF: drugs that save lives\nARNI (or ACEi/ARB)\nβ-blocker\nMRA\nSGLT2 inhibitor' },
      { title: 'Switching ACEi → ARNI', html: '<h2>Switching ACEi → ARNI</h2><ul><li>Stop the ACE inhibitor</li><li>Wait 36 h (angioedema)</li><li>Start sacubitril/valsartan 24/26 mg BID</li></ul>', text: 'Switching ACEi to ARNI\nStop the ACE inhibitor\nWait 36 h' },
    ] }),
    src_web_units: ({ url }) => startJob({ status: 'done', result: { units: /\/m\//.test(url)
      ? ['Introduction to AI', 'Generative AI and agents', 'Text and natural language', 'Speech', 'Computer vision'].map((t, i) => ({ title: t, url: url + '/' + (i + 1) }))
      : [{ title: 'Page', url }] } }, '', 300),
    src_web_page: ({ url }) => startJob({ status: 'done', result: { url, title: 'Generative AI and agents', fetched_at: Date.now() / 1000,
      html: '<h1>Generative AI and agents</h1><p>Generative AI describes models that produce new content, such as text, images or code, in response to a prompt written in natural language.</p><p>An agent builds on a generative model: it can reason about a goal, call tools and take actions. <span class="rd-link" data-href="https://learn.microsoft.com">Learn more</span></p>',
      text: 'Generative AI describes models that produce new content in response to a prompt. An agent builds on a generative model.' } }, '', 300),
  }
}
