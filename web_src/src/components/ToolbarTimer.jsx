import React, { useEffect, useRef, useState } from 'react'
import { Timer, Play, Pause, Square } from 'lucide-react'
import { timer, useTimer, secondsOf, formatSeconds } from '../timerStore'

// The countdown timer in the toolbar, just after the deck picker. Closed, it
// is one icon; clicked, it opens a MM:SS box with play/pause and stop. Digits
// fill the box left to right ("2500" is 25:00), the faint digits behind them
// are the last time started (play with nothing typed runs that), and stop
// sets the clock back to the last time. The countdown itself lives in
// timerStore, so it keeps going on other tabs and on the home page.
export default function ToolbarTimer() {
  const t = useTimer()
  const [open, setOpen] = useState(false)
  const [digits, setDigits] = useState('')
  const [focused, setFocused] = useState(false)
  const boxRef = useRef(null)

  // A set clock (running, paused, stopped or at 00:00) keeps the box open.
  const active = t.running || t.done || t.remain > 0
  const shown = open || active
  const typing = !active

  useEffect(() => {
    if (open && boxRef.current) boxRef.current.focus()
  }, [open])

  const focusBox = () => requestAnimationFrame(() => boxRef.current && boxRef.current.focus())

  const play = () => {
    if (t.running) { timer.pause(); return }
    if (t.done) { timer.start(''); return }
    if (t.remain > 0) { timer.resume(); return }
    if (timer.start(digits)) setDigits('')
    else focusBox()
  }

  const stop = () => {
    setDigits('')
    timer.stop()
  }

  const onKeyDown = (e) => {
    // Everything typed here stays here: no editor or app shortcut sees it.
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); play(); return }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!active) { setDigits(''); setOpen(false) }
      return
    }
    if (t.running || t.done) return
    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      // Typing over a stopped or paused clock starts a new time.
      const base = active ? '' : digits
      if (active) timer.clear()
      if (base.length >= 4) return
      // The first seconds digit is 0-5, so there is no 00:90.
      if (base.length === 2 && Number(e.key) > 5) { if (active) setDigits(''); return }
      setDigits(base + e.key)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (active) { timer.clear(); setDigits(''); return }
      setDigits((d) => d.slice(0, -1))
    }
  }

  // Clicking a stopped clock clears it for a new time; a paused one just
  // takes focus, so a stray click never loses the time left.
  const onBoxMouseDown = () => {
    if (!t.running && !t.done && t.remain > 0 && t.remain === secondsOf(t.last)) {
      timer.clear()
      setDigits('')
    }
  }

  if (!shown) {
    return (
      <button className="header-icon-btn toolbar-timer-icon" title="Timer" aria-label="Timer"
        onClick={() => setOpen(true)}>
        <Timer size={16} />
      </button>
    )
  }

  let slots
  if (typing) {
    const ghost = t.last || ''
    slots = []
    for (let i = 0; i < 4; i++) {
      if (i === 2) slots.push(<span key="c" className="timer-colon">:</span>)
      const typed = i < digits.length
      const ch = typed ? digits[i] : (ghost[i] || '')
      const cls = ['timer-digit']
      if (!typed && ch) cls.push('ghost')
      if (focused && i === digits.length) cls.push('caret')
      slots.push(<span key={i} className={cls.join(' ')}>{ch || ' '}</span>)
    }
    if (focused && digits.length === 4) slots.push(<span key="end" className="timer-digit timer-caret-end caret" />)
  } else {
    slots = formatSeconds(t.remain).split('').map((ch, i) => (
      ch === ':' ? <span key={i} className="timer-colon">:</span>
        : <span key={i} className="timer-digit">{ch}</span>
    ))
  }

  return (
    <div className="toolbar-timer">
      <button className="header-icon-btn toolbar-timer-icon"
        title={active ? 'Timer' : 'Close the timer (Esc)'} aria-label="Timer"
        onClick={() => { if (!active) { setDigits(''); setOpen(false) } else focusBox() }}>
        <Timer size={16} />
      </button>
      <div
        ref={boxRef}
        className={`timer-box ${t.done ? 'done' : ''}`}
        role="timer"
        aria-label={typing ? 'Type minutes and seconds' : `${formatSeconds(t.remain)} left`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={onBoxMouseDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {slots}
      </div>
      <button className="header-icon-btn timer-play"
        title={t.running ? 'Pause' : 'Start (Enter)'} aria-label={t.running ? 'Pause' : 'Start'}
        onMouseDown={(e) => e.preventDefault()} onClick={play}>
        {t.running ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button className="header-icon-btn"
        title={t.last ? `Stop and reset to ${formatSeconds(secondsOf(t.last))}` : 'Stop'} aria-label="Stop"
        onMouseDown={(e) => e.preventDefault()} onClick={stop}>
        <Square size={13} />
      </button>
    </div>
  )
}

// The popup when the countdown reaches 00:00. Rendered by App, so it shows on
// any tab and on the home page. Dismiss (or Esc) sets the clock back to the
// last time; Restart runs that time again.
export function TimerDonePopup() {
  const t = useTimer()

  useEffect(() => {
    if (!t.done) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); timer.stop() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [t.done])

  if (!t.done) return null
  const secs = secondsOf(t.last)
  const m = Math.floor(secs / 60), s = secs % 60
  const length = [m ? `${m} min` : '', s ? `${s} sec` : ''].filter(Boolean).join(' ')
  return (
    <div className="modal-overlay timer-done-overlay">
      <div className="modal timer-done" role="alertdialog" aria-labelledby="timer-done-title">
        <div className="timer-done-ring"><Timer size={22} /></div>
        <div className="timer-done-title" id="timer-done-title">Time's up</div>
        <p className="timer-done-text">Your {length} timer finished.</p>
        <div className="timer-done-actions">
          <button type="button" className="modal-btn" onClick={() => timer.stop()}>Dismiss</button>
          <button type="button" className="modal-btn primary" onClick={() => timer.start('')}>
            Restart {formatSeconds(secs)}
          </button>
        </div>
      </div>
    </div>
  )
}
