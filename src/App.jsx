import { useState, useEffect, useRef } from 'react'
import { Document, Packer, Paragraph, HeadingLevel, AlignmentType } from 'docx'
import {
  createMemorial, getMemorial, getContributions, addContribution,
  askClaude, speakText, stopSpeaking, adminDeleteMemorial, adminSaveMemorialText,
} from './api.js'

// ── URL params ────────────────────────────────────────────────────
const urlParams     = new URLSearchParams(window.location.search)
const codeFromURL   = (urlParams.get('code') || '').toUpperCase().trim()
const sessionFromURL = (urlParams.get('session') || '').trim()

// ── Lokale Session-Persistenz (Option 1: localStorage) ────────────
const SESSION_TTL_DAYS = 60
function sessionKey(code) { return `lw_session_${code}` }
function saveLocalSession(code, data) {
  try { localStorage.setItem(sessionKey(code), JSON.stringify({ ...data, savedAt: Date.now() })) } catch {}
}
function loadLocalSession(code) {
  try {
    const raw = localStorage.getItem(sessionKey(code))
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s?.contribId || !s?.savedAt) return null
    const ageDays = (Date.now() - s.savedAt) / 86400000
    if (ageDays > SESSION_TTL_DAYS) { localStorage.removeItem(sessionKey(code)); return null }
    return s
  } catch { return null }
}
function clearLocalSession(code) {
  try { localStorage.removeItem(sessionKey(code)) } catch {}
}

// ── Hilfsfunktionen Download ──────────────────────────────────────
function formatContribution(memorial, c) {
  const lines = [
    `GEDENKBUCH: ${memorial.name}`,
    `Organisator: ${memorial.organizer}`,
    '',
    `Beitrag von: ${c.contributor_name}`,
    `Beziehung:   ${c.relationship}`,
    `Datum:       ${new Date(c.created_at).toLocaleDateString('de-DE')}`,
    '',
    '─'.repeat(50),
    '',
  ]
  for (let i = 0; i < c.messages.length; i++) {
    const m = c.messages[i]
    if (m.role === 'assistant') {
      lines.push(`Frage:   ${m.content}`)
    } else {
      lines.push(`Antwort: ${m.content}`, '')
    }
  }
  return lines.join('\n')
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function safeName(s) { return s.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim().replace(/\s+/g, '_') }

function renderRichText(text) {
  if (!text) return null
  return text.split('\n\n').map((chunk, i) => {
    const c = chunk.trim()
    if (!c) return null
    if (c.startsWith('## ')) return <h2 key={i} style={{ fontSize:22, fontWeight:700, fontFamily:'Georgia,serif', marginTop: i === 0 ? 0 : '2rem', marginBottom:'.75rem' }}>{c.slice(3)}</h2>
    if (c.startsWith('# '))  return <h1 key={i} style={{ fontSize:28, fontWeight:700, fontFamily:'Georgia,serif' }}>{c.slice(2)}</h1>
    return <p key={i} style={{ marginBottom:'1.4rem' }}>{c}</p>
  }).filter(Boolean)
}

async function downloadAsDocx(filename, title, text) {
  const children = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ]
  for (const raw of text.split('\n\n')) {
    const chunk = raw.trim()
    if (!chunk) continue
    if (chunk.startsWith('## ')) {
      children.push(new Paragraph({ text: chunk.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } }))
    } else if (chunk.startsWith('# ')) {
      children.push(new Paragraph({ text: chunk.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }))
    } else {
      children.push(new Paragraph({ text: chunk, spacing: { after: 200 } }))
    }
  }
  const doc = new Document({ creator: 'Lebenswerk', title, sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function genContribId() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 14 }, () => a[Math.floor(Math.random() * a.length)]).join('')
}

const GENDERS = [
  { value: 'männlich', label: 'Männlich' },
  { value: 'weiblich', label: 'Weiblich' },
  { value: 'divers',   label: 'Divers'   },
]

const BOOK_VARIANTS = [
  { value: 1, title: 'Variante 1', sub: 'Alle Beiträge werden als separate Buchkapitel veröffentlicht.' },
  { value: 2, title: 'Variante 2', sub: 'Die Biographie wird aus allen Inhalten neu erstellt; einzelne Beiträge sind nicht mehr erkennbar.' },
]

function qrCodeUrl(text, size = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(text)}`
}

function cutoffString(funeralDate) {
  if (!funeralDate) return '—'
  const d = new Date(funeralDate)
  d.setDate(d.getDate() - 7)
  return d.toLocaleDateString('de-DE')
}

// ── Stile ─────────────────────────────────────────────────────────
const S = {
  page:    { maxWidth: 600, margin: '0 auto', padding: '1.5rem' },
  card:    { background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.25rem' },
  muted:   { color: '#78716c', fontSize: 14, lineHeight: 1.65 },
  label:   { fontSize: 12, color: '#78716c', letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 },
  divider: { borderTop: '1px solid #e7e5e4', margin: '1.25rem 0' },
  err:     { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 },
}
const Lbl = ({ children }) => <span style={S.label}>{children}</span>
const Err = ({ msg }) => msg ? <div style={S.err}>⚠ {msg}</div> : null
function Back({ onClick }) {
  return <button className="ghost" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1.25rem', color: '#78716c', fontSize: 14 }}>← Zurück</button>
}
function Dots() {
  return <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>{[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#a8a29e', animation: 'lw-dot 1.2s ease-in-out infinite', animationDelay: `${i*.2}s` }} />)}</div>
}

// ── Claude-Prompts ────────────────────────────────────────────────
function interviewSystem(memorial, name, rel, address, contributorGender) {
  const g = memorial.gender ? ` (${memorial.gender})` : ''
  const addr = address === 'Du'
    ? 'Sprich die Person konsequent informell mit „du" an.'
    : 'Sprich die Person konsequent förmlich mit „Sie" an.'
  const gen = contributorGender
    ? `Die Person ist ${contributorGender} — verwende passende grammatische Formen (Adjektivendungen, Pronomen, ggf. „Herr"/„Frau").`
    : ''
  return `Du bist ein einfühlsamer Biograph. Du führst ein persönliches Gespräch mit ${name} (${rel}), der/die ${memorial.name}${g} kannte.

Ziel: Wertvolle persönliche Erinnerungen für ein Gedenkbuch sammeln.

Regeln:
- ${addr}${gen ? `\n- ${gen}` : ''}
- Stelle immer nur EINE Frage pro Nachricht, maximal 2 kurze Sätze
- Reagiere kurz und herzlich auf die vorherige Antwort (max. 1 Satz)
- Frage nach konkreten Erlebnissen und Geschichten, nicht Allgemeinem
- Sei einfühlsam, respektiere die Trauer
- Variiere: erste Begegnung, Charakterzüge, besondere Momente, Gewohnheiten, was die Person bedeutete
- Schreibe auf Deutsch`
}

function bookV1System(memorial, contributions) {
  const blocks = contributions.map(c => {
    const lines = c.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
    return `=== ${c.contributor_name} (${c.relationship}) ===\n${lines.join('\n')}`
  }).join('\n\n')
  const g = memorial.gender ? ` (${memorial.gender})` : ''
  return `Du bist ein einfühlsamer Buchautor. Du wandelst Interviews mit ${contributions.length} Menschen, die ${memorial.name}${g} kannten, in ein Gedenkbuch um.

Schreibe für JEDE der ${contributions.length} Personen ein eigenes Kapitel:
- Kapitelüberschrift exakt im Format: "## NAME (Beziehung)" auf einer eigenen Zeile
- Danach Fließtext in Ich-Form aus Sicht der jeweiligen Person ("Ich erinnere mich, dass …")
- Konkrete Geschichten und Details aus den Antworten beibehalten
- Pro Kapitel ca. 200–400 Wörter
- Warme, persönliche Sprache auf Deutsch
- Absätze durch eine Leerzeile trennen
- Beginne direkt mit dem ersten Kapitel; keine Einleitung, kein Vorwort, kein Titel über allem

Beiträge:\n\n${blocks}`
}

function synthesisSystem(memorial, contributions) {
  const blocks = contributions.map(c => {
    const lines = c.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
    return `=== ${c.contributor_name} (${c.relationship}) ===\n${lines.join('\n')}`
  }).join('\n\n')
  const g = memorial.gender ? ` (${memorial.gender})` : ''
  return `Du bist ein renommierter Buchautor und Biograph. Du hast Erinnerungen von ${contributions.length} Menschen gesammelt, die ${memorial.name}${g} kannten.

Schreibe ein zusammenhängendes Gedenkkapitel "in einem Guss" – wie ein Kapitel in einem hochwertigen Gedenkbuch.
- Warme, literarische Sprache auf Deutsch
- Alle Perspektiven harmonisch integrieren (kein "X sagte...")
- Lebendiges, mehrdimensionales Bild der Person zeichnen
- Konkrete Geschichten und Details einweben, 600–900 Wörter
- Direkt mit dem Fließtext beginnen, kein Titel

Beiträge:\n\n${blocks}`
}

function eulogySystem(memorial, contributions) {
  const blocks = contributions.map(c => {
    const lines = c.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
    return `=== ${c.contributor_name} (${c.relationship}) ===\n${lines.join('\n')}`
  }).join('\n\n')
  const g = memorial.gender ? ` (${memorial.gender})` : ''
  return `Du bist ein erfahrener Trauerredner. Verfasse eine persönliche, würdevolle Trauerrede über ${memorial.name}${g}, basierend auf den Erinnerungen von ${contributions.length} nahestehenden Menschen.

Die Rede wird laut auf einer Trauerfeier vorgelesen.

Anforderungen:
- Sprich die Trauergemeinde direkt an („Liebe Trauergemeinde, …")
- Würdevoll, warm, persönlich — kein religiöser Standardtext, sondern auf diesen konkreten Menschen zugeschnitten
- Webe konkrete Erinnerungen und Geschichten ein, ohne die Quellen einzeln zu nennen
- Zeichne ein vielschichtiges, lebensnahes Bild
- Struktur: Hinführung · Wer war ${memorial.name}? · Geschichten und Wesenszüge · Abschluss/Verabschiedung
- 400–700 Wörter, Absätze klar voneinander getrennt
- Ton: gesprochene Sprache, gut zum Vorlesen geeignet — kurze Sätze sind willkommen
- Direkt mit dem Redetext beginnen, kein Titel und keine Metakommentare

Beiträge:\n\n${blocks}`
}

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, onSave, onPause, saveErr, initialMessages = [] }) {
  const [messages,   setMessages]   = useState(initialMessages)
  const [round,      setRound]      = useState(initialMessages.filter(m => m.role === 'user').length)
  const [aiLoading,  setAiLoading]  = useState(false)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [isPlaying,  setIsPlaying]  = useState(false)
  // micState: idle | recording | processing
  const [micState,   setMicState]   = useState('idle')
  const [transcript, setTranscript] = useState('')
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
    if (last?.role === 'assistant' && !aiLoading) playText(last.content)
  }, [messages, aiLoading])

  function playText(text) {
    stopSpeaking()
    setIsPlaying(true); setTtsLoading(true); setErr('')
    speakText(text, {
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
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender)
      const q = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }])
      setMessages([{ role: 'assistant', content: q }])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  async function handleMic() {
    if (micState === 'processing') return

    if (micState === 'recording') {
      mediaRecRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec    = new MediaRecorder(stream)
      mediaRecRef.current = rec
      chunksRef.current   = []

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
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
            body:    JSON.stringify({ audio: base64, mimeType }),
          })
          const data = await resp.json()
          if (!resp.ok) throw new Error(data.error)
          const text = data.text || ''
          setTranscript(text)
          setMicState('idle')
          if (text.trim()) sendAnswer(text)
          return
        } catch (e) {
          setErr(`Transkription: ${e.message}`)
        } finally {
          setMicState('idle')
        }
      }

      rec.start()
      setMicState('recording')
      setTranscript('')
      setErr('')
    } catch (e) {
      setErr(`Mikrofon: ${e.message}`)
    }
  }

  async function sendAnswer(explicitText) {
    const text = (explicitText ?? transcript).trim(); if (!text) return
    setTranscript(''); stopSpeaking(); setIsPlaying(false)
    const newMsgs = [...messages, { role: 'user', content: text }]
    setMessages(newMsgs); setRound(r => r + 1); setAiLoading(true)
    // Antwort sofort persistieren (inkrementell), Fehler in saveErr-Prop
    onSave?.(newMsgs)
    try {
      const sys   = interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender)
      const reply = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs])
      const finalMsgs = [...newMsgs, { role: 'assistant', content: reply }]
      setMessages(finalMsgs)
      onSave?.(finalMsgs)
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  function pause() {
    stopSpeaking()
    if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop()
    onPause?.()
  }

  const latestQ = [...messages].reverse().find(m => m.role === 'assistant')?.content

  const micBg     = micState === 'recording' ? '#fee2e2' : '#f5f5f4'
  const micBorder = micState === 'recording' ? '2px solid #ef4444' : '1px solid #d6d3d1'
  const micAnim   = micState === 'recording' ? 'lw-mic 1.5s ease-in-out infinite' : 'none'
  const micIcon   = micState === 'processing' ? '⏳' : '🎙'
  const micLabel  = micState === 'recording'  ? 'Aufnahme läuft – erneut klicken zum Beenden'
                  : micState === 'processing' ? 'Wird transkribiert …'
                  : 'Mikrofon klicken, um zu antworten'

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship} · 🎙 Sprach-Modus</div>
        </div>
        <button onClick={pause} disabled={micState !== 'idle'} className="secondary" style={{ fontSize: 13, padding: '8px 16px' }}>Später fortsetzen oder beenden</button>
      </div>
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <Err msg={err} />
        {saveErr && <div style={{ ...S.err }}>⚠ Speichern: {saveErr}</div>}
        {memorial.funeral_date && (() => {
          const d = new Date(memorial.funeral_date)
          d.setDate(d.getDate() - 7)
          return (
            <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#78350f', marginBottom:14, lineHeight:1.55 }}>
              ℹ Eingaben bis zum <strong>{d.toLocaleDateString('de-DE')}</strong> werden berücksichtigt.
            </div>
          )
        })()}
        {messages.slice(0, -1).map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: .6, background: m.role === 'user' ? '#e0f2fe' : '#f5f5f4' }}>{m.content}</div>
          </div>
        ))}
        {aiLoading && messages.length === 0 && <div style={{ margin: '1.5rem 0' }}><Dots /></div>}
        {latestQ && (
          <div style={{ ...S.card, marginBottom: '1rem', background: '#fafaf9', borderColor: '#d6d3d1' }}>
            <Lbl>Frage</Lbl>
            <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 1rem', color: '#292524' }}>{latestQ}</p>
            <button onClick={handleSpeak} disabled={ttsLoading || aiLoading} style={{ fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {ttsLoading
                ? <><span style={{ width:14,height:14,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'lw-spin .8s linear infinite' }} /> Lädt …</>
                : isPlaying ? '⏹ Stoppen' : hasPlayed ? '🔊 Nochmal vorlesen' : '🔊 Anhören'}
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
            <div style={{ fontSize:13, fontWeight:500, color: micState==='recording' ? '#dc2626' : '#78716c', marginBottom:4 }}>
              {micLabel}
            </div>
            {transcript && (
              <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 14px', marginTop:12, fontSize:14, lineHeight:1.6, textAlign:'left' }}>
                {transcript}
              </div>
            )}
          </div>
        )}
        {round >= 1 && !aiLoading && <p style={{ fontSize:12, color:'#78716c', textAlign:'center', marginTop:12 }}>Ihre Antworten werden automatisch gespeichert. Sie können beliebig lange erzählen oder oben „Später fortsetzen oder beenden" klicken.</p>}
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
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const q = await askClaude(sys, [{ role:'user', content:'[Interview beginnt]' }])
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
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const reply = await askClaude(sys, [{ role:'user', content:'[Interview beginnt]' }, ...newMsgs])
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
function ContributorFlow({ code }) {
  const [view, setView]                       = useState('loading') // loading | info | interview | done | error
  const [memorial, setMemorial]               = useState(null)
  const [contribForm, setContribForm]         = useState({ name:'', gender:'', relationship:'', address:'Sie' })
  const [err, setErr]                         = useState('')
  const [contribId, setContribId]             = useState(() => genContribId())
  const [initialMessages, setInitialMessages] = useState([])
  const [resumePrompt, setResumePrompt]       = useState(null)
  const [paused, setPaused]                   = useState(false)
  const [copied, setCopied]                   = useState('')
  const [saveErr, setSaveErr]                 = useState('')
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
      const all = await getContributions(memCode)
      return all.find(c => c.id === id) || null
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
    saveLocalSession(code, { contribId: contrib.id, contribForm: form })
  }

  async function resumeLocal() {
    if (!resumePrompt) return
    const local = resumePrompt
    setResumePrompt(null); setView('loading')
    const contrib = await fetchContribution(code, local.contribId)
    if (contrib) { restoreFrom(contrib); setView('interview') }
    else {
      setContribId(local.contribId)
      if (local.contribForm) setContribForm({ ...contribForm, ...local.contribForm })
      setView('info')
    }
  }

  function startFresh() {
    clearLocalSession(code)
    setResumePrompt(null)
    setContribId(genContribId())
    setInitialMessages([])
    setContribForm({ name:'', gender:'', relationship:'', address:'Sie' })
    setView('info')
  }

  function startInterview() {
    saveLocalSession(code, { contribId, contribForm })
    setView('interview')
  }

  function saveProgress(messages) {
    if (!messages || messages.length === 0) return
    saveLocalSession(code, { contribId, contribForm })
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
        })
        setSaveErr('')
      } catch (e) { setSaveErr(e.message) }
    })
  }

  function handlePause() { setPaused(true) }
  function handleResume() { setPaused(false) }
  function handleDone() {
    clearLocalSession(code)
    setPaused(false); setView('done')
  }

  const resumeUrl = `${window.location.origin}/?code=${code}&session=${contribId}`

  function copyResumeUrl() {
    navigator.clipboard.writeText(resumeUrl)
    setCopied('link'); setTimeout(() => setCopied(''), 2000)
  }
  function mailResumeUrl() {
    const subject = encodeURIComponent(`Mein Beitrag zum Gedenkbuch${memorial ? ' für ' + memorial.name : ''}`)
    const body = encodeURIComponent(
`Mit diesem persönlichen Link kann ich meinen Beitrag zum Gedenkbuch${memorial ? ' für ' + memorial.name : ''} später fortsetzen:

${resumeUrl}

(Bitte nicht weitergeben — der Link führt direkt zu meinem persönlichen Beitrag.)`)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <>
      {view === 'loading' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}><Dots /></div>
      )}

      {view === 'error' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Gedenkbuch nicht gefunden</h2>
          <p style={S.muted}>{err}</p>
        </div>
      )}

      {view === 'info' && (
        <div style={{ ...S.page, paddingTop:'2rem' }}>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Ihre Erinnerung</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
            Gedenkbuch für <strong>{memorial?.name}</strong>
          </p>
          <div style={{ marginBottom:14 }}><Lbl>Ihr Name *</Lbl><input value={contribForm.name} onChange={e=>setContribForm({...contribForm,name:e.target.value})} placeholder="Vollständiger Name" /></div>
          <div style={{ marginBottom:14 }}>
            <Lbl>Ihr Geschlecht *</Lbl>
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
                  {g.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:14 }}><Lbl>Ihre Beziehung zu {memorial?.name} *</Lbl><input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder="z.B. Tochter, Freund, Kollege, Nachbar …" /></div>
          <div style={{ marginBottom:24 }}>
            <Lbl>Wie möchten Sie angesprochen werden? *</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { v:'Du',  title:'Du',  sub:'Informell, vertraut' },
                { v:'Sie', title:'Sie', sub:'Förmlich, respektvoll' },
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
          <button disabled={!contribForm.name||!contribForm.gender||!contribForm.relationship||!contribForm.address} onClick={startInterview} style={{ width:'100%', padding:13, fontSize:15 }}>
            🎙 Sprach-Interview beginnen →
          </button>
        </div>
      )}

      {view === 'interview' && memorial && (
        <VoiceInterview
          memorial={memorial}
          contribForm={contribForm}
          onSave={saveProgress}
          onPause={handlePause}
          saveErr={saveErr}
          initialMessages={initialMessages}
        />
      )}

      {view === 'done' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>🤍</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>Herzlichen Dank</h2>
          <p style={{ ...S.muted, maxWidth:360, margin:'0 auto 2rem' }}>Ihre Erinnerungen sind jetzt Teil des gemeinsamen Gedenkbuchs und werden für immer bewahrt.</p>
        </div>
      )}

      {/* Overlay: localStorage-Fortsetzung anbieten */}
      {resumePrompt && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem' }}>
          <div style={{ ...S.card, maxWidth: 460, width:'100%' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Sie haben einen begonnenen Beitrag</h2>
            <p style={{ ...S.muted, marginBottom:18 }}>
              Letzte Aktivität: {new Date(resumePrompt.savedAt).toLocaleString('de-DE')}.<br />
              Möchten Sie dort fortfahren, wo Sie aufgehört haben, oder neu beginnen?
            </p>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <button onClick={resumeLocal} style={{ fontSize:14, padding:'10px 16px' }}>↻ Fortsetzen</button>
              <button className="secondary" onClick={startFresh} style={{ fontSize:14, padding:'10px 16px' }}>Neu beginnen</button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: Später fortsetzen oder beenden */}
      {paused && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
          <div style={{ ...S.card, maxWidth: 520, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Später fortsetzen oder jetzt beenden?</h2>
            <p style={{ ...S.muted, marginBottom:14 }}>
              Ihre bisherigen Antworten sind bereits gespeichert. Sie können später jederzeit zurückkommen — auf zwei Wegen:
            </p>
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', marginBottom:12, fontSize:13, lineHeight:1.6 }}>
              <strong>1. Einfach denselben Einladungslink wieder öffnen.</strong><br />
              Ihr Browser merkt sich Ihre Session automatisch und bietet beim nächsten Aufruf an, dort weiterzumachen.
            </div>
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', marginBottom:14, fontSize:13, lineHeight:1.6 }}>
              <strong>2. Optional:</strong> Sichern Sie sich zusätzlich diesen persönlichen Wiederaufnahme-Link — falls Sie das Gerät wechseln oder Browser-Daten gelöscht werden:
              <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:8, padding:'8px 10px', marginTop:10, fontFamily:'monospace', fontSize:12, wordBreak:'break-all', color:'#44403c' }}>{resumeUrl}</div>
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                <button className="secondary" onClick={copyResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>{copied === 'link' ? '✓ Kopiert' : '📋 Link kopieren'}</button>
                <button className="secondary" onClick={mailResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>✉ Per Mail schicken</button>
              </div>
            </div>
            <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:14, display:'flex', gap:10, flexWrap:'wrap', justifyContent:'space-between' }}>
              <button className="ghost" onClick={handleResume} style={{ fontSize:14 }}>← Weiter sprechen</button>
              <button onClick={handleDone} style={{ fontSize:14, padding:'10px 18px' }}>✓ Beitrag jetzt beenden</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Admin-Dashboard (Standard-Eingang der Seite) ──────────────────
function Dashboard() {
  const [view, setView]               = useState('login') // login|list|create|created|detail|book-v1|book-v2
  const [token, setToken]             = useState(() => sessionStorage.getItem('lw_admin_token') || '')
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [memorials, setMemorials]     = useState([])
  const [selected, setSelected]       = useState(null)
  const [contributions, setContribs]  = useState([])
  const [selectedContrib, setSelectedContrib] = useState(null)
  const [createForm, setCreateForm]   = useState({ name:'', organizer:'', gender:'', bookVariant: 1, funeralDate: '' })
  const [createdCode, setCreatedCode] = useState('')
  const [generating, setGenerating]   = useState({}) // { book_v1: true, ... }
  const [loading, setLoading]         = useState(false)
  const [busy, setBusy]               = useState(false)
  const [deletingId, setDeletingId]   = useState('')
  const [copied, setCopied]           = useState('')
  const [err, setErr]                 = useState('')

  useEffect(() => { if (token) loadMemorials(token) }, [])

  async function login(e) {
    e.preventDefault()
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      sessionStorage.setItem('lw_admin_token', d.token)
      setToken(d.token)
      await loadMemorials(d.token)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function loadMemorials(t) {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401) { logout(); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMemorials(d); setView('list')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function openMemorial(memorial) {
    setSelected(memorial); setLoading(true); setErr('')
    try {
      const res = await fetch(`/api/admin/contributions?code=${memorial.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 401) { logout(); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setContribs(d); setView('detail')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function reloadContributions() {
    if (!selected) return
    setLoading(true); setErr('')
    try {
      const res = await fetch(`/api/admin/contributions?code=${selected.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 401) { logout(); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setContribs(d)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function logout() {
    sessionStorage.removeItem('lw_admin_token')
    setToken(''); setView('login'); setUsername(''); setPassword('')
    setMemorials([]); setContribs([]); setSelected(null)
  }

  async function handleCreate() {
    setErr(''); setBusy(true)
    try {
      const { code } = await createMemorial({
        name: createForm.name.trim(),
        organizer: createForm.organizer.trim(),
        gender: createForm.gender || null,
        bookVariant: createForm.bookVariant,
        funeralDate: createForm.funeralDate || null,
      })
      setCreatedCode(code)
      setView('created')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleDelete(m) {
    if (!window.confirm(`„${m.name}" wirklich löschen? Alle Beiträge gehen unwiderruflich verloren.`)) return false
    setDeletingId(m.id); setErr('')
    try {
      await adminDeleteMemorial(token, m.id)
      setMemorials(ms => ms.filter(x => x.id !== m.id))
      return true
    } catch (e) { setErr(e.message); return false }
    finally { setDeletingId('') }
  }

  function copyInvite(code) {
    const url = `${window.location.origin}/?code=${code}`
    navigator.clipboard.writeText(url)
    setCopied(code); setTimeout(() => setCopied(''), 2000)
  }

  async function copyQR(code) {
    const url = `${window.location.origin}/?code=${code}`
    setErr('')
    try {
      const resp = await fetch(qrCodeUrl(url, 320))
      const blob = await resp.blob()
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Bild-Kopieren wird in diesem Browser nicht unterstützt. Stattdessen Rechtsklick → Bild kopieren.')
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopied(`qr-${code}`); setTimeout(() => setCopied(''), 2000)
    } catch (e) {
      setErr(`QR kopieren: ${e.message}`)
    }
  }

  function dlOne(c) {
    downloadFile(`${safeName(c.contributor_name)}_${safeName(selected.name)}.txt`, formatContribution(selected, c))
  }
  function dlAll() {
    const sep = '\n\n' + '═'.repeat(60) + '\n\n'
    const text = contributions.map(c => formatContribution(selected, c)).join(sep)
    downloadFile(`${safeName(selected.name)}_alle-Beitraege.txt`, text)
  }

  const GENERATORS = {
    book_v1: { field: 'book_v1_text', view: 'book-v1', label: 'Version 1 – Einzelne Beiträge',  filename: 'Gedenkbuch_V1', system: bookV1System,    userPrompt: 'Schreibe jetzt das Gedenkbuch in Kapiteln.' },
    book_v2: { field: 'book_v2_text', view: 'book-v2', label: 'Version 2 – Buch in einem Guss', filename: 'Gedenkbuch_V2', system: synthesisSystem, userPrompt: 'Schreibe jetzt das Gedenkkapitel.' },
    eulogy:  { field: 'eulogy_text',  view: 'eulogy',  label: 'Trauerrede',                     filename: 'Trauerrede',    system: eulogySystem,    userPrompt: 'Schreibe jetzt die Trauerrede.' },
  }

  async function generate(key) {
    const gen = GENERATORS[key]
    if (!gen || !selected) return
    if (selected[gen.field] && !window.confirm(`„${gen.label}" wurde bereits generiert. Vorhandene Version überschreiben?`)) return
    setErr(''); setGenerating(g => ({ ...g, [key]: true })); setView(gen.view)
    try {
      const text = await askClaude(gen.system(selected, contributions), [{ role:'user', content: gen.userPrompt }])
      await adminSaveMemorialText(token, selected.id, gen.field, text)
      setSelected(s => ({ ...s, [gen.field]: text }))
      setMemorials(ms => ms.map(m => m.id === selected.id ? { ...m, [gen.field]: text } : m))
    } catch (e) { setErr(`Generieren fehlgeschlagen: ${e.message}`) }
    finally { setGenerating(g => ({ ...g, [key]: false })) }
  }

  async function downloadGenerated(key) {
    const gen = GENERATORS[key]
    const text = selected?.[gen.field]
    if (!text) return
    try {
      await downloadAsDocx(`${gen.filename}_${safeName(selected.name)}.docx`, `${gen.label} – ${selected.name}`, text)
    } catch (e) { setErr(`Download fehlgeschlagen: ${e.message}`) }
  }

  const col = { padding: '11px 14px', textAlign: 'left', borderBottom: '1px solid #e7e5e4', fontSize: 14 }
  const th  = { ...col, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#78716c', background: '#fafaf9' }

  // ── LOGIN ──
  if (view === 'login') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
      <form onSubmit={login} style={{ width: '100%', maxWidth: 360, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Lebenswerk Admin</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Bitte melden Sie sich an.</p>
        <Err msg={err} />
        <div style={{ marginBottom: 12 }}>
          <Lbl>Benutzername</Lbl>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoFocus />
        </div>
        <div style={{ marginBottom: 20 }}>
          <Lbl>Passwort</Lbl>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••" />
        </div>
        <button type="submit" disabled={loading || !username || !password} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {loading ? 'Wird überprüft …' : 'Anmelden'}
        </button>
      </form>
    </div>
  )

  // ── LISTE ──
  if (view === 'list') return (
    <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <span style={{ fontSize: 13, color: '#78716c', marginLeft: 12 }}>{memorials.length} Gedenkbücher</span>
        </div>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>

      <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Alle Gedenkbücher</h2>
          <button onClick={() => { setCreateForm({ name:'', organizer:'', gender:'', bookVariant: 1, funeralDate: '' }); setErr(''); setView('create') }} style={{ fontSize:14, padding:'9px 16px' }}>
            + Neues Gedenkbuch
          </button>
        </div>
        <Err msg={err} />
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : memorials.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
            <p style={S.muted}>Noch keine Gedenkbücher angelegt. Beginnen Sie mit „+ Neues Gedenkbuch".</p>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Organisator', 'Geschlecht', 'Variante', 'Erfassung bis', ''].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memorials.map(m => (
                  <tr key={m.id}
                    style={{ transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ ...col, fontWeight: 600, cursor:'pointer' }} onClick={() => openMemorial(m)}>{m.name}</td>
                    <td style={{ ...col, cursor:'pointer' }} onClick={() => openMemorial(m)}>{m.organizer}</td>
                    <td style={{ ...col, color:'#78716c', cursor:'pointer' }} onClick={() => openMemorial(m)}>{m.gender || '—'}</td>
                    <td style={{ ...col, color:'#78716c', cursor:'pointer' }} onClick={() => openMemorial(m)}>{m.book_variant ? `Variante ${m.book_variant}` : '—'}</td>
                    <td style={{ ...col, color: '#78716c', cursor:'pointer' }} onClick={() => openMemorial(m)}>{cutoffString(m.funeral_date)}</td>
                    <td style={{ ...col, textAlign:'right' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(m) }}
                        disabled={deletingId === m.id}
                        className="secondary"
                        style={{ fontSize:12, padding:'6px 12px', color:'#dc2626', borderColor:'#fecaca' }}
                        title="Gedenkbuch löschen"
                      >
                        {deletingId === m.id ? '…' : '🗑 Löschen'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )

  // ── NEUES GEDENKBUCH ──
  if (view === 'create') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Neues Gedenkbuch anlegen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Erstellen Sie ein Gedenkbuch und teilen Sie anschließend den Einladungslink.</p>
        <Err msg={err} />
        <div style={{ marginBottom: 14 }}>
          <Lbl>Name der verstorbenen Person *</Lbl>
          <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Vollständiger Name" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Lbl>Geschlecht der verstorbenen Person *</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            {GENDERS.map(g => (
              <div
                key={g.value}
                onClick={() => setCreateForm({ ...createForm, gender: g.value })}
                style={{
                  ...S.card,
                  cursor:'pointer',
                  textAlign:'center',
                  padding:'12px 8px',
                  borderColor: createForm.gender === g.value ? '#1c1917' : '#e7e5e4',
                  borderWidth: createForm.gender === g.value ? 2 : 1,
                  fontSize: 14,
                  fontWeight: createForm.gender === g.value ? 600 : 400,
                }}
              >
                {g.label}
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Lbl>Ihr Name (Organisator) *</Lbl>
          <input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder="Ihr Name" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Lbl>Geplantes Datum der Bestattung</Lbl>
          <input type="date" value={createForm.funeralDate} onChange={e => setCreateForm({ ...createForm, funeralDate: e.target.value })} />
          <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>Beiträge bis sieben Tage vor diesem Datum fließen in das Gedenkbuch ein.</p>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Buch-Variante *</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
            {BOOK_VARIANTS.map(v => (
              <div
                key={v.value}
                onClick={() => setCreateForm({ ...createForm, bookVariant: v.value })}
                style={{
                  ...S.card,
                  cursor:'pointer',
                  padding:'14px 14px',
                  borderColor: createForm.bookVariant === v.value ? '#1c1917' : '#e7e5e4',
                  borderWidth: createForm.bookVariant === v.value ? 2 : 1,
                }}
              >
                <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
              </div>
            ))}
          </div>
        </div>
        <button
          disabled={!createForm.name || !createForm.organizer || !createForm.gender || busy}
          onClick={handleCreate}
          style={{ width: '100%', padding: 13, fontSize: 15 }}
        >
          {busy ? 'Wird erstellt …' : 'Gedenkbuch anlegen →'}
        </button>
      </div>
    </div>
  )

  // ── GERADE ERSTELLT ──
  if (view === 'created') {
    const inviteUrl = `${window.location.origin}/?code=${createdCode}`
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
        </div>
        <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem', textAlign:'center' }}>
          <div style={{ fontSize: 40, marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Gedenkbuch erstellt</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Teilen Sie diesen Link oder den QR-Code mit Familie und Freunden:</p>
          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <Lbl>Einladungslink</Lbl>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', margin:'6px 0 10px', textDecoration:'underline' }}
            >{inviteUrl}</a>
            <button className="secondary" onClick={() => copyInvite(createdCode)} style={{ fontSize: 13 }}>
              {copied === createdCode ? '✓ Kopiert' : '📋 Link kopieren'}
            </button>
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <img
                src={qrCodeUrl(inviteUrl, 240)}
                alt={`QR-Code für ${inviteUrl}`}
                width={240}
                height={240}
                style={{ borderRadius:8, background:'#fff' }}
              />
              <button className="secondary" onClick={() => copyQR(createdCode)} style={{ fontSize: 13 }}>
                {copied === `qr-${createdCode}` ? '✓ QR kopiert' : '📋 QR-Code kopieren'}
              </button>
            </div>
          </div>
          <button onClick={() => loadMemorials(token)} style={{ padding: '11px 28px' }}>Zur Übersicht</button>
        </div>
      </div>
    )
  }

  // ── DETAIL ──
  if (view === 'detail') {
    const inviteUrl = `${window.location.origin}/?code=${selected.id}`
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize: 14, color: '#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="secondary" onClick={reloadContributions} disabled={loading} style={{ fontSize: 13, padding: '8px 14px' }}>
              {loading ? '…' : '↻ Aktualisieren'}
            </button>
            {contributions.length > 0 && (
              <button onClick={dlAll} style={{ fontSize: 13, padding: '8px 16px' }}>
                ⬇ Alle herunterladen ({contributions.length})
              </button>
            )}
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Beiträge</h2>
          <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1rem' }}>
            Organisator: {selected.organizer}
            {selected.gender ? ` · ${selected.gender}` : ''}
            {selected.book_variant ? ` · Buch-Variante ${selected.book_variant}` : ''}
            {selected.funeral_date ? ` · Bestattung: ${new Date(selected.funeral_date).toLocaleDateString('de-DE')}` : ''}
            {selected.funeral_date ? ` · Erfassung bis: ${cutoffString(selected.funeral_date)}` : ''}
          </p>

          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <Lbl>Einladungslink (für Beitragende)</Lbl>
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', marginTop:6, textDecoration:'underline' }}
                >{inviteUrl}</a>
              </div>
              <button className="secondary" onClick={() => copyInvite(selected.id)} style={{ fontSize:13, flexShrink:0 }}>
                {copied === selected.id ? '✓ Kopiert' : '📋 Kopieren'}
              </button>
            </div>
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <img
                src={qrCodeUrl(inviteUrl, 220)}
                alt={`QR-Code für ${inviteUrl}`}
                width={220}
                height={220}
                style={{ borderRadius:8, background:'#fff' }}
              />
              <button className="secondary" onClick={() => copyQR(selected.id)} style={{ fontSize: 13 }}>
                {copied === `qr-${selected.id}` ? '✓ QR kopiert' : '📋 QR-Code kopieren'}
              </button>
            </div>
          </div>

          <Err msg={err} />
          {loading ? (
            <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
          ) : contributions.length === 0 ? (
            <div style={{ ...S.card, textAlign:'center', padding:'1.5rem' }}>
              <p style={S.muted}>Noch keine Beiträge für dieses Gedenkbuch.</p>
            </div>
          ) : (<>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom:'1.5rem' }}>
              {contributions.map((c, i) => {
                const answerCount = c.messages.filter(m => m.role === 'user').length
                return (
                  <div
                    key={i}
                    onClick={() => { setSelectedContrib(c); setView('contribution') }}
                    style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor:'pointer', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: '#1d4ed8', flexShrink: 0 }}>
                        {c.contributor_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{c.contributor_name}</div>
                        <div style={{ fontSize: 13, color: '#78716c' }}>
                          {c.relationship} · {new Date(c.created_at).toLocaleDateString('de-DE')} · {answerCount} Antwort{answerCount !== 1 ? 'en' : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dlOne(c) }}
                      className="secondary"
                      style={{ fontSize: 13, padding: '8px 16px', flexShrink: 0 }}
                    >
                      ⬇ Herunterladen
                    </button>
                  </div>
                )
              })}
            </div>

            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch & Trauerrede</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {[
                { key:'book_v1', icon:'📄', title:'Version 1 – Einzelne Beiträge', sub:'Jede Person als eigenes Kapitel (Ich-Form, fließender Text).' },
                { key:'book_v2', icon:'✨', title:'Version 2 – Buch in einem Guss', sub:'KI webt alle Erinnerungen zu einem literarischen Text.' },
                { key:'eulogy',  icon:'🕯', title:'Trauerrede',                    sub:'KI verfasst eine persönliche Rede zum Vorlesen auf der Trauerfeier.' },
              ].map(({ key, icon, title, sub }) => {
                const gen   = GENERATORS[key]
                const has   = !!selected[gen.field]
                const busy  = !!generating[key]
                return (
                  <div key={key} style={{ ...S.card }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:600, marginBottom:4 }}>{icon} {title}</div>
                        <p style={{ ...S.muted, fontSize:13, margin:0 }}>{sub}</p>
                      </div>
                      {has && !busy && <span style={{ fontSize:11, color:'#16a34a', background:'#dcfce7', padding:'3px 8px', borderRadius:6, whiteSpace:'nowrap' }}>✓ Generiert</span>}
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button onClick={() => generate(key)} disabled={busy || contributions.length === 0} style={{ fontSize:13, padding:'8px 14px' }}>
                        {busy ? 'Wird generiert …' : has ? '↻ Neu generieren' : '✨ Generieren'}
                      </button>
                      <button onClick={() => setView(gen.view)} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        👁 Ansehen
                      </button>
                      <button onClick={() => downloadGenerated(key)} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        ⬇ Download .docx
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>)}

          <div style={S.divider} />
          <button
            onClick={async () => { if (await handleDelete(selected)) setView('list') }}
            disabled={deletingId === selected.id}
            className="secondary"
            style={{ fontSize:13, padding:'10px 18px', color:'#dc2626', borderColor:'#fecaca' }}
          >
            {deletingId === selected.id ? 'Wird gelöscht …' : '🗑 Dieses Gedenkbuch löschen'}
          </button>
        </div>
      </div>
    )
  }

  // ── EINZELNER BEITRAG ──
  if (view === 'contribution' && selectedContrib) {
    const c = selectedContrib
    const pairs = []
    for (let j = 0; j < c.messages.length; j++) {
      if (c.messages[j].role === 'assistant') {
        pairs.push({ q: c.messages[j].content, a: c.messages[j + 1]?.content })
        if (c.messages[j + 1]?.role === 'user') j++
      } else {
        pairs.push({ q: null, a: c.messages[j].content })
      }
    }
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('detail')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{c.contributor_name}</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => dlOne(c)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Herunterladen</button>
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
          </div>
        </div>

        <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
          <div style={{ ...S.card, marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
              <div style={{ width:48, height:48, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:18, color:'#1d4ed8' }}>
                {c.contributor_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:18 }}>{c.contributor_name}</div>
                <div style={{ fontSize:13, color:'#78716c' }}>{c.relationship}</div>
              </div>
            </div>
            <div style={{ fontSize:13, color:'#57534e', lineHeight:1.8 }}>
              {c.contributor_gender && <div><span style={{ color:'#a8a29e' }}>Geschlecht:</span> {c.contributor_gender}</div>}
              {c.contributor_address && <div><span style={{ color:'#a8a29e' }}>Anrede:</span> {c.contributor_address}</div>}
              <div><span style={{ color:'#a8a29e' }}>Erstellt:</span> {new Date(c.created_at).toLocaleString('de-DE')}</div>
              <div><span style={{ color:'#a8a29e' }}>Antworten:</span> {c.messages.filter(m => m.role === 'user').length}</div>
            </div>
          </div>

          {pairs.length === 0 ? (
            <p style={S.muted}>Dieser Beitrag enthält noch keine Inhalte.</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {pairs.map((p, j) => (
                <div key={j} style={{ ...S.card }}>
                  {p.q && (
                    <div style={{ marginBottom: p.a ? 12 : 0 }}>
                      <Lbl>Frage</Lbl>
                      <p style={{ fontSize:15, lineHeight:1.65, fontStyle:'italic', color:'#44403c', margin:'4px 0 0' }}>{p.q}</p>
                    </div>
                  )}
                  {p.a && (
                    <div>
                      <Lbl>Antwort</Lbl>
                      <p style={{ fontSize:15, lineHeight:1.7, color:'#1c1917', margin:'4px 0 0', whiteSpace:'pre-wrap' }}>{p.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── ANSEHEN (Bücher + Trauerrede) ──
  if (view === 'book-v1' || view === 'book-v2' || view === 'eulogy') {
    const key  = view === 'book-v1' ? 'book_v1' : view === 'book-v2' ? 'book_v2' : 'eulogy'
    const gen  = GENERATORS[key]
    const text = selected[gen.field]
    const busy = !!generating[key]
    const subtitle = view === 'book-v1' ? 'Gedenkbuch · Version 1'
                   : view === 'book-v2' ? 'Gedenkbuch · Version 2'
                   : 'Trauerrede'
    return (
      <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
        <Back onClick={() => setView('detail')} />
        <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
          <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>{subtitle}</p>
          <h1 style={{ fontSize:30, fontWeight:700, fontFamily:'Georgia,serif' }}>{selected.name}</h1>
        </div>
        <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem' }}>
          {busy ? (
            <div style={{ textAlign:'center', padding:'3rem 0' }}>
              <Dots />
              <p style={{ ...S.muted, marginTop:16 }}>Die KI arbeitet …</p>
            </div>
          ) : text ? (
            <div style={{ fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
              {renderRichText(text)}
            </div>
          ) : (
            <p style={{ ...S.muted, textAlign:'center', padding:'3rem 0' }}>Noch nichts generiert. Geh zurück und klicke „Generieren".</p>
          )}
          {!busy && text && (
            <div style={{ marginTop:'2rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4', display:'flex', gap:10, flexWrap:'wrap' }}>
              <button onClick={() => downloadGenerated(key)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Download .docx</button>
              <button className="secondary" onClick={() => generate(key)} style={{ fontSize:13, padding:'8px 16px' }}>↻ Neu generieren</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}

// ── Haupt-App ─────────────────────────────────────────────────────
export default function App() {
  return (
    <>
      <style>{`
        @keyframes lw-dot { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes lw-spin { to{transform:rotate(360deg)} }
        @keyframes lw-mic  { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
      `}</style>
      {codeFromURL ? <ContributorFlow code={codeFromURL} /> : <Dashboard />}
    </>
  )
}
