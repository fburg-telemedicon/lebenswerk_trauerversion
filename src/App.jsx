import { useState, useEffect, useRef } from 'react'
import { Document, Packer, Paragraph, HeadingLevel, AlignmentType, ImageRun, TextRun } from 'docx'
import jsPDF from 'jspdf'
import JSZip from 'jszip'
import {
  createMemorial, getMemorial, getContributions, addContribution,
  askClaude, speakText, stopSpeaking, primeAudio, adminDeleteMemorial, adminSaveMemorialText, adminGenerateImage,
  adminDeleteContribution, adminUpdateContributionMessages,
  getMemorialCosts,
  adminListUsers, adminCreateUser, adminUpdateUser, adminDeleteUser,
} from './api.js'
import { CATEGORIES, CATEGORY_ORDER, DEFAULT_CATEGORY, getCategory } from './categories.js'
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, langDirective, uiText, contributorL10n } from './i18n.js'

// ── URL params ────────────────────────────────────────────────────
const urlParams     = new URLSearchParams(window.location.search)
const codeFromURL   = (urlParams.get('code') || '').toUpperCase().trim()
const sessionFromURL = (urlParams.get('session') || '').trim()

// Versions-Tag des Einwilligungstextes. Bei JEDER inhaltlichen Änderung des
// Consent-/Datenschutztextes hochzählen, damit protokolliert ist, welcher
// Fassung zugestimmt wurde.
const CONSENT_VERSION = '1.1 (2026-06-17)'

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

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Wandelt den messages-Array eines Beitrags in Frage/Antwort-Paare um.
function contributionQAPairs(messages = []) {
  const pairs = []
  for (let j = 0; j < messages.length; j++) {
    if (messages[j].role === 'assistant') {
      const hasAnswer = messages[j + 1]?.role === 'user'
      pairs.push({ q: messages[j].content, a: hasAnswer ? messages[j + 1].content : null })
      if (hasAnswer) j++
    } else {
      pairs.push({ q: null, a: messages[j].content })
    }
  }
  return pairs
}

// Baut ein gut lesbares PDF mit den Daten EINES Beitragenden (DSGVO Art. 15).
// Gibt einen Blob zurück.
function buildContributionPdf(c, memorial) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 20
  const maxW = pageW - margin * 2
  let y = margin

  const lineHeight = size => size * 0.3528 * 1.32 // pt → mm, mit Zeilenabstand

  const ensure = h => { if (y + h > pageH - margin) { doc.addPage(); y = margin } }

  function write(text, { size = 11, style = 'normal', color = [40, 40, 40], indent = 0, gapAfter = 2 } = {}) {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
    const lh = lineHeight(size)
    const lines = doc.splitTextToSize(String(text ?? ''), maxW - indent)
    for (const line of lines) { ensure(lh); doc.text(line, margin + indent, y); y += lh }
    y += gapAfter
  }
  function rule() { ensure(4); doc.setDrawColor(210); doc.line(margin, y, pageW - margin, y); y += 5 }

  write('Datenauskunft', { size: 20, style: 'bold', color: [30, 30, 30], gapAfter: 1 })
  write('gemäß DSGVO Art. 15 (Auskunft) und Art. 20 (Datenübertragbarkeit)', { size: 10, color: [120, 120, 120], gapAfter: 3 })
  write(`Gedenkbuch: ${memorial.name}  (Code ${memorial.id})`, { size: 10, color: [90, 90, 90], gapAfter: 1 })
  write(`Erstellt am: ${new Date().toLocaleString('de-DE')}`, { size: 10, color: [90, 90, 90], gapAfter: 3 })
  rule()

  write('Angaben zur Person', { size: 14, style: 'bold', gapAfter: 2.5 })
  const fields = [
    ['Name', c.contributor_name],
    ['Beziehung zur verstorbenen Person', c.relationship],
    ['Geschlecht', c.contributor_gender],
    ['Anrede', c.contributor_address],
    ['Beitrag erstellt am', c.created_at ? new Date(c.created_at).toLocaleString('de-DE') : null],
  ]
  for (const [label, value] of fields) {
    if (!value) continue
    write(`${label}:`, { size: 10, style: 'bold', color: [110, 110, 110], gapAfter: 0.5 })
    write(String(value), { size: 11, indent: 2, gapAfter: 2 })
  }
  y += 2
  rule()

  write('Interview-Verlauf', { size: 14, style: 'bold', gapAfter: 3 })
  const pairs = contributionQAPairs(c.messages)
  if (pairs.length === 0) {
    write('Dieser Beitrag enthält keine Inhalte.', { size: 11, color: [120, 120, 120] })
  } else {
    pairs.forEach((p, i) => {
      if (p.q) write(`Frage ${i + 1}: ${p.q}`, { size: 11, style: 'bold', color: [60, 60, 60], gapAfter: 1 })
      write(p.a || '(keine Antwort)', { size: 11, indent: 3, gapAfter: 4 })
    })
  }

  return doc.output('blob')
}

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

function tryParseJSON(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  // Falls Claude doch noch Text drumherum schreibt: ersten { bis letzten } isolieren
  const first = s.indexOf('{')
  const last  = s.lastIndexOf('}')
  if (first > 0 || (first === 0 && last > 0 && last < s.length - 1)) s = s.slice(first, last + 1)
  try { return JSON.parse(s) } catch { return null }
}

async function fetchImageBuffer(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.arrayBuffer()
  } catch { return null }
}

async function downloadStructuredDocx(filename, book) {
  const children = []
  children.push(new Paragraph({
    children: [new TextRun({ text: book.title || '', size: 56, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }))
  if (book.subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: book.subtitle, size: 28, italics: true, color: '78716c' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
    }))
  }
  for (const ch of (book.chapters || [])) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `Kapitel ${ch.number}`, size: 20, color: 'a8a29e' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 100 },
    }))
    children.push(new Paragraph({
      text: ch.heading || '',
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }))
    if (ch.image_url) {
      const buf = await fetchImageBuffer(ch.image_url)
      if (buf) {
        children.push(new Paragraph({
          children: [new ImageRun({
            data: buf,
            transformation: { width: 560, height: 373 }, // 3:2 wie gpt-image-1 1536×1024, fits A4 minus Ränder
          })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }))
      }
    }
    for (const raw of String(ch.body || '').split('\n\n')) {
      const chunk = raw.trim()
      if (chunk) children.push(new Paragraph({ text: chunk, spacing: { after: 200 } }))
    }
  }
  const doc = new Document({ creator: 'Lebenswerk', title: book.title || '', sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
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

// Leeres Anlage-Formular (inkl. Produktkategorie + kategorieabhängige Felder).
const EMPTY_CREATE = {
  name: '', organizer: '', gender: '', bookVariant: 1,
  funeralDate: '', cutoffDays: 7, showIntroVideo: true,
  productCategory: DEFAULT_CATEGORY, intake: {},
  languages: [DEFAULT_LANGUAGE],
}

function qrCodeUrl(text, size = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(text)}`
}

function cutoffDays(memorial) {
  const n = parseInt(memorial?.cutoff_days, 10)
  return Number.isFinite(n) && n >= 0 ? n : 7
}

function cutoffDate(funeralDate, days) {
  if (!funeralDate) return null
  const d = new Date(funeralDate)
  d.setDate(d.getDate() - (Number.isFinite(days) ? days : 7))
  return d
}

function cutoffString(funeralDate, days = 7) {
  const d = cutoffDate(funeralDate, days)
  return d ? d.toLocaleDateString('de-DE') : '—'
}

function formatEur(n) {
  const v = Number(n || 0)
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

const COST_KIND_LABEL = {
  interview:  'Interview-Fragen (Claude)',
  reasoning:  'Sonstiges Claude-Reasoning',
  book_v1:    'Buch V1 – Generierung',
  book_v2:    'Buch V2 – Generierung',
  eulogy:     'Endtext (Rede) – Generierung',
  tts:        'Sprachausgabe (TTS)',
  stt:        'Spracherkennung (STT)',
  image:      'Bildgenerierung (DALL·E)',
}
function costKindLabel(k) { return COST_KIND_LABEL[k] || k || 'Sonstiges' }

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

// Partner-Banner (Bestattungsinstitut, fiktiv) — wird oben auf den
// Beitragenden-Seiten eingeblendet. Name + Monogramm zentral änderbar.
const PARTNER_NAME      = 'Bestattungshaus Linde'
const PARTNER_MONOGRAM  = 'L'
function PartnerBanner() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'10px 1.25rem', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{
          width:32, height:32, borderRadius:'50%',
          background:'#1c1917', color:'#fafaf9',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:'Georgia, serif', fontWeight:700, fontSize:15,
          flexShrink:0,
        }}>{PARTNER_MONOGRAM}</div>
        <div style={{ minWidth:0, lineHeight:1.3 }}>
          <div style={{ fontWeight:600, fontSize:14, color:'#1c1917', fontFamily:'Georgia, serif' }}>{PARTNER_NAME}</div>
          <div style={{ fontSize:10.5, color:'#78716c', textTransform:'uppercase', letterSpacing:'.09em', marginTop:2 }}>präsentiert Lebensgeschichten.AI</div>
        </div>
      </div>
    </div>
  )
}

// ── Claude-Prompts ────────────────────────────────────────────────
// Die kategoriespezifischen Prompt-Builder liegen in src/categories.js.
// Sie werden über GENERATORS (Admin) bzw. getCategory(...).interviewSystem
// (Contributor-Flow) angesprochen.

function unlockAudio() {
  // Bereitet das Audio-Element vor, das speakText() später wiederverwendet
  primeAudio()
}

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, lang = 'de', onSave, onPause, saveErr, initialMessages = [] }) {
  const t = uiText(lang)
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
      memorialCode: memorial?.id,
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
      const q = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }], { memorialCode: memorial?.id, kind: 'interview' })
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
      let recStartedAt = 0

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
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
            body:    JSON.stringify({ audio: base64, mimeType, audioSeconds, memorialCode: memorial?.id }),
          })
          const data = await resp.json()
          if (!resp.ok) throw new Error(data.error)
          const text = data.text || ''
          setTranscript(text)
          setMicState('idle')
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
    const newMsgs = [...messages, { role: 'user', content: text }]
    setMessages(newMsgs); setRound(r => r + 1); setAiLoading(true)
    // Antwort sofort persistieren (inkrementell), Fehler in saveErr-Prop
    onSave?.(newMsgs)
    try {
      const sys   = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const reply = await askClaude(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs], { memorialCode: memorial?.id, kind: 'interview' })
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
  const micLabel  = micState === 'recording'  ? t.micRecording
                  : micState === 'processing' ? t.micProcessing
                  : t.micIdle

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <PartnerBanner />
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship} · {t.modeVoice}</div>
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
        {messages.slice(0, -1).map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: .6, background: m.role === 'user' ? '#e0f2fe' : '#f5f5f4' }}>{m.content}</div>
          </div>
        ))}
        {aiLoading && messages.length === 0 && <div style={{ margin: '1.5rem 0' }}><Dots /></div>}
        {latestQ && (
          <div style={{ ...S.card, marginBottom: '1rem', background: '#fafaf9', borderColor: '#d6d3d1' }}>
            <Lbl>{t.questionLabel}</Lbl>
            <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 1rem', color: '#292524' }}>{latestQ}</p>
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
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship)
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
  const [consentChecked, setConsentChecked]   = useState(false)
  const [consentAt, setConsentAt]             = useState(null)
  const [initialMessages, setInitialMessages] = useState([])
  const [resumePrompt, setResumePrompt]       = useState(null)
  const [paused, setPaused]                   = useState(false)
  const [copied, setCopied]                   = useState('')
  const [saveErr, setSaveErr]                 = useState('')
  const [lang, setLang]                       = useState(null) // vom Beitragenden gewählte Sprache
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
    if (contrib.consent_at) { setConsentAt(contrib.consent_at); setConsentChecked(true) }
    saveLocalSession(code, { contribId: contrib.id, contribForm: form, consentAt: contrib.consent_at || null })
  }

  async function resumeLocal() {
    if (!resumePrompt) return
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
    setView(memorial?.show_intro_video !== false ? 'intro-video' : 'interview')
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
    clearLocalSession(code)
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
          <PartnerBanner />
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
          <PartnerBanner />
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
          <div style={{ marginBottom:14 }}><Lbl>{ct.relationshipLabel.replace('{name}', memorial?.name || '')}</Lbl><input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder={ct.relationshipPlaceholder} /></div>
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

      {!needLang && view === 'interview' && memorial && (
        <VoiceInterview
          memorial={memorial}
          contribForm={contribForm}
          lang={L}
          onSave={saveProgress}
          onPause={handlePause}
          saveErr={saveErr}
          initialMessages={initialMessages}
        />
      )}

      {!needLang && view === 'done' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>🤍</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>{t.doneTitle}</h2>
          <p style={{ ...S.muted, maxWidth:360, margin:'0 auto 2rem' }}>{t.doneBody(ct.nounBook)}</p>
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

// ── Admin-Dashboard (Standard-Eingang der Seite) ──────────────────
function Dashboard() {
  const [view, setView]               = useState('login') // login|list|create-category|create|created|detail|book-v1|book-v2|users
  const [token, setToken]             = useState(() => sessionStorage.getItem('lw_admin_token') || '')
  const [auth, setAuth]               = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('lw_admin_auth') || '') || { admin: false, cats: [] } }
    catch { return { admin: false, cats: [] } }
  })
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [memorials, setMemorials]     = useState([])
  const [selected, setSelected]       = useState(null)
  const [contributions, setContribs]  = useState([])
  const [selectedContrib, setSelectedContrib] = useState(null)
  const [createForm, setCreateForm]   = useState({ ...EMPTY_CREATE })
  const [usersData, setUsersData]     = useState({ users: [] })
  const [userForm, setUserForm]       = useState({ username: '', password: '', cats: [] })
  const [createdCode, setCreatedCode] = useState('')
  const [generating, setGenerating]   = useState({}) // { book_v1: true, ... }
  const [genProgress, setGenProgress] = useState({}) // { book_v1: 'Bild 3/7 …' }
  const [eulogyStyleModal, setEulogyStyleModal] = useState(false)
  const [genLangModal, setGenLangModal] = useState(null) // { key, extraArg } | null
  const [costData, setCostData]       = useState(null)
  const [costsLoading, setCostsLoading] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [busy, setBusy]               = useState(false)
  const [deletingId, setDeletingId]   = useState('')
  const [copied, setCopied]           = useState('')
  const [err, setErr]                 = useState('')
  const [hoveredRow, setHoveredRow]   = useState(null) // { id, zone: 'main' | 'cost' }

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
      const authInfo = { admin: Boolean(d.admin), cats: d.cats ?? [] }
      sessionStorage.setItem('lw_admin_auth', JSON.stringify(authInfo))
      setToken(d.token); setAuth(authInfo)
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
      const contribsRes = await fetch(`/api/admin/contributions?code=${memorial.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (contribsRes.status === 401) { logout(); return }
      const d = await contribsRes.json()
      if (!contribsRes.ok) throw new Error(d.error)
      setContribs(d)
      setView('detail')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function reloadContributions() {
    if (!selected) return
    setLoading(true); setErr('')
    try {
      const cRes = await fetch(`/api/admin/contributions?code=${selected.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (cRes.status === 401) { logout(); return }
      const d = await cRes.json()
      if (!cRes.ok) throw new Error(d.error)
      setContribs(d)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  function logout() {
    sessionStorage.removeItem('lw_admin_token')
    sessionStorage.removeItem('lw_admin_auth')
    setToken(''); setAuth({ admin: false, cats: [] }); setView('login'); setUsername(''); setPassword('')
    setMemorials([]); setContribs([]); setSelected(null)
  }

  // Für den eingeloggten Benutzer freigeschaltete Kategorie-Slugs.
  const allowedSlugs = (auth.admin || auth.cats === '*')
    ? CATEGORY_ORDER
    : CATEGORY_ORDER.filter(s => Array.isArray(auth.cats) && auth.cats.includes(s))
  const showCategoryColumn = allowedSlugs.length > 1

  // Startet die Neuanlage: bei mehreren erlaubten Kategorien erst Auswahl,
  // sonst direkt das Formular der einzigen Kategorie.
  function startCreate() {
    setErr('')
    if (allowedSlugs.length <= 1) {
      const slug = allowedSlugs[0] || DEFAULT_CATEGORY
      setCreateForm({ ...EMPTY_CREATE, productCategory: slug, intake: {} })
      setView('create')
    } else {
      setView('create-category')
    }
  }

  function chooseCategory(slug) {
    setCreateForm({ ...EMPTY_CREATE, productCategory: slug, intake: {} })
    setView('create')
  }

  async function handleCreate() {
    setErr(''); setBusy(true)
    try {
      const cat = getCategory(createForm.productCategory)
      const { code } = await createMemorial(token, {
        name: createForm.name.trim(),
        organizer: createForm.organizer.trim(),
        gender: cat.intake.useGender ? (createForm.gender || null) : null,
        bookVariant: createForm.bookVariant,
        funeralDate: cat.intake.useDate ? (createForm.funeralDate || null) : null,
        cutoffDays: createForm.cutoffDays,
        showIntroVideo: createForm.showIntroVideo,
        productCategory: createForm.productCategory,
        intake: createForm.intake || {},
        languages: createForm.languages?.length ? createForm.languages : [DEFAULT_LANGUAGE],
      })
      setCreatedCode(code)
      setView('created')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  // ── Benutzer- & Gruppenverwaltung (nur Admin) ──
  async function loadUsers() {
    setErr('')
    try {
      const d = await adminListUsers(token)
      setUsersData(d)
    } catch (e) { setErr(e.message) }
  }
  function toggleUserFormCat(slug) {
    setUserForm(f => ({
      ...f,
      cats: f.cats.includes(slug) ? f.cats.filter(s => s !== slug) : [...f.cats, slug],
    }))
  }
  async function submitUser() {
    if (!userForm.username.trim() || userForm.password.length < 6) {
      setErr('Benutzername und Passwort (min. 6 Zeichen) erforderlich.'); return
    }
    setErr(''); setBusy(true)
    try {
      await adminCreateUser(token, {
        username: userForm.username.trim(),
        password: userForm.password,
        allowed_categories: userForm.cats,
      })
      setUserForm({ username: '', password: '', cats: [] })
      await loadUsers()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function saveUserCats(user, slug) {
    const next = (user.allowed_categories || []).includes(slug)
      ? user.allowed_categories.filter(s => s !== slug)
      : [...(user.allowed_categories || []), slug]
    setErr('')
    try { await adminUpdateUser(token, user.id, { allowed_categories: next }); await loadUsers() }
    catch (e) { setErr(e.message) }
  }
  async function resetUserPassword(user) {
    const pw = window.prompt(`Neues Passwort für „${user.username}" (min. 6 Zeichen):`)
    if (!pw) return
    setErr('')
    try { await adminUpdateUser(token, user.id, { password: pw }); window.alert('Passwort geändert.') }
    catch (e) { setErr(e.message) }
  }
  async function removeUser(user) {
    if (!window.confirm(`Benutzer „${user.username}" löschen?`)) return
    setErr('')
    try { await adminDeleteUser(token, user.id); await loadUsers() }
    catch (e) { setErr(e.message) }
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

  // DSGVO-Export der Daten EINES Beitragenden als .zip mit zwei Dateien:
  //  - daten.json  (maschinenlesbar, Art. 20 Datenübertragbarkeit)
  //  - auskunft.pdf (menschenlesbar, Art. 15 Auskunft)
  // Bewusst pro Beitrag (jeder Beitragende ist eigener Betroffener) – enthält
  // nur dessen eigene Daten, nicht die anderer Beitragender desselben Buchs.
  async function exportContribution(c) {
    setErr('')
    try {
      const bundle = {
        export_version: 1,
        generated_at: new Date().toISOString(),
        hinweis: 'Personenbezogene Daten dieses Beitrags gemäß DSGVO Art. 15 (Auskunft) / Art. 20 (Datenübertragbarkeit).',
        gedenkbuch: { code: selected.id, name: selected.name },
        beitrag: {
          id: c.id,
          contributor_name: c.contributor_name,
          relationship: c.relationship,
          contributor_gender: c.contributor_gender ?? null,
          contributor_address: c.contributor_address ?? null,
          created_at: c.created_at,
          messages: c.messages,
        },
      }
      const base = safeName(c.contributor_name)
      const zip = new JSZip()
      zip.file(`${base}_daten.json`, JSON.stringify(bundle, null, 2))
      zip.file(`${base}_auskunft.pdf`, buildContributionPdf(c, selected))
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(`dsgvo-export_${base}.zip`, blob)
    } catch (e) { setErr(`Export fehlgeschlagen: ${e.message}`) }
  }

  async function deleteContribution(c) {
    if (!window.confirm(`Beitrag von „${c.contributor_name}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return
    setErr('')
    try {
      await adminDeleteContribution(token, c.id)
      setContribs(cs => cs.filter(x => x.id !== c.id))
      if (selectedContrib?.id === c.id) { setSelectedContrib(null); setView('detail') }
    } catch (e) { setErr(e.message) }
  }

  // Entfernt die Nachrichten an den angegebenen Indizes (Frage + Antwort) aus einem Beitrag.
  async function deleteMessages(c, indices) {
    if (!window.confirm('Diese Frage und Antwort wirklich aus dem Beitrag löschen?')) return
    setErr('')
    const drop = new Set(indices)
    const newMessages = c.messages.filter((_, idx) => !drop.has(idx))
    try {
      const updated = await adminUpdateContributionMessages(token, c.id, newMessages)
      setContribs(cs => cs.map(x => x.id === c.id ? updated : x))
      if (selectedContrib?.id === c.id) setSelectedContrib(updated)
    } catch (e) { setErr(e.message) }
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

  // Generatoren werden aus der Kategorie-Konfiguration des aktuell gewählten
  // Buches abgeleitet (Fallback: memorial, solange keins gewählt ist).
  const activeCat = getCategory(selected?.product_category)
  const GENERATORS = {
    book_v1: {
      kind: 'book', field: 'book_v1', view: 'book-v1',
      label: activeCat.generators.book_v1.label,
      filename: activeCat.generators.book_v1.filename,
      outlineSystem: activeCat.generators.book_v1.outlineSystem,
      chapterSystem: activeCat.generators.book_v1.chapterSystem,
    },
    book_v2: {
      kind: 'book', field: 'book_v2', view: 'book-v2',
      label: activeCat.generators.book_v2.label,
      filename: activeCat.generators.book_v2.filename,
      outlineSystem: activeCat.generators.book_v2.outlineSystem,
      chapterSystem: activeCat.generators.book_v2.chapterSystem,
    },
    eulogy: {
      kind: 'eulogy', field: 'eulogy_text', view: 'eulogy',
      label: activeCat.finalText.label,
      filename: activeCat.finalText.filename,
      noun: activeCat.finalText.noun,
      sections: activeCat.finalText.sections,
      styles: activeCat.finalText.styles,
      sectionSystem: activeCat.finalText.sectionSystem,
    },
  }

  // Bildgenerierung mit Auto-Retry: kurze Pause zwischen Versuchen,
  // damit transiente 5xx/Timeouts (gpt-image-1 läuft am 60s-Limit)
  // nicht sofort als endgültiger Fehler markiert werden.
  async function generateImageWithRetry(memorialId, prompt, { maxAttempts = 3 } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await adminGenerateImage(token, memorialId, prompt)
      } catch (e) {
        lastErr = e
        const msg = String(e?.message || '')
        const transient = /HTTP 5\d\d|timeout|timed out|FUNCTION_INVOCATION_TIMEOUT|fetch failed/i.test(msg)
        if (!transient || attempt === maxAttempts) throw e
        await new Promise(r => setTimeout(r, 3000 * attempt))
      }
    }
    throw lastErr
  }

  // Kapitel-Generierung mit Auto-Retry: Claude liefert gelegentlich
  // ungültiges JSON oder läuft ins 60s-Timeout — beides ist transient,
  // ein zweiter/dritter Versuch klappt meistens.
  async function generateChapterWithRetry(sys, memorialCode, kind, { maxAttempts = 3 } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const chRaw = await askClaude(
          sys,
          [{ role: 'user', content: 'Erzeuge jetzt dieses eine Kapitel als JSON.' }],
          { memorialCode, kind }
        )
        const ch = tryParseJSON(chRaw)
        if (!ch || !ch.body) throw new Error('Kapitel-JSON ungültig oder leer.')
        return ch
      } catch (e) {
        lastErr = e
        if (attempt === maxAttempts) throw e
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }
    throw lastErr
  }

  async function generate(key, extraArg, opts = {}) {
    const gen = GENERATORS[key]
    if (!gen || !selected) return
    if (selected[gen.field] && !opts.skipConfirm && !window.confirm(`„${gen.label}" wurde bereits generiert. Vorhandene Version überschreiben?`)) return
    // Sprache des Endprodukts: vom Admin gewählt (opts.lang) oder die einzige
    // angebotene Sprache, sonst Deutsch. Wird den Prompts vorangestellt.
    const genLang = opts.lang || ((selected.languages && selected.languages.length === 1) ? selected.languages[0] : DEFAULT_LANGUAGE)
    const dir = langDirective(genLang)
    setErr('')
    setGenerating(g => ({ ...g, [key]: true }))
    setGenProgress(p => ({ ...p, [key]: 'Text wird generiert …' }))
    setView(gen.view)
    try {
      let value

      if (gen.kind === 'book') {
        // Phase 1: Buch-Gerüst (Titel/Untertitel und ggf. Kapitelliste) ─
        setGenProgress(p => ({ ...p, [key]: 'Buch-Gerüst wird geplant …' }))
        const outlineRaw = await askClaude(
          gen.outlineSystem(selected, contributions) + dir,
          [{ role: 'user', content: 'Erzeuge jetzt das Gerüst als JSON.' }],
          { memorialCode: selected.id, kind: `${key}_outline` }
        )
        const outline = tryParseJSON(outlineRaw)
        if (!outline || !outline.title) throw new Error('Buch-Gerüst konnte nicht als JSON gelesen werden.')

        // Kapitel-Plan: V1 = aus Beiträgen abgeleitet, V2 = aus Outline
        const chapterPlans = key === 'book_v1'
          ? contributions.map((c, i) => ({ number: i + 1, contribution: c }))
          : (Array.isArray(outline.chapters) ? outline.chapters : [])
        if (chapterPlans.length === 0) throw new Error('Keine Kapitel im Buch-Gerüst gefunden.')

        // Phase 2: jedes Kapitel einzeln schreiben ──────────────────────
        const chapters = []
        const writeErrors = []
        for (let i = 0; i < chapterPlans.length; i++) {
          const plan = chapterPlans[i]
          setGenProgress(p => ({ ...p, [key]: `Kapitel ${i + 1}/${chapterPlans.length} wird geschrieben …` }))
          try {
            const sys = (key === 'book_v1'
              ? gen.chapterSystem(selected, plan.contribution, plan.number)
              : gen.chapterSystem(selected, contributions, plan)) + dir
            const ch = await generateChapterWithRetry(sys, selected.id, `${key}_chapter`)
            chapters.push({
              number: ch.number || plan.number,
              heading: ch.heading || plan.heading || `Kapitel ${plan.number}`,
              body: ch.body,
              image_prompt: ch.image_prompt || '',
            })
          } catch (e) {
            writeErrors.push(`Kapitel ${plan.number}: ${e.message}`)
            chapters.push({
              number: plan.number,
              heading: plan.heading || `Kapitel ${plan.number}`,
              body: '',
              image_prompt: '',
              generate_error: e.message || String(e),
            })
          }
        }

        value = {
          title: outline.title,
          subtitle: outline.subtitle || '',
          chapters,
        }

        // Phase 3: Bilder pro Kapitel (sequenziell, mit Auto-Retry) ─────
        const total = value.chapters.length
        const imageErrors = []
        for (let i = 0; i < total; i++) {
          const ch = value.chapters[i]
          setGenProgress(p => ({ ...p, [key]: `Bild ${i + 1}/${total} wird erstellt …` }))
          if (!ch.image_prompt) {
            value.chapters[i] = { ...ch, image_error: 'kein image_prompt im Kapitel' }
            imageErrors.push(`Kapitel ${ch.number}: kein image_prompt`)
            continue
          }
          try {
            const { storagePath } = await generateImageWithRetry(selected.id, ch.image_prompt)
            value.chapters[i] = { ...ch, image_path: storagePath, image_error: null }
          } catch (e) {
            console.warn(`Bild für Kapitel ${ch.number}:`, e.message)
            value.chapters[i] = { ...ch, image_error: e.message || String(e) }
            imageErrors.push(`Kapitel ${ch.number}: ${e.message}`)
          }
        }

        const errLines = []
        if (writeErrors.length > 0) errLines.push(`${writeErrors.length}/${chapterPlans.length} Kapitel-Fehler. Erster: ${writeErrors[0]}`)
        if (imageErrors.length > 0) errLines.push(`${imageErrors.length}/${total} Bildgenerierungen fehlgeschlagen. Erster Fehler: ${imageErrors[0]}`)
        if (errLines.length > 0) setErr(errLines.join(' · '))

        setGenProgress(p => ({ ...p, [key]: 'Wird gespeichert …' }))
      } else if (gen.kind === 'eulogy') {
        // Endtext (z. B. Rede) in mehrere Abschnitte aufgeteilt — jeder ein
        // eigener Claude-Call, damit niemand am 60s-Limit von api/ask.js stirbt.
        const sections = gen.sections || []
        const parts = []
        const sectionErrors = []
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]
          setGenProgress(p => ({ ...p, [key]: `Abschnitt ${i + 1}/${sections.length}: ${section.label} …` }))
          try {
            const raw = await askClaude(
              gen.sectionSystem(selected, contributions, section, extraArg) + dir,
              [{ role: 'user', content: `Schreibe jetzt den Abschnitt „${section.label}" der ${gen.noun}.` }],
              { memorialCode: selected.id, kind: key }
            )
            const text = String(raw || '').trim()
            if (!text) throw new Error('leere Antwort')
            parts.push(text)
          } catch (e) {
            sectionErrors.push(`${section.label}: ${e.message}`)
          }
        }
        if (parts.length === 0) throw new Error(`Kein Abschnitt der ${gen.noun} konnte generiert werden.`)
        value = parts.join('\n\n')
        if (sectionErrors.length > 0) setErr(`${sectionErrors.length}/${sections.length} Abschnitt-Fehler. Erster: ${sectionErrors[0]}`)
        setGenProgress(p => ({ ...p, [key]: 'Wird gespeichert …' }))
      } else {
        // Sonstige Plain-Text-Generatoren (derzeit keiner)
        const raw = await askClaude(
          gen.system(selected, contributions, extraArg),
          [{ role: 'user', content: gen.userPrompt }],
          { memorialCode: selected.id, kind: key }
        )
        value = raw
      }

      await adminSaveMemorialText(token, selected.id, gen.field, value)

      // Neu laden, damit die signierten Bild-URLs ins selected/memorials kommen
      setGenProgress(p => ({ ...p, [key]: 'Bilder werden geladen …' }))
      try {
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const fresh = await r.json()
          setMemorials(fresh)
          const updated = fresh.find(m => m.id === selected.id)
          if (updated) setSelected(updated)
        } else {
          setSelected(s => ({ ...s, [gen.field]: value }))
          setMemorials(ms => ms.map(m => m.id === selected.id ? { ...m, [gen.field]: value } : m))
        }
      } catch {
        setSelected(s => ({ ...s, [gen.field]: value }))
        setMemorials(ms => ms.map(m => m.id === selected.id ? { ...m, [gen.field]: value } : m))
      }
    } catch (e) { setErr(`Generieren fehlgeschlagen: ${e.message}`) }
    finally {
      setGenerating(g => ({ ...g, [key]: false }))
      setGenProgress(p => ({ ...p, [key]: '' }))
    }
  }

  async function downloadGenerated(key) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data) return
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}.docx`
      if (gen.kind === 'book') await downloadStructuredDocx(filename, data)
      else                     await downloadAsDocx(filename, `${gen.label} – ${selected.name}`, data)
    } catch (e) { setErr(`Download fehlgeschlagen: ${e.message}`) }
  }

  function pickEulogyStyle(style) {
    setEulogyStyleModal(false)
    requestGenerate('eulogy', style.instruction)
  }

  // Startet die Generierung; bei mehreren angebotenen Sprachen wird zuvor die
  // Zielsprache abgefragt.
  function requestGenerate(key, extraArg) {
    const langs = (selected?.languages && selected.languages.length) ? selected.languages : [DEFAULT_LANGUAGE]
    if (langs.length > 1) { setGenLangModal({ key, extraArg }); return }
    generate(key, extraArg, { lang: langs[0], skipConfirm: extraArg !== undefined })
  }
  function pickGenLang(code) {
    const m = genLangModal
    setGenLangModal(null)
    if (m) generate(m.key, m.extraArg, { lang: code, skipConfirm: m.extraArg !== undefined })
  }

  async function openCosts(memorial) {
    setSelected(memorial); setCostData(null); setCostsLoading(true); setErr('')
    setView('costs')
    try {
      const d = await getMemorialCosts(token, memorial.id)
      setCostData(d)
    } catch (e) { setErr(e.message) }
    finally { setCostsLoading(false) }
  }

  const eulogyStyleOverlay = eulogyStyleModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 520, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
        <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Stil der {GENERATORS.eulogy.label} wählen</h2>
        <p style={{ ...S.muted, marginBottom:16 }}>In welchem Ton soll der Text verfasst werden?</p>
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:14 }}>
          {GENERATORS.eulogy.styles.map(s => (
            <div
              key={s.key}
              onClick={() => pickEulogyStyle(s)}
              style={{ ...S.card, cursor:'pointer', padding:'14px 16px', transition:'border-color .15s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#1c1917'; e.currentTarget.style.background = '#fafaf9' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e7e5e4'; e.currentTarget.style.background = '#fff' }}
            >
              <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>{s.title}</div>
              <p style={{ ...S.muted, fontSize:13, margin:0 }}>{s.sub}</p>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12 }}>
          <button className="ghost" onClick={() => setEulogyStyleModal(false)} style={{ fontSize:14 }}>Abbrechen</button>
        </div>
      </div>
    </div>
  ) : null

  const genLangOverlay = genLangModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 420, width:'100%' }}>
        <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>In welcher Sprache soll das Buch erstellt werden?</h2>
        <p style={{ ...S.muted, marginBottom:16 }}>Für dieses Buch sind mehrere Sprachen freigeschaltet.</p>
        <div style={{ display:'grid', gap:10, marginBottom:14 }}>
          {((selected?.languages && selected.languages.length) ? selected.languages : [DEFAULT_LANGUAGE]).map(code => {
            const meta = LANGUAGES.find(x => x.code === code) || { code, label: code }
            return <button key={code} onClick={() => pickGenLang(code)} style={{ fontSize:15, padding:'12px 16px' }}>{meta.label}</button>
          })}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12 }}>
          <button className="ghost" onClick={() => setGenLangModal(null)} style={{ fontSize:14 }}>Abbrechen</button>
        </div>
      </div>
    </div>
  ) : null

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
          <span style={{ fontSize: 13, color: '#78716c', marginLeft: 12 }}>{memorials.length} {memorials.length === 1 ? 'Buch' : 'Bücher'}</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {auth.admin && (
            <button className="secondary" onClick={() => { loadUsers(); setErr(''); setView('users') }} style={{ fontSize: 13, padding: '7px 14px' }}>Benutzer</button>
          )}
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Alle Bücher</h2>
          <button onClick={startCreate} style={{ fontSize:14, padding:'9px 16px' }}>
            + Neues Buch
          </button>
        </div>
        <Err msg={err} />
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : memorials.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
            <p style={S.muted}>Noch keine Bücher angelegt. Beginnen Sie mit „+ Neues Buch".</p>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', ...(showCategoryColumn ? ['Kategorie'] : []), 'Organisator', 'Variante', 'Erfassung bis', 'Antworten', 'Kosten', ''].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...memorials].sort((a, b) => {
                  const da = cutoffDate(a.funeral_date, cutoffDays(a))
                  const db = cutoffDate(b.funeral_date, cutoffDays(b))
                  if (!da && !db) return 0
                  if (!da) return 1
                  if (!db) return -1
                  return da - db
                }).map(m => {
                  const isHover    = hoveredRow?.id === m.id
                  const mainHover  = isHover && hoveredRow.zone === 'main'
                  const costHover  = isHover && hoveredRow.zone === 'cost'
                  const MAIN_BG    = '#fef3c7' // warm amber
                  const COST_BG    = '#dbeafe' // cool blue
                  const mainCellBg = mainHover ? MAIN_BG : ''
                  const mainCell   = { ...col, cursor:'pointer', background: mainCellBg, transition:'background .1s' }
                  const enterMain  = () => setHoveredRow({ id: m.id, zone: 'main' })
                  const leaveRow   = () => setHoveredRow(null)
                  return (
                    <tr key={m.id}>
                      <td style={{ ...mainCell, fontWeight: 600 }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.name}</td>
                      {showCategoryColumn && (
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{getCategory(m.product_category).icon} {getCategory(m.product_category).label}</td>
                      )}
                      <td style={mainCell}                                                onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.organizer}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.book_variant ? `Variante ${m.book_variant}` : '—'}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{cutoffString(m.funeral_date, cutoffDays(m))}</td>
                      <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        {(m.contribution_count || 0)} {(m.contribution_count === 1) ? 'Beitrag' : 'Beiträge'} · {(m.answer_count || 0)} {(m.answer_count === 1) ? 'Antwort' : 'Antworten'}
                      </td>
                      <td
                        style={{ ...col, textAlign:'right', whiteSpace:'nowrap', padding:'6px 14px', background: costHover ? COST_BG : '', transition:'background .1s' }}
                        onMouseEnter={() => setHoveredRow({ id: m.id, zone: 'cost' })}
                        onMouseLeave={leaveRow}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); openCosts(m) }}
                          title="Aufschlüsselung anzeigen"
                          style={{
                            background: costHover ? '#bfdbfe' : '#fff',
                            border:'1px solid #93c5fd',
                            borderRadius:8,
                            padding:'6px 12px',
                            fontSize:13,
                            fontWeight:600,
                            color:'#1d4ed8',
                            cursor:'pointer',
                            display:'inline-flex',
                            alignItems:'center',
                            gap:6,
                            transition:'background .1s, border-color .1s',
                            whiteSpace:'nowrap',
                          }}
                        >
                          <span aria-hidden="true">💶</span>
                          <span style={{ textDecoration:'underline', textUnderlineOffset:2 }}>{formatEur(m.cost_total_eur)}</span>
                        </button>
                      </td>
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
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )

  // ── PRODUKTKATEGORIE WÄHLEN (vor der Anlage) ──
  if (view === 'create-category') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Produktkategorie wählen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Für welchen Anlass soll das Buch entstehen?</p>
        <Err msg={err} />
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10 }}>
          {allowedSlugs.map(slug => (
            <div
              key={slug}
              onClick={() => chooseCategory(slug)}
              style={{ ...S.card, cursor:'pointer', padding:'16px 16px', transition:'border-color .15s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#1c1917'; e.currentTarget.style.background = '#fafaf9' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e7e5e4'; e.currentTarget.style.background = '#fff' }}
            >
              <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ fontSize:26, lineHeight:1, flexShrink:0 }} aria-hidden="true">{CATEGORIES[slug].icon}</span>
                <div>
                  <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>{CATEGORIES[slug].label}</div>
                  <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{CATEGORIES[slug].description}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  // ── NEUES BUCH (kategorie-spezifisches Formular) ──
  if (view === 'create') {
    const cat = getCategory(createForm.productCategory)
    const ci  = cat.intake
    const canSubmit = createForm.name && createForm.organizer && (!ci.useGender || createForm.gender) && !busy
    return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView(allowedSlugs.length > 1 ? 'create-category' : 'list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{ci.createHeading}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{ci.createIntro}</p>
        <Err msg={err} />
        <div style={{ marginBottom: 14 }}>
          <Lbl>{ci.subjectLabel}</Lbl>
          <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder={ci.subjectPlaceholder} />
        </div>
        {ci.useGender && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.genderLabel}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {GENDERS.map(g => (
                <div
                  key={g.value}
                  onClick={() => setCreateForm({ ...createForm, gender: g.value })}
                  style={{
                    ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                    borderColor: createForm.gender === g.value ? '#1c1917' : '#e7e5e4',
                    borderWidth: createForm.gender === g.value ? 2 : 1,
                    fontSize: 14, fontWeight: createForm.gender === g.value ? 600 : 400,
                  }}
                >
                  {g.label}
                </div>
              ))}
            </div>
          </div>
        )}
        {(ci.extra || []).map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <Lbl>{f.label}</Lbl>
            <input
              value={createForm.intake?.[f.key] || ''}
              onChange={e => setCreateForm({ ...createForm, intake: { ...createForm.intake, [f.key]: e.target.value } })}
              placeholder={f.placeholder || ''}
            />
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <Lbl>Ihr Name (Organisator) *</Lbl>
          <input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder="Ihr Name" />
        </div>
        {ci.useDate && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.dateLabel}</Lbl>
            <input type="date" value={createForm.funeralDate} onChange={e => setCreateForm({ ...createForm, funeralDate: e.target.value })} />
          </div>
        )}
        {ci.useCutoff && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.cutoffLabel}</Lbl>
            <input
              type="number" min={0} max={90} step={1}
              value={createForm.cutoffDays}
              onChange={e => {
                const v = e.target.value
                setCreateForm({ ...createForm, cutoffDays: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) })
              }}
            />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
              {createForm.funeralDate && Number.isFinite(parseInt(createForm.cutoffDays, 10))
                ? <>Beiträge fließen bis zum <strong>{cutoffString(createForm.funeralDate, parseInt(createForm.cutoffDays, 10))}</strong> ein.</>
                : <>Standard sind 7 Tage.</>}
            </p>
          </div>
        )}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Sprachen *</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px' }}>
            In welchen Sprachen sollen Beitragende den Prozess durchführen können? Bei mehreren Sprachen wählt der Beitragende zu Beginn seine Sprache.
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {LANGUAGES.map(l => {
              const on = createForm.languages.includes(l.code)
              return (
                <label key={l.code} style={{
                  display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                  ...S.card, padding:'10px 14px',
                  borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setCreateForm(f => {
                      const next = on ? f.languages.filter(c => c !== l.code) : [...f.languages, l.code]
                      return { ...f, languages: next.length ? next : f.languages }
                    })}
                    style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }}
                  />
                  <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                </label>
              )
            })}
          </div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Buch-Variante *</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
            {BOOK_VARIANTS.map(v => (
              <div
                key={v.value}
                onClick={() => setCreateForm({ ...createForm, bookVariant: v.value })}
                style={{
                  ...S.card, cursor:'pointer', padding:'14px 14px',
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
        <div style={{ marginBottom: 24 }}>
          <Lbl>Einführungsvideo</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input
              type="checkbox"
              checked={createForm.showIntroVideo}
              onChange={e => setCreateForm({ ...createForm, showIntroVideo: e.target.checked })}
              style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }}
            />
            <span style={{ fontSize:14 }}>Einführungsvideo vor dem Sprach-Interview anzeigen</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: aktiv. Wenn deaktiviert, startet das Interview direkt ohne Video.
          </p>
        </div>
        <button
          disabled={!canSubmit}
          onClick={handleCreate}
          style={{ width: '100%', padding: 13, fontSize: 15 }}
        >
          {busy ? 'Wird erstellt …' : ci.createButton}
        </button>
      </div>
    </div>
    )
  }

  // ── BENUTZER (nur Admin) ──
  if (view === 'users') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Benutzer</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Pro Benutzer legen Sie fest, welche Produktkategorien er anlegen darf.</p>
        <Err msg={err} />

        {/* Bestehende Benutzer */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:24 }}>
          {usersData.users.map(u => (
            <div key={u.id} style={{ ...S.card }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:12, flexWrap:'wrap' }}>
                <div>
                  <strong style={{ fontSize:15 }}>{u.username}</strong>{u.is_admin && <span style={{ fontSize:11, marginLeft:8, color:'#1d4ed8' }}>Admin</span>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="secondary" onClick={() => resetUserPassword(u)} style={{ fontSize:12, padding:'5px 10px' }}>Passwort</button>
                  <button className="secondary" onClick={() => removeUser(u)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
                </div>
              </div>
              {u.is_admin ? (
                <p style={{ ...S.muted, fontSize:12, margin:0 }}>Administrator – sieht alle Produktkategorien.</p>
              ) : (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {CATEGORY_ORDER.map(slug => {
                    const on = (u.allowed_categories || []).includes(slug)
                    return (
                      <span key={slug} onClick={() => saveUserCats(u, slug)}
                        style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                          borderColor: on ? '#1c1917' : '#e7e5e4', background: on ? '#1c1917' : '#fff', color: on ? '#fafaf9' : '#78716c' }}>
                        {CATEGORIES[slug].label}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {usersData.users.length === 0 && <p style={S.muted}>Noch keine Benutzer.</p>}
        </div>

        {/* Neuer Benutzer */}
        <div style={{ ...S.card }}>
          <Lbl>Neuer Benutzer</Lbl>
          <input value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="Benutzername" style={{ marginBottom:10 }} />
          <input type="password" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder="Passwort (min. 6 Zeichen)" style={{ marginBottom:12 }} />
          <Lbl>Erlaubte Produktkategorien</Lbl>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'6px 0 14px' }}>
            {CATEGORY_ORDER.map(slug => {
              const on = userForm.cats.includes(slug)
              return (
                <span key={slug} onClick={() => toggleUserFormCat(slug)}
                  style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                    borderColor: on ? '#1c1917' : '#e7e5e4', background: on ? '#1c1917' : '#fff', color: on ? '#fafaf9' : '#78716c' }}>
                  {CATEGORIES[slug].label}
                </span>
              )
            })}
          </div>
          <button onClick={submitUser} disabled={busy} style={{ fontSize:14, padding:'9px 16px' }}>Benutzer anlegen</button>
        </div>
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
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Buch erstellt</h2>
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
            {selected.funeral_date ? ` · Erfassung bis: ${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} Tage vorher)` : ''}
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
              <p style={S.muted}>Noch keine Beiträge für dieses Buch.</p>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); dlOne(c) }}
                        className="secondary"
                        style={{ fontSize: 13, padding: '8px 16px' }}
                      >
                        ⬇ Herunterladen
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteContribution(c) }}
                        className="secondary"
                        title="Beitrag löschen"
                        style={{ fontSize: 15, padding: '8px 12px', color: '#dc2626' }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch & {GENERATORS.eulogy.label}</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {[
                { key:'book_v1', icon:'📄', title:GENERATORS.book_v1.label, sub:'Jede Person als eigenes Kapitel (Ich-Form, fließender Text).' },
                { key:'book_v2', icon:'✨', title:GENERATORS.book_v2.label, sub:'KI webt alle Beiträge zu einem stimmigen, literarischen Text.' },
                { key:'eulogy',  icon:'🕯', title:GENERATORS.eulogy.label,  sub:`KI verfasst einen persönlichen Text (${GENERATORS.eulogy.noun}) zum Vorlesen.` },
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
                      <button onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} disabled={busy || contributions.length === 0} style={{ fontSize:13, padding:'8px 14px' }}>
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
            {deletingId === selected.id ? 'Wird gelöscht …' : '🗑 Dieses Buch löschen'}
          </button>
        </div>
        {eulogyStyleOverlay}
        {genLangOverlay}
      </div>
    )
  }

  // ── KOSTEN-AUFSCHLÜSSELUNG ──
  if (view === 'costs' && selected) {
    const kinds = costData?.byKind ? Object.entries(costData.byKind).sort((a, b) => b[1].cost_eur - a[1].cost_eur) : []
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Kosten</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>

        <div style={{ maxWidth: 920, margin: '2rem auto', padding: '0 1.5rem' }}>
          <Err msg={err} />
          {costsLoading && <p style={S.muted}>Wird geladen …</p>}
          {!costsLoading && costData && (
            <>
              <div style={{ ...S.card, marginBottom:'1.5rem', textAlign:'center' }}>
                <Lbl>Gesamtkosten dieses Buchs</Lbl>
                <div style={{ fontSize:32, fontWeight:700, fontFamily:'Georgia,serif', marginTop:6 }}>{formatEur(costData.total_eur)}</div>
                <div style={{ fontSize:13, color:'#78716c', marginTop:4 }}>≈ {Number(costData.total_usd || 0).toFixed(4)} USD</div>
              </div>

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Aufschlüsselung nach Kategorie</h3>
              {kinds.length === 0 ? (
                <p style={S.muted}>Noch keine Kosten erfasst.</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden', marginBottom:'1.5rem' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['Kategorie', 'Calls', 'Mengen', 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {kinds.map(([k, agg]) => {
                        const units = []
                        if (agg.input_tokens || agg.output_tokens) units.push(`${agg.input_tokens.toLocaleString('de-DE')} in / ${agg.output_tokens.toLocaleString('de-DE')} out Tokens`)
                        if (agg.characters)    units.push(`${agg.characters.toLocaleString('de-DE')} Zeichen`)
                        if (agg.audio_seconds) units.push(`${Math.round(agg.audio_seconds)} Sek. Audio`)
                        if (agg.images)        units.push(`${agg.images} Bild${agg.images > 1 ? 'er' : ''}`)
                        return (
                          <tr key={k}>
                            <td style={{ ...col, fontWeight:500 }}>{costKindLabel(k)}</td>
                            <td style={{ ...col, color:'#78716c' }}>{agg.count}</td>
                            <td style={{ ...col, color:'#78716c', fontSize:13 }}>{units.join(' · ') || '—'}</td>
                            <td style={{ ...col, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>{formatEur(agg.cost_eur)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Alle Vorgänge ({costData.events.length})</h3>
              {costData.events.length === 0 ? (
                <p style={S.muted}>Keine Einträge.</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['Zeit', 'Kategorie', 'Modell', 'Detail', 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {costData.events.map(e => {
                        const parts = []
                        if (e.input_tokens || e.output_tokens) parts.push(`${e.input_tokens || 0} in / ${e.output_tokens || 0} out`)
                        if (e.characters)    parts.push(`${e.characters} Zeichen`)
                        if (e.audio_seconds) parts.push(`${Math.round(e.audio_seconds)} s`)
                        if (e.images)        parts.push(`${e.images} Bild`)
                        return (
                          <tr key={e.id}>
                            <td style={{ ...col, fontSize:12, color:'#78716c', whiteSpace:'nowrap' }}>{new Date(e.created_at).toLocaleString('de-DE')}</td>
                            <td style={{ ...col }}>{costKindLabel(e.kind)}</td>
                            <td style={{ ...col, fontFamily:'monospace', fontSize:12, color:'#78716c' }}>{e.model || '—'}</td>
                            <td style={{ ...col, fontSize:12, color:'#78716c' }}>{parts.join(' · ') || '—'}</td>
                            <td style={{ ...col, textAlign:'right', fontWeight:500, whiteSpace:'nowrap' }}>{formatEur(e.cost_eur)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
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
        const hasAnswer = c.messages[j + 1]?.role === 'user'
        pairs.push({
          q: c.messages[j].content,
          a: hasAnswer ? c.messages[j + 1].content : undefined,
          indices: hasAnswer ? [j, j + 1] : [j],
        })
        if (hasAnswer) j++
      } else {
        pairs.push({ q: null, a: c.messages[j].content, indices: [j] })
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
            <button className="secondary" onClick={() => exportContribution(c)} title="Daten dieses Beitragenden als .zip (lesbares PDF + JSON) exportieren – DSGVO Art. 15/20" style={{ fontSize:13, padding:'8px 16px' }}>⬇ DSGVO-Export</button>
            <button className="secondary" onClick={() => deleteContribution(c)} title="Beitrag löschen" style={{ fontSize:15, padding:'7px 12px', color:'#dc2626' }}>🗑</button>
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
                <div key={j} style={{ ...S.card, position:'relative' }}>
                  <button
                    onClick={() => deleteMessages(c, p.indices)}
                    title="Frage & Antwort löschen"
                    className="ghost"
                    style={{ position:'absolute', top:10, right:10, fontSize:14, color:'#dc2626', padding:'4px 8px', lineHeight:1 }}
                  >
                    🗑
                  </button>
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
    const data = selected[gen.field]
    const busy = !!generating[key]
    const subtitle = view === 'book-v1' ? `${getCategory(selected?.product_category).nounBook} · Version 1`
                   : view === 'book-v2' ? `${getCategory(selected?.product_category).nounBook} · Version 2`
                   : GENERATORS.eulogy.label
    return (
      <div style={{ maxWidth:720, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
        <Back onClick={() => setView('detail')} />
        <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
          <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>{subtitle}</p>
          <h1 style={{ fontSize:24, fontWeight:600, fontFamily:'Georgia,serif', color:'#78716c' }}>{selected.name}</h1>
        </div>

        <Err msg={err} />

        {busy ? (
          <div style={{ textAlign:'center', padding:'3rem 0' }}>
            <Dots />
            <p style={{ ...S.muted, marginTop:16 }}>{genProgress[key] || 'Die KI arbeitet …'}</p>
          </div>
        ) : !data ? (
          <p style={{ ...S.muted, textAlign:'center', padding:'3rem 0' }}>Noch nichts generiert. Geh zurück und klicke „Generieren".</p>
        ) : gen.kind === 'book' ? (
          <>
            <div style={{ textAlign:'center', padding:'2rem 0 3rem', borderTop:'1px solid #e7e5e4' }}>
              <h2 style={{ fontSize:36, fontWeight:700, fontFamily:'Georgia,serif', marginBottom:12, color:'#1c1917' }}>{data.title || '—'}</h2>
              {data.subtitle && <p style={{ fontSize:18, fontStyle:'italic', color:'#78716c', fontFamily:'Georgia,serif' }}>{data.subtitle}</p>}
            </div>
            {(data.chapters || []).map((ch, i) => (
              <div key={i} style={{ marginBottom:'3rem' }}>
                <div style={{ textAlign:'center', marginBottom:'1.25rem' }}>
                  <p style={{ fontSize:11, letterSpacing:'.18em', textTransform:'uppercase', color:'#a8a29e', marginBottom:6 }}>Kapitel {ch.number ?? i + 1}</p>
                  <h3 style={{ fontSize:24, fontWeight:700, fontFamily:'Georgia,serif' }}>{ch.heading || ''}</h3>
                </div>
                {ch.image_url ? (
                  <img
                    src={ch.image_url}
                    alt={ch.heading || ''}
                    loading="lazy"
                    onError={(e) => { console.warn('Bild-Load fehlgeschlagen:', ch.image_url); e.currentTarget.style.outline = '2px solid #ef4444' }}
                    style={{ width:'100%', height:'auto', borderRadius:8, marginBottom:'2rem', display:'block', boxShadow:'0 2px 12px rgba(0,0,0,.08)' }}
                  />
                ) : ch.image_path ? (
                  <div style={{ background:'#fef3c7', border:'1px dashed #fde68a', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78350f', fontSize:13, lineHeight:1.5 }}>
                    🖼 Bild wurde generiert und gespeichert, aber die Anzeige-URL fehlt.<br />
                    <code style={{ fontFamily:'monospace', fontSize:12 }}>{ch.image_path}</code><br />
                    <span style={{ fontSize:12, color:'#92400e' }}>(Signing schlägt fehl — Bucket-Name prüfen oder Liste neu laden)</span>
                  </div>
                ) : ch.image_prompt ? (
                  <div style={{ background:'#fef2f2', border:'1px dashed #fecaca', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#991b1b', fontSize:13, lineHeight:1.5 }}>
                    🖼 Kein Bild gespeichert — Generierung war nicht erfolgreich.<br />
                    {ch.image_error && (
                      <span style={{ display:'inline-block', marginTop:6, padding:'4px 10px', background:'#fff', border:'1px solid #fecaca', borderRadius:6, fontFamily:'monospace', fontSize:12, color:'#7f1d1d' }}>
                        {ch.image_error}
                      </span>
                    )}
                    <div style={{ fontSize:12, color:'#7f1d1d', marginTop:8 }}>Prompt war: „{ch.image_prompt}"</div>
                  </div>
                ) : (
                  <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13 }}>
                    🖼 Kein image_prompt im Kapitel-JSON.
                  </div>
                )}
                <div style={{ fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
                  {String(ch.body || '').split('\n\n').filter(Boolean).map((p, j) => <p key={j} style={{ marginBottom:'1.4rem' }}>{p}</p>)}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem', fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
            {renderRichText(data)}
          </div>
        )}

        {!busy && data && (
          <div style={{ marginTop:'2rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4', display:'flex', gap:10, flexWrap:'wrap' }}>
            <button onClick={() => downloadGenerated(key)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Download .docx</button>
            <button className="secondary" onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} style={{ fontSize:13, padding:'8px 16px' }}>↻ Neu generieren</button>
          </div>
        )}
        {eulogyStyleOverlay}
        {genLangOverlay}
      </div>
    )
  }

  return null
}

// ── Rechtstexte (Impressum / Datenschutz) ─────────────────────────
// HINWEIS (intern): Der Datenschutztext ist ein fundierter Entwurf, der die
// tatsächliche Verarbeitung abbildet. Vor produktivem Verlass darauf bitte
// juristisch prüfen lassen. Verantwortliche: HealthCare Futurists GmbH.

function LegalLayout({ title, children }) {
  const back = () => { if (window.history.length > 1) window.history.back(); else window.location.href = '/' }
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ maxWidth:760, margin:'0 auto', padding:'2.5rem 1.5rem 4rem' }}>
        <button className="ghost" onClick={back} style={{ fontSize:14, color:'#78716c', marginBottom:'1rem' }}>← Zurück</button>
        <h1 style={{ fontSize:26, fontWeight:800, margin:'0 0 1.5rem' }}>{title}</h1>
        <div style={{ fontSize:15, lineHeight:1.7, color:'#44403c' }}>{children}</div>
      </div>
    </div>
  )
}

const LH = { fontSize:18, fontWeight:700, margin:'1.8rem 0 .6rem', color:'#1c1917' }

function Impressum() {
  return (
    <LegalLayout title="Impressum">
      <p><strong>Angaben gemäß § 5 DDG</strong></p>
      <p>HealthCare Futurists GmbH<br/>Stadtwaldgürtel 13<br/>50935 Köln<br/>Deutschland</p>
      <p>Zweigstelle:<br/>Walter-Schneider-Straße 11<br/>06317 Seegebiet Mansfelder Land<br/>Deutschland</p>
      <h2 style={LH}>Vertreten durch</h2>
      <p>Geschäftsführer Dr. Tobias D. Gantner</p>
      <h2 style={LH}>Kontakt</h2>
      <p>E-Mail: info@healthcarefuturists.com<br/>Telefon: +49 151 4129 6999</p>
      <h2 style={LH}>Registereintrag</h2>
      <p>Eintragung im Handelsregister.<br/>Registergericht: Amtsgericht Köln<br/>Registernummer: HRB 91294</p>
      <h2 style={LH}>Umsatzsteuer-Identifikationsnummer</h2>
      <p>USt-IdNr. gemäß § 27a UStG: DE291805257</p>
      <h2 style={LH}>Verantwortlich für den Inhalt</h2>
      <p>gemäß § 18 Abs. 2 MStV: Dr. Tobias D. Gantner, Anschrift wie oben.</p>
    </LegalLayout>
  )
}

function Datenschutz() {
  return (
    <LegalLayout title="Datenschutzerklärung">
      <p style={{ color:'#78716c' }}>Stand: 15. Juni 2026 · Fassung {CONSENT_VERSION}</p>

      <h2 style={LH}>1. Verantwortlicher</h2>
      <p>
        Verantwortlich für die Datenverarbeitung im Sinne der DSGVO ist:<br/>
        HealthCare Futurists GmbH, Stadtwaldgürtel 13, 50935 Köln, Deutschland<br/>
        Geschäftsführer: Dr. Tobias D. Gantner<br/>
        E-Mail: info@healthcarefuturists.com · Telefon: +49 151 4129 6999
      </p>

      <h2 style={LH}>2. Worum es geht</h2>
      <p>
        Mit dieser Anwendung erstellen wir ein persönliches Gedenkbuch für eine verstorbene
        Person. Dazu führen Angehörige und Nahestehende ein sprach- oder textbasiertes Interview,
        aus dessen Inhalten ein Erinnerungstext entsteht.
      </p>

      <h2 style={LH}>3. Welche Daten wir verarbeiten</h2>
      <p>
        Von Ihnen als beitragender Person: Name, Beziehung zur verstorbenen Person, Geschlecht,
        gewünschte Anrede, Ihre Stimmaufnahmen während des Interviews sowie deren Verschriftlichung
        und sämtliche Interview-Inhalte. Diese Inhalte können <strong>besondere Kategorien
        personenbezogener Daten</strong> enthalten (Art. 9 DSGVO), insbesondere Angaben zu Gesundheit
        und Todesumständen sowie ggf. religiöse oder weltanschauliche Angaben. Technisch fallen
        zudem Zeitstempel und die Protokollierung Ihrer Einwilligung an.
      </p>

      <h2 style={LH}>4. Rechtsgrundlage</h2>
      <p>
        Wir verarbeiten diese Daten ausschließlich auf Grundlage Ihrer <strong>ausdrücklichen
        Einwilligung</strong> (Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2 lit. a DSGVO). Die Einwilligung
        ist freiwillig; ohne sie können wir das Gedenkbuch nicht erstellen. Sie können Ihre
        Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, ohne dass die Rechtmäßigkeit
        der bis dahin erfolgten Verarbeitung berührt wird (siehe Abschnitt 8).
      </p>

      <h2 style={LH}>5. KI-Verarbeitung, Empfänger und Übermittlung in die USA</h2>
      <p>
        Zur Verarbeitung setzen wir Dienstleister als Auftragsverarbeiter ein:
      </p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li><strong>Anthropic</strong> (Claude) – KI-gestützte Interviewführung und Texterstellung; USA.</li>
        <li><strong>OpenAI</strong> – Sprachausgabe (Text-to-Speech), Spracherkennung (Transkription) und Bilderzeugung; USA.</li>
        <li><strong>Supabase</strong> – Speicherung von Datenbank- und Bildinhalten.</li>
        <li><strong>Vercel</strong> – Betrieb und Auslieferung der Anwendung.</li>
      </ul>
      <p>
        Dabei werden Ihre Daten an Anbieter in den <strong>USA</strong> übermittelt. Für die USA
        besteht kein generell mit dem EU-Recht vergleichbares Datenschutzniveau; insbesondere können
        US-Behörden unter bestimmten Voraussetzungen auf Daten zugreifen, und Ihre Betroffenenrechte
        sind dort ggf. schwerer durchsetzbar. Die Übermittlung erfolgt auf Grundlage Ihrer
        ausdrücklichen Einwilligung in die Datenübermittlung in ein Drittland gemäß
        <strong> Art. 49 Abs. 1 lit. a DSGVO</strong>. Eine automatisierte Entscheidung mit
        rechtlicher Wirkung Ihnen gegenüber findet nicht statt.
      </p>

      <h2 style={LH}>6. Speicherdauer</h2>
      <p>
        Wir löschen die zu einem Gedenkbuch gehörenden personenbezogenen Daten automatisch
        <strong> 90 Tage nach dem Bestattungstermin</strong> (ist kein Bestattungstermin hinterlegt,
        90 Tage nach Anlage des Gedenkbuchs). Auf Ihren Wunsch löschen wir Ihre Daten auch früher.
      </p>

      <h2 style={LH}>7. Ihre Rechte</h2>
      <p>Ihnen stehen gegenüber uns folgende Rechte zu:</p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),</li>
        <li>Datenübertragbarkeit (Art. 20) – wir stellen Ihre Daten auf Anfrage als maschinenlesbare Datei bereit,</li>
        <li>Widerspruch (Art. 21) sowie Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3).</li>
      </ul>
      <p>Zur Ausübung genügt eine Nachricht an info@healthcarefuturists.com.</p>

      <h2 style={LH}>8. Widerruf der Einwilligung</h2>
      <p>
        Sie können Ihre Einwilligung jederzeit widerrufen – formlos per E-Mail an
        info@healthcarefuturists.com. Nach einem Widerruf stellen wir die weitere Verarbeitung ein
        und löschen Ihre Daten, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
      </p>

      <h2 style={LH}>9. Beschwerderecht</h2>
      <p>
        Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Für uns
        zuständig ist die Landesbeauftragte für Datenschutz und Informationsfreiheit
        Nordrhein-Westfalen (LDI NRW), Postfach 20 04 44, 40102 Düsseldorf.
      </p>
    </LegalLayout>
  )
}

function LegalFooter() {
  const a = { color:'#57534e', margin:'0 10px', textDecoration:'none' }
  return (
    <footer style={{ borderTop:'1px solid #e7e5e4', padding:'18px 1.5rem', textAlign:'center', fontSize:13, color:'#78716c', background:'#fafaf9' }}>
      <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={a}>Datenschutzerklärung</a>
      <span style={{ color:'#d6d3d1' }}>·</span>
      <a href="/#impressum" target="_blank" rel="noopener noreferrer" style={a}>Impressum</a>
    </footer>
  )
}

// ── Haupt-App ─────────────────────────────────────────────────────
export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const route = hash.replace(/^#/, '')
  if (route === 'impressum')  return <Impressum />
  if (route === 'datenschutz') return <Datenschutz />

  return (
    <>
      <style>{`
        @keyframes lw-dot { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes lw-spin { to{transform:rotate(360deg)} }
        @keyframes lw-mic  { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
      `}</style>
      {codeFromURL ? <ContributorFlow code={codeFromURL} /> : <Dashboard />}
      <LegalFooter />
    </>
  )
}
