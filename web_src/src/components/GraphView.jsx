import React, { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { X, Search, Layers, FileText } from 'lucide-react'
import { collectLinks, buildGraph } from '../docLinks'

/**
 * Graph of how the documents connect.
 *
 * The layout is a small force simulation (repulsion + edge springs + a gentle
 * pull to center) run on an SVG. Hand-rolled rather than pulled from a
 * charting library so the add-on bundle stays small and there is no runtime
 * dependency to keep working inside Anki's webview.
 *
 * Two rules keep it cheap, which matters because this runs inside Anki's
 * embedded Chromium rather than a browser tab:
 *
 *   1. The simulation STOPS. Once nothing is moving any more the animation
 *      frame is canceled outright, so an open graph costs nothing until you
 *      touch it. It used to coast forever at 60fps — measured at roughly half
 *      a CPU core, indefinitely, on a graph of five nodes.
 *
 *   2. Frames don't go through React. The loop writes `transform` and the
 *      line endpoints straight onto the DOM nodes it holds refs to. React
 *      re-renders only when the SET of nodes changes, or when you hover or
 *      search — not sixty times a second.
 */

// Movement below this (px per frame, x+y summed) counts as "at rest".
const SETTLE_PX = 0.2
// ...and once it has been at rest this many frames, stop the loop.
const SETTLE_FRAMES = 30

export default function GraphView({ papers, currentPaperId, onOpen, onClose }) {
  const [mode, setMode] = useState('documents')
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState(null)

  const svgRef = useRef(null)
  const rootGRef = useRef(null)
  const simRef = useRef({ nodes: [], edges: [], byId: new Map() })
  const nodeElsRef = useRef(new Map())
  const edgeElsRef = useRef(new Map())
  const dragRef = useRef(null)
  const panRef = useRef(null)
  const rafRef = useRef(null)
  const runningRef = useRef(false)
  const stepRef = useRef(null)
  const alphaRef = useRef(1)
  const calmRef = useRef(0)
  const viewRef = useRef({ x: 0, y: 0, k: 1 })

  const links = useMemo(() => collectLinks(papers), [papers])
  const graph = useMemo(() => buildGraph(papers, links, mode), [papers, links, mode])

  // Only show documents that actually participate; an atlas of isolated dots
  // is noise. Documents with no links at all are hidden.
  const visible = useMemo(() => {
    const connected = new Set()
    for (const e of graph.edges) { connected.add(e.from); connected.add(e.to) }
    const nodes = graph.nodes.filter((n) => connected.has(n.id) || n.paperId === currentPaperId)
    const ids = new Set(nodes.map((n) => n.id))
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) }
  }, [graph, currentPaperId])

  // ── painting: the only thing that touches the DOM per frame ──
  const paint = useCallback(() => {
    const { nodes, edges, byId } = simRef.current
    for (const n of nodes) {
      const el = nodeElsRef.current.get(n.id)
      if (el) el.setAttribute('transform', `translate(${n.x},${n.y})`)
    }
    for (const e of edges) {
      const el = edgeElsRef.current.get(e.key)
      if (!el) continue
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      if (!a || !b) continue
      el.setAttribute('x1', a.x)
      el.setAttribute('y1', a.y)
      el.setAttribute('x2', b.x)
      el.setAttribute('y2', b.y)
    }
  }, [])

  const applyView = useCallback(() => {
    const v = viewRef.current
    rootGRef.current?.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`)
  }, [])

  /** Wake the simulation back up (and re-heat it a little) after it settled. */
  const kick = useCallback((heat = 0.3) => {
    alphaRef.current = Math.max(alphaRef.current, heat)
    calmRef.current = 0
    if (runningRef.current || !stepRef.current) return
    runningRef.current = true
    rafRef.current = requestAnimationFrame(stepRef.current)
  }, [])

  // ── force simulation ──
  useLayoutEffect(() => {
    // Center on the ACTUAL canvas, not a guess — otherwise the cluster settles
    // in a corner on wide screens.
    const box = svgRef.current?.getBoundingClientRect()
    const W = Math.max(320, box?.width || 900)
    const H = Math.max(240, box?.height || 600)
    const nodes = visible.nodes.map((n, i) => {
      const prev = simRef.current.byId.get(n.id)
      const angle = (i / Math.max(1, visible.nodes.length)) * Math.PI * 2
      return {
        ...n,
        x: prev?.x ?? W / 2 + Math.cos(angle) * (140 + (i % 5) * 26),
        y: prev?.y ?? H / 2 + Math.sin(angle) * (140 + (i % 7) * 22),
        vx: 0, vy: 0, fixed: false,
      }
    })
    const byId = new Map(nodes.map((n) => [n.id, n]))
    simRef.current = { nodes, edges: visible.edges, byId }
    paint()

    alphaRef.current = 1
    calmRef.current = 0

    const step = () => {
      const { nodes: ns, edges: es } = simRef.current
      const alpha = alphaRef.current
      // repulsion
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1 }
          const d = Math.sqrt(d2)
          const rep = 5200 / d2
          const fx = (dx / d) * rep, fy = (dy / d) * rep
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
        }
      }
      // springs
      for (const e of es) {
        const a = byId.get(e.from), b = byId.get(e.to)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const rest = e.kind === 'contains' ? 60 : 150
        const k = e.kind === 'contains' ? 0.06 : 0.03
        const f = (d - rest) * k
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
      }
      // center + integrate
      let maxMove = 0
      for (const n of ns) {
        n.vx += (W / 2 - n.x) * 0.004
        n.vy += (H / 2 - n.y) * 0.004
        if (n.fixed) { n.vx = 0; n.vy = 0; continue }
        n.vx *= 0.82; n.vy *= 0.82
        const mx = Math.max(-24, Math.min(24, n.vx * alpha))
        const my = Math.max(-24, Math.min(24, n.vy * alpha))
        n.x += mx; n.y += my
        const moved = Math.abs(mx) + Math.abs(my)
        if (moved > maxMove) maxMove = moved
      }
      // Let alpha reach a true zero. It used to bottom out at 0.02 — small
      // enough to look still, large enough to never stop.
      alphaRef.current = alpha < 0.01 ? 0 : alpha * 0.985
      paint()

      if (maxMove < SETTLE_PX && !dragRef.current) calmRef.current += 1
      else calmRef.current = 0

      if (calmRef.current >= SETTLE_FRAMES) {
        // At rest. Stop completely rather than burning a frame every 16ms for
        // the rest of the session.
        runningRef.current = false
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }

    stepRef.current = step
    runningRef.current = true
    rafRef.current = requestAnimationFrame(step)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      runningRef.current = false
      stepRef.current = null
    }
  }, [visible, paint])

  // Any React re-render (hover, search, mode) re-attaches the element refs, so
  // put the positions back on them. Cheap, and it keeps the DOM honest whether
  // or not the simulation happens to be running.
  useLayoutEffect(() => {
    paint()
    applyView()
  })

  // Don't animate a window nobody is looking at.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        runningRef.current = false
      } else {
        kick(0.1)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [kick])

  // ── pointer interaction ──
  const toLocal = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect()
    const v = viewRef.current
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }
  }, [])

  const onNodeDown = (e, id) => {
    e.stopPropagation()
    // Stop the webview from starting a native drag session for the element.
    e.preventDefault()
    const node = simRef.current.byId.get(id)
    if (!node) return
    const p = toLocal(e)
    dragRef.current = { id, dx: node.x - p.x, dy: node.y - p.y }
    node.fixed = true
    kick(0.15)
  }

  const onMove = (e) => {
    if (dragRef.current) {
      const n = simRef.current.byId.get(dragRef.current.id)
      if (n) {
        const p = toLocal(e)
        n.x = p.x + dragRef.current.dx
        n.y = p.y + dragRef.current.dy
      }
      kick(0.15)
      return
    }
    if (panRef.current) {
      const v = viewRef.current
      viewRef.current = {
        ...v,
        x: panRef.current.ox + (e.clientX - panRef.current.sx),
        y: panRef.current.oy + (e.clientY - panRef.current.sy),
      }
      // Panning writes the transform straight to the DOM. Routing it through
      // React state meant a full re-render on every single mousemove.
      applyView()
    }
  }

  const onUp = () => {
    if (dragRef.current) {
      const n = simRef.current.byId.get(dragRef.current.id)
      if (n) n.fixed = false
      kick(0.25)   // let the neighbors settle around where you dropped it
    }
    dragRef.current = null
    panRef.current = null
  }

  const onBgDown = (e) => {
    e.preventDefault()
    const v = viewRef.current
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y }
  }

  const onWheel = (e) => {
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const v = viewRef.current
    viewRef.current = { ...v, k: Math.max(0.25, Math.min(3, v.k * factor)) }
    applyView()
  }

  const q = query.trim().toLowerCase()
  const matches = (n) => q && n.label.toLowerCase().includes(q)
  const neighbors = useMemo(() => {
    if (!hover) return null
    const set = new Set([hover])
    for (const e of visible.edges) {
      if (e.from === hover) set.add(e.to)
      if (e.to === hover) set.add(e.from)
    }
    return set
  }, [hover, visible.edges])

  const linkCount = links.filter((l) => !l.dangling).length
  const danglingCount = links.filter((l) => l.dangling).length

  return (
    <div className="graph-backdrop">
      <div className="graph-window">
        <div className="graph-head">
          <span className="graph-title">Link graph</span>
          <div className="graph-modes">
            <button className={mode === 'documents' ? 'is-active' : ''} onClick={() => setMode('documents')}>
              <FileText size={12} /> Documents
            </button>
            <button className={mode === 'headers' ? 'is-active' : ''} onClick={() => setMode('headers')}>
              <Layers size={12} /> Headers
            </button>
          </div>
          <div className="graph-search">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find…" />
          </div>
          <button className="graph-close" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <svg
          ref={svgRef}
          className="graph-svg"
          onMouseDown={onBgDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onWheel={onWheel}
          onDragStart={(e) => e.preventDefault()}
        >
          <g ref={rootGRef}>
            {visible.edges.map((e) => {
              const dim = neighbors && !(neighbors.has(e.from) && neighbors.has(e.to))
              return (
                <line
                  key={e.key}
                  ref={(el) => {
                    if (el) edgeElsRef.current.set(e.key, el)
                    else edgeElsRef.current.delete(e.key)
                  }}
                  className={`graph-edge ${e.kind === 'contains' ? 'is-contains' : ''} ${dim ? 'is-dim' : ''}`}
                  strokeWidth={e.kind === 'contains' ? 1 : Math.min(5, 1 + e.weight)}
                />
              )
            })}
            {visible.nodes.map((n) => {
              // Documents read as the big anchors; headings sit smaller and
              // shrink with depth, so a chain like
              //   Document → H1 → H2 → the linked section
              // is legible as a hierarchy at a glance.
              const r = n.kind === 'header'
                ? Math.max(4.5, 8.5 - (n.level || 1) * 1.1)
                : Math.min(22, 12 + Math.sqrt(n.degree) * 2.2)
              const dim = neighbors && !neighbors.has(n.id)
              return (
                <g
                  key={n.id}
                  ref={(el) => {
                    if (el) {
                      nodeElsRef.current.set(n.id, el)
                      const s = simRef.current.byId.get(n.id)
                      if (s) el.setAttribute('transform', `translate(${s.x},${s.y})`)
                    } else {
                      nodeElsRef.current.delete(n.id)
                    }
                  }}
                  className={`graph-node ${n.kind} ${dim ? 'is-dim' : ''} ${matches(n) ? 'is-match' : ''} ${n.paperId === currentPaperId ? 'is-current' : ''}`}
                  onMouseDown={(e) => onNodeDown(e, n.id)}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    onOpen(n.paperId, n.lineIndex)
                  }}
                >
                  <circle r={r} />
                  <text y={r + 12} textAnchor="middle">
                    {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="graph-foot">
          <span>{visible.nodes.length} nodes · {linkCount} links{danglingCount ? ` · ${danglingCount} broken` : ''}</span>
          <span>drag to pan · scroll to zoom · drag a node to move it · double-click a node to open</span>
        </div>
      </div>
    </div>
  )
}
