/** Stable key for one entry in a paper's sources list (see gui/ai_sources.py src_for_paper). */
export const sourceKey = (s) => `${s.scope}:${s.folder || ''}:${s.source.id}`
