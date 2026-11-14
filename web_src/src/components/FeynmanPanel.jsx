import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Mic, Square, Loader2, RotateCcw, ArrowRight, ChevronDown, Check, Minus, Send, Settings as SettingsIcon } from 'lucide-react'
import { feynmanCounts, feynmanAudioChunk, feynmanTranscribe, feynmanGrade, feynmanMics, feynmanMicAccess, feynmanOpenMicSettings } from '../aiBridge'
import { readFeynman, micLabel } from '../feynman'
import { currentHeadingIndex } from '../outline'

// The Feynman panel (the F in the editor header, Settings → AI → Feynman):
// pick an H1–H3 heading, explain it out loud, and get a score for how many of
// that section's answers you described. Recording happens here; transcription
// and grading are background jobs in Python (gui/feynman.py, core/feynman.py),
// which also owns the answer key, so the count and the score always agree.
// Next topic writes the score onto the heading (feynman.js) and moves on.

const MAX_SECONDS = 600 // 10 minutes
// Below this peak level the recording is all but silent. A model handed
// silence tends to invent words ("wait, wait, wait..."), so it isn't sent.
const SILENT_PEAK = 0.02
// When the system refuses Anki the microphone, the web engine still opens it
// and gets exact silence, with no error. Python can ask the system
// (feynman_mic_access); a recording of pure zeros is the same thing seen
// from this side.
const BLOCKED_MSG = 'Your system isn’t letting Anki use the microphone, so every recording is silent. '
  + 'Turn Anki on in System Settings → Privacy & Security → Microphone, then quit and reopen Anki.'
const MIC_KEY = 'ankipapers.feynman.mic'

function savedMic() {
  try { return localStorage.getItem(MIC_KEY) || '' } catch { return '' }
}
function saveMic(id) {
  try { localStorage.setItem(MIC_KEY, id) } catch { /* private storage off */ }
}
const CHUNK_BYTES = 512 * 1024
const SAMPLE_RATE = 16000

function clock(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A recorded blob as 16 kHz mono 16-bit WAV, which both OpenAI and Gemini
 *  accept, with its loudest sample (0–1) so silence can be caught. */
async function toWav(blob) {
  const raw = await blob.arrayBuffer()
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  let decoded
  try { decoded = await ctx.decodeAudioData(raw) } finally { ctx.close?.() }
  const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const pcm = (await off.startRendering()).getChannelData(0)
  let peak = 0
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a }
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, SAMPLE_RATE, true); out.setUint32(28, SAMPLE_RATE * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  str(36, 'data'); out.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return { wav: new Uint8Array(out.buffer), peak }
}

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const VERDICT = {
  covered: { Icon: Check, cls: 'is-covered', label: 'Described' },
  missed: { Icon: Minus, cls: 'is-missed', label: 'Missed' },
  contradicted: { Icon: X, cls: 'is-contradicted', label: 'Contradicted' },
}

export default function FeynmanPanel({ paper, outline, visibleLine, onClose, onSelectTopic, onSaveScore, onGoToLine }) {
  const content = paper?.content || ''
  const items = useMemo(() => outline || [], [outline])
  const [topic, setTopic] = useState(() => {
    const at = currentHeadingIndex(items, visibleLine ?? 0)
    return at >= 0 ? at : (items[0]?.index ?? null)
  })
  const [counts, setCounts] = useState({})
  const [menuOpen, setMenuOpen] = useState(false)
  // idle → recording → checking → review (listen back, then Submit) →
  // transcribing → grading → done
  const [phase, setPhase] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const recRef = useRef(null) // { recorder, stream, chunks, timer, meter }
  // Which microphone, remembered on this computer, and how loud it is.
  const [mics, setMics] = useState([])
  // The Mac's own names for its inputs: a page only gets shortened ones
  // ("AirPods" for any AirPods), see micLabel in feynman.js.
  const [systemMics, setSystemMics] = useState([])
  const [micId, setMicId] = useState(savedMic)
  const [level, setLevel] = useState(0)
  const [audioUrl, setAudioUrl] = useState(null)
  const [blocked, setBlocked] = useState(false) // the system refuses Anki the microphone
  const wavRef = useRef(null) // the recording waiting for Submit
  const abortRef = useRef(null)
  const menuRef = useRef(null)

  const current = items.find((it) => it.index === topic) || null
  const lines = useMemo(() => content.split('\n'), [content])
  const lastOf = (index) => readFeynman(lines[index])
  const answers = topic != null ? counts[String(topic)] : undefined

  // Recording and grading read these when they finish, not when they began.
  const systemMicsRef = useRef(systemMics)
  systemMicsRef.current = systemMics
  const contentRef = useRef(content)
  contentRef.current = content
  const topicRef = useRef(topic)
  topicRef.current = topic

  // The topic follows its heading when lines are added or removed above it
  // (found again by its text), and falls back to the first heading if it's gone.
  const topicTextRef = useRef(null)
  useEffect(() => {
    if (!items.length) { if (topic !== null) setTopic(null); return }
    const here = items.find((it) => it.index === topic)
    if (here && (topicTextRef.current == null || here.text === topicTextRef.current)) {
      topicTextRef.current = here.text
      return
    }
    const same = items.filter((it) => it.text === topicTextRef.current)
    const moved = same.sort((a, b) => Math.abs(a.index - (topic ?? 0)) - Math.abs(b.index - (topic ?? 0)))[0]
    const pick = moved || here || items[0]
    topicTextRef.current = pick.text
    if (pick.index !== topic) setTopic(pick.index)
  }, [items, topic])

  useEffect(() => { onSelectTopic?.(topic) }, [topic, onSelectTopic])
  useEffect(() => () => onSelectTopic?.(null), [onSelectTopic])

  // Answers under each heading, from the same key the grade uses.
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      feynmanCounts(content).then((r) => { if (live && r?.counts) setCounts(r.counts) })
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [content])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const listMics = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setMics(all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
    } catch { setMics([]) }
    feynmanMics().then((r) => { if (Array.isArray(r?.inputs)) setSystemMics(r.inputs.map((m) => m.name)) })
  }, [])
  useEffect(() => {
    listMics()
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', listMics)
    return () => md?.removeEventListener?.('devicechange', listMics)
  }, [listMics])

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])

  const stopMeter = (r) => {
    if (!r?.meter) return
    cancelAnimationFrame(r.meter.raf)
    r.meter.ctx.close?.()
    r.meter = null
    setLevel(0)
  }

  const cancelAll = useCallback(() => {
    const r = recRef.current
    if (r) {
      stopMeter(r)
      r.discard = true
      try { if (r.recorder.state !== 'inactive') r.recorder.stop() } catch { /* already stopped */ }
      clearInterval(r.timer)
      r.stream?.getTracks().forEach((t) => t.stop())
      recRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  useEffect(() => cancelAll, [cancelAll])

  const reset = () => {
    cancelAll()
    wavRef.current = null
    setPhase('idle'); setSeconds(0); setTranscript(''); setResult(null); setError(null); setAudioUrl(null); setBlocked(false)
  }

  const pickTopic = (index) => {
    setMenuOpen(false)
    if (index === topic) return
    reset()
    topicTextRef.current = items.find((it) => it.index === index)?.text ?? null
    setTopic(index)
    onGoToLine?.(index)
  }

  // A finished recording: nothing is sent yet. It waits in review, where it
  // can be played back, until Submit. A silent one never gets that far.
  const checkRecording = async (blob, usedMic) => {
    setPhase('checking')
    try {
      const { wav, peak } = await toWav(blob)
      if (peak < 1e-5) {
        setBlocked(true)
        throw new Error(BLOCKED_MSG)
      }
      if (peak < SILENT_PEAK) {
        throw new Error(`Almost no sound came from “${usedMic || 'the microphone'}”, so there is nothing to submit. `
          + 'Pick another microphone below, or play the recording back to check it.')
      }
      wavRef.current = wav
      setPhase('review')
    } catch (e) {
      wavRef.current = null
      setError(e?.message || String(e))
      setPhase('idle')
    }
  }

  // Submit: the recording goes to be transcribed, then the transcript to be graded.
  const submit = async () => {
    const wav = wavRef.current
    if (!wav || phase !== 'review') return
    const ctl = new AbortController()
    abortRef.current = ctl
    setError(null)
    try {
      setPhase('transcribing')
      const upload = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      for (let seq = 0, off = 0; off < wav.length; seq++, off += CHUNK_BYTES) {
        if (ctl.signal.aborted) return
        const r = await feynmanAudioChunk(upload, seq, toBase64(wav.subarray(off, off + CHUNK_BYTES)))
        if (r?.error) throw new Error(r.error)
      }
      const tr = await feynmanTranscribe(upload, 'audio/wav', { signal: ctl.signal })
      if (tr.canceled) return
      if (tr.error) throw new Error(tr.error)
      setTranscript(tr.transcript || '')
      setPhase('grading')
      const g = await feynmanGrade(contentRef.current, topicRef.current, tr.transcript || '', { signal: ctl.signal })
      if (g.canceled) return
      if (g.error) throw new Error(g.error)
      setResult(g)
      setPhase('done')
    } catch (e) {
      if (ctl.signal.aborted) return
      setError(e?.message || String(e))
      // Back to review when it never got transcribed, so Submit can be pressed again.
      setPhase((p) => (p === 'transcribing' ? 'review' : 'idle'))
    } finally {
      if (abortRef.current === ctl) abortRef.current = null
    }
  }

  // Grading failed after a good transcript (a bad key, a busy provider):
  // grade the same words again without recording them again.
  const regrade = async () => {
    const ctl = new AbortController()
    abortRef.current = ctl
    setError(null)
    setPhase('grading')
    try {
      const g = await feynmanGrade(contentRef.current, topicRef.current, transcript, { signal: ctl.signal })
      if (g.canceled) return
      if (g.error) throw new Error(g.error)
      setResult(g)
      setPhase('done')
    } catch (e) {
      if (ctl.signal.aborted) return
      setError(e?.message || String(e))
      setPhase('idle')
    } finally {
      if (abortRef.current === ctl) abortRef.current = null
    }
  }

  const start = async () => {
    setError(null); setResult(null); setTranscript(''); setBlocked(false)
    setAudioUrl(null)
    wavRef.current = null
    // Ask the system first: if it has never been asked, this brings up its
    // prompt; if the answer is no, say so instead of recording silence.
    let access = await feynmanMicAccess(true)
    for (let i = 0; i < 120 && (access?.status === 'asking' || (i > 0 && access?.status === 'undetermined')); i++) {
      await new Promise((r) => setTimeout(r, 500))
      access = await feynmanMicAccess(false)
    }
    if (access?.status === 'denied') { setBlocked(true); setError(BLOCKED_MSG); return }
    if (access?.status === 'undetermined') return // the prompt is still up
    let stream
    const ask = (id) => navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true })
    try {
      try {
        stream = await ask(micId)
      } catch (e) {
        // The chosen microphone was unplugged: fall back to the system's.
        if (!micId || (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError')) throw e
        stream = await ask('')
      }
    } catch (e) {
      setError(e?.name === 'NotAllowedError'
        ? 'Anki isn’t allowed to use the microphone. Turn it on in System Settings → Privacy & Security → Microphone, then try again.'
        : 'No microphone was found.')
      return
    }
    listMics() // names only show up once a microphone has been opened
    const track = stream.getAudioTracks()[0]
    const usedMic = micLabel(track?.label, systemMicsRef.current)
    const recorder = new MediaRecorder(stream)
    const rec = { recorder, stream, chunks: [], timer: null, discard: false, meter: null }
    recorder.ondataavailable = (e) => { if (e.data?.size) rec.chunks.push(e.data) }
    recorder.onstop = () => {
      clearInterval(rec.timer)
      stopMeter(rec)
      stream.getTracks().forEach((t) => t.stop())
      if (recRef.current === rec) recRef.current = null
      if (rec.discard) return
      const blob = new Blob(rec.chunks, { type: recorder.mimeType || 'audio/webm' })
      setAudioUrl(URL.createObjectURL(blob))
      checkRecording(blob, usedMic)
    }
    recRef.current = rec
    // A live level, so you can see the microphone is hearing you.
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const meter = { ctx, raf: 0, last: 0 }
      const tick = (t) => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        if (t - meter.last > 60) { meter.last = t; setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6)) }
        meter.raf = requestAnimationFrame(tick)
      }
      meter.raf = requestAnimationFrame(tick)
      rec.meter = meter
    } catch { /* no meter; recording still works */ }
    recorder.start()
    setSeconds(0)
    setPhase('recording')
    const t0 = Date.now()
    rec.timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS && recorder.state === 'recording') recorder.stop()
    }, 250)
  }

  const stop = () => {
    const r = recRef.current
    if (r && r.recorder.state === 'recording') r.recorder.stop()
  }

  const onMic = () => {
    if (phase === 'recording') stop()
    else if (phase === 'idle' || phase === 'done' || phase === 'review') start()
  }

  const next = () => {
    if (phase === 'done' && result && current) onSaveScore?.(current.index, result.score)
    const k = items.findIndex((it) => it.index === topic)
    const nextItem = items.length ? items[(k + 1) % items.length] : null
    reset()
    if (nextItem) {
      topicTextRef.current = nextItem.text
      setTopic(nextItem.index)
      onGoToLine?.(nextItem.index)
    }
  }

  const busy = phase === 'checking' || phase === 'transcribing' || phase === 'grading'
  // The remembered microphone if it's still there, else the system default.
  const shownMic = mics.some((m) => m.id === micId) ? micId : (mics.some((m) => m.id === 'default') ? 'default' : '')
  const noAnswers = answers === 0
  const last = current ? lastOf(current.index) : null
  const scoreClass = result ? (result.score >= 75 ? 'is-good' : result.score >= 50 ? 'is-mid' : 'is-low') : ''

  const micHint = {
    idle: noAnswers ? 'This section has no cards to explain.' : 'Tap and explain it out loud',
    recording: `Recording ${clock(seconds)} · tap to stop`,
    checking: 'Checking the recording…',
    review: 'Listen back, then submit. Tap to record again.',
    transcribing: 'Transcribing…',
    grading: 'Grading against your paper…',
    done: 'Tap to try again',
  }[phase]

  return (
    <div className="feynman-panel">
      <div className="ask-head">
        <span className="feynman-badge">F</span><span className="grow">Feynman</span>
        <button className="icon-btn" title="Close" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="feynman-body">
        {!items.length ? (
          <div className="ask-empty">No headings yet. Lines starting with #, ## or ### become topics you can explain.</div>
        ) : (
          <>
            <div className="feynman-topic" ref={menuRef}>
              <div className="feynman-label">Topic</div>
              <button type="button" className="feynman-topic-btn" onClick={() => setMenuOpen((v) => !v)} disabled={phase === 'recording' || busy}
                title={current?.text}>
                <span className="outline-text">{current ? `${'#'.repeat(current.level)} ${current.text}` : 'Choose a heading'}</span>
                {answers != null && <span className="outline-count">{answers} {answers === 1 ? 'answer' : 'answers'}</span>}
                <ChevronDown size={14} />
              </button>
              {menuOpen && (
                <div className="feynman-menu">
                  <div className="outline-head">
                    <span className="outline-title">{paper?.title || 'Untitled'}</span>
                    <span>answers · last</span>
                  </div>
                  <div className="outline-list">
                    {items.map((it) => {
                      const prev = lastOf(it.index)
                      const n = counts[String(it.index)]
                      return (
                        <button key={it.index} type="button"
                          className={`outline-item h${it.level}${it.index === topic ? ' current' : ''}`}
                          onClick={() => pickTopic(it.index)} title={it.text}>
                          <span className="outline-text">{it.text}</span>
                          <span className="outline-count">{n ?? '…'}{prev ? ` · ${prev.score}%` : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="feynman-last">
                {last ? `Last session ${last.date || ''}${last.date ? ' · ' : ''}${last.score}%` : 'No session yet'}
              </div>
            </div>

            <div className="feynman-mic-wrap">
              <button type="button"
                className={`feynman-mic${phase === 'recording' ? ' is-recording' : ''}${busy ? ' is-busy' : ''}`}
                onClick={onMic} disabled={busy || (noAnswers && phase !== 'recording') || !current}
                title={phase === 'recording' ? 'Stop' : phase === 'done' || phase === 'review' ? 'Record again' : 'Record'}>
                {phase === 'recording' ? <Square size={20} />
                  : busy ? <Loader2 size={22} className="spin" />
                    : phase === 'done' || phase === 'review' ? <RotateCcw size={20} /> : <Mic size={22} />}
              </button>
              <div className="feynman-mic-hint">{micHint}</div>
            </div>

            {phase === 'recording' && (
              <div className="feynman-level" title="How loud the microphone hears you">
                <div style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            )}
            <select className="feynman-mic-select" value={shownMic}
              disabled={phase === 'recording' || busy} title="Microphone"
              onChange={(e) => { setMicId(e.target.value); saveMic(e.target.value) }}>
              {!shownMic && <option value="">System microphone</option>}
              {mics.map((m) => <option key={m.id} value={m.id}>{micLabel(m.label, systemMics, m.id === 'default')}</option>)}
            </select>

            {error && <div className="ask-error">{error}</div>}
            {blocked && (
              <button type="button" className="modal-btn feynman-regrade" onClick={() => feynmanOpenMicSettings()}>
                <SettingsIcon size={13} /> Open Microphone settings
              </button>
            )}
            {error && transcript && !result && phase === 'idle' && (
              <button type="button" className="modal-btn feynman-regrade" onClick={regrade}>
                <RotateCcw size={13} /> Grade again
              </button>
            )}

            {audioUrl && phase !== 'recording' && (
              <audio className="feynman-playback" src={audioUrl} controls preload="metadata" />
            )}
            {phase === 'review' && (
              <button type="button" className="feynman-submit" onClick={submit}
                title="Send this recording to be transcribed and graded against your paper">
                <Send size={14} /> Submit for grading
              </button>
            )}

            <div className={`feynman-transcript${transcript ? ' has-text' : ''}`}>
              {transcript ? `“${transcript}”` : 'Your transcript shows here after you submit.'}
            </div>

            {result && (
              <div className="feynman-result">
                <div className="feynman-score-row">
                  <span className={`feynman-score ${scoreClass}`}>{result.score}%</span>
                  <span className="feynman-frac">{result.covered} of {result.total} answers described</span>
                </div>
                <div className="feynman-bar"><div className={scoreClass} style={{ width: `${result.score}%` }} /></div>
                <div className="feynman-items">
                  {result.items.map((it) => {
                    const v = VERDICT[it.verdict] || VERDICT.missed
                    return (
                      <button key={it.id} type="button" className={`feynman-item ${v.cls}`} onClick={() => onGoToLine?.(it.line)}
                        title={`${v.label}${it.heard ? `: you said “${it.heard}”` : ''}. Click to show this line.`}>
                        <v.Icon size={13} className="feynman-item-icon" />
                        <span className="feynman-item-text">
                          <span className="feynman-item-answer">{it.answer}</span>
                          {it.context && <span className="feynman-item-context">{it.context}</span>}
                          {it.note && <span className="feynman-item-note">{it.note}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="feynman-foot">
        <button type="button" className="feynman-next" onClick={next} disabled={!items.length || phase === 'recording' || busy}>
          Next topic <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
