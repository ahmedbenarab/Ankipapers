import { useSyncExternalStore } from 'react'

// The toolbar timer's countdown. It lives here rather than in a component
// because the toolbar unmounts whenever no paper is open (the home page), and
// the countdown has to keep going and still raise its popup there.
//
// Times are four digits, MMSS ("2500" is 25:00). The countdown runs against a
// fixed end time, so a busy moment in Anki never makes it fall behind.

let state = {
  last: '',        // the most recent time started, MMSS; '' until the first start
  remain: 0,       // seconds left; 0 with running false means nothing is set
  running: false,
  done: false,     // reached 00:00 and the popup is up
}
let endAt = 0
let tick = null
const listeners = new Set()
let onLastChange = null

function set(next) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export function secondsOf(mmss) {
  if (!/^\d{4}$/.test(mmss || '')) return 0
  return parseInt(mmss.slice(0, 2), 10) * 60 + parseInt(mmss.slice(2), 10)
}

export function formatSeconds(s) {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function left() {
  return Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
}

function run(seconds) {
  clearInterval(tick)
  endAt = Date.now() + seconds * 1000
  set({ remain: seconds, running: true, done: false })
  tick = setInterval(() => {
    const remain = left()
    if (remain === 0) {
      clearInterval(tick)
      tick = null
      set({ remain: 0, running: false, done: true })
    } else if (remain !== state.remain) {
      set({ remain })
    }
  }, 250)
}

export const timer = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get() { return state },

  /** The saved last time, read from Settings once they load. */
  setLast(mmss) {
    if (/^\d{4}$/.test(mmss || '') && secondsOf(mmss) > 0 && mmss !== state.last) set({ last: mmss })
  },
  /** Called with the new MMSS whenever a different time is started. */
  onLastChange(fn) { onLastChange = fn },

  /** Start a typed time (partly typed is filled out with zeros), or the last
   *  time when nothing was typed. Returns false if there is nothing to run. */
  start(typed) {
    const mmss = typed ? typed.padEnd(4, '0') : state.last
    const seconds = secondsOf(mmss)
    if (!seconds) return false
    if (mmss !== state.last) {
      set({ last: mmss })
      if (onLastChange) onLastChange(mmss)
    }
    run(seconds)
    return true
  },
  pause() {
    if (!state.running) return
    clearInterval(tick)
    tick = null
    set({ remain: left(), running: false })
  },
  resume() {
    if (state.running || state.remain <= 0) return
    run(state.remain)
  },
  /** Stop, and set the clock back to the last time started. */
  stop() {
    clearInterval(tick)
    tick = null
    set({ remain: secondsOf(state.last), running: false, done: false })
  },
  /** Clear the clock so new digits can be typed. */
  clear() {
    if (state.running) return
    set({ remain: 0, done: false })
  },
}

/** The timer's state in a component; re-renders on every change. */
export function useTimer() {
  return useSyncExternalStore(timer.subscribe, timer.get)
}
