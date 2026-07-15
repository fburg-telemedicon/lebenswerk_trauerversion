// src/contributor.jsx — Beitragenden-Flow (Aufruf per ?code=…).
// Aus App.jsx ausgelagert: Waveform, VoiceInterview, TextInterview,
// ContributorPhotoUpload, ContributorFlow. Verbatim verschoben; nur ContributorFlow
// wird exportiert (die übrigen sind intern). ACHTUNG: enthält Audio/MediaRecorder —
// nach Änderungen ein echtes Interview live testen.

import { useState, useEffect, useRef } from 'react'
import { askLLM, speakText, stopSpeaking, addContribution, getContribution, uploadContributorImage, getMemorial, submitFeedback, updateOwnMemorial, claimEnduserStart, pinMemorialLang, getEnduserBook, acquireEditLock, heartbeatEditLock, releaseEditLock, consumeProof, saveEnduserBook, startPrintVersion, finalizeBook, enduserGenerateImage } from './api.js'
import { generateProofBook } from './enduserProof.js'
import { proofT } from './proofI18n.js'
import { uiText, contributorL10n, langDirective, LANGUAGES, DEFAULT_LANGUAGE, isRTL } from './i18n.js'
import { getCategory, defaultTextStyle } from './categories.js'
import { GENDERS, CONSENT_VERSION } from './constants.js'
import { ImageStylePicker, BookLayoutPicker, TextStylePicker } from './pickers.jsx'
import { DEFAULT_IMAGE_STYLE } from './imageStyles.js'
import { DEFAULT_BOOK_LAYOUT } from './bookLayouts.js'
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
function VoiceInterview({ memorial, contribForm, lang = 'de', onSave, onPause, saveErr, initialMessages = [], showTx: showTxProp, setShowTx: setShowTxProp, companionOn = false, setCompanionOn, active = true }) {
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
  // Begleiteter Modus: wer spricht gerade? 'self' (Endnutzer, rot) | 'companion'
  // (Begleitperson, blau). Bestimmt Zuordnung der Antwort + Farbe der Schallwelle.
  const [recSpeaker, setRecSpeaker] = useState('self')
  const speakerRef = useRef('self')
  const companionInitRef = useRef(true)
  const companionRunRef  = useRef(0)
  const [transcript, setTranscript] = useState('')
  // Anzeigemodus: mit Transkript (+ Löschen/Neu einsprechen) oder reines Sprach-
  // Interview. Das Interview startet IMMER ohne Transkript (ruhiger Einstieg); die
  // Buch-Einstellung `show_transcript` entscheidet nur, ob der Schalter überhaupt
  // angeboten wird, mit dem der Beitragende es einblenden kann.
  // `showTx` kann von oben (ContributorFlow) kontrolliert werden, damit der
  // Transkript-Umschalter auch in der Tab-Leiste sitzt; sonst lokaler Zustand.
  const [showTxLocal, setShowTxLocal] = useState(false)
  const showTx    = showTxProp !== undefined ? showTxProp : showTxLocal
  const setShowTx = setShowTxProp || setShowTxLocal
  const txAvailable = memorial?.show_transcript !== false
  const [err,        setErr]        = useState('')
  const [hasPlayed,  setHasPlayed]  = useState(false)
  const mediaRecRef  = useRef(null)
  const chunksRef    = useRef([])
  const endRef       = useRef(null)

  // Test-Zeitlimit: 0 = unbegrenzt. Ist ein Limit gesetzt, läuft ab dem ersten
  // Betreten des Interviews ein Countdown; die Frist (Deadline) wird pro Buch im
  // localStorage gehalten, damit ein Neuladen sie nicht zurücksetzt. Bei Null ist
  // keine Aufnahme/Sprachausgabe mehr möglich – Ansehen bleibt erlaubt.
  const timerSeconds = Math.max(0, parseInt(memorial?.interview_timer_seconds, 10) || 0)
  const timerActive  = timerSeconds > 0
  const [remaining, setRemaining] = useState(timerSeconds)
  useEffect(() => {
    if (!timerActive || !memorial?.id) return
    // Schlüssel enthält den Timer-Wert: Ändert der Manager das Limit, startet der
    // Countdown sauber neu; ein bloßes Neuladen mit gleichem Limit setzt ihn NICHT zurück.
    const key = `lw_timer_${memorial.id}_${timerSeconds}`
    let deadline = parseInt(localStorage.getItem(key) || '', 10)
    if (!Number.isFinite(deadline)) {
      deadline = Date.now() + timerSeconds * 1000
      try { localStorage.setItem(key, String(deadline)) } catch { /* privater Modus */ }
    }
    const tick = () => setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerActive, timerSeconds, memorial?.id])
  const expired = timerActive && remaining <= 0
  const fmtMMSS = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, aiLoading])
  useEffect(() => { if (messages.length === 0) loadFirst() }, [])

  // Auto-Start: neue Frage sofort vorlesen
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && !aiLoading) {
      // Nach abgelaufener Testzeit keine Sprachausgabe mehr.
      if (expired) return
      // Nicht vorlesen, wenn der Interview-Tab gerade nicht sichtbar ist.
      if (!active) return
      // Nach Löschen/Neu einsprechen die (wiederhergestellte) Frage nicht erneut
      // vorlesen – sonst überlagert die TTS eine gerade startende Aufnahme.
      if (skipAutoPlayRef.current) { skipAutoPlayRef.current = false; return }
      playText(last.content)
    }
  }, [messages, aiLoading])

  // Tab-Wechsel: Verlässt der Nutzer den Interview-Tab, wird die vorgelesene Frage
  // SOFORT gestoppt (nicht bis zum Satzende weiterreden). Kommt er zurück, wird die
  // aktuelle Frage von vorne vorgelesen — außer im begleiteten Modus (dort liest die
  // KI nichts vor) oder nach abgelaufener Testzeit.
  const wasActiveRef = useRef(active)
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      if (!companionOn && !expired) {
        const last = [...messagesRef.current].reverse().find(m => m.role === 'assistant')
        if (last) playText(last.content)
      }
    } else if (!active && wasActiveRef.current) {
      stopSpeaking(); setIsPlaying(false); setTtsLoading(false)
    }
    wasActiveRef.current = active
  }, [active]) // eslint-disable-line

  // Begleiteter Modus ein-/ausgeschaltet: Die KI bestätigt kurz (Chat-Blase +
  // automatisch vorgelesen über den Autoplay-Effekt). AN → sie tritt zurück und
  // stellt keine Frage; AUS → sie meldet sich zurück und stellt die nächste Frage.
  // Der Steuer-Hinweis (userTurn) wird NICHT gespeichert, nur die KI-Antwort.
  useEffect(() => {
    if (companionInitRef.current) { companionInitRef.current = false; return }
    // Run-Zähler: nur der JÜNGSTE Umschalt-Lauf darf das Ergebnis anwenden UND
    // aiLoading zurücksetzen. Sonst blieb bei schnellem Umschalten ein überholter
    // Lauf mit aiLoading=true hängen → der Autoplay der Bestätigung (verlangt
    // !aiLoading) feuerte beim erneuten Wechsel nicht mehr ("nur einmal").
    const myRun = ++companionRunRef.current
    ;(async () => {
      setAiLoading(true)
      try {
        // WICHTIG: Die Modus-Anweisung gehört in den SYSTEM-Prompt, nicht in eine
        // User-Nachricht. Als imperative User-Nachricht ("Bestätige …, stelle KEINE
        // Frage") stuft Azures Jailbreak-/Prompt-Shield-Filter sie als Angriff ein
        // und der Call schlägt fehl (500) — dann wurde die alte Frage einfach wieder
        // vorgelesen und die Bestätigung kam nie.
        const modeDirective = companionOn
          ? '\n\n[MODUSWECHSEL: Der begleitete Modus wurde eingeschaltet — eine Begleitperson führt jetzt mit. Bestätige das in EINEM sehr kurzen, warmen Satz (höchstens 8 Wörter), tritt zurück und stelle KEINE Frage.]'
          : '\n\n[MODUSWECHSEL: Der begleitete Modus wurde ausgeschaltet — du übernimmst wieder. Melde dich in EINEM sehr kurzen, warmen Satz (höchstens 10 Wörter) zurück und stelle dann die nächste passende Frage.]'
        const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang) + modeDirective
        const reply = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...messagesRef.current], { memorialCode: memorial?.id, kind: 'interview' })
        if (companionRunRef.current !== myRun) return
        const finalMsgs = [...messagesRef.current, { role: 'assistant', content: reply }]
        applyMessages(finalMsgs)
        onSave?.(finalMsgs)
      } catch (e) { if (companionRunRef.current === myRun) setErr(e.message) }
      finally { if (companionRunRef.current === myRun) setAiLoading(false) }
    })()
  }, [companionOn])

  function playText(text) {
    stopSpeaking()
    // Spricht die KI (auch beim Zurückübernehmen nach dem Begleitmodus), ist die
    // aktive Person wieder der Erzähler → Schallwelle/Untertitel zurück auf ROT.
    setRecSpeaker('self')
    setIsPlaying(true); setTtsLoading(true); setErr('')
    speakText(text, {
      memorialCode: memorial?.id,
      language: lang, // Stimme passend zur gewählten Sprache (de/pl/en)
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

  async function handleMic(speaker = 'self') {
    if (micState === 'processing') return
    // Testzeit abgelaufen: keine neue Aufnahme mehr starten.
    if (expired && micState !== 'recording') return

    if (micState === 'recording') {
      mediaRecRef.current?.stop()
      return
    }
    // Sprecher der jetzt startenden Aufnahme merken (rot = Endnutzer, blau =
    // Begleitperson). Bestimmt Zuordnung der Antwort und Farbe der Schallwelle.
    speakerRef.current = speaker
    setRecSpeaker(speaker)

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
          if (text.trim()) sendAnswer(text, speakerRef.current)
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

  async function sendAnswer(explicitText, speaker = 'self') {
    const text = (explicitText ?? transcript).trim(); if (!text) return
    setTranscript(''); stopSpeaking(); setIsPlaying(false)
    // Antwort landet sofort als Chat-Blase im Verlauf; dort trägt sie dauerhaft
    // die Buttons Löschen/Neu einsprechen (undoFrom/redoFrom). Der Sprecher
    // (self/companion) bleibt erhalten – die Buch-Synthese gewichtet danach.
    const newMsgs = [...messagesRef.current, { role: 'user', content: text, speaker: speaker === 'companion' ? 'companion' : 'self' }]
    applyMessages(newMsgs); setRound(r => r + 1)
    // Antwort sofort persistieren (inkrementell), Fehler in saveErr-Prop
    onSave?.(newMsgs)
    // Begleiteter Modus: Die KI hört nur zu – die Begleitperson führt das Gespräch.
    // Keine KI-Frage/-Antwort; die Äußerungen werden nur mit Zuordnung erfasst.
    if (companionOn) return
    setAiLoading(true)
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

  // Index der aktuell prominent gezeigten KI-Frage (jüngste Assistant-Nachricht).
  let latestAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant') { latestAssistantIdx = i; break } }
  const latestQ = latestAssistantIdx >= 0 ? messages[latestAssistantIdx].content : undefined

  // Verlauf = alle Nachrichten; im Render wird nur die prominent gezeigte KI-Frage
  // (latestAssistantIdx) übersprungen. Indizes bleiben deckungsgleich mit `messages`
  // → undoFrom/redoFrom nutzen `i`. (Früher: slice(0,-1) blendete AUCH eine
  // abschließende Nutzer-/Begleitantwort aus – im Begleitmodus die letzte Nachricht,
  // weil die KI dort nicht antwortet → die Transkript-Anzeige „hing um 1".)
  const history = messages
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
      <PartnerBanner logoUrl={memorial?.owner_logo} category={memorial?.product_category} />
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          {/* Beim Lebenswerk erzählt die Person über sich selbst — „Name · Ich selbst"
              wäre nur die Zeile darüber ein zweites Mal. */}
          {memorial?.product_category !== 'lifework' && (
            <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
          )}
        </div>
        <button onClick={pause} disabled={micState !== 'idle'} className="secondary" style={{ fontSize: 13, padding: '8px 16px' }}>{t.pauseEnd}</button>
      </div>
      {timerActive && (
        <div style={{ textAlign:'center', padding:'8px 12px', borderBottom:'1px solid #e7e5e4', fontSize:14, fontWeight:700,
          background: expired ? '#fef2f2' : (remaining <= 60 ? '#fff7ed' : '#eff6ff'),
          color: expired ? '#b91c1c' : (remaining <= 60 ? '#c2410c' : '#1d4ed8') }}>
          {expired
            ? (t.timerExpiredShort || '⏳ Testzeit abgelaufen')
            : `⏳ ${t.timerRemaining || 'Verbleibende Testzeit'}: ${fmtMMSS(remaining)}`}
        </div>
      )}
      <div style={{ padding: '1.25rem 1.5rem' }}>
        {expired && (
          <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'12px 14px', fontSize:14, color:'#991b1b', lineHeight:1.55, marginBottom:14 }}>
            {t.timerExpired || 'Die Testzeit ist abgelaufen. Sie können das Interview weiter ansehen, aber keine Antworten mehr aufnehmen. Für ein unbegrenztes Interview wenden Sie sich bitte an den Anbieter.'}
          </div>
        )}
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
        {showTx && history.map((m, i) => {
          if (i === latestAssistantIdx) return null   // steht schon prominent in der Frage-Karte
          const isCompanion = m.role === 'user' && m.speaker === 'companion'
          return (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {isCompanion && <span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', marginBottom: 2 }}>👥 {t.micCompanion || 'Begleitung'}</span>}
              <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: .6, background: isCompanion ? '#dbeafe' : (m.role === 'user' ? '#e0f2fe' : '#f5f5f4'), border: isCompanion ? '1px solid #93c5fd' : 'none' }}>{m.content}</div>
              {m.role === 'user' && i === lastUserIdx && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="secondary" disabled={micState !== 'idle' || aiLoading} onClick={() => undoFrom(i)} style={{ fontSize: 11, padding: '3px 9px' }}>{t.txDelete}</button>
                  <button className="secondary" disabled={micState !== 'idle' || aiLoading} onClick={() => redoFrom(i)} style={{ fontSize: 11, padding: '3px 9px' }}>{t.txRedo}</button>
                </div>
              )}
            </div>
          </div>
        )})}
        {aiLoading && messages.length === 0 && <div style={{ margin: '1.5rem 0' }}><Dots /></div>}
        {latestQ && (
          <div style={{ ...S.card, marginBottom: '1rem', background: '#fafaf9', borderColor: '#d6d3d1', textAlign: showTx ? 'left' : 'center' }}>
            {showTx && <>
              <Lbl>{t.questionLabel}</Lbl>
              <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 1rem', color: '#292524' }}>{latestQ}</p>
            </>}
            <button onClick={handleSpeak} disabled={ttsLoading || aiLoading || expired} style={{ fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: expired ? 0.5 : 1 }}>
              {ttsLoading
                ? <><span style={{ width:14,height:14,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'lw-spin .8s linear infinite' }} /> {t.loadingShort}</>
                : isPlaying ? t.stop : hasPlayed ? t.readAgain : t.listen}
            </button>
          </div>
        )}
        {aiLoading && messages.length > 0 && <div style={{ margin: '.75rem 0' }}><Dots /></div>}
        {!aiLoading && latestQ && (
          <div style={{ ...S.card, textAlign: 'center', padding: '1.5rem 1rem' }}>
            {companionOn ? (
              // Begleiteter Modus: zwei Mikrofone. Immer nur EINS aktiv — während
              // einer Aufnahme ist das andere gesperrt.
              <div style={{ marginBottom: 14, display:'flex', gap:28, justifyContent:'center', alignItems:'flex-start' }}>
                {[
                  { sp:'self',      col:'#ef4444', bg:'#fee2e2', face:'🧑', label: t.micSelf || 'Erzähler' },
                  { sp:'companion', col:'#3b82f6', bg:'#dbeafe', face:'👥', label: t.micCompanion || 'Begleitung' },
                ].map(mic => {
                  const on  = micState === 'recording' && recSpeaker === mic.sp
                  const dis = micState === 'processing' || expired || (micState === 'recording' && recSpeaker !== mic.sp)
                  return (
                    <div key={mic.sp} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                      <span aria-hidden="true" style={{ width:34, height:34, borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:18, background: mic.bg, border:`1px solid ${mic.col}`, opacity: on ? 1 : 0.85 }}>{mic.face}</span>
                      <button onClick={() => handleMic(mic.sp)} disabled={dis}
                        style={{ width:64, height:64, borderRadius:'50%', fontSize:26, display:'inline-flex', alignItems:'center', justifyContent:'center',
                          background: on ? mic.bg : '#f5f5f4', border: on ? `2px solid ${mic.col}` : '1px solid #d6d3d1', color:'#1c1917',
                          animation: on ? 'lw-mic 1.5s ease-in-out infinite' : 'none', transition:'all .2s', opacity: (dis && !on) ? 0.4 : 1, cursor: dis ? 'not-allowed' : 'pointer' }}
                        aria-label={mic.label}>
                        {micState === 'processing' && recSpeaker === mic.sp ? '⏳' : '🎙'}
                      </button>
                      <span style={{ fontSize:11, fontWeight:700, color: mic.col }}>{mic.label}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <button
                  onClick={() => handleMic('self')}
                  disabled={micState === 'processing' || expired}
                  style={{ width:72, height:72, borderRadius:'50%', fontSize:28, display:'inline-flex', alignItems:'center', justifyContent:'center', background:micBg, border:micBorder, color:'#1c1917', animation:micAnim, transition:'all .2s', opacity: expired ? 0.4 : 1, cursor: expired ? 'not-allowed' : 'pointer' }}
                  aria-label={micLabel}
                >{micIcon}</button>
              </div>
            )}
            {micState === 'recording' && micStream && (
              <div style={{ maxWidth:320, margin:'0 auto 10px' }}>
                <Waveform stream={micStream} color={(micState==='recording' && recSpeaker === 'companion') ? '#3b82f6' : '#dc2626'} />
              </div>
            )}
            <div style={{ fontSize:13, fontWeight:500, color: micState==='recording' ? (recSpeaker === 'companion' ? '#2563eb' : '#dc2626') : '#78716c', marginBottom:4 }}>
              {micLabel}
            </div>
            {/* Begleitmodus wird direkt am Mikrofon geschaltet (nicht im Menü):
                grafisches Personen-Symbol + Umschalter, blau wenn aktiv. */}
            {memorial?.companion_mode === true && (
              <div style={{ marginTop:12, display:'flex', justifyContent:'center' }}>
                <button onClick={() => setCompanionOn(v => !v)} aria-pressed={companionOn}
                  style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'7px 14px', borderRadius:999, fontSize:12.5, fontWeight: companionOn ? 700 : 500, cursor:'pointer', lineHeight:1.1,
                    border:`1px solid ${companionOn ? '#1d4ed8' : '#d6d3d1'}`, background: companionOn ? '#1d4ed8' : '#fff', color: companionOn ? '#fff' : '#57534e' }}>
                  <span aria-hidden="true" style={{ width:24, height:24, borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:14, background: companionOn ? 'rgba(255,255,255,.2)' : '#dbeafe' }}>👥</span>
                  <span>{t.companionTab || 'Begleitet'}</span>
                </button>
              </div>
            )}
            {/* Beide Bedienelemente stehen in EIGENEN Zeilen. Vorher waren Schalter
                (inline-flex) und Button Inline-Elemente derselben Zeile — der Button
                rutschte dann neben die Schalter-Beschriftung und überdeckte sie. */}
            {/* In-Interview-Schalter nur noch, wenn es KEINE Tab-Leiste gibt — dort
                sitzt der Transkript-Umschalter jetzt als eigenes Icon/Feld. */}
            {txAvailable && !memorial.photo_upload_tab && (
              <div style={{ marginTop:18 }}>
                <div
                  onClick={() => setShowTx(v => !v)}
                  role="switch"
                  aria-checked={showTx}
                  style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:10, cursor:'pointer', fontSize:12, color:'#78716c', userSelect:'none' }}
                >
                  <span style={{ position:'relative', width:38, height:22, borderRadius:11, background: showTx ? '#1c1917' : '#d6d3d1', transition:'background .2s', flexShrink:0, display:'inline-block' }}>
                    <span style={{ position:'absolute', top:2, left: showTx ? 18 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 2px rgba(0,0,0,.25)' }} />
                  </span>
                  {t.txToggleLabel}
                </div>
              </div>
            )}
            {memorial.catalog && micState === 'idle' && !expired && (
              <div style={{ marginTop:16 }}>
                <button
                  onClick={() => sendAnswer(t.nextQuestionMsg)}
                  disabled={aiLoading}
                  className="secondary"
                  style={{ fontSize:13, padding:'8px 16px' }}
                >
                  {t.nextQuestion}
                </button>
              </div>
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
          {memorial?.product_category !== 'lifework' && (
            <div style={{ fontSize:12, color:'#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
          )}
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
// Einstellungs-Tab des Endnutzers (Kategorie Lebenswerk): Grafikstil + Textstil
// seines eigenen Buchs. Autorisiert über den Endnutzer-Token (siehe App.jsx).
function EnduserSettings({ code, token, memorial, t }) {
  const cat = memorial?.product_category || 'lifework'
  const [imageStyle, setImageStyle] = useState(memorial?.image_style || DEFAULT_IMAGE_STYLE)
  const [bookLayout, setBookLayout] = useState(memorial?.book_layout || DEFAULT_BOOK_LAYOUT)
  const [textStyle, setTextStyle]   = useState(memorial?.text_style || defaultTextStyle(cat))
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')

  async function save(patch) {
    setErr(''); setSaved('')
    try {
      await updateOwnMemorial(token, code, patch)
      setSaved(t.settingsSaved)
      setTimeout(() => setSaved(''), 2000)
    } catch { setErr(t.settingsSaveErr) }
  }

  return (
    <div style={{ ...S.page, paddingTop:'2rem' }}>
      <h2 style={{ fontSize:20, fontWeight:700, marginBottom:6 }}>{t.settingsTitle}</h2>
      <p style={{ ...S.muted, marginBottom:'1.5rem' }}>{t.settingsIntro}</p>
      <Err msg={err} />
      <div style={{ marginBottom:24 }}>
        <Lbl>{t.settingsImageStyle}</Lbl>
        <ImageStylePicker value={imageStyle} onChange={k => { setImageStyle(k); save({ imageStyle: k }) }} />
      </div>
      <div style={{ marginBottom:24 }}>
        <Lbl>{t.settingsBookLayout}</Lbl>
        <BookLayoutPicker value={bookLayout} onChange={k => { setBookLayout(k); save({ bookLayout: k }) }} />
      </div>
      <div style={{ marginBottom:24 }}>
        <Lbl>{t.settingsWritingStyle || 'Schreibstil'}</Lbl>
        <TextStylePicker category={cat} value={textStyle} onChange={k => { setTextStyle(k); save({ textStyle: k }) }} />
      </div>
      {saved && <p style={{ fontSize:13, color:'#16a34a' }}>{saved}</p>}
    </div>
  )
}

// Kleiner Schiebeschalter für die Menü-Einträge (Transkript/Begleitet).
function MiniSwitch({ on, color = '#1c1917' }) {
  return (
    <span style={{ position:'relative', width:38, height:22, borderRadius:11, background: on ? color : '#d6d3d1', transition:'background .2s', flexShrink:0, display:'inline-block' }}>
      <span style={{ position:'absolute', top:2, left: on ? 18 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 2px rgba(0,0,0,.25)' }} />
    </span>
  )
}

// Navigation im Interview als HAMBURGER-Menü (oben rechts). Alles steckt darin:
// Ansicht wechseln (Interview/Foto/Probedruck/Einstellungen), die Modus-Schalter
// (Transkript & Korrektur, Begleitet) und „Später fortsetzen oder beenden". Die
// Interview-Ansicht ist der oberste Menüpunkt → man kommt immer schnell zurück.
function ContribMenu({ tab, setTab, t, withPhoto, withSettings, withProof, showTx, onToggleTx, onPause }) {
  const [open, setOpen] = useState(false)
  const navItems = [
    { id:'interview', icon:'🎙️', label:t.tabInterview },
    ...(withPhoto    ? [{ id:'photo',    icon:'📷', label:t.tabPhoto }] : []),
    ...(withProof    ? [{ id:'proof',    icon:'📖', label:t.tabProof || 'Probedruck' }] : []),
    ...(withSettings ? [{ id:'settings', icon:'⚙️', label:t.tabSettings }] : []),
  ]
  const go = id => { setTab(id); setOpen(false) }
  const row = { display:'flex', alignItems:'center', gap:12, width:'100%', padding:'13px 14px', border:'none', background:'none', cursor:'pointer', fontSize:15, textAlign:'left', color:'#1c1917', borderRadius:10 }
  const sep = { borderTop:'1px solid #f0efec', margin:'8px 6px' }
  return (
    <>
      <button aria-label={t.menuTitle || 'Menü'} onClick={() => setOpen(true)}
        style={{ position:'fixed', top:14, right:14, zIndex:40, width:46, height:46, borderRadius:12, background:'#1c1917', border:'none', boxShadow:'0 2px 8px rgba(0,0,0,.28)', cursor:'pointer', fontSize:22, lineHeight:1, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>☰</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', zIndex:50, display:'flex', justifyContent:'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width:'min(320px,86vw)', height:'100%', background:'#fff', boxShadow:'-2px 0 12px rgba(0,0,0,.12)', padding:'14px 8px', overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'2px 8px 10px' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#a8a29e', textTransform:'uppercase', letterSpacing:.5 }}>{t.menuTitle || 'Menü'}</span>
              <button onClick={() => setOpen(false)} aria-label="×" style={{ background:'none', border:'none', fontSize:24, cursor:'pointer', color:'#78716c', lineHeight:1 }}>×</button>
            </div>
            {navItems.map(it => (
              <button key={it.id} onClick={() => go(it.id)} style={{ ...row, background: tab===it.id ? '#f5f5f4' : 'none', fontWeight: tab===it.id ? 700 : 500 }}>
                <span style={{ fontSize:19 }}>{it.icon}</span><span>{it.label}</span>
              </button>
            ))}
            {onToggleTx && <div style={sep} />}
            {onToggleTx && (
              <button onClick={onToggleTx} aria-pressed={!!showTx} style={row}>
                <span style={{ fontSize:19 }}>📝</span>
                <span style={{ flex:1 }}>{t.txTab || 'Transkript'}</span>
                <MiniSwitch on={showTx} />
              </button>
            )}
            {onPause && (<>
              <div style={sep} />
              <button onClick={() => { setOpen(false); onPause() }} style={{ ...row, color:'#78716c' }}>
                <span style={{ fontSize:19 }}>⏸️</span><span>{t.pauseEnd || 'Später fortsetzen oder beenden'}</span>
              </button>
            </>)}
          </div>
        </div>
      )}
    </>
  )
}


// Kleines Modal + schreibgeschützte Buchansicht (von ProofTab genutzt).
function PModal({ children, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:60, padding:16 }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:14, padding:'1.6rem', maxWidth:440, width:'100%', maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>{children}</div>
    </div>
  )
}
function BookRead({ book, imgUrl }) {
  if (!book) return null
  return (
    <article style={{ fontFamily:'Georgia, serif', color:'#1c1917' }}>
      <h1 style={{ fontSize:26, fontWeight:700, textAlign:'center', margin:'10px 0 4px' }}>{book.title}</h1>
      {book.subtitle && <p style={{ textAlign:'center', fontStyle:'italic', color:'#78716c', marginTop:0 }}>{book.subtitle}</p>}
      {(book.chapters||[]).map((c,i)=>(
        <section key={i} style={{ marginTop:28 }}>
          {c.image_path && imgUrl(c.image_path) && <img src={imgUrl(c.image_path)} alt="" style={{ width:'100%', borderRadius:10, display:'block', margin:'0 0 12px', background:'#f5f5f4' }} />}
          <div style={{ textAlign:'center', fontSize:12, color:'#a8a29e', letterSpacing:1 }}>KAPITEL {c.number}</div>
          <h2 style={{ fontSize:21, fontWeight:700, textAlign:'center', margin:'4px 0 14px' }}>{c.heading}</h2>
          {String(c.body||'').split('\n\n').map((p,k)=>p.trim() && <p key={k} style={{ fontSize:16, lineHeight:1.75, textAlign:'justify', margin:'0 0 12px' }}>{p.trim()}</p>)}
        </section>
      ))}
    </article>
  )
}

// Fügt `repl` an Stelle [start,end) ein und korrigiert die Leerzeichen an den zwei
// Nahtstellen: kein fehlendes (z. B. nach einem Satzpunkt) und kein doppeltes.
// Öffnende Zeichen (Klammer/Anführung) bzw. anschließende Satzzeichen bleiben ohne
// Zwischenraum.
function spliceText(text, start, end, repl) {
  let before = text.slice(0, start)
  let after  = text.slice(end)
  const r = String(repl).trim()
  const opener = /[([{«„“‚'¿¡]/       // danach KEIN Leerzeichen
  const closer = /[.,;:!?)\]}»”“"']/  // davor KEIN Leerzeichen
  if (before && r && !/\s$/.test(before) && !/^\s/.test(r) && !opener.test(before.slice(-1)) && !closer.test(r[0])) before += ' '
  if (after  && r && !/\s$/.test(r) && !/^\s/.test(after) && !opener.test(r.slice(-1)) && !closer.test(after[0])) after = ' ' + after
  return (before + r + after).replace(/[ \t]{2,}/g, ' ')
}

// Textarea, die automatisch auf die Texthöhe wächst (kein inneres Scrollen).
function AutoGrowTextarea({ value, onChange, onFocus, style }) {
  const innerRef = useRef(null)
  const grow = () => { const el = innerRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }
  useEffect(() => { grow() }, [value])
  return (
    <textarea
      ref={innerRef}
      value={value}
      onFocus={onFocus}
      onChange={e => { onChange(e); grow() }}
      style={{ ...style, overflow: 'hidden', resize: 'none' }}
    />
  )
}

// Probedruck-Tab (nur Lebenswerk). Zwei Modi:
//  • ZWISCHENSTAND — Textfassung aus den Antworten, bis zu N×, nur ansehen.
//  • VORLÄUFIGE DRUCKVERSION — schließt das Interview ENDGÜLTIG ab, erzeugt das Buch
//    MIT Bildern und ist danach editierbar (Text + je Kapitel Bild neu generieren,
//    bis zu N× mit Historie). Abschließen ist unwiderruflich (Betreiber wird per
//    E-Mail informiert). Alle Bearbeitung läuft über einen Buch-Lock (Checkout).
function ProofTab({ code, token, memorial, contribId, lang, t, onMemorialPatch }) {
  const [loading, setLoading]   = useState(true)
  const [book, setBook]         = useState(null)
  const [signed, setSigned]     = useState({})       // Bildpfad → signierte URL
  const [imageRegen, setImageRegen] = useState({})   // Kapitelnr → Anzahl Generierungen
  const [proofUsed, setProofUsed] = useState(memorial?.proof_used || 0)
  const [proofMax, setProofMax]   = useState(memorial?.proof_max ?? 3)
  const [finalized, setFinalized] = useState(false)
  const [lockedByOther, setLockedByOther] = useState(false)

  const [busy, setBusy]         = useState(false)
  const [pct, setPct]           = useState(0)
  const [progress, setProgress] = useState('')
  const [regenCh, setRegenCh]   = useState(null)
  const [err, setErr]           = useState('')
  const [saved, setSaved]       = useState('')
  const [dirty, setDirty]       = useState(false)

  const [confirmZw, setConfirmZw]       = useState(false)
  const [confirmPrint, setConfirmPrint] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [okText, setOkText]     = useState('')

  const lockRef   = useRef(null)
  const hbRef     = useRef(null)
  const cancelRef = useRef(false)
  const bookRef   = useRef(null)

  // Audio-Textänderung (Druckversion): EIN Icon oben, wirkt auf das zuletzt
  // fokussierte Feld (Titel/Untertitel/Kapitel-Überschrift/-Text).
  const [audioEdit, setAudioEdit] = useState(null)  // { state:'recording'|'processing' }
  const audioRecRef = useRef(null)
  const audioChunks = useRef([])
  const activeRef   = useRef(null) // { kind, idx, el } zuletzt fokussiertes Feld
  const selRef      = useRef(null) // { kind, idx, start, end } zum Aufnahmestart erfasst

  const du = String(memorial?.intake?.address || 'Sie').trim().toLowerCase() === 'du'
  const P = proofT(lang, du)
  const isPrint = !!book?.print
  const zwRemaining = Math.max(0, proofMax - proofUsed)
  const imgTotalMax = proofMax + 1
  const style = memorial?.image_style || DEFAULT_IMAGE_STYLE

  useEffect(() => {
    let alive = true
    getEnduserBook(code, token).then(d => {
      if (!alive) return
      setBook(d.book || null); bookRef.current = d.book || null
      setSigned(d.signed || {}); setImageRegen(d.image_regen || {})
      setProofUsed(d.proof_used || 0); setProofMax(d.proof_max ?? 3)
      setFinalized(!!d.book_finalized); setLockedByOther(!!d.lock); setLoading(false)
    }).catch(() => { if (alive) setLoading(false) })
    return () => { alive = false; stopHeartbeat(); if (lockRef.current) releaseEditLock(code, token, lockRef.current).catch(() => {}) }
  }, [code]) // eslint-disable-line

  function stopHeartbeat() { if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null } }
  function startHeartbeat() { stopHeartbeat(); hbRef.current = setInterval(() => { if (lockRef.current) heartbeatEditLock(code, token, lockRef.current).catch(() => {}) }, 5 * 60 * 1000) }
  async function ensureLock() { if (lockRef.current) return lockRef.current; const r = await acquireEditLock(code, token); lockRef.current = r.token; startHeartbeat(); return r.token }
  async function release() { stopHeartbeat(); const tk = lockRef.current; lockRef.current = null; if (tk) { try { await releaseEditLock(code, token, tk) } catch {} } }
  function applyBook(nb) { bookRef.current = nb; setBook(nb) }

  async function loadContribution() {
    const c = await getContribution(contribId, code)
    if (!c || !Array.isArray(c.messages) || !c.messages.some(m => m.role === 'user')) {
      throw new Error(P.noAnswers)
    }
    return c
  }

  // ── Zwischenstand (Text; verbraucht eine Vorschau) ──
  async function generateInterim() {
    setConfirmZw(false); setErr(''); setBusy(true); setPct(0); setProgress(P.preparing); cancelRef.current = false
    try {
      await ensureLock()
      const cons = await consumeProof(code, token); setProofUsed(cons.used); setProofMax(cons.max)
      const c = await loadContribution()
      const nb = await generateProofBook({ memorial, contributions: [c], lang, cancelRef, onProgress: p => { setPct(p.pct); setProgress(p.text) } })
      await saveEnduserBook(code, token, lockRef.current, nb)
      applyBook(nb)
    } catch (e) { if (e.message !== '__CANCELLED__') setErr(e.message) }
    finally { await release(); setBusy(false) }
  }

  // ── Vorläufige Druckversion (schließt Interview, Text + Bilder) ──
  async function createPrint() {
    setConfirmPrint(false); setErr(''); setBusy(true); setPct(0); setProgress(P.progInterview); cancelRef.current = false
    try {
      const sp = await startPrintVersion(code, token)   // schließt Interview endgültig + Lock
      lockRef.current = sp.token; startHeartbeat()
      onMemorialPatch?.({ interview_closed: true })      // Status sofort aktualisieren
      const c = await loadContribution()
      setProgress(P.progText)
      const nb = await generateProofBook({ memorial, contributions: [c], lang, cancelRef, onProgress: p => { setPct(Math.round(p.pct * 0.4)); setProgress(p.text) } })
      nb.print = true
      await saveEnduserBook(code, token, lockRef.current, nb)
      applyBook(nb)
      const chs = nb.chapters || []
      for (let i = 0; i < chs.length; i++) {
        if (cancelRef.current) break
        setPct(40 + Math.round(55 * i / Math.max(1, chs.length)))
        setProgress(P.progImg(i + 1, chs.length))
        const ch = chs[i]
        const prompt = ch.image_prompt || `${ch.heading}. ${String(ch.body || '').slice(0, 300)}`
        try {
          const r = await enduserGenerateImage(code, token, { chapterNumber: ch.number, prompt, lockToken: lockRef.current, imageStyle: style })
          ch.image_path = r.storagePath; ch.image_history = [r.storagePath]
          if (r.url) setSigned(s => ({ ...s, [r.storagePath]: r.url }))
          setImageRegen(rr => ({ ...rr, [String(ch.number)]: r.count }))
          await saveEnduserBook(code, token, lockRef.current, nb)
          applyBook({ ...nb })
        } catch (e) { console.warn('Bild fehlgeschlagen:', e.message) }
      }
      setPct(100)
    } catch (e) { if (e.message !== '__CANCELLED__') setErr(e.message) }
    finally { setBusy(false) }   // Lock bleibt — Bearbeitung geht weiter
  }

  // ── Ein Kapitelbild neu generieren ──
  async function regenImage(idx) {
    const nb = bookRef.current; const ch = nb.chapters[idx]
    setErr(''); setRegenCh(ch.number)
    try {
      const tk = await ensureLock()
      const prompt = ch.image_prompt || `${ch.heading}. ${String(ch.body || '').slice(0, 300)}`
      const r = await enduserGenerateImage(code, token, { chapterNumber: ch.number, prompt, lockToken: tk, imageStyle: style })
      const hist = Array.isArray(ch.image_history) ? [...ch.image_history] : (ch.image_path ? [ch.image_path] : [])
      if (!hist.includes(r.storagePath)) hist.push(r.storagePath)
      ch.image_path = r.storagePath; ch.image_history = hist
      if (r.url) setSigned(s => ({ ...s, [r.storagePath]: r.url }))
      setImageRegen(rr => ({ ...rr, [String(ch.number)]: r.count }))
      applyBook({ ...nb })
      await saveEnduserBook(code, token, tk, nb)
    } catch (e) { setErr(e.message) }
    finally { setRegenCh(null) }
  }

  // ── Zu einer früheren Bildversion zurückwechseln ──
  async function pickImage(idx, path) {
    const nb = bookRef.current; nb.chapters[idx].image_path = path; applyBook({ ...nb })
    try { const tk = await ensureLock(); await saveEnduserBook(code, token, tk, nb) } catch (e) { setErr(e.message) }
  }

  function setField(patch) { const nb = { ...bookRef.current, ...patch }; applyBook(nb); setDirty(true) }
  function setChapter(idx, patch) { const nb = { ...bookRef.current, chapters: bookRef.current.chapters.map((c, j) => j === idx ? { ...c, ...patch } : c) }; applyBook(nb); setDirty(true) }
  async function saveText() {
    setErr('')
    try { const tk = await ensureLock(); await saveEnduserBook(code, token, tk, bookRef.current); setDirty(false); setSaved(P.saved); setTimeout(() => setSaved(''), 2500) }
    catch (e) { setErr(e.message) }
  }

  async function doFinalize() {
    setErr('')
    try {
      const tk = await ensureLock()
      if (dirty) { await saveEnduserBook(code, token, tk, bookRef.current); setDirty(false) }
      await finalizeBook(code, token, tk)
      lockRef.current = null; stopHeartbeat()
      setFinalized(true); setFinalizeOpen(false); setOkText('')
      onMemorialPatch?.({ book_finalized: true, interview_closed: true })  // Status sofort aktualisieren
    } catch (e) { setErr(e.message) }
  }

  // Merkt sich das zuletzt fokussierte Editierfeld (für das obere Audio-Icon).
  const setActive = (kind, idx = null) => (e) => { activeRef.current = { kind, idx, el: e.currentTarget } }

  // ── Audio-Textänderung: EIN Icon oben, wirkt auf das zuletzt fokussierte Feld ──
  async function toggleAudioEdit() {
    if (audioEdit?.state === 'recording') { try { audioRecRef.current?.stop() } catch {}; return }
    if (audioEdit) return
    const a = activeRef.current
    if (!a || !a.el) { setErr(P.audioPickFirst); return }
    const el = a.el
    const hasSel = el.selectionStart != null && el.selectionEnd > el.selectionStart
    selRef.current = { kind: a.kind, idx: a.idx, start: hasSel ? el.selectionStart : null, end: hasSel ? el.selectionEnd : null }
    setErr('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      audioRecRef.current = rec; audioChunks.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setAudioEdit({ state: 'processing' })
        try {
          const mimeType = rec.mimeType || 'audio/webm'
          const blob = new Blob(audioChunks.current, { type: mimeType })
          const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(blob) })
          const resp = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: base64, mimeType, memorialCode: code, language: lang }) })
          const data = await resp.json()
          if (!resp.ok) throw new Error(data.error)
          const instruction = String(data.text || '').trim()
          if (!instruction) throw new Error(P.audioNoText)
          await applyAudioEdit(selRef.current, instruction)
        } catch (e) { setErr(e.message) }
        finally { setAudioEdit(null) }
      }
      rec.start(); setAudioEdit({ state: 'recording' })
    } catch (e) { setErr(e.message); setAudioEdit(null) }
  }

  // Feldtext lesen/schreiben je Feldart (Titel/Untertitel/Kapitel-Überschrift/-Text).
  function fieldText(t) {
    const nb = bookRef.current
    if (t.kind === 'title')    return String(nb.title || '')
    if (t.kind === 'subtitle') return String(nb.subtitle || '')
    if (t.kind === 'heading')  return String(nb.chapters[t.idx]?.heading || '')
    return String(nb.chapters[t.idx]?.body || '')
  }
  function writeField(t, val) {
    if (t.kind === 'title')          setField({ title: val })
    else if (t.kind === 'subtitle')  setField({ subtitle: val })
    else setChapter(t.idx, t.kind === 'heading' ? { heading: val } : { body: val })
  }

  // Transkribierte Anweisung auf das (markierte oder ganze) Feld anwenden.
  async function applyAudioEdit(t, instruction) {
    if (!t) return
    const text = fieldText(t)
    const hasSel = t.start != null && t.end > t.start
    const segment = hasSel ? text.slice(t.start, t.end) : text
    const isHeading = t.kind !== 'body'
    // Anweisungen im SYSTEM-Prompt (Azure-Prompt-Shield lehnt Imperative im User-Turn ab).
    const sys = `${langDirective(lang)} Du bist ein einfühlsamer Lektor einer Autobiografie in der Ich-Form. `
      + (isHeading
          ? `Überarbeite die bereitgestellte ÜBERSCHRIFT gemäß der Anweisung — kurz und prägnant, ohne abschließenden Punkt. `
          : `Überarbeite AUSSCHLIESSLICH den bereitgestellten Abschnitt gemäß der Anweisung. Behalte Ich-Perspektive, Zeitform und den warmen, persönlichen Ton bei. `)
      + `Behalte die Sprache bei. Erfinde keine neuen Fakten. Gib NUR den überarbeiteten Text zurück – ohne Anführungszeichen, ohne Vorbemerkung, ohne Kommentar.`
    const revised = String(await askLLM(sys, [{ role: 'user', content: `${isHeading ? 'ÜBERSCHRIFT' : 'ABSCHNITT'}:\n${segment}\n\nANWEISUNG:\n${instruction}` }], { memorialCode: code, token, kind: 'edit' }) || '').trim()
    if (!revised) return
    const newText = hasSel ? spliceText(text, t.start, t.end, revised) : revised
    writeField(t, newText)
    try { const tk = await ensureLock(); await saveEnduserBook(code, token, tk, bookRef.current) } catch (e) { setErr(e.message) }
  }

  const page = { ...S.page, paddingTop: '1.5rem' }
  const imgUrl = (p) => (p ? signed[p] : null)
  const heading = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t.tabProof || 'Probedruck'}</h2>
      {!isPrint && !finalized && <span style={{ fontSize: 12, color: '#78716c' }}>{P.remaining(zwRemaining, proofMax)}</span>}
    </div>
  )

  if (loading) return <div style={page}><Dots /></div>

  if (busy) return (
    <div style={page}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>{t.tabProof || 'Probedruck'}</h2>
      <div style={{ height: 8, background: '#e7e5e4', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#1c1917', transition: 'width .3s' }} />
      </div>
      <p style={{ ...S.muted, margin: 0 }}>{pct}% · {progress}</p>
      <button className="secondary" onClick={() => { cancelRef.current = true }} style={{ marginTop: 16, fontSize: 13 }}>{P.cancel}</button>
    </div>
  )

  // ── FINALISIERT ──
  if (finalized) return (
    <div style={page}>
      {heading}
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 14, color: '#166534' }}>
        ✓ {P.finalizedBanner}
      </div>
      <BookRead book={book} imgUrl={imgUrl} />
    </div>
  )

  // ── DRUCKVERSION (editierbar) ──
  if (isPrint) return (
    <div style={page}>
      {heading}
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
        {P.printBanner}
      </div>
      <Err msg={err} />
      {/* Immer sichtbare Aktionsleiste: EIN Audio-Icon wirkt auf den zuletzt
          angetippten Absatz/die Überschrift (markierter Teil, sonst ganzes Feld). */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fafaf9', display: 'flex', gap: 8, margin: '0 0 4px', padding: '8px 0', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #f0efec' }}>
        <button onClick={toggleAudioEdit} disabled={audioEdit?.state === 'processing'}
          className={audioEdit?.state === 'recording' ? '' : 'secondary'}
          style={{ fontSize: 13, padding: '8px 14px' }}>
          {audioEdit?.state === 'recording' ? P.audioEditStop : audioEdit?.state === 'processing' ? P.audioEditBusy : P.audioBar}
        </button>
        <button onClick={saveText} disabled={!dirty} style={{ fontSize: 14, padding: '8px 16px' }}>{P.save}</button>
        <button onClick={() => setFinalizeOpen(true)} className="secondary" style={{ fontSize: 14, padding: '8px 16px' }}>{P.finalizeBtn}</button>
      </div>
      <p style={{ fontSize: 11, color: '#a8a29e', margin: '0 0 12px' }}>{P.audioBarHint}</p>
      {saved && <p style={{ fontSize: 13, color: '#16a34a' }}>{saved}</p>}
      <input value={book.title || ''} onFocus={setActive('title')} onChange={e => setField({ title: e.target.value })} placeholder={P.fieldTitle} style={{ width: '100%', fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, textAlign: 'center', border: '1px solid #f0efec', borderRadius: 8, padding: 10, marginBottom: 6 }} />
      <input value={book.subtitle || ''} onFocus={setActive('subtitle')} onChange={e => setField({ subtitle: e.target.value })} placeholder={P.fieldSubtitle} style={{ width: '100%', fontFamily: 'Georgia, serif', fontStyle: 'italic', textAlign: 'center', color: '#78716c', border: '1px solid #f0efec', borderRadius: 8, padding: 8, marginBottom: 8 }} />
      {(book.chapters || []).map((c, i) => {
        const used = imageRegen[String(c.number)] || (c.image_path ? 1 : 0)
        const left = Math.max(0, imgTotalMax - used)
        const hist = (c.image_history || []).filter(p => p !== c.image_path)
        return (
          <section key={i} style={{ marginTop: 24, borderTop: '1px solid #f0efec', paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: '#a8a29e', marginBottom: 6 }}>{P.chapter(c.number)}</div>
            {c.image_path && imgUrl(c.image_path) ? (
              <img src={imgUrl(c.image_path)} alt="" style={{ width: '100%', borderRadius: 10, display: 'block', marginBottom: 8, background: '#f5f5f4' }} />
            ) : (
              <div style={{ background: '#f5f5f4', borderRadius: 10, padding: '30px 12px', textAlign: 'center', color: '#a8a29e', marginBottom: 8, fontSize: 13 }}>{P.imgNone}</div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <button onClick={() => regenImage(i)} disabled={regenCh != null || left <= 0} className="secondary" style={{ fontSize: 13, padding: '6px 12px' }}>
                {regenCh === c.number ? P.imgBusy : (c.image_path ? P.imgRegen : P.imgCreate)}
              </button>
              <span style={{ fontSize: 12, color: left <= 0 ? '#b91c1c' : '#78716c' }}>{left <= 0 ? P.imgNoneLeft : P.imgLeft(left)}</span>
            </div>
            {hist.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#78716c', marginBottom: 4 }}>{P.imgHistory}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {hist.map(p => (imgUrl(p) &&
                    <img key={p} src={imgUrl(p)} alt="" onClick={() => pickImage(i, p)} style={{ width: 72, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #e7e5e4' }} />
                  ))}
                </div>
              </div>
            )}
            <input value={c.heading || ''} onFocus={setActive('heading', i)} onChange={e => setChapter(i, { heading: e.target.value })} placeholder={P.headingPh} style={{ fontWeight: 700, marginBottom: 8 }} />
            <AutoGrowTextarea onFocus={setActive('body', i)} value={c.body || ''} onChange={e => setChapter(i, { body: e.target.value })} style={{ width: '100%', minHeight: 120, fontSize: 15, lineHeight: 1.6, fontFamily: 'Georgia, serif', padding: 12, borderRadius: 8, border: '1px solid #e7e5e4' }} />
          </section>
        )
      })}

      {finalizeOpen && (
        <PModal onClose={() => setFinalizeOpen(false)}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 10 }}>{P.finalizeTitle}</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#44403c' }}>{P.finalizeText}</p>
          <input value={okText} onChange={e => setOkText(e.target.value)} placeholder="OK" style={{ width: '100%', marginBottom: 14 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={() => { setFinalizeOpen(false); setOkText('') }} style={{ fontSize: 14 }}>{P.cancel}</button>
            <button onClick={doFinalize} disabled={okText.trim().toUpperCase() !== 'OK'} style={{ fontSize: 14 }}>{P.finalize}</button>
          </div>
        </PModal>
      )}
    </div>
  )

  // ── ZWISCHENSTAND / LANDING (zwei Modi zur Auswahl) ──
  return (
    <div style={page}>
      {heading}
      <Err msg={err} />
      {lockedByOther && !book && <p style={{ fontSize: 13, color: '#b45309' }}>{P.lockedByOther}</p>}

      {book && !isPrint && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={() => setConfirmZw(true)} className="secondary" disabled={zwRemaining <= 0} style={{ fontSize: 14, padding: '8px 16px' }}>{P.zwRegen}</button>
          </div>
          <BookRead book={book} imgUrl={imgUrl} />
          <hr style={{ border: 0, borderTop: '1px solid #e7e5e4', margin: '24px 0' }} />
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {!book && (
          <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.4rem' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{P.zwCardTitle}</div>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#57534e', marginTop: 0 }}>{P.zwCardText}</p>
            <button onClick={() => setConfirmZw(true)} disabled={zwRemaining <= 0} style={{ fontSize: 15, padding: '10px 18px' }}>{P.zwCardBtn}</button>
            {zwRemaining <= 0 && <p style={{ fontSize: 13, color: '#b91c1c', marginTop: 10 }}>{P.zwUsedUp(proofMax)}</p>}
          </div>
        )}
        <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.4rem' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{P.endCardTitle}</div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#57534e', marginTop: 0 }}>{P.endCardText}</p>
          <button onClick={() => setConfirmPrint(true)} style={{ fontSize: 15, padding: '10px 18px' }}>{P.endCardBtn}</button>
        </div>
      </div>

      {confirmZw && (
        <PModal onClose={() => setConfirmZw(false)}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 10 }}>{P.zwConfirmTitle}</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#44403c' }}>{P.zwConfirmText(Math.max(0, zwRemaining - 1), proofMax, !!book)}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="secondary" onClick={() => setConfirmZw(false)} style={{ fontSize: 14 }}>{P.cancel}</button>
            <button onClick={generateInterim} style={{ fontSize: 14 }}>{P.createNow}</button>
          </div>
        </PModal>
      )}

      {confirmPrint && (
        <PModal onClose={() => setConfirmPrint(false)}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 10 }}>{P.printWarnTitle}</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#44403c' }}>{P.printWarnText}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="secondary" onClick={() => setConfirmPrint(false)} style={{ fontSize: 14 }}>{P.cancel}</button>
            <button onClick={createPrint} style={{ fontSize: 14 }}>{P.printWarnBtn}</button>
          </div>
        </PModal>
      )}
    </div>
  )
}

// `endUserToken` gesetzt → der Erzähler ist der Endnutzer eines Lebenswerks: Er
// erzählt sein EIGENES Leben (keine Beziehungsangabe), kann Fotos hochladen und
// bekommt einen Einstellungs-Tab für Grafik- und Textstil seines Buchs.
export function ContributorFlow({ code, endUserToken = null, onLogout = null }) {
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
  const [showTx, setShowTx]                   = useState(false)        // Transkript einblenden (auch über die Tab-Leiste steuerbar)
  const [companionOn, setCompanionOn]         = useState(false)        // begleiteter Co-Interview-Modus aktiv
  const saveQueueRef                          = useRef(Promise.resolve())
  // Die Einstiegs-Entscheidung (fortsetzen / Info-Maske / Interview) darf NUR
  // EINMAL fallen. Sonst triggert sie ein späterer `setMemorial(...)` erneut — z. B.
  // wenn `startInterview()` beim Lebenswerk den nachgetragenen Namen ans Buch
  // schreibt: dann tauchte mitten im laufenden Interview fälschlich der
  // „vorhandene Session"-Hinweis auf (Audio lief schon, Felder wurden überschrieben).
  const bootedRef                             = useRef(false)

  useEffect(() => {
    getMemorial(code)
      .then(m => setMemorial(m))
      .catch(e => { setErr(e.message); setView('error') })
  }, [code])

  useEffect(() => {
    if (!memorial || bootedRef.current) return
    bootedRef.current = true
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
    // wurde – sonst zurück zur Info-Maske inkl. Einwilligungsschritt. Beim
    // Lebenswerk gibt es keine Beziehungsangabe, die vollständig sein könnte.
    const relOk = isSelf || Boolean(form && form.relationship)
    const complete = form && form.name && form.gender && relOk && form.address && local.consentAt
    setContribId(local.contribId)
    if (form) setContribForm({ ...contribForm, ...form })
    setInitialMessages([])
    setView(complete ? 'interview' : 'info')
  }

  function startFresh() {
    // Eine bereits erteilte Einwilligung (aus der lokalen Sitzung) übernehmen: Sie
    // deckt die Verarbeitung, nicht die einzelne Sitzung → beim Neubeginn nicht
    // erneut abfragen. Ohne vorige Einwilligung bleibt der Haken nötig.
    const priorConsent = resumePrompt?.consentAt || consentAt || null
    clearLocalSession(code)
    setResumePrompt(null)
    setContribId(genContribId())
    setInitialMessages([])
    // Beim Lebenswerk die schon am Buch bekannten Stammdaten wieder vorbelegen —
    // der isSelf-Effekt läuft hier NICHT erneut (memorial bleibt gleich), sonst
    // wären ausgeblendete Pflichtfelder (Name/Geschlecht/Anrede) leer und der
    // „Interview beginnen"-Button bliebe inaktiv.
    setContribForm(isSelf
      ? { name: memorial?.name || '', gender: memorial?.gender || '', relationship: SELF_REL, address: memorial?.intake?.address || 'Sie' }
      : { name:'', gender:'', relationship:'', address:'Sie' })
    if (priorConsent) { setConsentAt(priorConsent); setConsentChecked(true) }
    else { setConsentAt(null); setConsentChecked(false) }
    setView('info')
  }

  function startInterview() {
    unlockAudio()
    // Lebenswerk: Was der Manager bei der Anlage NICHT gesetzt hat (Name,
    // Geschlecht, Anredeform), gibt der Endnutzer hier ein — es gehört ans BUCH
    // (Titel/Poster/Stammbaum lesen den Namen, das Geschlecht steuert die KI-
    // Formulierungen, die Detailseite zeigt beides an), nicht nur an den Beitrag.
    // Jeweils nur die Felder senden, die am Buch noch leer sind. Fehlschlag
    // unkritisch – das Interview läuft trotzdem.
    if (isSelf) {
      const patch = {}
      if (!memorial?.name && contribForm.name.trim()) patch.name = contribForm.name.trim()
      if (!memorial?.gender && contribForm.gender) patch.gender = contribForm.gender
      if (!memorial?.intake?.address && contribForm.address) patch.address = contribForm.address
      if (Object.keys(patch).length) {
        claimEnduserStart(code, patch)
          .then(() => setMemorial(m => m ? {
            ...m,
            ...(patch.name ? { name: patch.name } : {}),
            ...(patch.gender ? { gender: patch.gender } : {}),
            ...(patch.address ? { intake: { ...(m.intake || {}), address: patch.address } } : {}),
          } : m))
          .catch(e => console.warn('Stammdaten konnten nicht ans Buch geschrieben werden:', e.message))
      }
    }
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
          relationship: isSelf ? SELF_REL : contribForm.relationship,
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
  // Lebenswerk: Der Erzähler IST die Hauptperson — keine Beziehungsangabe, und
  // die Beziehung wird intern fest gesetzt (die Spalte ist NOT NULL).
  const isSelf = memorial?.product_category === 'lifework'
  const SELF_REL = 'Ich selbst'
  // Beim Lebenswerk gibt es nur EINE Person — den Endnutzer. Was der Manager bei
  // der Buchanlage schon erfasst hat (Name, Geschlecht, Anredeform), fragt der
  // Start nicht noch einmal ab; gefragt wird nur, was fehlt.
  const askName    = !isSelf || !memorial?.name
  const askGender  = !isSelf || !memorial?.gender
  const askAddress = !isSelf || !memorial?.intake?.address
  useEffect(() => {
    if (!isSelf || !memorial) return
    setContribForm(f => ({
      ...f,
      name:    f.name    || memorial.name || '',
      gender:  f.gender  || memorial.gender || '',
      address: memorial.intake?.address || f.address || 'Sie',
    }))
  }, [isSelf, memorial])
  // Ist der Interview-Teil (nach Start der Druckversion) endgültig abgeschlossen,
  // direkt in den Probedruck-Tab wechseln — der Interview-Tab zeigt dann nur einen Hinweis.
  useEffect(() => {
    if (memorial?.interview_closed && tab === 'interview') setTab('proof')
  }, [memorial]) // eslint-disable-line
  // Schreibrichtung: Hebräisch/Arabisch laufen von rechts nach links. Wir setzen
  // die Richtung auf das ganze Dokument (nicht nur einen Container), damit auch
  // Eingabefelder, Chat-Blasen und die Buchansicht korrekt spiegeln. Beim Verlassen
  // des Beitragenden-Flows wird wieder auf links-nach-rechts zurückgestellt.
  useEffect(() => {
    document.documentElement.dir = isRTL(L) ? 'rtl' : 'ltr'
    document.documentElement.lang = L
    window.dispatchEvent(new Event('lw-lang'))   // Footer liest die Sprache neu
    return () => { document.documentElement.dir = 'ltr'; document.documentElement.lang = 'de'; window.dispatchEvent(new Event('lw-lang')) }
  }, [L])

  // Ohne Firmenlogo trägt ein Lebenswerk das Lebenswerk-Logo statt des Standard-Logos.
  const bannerLogo = memorial?.owner_logo || (isSelf ? '/lebenswerk-logo.png' : null)
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
      {/* Endnutzer (Lebenswerk mit eigenem Login) braucht jederzeit einen Logout —
          fest oben rechts, über allen Ansichten (aber unter den Vollbild-Modals). */}
      {endUserToken && onLogout && (
        <button
          onClick={onLogout}
          className="secondary"
          title={t.logout || 'Log out'}
          style={{ position:'fixed', top:10, right:10, zIndex:150, fontSize:12, padding:'6px 12px', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,.12)' }}
        >⎋ {t.logout || 'Log out'}</button>
      )}
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
          <PartnerBanner logoUrl={memorial?.owner_logo} category={memorial?.product_category} />
          {/* Keine Überschrift: Die Sprachnamen stehen in ihrer eigenen Sprache da,
              das erklärt sich selbst. Die Liste scrollt in sich — so bleibt der
              Screen tragfähig, wenn später deutlich mehr Sprachen dazukommen. */}
          <div style={{ ...S.page, paddingTop:'2.5rem', textAlign:'center' }}>
            <div style={{ display:'grid', gap:10, maxWidth:320, margin:'0 auto', maxHeight:'60vh', overflowY:'auto', padding:'2px' }}>
              {langs.map(lc => {
                const meta = LANGUAGES.find(x => x.code === lc) || { code: lc, label: lc }
                return (
                  <button key={lc} onClick={() => {
                    setLang(lc)
                    // Lebenswerk: die Wahl festschreiben (Buch auf diese eine Sprache
                    // pinnen), damit die Sprachauswahl nicht bei jedem Start erneut
                    // erscheint – weder beim Endnutzer-Login noch über den Code-Link.
                    if (memorial?.product_category === 'lifework' && memorial?.id) {
                      pinMemorialLang(memorial.id, lc).catch(() => { /* nicht kritisch */ })
                    }
                  }} style={{ padding:'14px', fontSize:16 }}>{meta.label}</button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {!needLang && view === 'info' && (
        <>
          <PartnerBanner logoUrl={memorial?.owner_logo} category={memorial?.product_category} />
          <div style={{ ...S.page, paddingTop:'2rem' }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{ct.heading}</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
            {ct.introNoun} <strong>{memorial?.name}</strong>
          </p>
          {askName && (
          <div style={{ marginBottom:14 }}><Lbl>{isSelf ? t.yourNameSelf : t.yourName}</Lbl><input value={contribForm.name} onChange={e=>setContribForm({...contribForm,name:e.target.value})} placeholder={t.fullName} /></div>
          )}
          {askGender && (
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
          )}
          {!isSelf && (
          <div style={{ marginBottom:14 }}>
            <Lbl>{ct.relationshipLabel.replace('{name}', memorial?.name || '')}</Lbl>
            <input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder={ct.relationshipPlaceholder} />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6, lineHeight:1.5 }}>{ct.relationshipHint ? ct.relationshipHint.replace(/\{name\}/g, memorial?.name || 'die Person') : t.relationshipHint(memorial?.name, memorial?.gender)}</p>
          </div>
          )}
          {askAddress && (
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
          )}
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
                {/* Rechtstexte liegen nur auf Deutsch vor und sind rechtlich
                    maßgeblich — in jeder Sprache ein kurzer Hinweis darauf. */}
                {t.legalGermanNote ? <><br /><span style={{ fontSize:12, color:'#78716c' }}>{t.legalGermanNote}</span></> : null}
              </span>
            </label>
          </div>
          <button disabled={(askName && !contribForm.name)||(askGender && !contribForm.gender)||(!isSelf && !contribForm.relationship)||(askAddress && !contribForm.address)||!consentChecked} onClick={startInterview} style={{ width:'100%', padding:13, fontSize:15 }}>
            {ct.interviewButton}
          </button>
          </div>
        </>
      )}

      {!needLang && view === 'intro-video' && (
        <div style={{ position:'fixed', inset:0, background:'#000', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <video
            src={`${import.meta.env.VITE_PUBLIC_ASSET_BASE || ''}/memorial-videos/Intro_LD.mp4`}
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
        // Nach Start der Druckversion ODER Abschluss des Buchs ist das Interview
        // gesperrt — nur ein Hinweis.
        const vi = (memorial.interview_closed || memorial.book_finalized) ? (
          <div style={{ ...S.page, paddingTop:'2.5rem', textAlign:'center' }}>
            <div style={{ fontSize:34, marginBottom:8 }}>✅</div>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Interview abgeschlossen</h2>
            <p style={{ ...S.muted, maxWidth:360, margin:'0 auto' }}>Der Interview-Teil ist abgeschlossen. Deine vorläufige Druckversion findest du im Tab „{t.tabProof || 'Probedruck'}".</p>
          </div>
        ) : (
          <VoiceInterview
            memorial={memorial}
            contribForm={isSelf ? { ...contribForm, relationship: SELF_REL } : contribForm}
            lang={L}
            onSave={saveProgress}
            onPause={handlePause}
            saveErr={saveErr}
            initialMessages={initialMessages}
            showTx={showTx}
            setShowTx={setShowTx}
            companionOn={companionOn}
            setCompanionOn={setCompanionOn}
            active={tab === 'interview'}
          />
        )
        // Der Einstellungs-Tab gehört JEDEM Lebenswerk-Endnutzer — auch dem, der
        // ohne Login über den Code-Link kommt (E-Mail ist optional). Die Änderung
        // läuft dann code-basiert (updateOwnMemorial ohne Token; Server erlaubt das
        // nur beim Lebenswerk).
        const withSettings = isSelf
        // Nach Abschluss des Buchs kein Foto-Upload mehr.
        const withPhoto    = memorial.photo_upload_tab === true && !memorial.book_finalized
        const withProof    = isSelf && memorial.proof_enabled === true
        // Ohne Foto-Upload UND ohne Probedruck keine Tab-Leiste — Interview wie gehabt
        // (der Einstellungs-Tab erschien schon bisher nur zusammen mit der Tab-Leiste).
        if (!withPhoto && !withProof) return vi
        // paddingTop lässt Platz für den fixierten ☰-Button (oben rechts), damit er
        // keine Kopfzeile (z. B. „Vorschauen") überdeckt.
        return (
          <div style={{ paddingTop: 52, paddingBottom: 24 }}>
            <div style={{ display: tab === 'interview' ? 'block' : 'none' }}>{vi}</div>
            {withPhoto && (
              <div style={{ display: tab === 'photo' ? 'block' : 'none' }}>
                <div style={{ ...S.page, paddingTop:'2rem' }}>
                  <ContributorPhotoUpload code={code} contribId={contribId} t={t} />
                </div>
              </div>
            )}
            {withProof && (
              <div style={{ display: tab === 'proof' ? 'block' : 'none' }}>
                <ProofTab code={code} token={endUserToken} memorial={memorial} contribId={contribId} lang={L} t={t}
                  onMemorialPatch={p => setMemorial(m => m ? { ...m, ...p } : m)} />
              </div>
            )}
            {withSettings && (
              <div style={{ display: tab === 'settings' ? 'block' : 'none' }}>
                <EnduserSettings code={code} token={endUserToken} memorial={memorial} t={t} />
              </div>
            )}
            <ContribMenu tab={tab} setTab={setTab} t={t} withPhoto={withPhoto} withSettings={withSettings} withProof={withProof}
              showTx={showTx}
              onToggleTx={memorial?.show_transcript !== false ? () => setShowTx(v => !v) : null}
              onPause={tab === 'interview' ? handlePause : null} />
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
