// src/contributor.jsx — Beitragenden-Flow (Aufruf per ?code=…).
// Aus App.jsx ausgelagert: Waveform, VoiceInterview, TextInterview,
// ContributorPhotoUpload, ContributorFlow. Verbatim verschoben; nur ContributorFlow
// wird exportiert (die übrigen sind intern). ACHTUNG: enthält Audio/MediaRecorder —
// nach Änderungen ein echtes Interview live testen.

import { useState, useEffect, useRef, useContext } from 'react'
import { recordMetric, askLLM, speakText, stopSpeaking, addContribution, getContribution, getEnduserResume, uploadContributorImage, getMemorial, submitFeedback, updateOwnMemorial, claimEnduserStart, pinMemorialLang, getEnduserBook, acquireEditLock, heartbeatEditLock, releaseEditLock, consumeProof, saveEnduserBook, startPrintVersion, finalizeBook, enduserGenerateImage, redeemUnlockCode, saveAnamneseBogen, sendResumeLink } from './api.js'
import { generateProofBook } from './enduserProof.js'
import { generateAnamnesisBogen, reviseAnamnesisSection, translateToGerman, buildCanonical, isGermanReview } from './enduserAnamnesis.js'
import { proofT } from './proofI18n.js'
import { uiText, contributorL10n, langDirective, LANGUAGES, DEFAULT_LANGUAGE, isRTL, sortLangs } from './i18n.js'
import { installState, promptInstall, onInstallChange, setPwaProduct } from './pwa.js'
import { getCategory, interviewSystemFor, chapterVoices, defaultTextStyle, splitQuestionPos, posToMarker, isAnamnesis as isAnamnesisCategory } from './categories.js'
import { GENDERS, CONSENT_VERSION } from './constants.js'
import { ImageStylePicker, BookLayoutPicker, TextStylePicker } from './pickers.jsx'
import { DEFAULT_IMAGE_STYLE } from './imageStyles.js'
import { DEFAULT_BOOK_LAYOUT } from './bookLayouts.js'
import { S, PartnerBanner, Dots, Err, Lbl, FooterVisibilityCtx } from './ui.jsx'
import { useSupport } from './support.jsx'
import { fileToDownscaledDataURL, saveLocalSession, loadLocalSession, clearLocalSession, genContribId, unlockAudio, cutoffDays, cutoffDate, cutoffString } from './shared.js'

// aus der URL: fortzusetzende Interview-Session (nur im Beitragenden-Flow relevant)
const sessionFromURL = (new URLSearchParams(window.location.search).get('session') || '').trim()

// ── Mikrofon-Auto-Stopp (drei Modi, per Buch im Expertenmodus) ────────────────
// TIPP-MODUS (hands_free=false): NUR Höchstdauer (MIC_MAX_MS); bewusst KEIN Stille-
// Stopp — man darf beliebig lange nachdenken. Der Pegel dient nur dazu, eine
// Aufnahme OHNE jede Sprache gar nicht erst zur Erkennung zu schicken (STT-Kosten).
// FREISPRECH/AUTO (hands_free=true, mic_manual_stop=false, Standard): Nach erkannter
// Sprache stoppt die Aufnahme automatisch bei einer Sprechpause (MIC_PAUSE_MS) und
// schickt die Antwort; die nächste Frage öffnet das Mikro wieder von selbst. Ohne
// jede Sprache über längere Zeit (MIC_NOSPEECH_MS) hört die Runde auf.
// MISCHFORM/HYBRID (hands_free=true, mic_manual_stop=true): Das Mikro öffnet nach der
// Frage automatisch (und ist sichtbar), aber der Nutzer beendet SELBST per Tippen —
// KEIN Pausen-/No-Speech-Auto-Stopp, damit man beliebig lange überlegen kann. Nur
// die Höchstdauer (MIC_MAX_MS) greift als Sicherheitsnetz.
// Mindestmenge eigener Wörter, ab der aus einem Lebenswerk-Interview ein Buch
// entstehen kann. Darunter füllt die KI die Kapitel zwangsläufig mit Erfundenem.
// MUSS mit LIFEWORK_MIN_SELF_WORDS in src/App.jsx übereinstimmen (Manager-Seite).
const MIN_SELF_WORDS = 300

const MIC_SILENCE_THRESHOLD = 0.025   // RMS (0..1) unterhalb dessen es als „still" gilt
const MIC_MAX_MS            = 180000   // 3 min Höchstdauer je Aufnahme → Auto-Stopp
const MIC_PAUSE_MS          = 2500    // Freisprech: Sprechpause nach Sprache → Auto-Stopp+Senden
const MIC_NOSPEECH_MS       = 15000   // Freisprech: gar keine Sprache → Runde beenden

// ── Bildschirmsperre verhindern (Screen Wake Lock) ───────────────────────────
// Beim Erzählen fasst niemand das Handy an — nach 30 Sekunden ging der Bildschirm
// aus, die Aufnahme lief ins Leere und das Gespräch riss ab. Die Screen-Wake-Lock-
// API hält den Bildschirm an, solange die Seite SICHTBAR ist.
//
// Zwei Eigenheiten, die das Verhalten erklären:
//  • Der Lock wird vom Browser automatisch freigegeben, sobald der Tab in den
//    Hintergrund geht (App gewechselt, Bildschirm manuell gesperrt). Deshalb holen
//    wir ihn bei jedem `visibilitychange` neu — sonst ist er nach dem ersten
//    Weggucken für immer weg.
//  • Unterstützung: Android Chrome seit Version 84, iOS Safari **erst ab 16.4**.
//    Auf älteren iPhones gibt es keinen Weg, das aus einer Web-App zu verhindern
//    (die kursierenden Video-Tricks greifen in die Audio-Sitzung ein und würden
//    hier Aufnahme und Vorlesen stören). Dort schläft der Bildschirm weiter.
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock?.request) return
    let released = false
    let lock = null
    const acquire = async () => {
      if (released || document.visibilityState !== 'visible') return
      try {
        lock = await navigator.wakeLock.request('screen')
        // Der Browser kann den Lock jederzeit selbst aufheben (Akku, Systemdialog).
        lock.addEventListener?.('release', () => { lock = null })
      } catch { /* z. B. Akkusparmodus → nicht weiter tragisch */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible' && !lock) acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      try { lock?.release() } catch { /* egal */ }
      lock = null
    }
  }, [active])
}

// ── Mikrofon-Freigabe gleich beim Start anfragen ─────────────────────────────
// Eine Web-App kann die Systemeinstellungen NICHT selbst öffnen (das können nur
// native Apps) — sie kann aber den Berechtigungsdialog auslösen. Deshalb fragen
// wir das Mikrofon direkt beim Start des Interviews an, innerhalb der Nutzer-
// Geste, statt erst beim ersten Antippen des Mikrofons. So entscheidet der Nutzer
// einmal am Anfang, und ein „Blockiert" fällt sofort auf statt mitten im Gespräch.
// Der Stream wird sofort wieder geschlossen.
// iOS bleibt bewusst außen vor: Dort verstellt ein Mikrofon-Stream die Audio-
// Ausgabe (Hörmuschel statt Lautsprecher) und die erste vorgelesene Frage wäre
// kaum hörbar. Safari fragt ohnehin beim ersten Antippen zuverlässig.
function prewarmMic() {
  try {
    const ua = navigator.userAgent || ''
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return
    if (!navigator.mediaDevices?.getUserMedia) return
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(st => st.getTracks().forEach(tr => tr.stop()))
      .catch(() => { /* abgelehnt → der Hinweis samt Anleitung erscheint im Interview */ })
  } catch { /* egal */ }
}

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

// ── Fortschritts-Marker (nur im Fragenkatalog-Modus) ──────────────
// Die KI stellt jeder Frage ein [[K2.3]] / [[K2.3.1]] / [[ENDE]] voran (siehe
// catalogRules in categories.js). Der Marker wird SOFORT beim Empfang vom Text
// getrennt und als `pos` an der Nachricht abgelegt — damit landet er nie in der
// Anzeige, in der Sprachausgabe, im Transkript oder in der Buch-Synthese.
function toAssistantMsg(reply) {
  const { text, pos } = splitQuestionPos(reply)
  return pos ? { role: 'assistant', content: text, pos } : { role: 'assistant', content: text }
}

// Umgekehrter Weg: Beim Weiterreichen des Verlaufs an die KI bekommt jede Frage
// ihren Marker zurück, sonst verliert die KI ihre Position im Katalog.
function withPosMarkers(msgs) {
  return msgs.map(m => (m.pos ? { ...m, content: posToMarker(m.pos) + m.content } : m))
}

// Fortschritt aus Katalog + letzter bekannter Position ableiten. Liefert null,
// wenn es keinen Katalog gibt (freies Interview) oder noch/nicht mehr keine
// gültige Position vorliegt — dann wird die Leiste einfach nicht gezeigt.
function catalogProgress(memorial, messages) {
  const chapters = Array.isArray(memorial?.catalog?.chapters) ? memorial.catalog.chapters : []
  const qCount   = ch => (Array.isArray(ch?.questions) ? ch.questions.length : 0)
  const totalQ   = chapters.reduce((n, ch) => n + qCount(ch), 0)
  if (chapters.length === 0 || totalQ === 0) return null
  // Jüngste Nachricht mit Marker gewinnt; vergisst die KI ihn einmal, bleibt die
  // Anzeige auf der letzten bekannten Position stehen statt zu verschwinden.
  let pos = null
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].pos) { pos = messages[i].pos; break } }
  if (!pos) return null
  if (pos.done) return { done: true, pct: 100, totalQ }
  // Halluzinierte Nummern abfangen: außerhalb des Katalogs → keine Anzeige.
  const ci = pos.chapter - 1
  if (!(ci >= 0 && ci < chapters.length)) return null
  const inChapter = qCount(chapters[ci])
  if (!(pos.question >= 1 && pos.question <= inChapter)) return null
  let before = 0
  for (let i = 0; i < ci; i++) before += qCount(chapters[i])
  return {
    done: false,
    chapter: pos.chapter, chapterTotal: chapters.length, chapterTitle: (chapters[ci].title || '').trim(),
    // „3" bzw. „3.2" bei einer Nachfrage — die Gesamtzahl der Nachfragen ist
    // offen, daher steht hinter dem „von" immer die Zahl der Katalogfragen.
    questionLabel: pos.followup ? `${pos.question}.${pos.followup}` : String(pos.question),
    question: pos.question, questionTotal: inChapter,
    // Balken = Fortschritt über den GANZEN Katalog (abgeschlossene Fragen).
    pct: Math.round(((before + pos.question - 1) / totalQ) * 100),
    totalQ,
  }
}

// Die Vorlese-Stimme folgt dem GESCHLECHT der sprechenden Person (Interviewteilnehmer
// bzw. beim Buch-Vorlesen die Person des Buchs): männlich → männliche HD-Stimme, alle
// anderen → weiblich. Es gibt KEINE manuelle Stimmauswahl mehr. Für Deutsch nutzt der
// Server diese HD-Stimme direkt, für andere Sprachen die passende HD-Multilingual-
// Stimme gleichen Geschlechts und für eu/he/ar/de-CH die natürlichste Stimme pro
// Sprache (siehe api/speak.js pickVoiceAndLocale). Werte identisch zu
// api/_lib/ttsvoices.js (VOICE_MALE_HD / VOICE_FEMALE_HD).
const TTS_VOICE_MALE   = 'de-DE-Florian:DragonHDLatestNeural'
const TTS_VOICE_FEMALE = 'de-DE-Seraphina:DragonHDLatestNeural'
function interviewTtsVoice(memorial, contribForm) {
  const g = (contribForm?.gender || memorial?.gender || '').toString().trim().toLowerCase()
  return g === 'männlich' ? TTS_VOICE_MALE : TTS_VOICE_FEMALE
}

// Dezente Gamification-Sounds via Web-Audio (kurze, leise Töne — keine Asset-
// Dateien, CSP-sicher). Schlägt der Audio-Context fehl (Autoplay-Sperre o. Ä.),
// passiert einfach nichts.
let _gameAC = null
function gameAudioCtx() {
  if (typeof window === 'undefined') return null
  try {
    _gameAC = _gameAC || new (window.AudioContext || window.webkitAudioContext)()
    if (_gameAC.state === 'suspended') _gameAC.resume()
    return _gameAC
  } catch { return null }
}
function gameTone(ac, freq, startT, dur, peak = 0.05, type = 'sine') {
  const o = ac.createOscillator(), g = ac.createGain()
  o.type = type; o.frequency.value = freq
  o.connect(g); g.connect(ac.destination)
  g.gain.setValueAtTime(0.0001, startT)
  g.gain.exponentialRampToValueAtTime(peak, startT + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, startT + dur)
  o.start(startT); o.stop(startT + dur + 0.03)
}
function playGameSound(kind) {
  const ac = gameAudioCtx()
  if (!ac) return
  const t = ac.currentTime + 0.01
  try {
    if (kind === 'point') gameTone(ac, 680, t, 0.12, 0.035)                                   // kurzes, leises Blip pro Antwort
    else if (kind === 'badge') { gameTone(ac, 680, t, 0.12, 0.045); gameTone(ac, 1020, t + 0.09, 0.18, 0.045) } // Zwei-Ton „Abzeichen"
    else if (kind === 'done') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => gameTone(ac, f, t + i * 0.12, 0.3, 0.05)) // C-Dur-Arpeggio zum Abschluss
  } catch { /* egal */ }
}

// ── Gamification-HUD (Anamnese, „Gesundheits-Quest") ──────────────
// Spürbar motivierend, aber respektvoll: Punkte + Level, Quest-Checkpoints aus
// den Katalog-Kapiteln, aus den vorhandenen Daten (Antwortzahl + Fortschritt)
// abgeleitete Abzeichen und eine dezente Abschluss-Feier mit Konfetti. Reiner
// Anzeige-Layer — verändert weder Interview-Logik noch Bogen/Transkript.
function GamificationHud({ chapters, prog, round, lang }) {
  const en = String(lang || '').startsWith('en')
  const T = en
    ? { pts: 'points', lvl: 'Level', done: 'Anamnesis complete!', doneSub: 'Your intake is ready for the doctor.', badges: 'badges' }
    : { pts: 'Punkte', lvl: 'Level', done: 'Anamnese abgeschlossen!', doneSub: 'Ihr Bogen ist bereit für den Arzt.', badges: 'Abzeichen' }
  const total     = Array.isArray(chapters) ? chapters.length : 0
  const doneAll   = !!prog?.done
  const completed = doneAll ? total : (prog ? Math.max(0, (prog.chapter || 1) - 1) : 0)
  const points    = round * 10 + completed * 40
  const level     = Math.floor(points / 100) + 1

  const badges = []
  if (round >= 1)  badges.push({ e: '🌱', de: 'Erste Schritte',    en: 'First steps' })
  if (round >= 5)  badges.push({ e: '🗣️', de: 'Auskunftsfreudig',  en: 'Open book' })
  if (round >= 12) badges.push({ e: '💪', de: 'Ausdauernd',        en: 'Persistent' })
  if (completed >= 1) badges.push({ e: '🧭', de: 'Kartograf:in',    en: 'Cartographer' })
  if (total && completed >= Math.ceil(total / 2)) badges.push({ e: '⛰️', de: 'Halbzeit-Held:in', en: 'Halfway hero' })
  if (doneAll) badges.push({ e: '🏅', de: 'Anamnese-Meister:in',   en: 'Anamnesis master' })

  const [pulse, setPulse] = useState(false)
  useEffect(() => { if (round > 0) { setPulse(true); const id = setTimeout(() => setPulse(false), 380); return () => clearTimeout(id) } }, [round])

  // Dezente Sounds: Blip bei mehr Punkten, „Abzeichen"-Ton bei neuem Badge,
  // Arpeggio beim Abschluss. Nie beim ersten Render (nur bei echten Zuwächsen).
  const prevRound = useRef(round)
  const prevBadges = useRef(badges.length)
  const prevDone = useRef(doneAll)
  useEffect(() => {
    const grew = round > prevRound.current
    const newBadge = badges.length > prevBadges.current
    const justDone = doneAll && !prevDone.current
    if (justDone) playGameSound('done')
    else if (newBadge) playGameSound('badge')
    else if (grew) playGameSound('point')
    prevRound.current = round; prevBadges.current = badges.length; prevDone.current = doneAll
  }, [round, badges.length, doneAll]) // eslint-disable-line

  return (
    <div style={{ padding: '10px 1.5rem 12px', borderBottom: '1px solid #e7e5e4', background: 'linear-gradient(#fffdf7,#fafaf9)' }}>
      <style>{'@keyframes lwPop{0%{transform:scale(1)}40%{transform:scale(1.28)}100%{transform:scale(1)}}@keyframes lwFall{0%{transform:translateY(-12px) rotate(0);opacity:1}100%{transform:translateY(130px) rotate(360deg);opacity:0}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: total > 0 ? 8 : (badges.length ? 8 : 0) }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', animation: pulse ? 'lwPop .38s ease' : 'none' }}>⭐ {points}</span>
          <span style={{ fontSize: 12, color: '#a16207' }}>{T.pts}</span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1c1917', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 999, padding: '2px 10px' }}>{T.lvl} {level}</span>
      </div>
      {total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: badges.length ? 8 : 0 }}>
          {chapters.map((ch, i) => {
            const state = doneAll || i < completed ? 'done' : (i === completed ? 'active' : 'todo')
            return <div key={i} title={(ch?.title) || ''} style={{ flex: 1, height: 7, borderRadius: 4, background: state === 'done' ? '#16a34a' : state === 'active' ? '#f59e0b' : '#e7e5e4', transition: 'background .3s' }} />
          })}
        </div>
      )}
      {badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {badges.map((b, i) => (
            <span key={i} style={{ fontSize: 11, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 999, padding: '3px 8px', color: '#44403c' }}>{b.e} {en ? b.en : b.de}</span>
          ))}
        </div>
      )}
      {doneAll && (
        <div style={{ position: 'relative', marginTop: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', textAlign: 'center', overflow: 'hidden' }}>
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {['#f59e0b', '#16a34a', '#3b82f6', '#ec4899', '#a855f7', '#f43f5e'].map((c, i) => (
              <span key={i} style={{ position: 'absolute', left: `${8 + i * 16}%`, top: 0, width: 8, height: 8, background: c, borderRadius: 2, animation: `lwFall ${1 + (i % 3) * 0.4}s ease-in ${i * 0.12}s infinite` }} />
            ))}
          </div>
          <div style={{ fontSize: 28, marginBottom: 4 }}>🎉</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#166534' }}>{T.done}</div>
          <div style={{ fontSize: 13, color: '#15803d', marginTop: 2 }}>{T.doneSub}</div>
          <div style={{ fontSize: 12, color: '#166534', marginTop: 8 }}>⭐ {points} {T.pts} · {T.lvl} {level} · {badges.length} {T.badges}</div>
        </div>
      )}
    </div>
  )
}

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, lang = 'de', onSave, onPause, hidePause = false, saveErr, initialMessages = [], showTx: showTxProp, setShowTx: setShowTxProp, companionOn = false, setCompanionOn, active = true, onMemorialPatch, micMode = null, onSoundTest }) {
  const t = uiText(lang)
  // Drei Aufnahme-Modi (Expertenmodus, alle Produkte):
  //  • Tipp-Modus       : manual → Mikro manuell an/aus.
  //  • Freisprech (auto) : auto  → Mikro öffnet automatisch, Sprechpausen-Erkennung stoppt & sendet.
  //  • Mischform (hybrid): hybrid → Mikro öffnet automatisch, Nutzer beendet SELBST (kein Auto-Stopp).
  // Buch-Standard aus hands_free/mic_manual_stop; darf der Nutzer wechseln (mic_mode_switch),
  // überschreibt seine Wahl (`micMode`) den Standard. `handsFree` = „Mikro öffnet automatisch"
  // (auto ODER hybrid); `micManualStop` = hybrid. Im Co-Interview bleibt es manuell.
  const bookMode = memorial?.hands_free === false ? 'manual' : (memorial?.mic_manual_stop ? 'hybrid' : 'auto')
  const effMode = (micMode === 'manual' || micMode === 'auto' || micMode === 'hybrid') ? micMode : bookMode
  const handsFree = effMode !== 'manual' && !companionOn
  const micManualStop = handsFree && effMode === 'hybrid'
  // Aktuelle Modus-Werte zusätzlich in Refs spiegeln, damit asynchrone Stellen
  // (autoListen nach der Frage, der Silence-Timer der laufenden Aufnahme) IMMER den
  // neuesten Modus lesen — sonst greift ein Moduswechsel erst eine Frage später,
  // weil die Aufnahme der aktuellen Frage schon mit dem alten Wert geöffnet wurde.
  const handsFreeRef = useRef(handsFree); handsFreeRef.current = handsFree
  const micManualStopRef = useRef(micManualStop); micManualStopRef.current = micManualStop
  const openSupport = useSupport()
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
  const [micNote,    setMicNote]    = useState('')   // dezenter Hinweis nach Auto-Stopp (Stille/Höchstdauer)
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
  // Läuft gerade ein Aufnahme-START? (getUserMedia ist asynchron — siehe handleMic)
  const micStartingRef = useRef(false)
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

  // Freischaltcode: Der Endnutzer hebt sein Zeitlimit selbst auf, indem er einen
  // Code (XXXX-XXXX-XXXX) eingibt. Bei Erfolg setzt der Server das Limit am Buch
  // auf 0 (unbegrenzt); wir spiegeln das sofort ins UI (onMemorialPatch) und
  // entfernen die lokale Deadline, damit der Countdown verschwindet.
  const [unlockOpen, setUnlockOpen]     = useState(false)
  const [unlockCode, setUnlockCode]     = useState('')
  const [unlockBusy, setUnlockBusy]     = useState(false)
  const [unlockErr,  setUnlockErr]      = useState('')
  const [unlockDone, setUnlockDone]     = useState(false)
  // Tipphilfe: automatisch in Gruppen zu 4 Zeichen mit Bindestrich gliedern.
  function onUnlockInput(v) {
    const raw = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    setUnlockCode(raw.replace(/(.{4})(?=.)/g, '$1-'))
  }
  async function submitUnlock() {
    if (unlockBusy || !memorial?.id) return
    setUnlockBusy(true); setUnlockErr('')
    try {
      await redeemUnlockCode(memorial.id, unlockCode)
      // Lokale Countdown-Deadline entfernen (alle Timer-Werte dieses Buchs).
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i)
          if (k && k.startsWith(`lw_timer_${memorial.id}_`)) localStorage.removeItem(k)
        }
      } catch { /* privater Modus */ }
      onMemorialPatch?.({ interview_timer_seconds: 0 })
      setUnlockDone(true)
      setTimeout(() => { setUnlockOpen(false); setUnlockDone(false); setUnlockCode('') }, 2500)
    } catch (e) {
      setUnlockErr(e.message || (t.unlockInvalid || 'Dieser Freischaltcode ist ungültig oder wurde bereits eingelöst.'))
    } finally { setUnlockBusy(false) }
  }

  // Mikrofon-Berechtigungsstatus (soweit der Browser die Permissions-API kennt):
  // 'prompt' → freundlicher „Zulassen"-Hinweis vor dem ersten Tippen; 'denied' →
  // proaktive Hilfe (eine blockierte Berechtigung kann nur der Nutzer in den
  // Browser-Einstellungen wieder freigeben — das ist eine Browser-Sicherheitsregel).
  const [micPerm, setMicPerm] = useState('unknown') // granted | denied | prompt | unknown
  // Freisprech-Modus: das Mikro wurde nach einer längeren Sprechpause automatisch
  // gestoppt (kein Ton erkannt). Dann blenden wir DOCH wieder ein Mikrofon + Hinweis
  // ein, damit der Nutzer das Gespräch antippen und fortsetzen kann. Sobald wieder
  // aufgenommen wird, wird es automatisch ausgeblendet.
  const [handsFreeIdle, setHandsFreeIdle] = useState(false)
  useEffect(() => {
    if (!navigator.permissions?.query) return
    let live = true, permStatus = null
    // Anonymer Tageszähler: Ein blockiertes Mikrofon fällt hier auf, OHNE dass der
    // Nutzer je getippt hat — genau diese stillen Fälle sind die Dunkelziffer.
    const note = state => { if (state === 'denied') recordMetric('mic_blocked') }
    navigator.permissions.query({ name: 'microphone' }).then(s => {
      if (!live) return
      permStatus = s
      setMicPerm(s.state); note(s.state)
      s.onchange = () => { if (live) { setMicPerm(s.state); note(s.state) } }
    }).catch(() => {})
    return () => { live = false; if (permStatus) permStatus.onchange = null }
  }, [])
  // Bezugsgröße: begonnene Interviews. Ohne sie ist „x-mal blockiert" nicht deutbar.
  useEffect(() => { recordMetric('interview_start') }, [])

  // Nach einer neuen Frage möglichst OBEN bleiben (Mikrofon/Bedienung sichtbar),
  // statt ans Ende des Verlaufs zu scrollen.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [messages])
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
      // Auch eine LAUFENDE Aufnahme beenden. Sonst liefen im Ton-/Mikrofontest
      // (oder in einem anderen Tab) zwei Aufnahmen gleichzeitig — auf den meisten
      // Geräten belegt die erste das Mikrofon und der Test misst nichts.
      // Stoppen statt Verwerfen: das Gesagte wird normal transkribiert und
      // gesendet, es geht also nichts verloren.
      if (mediaRecRef.current?.state === 'recording') { try { mediaRecRef.current.stop() } catch { /* egal */ } }
    }
    wasActiveRef.current = active
  }, [active]) // eslint-disable-line

  // Begleiteter Modus ein-/ausgeschaltet:
  //  • AN  → die KI tritt zurück: FESTE, lokalisierte Bestätigung, kein LLM (sofort).
  //  • AUS → die KI übernimmt wieder: feste Bestätigung + sie stellt gleich die
  //          nächste Frage (normaler Interview-Aufruf, KEIN imperativer Moduswechsel-
  //          Text → kein Prompt-Shield-Problem). Scheitert der Aufruf, bleibt es bei
  //          der Bestätigung (Fallback), das Interview läuft mit der nächsten Antwort
  //          normal weiter.
  // Run-Zähler: nur der jüngste Umschalt-Lauf wendet an und managt aiLoading.
  useEffect(() => {
    if (companionInitRef.current) { companionInitRef.current = false; return }
    const myRun = ++companionRunRef.current
    if (companionOn) {
      const finalMsgs = [...messagesRef.current, { role: 'assistant', content: t.companionOnMsg }]
      applyMessages(finalMsgs); onSave?.(finalMsgs)
      setAiLoading(false)  // falls ein vorheriger AUS-Lauf aiLoading noch true ließ
      return
    }
    ;(async () => {
      setAiLoading(true)
      let content = t.companionOffMsg
      let pos = null
      try {
        const sys = interviewSystemFor(memorial)(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
        const reply = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...withPosMarkers(messagesRef.current)], { memorialCode: memorial?.id, kind: 'interview' })
        // Die feste Bestätigung und die KI-Frage werden zu EINER Nachricht — der
        // Marker gehört an die Nachricht, nicht mitten in den Text.
        const split = splitQuestionPos(String(reply || ''))
        if (split.text) { content = `${t.companionOffMsg} ${split.text}`; pos = split.pos }
      } catch { /* Fallback: nur die feste Bestätigung */ }
      if (companionRunRef.current !== myRun) return  // überholt → neuer Lauf managt State
      const finalMsgs = [...messagesRef.current, pos ? { role: 'assistant', content, pos } : { role: 'assistant', content }]
      applyMessages(finalMsgs); onSave?.(finalMsgs)
      setAiLoading(false)
    })()
  }, [companionOn]) // eslint-disable-line

  // Freisprech: nach der gesprochenen Frage das Mikrofon automatisch öffnen (kurze
  // Verzögerung, damit Wiedergabe/State sauber abgeschlossen sind). Startet nicht,
  // wenn bereits aufgenommen wird, die Testzeit abgelaufen oder der Tab inaktiv ist.
  function autoListen() {
    if (!handsFreeRef.current || expired || !active) return
    if (micStartingRef.current) return
    if (mediaRecRef.current && mediaRecRef.current.state === 'recording') return
    setTimeout(() => {
      if (!handsFreeRef.current || expired || !active) return
      // Auch hier prüfen: Zwischen Timer-Start und Ablauf kann der Nutzer selbst
      // getippt haben — sonst laufen zwei Aufnahmen auf demselben Ton.
      if (micStartingRef.current) return
      if (mediaRecRef.current && mediaRecRef.current.state === 'recording') return
      handleMic('self')
    }, 300)
  }

  function playText(text) {
    stopSpeaking()
    // Spricht die KI (auch beim Zurückübernehmen nach dem Begleitmodus), ist die
    // aktive Person wieder der Erzähler → Schallwelle/Untertitel zurück auf ROT.
    setRecSpeaker('self')
    setIsPlaying(true); setTtsLoading(true); setErr('')
    speakText(text, {
      memorialCode: memorial?.id,
      language: lang, // Stimme passend zur gewählten Sprache (de/pl/en)
      voice: interviewTtsVoice(memorial, contribForm), // Anamnese: Stimme folgt dem Geschlecht; sonst pro-Buch-Stimme
      // Sobald die Wiedergabe startet, ist die Ladephase vorbei: „Lädt …" weg,
      // Button zeigt „⏹ Stoppen" (App spricht gerade, kann abgebrochen werden).
      onPlay:  () => setTtsLoading(false),
      onEnd:   () => { setIsPlaying(false); setTtsLoading(false); setHasPlayed(true); autoListen() },
      onError: (msg, name) => {
        setIsPlaying(false); setTtsLoading(false)
        // Wiedergabe ohne Nutzer-Geste: iOS Safari meldet das als Autoplay-Sperre
        // (NotAllowedError), Android/installierte PWA teils als Media-Fehler auf dem
        // noch nicht freigeschalteten Element („Audiowiedergabe fehlgeschlagen").
        // In BEIDEN Fällen KEINEN Fehler zeigen — die Frage steht als Text da; der
        // nächste Tap (Mikrofon bzw. „🔊 Anhören") schaltet den Ton frei und spielt sie.
        if (name === 'NotAllowedError'
          || /not allowed|denied permission|user gesture/i.test(msg || '')
          || /Audiowiedergabe fehlgeschlagen/i.test(msg || '')) return
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
      const sys = interviewSystemFor(memorial)(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const q = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }], { memorialCode: memorial?.id, kind: 'interview' })
      applyMessages([toAssistantMsg(q)])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  async function handleMic(speaker = 'self') {
    if (micState === 'processing') return
    // WICHTIG — Wiedereintritts-Sperre. `micState` ist React-State und wird erst
    // NACH dem await gesetzt; getUserMedia dauert aber 100–300 ms. In diesem Fenster
    // kam eine zweite Anfrage (Tippen + automatisches Zuhören, oder zweimal
    // ausgelöstes Vorlese-Ende) durch alle Prüfungen und startete einen ZWEITEN
    // Recorder auf demselben Ton. Ergebnis: dieselbe Antwort zweimal transkribiert
    // und zweimal ins Interview geschrieben. Der Ref greift synchron, deshalb hier.
    if (micStartingRef.current) return
    // Testzeit abgelaufen: keine neue Aufnahme mehr starten.
    if (expired && micState !== 'recording') return

    if (micState === 'recording' || mediaRecRef.current?.state === 'recording') {
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

    setMicNote('')
    micStartingRef.current = true
    try {
      // WICHTIG (iOS): Für JEDE Aufnahme einen frischen Stream anfordern und danach
      // schließen (siehe onstop). Ein dauerhaft offener, wiederverwendeter Stream
      // spart zwar auf iOS die „Mikrofonzugriff gewährt"-Leiste, liefert dort aber
      // ab der 2. Aufnahme keinen Ton mehr (iOS Safari gibt einen Stream nicht an
      // einen zweiten MediaRecorder weiter) → funktionierendes Mikro hat Vorrang.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec    = new MediaRecorder(stream)
      mediaRecRef.current = rec
      chunksRef.current   = []
      let recStartedAt = 0

      // ── Auto-Stopp-Analyse: Pegel messen (RMS im Zeitbereich) ──────────────
      // sawSpeech = wurde je die Sprach-/Lautschwelle überschritten? (steuert, ob
      // nach reiner Stille überhaupt transkribiert wird → sonst KEINE Kosten).
      // stopReason merkt, WARUM automatisch gestoppt wurde (für den Hinweistext).
      let audioCtx = null, silenceTimer = null
      let sawSpeech = false
      let stopReason = null   // 'silence' | 'max' | null (= manuell gestoppt)
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (AC) {
          audioCtx = new AC()
          const srcNode  = audioCtx.createMediaStreamSource(stream)
          const analyser = audioCtx.createAnalyser()
          analyser.fftSize = 512
          srcNode.connect(analyser)
          const buf = new Uint8Array(analyser.fftSize)
          let lastLevelAt = Date.now()   // zuletzt „Ton über Schwelle" (für die Sprechpause)
          silenceTimer = setInterval(() => {
            analyser.getByteTimeDomainData(buf)
            let sumSq = 0
            for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sumSq += d * d }
            const rms = Math.sqrt(sumSq / buf.length)   // 0..1
            const now = Date.now()
            if (rms >= MIC_SILENCE_THRESHOLD) { sawSpeech = true; lastLevelAt = now }
            // Freisprech (auto): nach erkannter Sprache bei anhaltender Pause automatisch
            // stoppen und senden. In der Mischform (micManualStop) NICHT — dort beendet
            // der Nutzer selbst, damit er beliebig lange überlegen/pausieren kann.
            if (handsFreeRef.current && !micManualStopRef.current && sawSpeech && (now - lastLevelAt >= MIC_PAUSE_MS)) {
              stopReason = 'pause'
              if (rec.state === 'recording') rec.stop()
              return
            }
            // Freisprech (auto): gar keine Sprache über längere Zeit → Runde beenden.
            // In der Mischform ebenfalls NICHT (langes Überlegen ist gewollt).
            if (handsFreeRef.current && !micManualStopRef.current && !sawSpeech && recStartedAt && (now - recStartedAt >= MIC_NOSPEECH_MS)) {
              stopReason = 'nospeech'
              if (rec.state === 'recording') rec.stop()
              return
            }
            // Höchstdauer (immer): letzter Sicherheits-Stopp.
            if (recStartedAt && now - recStartedAt >= MIC_MAX_MS) {
              stopReason = 'max'
              if (rec.state === 'recording') rec.stop()
            }
          }, 250)
        }
      } catch { /* Pegel-Analyse ist optional; ohne sie bleibt nur manuelles Stoppen */ }

      const cleanupAnalysis = () => {
        if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null }
        if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
      }

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        cleanupAnalysis()
        // Tracks nach JEDER Aufnahme schließen (frischer Stream je Runde, iOS-sicher).
        stream.getTracks().forEach(t => t.stop())
        setMicStream(null)
        const audioSeconds = recStartedAt ? (Date.now() - recStartedAt) / 1000 : 0

        // Reine Stille (nie über die Schwelle) → NICHT transkribieren: spart die
        // STT-Kosten für eine Aufnahme ohne jede Sprache (z. B. vergessenes Mikro
        // im ruhigen Raum). Nur ein dezenter Hinweis.
        if (!sawSpeech) {
          setMicState('idle')
          setTranscript('')
          setMicNote(t.micNoSound || 'Kein Ton erkannt – das Mikrofon wurde automatisch gestoppt. Zum Sprechen erneut tippen.')
          // Freisprech: die automatische Zuhör-Schleife hält hier an. Blende dann
          // ein Mikrofon + Hinweis ein, damit der Nutzer wieder einsteigen kann.
          if (handsFree) setHandsFreeIdle(true)
          return
        }

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
          // Nach Erreichen der Höchstdauer: freundlicher Hinweis, dass man für einen
          // längeren Beitrag einfach weiter aufnehmen kann (die nächste Aufnahme wird
          // als weitere Antwort angehängt).
          if (stopReason === 'max') {
            setMicNote(t.micAutoStopped || 'Aufnahme automatisch beendet (Höchstdauer erreicht). Zum Weitererzählen erneut aufs Mikrofon tippen.')
          }
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
      recordMetric('mic_ok')   // anonymer Tageszähler (Gegenstück zu mic_blocked)
      setMicStream(stream)
      setMicState('recording')
      setHandsFreeIdle(false) // Dialog läuft wieder → Idle-Mikrofon/Hinweis ausblenden
      setTranscript('')
      setErr('')
    } catch (e) {
      // Fehler nach Fehlertyp konkret erklären — v. a. auf Android verwirrt ein
      // rohes „Permission denied", obwohl der Nutzer gerade freigegeben hat: Ursache
      // ist dann meist die OS-/App-Berechtigung (installierte App) oder eine gemerkte
      // Blockierung, nicht der eben bestätigte Seiten-Dialog.
      const en = String(lang || '').startsWith('en')
      const nm = e?.name || ''
      const msg = e?.message || ''
      const isPerm = nm === 'NotAllowedError' || nm === 'SecurityError' || /denied|not allowed|permission/i.test(msg)
      const noMic  = nm === 'NotFoundError' || nm === 'OverconstrainedError' || nm === 'DevicesNotFoundError'
      const inUse  = nm === 'NotReadableError' || nm === 'AbortError' || nm === 'TrackStartError'
      if (isPerm) {
        // Die eigentliche Schritt-für-Schritt-Anleitung steht geräteabhängig in
        // MicBlockedBox (wird direkt darunter eingeblendet, micPerm='denied').
        setMicPerm('denied')
        recordMetric('mic_blocked')
        setErr(en
          ? 'Microphone access is blocked — even if you just allowed it. Please follow the steps below.'
          : 'Der Mikrofon-Zugriff ist blockiert — auch wenn Sie eben zugestimmt haben. Bitte folgen Sie den Schritten unten.')
      } else if (noMic) {
        recordMetric('mic_missing')
        setErr(en ? 'No microphone found. Please check that a microphone is available and enabled.' : 'Kein Mikrofon gefunden. Bitte prüfen Sie, ob ein Mikrofon vorhanden und aktiviert ist.')
      } else if (inUse) {
        setErr(en ? 'The microphone is in use by another app or browser tab. Please close it and try again.' : 'Das Mikrofon wird von einer anderen App oder einem anderen Browser-Tab verwendet. Bitte schließen Sie diese und versuchen Sie es erneut.')
      } else {
        setErr(`${t.errMic}: ${msg}`)
      }
    } finally {
      micStartingRef.current = false
    }
  }

  async function sendAnswer(explicitText, speaker = 'self') {
    const text = (explicitText ?? transcript).trim(); if (!text) return
    // Zweites Netz gegen doppelte Antworten: Steht dieselbe Antwort bereits als
    // letzte Nachricht, wurde derselbe Ton zweimal verarbeitet (siehe die
    // Wiedereintritts-Sperre in handleMic). Wortgleiche Wiederholung direkt
    // hintereinander kommt beim Erzählen praktisch nicht vor; sie doppelt im Buch
    // stehen zu haben, wäre der deutlich größere Schaden.
    const prev = messagesRef.current[messagesRef.current.length - 1]
    if (prev && prev.role === 'user' && String(prev.content).trim() === text) return
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
      const sys   = interviewSystemFor(memorial)(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const reply = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...withPosMarkers(newMsgs)], { memorialCode: memorial?.id, kind: 'interview' })
      const finalMsgs = [...newMsgs, toAssistantMsg(reply)]
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

  // Das Transkript zeigt standardmäßig NUR den aktuellen Frage-/Antwort-Block —
  // also genau das, was noch änderbar ist. Alles davor ist reine Lektüre und liegt
  // hinter „Vorherige anzeigen".
  //
  // Der Schnitt liegt bewusst auf der FRAGE, zu der die letzte Antwort gehört, nicht
  // auf der Antwort selbst: Im Begleitmodus antwortet die KI nicht, dort hängen
  // mehrere Beiträge (Erzähler/Begleitung) an derselben Frage — die müssen zusammen
  // sichtbar bleiben. Im Normalfall ist der Block schlicht Frage + letzte Antwort.
  // Alles rechnet sich bei jedem Rendern neu: Wird die letzte Antwort gelöscht,
  // rückt die vorherige nach und der Block wandert automatisch mit.
  const [showEarlier, setShowEarlier] = useState(false)
  let blockStart = 0
  for (let i = lastUserIdx; i >= 0; i--) {
    if (history[i].role === 'assistant') { blockStart = i; break }
  }
  // Nur zählen, was das Transkript auch wirklich rendern würde (die jüngste Frage
  // steht bereits prominent in der Frage-Karte und wird hier übersprungen).
  const earlierCount = history.filter((_, i) => i < blockStart && i !== latestAssistantIdx).length

  // Fortschritt im Fragenkatalog — nur bei einem vordefinierten Katalog; im
  // freien Interview gibt es keine bekannte Gesamtzahl und damit keine Anzeige.
  const prog = catalogProgress(memorial, messages)

  const micBg     = micState === 'recording' ? '#fee2e2' : '#f5f5f4'
  const micBorder = micState === 'recording' ? '2px solid #ef4444' : '1px solid #d6d3d1'
  const micAnim   = micState === 'recording' ? 'lw-mic 1.5s ease-in-out infinite' : 'none'
  const micIcon   = micState === 'processing' ? '⏳' : '🎙'
  const micEn     = String(lang || '').startsWith('en')
  const micLabel  = micState === 'recording'
                    ? (micManualStop ? (micEn ? 'Listening — tap the microphone when you’re done' : 'Ich höre zu — tippen Sie auf das Mikrofon, wenn Sie fertig sind')
                       : handsFree ? (micEn ? 'Listening — pause briefly when you’re done' : 'Ich höre zu — machen Sie eine kurze Pause, wenn Sie fertig sind')
                       : t.micRecording)
                  : micState === 'processing' ? t.micProcessing
                  : (micManualStop ? (micEn ? 'Start speaking — tap the microphone when you’re done' : 'Sprechen Sie los — tippen Sie auf das Mikrofon, wenn Sie fertig sind')
                     : handsFree ? (micEn ? 'Just start speaking — I’ll notice when you’re done' : 'Sprechen Sie einfach los — ich merke, wenn Sie fertig sind')
                     : t.micIdle)

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <PartnerBanner logoUrl={memorial?.owner_logo} category={memorial?.product_category} />
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '8px 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          {/* Bei Selbst-Interviews (Lebenswerk, Anamnese) erzählt die Person über sich
              selbst — „Name · Ich selbst" wäre nur die Zeile darüber ein zweites Mal.
              Nur bei Beitragenden-Kategorien zeigt die untere Zeile Name + Beziehung —
              beim Lebenswerk also nur für GÄSTE (die erzählen über die Person). */}
          {(memorial?.product_category !== 'lifework' || memorial?.guest) && !isAnamnesisCategory(memorial?.product_category) && (
            <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
          )}
        </div>
        {!hidePause && <button onClick={pause} disabled={micState !== 'idle'} className="secondary" style={{ fontSize: 13, padding: '8px 16px' }}>{t.pauseEnd}</button>}
      </div>
      {/* Normale Fortschrittsleiste ausblenden, wenn die Gamification-HUD läuft
          (Anamnese + Gamification an) — dort zeigen die Quest-Checkpoints den
          Fortschritt, eine zweite Leiste wäre doppelt. */}
      {prog && !(isAnamnesisCategory(memorial?.product_category) && memorial?.gamification !== false) && (
        <div style={{ padding:'9px 1.5rem 11px', borderBottom:'1px solid #e7e5e4', background:'#fafaf9' }}>
          {prog.done ? (
            <div style={{ fontSize:12.5, fontWeight:600, color:'#15803d', textAlign:'center', marginBottom:7 }}>{t.progDone}</div>
          ) : (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, marginBottom:6 }}>
              <span style={{ fontSize:12, color:'#78716c', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {t.progChapter(prog.chapter, prog.chapterTotal)}{prog.chapterTitle ? ` · ${prog.chapterTitle}` : ''}
              </span>
              <span style={{ fontSize:12.5, fontWeight:600, color:'#44403c', flexShrink:0 }}>
                {t.progQuestion(prog.questionLabel, prog.questionTotal)}
              </span>
            </div>
          )}
          <div role="progressbar" aria-label={t.progAria} aria-valuenow={prog.pct} aria-valuemin={0} aria-valuemax={100}
            style={{ height:5, borderRadius:3, background:'#e7e5e4', overflow:'hidden' }}>
            <div style={{ width:`${prog.pct}%`, height:'100%', borderRadius:3, background: prog.done ? '#16a34a' : '#1c1917', transition:'width .35s ease' }} />
          </div>
        </div>
      )}
      {isAnamnesisCategory(memorial?.product_category) && memorial?.gamification !== false && (
        <GamificationHud chapters={memorial?.catalog?.chapters || []} prog={prog} round={round} lang={lang} />
      )}
      {timerActive && (
        <div style={{ padding:'8px 12px', borderBottom:'1px solid #e7e5e4',
          background: expired ? '#fef2f2' : (remaining <= 60 ? '#fff7ed' : '#eff6ff') }}>
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:14, fontWeight:700, color: expired ? '#b91c1c' : (remaining <= 60 ? '#c2410c' : '#1d4ed8') }}>
              {expired
                ? (t.timerExpiredShort || '⏳ Testzeit abgelaufen')
                : `⏳ ${t.timerRemaining || 'Verbleibende Testzeit'}: ${fmtMMSS(remaining)}`}
            </span>
            <button onClick={() => { setUnlockOpen(v => !v); setUnlockErr('') }} className="secondary"
              style={{ fontSize:12, padding:'5px 12px', background:'#fff' }}>
              🔓 {t.unlockButton || 'Freischaltcode eingeben'}
            </button>
          </div>
          {unlockOpen && (
            <div style={{ maxWidth:340, margin:'10px auto 2px', background:'#fff', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
              {unlockDone ? (
                <p style={{ fontSize:13, fontWeight:600, color:'#15803d', margin:0, lineHeight:1.5 }}>
                  {t.unlockSuccess || '✓ Zeitlimit aufgehoben – Sie können jetzt unbegrenzt weitererzählen.'}
                </p>
              ) : (
                <form onSubmit={e => { e.preventDefault(); submitUnlock() }}>
                  <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px', lineHeight:1.5, fontWeight:400 }}>
                    {t.unlockHint || 'Geben Sie Ihren Code ein, um das Zeitlimit dauerhaft aufzuheben.'}
                  </p>
                  <input value={unlockCode} onChange={e => onUnlockInput(e.target.value)} placeholder="XXXX-XXXX-XXXX"
                    autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                    style={{ width:'100%', textAlign:'center', letterSpacing:2, fontSize:16, fontWeight:700, textTransform:'uppercase', marginBottom:8 }} />
                  {unlockErr && <p style={{ fontSize:12, color:'#b91c1c', margin:'0 0 8px', lineHeight:1.4 }}>⚠ {unlockErr}</p>}
                  <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                    <button type="submit" disabled={unlockBusy || unlockCode.replace(/-/g,'').length < 12} style={{ fontSize:13, padding:'7px 16px' }}>
                      {unlockBusy ? '…' : (t.unlockSubmit || 'Einlösen')}
                    </button>
                    <button type="button" className="ghost" onClick={() => { setUnlockOpen(false); setUnlockErr('') }} style={{ fontSize:13, padding:'7px 12px', color:'#78716c' }}>
                      {t.unlockCancel || 'Abbrechen'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '0.75rem 1.25rem' }}>
        {expired && (
          <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'12px 14px', fontSize:14, color:'#991b1b', lineHeight:1.55, marginBottom:14 }}>
            {t.timerExpired || 'Die Testzeit ist abgelaufen. Sie können das Interview weiter ansehen, aber keine Antworten mehr aufnehmen. Für ein unbegrenztes Interview wenden Sie sich bitte an den Anbieter.'}
          </div>
        )}
        <Err msg={err} />
        {err && (
          <div style={{ marginTop:-4, marginBottom:12, textAlign:'center' }}>
            <button onClick={() => openSupport({ role: (memorial?.product_category === 'lifework' && !memorial?.guest) ? 'enduser' : 'contributor', code: memorial?.id, category: memorial?.product_category, view: 'interview', lang, lastError: err, micPerm, suggestedName: contribForm?.name })}
              className="secondary" style={{ fontSize:12.5, padding:'6px 14px' }}>
              ✉ {t.supportButton || 'Support kontaktieren'}
            </button>
          </div>
        )}
        {saveErr && <div style={{ ...S.err }}>⚠ {t.saveLabel}: {saveErr}</div>}
        {memorial.funeral_date && (() => {
          const d = cutoffDate(memorial.funeral_date, cutoffDays(memorial))
          return d ? (
            <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#78350f', marginBottom:14, lineHeight:1.55 }}>
              ℹ {t.cutoffNote(d.toLocaleDateString(t.locale))}
            </div>
          ) : null
        })()}
        {/* Verlauf/Transkript steht jetzt UNTEN (nach Mikrofon + Bedienung). */}
        {aiLoading && messages.length === 0 && (
          <div style={{ margin: '1.5rem 0', textAlign: 'center' }}>
            <Dots />
            <p style={{ ...S.muted, fontSize: 13, marginTop: 10 }}>
              {String(lang || '').startsWith('en')
                ? 'Preparing the first question — this can take a moment …'
                : 'Die erste Frage wird vorbereitet — das kann einen kurzen Moment dauern …'}
            </p>
          </div>
        )}
        {aiLoading && messages.length > 0 && <div style={{ margin: '.75rem 0', textAlign:'center' }}><Dots /></div>}
        {/* 4. MIKROFON — im Freisprech-Modus KEIN Button/Idle-Text: die App hört
            nach jeder Frage automatisch zu. Die Karte erscheint dann nur beim
            Aufnehmen/Verarbeiten, bei blockiertem Mikro oder im Begleit-Modus. */}
        {!aiLoading && latestQ && (!handsFree || micManualStop || micState !== 'idle' || handsFreeIdle || micPerm === 'denied' || memorial?.companion_mode === true) && (
          <div style={{ ...S.card, textAlign: 'center', padding: '1rem 1rem' }}>
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
            ) : (handsFree && !micManualStop && !handsFreeIdle) ? null : (
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
            {(!handsFree || micManualStop || micState !== 'idle') && (
              <div style={{ fontSize:13, fontWeight:500, color: micState==='recording' ? (recSpeaker === 'companion' ? '#2563eb' : '#dc2626') : '#78716c', marginBottom:4 }}>
                {micLabel}
              </div>
            )}
            {micState === 'idle' && micPerm === 'denied' && (
              <MicBlockedBox lang={lang} onTest={onSoundTest} />
            )}
            {/* Freisprech-Pause: Hinweis zum Weitersprechen (nur bis wieder aufgenommen wird). */}
            {handsFree && handsFreeIdle && micState === 'idle' && micPerm !== 'denied' && (
              <div style={{ maxWidth:340, margin:'2px auto 6px', fontSize:13, lineHeight:1.5, color:'#78716c' }}>
                {String(lang || '').startsWith('en')
                  ? 'Recording paused after a break. Tap the microphone to keep talking.'
                  : 'Aufnahme nach einer Pause gestoppt. Tippen Sie auf das Mikrofon, um weiterzusprechen.'}
              </div>
            )}
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
          </div>
        )}
        {/* 6. NOCHMAL VORLESEN (+ Fragetext, wenn Transkript an) */}
        {latestQ && (
          <div style={{ ...S.card, marginTop: 12, background: '#fafaf9', borderColor: '#d6d3d1', textAlign: showTx ? 'left' : 'center' }}>
            {showTx && <>
              <Lbl>{t.questionLabel}</Lbl>
              <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 0.75rem', color: '#292524' }}>{latestQ}</p>
            </>}
            <button onClick={handleSpeak} disabled={ttsLoading || aiLoading || expired} style={{ fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: expired ? 0.5 : 1 }}>
              {ttsLoading
                ? <><span style={{ width:14,height:14,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'lw-spin .8s linear infinite' }} /> {t.loadingShort}</>
                : isPlaying ? t.stop : hasPlayed ? t.readAgain : t.listen}
            </button>
          </div>
        )}
        {/* 5. NÄCHSTE FRAGE */}
        {memorial.catalog && micState === 'idle' && !expired && (
          <div style={{ textAlign:'center', marginTop:12 }}>
            <button onClick={() => sendAnswer(t.nextQuestionMsg)} disabled={aiLoading} className="secondary" style={{ fontSize:13, padding:'8px 16px' }}>
              {t.nextQuestion}
            </button>
          </div>
        )}
        {/* 7. Transkript: Umschalter + Verlauf (unten) */}
        {txAvailable && !memorial.photo_upload_tab && (
          <div style={{ marginTop:18, display:'flex', justifyContent:'center' }}>
            <div onClick={() => setShowTx(v => !v)} role="switch" aria-checked={showTx}
              style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:10, cursor:'pointer', fontSize:12, color:'#78716c', userSelect:'none' }}>
              <span style={{ position:'relative', width:38, height:22, borderRadius:11, background: showTx ? '#1c1917' : '#d6d3d1', transition:'background .2s', flexShrink:0, display:'inline-block' }}>
                <span style={{ position:'absolute', top:2, left: showTx ? 18 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 2px rgba(0,0,0,.25)' }} />
              </span>
              {t.txToggleLabel}
            </div>
          </div>
        )}
        {showTx && earlierCount > 0 && (
          <div style={{ textAlign:'center', margin:'10px 0' }}>
            <button className="ghost" onClick={() => setShowEarlier(v => !v)} style={{ fontSize:12.5, color:'#78716c', textDecoration:'underline' }}>
              {showEarlier ? (t.txHideEarlier || 'Vorherige ausblenden') : `${t.txShowEarlier || 'Vorherige anzeigen'} (${earlierCount})`}
            </button>
          </div>
        )}
        {showTx && history.map((m, i) => {
          if (i === latestAssistantIdx) return null
          if (!showEarlier && i < blockStart) return null
          const isCompanion = m.role === 'user' && m.speaker === 'companion'
          return (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 5 }}>
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
        <div ref={endRef} /><div style={{ height:'1.5rem' }} />
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
      const sys = interviewSystemFor(memorial)(memorial, contribForm.name, contribForm.relationship)
      const q = await askLLM(sys, [{ role:'user', content:'[Interview beginnt]' }])
      setMessages([toAssistantMsg(q)])
    } catch(e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim(); setInput('')
    const newMsgs = [...messages, { role:'user', content:text }]
    setMessages(newMsgs); setRound(r=>r+1); setLoading(true)
    try {
      const sys = interviewSystemFor(memorial)(memorial, contribForm.name, contribForm.relationship)
      const reply = await askLLM(sys, [{ role:'user', content:'[Interview beginnt]' }, ...withPosMarkers(newMsgs)])
      setMessages([...newMsgs, toAssistantMsg(reply)])
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
          {(memorial?.product_category !== 'lifework' || memorial?.guest) && (
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
    // Diese Prüfung war zu streng und hat echte Fotos abgewiesen: Android-Galerien
    // (Google Fotos, Samsung) liefern Dateien oft OHNE Typ oder als
    // application/octet-stream, teils auch mit Namen ohne Endung — und neuere
    // Formate wie AVIF standen gar nicht in der Liste. Angezeigt wurde dann nur
    // „Upload fehlgeschlagen", obwohl nie etwas hochgeladen wurde.
    // Jetzt umgekehrt: Nur ablehnen, was ERKENNBAR kein Bild ist (Video, PDF …).
    // Alles andere wird versucht; scheitert es wirklich, meldet das der Server.
    const type = String(file.type || '')
    if (/^video\//.test(type)) {
      // Häufigster Fehlgriff in der Galerie — deshalb eine eigene, klare Meldung
      // statt eines technischen Fehlers.
      setErr(t.uploadNoVideo || 'Videos können nicht hochgeladen werden – bitte ein Foto auswählen.')
      return
    }
    const clearlyNotImage = type && !/^image\//.test(type) && !/^application\/octet-stream$/.test(type)
    if (clearlyNotImage) {
      setErr(`${t.uploadError} (${type})`)
      return
    }
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
          {/* NUR `image/*`: Die zusätzlichen Endungen .heic/.heif führten auf Android
              dazu, dass die Galerie ALLE Dateien anbot — also auch Videos, die hier
              nichts verloren haben. iOS braucht sie nicht: Safari bietet bei image/*
              die Fotomediathek an und wandelt HEIC beim Auswählen selbst in JPEG um. */}
          <input type="file" accept="image/*" onChange={onPick} style={{ display:'none' }} />
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
// Install-Eintrag im ☰-Menü (PWA). Best practice: eigener Button statt der Browser-
// Infobar. Android/Chrome → nativer Prompt (promptInstall); iOS/Safari → kurze
// Anleitung (kein programmatischer Prompt möglich). Bereits installiert → nichts.
function InstallMenuItem({ t, row, sep, onClose }) {
  const [, force] = useState(0)
  const [showIos, setShowIos] = useState(false)
  useEffect(() => onInstallChange(() => force(n => n + 1)), [])
  const state = installState()
  if (state === 'installed' || state === 'none') return null
  const click = async () => {
    if (state === 'prompt') { await promptInstall(); onClose?.() }
    else { setShowIos(true) }
  }
  return (
    <>
      <div style={sep} />
      <button onClick={click} style={{ ...row, fontWeight:600 }}>
        <span style={{ fontSize:19 }}>📲</span><span>{t.installApp || 'App installieren'}</span>
      </button>
      {showIos && (
        <div onClick={() => setShowIos(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:70, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px 16px 0 0', padding:'20px 20px 28px', maxWidth:420, width:'100%', boxShadow:'0 -2px 16px rgba(0,0,0,.2)' }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>{t.installIosTitle || 'Zum Home-Bildschirm hinzufügen'}</div>
            <p style={{ fontSize:14, color:'#57534e', lineHeight:1.6, margin:'0 0 10px' }}>
              {t.installIosBody || 'So legen Sie diese App auf Ihren Startbildschirm (nur in Safari möglich – nicht in Chrome oder einem In-App-Browser):'}
            </p>
            <ol style={{ fontSize:14, color:'#57534e', lineHeight:1.6, margin:0, paddingLeft:20 }}>
              <li>{t.installIosStep1 || 'Unten auf das Teilen-Symbol tippen (Quadrat mit Pfeil nach oben ⬆️).'}</li>
              <li>{t.installIosStep2 || 'In der Liste nach unten scrollen.'}</li>
              <li>{t.installIosStep3 || '„Zum Home-Bildschirm" wählen und mit „Hinzufügen" bestätigen.'}</li>
            </ol>
            <button onClick={() => setShowIos(false)} style={{ marginTop:16, width:'100%' }}>{t.installIosClose || 'Verstanden'}</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Mikrofon-Freigabe: gerätespezifische Anleitung ───────────────────────────
// WICHTIG: Die App läuft sehr oft als installierte PWA im Vollbild — dort gibt es
// GAR KEINE Adressleiste und damit auch kein Schloss-Symbol. Eine pauschale
// „Tippen Sie in der Adressleiste auf das Schloss" -Anleitung führt genau dann in
// die Irre (und wird zusätzlich mit dem Schloss-Symbol im Menü verwechselt).
// Deshalb ermitteln wir Plattform + Anzeigemodus und zeigen nur den Weg, den es
// auf diesem Gerät wirklich gibt.
function micHelp(lang) {
  const en = String(lang || '').startsWith('en')
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  let standalone = false
  try {
    standalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || window.matchMedia?.('(display-mode: fullscreen)')?.matches === true
      || window.navigator.standalone === true
  } catch { /* egal */ }

  const title = en ? 'Allow the microphone' : 'Mikrofon freigeben'
  // Installierte App (Vollbild, keine Adressleiste) — der einzige Weg führt über
  // die Systemeinstellungen des Geräts.
  if (standalone && isAndroid) {
    return { title, steps: en ? [
      'Leave the app (home button) and open Android Settings.',
      'Go to "Apps" and pick this app from the list (same name and icon as on your home screen).',
      'Tap "Permissions" → "Microphone" → "Allow".',
      'Open the app again and tap the microphone.',
    ] : [
      'App verlassen (Home-Taste) und die Android-„Einstellungen" öffnen.',
      'Auf „Apps" tippen und diese App in der Liste auswählen (gleicher Name und gleiches Symbol wie auf dem Startbildschirm).',
      'Auf „Berechtigungen" → „Mikrofon" → „Zulassen" tippen.',
      'App wieder öffnen und das Mikrofon antippen.',
    ], hint: en
      ? 'Shortcut: press and hold the app icon on the home screen → "App info" → "Permissions" → "Microphone".'
      : 'Abkürzung: Auf dem Startbildschirm lange auf das App-Symbol drücken → „App-Info" → „Berechtigungen" → „Mikrofon".' }
  }
  if (standalone && isIOS) {
    return { title, steps: en ? [
      'Leave the app and open the iPhone "Settings".',
      'Scroll down to this app and tap it.',
      'Switch "Microphone" on.',
      'Open the app again and tap the microphone.',
    ] : [
      'App verlassen und die iPhone-„Einstellungen" öffnen.',
      'Nach unten zu dieser App scrollen und sie antippen.',
      '„Mikrofon" einschalten.',
      'App wieder öffnen und das Mikrofon antippen.',
    ], hint: '' }
  }
  if (isIOS) {
    return { title, steps: en ? [
      'In Safari, tap the "aA" icon on the left of the address bar.',
      'Choose "Website Settings" → set "Microphone" to "Allow".',
      'Reload the page.',
    ] : [
      'In Safari links in der Adressleiste auf „aA" tippen.',
      '„Website-Einstellungen" wählen → „Mikrofon" auf „Erlauben" stellen.',
      'Die Seite neu laden.',
    ], hint: en
      ? 'Also check iPhone Settings → Safari → Microphone.'
      : 'Zusätzlich prüfen: iPhone-Einstellungen → Safari → Mikrofon.' }
  }
  if (isAndroid) {
    return { title, steps: en ? [
      'In Chrome, tap the icon to the left of the web address (sliders or lock).',
      'Tap "Permissions" → "Microphone" → "Allow".',
      'Reload the page.',
    ] : [
      'In Chrome auf das Symbol links neben der Web-Adresse tippen (Schieberegler oder Schloss).',
      'Auf „Berechtigungen" → „Mikrofon" → „Zulassen" tippen.',
      'Die Seite neu laden.',
    ], hint: en
      ? 'No address bar visible? Then the app is installed on the home screen: Android Settings → Apps → this app → Permissions → Microphone.'
      : 'Keine Adressleiste zu sehen? Dann läuft die App vom Startbildschirm: Android-Einstellungen → Apps → diese App → Berechtigungen → Mikrofon.' }
  }
  return { title, steps: en ? [
    'Click the icon to the left of the web address in the browser bar.',
    'Set "Microphone" to "Allow".',
    'Reload the page.',
  ] : [
    'Im Browser auf das Symbol links neben der Web-Adresse klicken.',
    '„Mikrofon" auf „Zulassen" stellen.',
    'Die Seite neu laden.',
  ], hint: en
    ? 'Also check that the system allows the browser to use the microphone.'
    : 'Zusätzlich prüfen, ob das System dem Browser das Mikrofon erlaubt.' }
}

// Kompakter Hinweiskasten „Mikrofon blockiert" mit der passenden Anleitung.
function MicBlockedBox({ lang, onTest }) {
  const en = String(lang || '').startsWith('en')
  const h = micHelp(lang)
  return (
    <div style={{ maxWidth:360, margin:'2px auto 6px', fontSize:12.5, lineHeight:1.5, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'9px 12px', textAlign:'left' }}>
      <div style={{ fontWeight:700, marginBottom:5 }}>🎙 {en ? 'The microphone is blocked' : 'Das Mikrofon ist blockiert'}</div>
      <ol style={{ margin:'0 0 0 16px', padding:0 }}>{h.steps.map((s, i) => <li key={i} style={{ marginBottom:2 }}>{s}</li>)}</ol>
      {h.hint && <div style={{ marginTop:6, color:'#a16207' }}>{h.hint}</div>}
      <div style={{ marginTop:8, display:'flex', gap:8, flexWrap:'wrap' }}>
        <button onClick={() => window.location.reload()} style={{ fontSize:12, padding:'6px 12px' }}>{en ? 'Reload' : 'Neu laden'}</button>
        {onTest && <button onClick={onTest} className="secondary" style={{ fontSize:12, padding:'6px 12px' }}>{en ? 'Sound & microphone test' : 'Ton- und Mikrofontest'}</button>}
      </div>
    </div>
  )
}

// ── Ton- und Mikrofontest ────────────────────────────────────────────────────
// Zwei Schritte, ohne KI-Kosten (reines Web Audio + lokale Aufnahme):
//  1. Testton (Sinus, kurz) → prüft Lautstärke/Stummschalter/Kopfhörer.
//  2. Kurze Aufnahme mit Live-Pegel → sofortige Wiedergabe. Wir merken uns den
//     Spitzenpegel: bleibt er praktisch bei null, war das Mikrofon stumm.
// Die Aufnahme verlässt das Gerät NICHT (keine Transkription, kein Upload).
function SoundMicTest({ lang, onClose }) {
  const en = String(lang || '').startsWith('en')
  const [tonePlaying, setTonePlaying] = useState(false)
  const [toneDone, setToneDone]       = useState(false)
  const [recState, setRecState]       = useState('idle') // idle | rec | done | error
  const [stream, setStream]           = useState(null)
  const [peak, setPeak]               = useState(0)
  const [url, setUrl]                 = useState('')
  const [err, setErr]                 = useState('')
  const recRef   = useRef(null)
  const stopRef  = useRef(null)
  const urlRef   = useRef('')

  useEffect(() => () => {
    try { stopRef.current?.() } catch {}
    try { recRef.current?.state === 'recording' && recRef.current.stop() } catch {}
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  // 1) Testton: 880 Hz, 1,2 s, sanft ein-/ausgeblendet (kein Knacken).
  async function playTone() {
    setTonePlaying(true)
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const ctx = new AC()
      await ctx.resume().catch(() => {})
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = 880
      const t0 = ctx.currentTime
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.06)
      gain.gain.setValueAtTime(0.25, t0 + 1.0)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(t0); osc.stop(t0 + 1.25)
      osc.onended = () => { ctx.close().catch(() => {}); setTonePlaying(false); setToneDone(true) }
    } catch (e) {
      setTonePlaying(false); setToneDone(true)
      setErr(en ? 'The test tone could not be played on this device.' : 'Der Testton konnte auf diesem Gerät nicht abgespielt werden.')
    }
  }

  // 2) Aufnahme (max. 6 s) mit Live-Pegelmessung; danach direkte Wiedergabe.
  async function startRec() {
    setErr(''); setPeak(0)
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; setUrl('') }
    let st
    try {
      st = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setRecState('error')
      setErr(en ? 'No access to the microphone.' : 'Kein Zugriff auf das Mikrofon.')
      return
    }
    setStream(st); setRecState('rec')
    // Spitzenpegel messen (RMS aus dem Zeitsignal).
    let raf = 0, ctx = null, maxLvl = 0
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      ctx = new AC()
      const src = ctx.createMediaStreamSource(st)
      const an  = ctx.createAnalyser(); an.fftSize = 1024
      src.connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = () => {
        raf = requestAnimationFrame(tick)
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / buf.length)
        if (rms > maxLvl) { maxLvl = rms; setPeak(rms) }
      }
      tick()
    } catch { /* Pegel optional */ }

    const chunks = []
    let rec
    try { rec = new MediaRecorder(st) } catch { rec = new MediaRecorder(st, { mimeType: 'audio/webm' }) }
    recRef.current = rec
    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
    rec.onstop = () => {
      cancelAnimationFrame(raf); ctx?.close().catch(() => {})
      st.getTracks().forEach(tr => tr.stop())
      setStream(null); setRecState('done')
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        const u = URL.createObjectURL(blob)
        urlRef.current = u; setUrl(u)
      } catch { /* Wiedergabe entfällt */ }
    }
    const stopAll = () => { try { rec.state === 'recording' && rec.stop() } catch {} }
    stopRef.current = stopAll
    rec.start()
    setTimeout(stopAll, 6000)
  }

  const quiet = recState === 'done' && peak < 0.02
  const box = { border:'1px solid #e7e5e4', borderRadius:12, padding:'12px 14px', marginBottom:10 }
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:70, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px 16px 0 0', padding:'18px 18px 26px', maxWidth:460, width:'100%', boxShadow:'0 -2px 16px rgba(0,0,0,.2)', maxHeight:'88vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>{en ? 'Sound & microphone test' : 'Ton- und Mikrofontest'}</div>
          <button onClick={onClose} aria-label="×" style={{ background:'none', border:'none', fontSize:24, cursor:'pointer', color:'#78716c', lineHeight:1 }}>×</button>
        </div>

        {/* Schritt 1: Hören */}
        <div style={box}>
          <div style={{ fontSize:14.5, fontWeight:600, marginBottom:4 }}>{en ? '1. Can you hear us?' : '1. Hören Sie uns?'}</div>
          <p style={{ fontSize:13, color:'#78716c', lineHeight:1.5, margin:'0 0 10px' }}>
            {en ? 'Play a short test tone. If you hear nothing: turn the volume up, and on an iPhone check the silent switch on the side.'
                : 'Kurzen Testton abspielen. Wenn Sie nichts hören: Lautstärke hochdrehen — beim iPhone zusätzlich den Stummschalter an der Seite prüfen.'}
          </p>
          <button onClick={playTone} disabled={tonePlaying} style={{ fontSize:13, padding:'9px 16px' }}>
            {tonePlaying ? (en ? 'Playing …' : 'Spielt …') : (en ? '🔊 Play test tone' : '🔊 Testton abspielen')}
          </button>
          {toneDone && !tonePlaying && (
            <div style={{ fontSize:12.5, color:'#78716c', marginTop:8 }}>
              {en ? 'Heard nothing? Then the volume is off, the device is muted, or headphones are connected somewhere else.'
                  : 'Nichts gehört? Dann ist die Lautstärke aus, das Gerät stummgeschaltet oder ein Kopfhörer anderweitig verbunden.'}
            </div>
          )}
        </div>

        {/* Schritt 2: Sprechen */}
        <div style={box}>
          <div style={{ fontSize:14.5, fontWeight:600, marginBottom:4 }}>{en ? '2. Do we hear you?' : '2. Hören wir Sie?'}</div>
          <p style={{ fontSize:13, color:'#78716c', lineHeight:1.5, margin:'0 0 10px' }}>
            {en ? 'Record a few seconds and play them back. The recording stays on your device — nothing is sent or saved.'
                : 'Ein paar Sekunden aufnehmen und gleich anhören. Die Aufnahme bleibt auf Ihrem Gerät — nichts wird gesendet oder gespeichert.'}
          </p>
          {recState === 'rec' ? (
            <>
              {stream && <div style={{ maxWidth:320, margin:'0 auto 8px' }}><Waveform stream={stream} /></div>}
              <div style={{ textAlign:'center' }}>
                <button onClick={() => stopRef.current?.()} style={{ fontSize:13, padding:'9px 16px' }}>{en ? '⏹ Stop' : '⏹ Stoppen'}</button>
                <div style={{ fontSize:12.5, color:'#dc2626', marginTop:6 }}>
                  {en ? 'Please say a sentence out loud …' : 'Bitte sprechen Sie einen Satz laut aus …'}
                </div>
              </div>
            </>
          ) : (
            <button onClick={startRec} style={{ fontSize:13, padding:'9px 16px' }}>
              {recState === 'done' ? (en ? '🎙 Record again' : '🎙 Nochmal aufnehmen') : (en ? '🎙 Start recording' : '🎙 Aufnahme starten')}
            </button>
          )}
          {recState === 'done' && (
            <div style={{ marginTop:10 }}>
              {quiet ? (
                <div style={{ fontSize:12.5, lineHeight:1.5, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 11px' }}>
                  {en ? 'We did not detect any sound. The microphone is muted, blocked or used by another app.'
                      : 'Es wurde kein Ton erkannt. Das Mikrofon ist stumm, blockiert oder von einer anderen App belegt.'}
                </div>
              ) : (
                <div style={{ fontSize:12.5, lineHeight:1.5, color:'#166534', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'8px 11px' }}>
                  {en ? 'Sound detected — the microphone works. Listen to the recording to check the volume.'
                      : 'Ton erkannt — das Mikrofon funktioniert. Zur Kontrolle die Aufnahme anhören.'}
                </div>
              )}
              {url && <audio src={url} controls style={{ width:'100%', marginTop:8 }} />}
            </div>
          )}
          {recState === 'error' && <div style={{ fontSize:12.5, color:'#b91c1c', marginTop:8 }}>{err}</div>}
        </div>

        {/* Anleitung zur Freigabe — immer erreichbar, nicht nur im Fehlerfall. */}
        {(recState === 'error' || quiet) && <MicBlockedBox lang={lang} />}
        {err && recState !== 'error' && <div style={{ fontSize:12.5, color:'#b91c1c' }}>{err}</div>}
        <button onClick={onClose} className="secondary" style={{ width:'100%', marginTop:6, fontSize:13, padding:'10px 16px' }}>
          {en ? 'Close' : 'Schließen'}
        </button>
      </div>
    </div>
  )
}

// Auswahl-Dialog für den Aufnahme-Modus (Beitragender wechselt selbst, wenn der
// Manager es erlaubt hat). Zeigt die drei Modi; aktueller ist markiert. Die Wahl
// überschreibt den Buch-Standard und wird je Code gemerkt (localStorage).
function MicModeChooser({ lang, memorial, micMode, onPick, onClose }) {
  const en = String(lang || '').startsWith('en')
  const bookMode = memorial?.hands_free === false ? 'manual' : (memorial?.mic_manual_stop ? 'hybrid' : 'auto')
  const cur = (micMode === 'manual' || micMode === 'auto' || micMode === 'hybrid') ? micMode : bookMode
  const opts = [
    { key:'auto',   title: en ? 'Conduct conversation automatically' : 'Gespräch selbständig führen',
      sub: en ? 'The microphone opens after each question; a short pause sends your answer. No tapping.' : 'Das Mikrofon öffnet nach jeder Frage; eine kurze Sprechpause sendet Ihre Antwort. Kein Antippen.' },
    { key:'hybrid', title: en ? 'Opens automatically, you stop it' : 'Automatisch öffnen, selbst beenden',
      sub: en ? 'The microphone opens after each question, but you tap to finish — take as long as you like.' : 'Das Mikrofon öffnet nach jeder Frage, aber Sie tippen zum Beenden — überlegen Sie so lange Sie möchten.' },
    { key:'manual', title: en ? 'Tap microphone on/off' : 'Mikrofon an-/ausschalten',
      sub: en ? 'You tap the microphone to start and stop speaking.' : 'Sie tippen das Mikrofon zum Sprechen an und wieder aus.' },
  ]
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:70, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:'16px 16px 0 0', padding:'18px 18px 26px', maxWidth:460, width:'100%', boxShadow:'0 -2px 16px rgba(0,0,0,.2)', maxHeight:'80vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>{en ? 'Microphone mode' : 'Mikrofon-Modus'}</div>
          <button onClick={onClose} aria-label="×" style={{ background:'none', border:'none', fontSize:24, cursor:'pointer', color:'#78716c', lineHeight:1 }}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {opts.map(o => {
            const on = cur === o.key
            return (
              <button key={o.key} onClick={() => onPick(o.key)} style={{ textAlign:'left', display:'flex', alignItems:'flex-start', gap:10, padding:'12px 14px', borderRadius:12, cursor:'pointer', background: on ? '#f0fdf4' : '#fff', border:`${on ? 2 : 1}px solid ${on ? '#16a34a' : '#e7e5e4'}` }}>
                <span style={{ fontSize:18, marginTop:1 }}>{on ? '✅' : '🎙️'}</span>
                <span style={{ minWidth:0 }}>
                  <span style={{ display:'block', fontSize:14.5, fontWeight:600, color:'#1c1917' }}>{o.title}</span>
                  <span style={{ display:'block', fontSize:12.5, color:'#78716c', marginTop:2, lineHeight:1.45 }}>{o.sub}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ContribMenu({ tab, setTab, t, lang, withPhoto, withSettings, withProof, withBogen, bogenLabel, photoLabel, photoIcon, showTx, onToggleTx, onPause, onSupport, onSwitchInterview, onMicMode, micModeLabel, onSoundTest }) {
  const [open, setOpen] = useState(false)
  const navItems = [
    { id:'interview', icon:'🎙️', label:t.tabInterview },
    ...(withPhoto    ? [{ id:'photo',    icon: photoIcon || '📷', label: photoLabel || t.tabPhoto }] : []),
    ...(withProof    ? [{ id:'proof',    icon:'📖', label:t.tabProof || 'Probedruck' }] : []),
    ...(withBogen    ? [{ id:'bogen',    icon:'🩺', label:bogenLabel || 'Anamnesebogen' }] : []),
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
            {onMicMode && (<>
              <div style={sep} />
              <button onClick={() => { setOpen(false); onMicMode() }} style={row}>
                <span style={{ fontSize:19 }}>🎙️</span><span>{micModeLabel || 'Mikrofon-Modus'}</span>
              </button>
            </>)}
            {/* Selbsttest: Testton hören + kurz aufnehmen und anhören. Klärt die zwei
                häufigsten Störungen (Lautstärke aus / Mikrofon nicht freigegeben),
                ohne dass jemand am Telefon mitraten muss. */}
            <button onClick={() => { setOpen(false); onSoundTest?.() }} style={row}>
              <span style={{ fontSize:19 }}>🔊</span>
              <span>{String(lang || '').startsWith('en') ? 'Sound & microphone test' : 'Ton- und Mikrofontest'}</span>
            </button>
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
            {onSupport && (<>
              <div style={sep} />
              <button onClick={() => { setOpen(false); onSupport() }} style={{ ...row, color:'#78716c' }}>
                <span style={{ fontSize:19 }}>✉️</span><span>{t.supportButton || 'Support kontaktieren'}</span>
              </button>
            </>)}
            {/* Nur wenn dieses Interview aus dem gemerkten Code geöffnet wurde: Ausweg,
                um den gemerkten Code zu verwerfen (z. B. auf einem geteilten Gerät). */}
            {onSwitchInterview && (<>
              <div style={sep} />
              <button onClick={() => { setOpen(false); onSwitchInterview() }} style={{ ...row, color:'#78716c' }}>
                <span style={{ fontSize:19 }}>🔄</span><span>{t.switchInterview || 'Anderes Interview / das bin nicht ich'}</span>
              </button>
            </>)}
            {/* App installieren (PWA) — nur wenn installierbar/iOS und noch nicht installiert. */}
            <InstallMenuItem t={t} row={row} sep={sep} onClose={() => setOpen(false)} />
            {/* Rechtslinks: hierher verlagert aus dem Seiten-Footer (der im Interview
                ausgeblendet ist). Öffnen die statischen Rechtsseiten in einem neuen Tab. */}
            <div style={sep} />
            {/* Bewusst KEIN Schloss-Symbol: es wird sonst mit dem Schloss/Berechtigungs-
                Symbol des Browsers (Mikrofon-Freigabe) verwechselt. */}
            <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={{ ...row, textDecoration:'none', color:'#78716c' }}>
              <span style={{ fontSize:19, fontWeight:700 }} aria-hidden="true">§</span><span>{t.consentLink || 'Datenschutzerklärung'}</span>
            </a>
            <a href="/#impressum" target="_blank" rel="noopener noreferrer" style={{ ...row, textDecoration:'none', color:'#78716c' }}>
              <span style={{ fontSize:19 }}>📄</span><span>{t.imprintLink || 'Impressum'}</span>
            </a>
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
  const voicesLabel = uiText(book.language).voicesHeading
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
          {/* Stimmen von Gästen. Der Korrekturabzug ist die Stelle, an der der
              Erzähler SELBST sieht, was andere über ihn beigetragen haben — das
              Sicherheitsnetz der Kuratierung durch den Manager. */}
          {chapterVoices(c).length > 0 && (
            <div style={{ marginTop:18 }}>
              <div style={{ fontSize:11, letterSpacing:1, textTransform:'uppercase', color:'#a8a29e', marginBottom:8 }}>{voicesLabel}</div>
              {chapterVoices(c).map((v, vi) => (
                <blockquote key={vi} style={{ margin:'0 0 10px', padding:'10px 14px', background:'#fafaf9', borderLeft:'3px solid #d6d3d1', borderRadius:'0 8px 8px 0' }}>
                  <p style={{ fontSize:15, lineHeight:1.7, fontStyle:'italic', margin:0 }}>„{v.text}"</p>
                  <p style={{ fontSize:12.5, color:'#78716c', margin:'6px 0 0' }}>— {[v.name, v.relationship].filter(Boolean).join(', ')}</p>
                </blockquote>
              ))}
            </div>
          )}
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

// ── Anamnesebogen-Review (Kategorie „anamnesis", Step 2) ──────────────────────
// Der Patient prüft/bearbeitet/bestätigt den aus seinem Gespräch erzeugten Bogen
// direkt im Beitragenden-Flow — per Tippen UND per KI-Sprachanweisung — und
// bestätigt zum Schluss mit „ok" (Vorbild: Probedruck-/Finalize-Flow in ProofTab).
// KANONISCH ist der DEUTSCHE Bogen (für die aufnehmende Ärztin/den Arzt); ist die
// Interviewsprache eine andere, prüft der Patient eine Übersetzung, und seine
// Änderungen fließen beim Bestätigen in die deutsche Fassung zurück (Rückübersetzung
// nur der geänderten Abschnitte, siehe enduserAnamnesis.js). Nur de+en als UI-Chrome
// (Fallback en, Muster wie ONBOARD_L10N) — der Bogen-INHALT ist voll übersetzt.
const ANAMNESE_REVIEW_L10N = {
  de: {
    tab: 'Anamnesebogen',
    title: 'Ihr Anamnesebogen',
    introText: 'Aus Ihren Antworten erstellen wir einen Anamnesebogen für das aufnehmende Behandlungsteam. Bitte prüfen Sie ihn anschließend in Ruhe, korrigieren Sie, was nicht stimmt, und bestätigen Sie am Ende, dass alles richtig und vollständig ist.',
    createBtn: 'Bogen erstellen und prüfen',
    generating: 'Ihr Anamnesebogen wird erstellt …',
    cancel: 'Abbrechen',
    disclaimer: 'Dieser Bogen ist Ihre eigene Auskunft und wurde mit künstlicher Intelligenz aus Ihren Antworten erstellt. Er ist NICHT ärztlich geprüft. Bitte lesen Sie jeden Abschnitt und korrigieren Sie ihn, wo nötig.',
    germanNote: 'Für das Behandlungsteam wird der Bogen auf Deutsch erstellt. Sie prüfen und bearbeiten ihn hier in Ihrer Sprache — Ihre Änderungen werden in die deutsche Fassung übernommen.',
    reviewHint: 'Sie können jeden Abschnitt direkt bearbeiten oder auf das Mikrofon tippen und einfach sagen, was geändert werden soll.',
    audioIdle: '🎙 Änderung sprechen',
    audioRecording: '⏹ Aufnahme stoppen',
    audioBusy: '⏳ Wird übernommen …',
    audioHint: 'Tippen Sie zuerst in einen Abschnitt, dann aufs Mikrofon — Sie können auch nur einen markierten Teil ändern.',
    audioPickFirst: 'Bitte tippen Sie zuerst in den Abschnitt, den Sie ändern möchten.',
    audioNoText: 'Es wurde keine Anweisung erkannt. Bitte erneut versuchen.',
    confirmBtn: 'Bogen bestätigen',
    confirmTitle: 'Anamnesebogen bestätigen',
    confirmText: 'Bitte bestätigen Sie, dass der Bogen richtig und vollständig ist. Danach steht er der aufnehmenden Praxis/Klinik für Ihr Aufnahmegespräch zur Verfügung. Geben Sie zur Bestätigung „ok" ein.',
    confirm: 'Bestätigen',
    saving: 'Wird gespeichert …',
    doneTitle: 'Vielen Dank!',
    doneText: 'Ihr Anamnesebogen ist bestätigt und gespeichert. Die aufnehmende Praxis/Klinik kann ihn nun für Ihr Aufnahmegespräch nutzen.',
    doneBtn: 'Fertig',
    already: '✓ Ihr Anamnesebogen wurde bereits bestätigt und gespeichert.',
    errNoAnswers: 'Es liegen noch keine Antworten vor — bitte zuerst das Anamnesegespräch führen.',
  },
  en: {
    tab: 'Intake form',
    title: 'Your medical intake form',
    introText: 'From your answers we create a medical intake form for the admitting doctor. Please review it afterwards, correct anything that is wrong, and confirm at the end that everything is correct and complete.',
    createBtn: 'Create and review the form',
    generating: 'Your intake form is being created …',
    cancel: 'Cancel',
    disclaimer: 'This form is your own account and was created with artificial intelligence from your answers. It has NOT been checked by a doctor. Please read every section and correct it where needed.',
    germanNote: 'For the doctor the form is written in German. You review and edit it here in your language — your changes are carried over into the German version.',
    reviewHint: 'You can edit each section directly, or tap the microphone and simply say what should be changed.',
    audioIdle: '🎙 Speak a change',
    audioRecording: '⏹ Stop recording',
    audioBusy: '⏳ Applying …',
    audioHint: 'Tap into a section first, then the microphone — you can also change just a selected part.',
    audioPickFirst: 'Please tap into the section you want to change first.',
    audioNoText: 'No instruction was recognised. Please try again.',
    confirmBtn: 'Confirm form',
    confirmTitle: 'Confirm intake form',
    confirmText: 'Please confirm that the form is correct and complete. It will then be available to the admitting practice/clinic for your admission interview. Type “ok” to confirm.',
    confirm: 'Confirm',
    saving: 'Saving …',
    doneTitle: 'Thank you!',
    doneText: 'Your intake form is confirmed and saved. The admitting practice/clinic can now use it for your admission interview.',
    doneBtn: 'Done',
    already: '✓ Your intake form has already been confirmed and saved.',
    errNoAnswers: 'There are no answers yet — please complete the intake interview first.',
  },
}
function anamneseT(lang) {
  return ANAMNESE_REVIEW_L10N[lang]
    || ANAMNESE_REVIEW_L10N[String(lang || '').split('-')[0]]
    || (isGermanReview(lang) ? ANAMNESE_REVIEW_L10N.de : ANAMNESE_REVIEW_L10N.en)
}

// Dokumenten-Upload (Anamnese): der bestehende Foto-Upload wird für diese Kategorie
// vollständig auf Dokumente umformuliert (Arztbriefe, Befunde, Medikamentenpläne …).
// Overlay über die uiText-Upload-Strings; nicht überschriebene Schlüssel fallen auf
// die Basissprache zurück. de + en (Fallback en, Muster wie das Review-l10n).
const ANAMNESE_DOC_L10N = {
  de: {
    tabPhoto: 'Dokumente',
    uploadStepTitle: 'Unterlagen hochladen',
    uploadStepIntro: 'Hier können Sie relevante medizinische Unterlagen beitragen – z. B. Arztbriefe, Befunde, Bildgebungs- oder Laborberichte, Medikamentenpläne oder den Reha-Bescheid. Fotografieren Sie das Dokument oder laden Sie ein Bild davon hoch. Zu jedem Dokument können Sie optional einen Titel und eine kurze Notiz angeben.',
    uploadPick: '＋ Dokument auswählen',
    uploadCaption: 'Titel des Dokuments (optional)',
    uploadCaptionHint: 'Kurze Bezeichnung, z. B. „Arztbrief Kardiologie 05/2026".',
    uploadDesc: 'Notiz (optional)',
    uploadDescHint: 'Nur zur Einordnung für die aufnehmende Praxis/Klinik.',
    uploadSubmit: 'Dokument hochladen',
    uploadConsent: 'Ich bin berechtigt, diese Unterlagen hochzuladen. Sie werden ausschließlich zur Vorbereitung meiner Reha-Aufnahme verarbeitet und der aufnehmenden Praxis/Klinik zur Verfügung gestellt. Die Verarbeitung erfolgt über IT-/KI-Dienste, die ausschließlich in der EU laufen.',
    uploadConsentRequired: 'Bitte bestätigen Sie die Einverständniserklärung, um Unterlagen hochzuladen.',
    uploadError: 'Diese Datei konnte nicht verarbeitet werden. Bitte laden Sie ein Foto oder Bild des Dokuments hoch.',
  },
  en: {
    tabPhoto: 'Documents',
    uploadStepTitle: 'Upload documents',
    uploadStepIntro: 'Here you can add relevant medical documents – e.g. doctor’s letters, findings, imaging or lab reports, medication plans or the rehab approval. Photograph the document or upload an image of it. For each document you can optionally add a title and a short note.',
    uploadPick: '＋ Choose document',
    uploadCaption: 'Document title (optional)',
    uploadCaptionHint: 'Short label, e.g. “Cardiology letter 05/2026”.',
    uploadDesc: 'Note (optional)',
    uploadDescHint: 'Only to help the admitting practice/clinic classify it.',
    uploadSubmit: 'Upload document',
    uploadConsent: 'I am entitled to upload these documents. They are processed solely to prepare my rehab admission and made available to the admitting practice/clinic. Processing is carried out using IT/AI services that run exclusively in the EU.',
    uploadConsentRequired: 'Please confirm the declaration of consent to upload documents.',
    uploadError: 'This file could not be processed. Please upload a photo or image of the document.',
  },
}
function anamneseDocT(lang) {
  return ANAMNESE_DOC_L10N[lang]
    || ANAMNESE_DOC_L10N[String(lang || '').split('-')[0]]
    || (isGermanReview(lang) ? ANAMNESE_DOC_L10N.de : ANAMNESE_DOC_L10N.en)
}

function AnamnesisReview({ code, token, memorial, contribId, lang, onDone }) {
  const A = anamneseT(lang)
  const german = isGermanReview(lang)
  const [phase, setPhase] = useState(memorial?.intake?.bogen_confirmed_at ? 'done' : 'intro') // intro | generating | review | done
  const [sections, setSections] = useState([])
  const [busy, setBusy]     = useState(false)
  const [pct, setPct]       = useState(0)
  const [progress, setProgress] = useState('')
  const [err, setErr]       = useState('')
  const [saving, setSaving] = useState(false)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [okText, setOkText] = useState('')
  const [audioEdit, setAudioEdit] = useState(null)   // { state:'recording'|'processing' }
  const cancelRef   = useRef(false)
  const audioRecRef = useRef(null)
  const audioChunks = useRef([])
  const activeRef   = useRef(null)   // { idx, el } zuletzt fokussierter Abschnitt
  const selRef      = useRef(null)   // { idx, start, end } zum Aufnahmestart erfasst
  // Immer aktuelle Abschnittsliste — der Audio-Edit (rec.onstop, async) und das
  // Bestätigen dürfen nicht auf einen veralteten Render-Closure lesen.
  const sectionsRef = useRef(sections)
  useEffect(() => { sectionsRef.current = sections }, [sections])

  const setActive = (idx) => (e) => { activeRef.current = { idx, el: e.currentTarget } }

  async function loadContribution() {
    const c = await getContribution(contribId, code)
    if (!c || !Array.isArray(c.messages) || !c.messages.some(m => m.role === 'user')) throw new Error(A.errNoAnswers)
    return c
  }

  async function generate() {
    setErr(''); setBusy(true); setPct(0); setProgress(''); cancelRef.current = false; setPhase('generating')
    try {
      const c = await loadContribution()
      const secs = await generateAnamnesisBogen({ memorial, contributions: [c], lang, cancelRef, onProgress: p => { setPct(p.pct); setProgress(p.text) } })
      setSections(secs); setPhase('review')
    } catch (e) {
      if (e.message !== '__CANCELLED__') setErr(e.message)
      setPhase('intro')
    } finally { setBusy(false) }
  }

  // Bearbeitung findet in der Anzeigesprache (`loc`) statt. Bei Deutsch ist `de`
  // identisch und wird sofort mitgeführt; bei anderer Sprache wird der Abschnitt als
  // „dirty" markiert und beim Bestätigen ins Deutsche zurückübersetzt.
  function writeLoc(idx, val) {
    setSections(ss => ss.map((s, j) => j === idx ? { ...s, loc: val, ...(german ? { de: val, dirty: false } : { dirty: true }) } : s))
  }

  // ── KI-Sprachänderung: EIN Icon, wirkt auf den zuletzt angetippten Abschnitt ──
  async function toggleAudioEdit() {
    if (audioEdit?.state === 'recording') { try { audioRecRef.current?.stop() } catch {}; return }
    if (audioEdit) return
    const a = activeRef.current
    if (!a || !a.el) { setErr(A.audioPickFirst); return }
    const el = a.el
    const hasSel = el.selectionStart != null && el.selectionEnd > el.selectionStart
    selRef.current = { idx: a.idx, start: hasSel ? el.selectionStart : null, end: hasSel ? el.selectionEnd : null }
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
          if (!instruction) throw new Error(A.audioNoText)
          await applyAudioEdit(selRef.current, instruction)
        } catch (e) { setErr(e.message) }
        finally { setAudioEdit(null) }
      }
      rec.start(); setAudioEdit({ state: 'recording' })
    } catch (e) { setErr(e.message); setAudioEdit(null) }
  }

  async function applyAudioEdit(t, instruction) {
    if (!t) return
    const sec = sectionsRef.current[t.idx]; if (!sec) return
    const text = sec.loc
    const hasSel = t.start != null && t.end > t.start
    const segment = hasSel ? text.slice(t.start, t.end) : text
    const revised = await reviseAnamnesisSection({ segment, instruction, lang, memorialCode: code })
    if (revised == null) return   // KI-Aussetzer → Text unverändert lassen
    writeLoc(t.idx, hasSel ? spliceText(text, t.start, t.end, revised) : revised)
  }

  async function doConfirm() {
    setSaving(true); setErr('')
    try {
      let secs = sectionsRef.current
      if (!german) {
        // Nur die tatsächlich geänderten Abschnitte zurückübersetzen; unveränderte
        // behalten ihr direkt aus dem Gespräch erzeugtes Deutsch (keine Round-Trips).
        secs = sectionsRef.current.map(s => ({ ...s }))
        for (let i = 0; i < secs.length; i++) {
          if (secs[i].dirty) { secs[i].de = await translateToGerman(secs[i].loc, lang, code); secs[i].dirty = false }
        }
      }
      const canonical = buildCanonical(memorial, secs)
      await saveAnamneseBogen(code, token, { text: canonical, confirmed: true })
      setSections(secs); setFinalizeOpen(false); setOkText(''); setPhase('done')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const page = { ...S.page, paddingTop: '1.5rem' }
  const heading = <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>{A.title}</h2>

  if (phase === 'done') return (
    <div style={page}>
      {heading}
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: 14.5, color: '#166534', lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ {A.doneTitle}</div>
        {A.doneText}
      </div>
      {onDone && <button onClick={onDone} style={{ fontSize: 15, padding: '10px 20px' }}>{A.doneBtn}</button>}
    </div>
  )

  if (phase === 'generating' || busy) return (
    <div style={page}>
      {heading}
      <div style={{ height: 8, background: '#e7e5e4', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#0d9488', transition: 'width .3s' }} />
      </div>
      <p style={{ ...S.muted, margin: 0 }}>{pct}% · {progress || A.generating}</p>
      <button className="secondary" onClick={() => { cancelRef.current = true }} style={{ marginTop: 16, fontSize: 13 }}>{A.cancel}</button>
    </div>
  )

  if (phase === 'intro') return (
    <div style={page}>
      {heading}
      <Err msg={err} />
      <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.4rem', marginBottom: 16 }}>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: '#44403c', marginTop: 0 }}>{A.introText}</p>
        {!german && <p style={{ fontSize: 13, lineHeight: 1.6, color: '#0f766e', margin: '0 0 14px' }}>{A.germanNote}</p>}
        <button onClick={generate} style={{ fontSize: 15, padding: '11px 20px' }}>{A.createBtn}</button>
      </div>
    </div>
  )

  // ── REVIEW ──
  return (
    <div style={page}>
      {heading}
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '11px 14px', marginBottom: 12, fontSize: 13, color: '#0c4a6e', lineHeight: 1.55 }}>
        {A.disclaimer}{!german ? ` ${A.germanNote}` : ''}
      </div>
      <Err msg={err} />
      {/* Immer sichtbare Aktionsleiste: EIN Mikrofon wirkt auf den zuletzt angetippten
          Abschnitt (markierter Teil, sonst ganzer Abschnitt) + „Bogen bestätigen". */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fafaf9', display: 'flex', gap: 8, margin: '0 0 4px', padding: '8px 0', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #f0efec' }}>
        <button onClick={toggleAudioEdit} disabled={audioEdit?.state === 'processing'}
          className={audioEdit?.state === 'recording' ? '' : 'secondary'} style={{ fontSize: 13, padding: '8px 14px' }}>
          {audioEdit?.state === 'recording' ? A.audioRecording : audioEdit?.state === 'processing' ? A.audioBusy : A.audioIdle}
        </button>
        <button onClick={() => setFinalizeOpen(true)} style={{ fontSize: 14, padding: '8px 16px' }}>{A.confirmBtn}</button>
      </div>
      <p style={{ fontSize: 11, color: '#a8a29e', margin: '0 0 12px' }}>{A.audioHint}</p>
      {sections.map((s, i) => (
        <section key={s.key} style={{ marginTop: 18, borderTop: '1px solid #f0efec', paddingTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#0f766e' }}>{s.labelLoc || s.label}</div>
          <AutoGrowTextarea onFocus={setActive(i)} value={s.loc || ''} onChange={e => writeLoc(i, e.target.value)}
            style={{ width: '100%', minHeight: 72, fontSize: 15, lineHeight: 1.6, fontFamily: 'Georgia, serif', padding: 12, borderRadius: 8, border: '1px solid #e7e5e4' }} />
        </section>
      ))}

      {finalizeOpen && (
        <PModal onClose={() => { if (!saving) { setFinalizeOpen(false); setOkText('') } }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 10 }}>{A.confirmTitle}</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#44403c' }}>{A.confirmText}</p>
          <input value={okText} onChange={e => setOkText(e.target.value)} placeholder="ok" autoFocus style={{ width: '100%', marginBottom: 14 }} />
          {err && <p style={{ fontSize: 13, color: '#b91c1c', margin: '0 0 10px' }}>⚠ {err}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="secondary" disabled={saving} onClick={() => { setFinalizeOpen(false); setOkText('') }} style={{ fontSize: 14 }}>{A.cancel}</button>
            <button onClick={doConfirm} disabled={okText.trim().toLowerCase() !== 'ok' || saving} style={{ fontSize: 14 }}>{saving ? A.saving : A.confirm}</button>
          </div>
        </PModal>
      )}
    </div>
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

  // ── Ganzes Buch vorlesen (TTS, kapitelweise sequenziell) ──
  // Nutzt denselben Abspielweg wie das Interview (speakText/stopSpeaking, /api/speak
  // mit der pro Buch gewählten Stimme). Lange Kapitel werden in ~700-Zeichen-Häppchen
  // an Satzgrenzen zerlegt, damit die Sprachsynthese nicht an Längengrenzen scheitert.
  const [reading, setReading]      = useState(false)
  const [readLoading, setReadLoad] = useState(false)
  const readSeqRef = useRef(0)
  const RT = String(lang || '').startsWith('en')
    ? { play: 'Read book aloud', stop: 'Stop reading', loading: 'Loading …' }
    : { play: 'Buch vorlesen', stop: 'Vorlesen stoppen', loading: 'Lädt …' }

  function buildReadQueue(b) {
    const parts = []
    if (b?.title) parts.push(String(b.title))
    if (b?.subtitle) parts.push(String(b.subtitle))
    for (const c of (b?.chapters || [])) {
      if (c?.heading) parts.push(String(c.heading))
      if (c?.body) parts.push(String(c.body))
      // Gaststimmen mitlesen — wer sich das Buch vorlesen lässt, soll nicht
      // ausgerechnet die Stellen verpassen, die andere beigetragen haben.
      for (const v of chapterVoices(c)) {
        const by = [v.name, v.relationship].filter(Boolean).join(', ')
        parts.push(by ? `${v.text} — ${by}` : String(v.text))
      }
    }
    const chunks = []
    for (const raw of parts) {
      const text = raw.trim()
      if (!text) continue
      if (text.length <= 700) { chunks.push(text); continue }
      const sentences = text.split(/(?<=[.!?…])\s+/)
      let buf = ''
      for (const s of sentences) {
        if (buf && (buf + ' ' + s).length > 700) { chunks.push(buf.trim()); buf = s }
        else buf = buf ? buf + ' ' + s : s
      }
      if (buf.trim()) chunks.push(buf.trim())
    }
    return chunks
  }
  function stopReading() { readSeqRef.current++; stopSpeaking(); setReading(false); setReadLoad(false) }
  function startReading() {
    const queue = buildReadQueue(bookRef.current || book)
    if (!queue.length) return
    unlockAudio()                       // iOS: innerhalb der Klick-Geste freischalten
    const mySeq = ++readSeqRef.current
    setErr(''); setReading(true); setReadLoad(true)
    let i = 0
    const playNext = () => {
      if (mySeq !== readSeqRef.current) return
      if (i >= queue.length) { setReading(false); setReadLoad(false); return }
      const part = queue[i++]
      speakText(part, {
        memorialCode: code, language: lang, voice: interviewTtsVoice(memorial, null),
        onPlay:  () => { if (mySeq === readSeqRef.current) setReadLoad(false) },
        onEnd:   () => { if (mySeq === readSeqRef.current) playNext() },
        onError: (msg) => { if (mySeq === readSeqRef.current) { setErr(msg || 'Audiowiedergabe fehlgeschlagen.'); setReading(false); setReadLoad(false) } },
      })
    }
    playNext()
  }
  const toggleReading = () => (reading ? stopReading() : startReading())
  // TTS stoppen, wenn die Proof-Ansicht verlassen/entladen wird.
  useEffect(() => () => { readSeqRef.current++; stopSpeaking() }, [])

  const du = String(memorial?.intake?.address || 'Sie').trim().toLowerCase() === 'du'
  const P = proofT(lang, du)
  // Überschrift der Stimmen-Kästen (Gastbeiträge). Sie gehört zum BUCH, nicht
  // zur Oberfläche — deshalb aus uiText in der Buchsprache, wie im Export.
  const voicesLabel = uiText(book?.language || lang).voicesHeading
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

  // Ist das Buch anderweitig gesperrt (der Manager hat es im Dashboard offen oder ein
  // alter Lock ist noch nicht abgelaufen), fassen wir aktiv nach und geben automatisch
  // frei, sobald der Lock verschwindet — der Endnutzer muss nicht neu laden.
  useEffect(() => {
    if (!lockedByOther) return
    const id = setInterval(async () => {
      try {
        const d = await getEnduserBook(code, token)
        if (!d.lock) {
          setBook(d.book || null); bookRef.current = d.book || null
          setSigned(d.signed || {}); setImageRegen(d.image_regen || {})
          setProofUsed(d.proof_used || 0); setProofMax(d.proof_max ?? 3)
          setFinalized(!!d.book_finalized); setLockedByOther(false)
        }
      } catch { /* weiter gesperrt oder kurzer Aussetzer → beim nächsten Tick erneut */ }
    }, 15000)
    return () => clearInterval(id)
  }, [lockedByOther, code, token]) // eslint-disable-line

  function stopHeartbeat() { if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null } }
  function startHeartbeat() { stopHeartbeat(); hbRef.current = setInterval(() => { if (lockRef.current) heartbeatEditLock(code, token, lockRef.current).catch(() => {}) }, 90 * 1000) }
  async function ensureLock() { if (lockRef.current) return lockRef.current; const r = await acquireEditLock(code, token); lockRef.current = r.token; startHeartbeat(); return r.token }
  async function release() { stopHeartbeat(); const tk = lockRef.current; lockRef.current = null; if (tk) { try { await releaseEditLock(code, token, tk) } catch {} } }
  function applyBook(nb) { bookRef.current = nb; setBook(nb) }

  async function loadContribution() {
    const c = await getContribution(contribId, code)
    if (!c || !Array.isArray(c.messages) || !c.messages.some(m => m.role === 'user')) {
      throw new Error(P.noAnswers)
    }
    // Nicht nur „gibt es Antworten?", sondern „reicht das Erzählte?". Mit einer
    // Handvoll Sätze entsteht sonst ein Buch, das die KI zum größten Teil erfindet
    // — und der Endnutzer verbraucht dafür eine seiner wenigen Vorschauen.
    // Dieselbe Schwelle wie im Dashboard (LIFEWORK_MIN_SELF_WORDS).
    const words = c.messages
      .filter(m => m?.role === 'user')
      .reduce((s, m) => s + String(m.content || '').trim().split(/\s+/).filter(Boolean).length, 0)
    if (words < MIN_SELF_WORDS && P.tooFewWords) {
      throw new Error(P.tooFewWords(words, MIN_SELF_WORDS))
    }
    return c
  }

  // ── Zwischenstand (Text; verbraucht eine Vorschau) ──
  async function generateInterim() {
    setConfirmZw(false); setErr(''); setBusy(true); setPct(0); setProgress(P.preparing); cancelRef.current = false
    try {
      await ensureLock()
      // ERST prüfen, DANN eine Vorschau verbrauchen. Sonst kostet ein zu dünnes
      // Interview einen der wenigen Probedrucke, ohne dass etwas entsteht.
      const c = await loadContribution()
      const cons = await consumeProof(code, token); setProofUsed(cons.used); setProofMax(cons.max)
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
      const sp = await startPrintVersion(code, token)   // holt nur den Lock (schließt Interview NOCH nicht)
      lockRef.current = sp.token; startHeartbeat()
      const c = await loadContribution()
      setProgress(P.progText)
      const nb = await generateProofBook({ memorial, contributions: [c], lang, cancelRef, onProgress: p => { setPct(Math.round(p.pct * 0.4)); setProgress(p.text) } })
      nb.print = true
      await saveEnduserBook(code, token, lockRef.current, nb)   // DAMIT wird das Interview endgültig geschlossen
      onMemorialPatch?.({ interview_closed: true })             // Status erst jetzt aktualisieren (Erzeugung war erfolgreich)
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
      + `Behalte die Sprache bei. Erfinde keine neuen Fakten. Gib NUR den überarbeiteten Text zurück – ohne Anführungszeichen, ohne Vorbemerkung, ohne Kommentar. `
      + `Soll der Text laut Anweisung entfernt werden oder leer bleiben, antworte AUSSCHLIESSLICH mit dem Wort LEER (nichts sonst) – schreibe KEINE Platzhalter, keine Klammern und keine Erklärung.`
    let revised = String(await askLLM(sys, [{ role: 'user', content: `${isHeading ? 'ÜBERSCHRIFT' : 'ABSCHNITT'}:\n${segment}\n\nANWEISUNG:\n${instruction}` }], { memorialCode: code, token, kind: 'edit' }) || '').trim()
    if (!revised) return   // KI-Aussetzer (leere Antwort) → Text unverändert lassen
    // Soll der Abschnitt leer sein: das Sentinel „LEER" ODER ein von der KI trotzdem
    // erzeugter Platzhalter in Klammern („[… rausgelassen …]") wird zu echtem Leertext.
    if (/^\[?\s*leer\s*\]?$/i.test(revised) ||
        /^\[[^\]]*(rausgelassen|weggelassen|ausgelassen|entfernt|kein text|leer)[^\]]*\]$/i.test(revised)) {
      revised = ''
    }
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
      <div style={{ marginBottom: 14 }}>
        <button onClick={toggleReading} className={reading ? '' : 'secondary'} style={{ fontSize: 13, padding: '8px 14px' }}>
          {reading ? `⏹ ${RT.stop}` : readLoading ? RT.loading : `▶ ${RT.play}`}
        </button>
        <Err msg={err} />
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
        <button onClick={toggleReading} className={reading ? '' : 'secondary'} style={{ fontSize: 13, padding: '8px 14px' }}>
          {reading ? `⏹ ${RT.stop}` : readLoading ? RT.loading : `▶ ${RT.play}`}
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
            {/* Was andere über diesen Abschnitt erzählt haben. Der Erzähler darf
                das kürzen oder ganz entfernen — es ist SEIN Buch, auch wenn die
                Freigabe der Gastbeiträge beim Manager liegt. */}
            {chapterVoices(c).length > 0 && (
              <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '3px solid #e7e5e4' }}>
                <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#a8a29e', marginBottom: 8 }}>{voicesLabel}</div>
                {chapterVoices(c).map((v, vi) => (
                  <div key={vi} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, color: '#78716c' }}>{[v.name, v.relationship].filter(Boolean).join(', ')}</span>
                      <button className="ghost" onClick={() => setChapter(i, { voices: chapterVoices(c).filter((_, k) => k !== vi) })}
                        style={{ fontSize: 12, color: '#dc2626', padding: '2px 8px' }}>🗑</button>
                    </div>
                    <AutoGrowTextarea value={v.text || ''}
                      onChange={e => setChapter(i, { voices: chapterVoices(c).map((x, k) => k === vi ? { ...x, text: e.target.value } : x) })}
                      style={{ width: '100%', minHeight: 60, fontSize: 14, lineHeight: 1.6, fontStyle: 'italic', fontFamily: 'Georgia, serif', padding: 10, borderRadius: 8, border: '1px solid #e7e5e4' }} />
                  </div>
                ))}
              </div>
            )}
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

// ── Einführungs-Overlay („Onboarding") beim ersten Öffnen ─────────────────────
// Zeigt in einem Weiter-Karussell kurz die für DIESES Buch freigeschalteten
// Funktionen — mit Seitenpunkten und „Nicht mehr anzeigen" (Standard AN). Je Slide
// ein echter Screenshot aus public/onboarding/<key>.png (Fallback: Illustration).
const ONBOARD_L10N = {
  de: {
    next: 'Weiter', back: 'Zurück', start: 'Los geht’s', skip: 'Überspringen',
    dontShow: 'Diese Einführung nicht mehr anzeigen',
    slides: {
      interview: ['Frei erzählen', 'Tippen Sie auf das Mikrofon und sprechen Sie ganz frei. Sie dürfen jederzeit Pausen machen und in Ruhe nachdenken — die Aufnahme wartet.'],
      transcript: ['Text mitlesen', 'Über den Transkript-Schalter sehen Sie Ihre Antworten als Text und können einzelne Antworten löschen oder neu einsprechen.'],
      companion: ['Begleitung', 'Im begleiteten Modus kann eine zweite Person mithelfen und ergänzen — praktisch zu zweit.'],
      photo: ['Fotos hinzufügen', 'Laden Sie eigene Fotos hoch. Sie werden für das Buch berücksichtigt.'],
      proof: ['Probedruck ansehen', 'Sehen Sie Ihr Buch als Vorschau, bearbeiten Sie Texte und erzeugen Sie Kapitelbilder.'],
      settings: ['Stil & Layout', 'Wählen Sie Grafikstil, Buchlayout und Schreibstil Ihres Buchs.'],
      menu: ['Alles im Menü', 'Oben rechts öffnet ☰ das Menü — mit allen weiteren Funktionen sowie Datenschutz, Impressum und Support.'],
    },
    heading: 'Willkommen', intro: 'Kurz die wichtigsten Funktionen:',
  },
  en: {
    next: 'Next', back: 'Back', start: 'Get started', skip: 'Skip',
    dontShow: 'Do not show this introduction again',
    slides: {
      interview: ['Just talk', 'Tap the microphone and speak freely. You may pause and think at any time — the recording waits for you.'],
      transcript: ['Read along', 'With the transcript switch you can see your answers as text and delete or re-record individual answers.'],
      companion: ['Companion', 'In companion mode a second person can help and add to your story.'],
      photo: ['Add photos', 'Upload your own photos. They will be considered for the book.'],
      proof: ['Preview print', 'See your book as a preview, edit texts and generate chapter images.'],
      settings: ['Style & layout', 'Choose the graphic style, book layout and writing style of your book.'],
      menu: ['Everything in the menu', 'The ☰ menu (top right) holds all other functions, plus privacy, imprint and support.'],
    },
    heading: 'Welcome', intro: 'The most important functions at a glance:',
  },
  pl: {
    next: 'Dalej', back: 'Wstecz', start: 'Zaczynamy', skip: 'Pomiń',
    dontShow: 'Nie pokazuj więcej tego wprowadzenia',
    slides: {
      interview: ['Mów swobodnie', 'Dotknij mikrofonu i mów swobodnie. Możesz w każdej chwili zrobić przerwę i spokojnie pomyśleć — nagranie czeka.'],
      transcript: ['Czytaj na bieżąco', 'Za pomocą przełącznika transkrypcji zobaczysz swoje odpowiedzi jako tekst i możesz je usuwać lub nagrywać ponownie.'],
      companion: ['Towarzysz', 'W trybie towarzyszącym druga osoba może pomóc i uzupełnić historię.'],
      photo: ['Dodaj zdjęcia', 'Prześlij własne zdjęcia. Zostaną uwzględnione w książce.'],
      proof: ['Podgląd wydruku', 'Zobacz podgląd książki, edytuj teksty i twórz ilustracje rozdziałów.'],
      settings: ['Styl i układ', 'Wybierz styl graficzny, układ i styl pisania swojej książki.'],
      menu: ['Wszystko w menu', 'Menu ☰ (u góry po prawej) zawiera pozostałe funkcje oraz prywatność, notę prawną i pomoc.'],
    },
    heading: 'Witamy', intro: 'Najważniejsze funkcje w skrócie:',
  },
}

function OnboardMock({ icon, color }) {
  // Fallback-Illustration, falls ein Screenshot (noch) nicht lädt.
  return (
    <div style={{ width:170, maxWidth:'60%', margin:'0 auto', aspectRatio:'9/16', background:'#fff', border:'6px solid #1c1917', borderRadius:18, boxShadow:'0 10px 30px rgba(0,0,0,.18)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:16, gap:12 }}>
      <div style={{ width:52, height:52, borderRadius:'50%', background:color || '#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26 }}>{icon}</div>
      <div style={{ width:'80%', height:8, borderRadius:5, background:'#e7e5e4' }} />
      <div style={{ width:'60%', height:8, borderRadius:5, background:'#efece9' }} />
      <div style={{ width:'70%', height:8, borderRadius:5, background:'#efece9' }} />
    </div>
  )
}

// Echter Screenshot in einem Geräte-Rähmchen; fällt bei Ladefehler auf die
// Illustration zurück (z. B. falls die Bilddatei fehlt).
function OnboardShot({ slideKey, icon, color }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <OnboardMock icon={icon} color={color} />
  return (
    <img src={`/onboarding/${slideKey}.png`} alt="" loading="lazy" onError={() => setFailed(true)}
      style={{ display:'block', margin:'0 auto', height:300, maxHeight:'40vh', width:'auto', maxWidth:'100%',
        borderRadius:16, border:'6px solid #1c1917', boxShadow:'0 10px 30px rgba(0,0,0,.18)', background:'#fff' }} />
  )
}

function OnboardingCarousel({ memorial, lang = 'de', onClose }) {
  const s = ONBOARD_L10N[lang] || ONBOARD_L10N.de
  // Gäste (Gastbeiträge zum Lebenswerk) sind BEITRAGENDE, nicht der Endnutzer —
  // Einstellungen und Probedruck gibt es für sie nicht, also auch keine Slides dazu.
  const isSelf = memorial?.product_category === 'lifework' && !memorial?.guest
  // Slides aus der Buch-Konfiguration ableiten — nur freigeschaltete Funktionen.
  const slides = []
  const add = (key, icon, color) => slides.push({ key, icon, color, title: s.slides[key][0], body: s.slides[key][1] })
  add('interview', '🎙️', '#fee2e2')
  if (memorial?.show_transcript !== false) add('transcript', '📝', '#e0f2fe')
  if (memorial?.companion_mode === true) add('companion', '👥', '#dbeafe')
  if (memorial?.photo_upload_tab === true && !memorial?.book_finalized) add('photo', '📷', '#dcfce7')
  if (isSelf && memorial?.proof_enabled === true) add('proof', '📖', '#fef3c7')
  if (isSelf) add('settings', '⚙️', '#f3e8ff')
  add('menu', '☰', '#f5f5f4')

  const [i, setI] = useState(0)
  const [dontShow, setDontShow] = useState(true)   // Standard: aktiviert (nur beim ersten Mal)
  const last = i >= slides.length - 1
  const finish = () => onClose?.(dontShow)
  const cur = slides[i]

  return (
    <div style={{ position:'fixed', inset:0, zIndex:250, background:'rgba(28,25,23,.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'100%', maxWidth:400, background:'#fff', borderRadius:18, padding:'20px 20px 18px', boxShadow:'0 16px 50px rgba(0,0,0,.3)', textAlign:'center' }}>
        <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:2 }}>
          <button onClick={finish} style={{ background:'none', border:'none', fontSize:13, color:'#a8a29e', cursor:'pointer' }}>{s.skip} ✕</button>
        </div>
        <div style={{ padding:'6px 0 14px' }}>
          <OnboardShot slideKey={cur.key} icon={cur.icon} color={cur.color} />
        </div>
        <h2 style={{ fontSize:19, fontWeight:700, margin:'0 0 8px' }}>{cur.title}</h2>
        <p style={{ fontSize:14.5, lineHeight:1.6, color:'#57534e', margin:'0 auto 16px', maxWidth:320 }}>{cur.body}</p>

        {/* Seitenpunkte */}
        <div style={{ display:'flex', gap:7, justifyContent:'center', marginBottom:16 }}>
          {slides.map((_, k) => (
            <span key={k} onClick={() => setI(k)} style={{ width: k === i ? 20 : 8, height:8, borderRadius:4, background: k === i ? '#1c1917' : '#d6d3d1', cursor:'pointer', transition:'width .2s,background .2s' }} />
          ))}
        </div>

        <div style={{ display:'flex', gap:10, alignItems:'center', justifyContent:'space-between' }}>
          <button onClick={() => setI(v => Math.max(0, v - 1))} disabled={i === 0} className="ghost"
            style={{ fontSize:14, padding:'9px 12px', color: i === 0 ? '#d6d3d1' : '#78716c' }}>{s.back}</button>
          <button onClick={() => last ? finish() : setI(v => v + 1)} style={{ fontSize:15, padding:'10px 22px', minWidth:120 }}>
            {last ? s.start : s.next}
          </button>
        </div>

        <label style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'center', marginTop:16, fontSize:12.5, color:'#78716c', cursor:'pointer' }}>
          <input type="checkbox" checked={dontShow} onChange={e => setDontShow(e.target.checked)} style={{ width:15, height:15, cursor:'pointer', accentColor:'#1c1917' }} />
          {s.dontShow}
        </label>
      </div>
    </div>
  )
}

// `endUserToken` gesetzt → der Erzähler ist der Endnutzer eines Lebenswerks: Er
// erzählt sein EIGENES Leben (keine Beziehungsangabe), kann Fotos hochladen und
// bekommt einen Einstellungs-Tab für Grafik- und Textstil seines Buchs.
export function ContributorFlow({ code, endUserToken = null, onLogout = null, fromRemembered = false }) {
  // Wurde dieses Interview aus dem auf dem Gerät gemerkten Code geöffnet (nicht über
  // einen ?code-Link), bieten wir im ☰-Menü einen Ausweg „Anderes Interview" an:
  // gemerkten Code verwerfen und zurück zur Startseite (wichtig auf geteilten Geräten).
  const switchInterview = fromRemembered
    ? () => { try { localStorage.removeItem('lw_last_code') } catch { /* ignore */ } window.location.href = '/' }
    : null
  const [view, setView]                       = useState('loading') // loading | info | interview | done | error
  const [memorial, setMemorial]               = useState(null)
  const [contribForm, setContribForm]         = useState({ name:'', gender:'', relationship:'', address:'Sie' })
  const [err, setErr]                         = useState('')
  const [contribId, setContribId]             = useState(() => genContribId())
  const [consentChecked, setConsentChecked]   = useState(false)
  const [consentAt, setConsentAt]             = useState(null)
  const [initialMessages, setInitialMessages] = useState([])
  const [resumePrompt, setResumePrompt]       = useState(null)
  // Fortsetzen-Gate (Lebenswerk/Anamnese): hält die wiederaufzunehmende Sitzung, bis
  // der Nutzer EINMAL „Fortsetzen" tippt — diese Geste schaltet die Tonausgabe frei,
  // damit die erste Frage in der installierten App / auf iOS wirklich hörbar spielt.
  const [resumeGate, setResumeGate]           = useState(null)
  const [paused, setPaused]                   = useState(false)
  const [copied, setCopied]                   = useState('')
  const [saveErr, setSaveErr]                 = useState('')
  const [lang, setLang]                       = useState(null) // vom Beitragenden gewählte Sprache
  const [tab, setTab]                         = useState('interview') // interview | photo (nur wenn photo_upload_tab)
  const [showTx, setShowTx]                   = useState(false)        // Transkript einblenden (auch über die Tab-Leiste steuerbar)
  const [companionOn, setCompanionOn]         = useState(false)        // begleiteter Co-Interview-Modus aktiv
  // Vom Nutzer im ☰-Menü gewählter Aufnahme-Modus (überschreibt den Buch-Standard).
  // null = Buch-Standard. In localStorage je Code gemerkt, damit die Wahl bleibt.
  const [micMode, setMicMode]                 = useState(() => { try { return localStorage.getItem('lw_micmode_' + code) || null } catch { return null } })
  const [micModeOpen, setMicModeOpen]         = useState(false)        // Modus-Auswahl-Dialog offen
  // Ton-/Mikrofontest. Bewusst HIER (nicht im Menü oder im Interview), weil er das
  // Interview stilllegen muss, solange er offen ist — sonst laufen Vorlesen bzw.
  // Aufnahme und Test gleichzeitig.
  const [soundTest, setSoundTest]             = useState(false)
  // Hinweis vor dem Browser-Dialog „Mikrofon zulassen?" (siehe needsMicPriming).
  const [micPrime, setMicPrime]               = useState(false)
  const [micPermFlow, setMicPermFlow]         = useState('unknown')
  useEffect(() => {
    if (!navigator.permissions?.query) return
    let live = true, st = null
    navigator.permissions.query({ name: 'microphone' }).then(s => {
      if (!live) return
      st = s; setMicPermFlow(s.state)
      s.onchange = () => { if (live) setMicPermFlow(s.state) }
    }).catch(() => {})
    return () => { live = false; if (st) st.onchange = null }
  }, [])
  const chooseMicMode = (mode) => { setMicMode(mode); try { mode ? localStorage.setItem('lw_micmode_' + code, mode) : localStorage.removeItem('lw_micmode_' + code) } catch {} }
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
      .catch(e => {
        // Kam dieses Interview aus dem gemerkten Code und ist er ungültig (gelöscht/
        // abgelaufen), den Merker verwerfen → beim nächsten Öffnen kein Sackgassen-Loop.
        if (fromRemembered) { try { localStorage.removeItem('lw_last_code') } catch { /* ignore */ } }
        setErr(e.message); setView('error')
      })
  }, [code])

  // PWA-Name je Produkt: im Lebenswerk-Flow „Lebenswerk.ai", sonst „Lebensgeschichten.ai".
  // Muss vor einer etwaigen Installation gesetzt sein → sobald das Produkt bekannt ist.
  useEffect(() => { setPwaProduct(memorial?.product_category, code) }, [memorial?.product_category, code])

  // Globalen Rechts-Footer (Datenschutz/Impressum) im Interview ausblenden — dort
  // liegen die Links im ☰-Menü. In Info-/Fertig-Schritten bleibt der Footer.
  // (Der eigentliche Umschalt-Effekt steht weiter unten, wo `view` bekannt ist.)
  const setHideFooter = useContext(FooterVisibilityCtx)
  const openSupport = useSupport()

  // Einführungs-Overlay beim ERSTEN Öffnen: nur wenn am Buch aktiviert
  // (show_onboarding !== false) UND lokal noch nicht „nicht mehr anzeigen" gesetzt.
  const [showOnboard, setShowOnboard] = useState(false)
  const onboardCheckedRef = useRef(false)
  useEffect(() => {
    if (!memorial || onboardCheckedRef.current) return
    onboardCheckedRef.current = true
    try {
      // „Nicht mehr anzeigen" wird zweifach gemerkt: pro Buch UND global. So bleibt
      // die Einführung nach dem ersten Wegklicken zuverlässig aus — unabhängig davon,
      // über welchen Weg (Login oder ?code=-Link) das Buch geöffnet wird.
      const dismissed = localStorage.getItem('lw_onboarded_' + code) || localStorage.getItem('lw_onboarded_all')
      if (memorial.show_onboarding !== false && !dismissed) setShowOnboard(true)
    } catch { /* privater Modus → dann eben jedes Mal (unkritisch) */ }
  }, [memorial])

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
    if (!local) {
      // Kein lokaler Merker (z. B. installierte iOS-App mit eigenem Speicher, oder
      // neues Gerät). Bei Endnutzern (EINE Person, Code privat) vom SERVER
      // wiederaufnehmen, statt frisch zu starten (sonst Einwilligung/Onboarding erneut
      // und Interview von vorn). Geteilte Bücher NICHT → normale Info-Maske.
      // NICHT für Gäste: Der Gast-Link ist geteilt (viele Angehörige, ein Code) —
      // eine serverseitige Wiederaufnahme würde die Sitzung eines anderen Gastes
      // (bzw. gar nichts) liefern. Gäste laufen den normalen Beitragenden-Weg.
      if (!memorial.guest && (memorial.product_category === 'lifework' || isAnamnesisCategory(memorial.product_category))) {
        getEnduserResume(code)
          .then(contrib => {
            if (contrib && Array.isArray(contrib.messages) && contrib.messages.length) {
              // Vorhandener Fortschritt → Onboarding nicht erneut zeigen, dann per
              // „Fortsetzen"-Geste (Ton frei) ins Interview (resumeSession holt den Beitrag).
              try { localStorage.setItem('lw_onboarded_' + code, '1') } catch { /* privater Modus */ }
              setShowOnboard(false)
              setResumeGate({ contribId: contrib.id })
            } else {
              setView('info')
            }
          })
          .catch(() => setView('info'))
        return
      }
      setView('info'); return
    }
    // Der Merker heißt lw_session_<BUCH-CODE> — er hängt am BUCH, nicht an der Person.
    //  • Lebenswerk: ein Buch = genau eine erzählende Person (eigener Code, eigener
    //    Login). Eine fremde Sitzung kann hier gar nicht liegen → ohne Rückfrage
    //    fortsetzen. Der Preis: keine Nutzer-Geste, also kann iOS die Sprachausgabe
    //    der ersten Frage blocken (siehe primeAudio) — bewusst in Kauf genommen,
    //    das Mikrofon-Tippen schaltet den Ton wieder frei.
    //  • Alle anderen Kategorien: ALLE Beitragenden teilen denselben ?code-Link und
    //    damit denselben Merker. Ohne Rückfrage landet die zweite Person auf einem
    //    gemeinsamen Gerät im Beitrag der ersten und verfälscht ihn → hier wird gefragt.
    // Lebenswerk UND Anamnese: ein Buch = genau eine erzählende Person (eigener
    // Code/Login) → ohne Rückfrage fortsetzen.
    // Lebenswerk/Anamnese: keine „Fortsetzen oder neu?"-Rückfrage, aber EIN kurzer
    // „Fortsetzen"-Screen als Nutzer-Geste (schaltet die Tonausgabe frei).
    // Gäste teilen sich EINEN Link — hier gilt (wie bei den geteilten Büchern)
    // die Rückfrage „Fortsetzen oder neu?", sonst landet der zweite Gast auf
    // demselben Gerät im Beitrag des ersten.
    if (!memorial.guest && (memorial.product_category === 'lifework' || isAnamnesisCategory(memorial.product_category))) { setResumeGate(local); return }
    setResumePrompt(local)
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

  // Aus dem Dialog heraus fortsetzen (geteilte Bücher).
  function resumeLocal() {
    if (!resumePrompt) return
    // In dieser Nutzer-Geste (Tap auf „Fortsetzen") das TTS-Element freischalten,
    // damit auf iOS auch die erste Frage nach dem Fortsetzen hörbar ist.
    unlockAudio()
    resumeSession(resumePrompt)
  }

  // Eine gespeicherte Sitzung wiederherstellen — aus dem Dialog ODER (beim
  // Lebenswerk) automatisch beim Start.
  async function resumeSession(local) {
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
    // Eine bereits erteilte Einwilligung gilt der VERARBEITUNG, nicht der Sitzung —
    // aber immer nur für DIESELBE Person. Bei geteilten Links (Beitragende, Gäste)
    // heißt „neu beginnen" in aller Regel: Jetzt erzählt jemand anderes. Dessen
    // Einwilligung darf nicht aus der vorigen Sitzung geerbt werden, sonst hat die
    // App eine Einwilligung, die diese Person nie gegeben hat. Nur beim Selbst-
    // Interview (Lebenswerk/Anamnese, ein Buch = eine Person) wird sie übernommen.
    const priorConsent = isSelf ? (resumePrompt?.consentAt || consentAt || null) : null
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

  // Ein „Blockieren" im Browser-Dialog ist ENDGÜLTIG: Chrome merkt es sich pro
  // Domain und fragt nie wieder; nur die Geräte-Einstellungen helfen dann noch.
  // Deshalb VOR dem Browser-Dialog ein eigener Hinweis, was gleich passiert und
  // warum — wer versteht, worum es geht, blockiert seltener aus Reflex.
  // Nur zeigen, wenn der Dialog auch wirklich kommt: nicht bei bereits erteilter
  // oder bereits verweigerter Berechtigung, und nicht auf iOS (dort fragen wir
  // bewusst erst beim ersten Mikrofon-Tippen, siehe prewarmMic).
  function needsMicPriming() {
    try {
      const ua = navigator.userAgent || ''
      if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return false
      if (!navigator.mediaDevices?.getUserMedia) return false
      return micPermFlow !== 'granted' && micPermFlow !== 'denied'
    } catch { return false }
  }

  function startInterview() {
    if (needsMicPriming()) { setMicPrime(true); return }   // erst erklären, dann fragen
    beginInterview()
  }

  // withMic=false: Der Nutzer hat „Später entscheiden" gewählt — dann lösen wir den
  // Berechtigungsdialog jetzt NICHT aus; er kommt beim ersten Tippen aufs Mikrofon.
  function beginInterview(withMic = true) {
    unlockAudio()
    if (withMic) prewarmMic()   // Berechtigungsdialog gleich hier, nicht erst am ersten Mikrofon-Tap
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
    setPaused(false)
    // Anamnese: der Patient prüft/bestätigt zuerst den Bogen (Tab „Anamnesebogen"),
    // statt direkt auf den Abschluss-Screen zu springen — erst nach dem „ok" folgt der.
    if (isAnamnesisCategory(memorial?.product_category)) { setTab('bogen'); return }
    setView('done')
  }

  // Angebotene Sprachen + aktuell wirksame Sprache des Beitragenden.
  const langs   = sortLangs((memorial?.languages && memorial.languages.length) ? memorial.languages : [DEFAULT_LANGUAGE])
  const L       = lang || (langs.length === 1 ? langs[0] : DEFAULT_LANGUAGE)
  const needLang = !!memorial && langs.length > 1 && !lang
  const t  = uiText(L)
  // Gastbeiträge zum Lebenswerk: Wer über den GAST-Link kommt, ist ein normaler
  // Beitragender — er erzählt ÜBER die Person, nicht als sie, und darf vom
  // Endnutzer-Bereich (Einstellungen, Korrekturabzug) nichts sehen. `guest`
  // setzt /api/memorial anhand des aufgelösten Codes; der echte Buch-Code
  // erreicht diesen Browser nie.
  const isGuest = memorial?.guest === true
  const ct = contributorL10n(memorial?.product_category, L, isGuest)
  // Selbst-Erzähler (Lebenswerk, Anamnese): Die Person IST die Hauptperson — keine
  // Beziehungsangabe, die Beziehung wird intern fest gesetzt (Spalte ist NOT NULL).
  // Lifework-spezifische Extras (Einstellungen-Tab, Probedruck) hängen dagegen
  // an isLifework, nicht an isSelf. Das Lebenswerk-LOGO gilt für beide Zugänge —
  // dafür steht isLifeworkBook.
  const isSelf = (memorial?.product_category === 'lifework' && !isGuest) || isAnamnesisCategory(memorial?.product_category)
  const isLifeworkBook = memorial?.product_category === 'lifework'
  const isLifework = isLifeworkBook && !isGuest
  const isAnamnesis = isAnamnesisCategory(memorial?.product_category)
  const SELF_REL = 'Ich selbst'
  // Im Interview steckt das ☰-Menü (mit Datenschutz/Impressum) — dort wird der
  // globale Footer ausgeblendet. In den übrigen Schritten (Info/Fertig) bleibt er.
  useEffect(() => { setHideFooter?.(view === 'interview'); return () => setHideFooter?.(false) }, [view])
  // Bildschirm im Interview wach halten (siehe useWakeLock).
  useWakeLock(view === 'interview')
  // Support-Formular mit dem aktuellen Kontext (Buch, Rolle, Ansicht, Sprache) öffnen.
  const openSupportHere = (extra = {}) => openSupport({
    role: isSelf ? 'enduser' : 'contributor',
    code, category: memorial?.product_category, view, lang: L,
    suggestedName: contribForm?.name || undefined,
    // Ist beim Buch bereits eine Kontakt-E-Mail hinterlegt, das Support-Formular
    // damit vorbelegen (nicht erneut abfragen).
    suggestedEmail: memorial?.contact_email || memorial?.intake?.contact_email || undefined,
    ...extra,
  })
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
  // NUR wenn es den Probedruck-Tab überhaupt gibt (Endnutzer beim Lebenswerk mit
  // aktiviertem Probedruck). Für GÄSTE existiert er nicht — die landeten sonst auf
  // einem Tab ohne Inhalt und sahen eine komplett leere Seite mit ☰-Menü.
  useEffect(() => {
    const hasProof = isLifework && !isGuest && memorial?.proof_enabled === true
    if (memorial?.interview_closed && tab === 'interview' && hasProof) setTab('proof')
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
  const bannerLogo = memorial?.owner_logo || (isLifeworkBook ? '/lebenswerk-logo.png' : null)
  const resumeUrl = `${window.location.origin}/?code=${code}&session=${contribId}`

  function copyResumeUrl() {
    navigator.clipboard.writeText(resumeUrl)
    setCopied('link'); setTimeout(() => setCopied(''), 2000)
  }
  // Wiederaufnahme-Link per E-Mail — AUS DER APP verschicken (nicht die externe
  // Mail-App öffnen). Ist eine E-Mail-Adresse bekannt (Buch-Kontakt), direkt senden;
  // sonst nach der Adresse fragen und dann senden.
  const knownEmail = (memorial?.contact_email || memorial?.intake?.contact_email || '').trim()
  const [mail, setMail] = useState({ open: false, email: '', sending: false, sent: false, err: '' })
  async function sendResumeMail(addr) {
    const e = String(addr || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setMail(m => ({ ...m, open: true, err: t.mailInvalid || 'Bitte eine gültige E-Mail-Adresse angeben.' })); return }
    setMail(m => ({ ...m, sending: true, err: '' }))
    try {
      await sendResumeLink(code, contribId, e, {
        subject: t.mailSubject(ct.nounBook, memorial ? memorial.name : ''),
        body: t.mailBody(ct.nounBook, memorial ? memorial.name : '', resumeUrl),
      })
      setMail({ open: false, email: '', sending: false, sent: true, err: '' })
    } catch (err) {
      setMail(m => ({ ...m, sending: false, err: err.message || 'Senden fehlgeschlagen.' }))
    }
  }
  function startMailResume() {
    setMail({ open: false, email: knownEmail, sending: false, sent: false, err: '' })
    if (knownEmail) sendResumeMail(knownEmail)
    else setMail(m => ({ ...m, open: true }))
  }

  // Fortsetzen-Gate: EIN Tap auf „Fortsetzen" = Nutzer-Geste → schaltet die Tonausgabe
  // frei (sonst bleibt die erste Frage in der installierten App / auf iOS stumm) und
  // nimmt danach das Interview normal wieder auf.
  if (resumeGate && view !== 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', padding: '1.5rem', direction: isRTL(L) ? 'rtl' : 'ltr' }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>👋</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{t.resumeTitle || 'Willkommen zurück'}</h2>
          <p style={{ fontSize: 14, color: '#78716c', margin: '0 auto 22px', lineHeight: 1.6 }}>{t.resumeQ || 'Wir setzen dort fort, wo Sie aufgehört haben.'}</p>
          <button onClick={() => { unlockAudio(); const l = resumeGate; setResumeGate(null); resumeSession(l) }} style={{ fontSize: 15, padding: '13px 30px' }}>
            {t.resumeContinue || '↻ Fortsetzen'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Einführungs-Overlay beim ersten Öffnen (über allem, blockiert bis „Los geht’s"
          bzw. Überspringen). „Nicht mehr anzeigen" merkt sich das lokal (je Buch + global). */}
      {showOnboard && memorial && (
        <OnboardingCarousel memorial={memorial} lang={L} onClose={(dont) => {
          if (dont) { try { localStorage.setItem('lw_onboarded_' + code, '1'); localStorage.setItem('lw_onboarded_all', '1') } catch { /* privater Modus */ } }
          setShowOnboard(false)
        }} />
      )}
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
                    // Endnutzer-Kategorien (Lebenswerk, Anamnese): die Wahl festschreiben
                    // (Buch auf diese eine Sprache pinnen), damit die Sprachauswahl nicht
                    // bei jedem Start erneut erscheint – weder beim Login noch über den Code-Link.
                    // Gäste pinnen NICHTS: Ihre Sprachwahl gilt nur für sie, das
                    // Buch gehört dem Endnutzer (und /api/memorial würde den
                    // Gast-Code ohnehin nicht als Buch-Code akzeptieren).
                    if (!isGuest && (memorial?.product_category === 'lifework' || isAnamnesisCategory(memorial?.product_category)) && memorial?.id) {
                      pinMemorialLang(memorial.id, lc).catch(() => { /* nicht kritisch */ })
                    }
                  }} style={{ padding:'14px', fontSize:16 }}>{meta.label}</button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Hinweis VOR dem Browser-Dialog. Der „Verstanden"-Tap ist zugleich die
          Nutzer-Geste, die getUserMedia (und auf iOS die Audio-Freischaltung)
          braucht — deshalb löst erst dieser Klick den Berechtigungsdialog aus. */}
      {micPrime && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:80, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'#fff', borderRadius:16, padding:'22px 22px 18px', maxWidth:420, width:'100%', boxShadow:'0 4px 24px rgba(0,0,0,.25)' }}>
            <div style={{ fontSize:34, textAlign:'center', marginBottom:8 }}>🎙️</div>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:10, textAlign:'center' }}>
              {t.micPrimeTitle || 'Gleich fragt Ihr Browser nach dem Mikrofon'}
            </h2>
            <p style={{ fontSize:14, lineHeight:1.65, color:'#57534e', margin:'0 0 18px' }}>
              {t.micPrimeBody || 'Das Interview wird gesprochen — dafür braucht die App Zugriff auf Ihr Mikrofon. Bitte tippen Sie im nächsten Fenster auf „Zulassen“.'}
            </p>
            <button onClick={() => { setMicPrime(false); beginInterview() }} style={{ width:'100%', fontSize:15, padding:'13px 20px' }}>
              {t.micPrimeOk || 'Verstanden – weiter'}
            </button>
            <button onClick={() => { setMicPrime(false); beginInterview(false) }} className="ghost"
              style={{ width:'100%', fontSize:13, padding:'10px 16px', marginTop:6, color:'#78716c' }}>
              {t.micPrimeLater || 'Später entscheiden'}
            </button>
          </div>
        </div>
      )}

      {!needLang && view === 'info' && (
        <>
          <PartnerBanner logoUrl={memorial?.owner_logo} category={memorial?.product_category} />
          <div style={{ ...S.page, paddingTop:'2rem' }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{ct.heading}</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
            {ct.introNoun} <strong>{memorial?.name}</strong>
          </p>
          {/* Die Einordnung für Gäste („worum es geht") steht bewusst NICHT hier,
              sondern wird von der KI zu Beginn des Interviews gesprochen — siehe
              guestGreetingRule in src/categories.js. Im Sprachmodus liest ohnehin
              kaum jemand einen Kasten, bevor er auf das Mikrofon tippt. */}
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
          {/* Einwilligung: Liegt sie bereits vor (frühere Sitzung im selben Browser
              oder aus der gespeicherten Antwort), wird sie NICHT erneut abgefragt —
              nur ein kurzer Hinweis. Sie deckt die Verarbeitung, nicht die einzelne
              Sitzung, gilt also auch für einen Neubeginn. Sonst der Zustimmungshaken. */}
          {consentAt ? (
            <div style={{ ...S.card, background:'#f0fdf4', borderColor:'#bbf7d0', marginBottom:18, fontSize:13, color:'#3f6212', lineHeight:1.6 }}>
              ✓ {t.consentAlready || 'Ihre Datenschutz-Einwilligung liegt bereits vor.'}{' '}
              <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={{ color:'#3f6212', textDecoration:'underline' }}>{t.consentLink}</a>
            </div>
          ) : (
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
          )}
          <button disabled={(askName && !contribForm.name)||(askGender && !contribForm.gender)||(!isSelf && !contribForm.relationship)||(askAddress && !contribForm.address)||!consentChecked} onClick={startInterview} style={{ width:'100%', padding:13, fontSize:15 }}>
            {ct.interviewButton}
          </button>
          <div style={{ textAlign:'center', marginTop:14 }}>
            <button type="button" onClick={() => openSupportHere({ view: 'info' })}
              style={{ background:'none', border:'none', color:'#78716c', fontSize:13, cursor:'pointer', textDecoration:'underline' }}>
              {t.supportButton || 'Support kontaktieren'}
            </button>
          </div>
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
        // Der Einstellungs-Tab gehört JEDEM Lebenswerk-Endnutzer — auch dem, der
        // ohne Login über den Code-Link kommt (E-Mail ist optional). Die Änderung
        // läuft dann code-basiert (updateOwnMemorial ohne Token; Server erlaubt das
        // nur beim Lebenswerk).
        // Einstellungen (Grafik-/Textstil) und Probedruck gibt es nur beim
        // Lebenswerk — die Anamnese hat kein Buch und keine Bilder.
        const withSettings = isLifework
        // Nach Abschluss des Buchs kein Foto-Upload mehr.
        const withPhoto    = memorial.photo_upload_tab === true && !memorial.book_finalized
        const withProof    = isLifework && memorial.proof_enabled === true
        // Anamnese: eigener Tab, in dem der Patient den Bogen prüft/bestätigt (Step 2).
        const withBogen    = isAnamnesis
        // Sicherheitsnetz: Zeigt `tab` auf einen Tab, den es in dieser Rolle gar
        // nicht gibt (z. B. ein Gast auf 'proof'), wäre die Seite vollständig leer —
        // nur das ☰-Menü stünde da. Dann auf das Interview zurückfallen.
        const tabOk = tab === 'interview'
          || (tab === 'photo' && withPhoto) || (tab === 'proof' && withProof)
          || (tab === 'bogen' && withBogen) || (tab === 'settings' && withSettings)
        const cur = tabOk ? tab : 'interview'
        // Das ☰-Menü ist im Interview IMMER vorhanden — auch für Beitragende ohne
        // Foto-/Probedruck-Tab. „Später fortsetzen/beenden", der Transkript-Umschalter
        // und die Rechtslinks (Datenschutz/Impressum) liegen dort; der In-Interview-
        // Pause-Button entfällt deshalb.
        // Nach Start der Druckversion ODER Abschluss des Buchs ist das Interview
        // gesperrt — nur ein Hinweis.
        const vi = (memorial.interview_closed || memorial.book_finalized) ? (
          <div style={{ ...S.page, paddingTop:'2.5rem', textAlign:'center' }}>
            <div style={{ fontSize:34, marginBottom:8 }}>✅</div>
            {/* Gäste haben keinen Probedruck-Tab — für sie ist die Nachricht eine
                andere: Das Buch ist fertig, ihr Beitrag käme zu spät. Der alte Text
                verwies auf einen Tab, den sie gar nicht sehen. */}
            {isGuest ? (<>
              <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>
                {String(L || '').startsWith('en') ? 'This book is already finished' : 'Das Buch ist schon fertig'}
              </h2>
              <p style={{ ...S.muted, maxWidth:380, margin:'0 auto' }}>
                {String(L || '').startsWith('en')
                  ? 'Thank you for your interest! This book has already been completed, so no further contributions are possible. Please get in touch with the person who sent you the link.'
                  : 'Vielen Dank für Ihr Interesse! Dieses Buch wurde bereits abgeschlossen, deshalb sind keine weiteren Beiträge mehr möglich. Wenden Sie sich gerne an die Person, die Ihnen den Link geschickt hat.'}
              </p>
            </>) : (<>
              <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Interview abgeschlossen</h2>
              <p style={{ ...S.muted, maxWidth:360, margin:'0 auto' }}>Der Interview-Teil ist abgeschlossen. Deine vorläufige Druckversion findest du im Tab „{t.tabProof || 'Probedruck'}".</p>
            </>)}
          </div>
        ) : (
          // `active` ist hier doppelt belegt: Der offene Ton-/Mikrofontest legt das
          // Interview still wie ein Tab-Wechsel — keine Sprachausgabe, kein
          // automatisches Zuhören, laufende Aufnahme wird beendet. Sonst belegt das
          // Interview das Mikrofon und der Test misst nichts.
          <VoiceInterview
            memorial={memorial}
            contribForm={isSelf ? { ...contribForm, relationship: SELF_REL } : contribForm}
            lang={L}
            onSave={saveProgress}
            onPause={handlePause}
            hidePause={true}
            saveErr={saveErr}
            initialMessages={initialMessages}
            showTx={showTx}
            setShowTx={setShowTx}
            companionOn={companionOn}
            setCompanionOn={setCompanionOn}
            active={cur === 'interview' && !soundTest}
            onMemorialPatch={p => setMemorial(m => m ? { ...m, ...p } : m)}
            micMode={micMode}
            onSoundTest={() => setSoundTest(true)}
          />
        )
        // Das ☰-Menü ist immer vorhanden (auch ohne Foto-/Probedruck-Tab), damit
        // Beitragende Transkript, „Später fortsetzen/beenden" und die Rechtslinks
        // erreichen. Der fixierte ☰-Button (oben rechts) schwebt über der freien
        // rechten Ecke der Logo-Leiste — deshalb KEIN oberes Padding (kein grauer
        // Streifen über dem Logo).
        return (
          <div style={{ paddingBottom: 24 }}>
            <div style={{ display: cur === 'interview' ? 'block' : 'none' }}>{vi}</div>
            {withPhoto && (
              <div style={{ display: cur === 'photo' ? 'block' : 'none' }}>
                <div style={{ ...S.page, paddingTop:'2rem' }}>
                  {/* Anamnese: derselbe Upload, aber vollständig auf Dokumente umformuliert. */}
                  <ContributorPhotoUpload code={code} contribId={contribId} t={isAnamnesis ? { ...t, ...anamneseDocT(L) } : t} />
                </div>
              </div>
            )}
            {withProof && (
              <div style={{ display: cur === 'proof' ? 'block' : 'none' }}>
                <ProofTab code={code} token={endUserToken} memorial={memorial} contribId={contribId} lang={L} t={t}
                  onMemorialPatch={p => setMemorial(m => m ? { ...m, ...p } : m)} />
              </div>
            )}
            {withBogen && (
              <div style={{ display: cur === 'bogen' ? 'block' : 'none' }}>
                <AnamnesisReview code={code} token={endUserToken} memorial={memorial} contribId={contribId} lang={L}
                  onDone={() => setView('done')} />
              </div>
            )}
            {withSettings && (
              <div style={{ display: cur === 'settings' ? 'block' : 'none' }}>
                <EnduserSettings code={code} token={endUserToken} memorial={memorial} t={t} />
              </div>
            )}
            <ContribMenu tab={cur} setTab={setTab} t={t} lang={L} withPhoto={withPhoto} withSettings={withSettings} withProof={withProof} withBogen={withBogen} bogenLabel={anamneseT(L).tab}
              photoLabel={isAnamnesis ? anamneseDocT(L).tabPhoto : null} photoIcon={isAnamnesis ? '📄' : null}
              showTx={showTx}
              onToggleTx={memorial?.show_transcript !== false ? () => setShowTx(v => !v) : null}
              onPause={cur === 'interview' ? handlePause : null}
              onSupport={() => openSupportHere({ view: 'interview' })}
              onSwitchInterview={switchInterview}
              onMicMode={(memorial?.mic_mode_switch !== false && !companionOn) ? () => setMicModeOpen(true) : null}
              micModeLabel={String(L || '').startsWith('en') ? 'Microphone mode' : 'Mikrofon-Modus'}
              onSoundTest={() => setSoundTest(true)} />
            {soundTest && <SoundMicTest lang={L} onClose={() => setSoundTest(false)} />}
            {micModeOpen && (
              <MicModeChooser lang={L} memorial={memorial} micMode={micMode}
                onPick={m => { chooseMicMode(m); setMicModeOpen(false) }}
                onClose={() => setMicModeOpen(false)} />
            )}
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

      {/* Overlay: localStorage-Fortsetzung anbieten. Nur bei den GETEILTEN Büchern —
          das Lebenswerk setzt ohne Rückfrage fort (siehe Boot-Effekt oben).
          Fortsetzen ist der Normalfall und deshalb der einzige echte Knopf; der
          Wechsel auf einen neuen Beitrag ist ein kleiner Link daneben. Er löscht
          nichts (startFresh legt nur einen NEUEN Beitrag an) — der Hinweis darunter
          sagt das ausdrücklich, damit niemand Datenverlust befürchtet. */}
      {resumePrompt && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem' }}>
          <div style={{ ...S.card, maxWidth: 460, width:'100%' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>{t.resumeTitle}</h2>
            <p style={{ ...S.muted, marginBottom:18 }}>
              {t.resumeLast(new Date(resumePrompt.savedAt).toLocaleString(t.locale))}<br />
              {t.resumeQ}
            </p>
            <button onClick={resumeLocal} style={{ fontSize:15, padding:'12px 20px', width:'100%' }}>{t.resumeContinue}</button>
            <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid #e7e5e4', textAlign:'center' }}>
              <button className="ghost" onClick={startFresh} style={{ fontSize:13, color:'#78716c', textDecoration:'underline' }}>{t.resumeFresh}</button>
              <p style={{ ...S.muted, fontSize:12, margin:'4px 0 0' }}>{t.resumeKeep}</p>
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
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap', alignItems:'center' }}>
                <button className="secondary" onClick={copyResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>{copied === 'link' ? t.copied : t.copyLink}</button>
                {!mail.sent && (
                  <button className="secondary" onClick={startMailResume} disabled={mail.sending} style={{ fontSize:12, padding:'6px 12px', opacity: mail.sending ? 0.6 : 1 }}>
                    {mail.sending ? (t.loadingShort || 'Lädt …') : t.mailBtn}
                  </button>
                )}
                {mail.sent && <span style={{ fontSize:12.5, color:'#15803d', fontWeight:600 }}>{t.mailSent || '✓ E-Mail gesendet.'}</span>}
              </div>
              {mail.open && (
                <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap', alignItems:'center' }}>
                  <input type="email" inputMode="email" value={mail.email} autoFocus
                    onChange={e => setMail(m => ({ ...m, email: e.target.value, err: '' }))}
                    onKeyDown={e => { if (e.key === 'Enter') sendResumeMail(mail.email) }}
                    placeholder={t.mailAskLabel || 'Ihre E-Mail-Adresse'}
                    style={{ flex:'1 1 200px', minWidth:0, padding:'8px 10px', fontSize:13, border:'1px solid #d6d3d1', borderRadius:8 }} />
                  <button onClick={() => sendResumeMail(mail.email)} disabled={mail.sending} style={{ fontSize:12, padding:'8px 14px', opacity: mail.sending ? 0.6 : 1 }}>
                    {mail.sending ? (t.loadingShort || 'Lädt …') : (t.mailSend || 'Senden')}
                  </button>
                </div>
              )}
              {mail.err && <div style={{ fontSize:12.5, color:'#b91c1c', marginTop:6 }}>{mail.err}</div>}
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
