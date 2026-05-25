import { useState, useEffect, useRef } from 'react'
import {
  createMemorial, getMemorial, getContributions, addContribution,
  askClaude, speakText, stopSpeaking, adminDeleteMemorial,
} from './api.js'

// ── URL params ────────────────────────────────────────────────────
const urlParams    = new URLSearchParams(window.location.search)
const codeFromURL  = (urlParams.get('code') || '').toUpperCase().trim()

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

const GENDERS = [
  { value: 'männlich', label: 'Männlich' },
  { value: 'weiblich', label: 'Weiblich' },
  { value: 'divers',   label: 'Divers'   },
]

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
function interviewSystem(memorial, name, rel) {
  const g = memorial.gender ? ` (${memorial.gender})` : ''
  return `Du bist ein einfühlsamer Biograph. Du führst ein persönliches Gespräch mit ${name} (${rel}), der/die ${memorial.name}${g} kannte.

Ziel: Wertvolle persönliche Erinnerungen für ein Gedenkbuch sammeln.

Regeln:
- Stelle immer nur EINE Frage pro Nachricht, maximal 2 kurze Sätze
- Reagiere kurz und herzlich auf die vorherige Antwort (max. 1 Satz)
- Frage nach konkreten Erlebnissen und Geschichten, nicht Allgemeinem
- Sei einfühlsam, respektiere die Trauer
- Variiere: erste Begegnung, Charakterzüge, besondere Momente, Gewohnheiten, was die Person bedeutete
- Schreibe auf Deutsch`
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

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, onDone }) {
  const [messages,   setMessages]   = useState([])
  const [round,      setRound]      = useState(0)
  const [aiLoading,  setAiLoading]  = useState(false)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [isPlaying,  setIsPlaying]  = useState(false)
  // micState: idle | recording | processing
  const [micState,   setMicState]   = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [err,        setErr]        = useState('')
  const [saving,     setSaving]     = useState(false)
  const mediaRecRef  = useRef(null)
  const chunksRef    = useRef([])
  const endRef       = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, aiLoading])
  useEffect(() => { loadFirst() }, [])

  // Auto-Start: neue Frage sofort vorlesen
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && !aiLoading) playText(last.content)
  }, [messages, aiLoading])

  function playText(text) {
    stopSpeaking()
    setIsPlaying(true); setTtsLoading(true); setErr('')
    speakText(text, {
      onEnd:   () => { setIsPlaying(false); setTtsLoading(false) },
      onError: e  => { setErr(`TTS: ${e}`); setIsPlaying(false); setTtsLoading(false) },
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
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
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
    try {
      const sys   = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const reply = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs])
      setMessages([...newMsgs, { role: 'assistant', content: reply }])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  async function finish() {
    stopSpeaking()
    if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop()
    setSaving(true)
    try { await onDone(messages) } catch (e) { setErr(e.message); setSaving(false) }
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
        {round >= 5 && <button onClick={finish} disabled={saving || micState !== 'idle'} style={{ fontSize: 13, padding: '8px 16px' }}>{saving ? 'Wird gespeichert …' : '✓ Abschließen'}</button>}
      </div>
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <Err msg={err} />
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
                : isPlaying ? '⏹ Stoppen' : '🔊 Nochmal vorlesen'}
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
        {round >= 5 && !aiLoading && <p style={{ fontSize:12, color:'#78716c', textAlign:'center', marginTop:12 }}>Sie können noch mehr erzählen oder das Interview oben abschließen.</p>}
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

// ── Beitragenden-Flow (Aufruf per ?code=XXX) ──────────────────────
function ContributorFlow({ code }) {
  const [view, setView]           = useState('loading') // loading | info | interview | done | error
  const [memorial, setMemorial]   = useState(null)
  const [contribForm, setContribForm] = useState({ name:'', relationship:'' })
  const [mode, setMode]           = useState('text')
  const [err, setErr]             = useState('')
  const hasSTT = !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    getMemorial(code)
      .then(m => { setMemorial(m); setView('info') })
      .catch(e => { setErr(e.message); setView('error') })
  }, [code])

  async function handleDone(messages) {
    await addContribution({ memorialCode: code, contributorName: contribForm.name, relationship: contribForm.relationship, messages })
    setView('done')
  }

  if (view === 'loading') return (
    <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}><Dots /></div>
  )
  if (view === 'error') return (
    <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
      <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Gedenkbuch nicht gefunden</h2>
      <p style={S.muted}>{err}</p>
    </div>
  )
  if (view === 'info') return (
    <div style={{ ...S.page, paddingTop:'2rem' }}>
      <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Ihre Erinnerung</h2>
      <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
        Gedenkbuch für <strong>{memorial?.name}</strong>
      </p>
      <div style={{ marginBottom:14 }}><Lbl>Ihr Name *</Lbl><input value={contribForm.name} onChange={e=>setContribForm({...contribForm,name:e.target.value})} placeholder="Vollständiger Name" /></div>
      <div style={{ marginBottom:24 }}><Lbl>Ihre Beziehung zu {memorial?.name} *</Lbl><input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder="z.B. Tochter, Freund, Kollege, Nachbar …" /></div>
      <div style={S.divider} />
      <Lbl>Wie möchten Sie antworten?</Lbl>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:24 }}>
        {[{m:'text',icon:'⌨️',title:'Tippen',sub:'Antworten eintippen'},{m:'voice',icon:'🎙',title:'Sprechen',sub:hasSTT?'KI-Stimme + Mikrofon':'Nur Chrome / Edge'}].map(({m,icon,title,sub})=>(
          <div key={m} onClick={()=>setMode(m)} style={{ ...S.card, cursor:'pointer', textAlign:'center', padding:'1rem', borderColor:mode===m?'#1c1917':'#e7e5e4', borderWidth:mode===m?2:1 }}>
            <div style={{ fontSize:26, marginBottom:6 }}>{icon}</div>
            <div style={{ fontWeight:600, fontSize:14 }}>{title}</div>
            <div style={{ fontSize:12, color:'#78716c', marginTop:4 }}>{sub}</div>
          </div>
        ))}
      </div>
      <button disabled={!contribForm.name||!contribForm.relationship} onClick={()=>setView('interview')} style={{ width:'100%', padding:13, fontSize:15 }}>
        {mode==='voice'?'🎙 Sprach-Interview beginnen →':'Interview beginnen →'}
      </button>
    </div>
  )
  if (view === 'interview') {
    return mode === 'voice'
      ? <VoiceInterview memorial={memorial} contribForm={contribForm} onDone={handleDone} />
      : <TextInterview  memorial={memorial} contribForm={contribForm} onDone={handleDone} />
  }
  if (view === 'done') return (
    <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
      <div style={{ fontSize:40, marginBottom:'1rem' }}>🤍</div>
      <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>Herzlichen Dank</h2>
      <p style={{ ...S.muted, maxWidth:360, margin:'0 auto 2rem' }}>Ihre Erinnerungen sind jetzt Teil des gemeinsamen Gedenkbuchs und werden für immer bewahrt.</p>
    </div>
  )
  return null
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
  const [createForm, setCreateForm]   = useState({ name:'', organizer:'', gender:'' })
  const [createdCode, setCreatedCode] = useState('')
  const [bookText, setBookText]       = useState('')
  const [bookLoading, setBookLoading] = useState(false)
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

  function dlOne(c) {
    downloadFile(`${safeName(c.contributor_name)}_${safeName(selected.name)}.txt`, formatContribution(selected, c))
  }
  function dlAll() {
    const sep = '\n\n' + '═'.repeat(60) + '\n\n'
    const text = contributions.map(c => formatContribution(selected, c)).join(sep)
    downloadFile(`${safeName(selected.name)}_alle-Beitraege.txt`, text)
  }

  async function generateV2() {
    setBookText(''); setBookLoading(true); setView('book-v2')
    try {
      const text = await askClaude(synthesisSystem(selected, contributions), [{ role:'user', content:'Schreibe jetzt das Gedenkkapitel.' }])
      setBookText(text)
    } catch (e) { setBookText(`Fehler: ${e.message}`) }
    finally { setBookLoading(false) }
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
          <button onClick={() => { setCreateForm({ name:'', organizer:'', gender:'' }); setErr(''); setView('create') }} style={{ fontSize:14, padding:'9px 16px' }}>
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
                  {['Name', 'Organisator', 'Geschlecht', 'Code', 'Erstellt', ''].map(h => (
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
                    <td style={{ ...col, fontFamily: 'monospace', fontSize: 13, cursor:'pointer' }} onClick={() => openMemorial(m)}>{m.id}</td>
                    <td style={{ ...col, color: '#78716c', cursor:'pointer' }} onClick={() => openMemorial(m)}>{new Date(m.created_at).toLocaleDateString('de-DE')}</td>
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
          <Lbl>Ihr Name (Organisator) *</Lbl>
          <input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder="Ihr Name" />
        </div>
        <div style={{ marginBottom: 24 }}>
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
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Teilen Sie diesen Code oder Link mit Familie und Freunden:</p>
          <div style={{ ...S.card, marginBottom: '1rem' }}>
            <Lbl>Einladungscode</Lbl>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '.18em', fontFamily: 'monospace', margin: '8px 0' }}>{createdCode}</div>
          </div>
          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <Lbl>Einladungslink</Lbl>
            <div style={{ fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#44403c', margin:'6px 0 10px' }}>{inviteUrl}</div>
            <button className="secondary" onClick={() => copyInvite(createdCode)} style={{ fontSize: 13 }}>
              {copied === createdCode ? '✓ Kopiert' : '📋 Link kopieren'}
            </button>
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
            {' · Code: '}<span style={{ fontFamily: 'monospace' }}>{selected.id}</span>
          </p>

          <div style={{ ...S.card, marginBottom: '1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
            <div style={{ minWidth:0 }}>
              <Lbl>Einladungslink (für Beitragende)</Lbl>
              <div style={{ fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#44403c', marginTop:6 }}>{inviteUrl}</div>
            </div>
            <button className="secondary" onClick={() => copyInvite(selected.id)} style={{ fontSize:13, flexShrink:0 }}>
              {copied === selected.id ? '✓ Kopiert' : '📋 Kopieren'}
            </button>
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
                  <div key={i} style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
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
                    <button onClick={() => dlOne(c)} style={{ fontSize: 13, padding: '8px 16px', flexShrink: 0 }}>
                      ⬇ Herunterladen
                    </button>
                  </div>
                )
              })}
            </div>

            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch erstellen</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {[
                { icon:'📄', title:'Version 1 – Einzelne Beiträge', sub:'Jede Person als eigenes Kapitel.', action:() => setView('book-v1') },
                { icon:'✨', title:'Version 2 – Buch in einem Guss', sub:'KI webt alle Erinnerungen zu einem literarischen Text.', action: generateV2 },
              ].map(({ icon, title, sub, action }) => (
                <div key={title} style={{ ...S.card, cursor:'pointer' }} onClick={action}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div>
                      <div style={{ fontWeight:600, marginBottom:4 }}>{icon} {title}</div>
                      <p style={{ ...S.muted, fontSize:13, margin:0 }}>{sub}</p>
                    </div>
                    <span style={{ color:'#a8a29e', marginLeft:12 }}>→</span>
                  </div>
                </div>
              ))}
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

  // ── BUCH V1 ──
  if (view === 'book-v1') return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
      <Back onClick={() => setView('detail')} />
      <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
        <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>Gedenkbuch · Version 1</p>
        <h1 style={{ fontSize:30, fontWeight:700, fontFamily:'Georgia,serif' }}>{selected.name}</h1>
      </div>
      {contributions.map((c, i) => {
        const pairs = []
        for (let j = 0; j < c.messages.length; j++) {
          if (c.messages[j].role === 'assistant') {
            pairs.push({ q: c.messages[j].content, a: c.messages[j + 1]?.content })
            j++
          }
        }
        return (
          <div key={i} style={{ marginBottom:'3rem' }}>
            <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem' }}>
              <h2 style={{ fontSize:21, fontWeight:700, fontFamily:'Georgia,serif', marginBottom:2 }}>{c.contributor_name}</h2>
              <p style={{ fontSize:13, color:'#78716c', marginBottom:'1.5rem' }}>{c.relationship}</p>
              {pairs.filter(p => p.a).map((p, j) => (
                <div key={j} style={{ marginBottom:'1.5rem' }}>
                  <p style={{ fontSize:13, color:'#a8a29e', fontStyle:'italic', marginBottom:6 }}>{p.q}</p>
                  <p style={{ fontSize:16, lineHeight:1.85 }}>{p.a}</p>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )

  // ── BUCH V2 ──
  if (view === 'book-v2') return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
      <Back onClick={() => setView('detail')} />
      <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
        <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>Gedenkbuch · Version 2</p>
        <h1 style={{ fontSize:30, fontWeight:700, fontFamily:'Georgia,serif' }}>{selected.name}</h1>
      </div>
      <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem' }}>
        {bookLoading ? (
          <div style={{ textAlign:'center', padding:'3rem 0' }}>
            <Dots />
            <p style={{ ...S.muted, marginTop:16 }}>Die KI webt die Erinnerungen zusammen …</p>
          </div>
        ) : (
          <div style={{ fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
            {bookText.split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ marginBottom:'1.4rem' }}>{p}</p>)}
          </div>
        )}
      </div>
    </div>
  )

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
