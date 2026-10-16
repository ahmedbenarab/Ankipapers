import React, { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Card-creation heatmap for the home page: six months side by side, one
// square per day. Each month starts its own columns, Sunday on top and
// Saturday at the bottom. "Cards" here means lines turned into cards (one per
// Anki Papers note), counted by local calendar day from midnight.
//
// `days` is { "YYYY-MM-DD": count } and `firstDay` the earliest such date.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHOWN = 6

const isoDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const fmtDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function level(n) {
  if (!n) return 0
  if (n <= 5) return 1
  if (n <= 15) return 2
  if (n <= 30) return 3
  return 4
}

const fmtAvg = (x) => (Math.round(x * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function CardHeatmap({ days = {}, firstDay = null }) {
  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t }, [])
  const count = (d) => days[isoDay(d)] || 0

  // How many months the rightmost month sits before the current one.
  const [back, setBack] = useState(0)

  // The left arrow stops once the leftmost month shown is the month of the
  // first card; with no cards at all it stays on the current months.
  const monthsOfHistory = useMemo(() => {
    if (!firstDay) return 0
    const [y, m] = firstDay.split('-').map(Number)
    return (today.getFullYear() - y) * 12 + (today.getMonth() - (m - 1))
  }, [firstDay, today])
  const canGoBack = back + MONTHS_SHOWN - 1 < monthsOfHistory

  // Cards and average per day for a month. The current month is averaged
  // over the days so far, so days that haven't happened don't drag it down.
  const monthStats = (y, m) => {
    const isCurrent = y === today.getFullYear() && m === today.getMonth()
    const last = isCurrent ? today.getDate() : new Date(y, m + 1, 0).getDate()
    let total = 0
    for (let i = 1; i <= last; i++) total += count(new Date(y, m, i))
    return { total, average: total / last }
  }

  // Current streak: consecutive days with at least one card, ending today.
  // Today doesn't break it until it is over, so a streak that ran through
  // yesterday still counts this morning.
  const streak = useMemo(() => {
    const d = new Date(today)
    if (!days[isoDay(d)]) d.setDate(d.getDate() - 1)
    let length = 0, total = 0
    while (days[isoDay(d)]) {
      length++
      total += days[isoDay(d)]
      d.setDate(d.getDate() - 1)
    }
    return { length, average: length ? total / length : 0 }
  }, [days, today])

  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) =>
    new Date(today.getFullYear(), today.getMonth() - back - (MONTHS_SHOWN - 1 - i), 1))
  const right = months[MONTHS_SHOWN - 1]
  const rightStats = monthStats(right.getFullYear(), right.getMonth())
  const rightName = right.toLocaleDateString('en-US', { month: 'long' })

  // One tooltip for the whole grid, positioned over the hovered square.
  const boxRef = useRef(null)
  const [tip, setTip] = useState(null)
  const onOver = (e) => {
    const cell = e.target.closest('[data-tip]')
    if (!cell || !boxRef.current) { setTip(null); return }
    const box = boxRef.current.getBoundingClientRect()
    const r = cell.getBoundingClientRect()
    setTip({ text: cell.dataset.tip, x: r.left - box.left + r.width / 2, y: r.top - box.top - 6 })
  }

  return (
    <div className="heatmap" ref={boxRef} onMouseOver={onOver} onMouseLeave={() => setTip(null)}>
      <div className="home-tiles">
        <div className="home-tile">
          <div className="home-tile-label">Current streak</div>
          <div className="home-tile-value">{streak.length} {streak.length === 1 ? 'day' : 'days'}</div>
        </div>
        <div className="home-tile">
          <div className="home-tile-label">Average cards per day, this streak</div>
          <div className="home-tile-value">{fmtAvg(streak.average)}</div>
        </div>
        <div className="home-tile">
          <div className="home-tile-label">Cards in {rightName}</div>
          <div className="home-tile-value">{rightStats.total.toLocaleString()}</div>
        </div>
        <div className="home-tile">
          <div className="home-tile-label">Average per day in {rightName}</div>
          <div className="home-tile-value">{fmtAvg(rightStats.average)}</div>
        </div>
      </div>

      <div className="heatmap-body">
        <button type="button" className="heatmap-nav" aria-label="Previous month" title="Previous month"
          disabled={!canGoBack} onClick={() => setBack((b) => b + 1)}>
          <ChevronLeft size={16} />
        </button>

        <div className="heatmap-center">
        <div className="heatmap-weekdays" aria-hidden="true">
          {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
        </div>

        <div className="heatmap-months">
          {months.map((first) => {
            const y = first.getFullYear(), m = first.getMonth()
            const daysInMonth = new Date(y, m + 1, 0).getDate()
            const stats = monthStats(y, m)
            return (
              <div key={`${y}-${m}`} className="heatmap-month">
                <div className="heatmap-month-name">
                  {first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
                <div className="heatmap-grid">
                  {/* Blank squares before the 1st so it lands on its weekday. */}
                  {Array.from({ length: first.getDay() }, (_, i) => <span key={`b${i}`} />)}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const d = new Date(y, m, i + 1)
                    if (d > today) return <span key={i} className="heatmap-cell is-future" />
                    const n = count(d)
                    return (
                      <span key={i} className={`heatmap-cell lvl-${level(n)}`}
                        data-tip={`Cards created ${fmtDay(d)}: ${n}`} />
                    )
                  })}
                </div>
                <div className="heatmap-month-sum">
                  <b>{stats.total.toLocaleString()}</b> cards<br />
                  <b>{fmtAvg(stats.average)}</b> average per day
                </div>
              </div>
            )
          })}
        </div>
        </div>

        <button type="button" className="heatmap-nav" aria-label="Next month" title="Next month"
          disabled={back === 0} onClick={() => setBack((b) => Math.max(0, b - 1))}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="heatmap-legend" aria-hidden="true">
        Less
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heatmap-cell lvl-${l}`} />)}
        More
        <span className="heatmap-cell is-future heatmap-legend-future" /> Future
      </div>

      {tip && (
        <div className="heatmap-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
      )}
    </div>
  )
}
