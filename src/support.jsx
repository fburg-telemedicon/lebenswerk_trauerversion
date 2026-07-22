// src/support.jsx — In-App-Support (Kontakt-/Fehlermeldeformular).
// Ein SupportProvider stellt app-weit `openSupport(opts)` bereit und rendert EIN
// Modal. Aufrufbar aus dem Beitragenden-Flow (☰-Menü, Fehlerzustände, Info-Maske)
// und aus dem Manager-Dashboard.
//
// opts (alle optional): {
//   role, code, category, view, lang, lastError,   // Diagnose-Kontext
//   suggestedEmail, suggestedName                    // Formular-Vorbelegung
// }
// Der Diagnose-Kontext wird dem Nutzer VOR dem Absenden unveränderbar angezeigt
// (Transparenz + Datenschutz) und automatisch mitgeschickt.

import { createContext, useContext, useState, useCallback } from 'react'
import { sendSupport } from './api.js'

const SupportCtx = createContext(() => {})
export const useSupport = () => useContext(SupportCtx)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Bewusst grob (wie serverseitig in api/support.js): internationale Schreibweisen
// sind zu vielfältig, um hier streng zu sein.
const PHONE_RE = /^[+()/\-.\s\d]{6,}$/

// Kompakte Übersetzungen (de/en/pl; sonst Deutsch). Der Manager sieht Deutsch.
const L10N = {
  de: {
    title: 'Support kontaktieren',
    intro: 'Beschreiben Sie kurz Ihr Anliegen oder das Problem. Wir melden uns bei Ihnen.',
    name: 'Name (optional)',
    email: 'Ihre Antwort-E-Mail-Adresse',
    emailHint: 'E-Mail oder Telefonnummer – mindestens eines von beidem, damit wir Ihnen antworten können.',
    phone: 'Ihre Telefonnummer (optional)',
    phonePh: '+49 …',
    channel: 'Wie möchten Sie am liebsten kontaktiert werden? (optional)',
    channelAny: 'Keine Vorliebe',
    channelEmail: 'Per E-Mail',
    channelPhone: 'Telefonisch',
    message: 'Ihre Nachricht',
    messagePh: 'Was ist passiert? Was möchten Sie uns mitteilen?',
    ctxLabel: 'Diese technischen Angaben werden zur Fehlersuche automatisch mitgeschickt:',
    send: 'Absenden',
    sending: 'Wird gesendet …',
    cancel: 'Abbrechen',
    close: 'Schließen',
    sent: 'Vielen Dank! Ihre Nachricht ist bei uns eingegangen – wir melden uns bei Ihnen.',
    errEmail: 'Bitte eine gültige E-Mail-Adresse angeben.',
    errPhone: 'Bitte eine gültige Telefonnummer angeben.',
    errContact: 'Bitte geben Sie eine E-Mail-Adresse oder eine Telefonnummer an, damit wir Ihnen antworten können.',
    errMessage: 'Bitte beschreiben Sie Ihr Anliegen kurz.',
  },
  en: {
    title: 'Contact support',
    intro: 'Briefly describe your request or the problem. We will get back to you.',
    name: 'Name (optional)',
    email: 'Your reply email address',
    emailHint: 'Email or phone number – at least one of the two, so we can get back to you.',
    phone: 'Your phone number (optional)',
    phonePh: '+49 …',
    channel: 'How would you prefer to be contacted? (optional)',
    channelAny: 'No preference',
    channelEmail: 'By email',
    channelPhone: 'By phone',
    message: 'Your message',
    messagePh: 'What happened? What would you like to tell us?',
    ctxLabel: 'These technical details are attached automatically to help us investigate:',
    send: 'Send',
    sending: 'Sending …',
    cancel: 'Cancel',
    close: 'Close',
    sent: 'Thank you! Your message has reached us – we will get back to you.',
    errEmail: 'Please enter a valid email address.',
    errPhone: 'Please enter a valid phone number.',
    errContact: 'Please provide an email address or a phone number so we can get back to you.',
    errMessage: 'Please describe your request briefly.',
  },
  pl: {
    title: 'Kontakt z pomocą',
    intro: 'Opisz krótko swoją sprawę lub problem. Skontaktujemy się z Tobą.',
    name: 'Imię (opcjonalnie)',
    email: 'Twój adres e-mail do odpowiedzi',
    emailHint: 'E-mail lub numer telefonu – przynajmniej jedno z nich, abyśmy mogli odpowiedzieć.',
    phone: 'Twój numer telefonu (opcjonalnie)',
    phonePh: '+48 …',
    channel: 'Jak najchętniej chcesz być kontaktowany? (opcjonalnie)',
    channelAny: 'Bez preferencji',
    channelEmail: 'E-mailem',
    channelPhone: 'Telefonicznie',
    message: 'Twoja wiadomość',
    messagePh: 'Co się stało? Co chcesz nam przekazać?',
    ctxLabel: 'Te dane techniczne są dołączane automatycznie, aby pomóc w diagnozie:',
    send: 'Wyślij',
    sending: 'Wysyłanie …',
    cancel: 'Anuluj',
    close: 'Zamknij',
    sent: 'Dziękujemy! Twoja wiadomość dotarła – skontaktujemy się z Tobą.',
    errEmail: 'Podaj prawidłowy adres e-mail.',
    errPhone: 'Podaj prawidłowy numer telefonu.',
    errContact: 'Podaj adres e-mail lub numer telefonu, abyśmy mogli odpowiedzieć.',
    errMessage: 'Opisz krótko swoją sprawę.',
  },
}

// Loaded main bundle (as a lightweight version/deploy marker for diagnosis).
function bundleMarker() {
  try {
    const el = document.querySelector('script[src*="/assets/index-"]')
    const src = el?.getAttribute('src') || ''
    const m = src.match(/index-[A-Za-z0-9_-]+\.js/)
    return m ? m[0] : ''
  } catch { return '' }
}

// Gerät in Klartext: Betriebssystem, Browser und – entscheidend für Mikrofon-
// Probleme – ob die App vom Startbildschirm im Vollbild läuft (dann gibt es keine
// Adressleiste und die Freigabe geht nur über die Systemeinstellungen).
// Der volle User-Agent bleibt zusätzlich erhalten; diese Zeile ist die lesbare
// Zusammenfassung, damit im Ticket sofort „iOS oder Android?" beantwortet ist.
function deviceSummary() {
  try {
    const ua = navigator.userAgent || ''
    let os = 'unbekannt'
    let m
    if ((m = ua.match(/Android\s+([\d.]+)/)))            os = `Android ${m[1]}`
    else if (/iPhone|iPad|iPod/.test(ua))                os = `iOS${(m = ua.match(/OS (\d+[_\d]*)/)) ? ' ' + m[1].replace(/_/g, '.') : ''}${/iPad/.test(ua) ? ' (iPad)' : ' (iPhone)'}`
    else if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) os = 'iPadOS'
    else if (/Windows NT/.test(ua))                      os = 'Windows'
    else if (/Mac OS X/.test(ua))                        os = 'macOS'
    else if (/Linux/.test(ua))                           os = 'Linux'

    let br = 'unbekannt'
    if (/FBAN|FBAV|Instagram|Line\/|WhatsApp/.test(ua))  br = 'In-App-Browser (Facebook/Instagram/WhatsApp)'
    else if (/EdgA?\//.test(ua))                         br = 'Edge'
    else if (/SamsungBrowser/.test(ua))                  br = 'Samsung Internet'
    else if (/FxiOS|Firefox/.test(ua))                   br = 'Firefox'
    else if (/CriOS/.test(ua))                           br = 'Chrome (iOS)'
    else if (/Chrome\//.test(ua))                        br = 'Chrome'
    else if (/Safari/.test(ua))                          br = 'Safari'

    let mode = 'Browser (mit Adressleiste)'
    if (window.matchMedia?.('(display-mode: standalone)')?.matches
        || window.matchMedia?.('(display-mode: fullscreen)')?.matches
        || window.navigator.standalone === true) {
      mode = 'installierte App vom Startbildschirm (Vollbild, KEINE Adressleiste)'
    }
    return `${os} · ${br} · ${mode}`
  } catch { return '' }
}

// Menschlich lesbare Beschriftungen der Diagnose-Felder.
const CTX_LABELS = {
  role: 'Rolle', code: 'Buch-Code', category: 'Kategorie', view: 'Ansicht',
  lang: 'Sprache', lastError: 'Letzte Meldung', device: 'Gerät', micPerm: 'Mikrofon-Freigabe',
  browser: 'Browser', bundle: 'App-Version', time: 'Zeitpunkt',
}
const MIC_PERM_LABEL = { granted: 'erteilt', denied: 'blockiert', prompt: 'noch nicht entschieden', unknown: 'unbekannt' }
const ROLE_LABEL = { enduser: 'Endnutzer', contributor: 'Beitragende:r', manager: 'Manager', admin: 'Administrator' }

function buildContext(opts) {
  const ctx = {}
  if (opts.role) ctx.role = ROLE_LABEL[opts.role] || opts.role
  if (opts.code) ctx.code = opts.code
  if (opts.category) ctx.category = opts.category
  if (opts.view) ctx.view = opts.view
  if (opts.lang) ctx.lang = opts.lang
  // 1200 statt 300 Zeichen: Fehlermeldungen mit Handlungsanweisung wurden vorher
  // mitten im Satz abgeschnitten, gerade die wichtigen Hinweise am Ende fehlten.
  if (opts.lastError) ctx.lastError = String(opts.lastError).slice(0, 1200)
  const dev = deviceSummary(); if (dev) ctx.device = dev
  if (opts.micPerm) ctx.micPerm = MIC_PERM_LABEL[opts.micPerm] || String(opts.micPerm)
  try { ctx.browser = navigator.userAgent } catch { /* egal */ }
  const b = bundleMarker(); if (b) ctx.bundle = b
  ctx.time = new Date().toISOString()
  return ctx
}

function SupportModal({ opts, onClose }) {
  const s = L10N[opts.lang] || L10N.de
  const context = buildContext(opts)
  const [name, setName]   = useState(opts.suggestedName || '')
  const [email, setEmail] = useState(opts.suggestedEmail || '')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState('')   // '' = keine Vorliebe | 'email' | 'phone'
  const [message, setMessage] = useState('')
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')
  const [done, setDone]   = useState(false)

  async function submit(e) {
    e?.preventDefault()
    if (busy) return
    const em = email.trim(), ph = phone.trim()
    // Rückkanal: E-Mail ODER Telefon genügt, aber eines von beiden brauchen wir.
    if (!em && !ph)                  { setErr(s.errContact); return }
    if (em && !EMAIL_RE.test(em))    { setErr(s.errEmail); return }
    if (ph && !PHONE_RE.test(ph))    { setErr(s.errPhone); return }
    if (message.trim().length < 3)   { setErr(s.errMessage); return }
    setBusy(true); setErr('')
    try {
      await sendSupport({
        message: message.trim(),
        replyEmail: em || null,
        replyPhone: ph || null,
        // Der Wunsch zählt nur, wenn der Kanal auch hinterlegt ist.
        preferredChannel: (channel === 'email' && em) || (channel === 'phone' && ph) ? channel : null,
        name: name.trim() || null,
        context,
      })
      setDone(true)
    } catch (e2) { setErr(e2.message || 'Fehler') }
    finally { setBusy(false) }
  }

  const overlay = { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }
  const card    = { width:'100%', maxWidth:460, maxHeight:'90vh', overflowY:'auto', background:'#fff', borderRadius:14, padding:'20px 20px 22px', boxShadow:'0 12px 40px rgba(0,0,0,.25)' }
  const lbl     = { fontSize:12, color:'#78716c', fontWeight:600, display:'block', marginBottom:4 }
  const inp     = { width:'100%', marginBottom:12 }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <h2 style={{ fontSize:18, fontWeight:700, margin:0 }}>{s.title}</h2>
          <button onClick={onClose} aria-label="×" style={{ background:'none', border:'none', fontSize:24, cursor:'pointer', color:'#78716c', lineHeight:1 }}>×</button>
        </div>
        {done ? (
          <>
            <p style={{ fontSize:14, lineHeight:1.6, color:'#3f6212', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'12px 14px', margin:'10px 0 16px' }}>✓ {s.sent}</p>
            <div style={{ textAlign:'right' }}>
              <button onClick={onClose} style={{ fontSize:14, padding:'9px 16px' }}>{s.close}</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ fontSize:13.5, color:'#57534e', lineHeight:1.6, margin:'0 0 14px' }}>{s.intro}</p>
            <label style={lbl}>{s.name}</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} />
            <label style={lbl}>{s.email}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" placeholder="name@beispiel.de" style={{ ...inp, marginBottom:8 }} />
            <label style={lbl}>{s.phone}</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} dir="ltr" placeholder={s.phonePh} style={{ ...inp, marginBottom:4 }} />
            <div style={{ fontSize:11.5, color:'#a8a29e', marginBottom:12 }}>{s.emailHint}</div>

            {/* Kontaktwunsch: nur sinnvoll, wenn beide Kanäle hinterlegt sind. */}
            {email.trim() && phone.trim() && (
              <>
                <label style={lbl}>{s.channel}</label>
                <select value={channel} onChange={e => setChannel(e.target.value)} style={inp}>
                  <option value="">{s.channelAny}</option>
                  <option value="email">{s.channelEmail}</option>
                  <option value="phone">{s.channelPhone}</option>
                </select>
              </>
            )}

            <label style={lbl}>{s.message}</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} placeholder={s.messagePh}
              style={{ width:'100%', marginBottom:12, resize:'vertical', minHeight:96, fontFamily:'inherit' }} />

            {/* Diagnose-Kontext: unveränderbar angezeigt (Transparenz/Datenschutz). */}
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 12px', marginBottom:14 }}>
              <div style={{ fontSize:11.5, color:'#78716c', marginBottom:6, lineHeight:1.5 }}>{s.ctxLabel}</div>
              {Object.entries(context).map(([k, v]) => (
                <div key={k} style={{ fontSize:11.5, color:'#57534e', lineHeight:1.55, wordBreak:'break-word' }}>
                  <span style={{ color:'#a8a29e' }}>{CTX_LABELS[k] || k}:</span> {String(v)}
                </div>
              ))}
            </div>

            {err && <div style={{ fontSize:13, color:'#b91c1c', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 12px', marginBottom:12 }}>⚠ {err}</div>}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button type="button" className="ghost" onClick={onClose} style={{ fontSize:14, padding:'9px 14px', color:'#78716c' }}>{s.cancel}</button>
              <button type="submit" disabled={busy} style={{ fontSize:14, padding:'9px 18px' }}>{busy ? s.sending : s.send}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export function SupportProvider({ children }) {
  const [opts, setOpts] = useState(null)
  const openSupport = useCallback((o = {}) => setOpts(o), [])
  return (
    <SupportCtx.Provider value={openSupport}>
      {children}
      {opts && <SupportModal opts={opts} onClose={() => setOpts(null)} />}
    </SupportCtx.Provider>
  )
}
