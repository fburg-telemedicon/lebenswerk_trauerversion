import { useState, useEffect, useRef } from 'react'
import {
  createMemorial, getMemorial, getContributions, addContribution,
  askClaude, speakText, stopSpeaking,
} from './api.js'

// ── Routing ───────────────────────────────────────────────────────
const isDashboard = window.location.pathname.startsWith('/dashboard')

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

// ── Admin Dashboard ───────────────────────────────────────────────
function Dashboard() {
  const [view, setView]         = useState('login')
  const [token, setToken]       = useState(() => sessionStorage.getItem('lw_admin_token') || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [memorials, setMemorials]       = useState([])
  const [selected, setSelected]         = useState(null)
  const [contributions, setContribs]    = useState([])
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')

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
      const res = await fetch('/api/admin/memorials', {
        headers: { Authorization: `Bearer ${t}` },
      })
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
      const res = await fetch(`/api/admin/contributions?code=${memorial.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
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
  }

  function dlOne(c) {
    downloadFile(`${safeName(c.contributor_name)}_${safeName(selected.name)}.txt`, formatContribution(selected, c))
  }

  function dlAll() {
    const sep = '\n\n' + '═'.repeat(60) + '\n\n'
    const text = contributions.map(c => formatContribution(selected, c)).join(sep)
    downloadFile(`${safeName(selected.name)}_alle-Beitraege.txt`, text)
  }

  const col = { padding: '11px 14px', textAlign: 'left', borderBottom: '1px solid #e7e5e4', fontSize: 14 }
  const th  = { ...col, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#78716c', background: '#fafaf9' }

  // ── LOGIN ──
  if (view === 'login') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
      <form onSubmit={login} style={{ width: '100%', maxWidth: 360, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Lebenswerk Admin</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Bitte melden Sie sich an.</p>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 }}>⚠ {err}</div>}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#78716c', letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Benutzername</label>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoFocus />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: '#78716c', letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Passwort</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••" />
        </div>
        <button type="submit" disabled={loading || !username || !password} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {loading ? 'Wird überprüft …' : 'Anmelden'}
        </button>
      </form>
    </div>
  )

  // ── GEDENKBÜCHER-LISTE ──
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
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: '1.25rem' }}>Alle Gedenkbücher</h2>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>⚠ {err}</div>}
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : memorials.length === 0 ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Noch keine Gedenkbücher vorhanden.</p>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Organisator', 'Code', 'Erstellt'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memorials.map(m => (
                  <tr key={m.id} onClick={() => openMemorial(m)}
                    style={{ cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ ...col, fontWeight: 600 }}>{m.name}</td>
                    <td style={col}>{m.organizer}</td>
                    <td style={{ ...col, fontFamily: 'monospace', fontSize: 13 }}>{m.id}</td>
                    <td style={{ ...col, color: '#78716c' }}>{new Date(m.created_at).toLocaleDateString('de-DE')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )

  // ── BEITRÄGE-DETAIL ──
  if (view === 'detail') return (
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
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.25rem' }}>Organisator: {selected.organizer} · Code: <span style={{ fontFamily: 'monospace' }}>{selected.id}</span></p>
        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>⚠ {err}</div>}
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : contributions.length === 0 ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Noch keine Beiträge für dieses Gedenkbuch.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        )}
      </div>
    </div>
  )

  return null
}

// ── Claude-Prompts ────────────────────────────────────────────────
function interviewSystem(memorial, name, rel) {
  return `Du bist ein einfühlsamer Biograph. Du führst ein persönliches Gespräch mit ${name} (${rel}), der/die ${memorial.name} kannte.

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
  return `Du bist ein renommierter Buchautor und Biograph. Du hast Erinnerungen von ${contributions.length} Menschen gesammelt, die ${memorial.name} kannten.

Schreibe ein zusammenhängendes Gedenkkapitel "in einem Guss" – wie ein Kapitel in einem hochwertigen Gedenkbuch.
- Warme, literarische Sprache auf Deutsch
- Alle Perspektiven harmonisch integrieren (kein "X sagte...")
- Lebendiges, mehrdimensionales Bild der Person zeichnen
- Konkrete Geschichten und Details einweben, 600–900 Wörter
- Direkt mit dem Fließtext beginnen, kein Titel

Beiträge:\n\n${blocks}`
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
      // Aufnahme beenden → Whisper transkribieren
      mediaRecRef.current?.stop()
      return
    }

    // Aufnahme starten
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
          setTranscript(data.text || '')
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

  async function sendAnswer() {
    const text = transcript.trim(); if (!text) return
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
            {transcript && micState === 'idle' && (
              <button onClick={sendAnswer} style={{ marginTop:14, width:'100%', padding:12 }}>Antwort senden →</button>
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

// ── Haupt-App ─────────────────────────────────────────────────────
export default function App() {
  // Routing: /dashboard → Dashboard, alles andere → normale App
  if (isDashboard) return <Dashboard />

  const [view, setView]     = useState('home')
  const [memorial, setMemorial] = useState(null)
  const [contributions, setContribs] = useState([])
  const [code, setCode]     = useState('')
  const [createForm, setCreateForm] = useState({ name:'', organizer:'' })
  const [codeInput, setCodeInput]   = useState('')
  const [contribForm, setContribForm] = useState({ name:'', relationship:'' })
  const [interviewMode, setInterviewMode] = useState('text')
  const [bookText, setBookText]   = useState('')
  const [bookLoading, setBookLoading] = useState(false)
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasSTT = !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  function go(v) { setErr(''); setView(v) }

  async function handleCreate() {
    setErr(''); setBusy(true)
    try {
      const { code: c } = await createMemorial(createForm)
      setCode(c); go('created')
    } catch(e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleEnterCode(mode) {
    setErr(''); setBusy(true)
    const c = codeInput.toUpperCase().replace(/\s/g,'')
    try {
      const m = await getMemorial(c)
      const contribs = await getContributions(c)
      setMemorial(m); setCode(c); setContribs(contribs)
      if (mode==='contribute') { setContribForm({ name:'', relationship:'' }); go('contribute-info') }
      else go('dashboard-user')
    } catch(e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleInterviewDone(messages) {
    await addContribution({ memorialCode:code, contributorName:contribForm.name, relationship:contribForm.relationship, messages })
    go('done')
  }

  async function reloadDashboardUser(c) {
    setErr(''); setBusy(true)
    const id = (c||code).toUpperCase().replace(/\s/g,'')
    try {
      const m = await getMemorial(id)
      const contribs = await getContributions(id)
      setMemorial(m); setCode(id); setContribs(contribs); go('dashboard-user')
    } catch(e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function generateV2() {
    setBookText(''); setBookLoading(true); go('book-v2')
    try {
      const text = await askClaude(synthesisSystem(memorial, contributions), [{ role:'user', content:'Schreibe jetzt das Gedenkkapitel.' }])
      setBookText(text)
    } catch(e) { setBookText(`Fehler: ${e.message}`) }
    finally { setBookLoading(false) }
  }

  function copyCode() { navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),2000) }

  return (
    <>
      <style>{`
        @keyframes lw-dot { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes lw-spin { to{transform:rotate(360deg)} }
        @keyframes lw-mic  { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
      `}</style>

      {view==='home' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <h1 style={{ fontSize:28, fontWeight:700, marginBottom:8 }}>Gemeinsames Gedenkbuch</h1>
          <p style={{ ...S.muted, maxWidth:400, margin:'0 auto 2.5rem' }}>Familie, Freunde und Wegbegleiter erinnern sich gemeinsam – jede Geschichte ein Teil des Lebenswerks.</p>
          <div style={{ display:'flex', flexDirection:'column', gap:10, maxWidth:300, margin:'0 auto' }}>
            <button onClick={()=>go('create')} style={{ padding:'13px 0', fontSize:15 }}>📖 Gedenkbuch erstellen</button>
            <button className="secondary" onClick={()=>{setCodeInput('');go('enter-code')}} style={{ padding:'13px 0', fontSize:15 }}>🔑 Mit Einladungscode beitreten</button>
          </div>
        </div>
      )}

      {view==='create' && (
        <div style={{ ...S.page, paddingTop:'2rem' }}>
          <Back onClick={()=>go('home')} />
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Gedenkbuch anlegen</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>Erstellen Sie ein Gedenkbuch und laden Sie Familie und Freunde ein.</p>
          <Err msg={err} />
          <div style={{ marginBottom:14 }}><Lbl>Name der verstorbenen Person *</Lbl><input value={createForm.name} onChange={e=>setCreateForm({...createForm,name:e.target.value})} placeholder="Vollständiger Name" /></div>
          <div style={{ marginBottom:24 }}><Lbl>Ihr Name (Organisator) *</Lbl><input value={createForm.organizer} onChange={e=>setCreateForm({...createForm,organizer:e.target.value})} placeholder="Ihr Name" /></div>
          <button disabled={!createForm.name||!createForm.organizer||busy} onClick={handleCreate} style={{ width:'100%', padding:13, fontSize:15 }}>{busy?'Wird erstellt …':'Gedenkbuch anlegen →'}</button>
        </div>
      )}

      {view==='created' && (
        <div style={{ ...S.page, paddingTop:'2rem', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>✅</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Gedenkbuch erstellt</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>Teilen Sie diesen Code mit Familie und Freunden:</p>
          <div style={{ ...S.card, display:'inline-block', padding:'1.5rem 3rem', marginBottom:'1.5rem' }}>
            <Lbl>Einladungscode</Lbl>
            <div style={{ fontSize:38, fontWeight:700, letterSpacing:'.18em', fontFamily:'monospace', margin:'8px 0' }}>{code}</div>
            <button className="secondary" onClick={copyCode} style={{ fontSize:13 }}>{copied?'✓ Kopiert':'📋 Code kopieren'}</button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, maxWidth:260, margin:'0 auto' }}>
            <button onClick={()=>reloadDashboardUser(code)}>🗂 Zum Dashboard</button>
            <button className="ghost" onClick={()=>go('home')} style={{ fontSize:14 }}>Zur Startseite</button>
          </div>
        </div>
      )}

      {view==='enter-code' && (
        <div style={{ ...S.page, paddingTop:'2rem' }}>
          <Back onClick={()=>go('home')} />
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Code eingeben</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>Geben Sie den Einladungscode ein, den Sie erhalten haben.</p>
          <Err msg={err} />
          <div style={{ marginBottom:20 }}>
            <Lbl>Einladungscode</Lbl>
            <input value={codeInput} onChange={e=>{setCodeInput(e.target.value.toUpperCase());setErr('')}} placeholder="z.B. ABC123" maxLength={6} style={{ fontFamily:'monospace', fontSize:24, letterSpacing:'.15em', textAlign:'center' }} />
          </div>
          <div style={S.divider} />
          <p style={{ ...S.muted, fontSize:13, marginBottom:'.75rem' }}>Was möchten Sie tun?</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <button onClick={()=>handleEnterCode('contribute')} disabled={codeInput.length<4||busy}>{busy?'…':'✏️ Erinnerung beitragen'}</button>
            <button className="secondary" onClick={()=>handleEnterCode('dashboard')} disabled={codeInput.length<4||busy}>{busy?'…':'🗂 Dashboard'}</button>
          </div>
        </div>
      )}

      {view==='contribute-info' && (
        <div style={{ ...S.page, paddingTop:'2rem' }}>
          <Back onClick={()=>go('enter-code')} />
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Ihre Erinnerung</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
            Gedenkbuch für <strong>{memorial?.name}</strong>
          </p>
          <div style={{ marginBottom:14 }}><Lbl>Ihr Name *</Lbl><input value={contribForm.name} onChange={e=>setContribForm({...contribForm,name:e.target.value})} placeholder="Vollständiger Name" /></div>
          <div style={{ marginBottom:24 }}><Lbl>Ihre Beziehung zu {memorial?.name} *</Lbl><input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder="z.B. Tochter, Freund, Kollege, Nachbar …" /></div>
          <div style={S.divider} />
          <Lbl>Wie möchten Sie antworten?</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:24 }}>
            {[{mode:'text',icon:'⌨️',title:'Tippen',sub:'Antworten eintippen'},{mode:'voice',icon:'🎙',title:'Sprechen',sub:hasSTT?'KI-Stimme + Mikrofon':'Nur Chrome / Edge'}].map(({mode,icon,title,sub})=>(
              <div key={mode} onClick={()=>setInterviewMode(mode)} style={{ ...S.card, cursor:'pointer', textAlign:'center', padding:'1rem', borderColor:interviewMode===mode?'#1c1917':'#e7e5e4', borderWidth:interviewMode===mode?2:1 }}>
                <div style={{ fontSize:26, marginBottom:6 }}>{icon}</div>
                <div style={{ fontWeight:600, fontSize:14 }}>{title}</div>
                <div style={{ fontSize:12, color:'#78716c', marginTop:4 }}>{sub}</div>
              </div>
            ))}
          </div>
          <button disabled={!contribForm.name||!contribForm.relationship} onClick={()=>go('interview')} style={{ width:'100%', padding:13, fontSize:15 }}>
            {interviewMode==='voice'?'🎙 Sprach-Interview beginnen →':'Interview beginnen →'}
          </button>
        </div>
      )}

      {view==='interview' && (
        interviewMode==='voice'
          ? <VoiceInterview memorial={memorial} contribForm={contribForm} onDone={handleInterviewDone} />
          : <TextInterview  memorial={memorial} contribForm={contribForm} onDone={handleInterviewDone} />
      )}

      {view==='done' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>🤍</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>Herzlichen Dank</h2>
          <p style={{ ...S.muted, maxWidth:360, margin:'0 auto 2rem' }}>Ihre Erinnerungen sind jetzt Teil des gemeinsamen Gedenkbuchs und werden für immer bewahrt.</p>
          <button onClick={()=>go('home')} style={{ padding:'11px 28px' }}>Zur Startseite</button>
        </div>
      )}

      {view==='dashboard-user' && (
        <div style={{ ...S.page, paddingTop:'2rem' }}>
          <Back onClick={()=>go('home')} />
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:'1.25rem' }}>{memorial?.name}</h2>
          <Err msg={err} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:'1.25rem' }}>
            <div style={{ background:'#f5f5f4', borderRadius:10, padding:'1rem', textAlign:'center' }}>
              <div style={{ fontSize:36, fontWeight:700 }}>{contributions.length}</div>
              <div style={{ fontSize:13, color:'#78716c' }}>Beiträge</div>
            </div>
            <div style={{ background:'#f5f5f4', borderRadius:10, padding:'1rem', textAlign:'center' }}>
              <div style={{ fontSize:12, color:'#78716c', marginBottom:4 }}>Einladungscode</div>
              <div style={{ fontFamily:'monospace', fontWeight:700, fontSize:24, letterSpacing:'.12em' }}>{code}</div>
              <button className="ghost" onClick={copyCode} style={{ fontSize:12, marginTop:4 }}>{copied?'✓ Kopiert':'📋 Kopieren'}</button>
            </div>
          </div>
          <button className="secondary" onClick={()=>reloadDashboardUser(code)} style={{ fontSize:13, marginBottom:'1.25rem' }}>↻ Beiträge aktualisieren</button>
          {contributions.length>0?(<>
            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Eingegangene Beiträge</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:'1.25rem' }}>
              {contributions.map((c,i)=>(
                <div key={i} style={{ ...S.card, display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:38,height:38,borderRadius:'50%',background:'#dbeafe',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:15,color:'#1d4ed8',flexShrink:0 }}>{c.contributor_name.charAt(0).toUpperCase()}</div>
                  <div>
                    <div style={{ fontWeight:600 }}>{c.contributor_name}</div>
                    <div style={{ fontSize:12, color:'#78716c' }}>{c.relationship} · {new Date(c.created_at).toLocaleDateString('de-DE')}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={S.divider} />
            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch erstellen</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {[
                {icon:'📄',title:'Version 1 – Einzelne Beiträge',sub:'Jede Person als eigenes Kapitel.',action:()=>go('book-v1')},
                {icon:'✨',title:'Version 2 – Buch in einem Guss',sub:'KI webt alle Erinnerungen zu einem literarischen Text.',action:generateV2},
              ].map(({icon,title,sub,action})=>(
                <div key={title} style={{ ...S.card, cursor:'pointer' }} onClick={action}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div><div style={{ fontWeight:600, marginBottom:4 }}>{icon} {title}</div><p style={{ ...S.muted, fontSize:13, margin:0 }}>{sub}</p></div>
                    <span style={{ color:'#a8a29e', marginLeft:12 }}>→</span>
                  </div>
                </div>
              ))}
            </div>
          </>):(
            <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
              <p style={S.muted}>Noch keine Beiträge. Teilen Sie den Code, damit andere beitragen können.</p>
            </div>
          )}
        </div>
      )}

      {view==='book-v1' && (
        <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
          <Back onClick={()=>go('dashboard-user')} />
          <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
            <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>Gedenkbuch · Version 1</p>
            <h1 style={{ fontSize:30, fontWeight:700, fontFamily:'Georgia,serif' }}>{memorial?.name}</h1>
          </div>
          {contributions.map((c,i)=>{
            const pairs=[]
            for(let j=0;j<c.messages.length;j++){if(c.messages[j].role==='assistant'){pairs.push({q:c.messages[j].content,a:c.messages[j+1]?.content});j++}}
            return(
              <div key={i} style={{ marginBottom:'3rem' }}>
                <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem' }}>
                  <h2 style={{ fontSize:21, fontWeight:700, fontFamily:'Georgia,serif', marginBottom:2 }}>{c.contributor_name}</h2>
                  <p style={{ fontSize:13, color:'#78716c', marginBottom:'1.5rem' }}>{c.relationship}</p>
                  {pairs.filter(p=>p.a).map((p,j)=>(
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
      )}

      {view==='book-v2' && (
        <div style={{ maxWidth:680, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
          <Back onClick={()=>go('dashboard-user')} />
          <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
            <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>Gedenkbuch · Version 2</p>
            <h1 style={{ fontSize:30, fontWeight:700, fontFamily:'Georgia,serif' }}>{memorial?.name}</h1>
          </div>
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem' }}>
            {bookLoading?(
              <div style={{ textAlign:'center', padding:'3rem 0' }}>
                <Dots />
                <p style={{ ...S.muted, marginTop:16 }}>Die KI webt Ihre Erinnerungen zusammen …</p>
              </div>
            ):(
              <div style={{ fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
                {bookText.split('\n\n').filter(Boolean).map((p,i)=><p key={i} style={{ marginBottom:'1.4rem' }}>{p}</p>)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
