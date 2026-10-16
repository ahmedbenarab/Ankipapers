import { useCallback, useRef, useState } from 'react'
import { aiDraft } from './aiBridge'
import { saveSourceLink } from './bridge'

/**
 * Draft cards: one group of AI-drafted lines per paper, kept until it's
 * accepted, discarded or the paper's tab is closed. Drafts never enter the
 * paper's content until accepted, so they aren't saved and Generate skips them.
 *
 * ctx (from BlockEditor.getDraftContext / getDraftAnchor):
 *   { text, headingPath, existing, anchorId, label, source? }
 * source, for text selected in the Sources panel:
 *   { source_id, kind, page, url, quote, title }
 */
export default function useDrafts({ paperRef, onError }) {
  const [groups, setGroups] = useState({}) // paperId -> group
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const abortRef = useRef({}) // paperId -> AbortController
  const seq = useRef(0)

  const patch = useCallback((paperId, fn) => {
    setGroups((prev) => {
      const g = prev[paperId]
      if (!g) return prev
      const next = fn(g)
      if (next === null) { const { [paperId]: _drop, ...rest } = prev; return rest }
      return { ...prev, [paperId]: next }
    })
  }, [])

  const run = useCallback(async (paperId, key, ctx) => {
    abortRef.current[paperId]?.abort()
    const ctl = new AbortController()
    abortRef.current[paperId] = ctl
    const res = await aiDraft({ text: ctx.text, heading_path: ctx.headingPath || [], existing: ctx.existing || [] }, { signal: ctl.signal })
    if (groupsRef.current[paperId]?.key !== key) return
    if (res.canceled) { patch(paperId, () => null); return }
    if (res.error) { patch(paperId, (g) => ({ ...g, status: 'error', error: res.error })); return }
    const items = (res.cards || []).map((text) => ({ id: `d${++seq.current}`, text, pageLabel: ctx.source?.pageLabel || null }))
    patch(paperId, (g) => (items.length
      ? { ...g, status: 'ready', items, model: res.model, error: null }
      : { ...g, status: 'error', error: 'Nothing in that text looked worth a card.' }))
  }, [patch])

  const startDraft = useCallback((ctx) => {
    const paper = paperRef.current
    if (!paper || !ctx?.text?.trim()) {
      onError?.('Click into a line, or select some lines, to draft cards from.')
      return
    }
    const key = `g${++seq.current}`
    const group = {
      key, family: key, paperId: paper.id, anchorId: ctx.anchorId, acceptedTexts: [], label: ctx.label || 'the selection',
      status: 'loading', items: [], error: null, model: null, accepted: 0, ctx,
      source: ctx.source || null, sourceKind: ctx.source?.kind || null,
    }
    setGroups((prev) => ({ ...prev, [paper.id]: group }))
    run(paper.id, key, ctx)
  }, [paperRef, run, onError])

  const groupFor = useCallback((paperId) => groups[paperId] || null, [groups])

  const accept = useCallback((paperId, inserted) => {
    const g = groupsRef.current[paperId]
    if (!g) return
    const ids = new Set(inserted.map((x) => x.id))
    if (g.source) {
      for (const x of inserted) {
        if (!x.blockId) continue
        saveSourceLink(paperId, x.blockId, {
          source_type: 'attached',
          source_uri: g.source.source_id,
          locator: { page: g.source.page || null, url: g.source.url || null },
          captured_text: g.source.quote || '',
        })
      }
    }
    patch(paperId, (cur) => ({
      ...cur,
      items: cur.items.filter((i) => !ids.has(i.id)),
      accepted: cur.accepted + inserted.length,
      acceptedTexts: [...cur.acceptedTexts, ...inserted.map((x) => x.text)],
    }))
  }, [patch])

  const discard = useCallback((paperId, ids) => {
    const drop = new Set(ids)
    patch(paperId, (g) => {
      const items = g.items.filter((i) => !drop.has(i.id))
      return items.length || g.accepted ? { ...g, items } : null
    })
  }, [patch])

  const edit = useCallback((paperId, id, text) => {
    patch(paperId, (g) => ({ ...g, items: g.items.map((i) => (i.id === id ? { ...i, text } : i)) }))
  }, [patch])

  const redo = useCallback(async (paperId, id) => {
    const g = groupsRef.current[paperId]
    const item = g?.items.find((i) => i.id === id)
    if (!item) return
    patch(paperId, (cur) => ({ ...cur, items: cur.items.map((i) => (i.id === id ? { ...i, busy: true } : i)) }))
    const res = await aiDraft({ text: g.ctx.text, heading_path: g.ctx.headingPath || [], redo_of: item.text })
    const text = !res.error && res.cards?.[0]
    patch(paperId, (cur) => ({ ...cur, items: cur.items.map((i) => (i.id === id ? { ...i, busy: false, text: text || i.text } : i)) }))
    if (!text) onError?.(res.error || 'Couldn’t redo that card.')
  }, [patch, onError])

  const redraft = useCallback((paperId) => {
    const g = groupsRef.current[paperId]
    if (!g) return
    const key = `g${++seq.current}`
    // Same family, so the group stays below cards already accepted from it,
    // and those cards count as existing so they aren't drafted again.
    const ctx = { ...g.ctx, existing: [...(g.ctx.existing || []), ...g.acceptedTexts] }
    setGroups((prev) => ({ ...prev, [paperId]: { ...g, key, ctx, status: 'loading', items: [], error: null } }))
    run(paperId, key, ctx)
  }, [run])

  const cancel = useCallback((paperId) => {
    abortRef.current[paperId]?.abort()
    patch(paperId, () => null)
  }, [patch])

  const pendingCount = useCallback((paperId) => groups[paperId]?.items?.length || 0, [groups])

  return { groupFor, startDraft, accept, discard, edit, redo, redraft, cancel, dropPaper: cancel, pendingCount }
}
