// src/contributor.jsx — Beitragenden-Flow (Aufruf per ?code=…).
// Aus App.jsx ausgelagert: Waveform, VoiceInterview, TextInterview,
// ContributorPhotoUpload, ContributorFlow. Verbatim verschoben; nur ContributorFlow
// wird exportiert (die übrigen sind intern). ACHTUNG: enthält Audio/MediaRecorder —
// nach Änderungen ein echtes Interview live testen.

import { useState, useEffect, useRef } from 'react'
import { askLLM, speakText, stopSpeaking, addContribution, getContribution, uploadContributorImage, getMemorial, submitFeedback } from './api.js'
import { uiText, contributorL10n, langDirective, LANGUAGES, DEFAULT_LANGUAGE } from './i18n.js'
import { getCategory } from './categories.js'
import { GENDERS, CONSENT_VERSION } from './constants.js'
import { S, PartnerBanner, Dots, Err, Lbl } from './ui.jsx'
import { fileToDownscaledDataURL, saveLocalSession, loadLocalSession, clearLocalSession, genContribId, unlockAudio, cutoffDays, cutoffDate, cutoffString } from './shared.js'

// aus der URL: fortzusetzende Interview-Session (nur im Beitragenden-Flow relevant)
const sessionFromURL = (new URLSearchParams(window.location.search).get('session') || '').trim()

// ── Schallwellen-Animation ────────────────────────────────────────
// Liest den Live-Pegel des Aufnahme-Streams (Web Audio AnalyserNode) und
// zeichnet symmetrische, animierte Balken auf ein Canvas. Reagiert in Echtzeit
// auf die Lautstärke der Stimme; bei Stille bleiben nur kleine Grundbalken.
function Waveform({ stream, color = '#dc2626' }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    if (!stream) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    let audioCtx, analyser, src, raf
    try {
      audioCtx = new AC()
      src = audioCtx.createMediaStreamSource(stream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.75
      src.connect(analyser)
    } catch { return }
    const data   = new Uint8Array(analyser.frequencyBinCount)
    const canvas = canvasRef.current
    const dpr    = window.devicePixelRatio || 1
    const resize = () => { if (canvas) { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr } }
    resize()
    window.addEventListener('resize', resize)
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!canvas) return
      analyser.getByteFrequencyData(data)
      const cx = canvas.getContext('2d')
      const W = canvas.width, H = canvas.height
      cx.clearRect(0, 0, W, H)
      const n = data.length, slot = W / n, barW = Math.max(2 * dpr, slot * 0.55)
      for (let i = 0; i < n; i++) {
        const v = data[i] / 255
        const h = Math.max(barW, v * H * 0.95)
        const x = i * slot + (slot - barW) / 2
        const y = (H - h) / 2
        cx.fillStyle = color
        cx.beginPath()
        cx.roundRect(x, y, barW, h, barW / 2)
        cx.fill()
      }
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      try { src.disconnect() } catch {}
      audioCtx.close().catch(() => {})
    }
  }, [stream, color])
  return <canvas ref={canvasRef} style={{ width:'100%', height:56, display:'block' }} />
}

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, lang = 'de', onSave, onPause, saveErr, initialMessages = [] }) {
  const t = uiText(lang)
  const [messages,   setMessages]   = useState(initialMessages)
  const [round,      setRound]      = useState(initialMessages.filter(m => m.role === 'user').length)
  // Immer aktuelle Nachrichtenliste (verhindert veraltete Closures beim Auto-Senden
  // nach einem „Neu einsprechen"/Rückgängig). applyMessages hält Ref + State synchron.
  const messagesRef     = useRef(initialMessages)
  const skipAutoPlayRef = useRef(false)
  function applyMessages(msgs) { messagesRef.current = msgs; setMessages(msgs) }
  const [aiLoading,  setAiLoading]  = useState(false)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [isPlaying,  setIsPlaying]  = useState(false)
  // micState: idle | recording | processing
  const [micState,   setMicState]   = useState('idle')
  const [micStream,  setMicStream]  = useState(null) // aktiver Aufnahme-Stream → Schallwellen-Animation
  const [transcript, setTranscript] = useState('')
  // Anzeigemodus: mit Transkript (+ Löschen/Neu einsprechen) oder reines Sprach-
  // Interview. Startwert aus der Buch-Einstellung; im Interview umschaltbar.
  const [showTx,     setShowTx]     = useState(memorial?.show_transcript !== false)
  const [err,        setErr]        = useState('')
  const [hasPlayed,  setHasPlayed]  = useState(false)
  const mediaRecRef  = useRef(null)
  const chunksRef    = useRef([])
  const endRef       = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, aiLoading])
  useEffect(() => { if (messages.length === 0) loadFirst() }, [])

  // Auto-Start: neue Frage sofort vorlesen
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && !aiLoading) {
      // Nach Löschen/Neu einsprechen die (wiederhergestellte) Frage nicht erneut
      // vorlesen – sonst überlagert die TTS eine gerade startende Aufnahme.
      if (skipAutoPlayRef.current) { skipAutoPlayRef.current = false; return }
      playText(last.content)
    }
  }, [messages, aiLoading])

  function playText(text) {
    stopSpeaking()
    setIsPlaying(true); setTtsLoading(true); setErr('')
    speakText(text, {
      memorialCode: memorial?.id,
      // Sobald die Wiedergabe startet, ist die Ladephase vorbei: „Lädt …" weg,
      // Button zeigt „⏹ Stoppen" (App spricht gerade, kann abgebrochen werden).
      onPlay:  () => setTtsLoading(false),
      onEnd:   () => { setIsPlaying(false); setTtsLoading(false); setHasPlayed(true) },
      onError: (msg, name) => {
        setIsPlaying(false); setTtsLoading(false)
        // iOS Safari blockiert Audio ohne direkte User-Geste — kein Fehler zeigen,
        // Nutzer kann den „Anhören"-Button tippen.
        if (name === 'NotAllowedError' || /not allowed|denied permission|user gesture/i.test(msg || '')) return
        setErr(`TTS: ${msg}`)
      },
    })
  }

  function handleSpeak() {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return
    if (isPlaying) { stopSpeaking(); setIsPlaying(false); setTtsLoading(false); return }
    playText(last.content)
  }

  async function loadFirst() {
    setAiLoading(true)
    try {
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const q = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }], { memorialCode: memorial?.id, kind: 'interview' })
      applyMessages([{ role: 'assistant', content: q }])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  async function handleMic() {
    if (micState === 'processing') return

    if (micState === 'recording') {
      mediaRecRef.current?.stop()
      return
    }

    // Laufende Sprachausgabe stoppen, bevor das Mikrofon öffnet (kein Überlappen,
    // Button-Status sauber). Zugleich das TTS-Element in dieser Nutzer-Geste erneut
    // freischalten (iOS: die Aufnahme kann die Wiedergabe sonst „sperren", sodass
    // die nächste Frage nicht mehr abgespielt wird).
    stopSpeaking(); setIsPlaying(false); setTtsLoading(false)
    unlockAudio()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec    = new MediaRecorder(stream)
      mediaRecRef.current = rec
      chunksRef.current   = []
      let recStartedAt = 0

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setMicStream(null)
        const audioSeconds = recStartedAt ? (Date.now() - recStartedAt) / 1000 : 0
        setMicState('processing')
        try {
          const mimeType = rec.mimeType || 'audio/webm'
          const blob     = new Blob(chunksRef.current, { type: mimeType })
          const base64   = await new Promise((res, rej) => {
            const reader = new FileReader()
            reader.onloadend = () => res(reader.result.split(',')[1])
            reader.onerror   = rej
            reader.readAsDataURL(blob)
          })
          const resp = await fetch('/api/transcribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ audio: base64, mimeType, audioSeconds, memorialCode: memorial?.id, language: lang }),
          })
          const data = await resp.json()
          if (!resp.ok) throw new Error(data.error)
          const text = data.text || ''
          setTranscript(text)
          setMicState('idle')
          // Antwort immer automatisch abschicken. Im Transkript-Modus erscheint sie
          // als Chat-Blase und trägt dort dauerhaft „Löschen"/„Neu einsprechen"
          // (siehe sendAnswer + undoFrom/redoFrom).
          if (text.trim()) sendAnswer(text)
          return
        } catch (e) {
          setErr(`${t.errTranscribe}: ${e.message}`)
        } finally {
          setMicState('idle')
        }
      }

      recStartedAt = Date.now()
      rec.start()
      setMicStream(stream)
      setMicState('recording')
      setTranscript('')
      setErr('')
    } catch (e) {
      setErr(`${t.errMic}: ${e.message}`)
    }
  }

  async function sendAnswer(explicitText) {
    const text = (explicitText ?? transcript).trim(); if (!text) return
    setTranscript(''); stopSpeaking(); setIsPlaying(false)
    // Antwort landet sofort als Chat-Blase im Verlauf; dort trägt sie dauerhaft
    // die Buttons Löschen/Neu einsprechen (undoFrom/redoFrom).
    const newMsgs = [...messagesRef.current, { role: 'user', content: text }]
    applyMessages(newMsgs); setRound(r => r + 1); setAiLoading(true)
    // Antwort sofort persistieren (inkrementell), Fehler in saveErr-Prop
    onSave?.(newMsgs)
    try {
      const sys   = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const reply = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs], { memorialCode: memorial?.id, kind: 'interview' })
      const finalMsgs = [...newMsgs, { role: 'assistant', content: reply }]
      applyMessages(finalMsgs)
      onSave?.(finalMsgs)
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  // Eine Antwort (und alles danach) verwerfen: `index` zeigt auf die user-Nachricht
  // in `messages`; die davorstehende KI-Frage wird wieder aktiv. Aus Verlauf + DB.
  function undoFrom(index, andRecord = false) {
    // Laufende/ladende Sprachausgabe sauber abbrechen und den Button-Status
    // zurücksetzen (sonst bleibt „Lädt" hängen, wenn mitten im TTS gelöscht wird).
    stopSpeaking(); setIsPlaying(false); setTtsLoading(false)
    const msgs = messagesRef.current.slice(0, index)
    // Nur beim Neu-einsprechen die wiederhergestellte Frage NICHT vorlesen (es folgt
    // sofort die Aufnahme); beim reinen Löschen wird sie normal wieder vorgelesen.
    skipAutoPlayRef.current = andRecord
    applyMessages(msgs)
    setRound(msgs.filter(m => m.role === 'user').length)
    setTranscript(''); setErr('')
    onSave?.(msgs)
    if (andRecord) handleMic()
  }

  // Neu einsprechen: Antwort ab `index` verwerfen und direkt neu aufnehmen.
  function redoFrom(index) { undoFrom(index, true) }

  function pause() {
    stopSpeaking(); setIsPlaying(false); setTtsLoading(false)
    if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop()
    onPause?.()
  }

  const latestQ = [...messages].reverse().find(m => m.role === 'assistant')?.content

  // Verlauf für die Chat-Blasen: aktuelle Frage (letzte KI-Nachricht) ausblenden –
  // sie steht schon in der Frage-Karte. Indizes bleiben deckungsgleich mit
  // `messages` (nur das letzte Element entfällt) → undoFrom/redoFrom nutzen `i`.
  const history = messages.slice(0, -1)
  // Löschen/Neu einsprechen nur bei der zuletzt gesendeten Antwort: sobald die
  // nächste Antwort da ist, wandern die Buttons mit; ältere Einträge bleiben fix
  // (sonst würde der ganze nachfolgende Gesprächsbaum verworfen).
  const lastUserIdx = history.map(m => m.role).lastIndexOf('user')

  const micBg     = micState === 'recording' ? '#fee2e2' : '#f5f5f4'
  const micBorder = micState === 'recording' ? '2px solid #ef4444' : '1px solid #d6d3d1'
  const micAnim   = micState === 'recording' ? 'lw-mic 1.5s ease-in-out infinite' : 'none'
  const micIcon   = micState === 'processing' ? '⏳' : '🎙'
  const micLabel  = micState === 'recording'  ? t.micRecording
                  : micState === 'processing' ? t.micProcessing
                  : t.micIdle

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <PartnerBanner logoUrl={memorial?.owner_logo} />
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
        </div>
        <button onClick={pause} disabled={micState !== 'idle'} className="secondary" style={{ fontSize: 13, padding: '8px 16px' }}>{t.pauseEnd}</button>
      </div>
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <Err msg={err} />
        {saveErr && <div style={{ ...S.err }}>⚠ {t.saveLabel}: {saveErr}</div>}
        {memorial.funeral_date && (() => {
          const d = cutoffDate(memorial.funeral_date, cutoffDays(memorial))
          return d ? (
            <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#78350f', marginBottom:14, lineHeight:1.55 }}>
              ℹ {t.cutoffNote(d.toLocaleDateString(t.locale))}
            </div>
          ) : null
        })()}
        {showTx && history.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: .6, background: m.role === 'user' ? '#e0f2fe' : '#f5f5f4' }}>{m.content}</div>
              {m.role === 'user' && i === lastUserIdx && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="secondary" disabled={micState !== 'idle' || aiLoading} onClick={() => undoFrom(i)} style={{ fontSize: 11, padding: '3px 9px' }}>{t.txDelete}</button>
                  <button className="secondary" disabled={micState !== 'idle' || aiLoading} onClick={() => redoFrom(i)} style={{ fontSize: 11, padding: '3px 9px' }}>{t.txRedo}</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {aiLoading && messages.length === 0 && <div style={{ margin: '1.5rem 0' }}><Dots /></div>}
        {latestQ && (
          <div style={{ ...S.card, marginBottom: '1rem', background: '#fafaf9', borderColor: '#d6d3d1', textAlign: showTx ? 'left' : 'center' }}>
            {showTx && <>
              <Lbl>{t.questionLabel}</Lbl>
              <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 1rem', color: '#292524' }}>{latestQ}</p>
            </>}
            <button onClick={handleSpeak} disabled={ttsLoading || aiLoading} style={{ fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {ttsLoading
                ? <><span style={{ width:14,height:14,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'lw-spin .8s linear infinite' }} /> {t.loadingShort}</>
                : isPlaying ? t.stop : hasPlayed ? t.readAgain : t.listen}
            </button>
          </div>
        )}
        {aiLoading && messages.length > 0 && <div style={{ margin: '.75rem 0' }}><Dots /></div>}
        {!aiLoading && latestQ && (
          <div style={{ ...S.card, textAlign: 'center', padding: '1.5rem 1rem' }}>
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={handleMic}
                disabled={micState === 'processing'}
                style={{ width:72, height:72, borderRadius:'50%', fontSize:28, display:'inline-flex', alignItems:'center', justifyContent:'center', background:micBg, border:micBorder, color:'#1c1917', animation:micAnim, transition:'all .2s' }}
                aria-label={micLabel}
              >{micIcon}</button>
            </div>
            {micState === 'recording' && micStream && (
              <div style={{ maxWidth:320, margin:'0 auto 10px' }}>
                <Waveform stream={micStream} color="#dc2626" />
              </div>
            )}
            <div style={{ fontSize:13, fontWeight:500, color: micState==='recording' ? '#dc2626' : '#78716c', marginBottom:4 }}>
              {micLabel}
            </div>
            <div
              onClick={() => setShowTx(v => !v)}
              role="switch"
              aria-checked={showTx}
              style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:10, marginTop:18, cursor:'pointer', fontSize:12, color:'#78716c', userSelect:'none' }}
            >
              <span style={{ position:'relative', width:38, height:22, borderRadius:11, background: showTx ? '#1c1917' : '#d6d3d1', transition:'background .2s', flexShrink:0, display:'inline-block' }}>
                <span style={{ position:'absolute', top:2, left: showTx ? 18 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 2px rgba(0,0,0,.25)' }} />
              </span>
              {t.txToggleLabel}
            </div>
            {memorial.catalog && micState === 'idle' && (
              <button
                onClick={() => sendAnswer(({ de:'Weiter zur nächsten Frage, bitte.', en:'Please move on to the next question.', pl:'Przejdźmy do następnego pytania.' })[lang] || 'Weiter zur nächsten Frage, bitte.')}
                disabled={aiLoading}
                className="secondary"
                style={{ marginTop:16, fontSize:13, padding:'8px 16px' }}
              >
                {({ de:'Nächste Frage →', en:'Next question →', pl:'Następne pytanie →' })[lang] || 'Nächste Frage →'}
              </button>
            )}
          </div>
        )}
        {round >= 1 && !aiLoading && <p style={{ fontSize:12, color:'#78716c', textAlign:'center', marginTop:12 }}>{t.autosaveNote}</p>}
        <div ref={endRef} /><div style={{ height:'2rem' }} />
      </div>
    </div>
  )
}

// ── Text-Interview ────────────────────────────────────────────────
function TextInterview({ memorial, contribForm, onDone }) {
  const [messages, setMessages] = useState([])
  const [input, setInput]   = useState('')
  const [round, setRound]   = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, loading])
  useEffect(() => { loadFirst() }, [])

  async function loadFirst() {
    setLoading(true)
    try {
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const q = await askLLM(sys, [{ role:'user', content:'[Interview beginnt]' }])
      setMessages([{ role:'assistant', content:q }])
    } catch(e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim(); setInput('')
    const newMsgs = [...messages, { role:'user', content:text }]
    setMessages(newMsgs); setRound(r=>r+1); setLoading(true)
    try {
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const reply = await askLLM(sys, [{ role:'user', content:'[Interview beginnt]' }, ...newMsgs])
      setMessages([...newMsgs, { role:'assistant', content:reply }])
    } catch(e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function finish() {
    setSaving(true)
    try { await onDone(messages) } catch(e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh' }}>
      <div style={{ flexShrink:0, borderBottom:'1px solid #e7e5e4', padding:'12px 1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#fff' }}>
        <div>
          <div style={{ fontWeight:600, fontSize:15 }}>{memorial.name}</div>
          <div style={{ fontSize:12, color:'#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
        </div>
        {round >= 5 && <button onClick={finish} disabled={saving} style={{ fontSize:13, padding:'8px 16px' }}>{saving?'Wird gespeichert …':'✓ Abschließen'}</button>}
      </div>
      {err && <div style={{ ...S.err, margin:'8px 1.5rem 0' }}>{err}</div>}
      <div style={{ flex:1, overflowY:'auto', padding:'1rem 1.5rem', display:'flex', flexDirection:'column', gap:12 }}>
        {messages.length===0 && loading && <Dots />}
        {messages.map((m,i) => (
          <div key={i} style={{ display:'flex', flexDirection:m.role==='user'?'row-reverse':'row' }}>
            <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:12, fontSize:15, lineHeight:1.65, background:m.role==='user'?'#dbeafe':'#f5f5f4', fontStyle:m.role==='assistant'?'italic':'normal' }}>{m.content}</div>
          </div>
        ))}
        {messages.length>0 && loading && <Dots />}
        <div ref={endRef} />
      </div>
      <div style={{ flexShrink:0, borderTop:'1px solid #e7e5e4', padding:'12px 1.5rem', background:'#fff' }}>
        <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Schreiben Sie Ihre Erinnerung … (Enter zum Senden)" disabled={loading} rows={3} style={{ flex:1, fontSize:15 }} />
          <button onClick={send} disabled={loading||!input.trim()} style={{ padding:'10px 16px', flexShrink:0 }}>➤</button>
        </div>
        {round>=5 && <p style={{ fontSize:12, color:'#78716c', marginTop:8 }}>Sie können noch mehr erzählen oder das Interview oben abschließen.</p>}
      </div>
    </div>
  )
}

// ── Beitragenden-Flow (Aufruf per ?code=XXX[&session=…]) ──────────
// Foto-Upload für Beitragende (am Ende des Interviews, auf dem Danke-Bildschirm).
// Kurzes Feedback nach dem Interview (Smiley-Skala 1..5 + optionaler Freitext).
// Speichert auf dem eigenen Beitrag; für das Qualitätsmanagement im Dashboard.
function FeedbackBlock({ code, contribId, t }) {
  const [rating, setRating] = useState(0)
  const [text, setText]     = useState('')
  const [sent, setSent]     = useState(false)
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const faces = ['😞', '😕', '😐', '🙂', '😍']
  async function send() {
    if (!rating || busy) return
    setBusy(true); setErr('')
    try { await submitFeedback(code, contribId, rating, text.trim()); setSent(true) }
    catch { setErr(t.fbSaveErr) } finally { setBusy(false) }
  }
  if (sent) return <p style={{ ...S.muted, maxWidth:420, margin:'0 auto 1.5rem' }}>✓ {t.fbThanks}</p>
  return (
    <div style={{ ...S.card, maxWidth:420, margin:'0 auto 1.5rem', textAlign:'center' }}>
      <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>{t.fbQuestion}</div>
      <p style={{ ...S.muted, fontSize:12.5, margin:'0 0 12px' }}>{t.fbHint}</p>
      <div style={{ display:'flex', justifyContent:'center', gap:6, marginBottom:8 }}>
        {faces.map((f, i) => {
          const val = i + 1, on = rating === val
          return (
            <button key={val} type="button" onClick={() => setRating(val)} title={t.fbLabels[i]} aria-label={t.fbLabels[i]}
              style={{ background:'none', border: on ? '2px solid #1c1917' : '1px solid #e7e5e4', borderRadius:10, padding:'6px 9px', fontSize:26, lineHeight:1, cursor:'pointer', opacity: rating && !on ? 0.45 : 1, transition:'opacity .1s, border-color .1s' }}>
              {f}
            </button>
          )
        })}
      </div>
      <div style={{ fontSize:12.5, color:'#57534e', minHeight:18, marginBottom:10 }}>{rating > 0 ? t.fbLabels[rating - 1] : ''}</div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={t.fbTextPlaceholder} rows={3} maxLength={2000}
        style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14, marginBottom:10 }} />
      {err && <p style={{ fontSize:12.5, color:'#dc2626', margin:'0 0 8px' }}>{err}</p>}
      <button onClick={send} disabled={!rating || busy} style={{ fontSize:14, padding:'9px 18px' }}>{busy ? '…' : t.fbSubmit}</button>
    </div>
  )
}

// Der Beitrag ist zu diesem Zeitpunkt bereits gespeichert; die Fotos werden
// einzeln direkt hochgeladen. Die Einverständniserklärung (Rechte + KI-
// Verarbeitung aller abgebildeten Personen) ist Pflicht vor dem ersten Upload.
function ContributorPhotoUpload({ code, contribId, t }) {
  const [consent, setConsent] = useState(false)
  const [staged, setStaged]   = useState(null) // { dataUrl, caption, description }
  const [uploaded, setUploaded] = useState([])
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')
  const inStyle = { width:'100%', padding:'9px 11px', border:'1px solid #d6d3d1', borderRadius:8, fontSize:14, boxSizing:'border-box' }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\//.test(file.type) && !/\.(hei[cf]|jpe?g|png|webp)$/i.test(file.name)) { setErr(t.uploadError); return }
    setErr('')
    try { setStaged({ dataUrl: await fileToDownscaledDataURL(file), caption:'', description:'' }) }
    catch (e2) { setErr(e2.message) }
  }

  async function addStaged() {
    if (!staged) return
    if (!consent) { setErr(t.uploadConsentRequired); return }
    setBusy(true); setErr('')
    try {
      await uploadContributorImage(code, {
        image: staged.dataUrl, caption: staged.caption, description: staged.description,
        consent: true, contributionId: contribId,
      })
      setUploaded(u => [...u, { caption: staged.caption, thumb: staged.dataUrl }])
      setStaged(null)
    } catch (e2) { setErr(e2.message || t.uploadError) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ ...S.card, maxWidth:460, margin:'0 auto', textAlign:'left' }}>
      <h3 style={{ fontSize:17, fontWeight:700, marginBottom:6 }}>{t.uploadStepTitle}</h3>
      <p style={{ ...S.muted, marginBottom:14 }}>{t.uploadStepIntro}</p>

      {uploaded.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
          {uploaded.map((u, i) => (
            <div key={i} style={{ width:72 }}>
              <img src={u.thumb} alt="" style={{ width:72, height:72, objectFit:'cover', borderRadius:8, border:'1px solid #e7e5e4' }} />
            </div>
          ))}
        </div>
      )}

      <Err msg={err} />

      {!staged ? (
        <label className="secondary" style={{ display:'inline-block', cursor:'pointer', padding:'10px 16px', borderRadius:8, fontSize:14 }}>
          {t.uploadPick}
          <input type="file" accept="image/*,.heic,.heif" onChange={onPick} style={{ display:'none' }} />
        </label>
      ) : (
        <div>
          <img src={staged.dataUrl} alt="" style={{ width:'100%', maxHeight:240, objectFit:'contain', borderRadius:8, border:'1px solid #e7e5e4', marginBottom:12, background:'#faf9f7' }} />
          <div style={{ marginBottom:10 }}>
            <Lbl>{t.uploadCaption}</Lbl>
            <input value={staged.caption} onChange={e => setStaged(s => ({ ...s, caption:e.target.value }))} style={inStyle} maxLength={300} />
            <div style={{ ...S.muted, fontSize:12, marginTop:4 }}>{t.uploadCaptionHint}</div>
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl>{t.uploadDesc}</Lbl>
            <textarea value={staged.description} onChange={e => setStaged(s => ({ ...s, description:e.target.value }))} style={{ ...inStyle, minHeight:64, resize:'vertical' }} maxLength={1000} />
            <div style={{ ...S.muted, fontSize:12, marginTop:4 }}>{t.uploadDescHint}</div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addStaged} disabled={busy} style={{ fontSize:14, padding:'10px 16px' }}>{busy ? t.uploadUploading : t.uploadSubmit}</button>
            <button className="secondary" onClick={() => setStaged(null)} disabled={busy} style={{ fontSize:14, padding:'10px 16px' }}>{t.uploadRemove}</button>
          </div>
        </div>
      )}

      <label style={{ display:'flex', gap:10, alignItems:'flex-start', marginTop:16, cursor:'pointer' }}>
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop:3, flexShrink:0 }} />
        <span style={{ ...S.muted, fontSize:12.5 }}>{t.uploadConsent}</span>
      </label>
    </div>
  )
}

// Untere Tab-Leiste im Interview (nur wenn Buch-Option photo_upload_tab gesetzt):
// wechselt zwischen Interview und Foto-Upload. Ohne die Option keine Icons.
function ContribTabBar({ tab, setTab, t }) {
  const items = [
    { id: 'interview', icon: '🎙️', label: t.tabInterview },
    { id: 'photo',     icon: '📷', label: t.tabPhoto },
  ]
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'#fff', borderTop:'1px solid #e7e5e4', display:'flex', zIndex:30, boxShadow:'0 -1px 4px rgba(0,0,0,.05)' }}>
      {items.map(it => {
        const active = tab === it.id
        return (
          <button key={it.id} onClick={() => setTab(it.id)} aria-current={active}
            style={{ flex:1, background:'none', border:'none', borderTop: active ? '2px solid #1c1917' : '2px solid transparent', cursor:'pointer', padding:'8px 4px 10px', display:'flex', flexDirection:'column', alignItems:'center', gap:3, color: active ? '#1c1917' : '#a8a29e' }}>
            <span style={{ fontSize:22, lineHeight:1 }}>{it.icon}</span>
            <span style={{ fontSize:11, fontWeight: active ? 700 : 500 }}>{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ContributorFlow({ code }) {
  const [view, setView]                       = useState('loading') // loading | info | interview | done | error
  const [memorial, setMemorial]               = useState(null)
  const [contribForm, setContribForm]         = useState({ name:'', gender:'', relationship:'', address:'Sie' })
  const [err, setErr]                         = useState('')
  const [contribId, setContribId]             = useState(() => genContribId())
  const [consentChecked, setConsentChecked]   = useState(false)
  const [consentAt, setConsentAt]             = useState(null)
  const [initialMessages, setInitialMessages] = useState([])
  const [resumePrompt, setResumePrompt]       = useState(null)
  const [paused, setPaused]                   = useState(false)
  const [copied, setCopied]                   = useState('')
  const [saveErr, setSaveErr]                 = useState('')
  const [lang, setLang]                       = useState(null) // vom Beitragenden gewählte Sprache
  const [tab, setTab]                         = useState('interview') // interview | photo (nur wenn photo_upload_tab)
  const saveQueueRef                          = useRef(Promise.resolve())

  useEffect(() => {
    getMemorial(code)
      .then(m => setMemorial(m))
      .catch(e => { setErr(e.message); setView('error') })
  }, [code])

  useEffect(() => {
    if (!memorial) return
    if (sessionFromURL) {
      fetchContribution(code, sessionFromURL).then(contrib => {
        if (contrib) { restoreFrom(contrib); setView('interview') }
        else setView('info')
      })
      return
    }
    const local = loadLocalSession(code)
    if (local) setResumePrompt(local)
    else setView('info')
  }, [memorial])

  async function fetchContribution(memCode, id) {
    try {
      return await getContribution(id, memCode)
    } catch { return null }
  }

  function restoreFrom(contrib) {
    const form = {
      name: contrib.contributor_name || '',
      gender: contrib.contributor_gender || '',
      relationship: contrib.relationship || '',
      address: contrib.contributor_address || 'Sie',
    }
    setContribId(contrib.id)
    setContribForm(form)
    setInitialMessages(Array.isArray(contrib.messages) ? contrib.messages : [])
    if (contrib.consent_at) { setConsentAt(contrib.consent_at); setConsentChecked(true) }
    saveLocalSession(code, { contribId: contrib.id, contribForm: form, consentAt: contrib.consent_at || null })
  }

  async function resumeLocal() {
    if (!resumePrompt) return
    // In dieser Nutzer-Geste (Tap auf „Fortsetzen") das TTS-Element freischalten,
    // damit auf iOS auch die erste Frage nach dem Fortsetzen hörbar ist.
    unlockAudio()
    const local = resumePrompt
    setResumePrompt(null); setView('loading')
    const contrib = await fetchContribution(code, local.contribId)
    if (contrib) {
      restoreFrom(contrib)
      setView('interview')
      return
    }
    // Kein DB-Eintrag (noch keine Antwort gespeichert). Wenn das Formular in
    // localStorage komplett ist, direkt ins Interview springen — sonst Info-Form.
    const form = local.contribForm
    if (local.consentAt) { setConsentAt(local.consentAt); setConsentChecked(true) }
    // Nur direkt ins Interview, wenn Formular vollständig UND bereits eingewilligt
    // wurde – sonst zurück zur Info-Maske inkl. Einwilligungsschritt.
    const complete = form && form.name && form.gender && form.relationship && form.address && local.consentAt
    setContribId(local.contribId)
    if (form) setContribForm({ ...contribForm, ...form })
    setInitialMessages([])
    setView(complete ? 'interview' : 'info')
  }

  function startFresh() {
    clearLocalSession(code)
    setResumePrompt(null)
    setContribId(genContribId())
    setInitialMessages([])
    setContribForm({ name:'', gender:'', relationship:'', address:'Sie' })
    setConsentChecked(false)
    setConsentAt(null)
    setView('info')
  }

  function startInterview() {
    unlockAudio()
    // Zeitpunkt der Einwilligung festhalten (einmalig, beim Start).
    const ts = consentAt || new Date().toISOString()
    if (!consentAt) setConsentAt(ts)
    saveLocalSession(code, { contribId, contribForm, consentAt: ts })
    // Einführungsvideo nur fürs Trauerbuch (memorial); andere Kategorien starten
    // direkt mit dem Interview.
    const showVideo = memorial?.product_category === 'memorial' && memorial?.show_intro_video !== false
    setView(showVideo ? 'intro-video' : 'interview')
  }

  function saveProgress(messages) {
    if (!messages || messages.length === 0) return
    saveLocalSession(code, { contribId, contribForm, consentAt })
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        await addContribution({
          contributionId: contribId,
          memorialCode: code,
          contributorName: contribForm.name,
          relationship: contribForm.relationship,
          messages,
          contributorGender: contribForm.gender || null,
          contributorAddress: contribForm.address || null,
          consentAt: consentAt || null,
          consentVersion: consentAt ? CONSENT_VERSION : null,
        })
        setSaveErr('')
      } catch (e) { setSaveErr(e.message) }
    })
  }

  function handlePause() { setPaused(true) }
  function handleResume() { setPaused(false) }
  function handleDone() {
    // Lokale Sitzung NICHT löschen: So erkennt der Einladungslink (?code=…) beim
    // erneuten Öffnen im selben Browser die bestehende Sitzung und bietet
    // Fortsetzen/Neu beginnen an (60-Tage-TTL). Ein echter Neustart ist über
    // „Neu beginnen" im Wiederaufnahme-Dialog jederzeit möglich.
    setPaused(false); setView('done')
  }

  // Angebotene Sprachen + aktuell wirksame Sprache des Beitragenden.
  const langs   = (memorial?.languages && memorial.languages.length) ? memorial.languages : [DEFAULT_LANGUAGE]
  const L       = lang || (langs.length === 1 ? langs[0] : DEFAULT_LANGUAGE)
  const needLang = !!memorial && langs.length > 1 && !lang
  const t  = uiText(L)
  const ct = contributorL10n(memorial?.product_category, L)
  const resumeUrl = `${window.location.origin}/?code=${code}&session=${contribId}`

  function copyResumeUrl() {
    navigator.clipboard.writeText(resumeUrl)
    setCopied('link'); setTimeout(() => setCopied(''), 2000)
  }
  function mailResumeUrl() {
    const subject = encodeURIComponent(t.mailSubject(ct.nounBook, memorial ? memorial.name : ''))
    const body = encodeURIComponent(t.mailBody(ct.nounBook, memorial ? memorial.name : '', resumeUrl))
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <>
      {view === 'loading' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}><Dots /></div>
      )}

      {view === 'error' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>{t.notFound(ct.nounBook)}</h2>
          <p style={S.muted}>{err}</p>
        </div>
      )}

      {/* Sprachauswahl — bei mehreren angebotenen Sprachen ganz am Anfang */}
      {needLang && view !== 'error' && (
        <>
          <PartnerBanner logoUrl={memorial?.owner_logo} />
          <div style={{ ...S.page, paddingTop:'2.5rem', textAlign:'center' }}>
            <div style={{ marginBottom:20 }}>
              {langs.map(code => (
                <p key={code} style={{ ...S.muted, margin:'2px 0', fontSize:15 }}>{uiText(code).langPickTitle}</p>
              ))}
            </div>
            <div style={{ display:'grid', gap:10, maxWidth:320, margin:'0 auto' }}>
              {langs.map(code => {
                const meta = LANGUAGES.find(x => x.code === code) || { code, label: code }
                return (
                  <button key={code} onClick={() => setLang(code)} style={{ padding:'14px', fontSize:16 }}>{meta.label}</button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {!needLang && view === 'info' && (
        <>
          <PartnerBanner logoUrl={memorial?.owner_logo} />
          <div style={{ ...S.page, paddingTop:'2rem' }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{ct.heading}</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
            {ct.introNoun} <strong>{memorial?.name}</strong>
          </p>
          <div style={{ marginBottom:14 }}><Lbl>{t.yourName}</Lbl><input value={contribForm.name} onChange={e=>setContribForm({...contribForm,name:e.target.value})} placeholder={t.fullName} /></div>
          <div style={{ marginBottom:14 }}>
            <Lbl>{t.yourGender}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {GENDERS.map(g => (
                <div
                  key={g.value}
                  onClick={() => setContribForm({ ...contribForm, gender: g.value })}
                  style={{
                    ...S.card,
                    cursor:'pointer',
                    textAlign:'center',
                    padding:'12px 8px',
                    borderColor: contribForm.gender === g.value ? '#1c1917' : '#e7e5e4',
                    borderWidth: contribForm.gender === g.value ? 2 : 1,
                    fontSize: 14,
                    fontWeight: contribForm.gender === g.value ? 600 : 400,
                  }}
                >
                  {t.genders[g.value] || g.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <Lbl>{ct.relationshipLabel.replace('{name}', memorial?.name || '')}</Lbl>
            <input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder={ct.relationshipPlaceholder} />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6, lineHeight:1.5 }}>{ct.relationshipHint ? ct.relationshipHint.replace(/\{name\}/g, memorial?.name || 'die Person') : t.relationshipHint(memorial?.name, memorial?.gender)}</p>
          </div>
          <div style={{ marginBottom:24 }}>
            <Lbl>{t.addressQ}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { v:'Du',  title:t.addrInformalTitle, sub:t.addrInformalSub },
                { v:'Sie', title:t.addrFormalTitle,   sub:t.addrFormalSub },
              ].map(o => (
                <div
                  key={o.v}
                  onClick={() => setContribForm({ ...contribForm, address: o.v })}
                  style={{
                    ...S.card,
                    cursor:'pointer',
                    textAlign:'center',
                    padding:'14px 10px',
                    borderColor: contribForm.address === o.v ? '#1c1917' : '#e7e5e4',
                    borderWidth: contribForm.address === o.v ? 2 : 1,
                  }}
                >
                  <div style={{ fontWeight:600, fontSize:15 }}>{o.title}</div>
                  <div style={{ fontSize:12, color:'#78716c', marginTop:4 }}>{o.sub}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...S.card, background:'#fffbeb', borderColor:'#fde68a', marginBottom:18 }}>
            <label style={{ display:'flex', gap:11, alignItems:'flex-start', cursor:'pointer', fontSize:13.5, lineHeight:1.6, color:'#57534e' }}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                style={{ marginTop:3, width:18, height:18, flexShrink:0, cursor:'pointer' }}
              />
              <span>
                {t.consentText(
                  ct.consentNoun,
                  memorial?.product_category === 'memorial' ? t.consentSpecialMemorial : t.consentSpecialOther
                )}
                <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={{ color:'#1d4ed8' }}>{t.consentLink}</a>.
              </span>
            </label>
          </div>
          <button disabled={!contribForm.name||!contribForm.gender||!contribForm.relationship||!contribForm.address||!consentChecked} onClick={startInterview} style={{ width:'100%', padding:13, fontSize:15 }}>
            {ct.interviewButton}
          </button>
          </div>
        </>
      )}

      {!needLang && view === 'intro-video' && (
        <div style={{ position:'fixed', inset:0, background:'#000', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <video
            src="https://bniwrvfjqewjlzruslnd.supabase.co/storage/v1/object/public/memorial-videos/Intro_LD.mp4"
            autoPlay
            playsInline
            style={{ width:'100%', height:'100%', objectFit:'contain', maxHeight:'100vh' }}
            onEnded={() => setView('interview')}
          />
          <button
            onClick={() => { unlockAudio(); setView('interview') }}
            style={{
              position:'absolute', top:20, right:20,
              background:'rgba(0,0,0,0.5)', color:'#fff',
              border:'1px solid rgba(255,255,255,0.5)', borderRadius:8,
              padding:'10px 20px', fontSize:14, cursor:'pointer',
              backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)',
            }}
          >
            {t.introSkip}
          </button>
        </div>
      )}

      {!needLang && view === 'interview' && memorial && (() => {
        const vi = (
          <VoiceInterview
            memorial={memorial}
            contribForm={contribForm}
            lang={L}
            onSave={saveProgress}
            onPause={handlePause}
            saveErr={saveErr}
            initialMessages={initialMessages}
          />
        )
        // Ohne die Option kein Tab-Umschalter – Interview wie gehabt.
        if (!memorial.photo_upload_tab) return vi
        // Mit Option: beide Panels bleiben gemountet (Interview-Fortschritt bleibt
        // erhalten), nur Sichtbarkeit per Tab. Untere Tab-Leiste schaltet um.
        return (
          <div style={{ paddingBottom: 64 }}>
            <div style={{ display: tab === 'interview' ? 'block' : 'none' }}>{vi}</div>
            <div style={{ display: tab === 'photo' ? 'block' : 'none' }}>
              <div style={{ ...S.page, paddingTop:'2rem' }}>
                <ContributorPhotoUpload code={code} contribId={contribId} t={t} />
              </div>
            </div>
            <ContribTabBar tab={tab} setTab={setTab} t={t} />
          </div>
        )
      })()}

      {!needLang && view === 'done' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>🤍</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>{t.doneTitle}</h2>
          <p style={{ ...S.muted, maxWidth:360, margin:'0 auto 2rem' }}>{t.doneBody(ct.nounBook)}</p>
          <FeedbackBlock code={code} contribId={contribId} t={t} />
          <div style={{ marginTop:'2.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4', maxWidth:420, margin:'2.5rem auto 0' }}>
            <button onClick={() => window.close()} className="secondary" style={{ fontSize:14, padding:'10px 22px' }}>{t.closeBtn}</button>
            <p style={{ ...S.muted, fontSize:12, marginTop:10 }}>{t.closeHint}</p>
          </div>
        </div>
      )}

      {/* Overlay: localStorage-Fortsetzung anbieten */}
      {resumePrompt && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem' }}>
          <div style={{ ...S.card, maxWidth: 460, width:'100%' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>{t.resumeTitle}</h2>
            <p style={{ ...S.muted, marginBottom:18 }}>
              {t.resumeLast(new Date(resumePrompt.savedAt).toLocaleString(t.locale))}<br />
              {t.resumeQ}
            </p>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <button onClick={resumeLocal} style={{ fontSize:14, padding:'10px 16px' }}>{t.resumeContinue}</button>
              <button className="secondary" onClick={startFresh} style={{ fontSize:14, padding:'10px 16px' }}>{t.resumeFresh}</button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: Später fortsetzen oder beenden */}
      {paused && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
          <div style={{ ...S.card, maxWidth: 520, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>{t.pauseTitle}</h2>
            <p style={{ ...S.muted, marginBottom:14 }}>
              {t.pauseIntro}
            </p>
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', marginBottom:12, fontSize:13, lineHeight:1.6 }}>
              <strong>{t.pauseWay1Strong}</strong><br />
              {t.pauseWay1Body}
            </div>
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', marginBottom:14, fontSize:13, lineHeight:1.6 }}>
              <strong>{t.pauseWay2Strong}</strong> {t.pauseWay2Body}
              <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:8, padding:'8px 10px', marginTop:10, fontFamily:'monospace', fontSize:12, wordBreak:'break-all', color:'#44403c' }}>{resumeUrl}</div>
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                <button className="secondary" onClick={copyResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>{copied === 'link' ? t.copied : t.copyLink}</button>
                <button className="secondary" onClick={mailResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>{t.mailBtn}</button>
              </div>
            </div>
            <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:14, display:'flex', gap:10, flexWrap:'wrap', justifyContent:'space-between' }}>
              <button className="ghost" onClick={handleResume} style={{ fontSize:14 }}>{t.continueTalk}</button>
              <button onClick={handleDone} style={{ fontSize:14, padding:'10px 18px' }}>{t.finishNow}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
