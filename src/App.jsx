import { useState, useEffect, useRef } from 'react'
import {
  createMemorial, getMemorial, getContributions, addContribution,
  askClaude, speakText, stopSpeaking,
} from './api.js'

// ── Claude-Prompts ────────────────────────────────────────────────
function interviewSystem(memorial, name, rel) {
  const years = memorial.birth_year ? ` (${memorial.birth_year}–${memorial.death_year || '†'})` : ''
  return `Du bist ein einfühlsamer Biograph. Du führst ein persönliches Gespräch mit ${name} (${rel}), der/die ${memorial.name}${years} kannte.

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
  const years = memorial.birth_year ? ` (${memorial.birth_year}–${memorial.death_year || '†'})` : ''
  const blocks = contributions.map(c => {
    const lines = c.messages.map(m => m.role === 'assistant' ? `F: ${m.content}` : `A: ${m.content}`)
    return `=== ${c.contributor_name} (${c.relationship}) ===\n${lines.join('\n')}`
  }).join('\n\n')
  return `Du bist ein renommierter Buchautor und Biograph. Du hast Erinnerungen von ${contributions.length} Menschen gesammelt, die ${memorial.name}${years} kannten.

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
  page:   { maxWidth: 600, margin: '0 auto', padding: '1.5rem' },
  card:   { background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.25rem' },
  muted:  { color: '#78716c', fontSize: 14, lineHeight: 1.65 },
  label:  { fontSize: 12, color: '#78716c', letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 },
  divider:{ borderTop: '1px solid #e7e5e4', margin: '1.25rem 0' },
  err:    { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 },
  info:   { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#2563eb', marginBottom: 12 },
}

const Lbl = ({ children }) => <span style={S.label}>{children}</span>
const Err = ({ msg }) => msg ? <div style={S.err}>⚠ {msg}</div> : null
const Info = ({ msg }) => msg ? <div style={S.info}>ℹ {msg}</div> : null

function Back({ onClick }) {
  return (
    <button className="ghost" onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1.25rem', color: '#78716c', fontSize: 14 }}>
      ← Zurück
    </button>
  )
}

function Dots() {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: '50%', background: '#a8a29e',
          animation: 'lw-dot 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  )
}

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, onDone }) {
  const [messages, setMessages] = useState([])
  const [round, setRound] = useState(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [micState, setMicState] = useState('idle')
  const [liveText, setLiveText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const recRef = useRef(null)
  const endRef = useRef(null)
  const hasSTT = !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, aiLoading])

  useEffect(() => { loadFirst() }, [])

  async function loadFirst() {
    setAiLoading(true)
    try {
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const q = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }])
      setMessages([{ role: 'assistant', content: q }])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  function handleSpeak() {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return
    if (isPlaying) { stopSpeaking(); setIsPlaying(false); return }
    speakText(last.content, {
      onStart: () => { setTtsLoading(true); setErr('') },
      onEnd: () => { setIsPlaying(false); setTtsLoading(false) },
      onError: (e) => { setErr(`TTS: ${e}`); setIsPlaying(false); setTtsLoading(false) },
    }).then(audio => { if (audio) { setTtsLoading(false); setIsPlaying(true) } })
  }

  function handleMic() {
    if (!hasSTT) { setErr('SpeechRecognition wird in diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.'); return }
    if (micState === 'recording') { recRef.current?.stop(); setMicState('idle'); setLiveText(''); return }
    setFinalText(''); setLiveText(''); setErr('')
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'de-DE'; rec.continuous = true; rec.interimResults = true
    recRef.current = rec
    let acc = ''
    rec.onresult = e => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) acc += e.results[i][0].transcript + ' '
        else interim += e.results[i][0].transcript
      }
      setFinalText(acc); setLiveText(interim)
    }
    rec.onerror = e => { setMicState('idle'); if (e.error !== 'no-speech') setErr(`Mikrofon-Fehler: ${e.error}`) }
    rec.onend = () => setMicState(s => s === 'recording' ? 'idle' : s)
    rec.start(); setMicState('recording')
  }

  async function sendAnswer() {
    const text = finalText.trim(); if (!text) return
    setFinalText(''); setLiveText(''); setMicState('idle')
    stopSpeaking(); setIsPlaying(false)
    const newMsgs = [...messages, { role: 'user', content: text }]
    setMessages(newMsgs); setRound(r => r + 1); setAiLoading(true)
    try {
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const reply = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs])
      setMessages([...newMsgs, { role: 'assistant', content: reply }])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  async function finish() {
    stopSpeaking(); recRef.current?.stop(); setSaving(true)
    try { await onDone(messages) }
    catch (e) { setErr(e.message); setSaving(false) }
  }

  const latestQ = [...messages].reverse().find(m => m.role === 'assistant')?.content

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship} · 🎙 Sprach-Modus</div>
        </div>
        {round >= 5 && (
          <button onClick={finish} disabled={saving || micState === 'recording'} style={{ fontSize: 13, padding: '8px 16px' }}>
            {saving ? 'Wird gespeichert …' : '✓ Abschließen'}
          </button>
        )}
      </div>

      <div style={{ padding: '1.25rem 1.5rem' }}>
        <Err msg={err} />

        {/* Bisherige Fragen / Antworten */}
        {messages.slice(0, -1).map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 10 }}>
            <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: 0.6, background: m.role === 'user' ? '#e0f2fe' : '#f5f5f4', color: '#1c1917' }}>
              {m.content}
            </div>
          </div>
        ))}

        {aiLoading && messages.length === 0 && <div style={{ margin: '1.5rem 0' }}><Dots /></div>}

        {/* Aktuelle Frage – prominent */}
        {latestQ && (
          <div style={{ ...S.card, marginBottom: '1rem', background: '#fafaf9', borderColor: '#d6d3d1' }}>
            <Lbl>Frage</Lbl>
            <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 1rem', color: '#292524' }}>{latestQ}</p>
            <button onClick={handleSpeak} disabled={ttsLoading || aiLoading} style={{ fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {ttsLoading
                ? <><span style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'lw-spin .8s linear infinite' }} /> Lädt …</>
                : isPlaying ? '⏹ Stoppen'
                : '🔊 Frage vorlesen'}
            </button>
          </div>
        )}

        {aiLoading && messages.length > 0 && <div style={{ margin: '0.75rem 0' }}><Dots /></div>}

        {/* Mikrofon-Bereich */}
        {!aiLoading && latestQ && (
          <div style={{ ...S.card, textAlign: 'center', padding: '1.5rem 1rem' }}>
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={handleMic}
                style={{
                  width: 72, height: 72, borderRadius: '50%', fontSize: 28,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: micState === 'recording' ? '#fee2e2' : '#f5f5f4',
                  border: micState === 'recording' ? '2px solid #ef4444' : '1px solid #d6d3d1',
                  color: '#1c1917',
                  animation: micState === 'recording' ? 'lw-mic 1.5s ease-in-out infinite' : 'none',
                  transition: 'all 0.2s',
                }}
                aria-label={micState === 'recording' ? 'Aufnahme stoppen' : 'Antwort sprechen'}
              >🎙</button>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: micState === 'recording' ? '#dc2626' : '#78716c', marginBottom: 4 }}>
              {micState === 'recording' ? 'Aufnahme läuft – erneut klicken zum Stoppen' : 'Mikrofon klicken, um zu antworten'}
            </div>

            {(finalText || liveText) && (
              <div style={{ background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 14, lineHeight: 1.6, textAlign: 'left' }}>
                {finalText}<span style={{ color: '#a8a29e', fontStyle: 'italic' }}>{liveText}</span>
              </div>
            )}

            {finalText && micState === 'idle' && (
              <button onClick={sendAnswer} style={{ marginTop: 14, width: '100%', padding: 12 }}>
                Antwort senden →
              </button>
            )}
          </div>
        )}

        {round >= 5 && !aiLoading && (
          <p style={{ fontSize: 12, color: '#78716c', textAlign: 'center', marginTop: 12 }}>
            Sie können noch mehr erzählen oder das Interview oben abschließen.
          </p>
        )}
        <div ref={endRef} /><div style={{ height: '2rem' }} />
      </div>
    </div>
  )
}

// ── Text-Interview ────────────────────────────────────────────────
function TextInterview({ memorial, contribForm, onDone }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [round, setRound] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { loadFirst() }, [])

  async function loadFirst() {
    setLoading(true)
    try {
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const q = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }])
      setMessages([{ role: 'assistant', content: q }])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim(); setInput('')
    const newMsgs = [...messages, { role: 'user', content: text }]
    setMessages(newMsgs); setRound(r => r + 1); setLoading(true)
    try {
      const sys = interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const reply = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs])
      setMessages([...newMsgs, { role: 'assistant', content: reply }])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function finish() {
    setSaving(true)
    try { await onDone(messages) }
    catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flexShrink: 0, borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
        </div>
        {round >= 5 && <button onClick={finish} disabled={saving} style={{ fontSize: 13, padding: '8px 16px' }}>{saving ? 'Wird gespeichert …' : '✓ Abschließen'}</button>}
      </div>
      {err && <div style={{ ...S.err, margin: '8px 1.5rem 0' }}>{err}</div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && loading && <Dots />}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
            <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, fontSize: 15, lineHeight: 1.65, background: m.role === 'user' ? '#dbeafe' : '#f5f5f4', color: '#1c1917', fontStyle: m.role === 'assistant' ? 'italic' : 'normal' }}>
              {m.content}
            </div>
          </div>
        ))}
        {messages.length > 0 && loading && <Dots />}
        <div ref={endRef} />
      </div>
      <div style={{ flexShrink: 0, borderTop: '1px solid #e7e5e4', padding: '12px 1.5rem', background: '#fff' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Schreiben Sie Ihre Erinnerung … (Enter zum Senden)"
            disabled={loading} rows={3} style={{ flex: 1, fontSize: 15 }} />
          <button onClick={send} disabled={loading || !input.trim()} style={{ padding: '10px 16px', flexShrink: 0 }}>➤</button>
        </div>
        {round >= 5 && <p style={{ fontSize: 12, color: '#78716c', marginTop: 8 }}>Sie können noch mehr erzählen oder das Interview oben abschließen.</p>}
      </div>
    </div>
  )
}

// ── Haupt-App ─────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('home')
  const [memorial, setMemorial] = useState(null)
  const [contributions, setContribs] = useState([])
  const [code, setCode] = useState('')
  const [createForm, setCreateForm] = useState({ name: '', birthYear: '', deathYear: '', organizer: '' })
  const [codeInput, setCodeInput] = useState('')
  const [contribForm, setContribForm] = useState({ name: '', relationship: '' })
  const [interviewMode, setInterviewMode] = useState('text')
  const [bookText, setBookText] = useState('')
  const [bookLoading, setBookLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasSTT = !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  function go(v) { setErr(''); setView(v) }

  async function handleCreate() {
    setErr(''); setBusy(true)
    try {
      const { code: newCode } = await createMemorial(createForm)
      setCode(newCode); go('created')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleEnterCode(mode) {
    setErr(''); setBusy(true)
    const c = codeInput.toUpperCase().replace(/\s/g, '')
    try {
      const m = await getMemorial(c)
      const contribs = await getContributions(c)
      setMemorial(m); setCode(c); setContribs(contribs)
      if (mode === 'contribute') { setContribForm({ name: '', relationship: '' }); go('contribute-info') }
      else go('dashboard')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function handleInterviewDone(messages) {
    await addContribution({
      memorialCode: code,
      contributorName: contribForm.name,
      relationship: contribForm.relationship,
      messages,
    })
    go('done')
  }

  async function reloadDashboard(c) {
    setErr(''); setBusy(true)
    const id = (c || code).toUpperCase().replace(/\s/g, '')
    try {
      const m = await getMemorial(id)
      const contribs = await getContributions(id)
      setMemorial(m); setCode(id); setContribs(contribs); go('dashboard')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function generateV2() {
    setBookText(''); setBookLoading(true); go('book-v2')
    try {
      const text = await askClaude(
        synthesisSystem(memorial, contributions),
        [{ role: 'user', content: 'Schreibe jetzt das Gedenkkapitel.' }]
      )
      setBookText(text)
    } catch (e) { setBookText(`Fehler: ${e.message}`) }
    finally { setBookLoading(false) }
  }

  function copyCode() { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  const pageStyle = { ...S.page, paddingTop: '2rem' }

  return (
    <>
      <style>{`
        @keyframes lw-dot { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes lw-spin { to{transform:rotate(360deg)} }
        @keyframes lw-mic  { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
      `}</style>

      {/* ── HOME ── */}
      {view === 'home' && (
        <div style={{ ...pageStyle, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Gemeinsames Gedenkbuch</h1>
          <p style={{ ...S.muted, maxWidth: 400, margin: '0 auto 2.5rem' }}>
            Familie, Freunde und Wegbegleiter erinnern sich gemeinsam – jede Geschichte ein Teil des Lebenswerks.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 300, margin: '0 auto' }}>
            <button onClick={() => go('create')} style={{ padding: '13px 0', fontSize: 15 }}>📖 Gedenkbuch erstellen</button>
            <button className="secondary" onClick={() => { setCodeInput(''); go('enter-code') }} style={{ padding: '13px 0', fontSize: 15 }}>🔑 Mit Einladungscode beitreten</button>
          </div>
        </div>
      )}

      {/* ── CREATE ── */}
      {view === 'create' && (
        <div style={pageStyle}>
          <Back onClick={() => go('home')} />
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Gedenkbuch anlegen</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Erstellen Sie ein Gedenkbuch und laden Sie Familie und Freunde ein.</p>
          <Err msg={err} />
          <div style={{ marginBottom: 14 }}><Lbl>Name der verstorbenen Person *</Lbl><input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Vollständiger Name" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div><Lbl>Geburtsjahr</Lbl><input value={createForm.birthYear} onChange={e => setCreateForm({ ...createForm, birthYear: e.target.value })} placeholder="z.B. 1942" /></div>
            <div><Lbl>Sterbejahr</Lbl><input value={createForm.deathYear} onChange={e => setCreateForm({ ...createForm, deathYear: e.target.value })} placeholder="z.B. 2024" /></div>
          </div>
          <div style={{ marginBottom: 24 }}><Lbl>Ihr Name (Organisator) *</Lbl><input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder="Ihr Name" /></div>
          <button disabled={!createForm.name || !createForm.organizer || busy} onClick={handleCreate} style={{ width: '100%', padding: 13, fontSize: 15 }}>
            {busy ? 'Wird erstellt …' : 'Gedenkbuch anlegen →'}
          </button>
        </div>
      )}

      {/* ── CREATED ── */}
      {view === 'created' && (
        <div style={{ ...pageStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Gedenkbuch erstellt</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Teilen Sie diesen Code mit Familie und Freunden:</p>
          <div style={{ ...S.card, display: 'inline-block', padding: '1.5rem 3rem', marginBottom: '1.5rem' }}>
            <Lbl>Einladungscode</Lbl>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '.18em', fontFamily: 'monospace', margin: '8px 0' }}>{code}</div>
            <button className="secondary" onClick={copyCode} style={{ fontSize: 13 }}>{copied ? '✓ Kopiert' : '📋 Code kopieren'}</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 260, margin: '0 auto' }}>
            <button onClick={() => reloadDashboard(code)}>🗂 Zum Dashboard</button>
            <button className="ghost" onClick={() => go('home')} style={{ fontSize: 14 }}>Zur Startseite</button>
          </div>
        </div>
      )}

      {/* ── ENTER CODE ── */}
      {view === 'enter-code' && (
        <div style={pageStyle}>
          <Back onClick={() => go('home')} />
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Code eingeben</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Geben Sie den Einladungscode ein, den Sie erhalten haben.</p>
          <Err msg={err} />
          <div style={{ marginBottom: 20 }}>
            <Lbl>Einladungscode</Lbl>
            <input value={codeInput} onChange={e => { setCodeInput(e.target.value.toUpperCase()); setErr('') }}
              placeholder="z.B. ABC123" maxLength={6}
              style={{ fontFamily: 'monospace', fontSize: 24, letterSpacing: '.15em', textAlign: 'center' }} />
          </div>
          <div style={S.divider} />
          <p style={{ ...S.muted, fontSize: 13, marginBottom: '0.75rem' }}>Was möchten Sie tun?</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button onClick={() => handleEnterCode('contribute')} disabled={codeInput.length < 4 || busy}>{busy ? '…' : '✏️ Erinnerung beitragen'}</button>
            <button className="secondary" onClick={() => handleEnterCode('dashboard')} disabled={codeInput.length < 4 || busy}>{busy ? '…' : '🗂 Dashboard'}</button>
          </div>
        </div>
      )}

      {/* ── CONTRIBUTE INFO ── */}
      {view === 'contribute-info' && (
        <div style={pageStyle}>
          <Back onClick={() => go('enter-code')} />
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Ihre Erinnerung</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
            Gedenkbuch für <strong>{memorial?.name}</strong>
            {memorial?.birth_year && <span style={{ color: '#78716c' }}> · {memorial.birth_year}–{memorial.death_year || '†'}</span>}
          </p>
          <div style={{ marginBottom: 14 }}><Lbl>Ihr Name *</Lbl><input value={contribForm.name} onChange={e => setContribForm({ ...contribForm, name: e.target.value })} placeholder="Vollständiger Name" /></div>
          <div style={{ marginBottom: 24 }}><Lbl>Ihre Beziehung zu {memorial?.name} *</Lbl><input value={contribForm.relationship} onChange={e => setContribForm({ ...contribForm, relationship: e.target.value })} placeholder="z.B. Tochter, Freund, Kollege, Nachbar …" /></div>
          <div style={S.divider} />
          <Lbl>Wie möchten Sie antworten?</Lbl>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
            {[
              { mode: 'text',  icon: '⌨️', title: 'Tippen',   sub: 'Antworten eintippen' },
              { mode: 'voice', icon: '🎙', title: 'Sprechen', sub: hasSTT ? 'KI-Stimme + Mikrofon' : 'Nur Chrome / Edge' },
            ].map(({ mode, icon, title, sub }) => (
              <div key={mode} onClick={() => setInterviewMode(mode)}
                style={{ ...S.card, cursor: 'pointer', textAlign: 'center', padding: '1rem', borderColor: interviewMode === mode ? '#1c1917' : '#e7e5e4', borderWidth: interviewMode === mode ? 2 : 1 }}>
                <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
                <div style={{ fontSize: 12, color: '#78716c', marginTop: 4 }}>{sub}</div>
              </div>
            ))}
          </div>
          <button disabled={!contribForm.name || !contribForm.relationship} onClick={() => go('interview')} style={{ width: '100%', padding: 13, fontSize: 15 }}>
            {interviewMode === 'voice' ? '🎙 Sprach-Interview beginnen →' : 'Interview beginnen →'}
          </button>
        </div>
      )}

      {/* ── INTERVIEW ── */}
      {view === 'interview' && (
        interviewMode === 'voice'
          ? <VoiceInterview memorial={memorial} contribForm={contribForm} onDone={handleInterviewDone} />
          : <TextInterview  memorial={memorial} contribForm={contribForm} onDone={handleInterviewDone} />
      )}

      {/* ── DONE ── */}
      {view === 'done' && (
        <div style={{ ...pageStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: '1rem' }}>🤍</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Herzlichen Dank</h2>
          <p style={{ ...S.muted, maxWidth: 360, margin: '0 auto 2rem' }}>
            Ihre Erinnerungen sind jetzt Teil des gemeinsamen Gedenkbuchs und werden für immer bewahrt.
          </p>
          <button onClick={() => go('home')} style={{ padding: '11px 28px' }}>Zur Startseite</button>
        </div>
      )}

      {/* ── DASHBOARD ── */}
      {view === 'dashboard' && (
        <div style={pageStyle}>
          <Back onClick={() => go('home')} />
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{memorial?.name}</h2>
          {memorial?.birth_year && <p style={{ ...S.muted, marginBottom: '1.25rem' }}>{memorial.birth_year} – {memorial.death_year || '†'}</p>}
          <Err msg={err} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1.25rem' }}>
            <div style={{ background: '#f5f5f4', borderRadius: 10, padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: 36, fontWeight: 700 }}>{contributions.length}</div>
              <div style={{ fontSize: 13, color: '#78716c' }}>Beiträge</div>
            </div>
            <div style={{ background: '#f5f5f4', borderRadius: 10, padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#78716c', marginBottom: 4 }}>Einladungscode</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 24, letterSpacing: '.12em' }}>{code}</div>
              <button className="ghost" onClick={copyCode} style={{ fontSize: 12, marginTop: 4 }}>{copied ? '✓ Kopiert' : '📋 Kopieren'}</button>
            </div>
          </div>
          <button className="secondary" onClick={() => reloadDashboard(code)} style={{ fontSize: 13, marginBottom: '1.25rem' }}>↻ Beiträge aktualisieren</button>

          {contributions.length > 0 ? (<>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: '0.75rem' }}>Eingegangene Beiträge</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.25rem' }}>
              {contributions.map((c, i) => (
                <div key={i} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: '#1d4ed8', flexShrink: 0 }}>
                    {c.contributor_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.contributor_name}</div>
                    <div style={{ fontSize: 12, color: '#78716c' }}>{c.relationship} · {new Date(c.created_at).toLocaleDateString('de-DE')}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={S.divider} />
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: '0.75rem' }}>Buch erstellen</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '📄', title: 'Version 1 – Einzelne Beiträge', sub: 'Jede Person als eigenes Kapitel – Fragen & Antworten im Dialog.', action: () => go('book-v1') },
                { icon: '✨', title: 'Version 2 – Buch in einem Guss', sub: 'KI webt alle Erinnerungen zu einem literarischen Gedenktext zusammen.', action: generateV2 },
              ].map(({ icon, title, sub, action }) => (
                <div key={title} style={{ ...S.card, cursor: 'pointer' }} onClick={action}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div><div style={{ fontWeight: 600, marginBottom: 4 }}>{icon} {title}</div><p style={{ ...S.muted, fontSize: 13, margin: 0 }}>{sub}</p></div>
                    <span style={{ color: '#a8a29e', marginLeft: 12 }}>→</span>
                  </div>
                </div>
              ))}
            </div>
          </>) : (
            <div style={{ ...S.card, textAlign: 'center', padding: '2rem' }}>
              <p style={{ ...S.muted }}>Noch keine Beiträge. Teilen Sie den Code, damit andere beitragen können.</p>
            </div>
          )}
        </div>
      )}

      {/* ── BUCH V1 ── */}
      {view === 'book-v1' && (
        <div style={{ ...S.page, padding: '1.5rem', maxWidth: 680, margin: '0 auto', paddingBottom: '4rem' }}>
          <Back onClick={() => go('dashboard')} />
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#a8a29e', marginBottom: 10 }}>Gedenkbuch · Version 1</p>
            <h1 style={{ fontSize: 30, fontWeight: 700, fontFamily: 'Georgia, serif' }}>{memorial?.name}</h1>
            {memorial?.birth_year && <p style={{ color: '#78716c', marginTop: 6 }}>{memorial.birth_year} – {memorial.death_year || '†'}</p>}
          </div>
          {contributions.map((c, i) => {
            const pairs = []
            for (let j = 0; j < c.messages.length; j++) {
              if (c.messages[j].role === 'assistant') { pairs.push({ q: c.messages[j].content, a: c.messages[j+1]?.content }); j++ }
            }
            return (
              <div key={i} style={{ marginBottom: '3rem' }}>
                <div style={{ borderTop: '1px solid #e7e5e4', paddingTop: '2rem' }}>
                  <h2 style={{ fontSize: 21, fontWeight: 700, fontFamily: 'Georgia, serif', marginBottom: 2 }}>{c.contributor_name}</h2>
                  <p style={{ fontSize: 13, color: '#78716c', marginBottom: '1.5rem' }}>{c.relationship}</p>
                  {pairs.filter(p => p.a).map((p, j) => (
                    <div key={j} style={{ marginBottom: '1.5rem' }}>
                      <p style={{ fontSize: 13, color: '#a8a29e', fontStyle: 'italic', marginBottom: 6 }}>{p.q}</p>
                      <p style={{ fontSize: 16, lineHeight: 1.85 }}>{p.a}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── BUCH V2 ── */}
      {view === 'book-v2' && (
        <div style={{ ...S.page, padding: '1.5rem', maxWidth: 680, margin: '0 auto', paddingBottom: '4rem' }}>
          <Back onClick={() => go('dashboard')} />
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <p style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#a8a29e', marginBottom: 10 }}>Gedenkbuch · Version 2</p>
            <h1 style={{ fontSize: 30, fontWeight: 700, fontFamily: 'Georgia, serif' }}>{memorial?.name}</h1>
            {memorial?.birth_year && <p style={{ color: '#78716c', marginTop: 6 }}>{memorial.birth_year} – {memorial.death_year || '†'}</p>}
          </div>
          <div style={{ borderTop: '1px solid #e7e5e4', paddingTop: '2rem' }}>
            {bookLoading ? (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <Dots />
                <p style={{ ...S.muted, marginTop: 16 }}>Die KI webt Ihre Erinnerungen zusammen …</p>
              </div>
            ) : (
              <div style={{ fontSize: 17, lineHeight: 1.9, fontFamily: 'Georgia, serif' }}>
                {bookText.split('\n\n').filter(Boolean).map((p, i) => <p key={i} style={{ marginBottom: '1.4rem' }}>{p}</p>)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
