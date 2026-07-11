import { useState, useEffect, useRef, Fragment } from 'react'
import JSZip from 'jszip'
import {
  createMemorial, getMemorial, getContribution, addContribution,
  askLLM, speakText, stopSpeaking, primeAudio, adminDeleteMemorial, adminSaveMemorialText, adminUpdateMemorialMeta, adminGenerateImage,
  uploadContributorImage, adminUploadImage, adminDeleteUpload, adminUpdateUpload, adminComposeImage,
  adminDeleteContribution, adminUpdateContributionMessages, adminSaveTranscriptCheck,
  getMemorialCosts,
  adminListUsers, adminCreateUser, adminUpdateUser, adminDeleteUser, adminListAudit,
  adminListCatalogs, adminCreateCatalog, adminUpdateCatalog, adminDeleteCatalog,
  adminListRecipients, adminAddRecipient, adminUpdateRecipient, adminDeleteRecipient, adminSendReportNow,
  getSettings, saveSettings, changeOwnPassword,
  getInvite, redeemInvite,
} from './api.js'
import { CATEGORIES, CATEGORY_ORDER, DEFAULT_CATEGORY, getCategory, categoryColor } from './categories.js'
import { IMAGE_STYLES, DEFAULT_IMAGE_STYLE, imageStyleLabel } from './imageStyles.js'
import { BOOK_LAYOUTS, DEFAULT_BOOK_LAYOUT, getBookLayout, bookLayoutLabel } from './bookLayouts.js'
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, langDirective, uiText, contributorL10n } from './i18n.js'
import CategoryIcon from './CategoryIcon.jsx'
import { reviewSystemPrompt, extractReviewText, contributionsContext } from './review.js'
import { applyCorrectionToMessages, revertCorrectionInMessages } from './transcript.js'
import { BOOK_DISCLAIMER, BOOK_DISCLAIMER_TITLE, formatContribution, downloadBlob, downloadFile, safeName, buildContributionPdf, dedupeContributors, downloadStructuredDocx, downloadPrintPdf, downloadAsDocx } from './bookExport.js'
import { CONSENT_VERSION } from './constants.js'
import { Impressum, Datenschutz, LegalFooter } from './LegalPages.jsx'
import { S, Lbl, Err, Back, Dots, PartnerBanner, col, th } from './ui.jsx'
import { uploadPrintInfo, ImageStylePicker, BookLayoutPicker } from './pickers.jsx'
import { fileToDownscaledDataURL, imageErrorDe, saveLocalSession, loadLocalSession, clearLocalSession, genContribId, unlockAudio } from './shared.js'
import { ContributorFlow } from './contributor.jsx'
import { GENDERS } from './constants.js'
import { cutoffDays, cutoffDate, cutoffString } from './shared.js'
import { AuditView, ReportsView, CostsView } from './adminViews.jsx'
import { formatEur, costKindLabel } from './shared.js'

// ── URL params ────────────────────────────────────────────────────
const urlParams     = new URLSearchParams(window.location.search)
const codeFromURL   = (urlParams.get('code') || '').toUpperCase().trim()
const inviteFromURL = (urlParams.get('invite') || '').trim() // Self-Onboarding eines neuen Benutzers

// Versions-Tag des Einwilligungstextes. Bei JEDER inhaltlichen Änderung des
// Consent-/Datenschutztextes hochzählen, damit protokolliert ist, welcher
// Fassung zugestimmt wurde.



// ── Passwortrichtlinie (identisch zu api/_lib/auth.js) ────────────
// Moderat: mind. 8 Zeichen, mind. 1 Ziffer, mind. 1 Sonderzeichen.
const PASSWORD_RULES_TEXT = 'Mindestens 8 Zeichen, davon mindestens eine Ziffer und ein Sonderzeichen.'
function passwordError(p) {
  const s = String(p ?? '')
  if (s.length < 8) return 'Passwort muss mindestens 8 Zeichen haben.'
  if (!/[0-9]/.test(s)) return 'Passwort muss mindestens eine Ziffer enthalten.'
  if (!/[^A-Za-z0-9]/.test(s)) return 'Passwort muss mindestens ein Sonderzeichen enthalten.'
  return null
}



// ── Hilfsfunktionen Download ──────────────────────────────────────

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
  // Falls die KI doch noch Text drumherum schreibt: ersten { bis letzten } isolieren
  const first = s.indexOf('{')
  const last  = s.lastIndexOf('}')
  if (first > 0 || (first === 0 && last > 0 && last < s.length - 1)) s = s.slice(first, last + 1)
  try { return JSON.parse(s) } catch {}
  // Zweiter Versuch: häufigen LLM-Ausrutscher „trailing comma" (Komma vor } oder ]) entfernen.
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')) } catch { return null }
}

// Prompt für die KI-Bildzuordnung: welche hochgeladenen Fotos passen in welches
// Kapitel? Liefert JSON { assignments: [{ chapter, image_ids:[…] }] }.
function imageAssignSystem(chapters, uploads) {
  const chapLines = chapters.map(c => `${c.number}. ${c.heading || ''}`).join('\n')
  // Auflösung/Format je Foto mitgeben: davon hängt ab, ob EIN Foto eine ganze
  // Doppelseite füllen kann (hochauflösendes Querformat) oder ob mehrere
  // (kleinere/gering aufgelöste) Fotos gemeinsam eine Seite tragen müssen.
  const upLines = uploads.map(u => {
    const res = (u.width && u.height) ? `${u.width}×${u.height}px` : 'Auflösung unbekannt'
    const solo = (u.orientation === 'landscape' && u.quality_flag !== 'low' && (u.width || 0) >= 1819 && (u.height || 0) >= 1276)
    const fit = solo ? 'füllt allein eine Doppelseite' : 'besser mit weiteren Fotos gruppieren'
    return `- id ${u.id}: ${u.caption ? '„' + u.caption + '" – ' : ''}${u.description || '(keine Beschreibung)'} [${u.orientation}, ${res}${u.quality_flag === 'low' ? ', geringe Qualität' : ''} → ${fit}]`
  }).join('\n')
  return `Du ordnest hochgeladene Fotos den Kapiteln eines Buches zu. Jedes Kapitel füllt im Druck EINE Doppelseite.

Kapitel:
${chapLines}

Fotos:
${upLines}

Ordne jedes Foto dem inhaltlich und zeitlich am besten passenden Kapitel zu (nutze Bildunterschrift und Beschreibung). Ein Kapitel darf mehrere Fotos bekommen (max. 4 – sie werden dann gemeinsam auf der Doppelseite angeordnet); nicht jedes Kapitel braucht eines. Lässt sich ein Foto nicht sinnvoll zuordnen, lass es weg.

Berücksichtige dabei die Auflösung: Ein hochauflösendes Querformat-Foto („füllt allein eine Doppelseite") darf ruhig als einziges Foto ein Kapitel bekommen. Mehrere kleine oder gering aufgelöste Fotos, die inhaltlich zusammenpassen, ordne bevorzugt GEMEINSAM einem Kapitel zu, damit sie zusammen eine volle, ansehnliche Seite ergeben, statt einzeln aufgeblasen zu werden.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "assignments": [
    { "chapter": <Kapitelnummer als Zahl>, "image_ids": ["id1", "id2"] }
  ]
}`
}

// Prompt: pro Kapitel das am besten passende REFERENZFOTO einer Person wählen
// (für die Personen-Ähnlichkeit der KI-Bilder, image-to-image). Nutzt Bildtitel/
// Beschreibung, um das Foto der im Kapitel behandelten Person zuzuordnen.
// Liefert JSON { refs: [{ chapter, image_id }] } – nur Kapitel mit klar passendem
// Personenfoto. Ein Foto darf für mehrere Kapitel dienen.
function faceRefSystem(chapters, uploads) {
  const chapLines = chapters.map(c => `${c.number}. ${c.heading || ''}`).join('\n')
  const upLines = uploads.map(u =>
    `- id ${u.id}: ${u.caption ? '„' + u.caption + '" – ' : ''}${u.description || '(keine Beschreibung)'} [${u.orientation}]`
  ).join('\n')
  return `Du wählst für die Kapitel eines Erinnerungsbuchs jeweils das am besten geeignete REFERENZFOTO einer Person. Dieses Foto dient später als Vorlage, damit ein KI-generiertes Bild die abgebildete Person ähnlich darstellt.

Kapitel:
${chapLines}

Hochgeladene Fotos:
${upLines}

Wähle je Kapitel EIN Foto, das die im Kapitel behandelte Person am klarsten zeigt. Nutze Bildtitel und Beschreibung, um Namen/Beziehung dem Kapitel zuzuordnen; Porträts/Hochkant-Fotos eignen sich meist besser. Ein Foto darf für mehrere Kapitel gewählt werden. Gibt es für ein Kapitel kein klar passendes Personenfoto (z. B. reines Landschafts-/Sachfoto oder unpassende Person), lass das Kapitel weg.

Gib REINES, GÜLTIGES JSON aus (kein Markdown, keine Erklärung):
{
  "refs": [
    { "chapter": <Kapitelnummer als Zahl>, "image_id": "<id>" }
  ]
}`
}




const BOOK_VARIANTS = [
  { value: 1, title: 'Variante 1', sub: 'Alle Beiträge werden als separate Buchkapitel veröffentlicht.' },
  { value: 2, title: 'Variante 2', sub: 'Die Biographie wird aus allen Inhalten neu erstellt; einzelne Beiträge sind nicht mehr erkennbar.' },
]

// Leeres Anlage-Formular (inkl. Produktkategorie + kategorieabhängige Felder).
const EMPTY_PICKUP = { name: '', addon: '', street: '', zip: '', city: '', country: 'Deutschland' }
const EMPTY_CREATE = {
  name: '', organizer: '', gender: '', bookVariant: 1,
  funeralDate: '', cutoffDays: 7, showIntroVideo: true,
  productCategory: DEFAULT_CATEGORY, intake: {},
  languages: [DEFAULT_LANGUAGE], note: '',
  pickupAddress: { ...EMPTY_PICKUP },
  catalogId: '', followups: 7,
  imageStyle: DEFAULT_IMAGE_STYLE,
  bookLayout: DEFAULT_BOOK_LAYOUT,
}

function qrCodeUrl(text, size = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(text)}`
}

// Farbe einer im Prüfbericht markierten Stelle nach Schweregrad.
function reviewMarkStyle(severity) {
  const base = { padding:'0 2px', borderRadius:3 }
  if (severity === 'hoch')   return { ...base, background:'#fecaca' }
  if (severity === 'mittel') return { ...base, background:'#fde68a' }
  return { ...base, background:'#fef08a' }
}

// Hebt im Prüfbericht gemeldete Zitate (marks = [{quote, severity}]) in einem
// Textabschnitt farbig hervor. Best effort: nur exakte Treffer werden markiert,
// der Bericht listet ohnehin alle Befunde.
function highlightParagraph(text, marks) {
  if (!marks || marks.length === 0) return text
  const ranges = []
  for (const m of marks) {
    const q = m.quote
    if (!q) continue
    let idx = text.indexOf(q)
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + q.length, severity: m.severity })
      idx = text.indexOf(q, idx + q.length)
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a.start - b.start)
  const nodes = []
  let pos = 0, k = 0
  for (const r of ranges) {
    if (r.start < pos) continue // Überlappung -> überspringen
    if (r.start > pos) nodes.push(text.slice(pos, r.start))
    nodes.push(<mark key={k++} style={reviewMarkStyle(r.severity)}>{text.slice(r.start, r.end)}</mark>)
    pos = r.end
  }
  if (pos < text.length) nodes.push(text.slice(pos))
  return nodes
}



// ── Stile ─────────────────────────────────────────────────────────

// ── KI-Prompts ────────────────────────────────────────────────────
// Die kategoriespezifischen Prompt-Builder liegen in src/categories.js.
// Sie werden über GENERATORS (Admin) bzw. getCategory(...).interviewSystem
// (Contributor-Flow) angesprochen.



// Bewertet ein hochgeladenes Foto für die Druckverwendung – gleiche Schwellen
// wie der Kompositor (Doppelseite 308×216 mm, Vollbild nur bei Querformat ab
// 150 DPI). Liefert Auflösungstext + Indikator (wie gut / wofür nutzbar).

// Foto-Verwaltung im Admin/Manager-Bereich (Detailansicht eines Gedenkbuchs):
// hochgeladene Fotos ansehen, Bildunterschrift/Beschreibung bearbeiten, löschen
// und eigene Fotos hinzufügen. `uploads` = selected.uploaded_images (mit
// signierten image_url/image_thumb_url); `onChange` aktualisiert selected.
function ManagerPhotos({ code, token, uploads, contributions, onChange }) {
  const list = Array.isArray(uploads) ? uploads : []
  const contribs = Array.isArray(contributions) ? contributions : []
  // Wer hat das Foto hochgeladen? Beitragende-Uploads tragen eine contribution_id
  // (Name über den Beitrag auflösen); Manager-Uploads sind als solche markiert.
  const uploaderLabel = u => {
    if (u.source === 'manager') return 'Manager (selbst hochgeladen)'
    const c = u.contribution_id ? contribs.find(x => x.id === u.contribution_id) : null
    return c?.contributor_name || 'Beitragende:r'
  }
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [editId, setEditId] = useState(null)
  const [editVals, setEditVals] = useState({ caption: '', description: '' })
  // Beim Upload wird das Bild NICHT sofort gespeichert, sondern zunächst hier
  // vorgehalten, bis Bildtitel + Bildbeschreibung eingegeben und mit „Hochladen"
  // bestätigt wurden. { image: dataURL, name, caption, description } | null.
  const [pending, setPending] = useState(null)
  const [zoom, setZoom]       = useState(null) // Foto groß ansehen (Lightbox)
  const inStyle = { width:'100%', padding:'8px 10px', border:'1px solid #d6d3d1', borderRadius:8, fontSize:13, boxSizing:'border-box' }

  async function onPick(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setErr('')
    try {
      const image = await fileToDownscaledDataURL(file)
      setPending({ image, name: file.name || '', caption: '', description: '' })
    } catch (e2) { setErr(e2.message) }
  }
  async function confirmUpload() {
    if (!pending) return
    setBusy(true); setErr('')
    try {
      const { image: entry } = await adminUploadImage(token, code, {
        image: pending.image, caption: pending.caption.trim(), description: pending.description.trim(),
      })
      onChange([...list, entry])
      setPending(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  async function remove(id) {
    if (!window.confirm('Dieses Foto entfernen?')) return
    setBusy(true); setErr('')
    try { await adminDeleteUpload(token, code, id); onChange(list.filter(u => u.id !== id)) }
    catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  function startEdit(u) { setEditId(u.id); setEditVals({ caption: u.caption || '', description: u.description || '' }) }
  async function saveEdit() {
    setBusy(true); setErr('')
    try {
      await adminUpdateUpload(token, code, { id: editId, caption: editVals.caption, description: editVals.description })
      onChange(list.map(u => u.id === editId ? { ...u, ...editVals } : u))
      setEditId(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginBottom:'1.5rem' }}>
      <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Fotos ({list.length})</h3>
      <div style={{ ...S.card }}>
        <p style={{ ...S.muted, fontSize:13, marginTop:0, marginBottom:12 }}>
          Hochgeladene Fotos werden bei der Bucherstellung berücksichtigt: die KI schlägt passende Kapitel vor, Hochkant-/mehrere Bilder werden auf der Doppelseite gruppiert. Die Bildunterschrift wird – wenn angegeben – ins Buch übernommen; die Beschreibung dient nur der Einordnung.
        </p>
        <Err msg={err} />
        {list.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:12, marginBottom:14 }}>
            {list.map(u => (
              <div key={u.id} style={{ border:'1px solid #e7e5e4', borderRadius:10, overflow:'hidden', background:'#faf9f7' }}>
                <img src={u.image_thumb_url || u.image_url} alt="" title="Größer ansehen"
                  onClick={() => setZoom(u.image_url || u.image_thumb_url)}
                  style={{ width:'100%', height:100, objectFit:'cover', display:'block', cursor:'zoom-in' }} />
                <div style={{ padding:'8px 9px' }}>
                  {(() => { const pi = uploadPrintInfo(u); return (
                    <div style={{ marginBottom:6 }}>
                      <div style={{ fontSize:11, color:'#a8a29e', marginBottom:4 }}>
                        {u.orientation === 'portrait' ? '↕ Hochkant' : u.orientation === 'landscape' ? '↔ Quer' : '□ Quadrat'} · {pi.res}
                      </div>
                      <div style={{ fontSize:11, color:'#78716c', marginBottom:4 }} title="Hochgeladen von">
                        👤 {uploaderLabel(u)}
                      </div>
                      <div style={{ display:'inline-block', fontSize:10.5, fontWeight:600, color:pi.color, background:pi.bg, borderRadius:6, padding:'2px 7px', lineHeight:1.3 }}>
                        {pi.label}
                      </div>
                      <div style={{ fontSize:10.5, color:'#78716c', marginTop:3, lineHeight:1.35 }}>{pi.use}</div>
                    </div>
                  )})()}
                  {editId === u.id ? (
                    <div>
                      <input value={editVals.caption} onChange={e => setEditVals(v => ({ ...v, caption:e.target.value }))} placeholder="Bildunterschrift" style={{ ...inStyle, marginBottom:6 }} maxLength={300} />
                      <textarea value={editVals.description} onChange={e => setEditVals(v => ({ ...v, description:e.target.value }))} placeholder="Beschreibung (für die KI)" style={{ ...inStyle, minHeight:48, resize:'vertical', marginBottom:6 }} maxLength={1000} />
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={saveEdit} disabled={busy} style={{ fontSize:12, padding:'6px 10px' }}>Speichern</button>
                        <button className="secondary" onClick={() => setEditId(null)} disabled={busy} style={{ fontSize:12, padding:'6px 10px' }}>Abbrechen</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize:12.5, fontWeight:600, minHeight:16 }}>{u.caption || <span style={{ color:'#a8a29e', fontWeight:400 }}>ohne Bildunterschrift</span>}</div>
                      {u.description && <div style={{ fontSize:11.5, color:'#78716c', marginTop:2, lineHeight:1.4 }}>{u.description}</div>}
                      <div style={{ display:'flex', gap:6, marginTop:8 }}>
                        <button className="secondary" onClick={() => startEdit(u)} style={{ fontSize:12, padding:'5px 9px' }}>Bearbeiten</button>
                        <button className="secondary" onClick={() => remove(u.id)} disabled={busy} style={{ fontSize:12, padding:'5px 9px', color:'#dc2626' }}>Entfernen</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {pending ? (
          // Sofort-Abfrage von Bildtitel + Bildbeschreibung VOR dem Speichern.
          <div style={{ border:'1px solid #d6d3d1', borderRadius:10, padding:12, background:'#faf9f7' }}>
            <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
              <img src={pending.image} alt="" style={{ width:110, height:110, objectFit:'cover', borderRadius:8, flexShrink:0, border:'1px solid #e7e5e4' }} />
              <div style={{ flex:1, minWidth:0 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:600, marginBottom:4 }}>Bildtitel <span style={{ color:'#a8a29e', fontWeight:400 }}>(optional, kommt ins Buch)</span></label>
                <input value={pending.caption} onChange={e => setPending(p => ({ ...p, caption:e.target.value }))} placeholder="z. B. Sonntagskaffee auf der Terrasse" style={{ ...inStyle, marginBottom:10 }} maxLength={300} autoFocus />
                <label style={{ display:'block', fontSize:12, fontWeight:600, marginBottom:4 }}>Bildbeschreibung <span style={{ color:'#a8a29e', fontWeight:400 }}>(zur Einordnung / für die KI)</span></label>
                <textarea value={pending.description} onChange={e => setPending(p => ({ ...p, description:e.target.value }))} placeholder="Wer/was ist zu sehen, wann und wo?" style={{ ...inStyle, minHeight:60, resize:'vertical' }} maxLength={1000} />
              </div>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:10 }}>
              <button onClick={confirmUpload} disabled={busy} style={{ fontSize:13, padding:'8px 16px' }}>{busy ? 'Wird hochgeladen …' : 'Hochladen'}</button>
              <button className="secondary" onClick={() => setPending(null)} disabled={busy} style={{ fontSize:13, padding:'8px 16px' }}>Abbrechen</button>
            </div>
          </div>
        ) : (
          <label className="secondary" style={{ display:'inline-block', cursor: busy ? 'default' : 'pointer', padding:'9px 16px', borderRadius:8, fontSize:14, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Wird hochgeladen …' : '＋ Foto hochladen'}
            <input type="file" accept="image/*,.heic,.heif" onChange={onPick} disabled={busy} style={{ display:'none' }} />
          </label>
        )}
      </div>

      {zoom && (
        <div onClick={() => setZoom(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:'2rem', cursor:'zoom-out' }}>
          <button onClick={() => setZoom(null)} title="Schließen"
            style={{ position:'fixed', top:14, right:20, fontSize:28, lineHeight:1, color:'#fff', background:'none', border:'none', cursor:'pointer' }}>×</button>
          <img src={zoom} alt="" onClick={e => e.stopPropagation()}
            style={{ maxWidth:'95vw', maxHeight:'88vh', objectFit:'contain', borderRadius:8, boxShadow:'0 8px 40px rgba(0,0,0,.5)' }} />
        </div>
      )}
    </div>
  )
}


// Liest die Claims (uid/admin/cats) direkt aus dem Session-Token. So ist die
// uid auch dann verfügbar, wenn die gespeicherte Session noch von vor einem
// Deploy stammt (in der sie nicht enthalten war).
function decodeToken(token) {
  try {
    const payload = String(token || '').split('.')[0]
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    return JSON.parse(atob(b64 + pad))
  } catch { return null }
}

// ── Admin-Dashboard (Standard-Eingang der Seite) ──────────────────
function Dashboard() {
  const [view, setView]               = useState('login') // login|list|create-category|create|created|detail|book-v1|book-v2|users
  const [token, setToken]             = useState(() => sessionStorage.getItem('lw_admin_token') || '')
  const [auth, setAuth]               = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('lw_admin_auth') || '') || { admin: false, cats: [], uid: null } }
    catch { return { admin: false, cats: [], uid: null } }
  })
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [memorials, setMemorials]     = useState([])
  const [selected, setSelected]       = useState(null)
  const [contributions, setContribs]  = useState([])
  const [transcriptReport, setTranscriptReport] = useState(false) // Transkript-Bericht-Modal offen?
  const [selectedContrib, setSelectedContrib] = useState(null)
  const [createForm, setCreateForm]   = useState({ ...EMPTY_CREATE })
  const [usersData, setUsersData]     = useState({ users: [] })
  const [userForm, setUserForm]       = useState({ username: '', cats: [], demo: true })
  const [createdInvite, setCreatedInvite] = useState(null) // { username, url } – nach Neuanlage angezeigt
  const [auditData, setAuditData]     = useState({ entries: [] })
  const [auditLoading, setAuditLoading] = useState(false)
  const [recipients, setRecipients]   = useState([])          // Tagesreport-Empfänger
  const [recipientForm, setRecipientForm] = useState({ email: '', name: '' })
  const [reportMsg, setReportMsg]     = useState('')          // Status nach Test-Versand
  const [logo, setLogo]               = useState(null)   // eigenes Firmenlogo (Data-URL)
  const [logoLoading, setLogoLoading] = useState(false)
  const [logoSaved, setLogoSaved]     = useState(false)
  const [pwForm, setPwForm]           = useState({ current: '', next: '', next2: '' })
  const [pwErr, setPwErr]             = useState('')
  const [pwSaved, setPwSaved]         = useState(false)
  const [createdCode, setCreatedCode] = useState('')
  const [catalogs, setCatalogs]       = useState([])    // Fragenkataloge (Auswahl beim Anlegen + Admin-Verwaltung)
  const [catalogForm, setCatalogForm] = useState(null)  // Editor-State (null = kein Editor offen)
  const [generating, setGenerating]   = useState({}) // { book_v1: true, ... }
  const [genProgress, setGenProgress] = useState({}) // { book_v1: 'Bild 3/7 …' }
  const [genPct, setGenPct]           = useState({}) // { book_v1: 42 } – Fortschritt in %
  const [genErr, setGenErr]           = useState({}) // { book_v1: 'Fehler …' } – Fehler PRO Variante (nicht global)
  const [genOwner, setGenOwner]       = useState({}) // { book_v1: <memorialId> } – welches Buchprojekt diese Variante generiert; Fortschritt/Fehler NUR dort anzeigen
  const [skipImages, setSkipImages]   = useState(false) // Debug: Bildgenerierung überspringen
  const [reviewingKey, setReviewingKey] = useState(null) // Feld, dessen Prüfung gerade läuft
  const [reviewPct, setReviewPct]       = useState(0)     // simulierter %-Fortschritt der Prüfung
  const [applyingFinding, setApplyingFinding] = useState(null) // "field:index" während Maßnahme läuft
  const [editingFinding, setEditingFinding]   = useState(null) // "field:index" beim manuellen Editieren
  const [editText, setEditText]               = useState('')
  const [editMode, setEditMode]               = useState(false) // Buch/Rede direkt bearbeiten
  const [editDraft, setEditDraft]             = useState(null)  // Arbeitskopie im Edit-Modus
  const [savingEdit, setSavingEdit]           = useState(false)
  const [orderEdit, setOrderEdit]             = useState(false) // Auftragsdaten bearbeiten
  const [orderDraft, setOrderDraft]           = useState(null)  // Arbeitskopie der Auftragsdaten
  const [orderSaving, setOrderSaving]         = useState(false)
  const [eulogyStyleModal, setEulogyStyleModal] = useState(false)
  const [genLangModal, setGenLangModal] = useState(null) // { key, extraArg } | null
  const [imgEditModal, setImgEditModal] = useState(null) // { key } | null – Bilder überarbeiten
  const [imgEditSel, setImgEditSel]     = useState(new Set()) // ausgewählte Kapitelindizes
  const [imgEditBusy, setImgEditBusy]   = useState(false)
  const [imgEditProgress, setImgEditProgress] = useState('')
  const [imgEditMsg, setImgEditMsg]     = useState('') // Erfolgsmeldung im Bilder-Modal (bleibt offen)
  const [imgZoom, setImgZoom]           = useState(null) // { url, heading } | null – Bild groß ansehen (Lightbox)
  const [reportModal, setReportModal] = useState(null)   // { title, field, report } | null
  const [costData, setCostData]       = useState(null)
  const [costsLoading, setCostsLoading] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [busy, setBusy]               = useState(false)
  const [deletingId, setDeletingId]   = useState('')
  const [copied, setCopied]           = useState('')
  const [err, setErr]                 = useState('')
  const [hoveredRow, setHoveredRow]   = useState(null) // { id, zone: 'main' | 'cost' }
  const [sort, setSort]               = useState({ key: 'cutoff', dir: 'asc' }) // Sortierung der Buchliste
  const [filters, setFilters]         = useState({}) // { colKey: [erlaubte Werte] } – fehlt = keine Filterung
  const [filterCol, setFilterCol]     = useState(null) // welches Spalten-Filtermenü offen ist

  useEffect(() => { if (token) loadMemorials(token) }, [])

  // Buch-/Redeansicht immer oben (bei der Titelseite) beginnen. Ohne das landet
  // man beim Öffnen durch das Nachladen der Kapitelbilder (lazy, ohne reservierten
  // Platz) via Scroll-Anchoring mitten im Buch (z. B. bei Kapitel 2).
  useEffect(() => {
    if (view === 'book-v1' || view === 'book-v2' || view === 'eulogy') window.scrollTo(0, 0)
  }, [view])

  // Fehlt der Anzeigename (z. B. Session von vor dem Deploy), serverseitig
  // nachladen – damit oben der echte Benutzername statt eines Platzhalters steht.
  useEffect(() => {
    if (!token || auth.username) return
    const uid = auth.uid ?? decodeToken(token)?.uid
    if (!uid) return
    getSettings(token)
      .then(d => {
        if (!d?.username) return
        setAuth(a => {
          const next = { ...a, username: d.username, uid: a.uid ?? uid }
          sessionStorage.setItem('lw_admin_auth', JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
  }, [token])

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
      const authInfo = { admin: Boolean(d.admin), cats: d.cats ?? [], uid: d.uid ?? null, username: d.username || username }
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
      loadCatalogs(t)   // Kataloge im Hintergrund laden (für Auswahl beim Anlegen)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // Fragenkataloge laden (für die Auswahl beim Buch-Anlegen und die Verwaltung).
  // Fehler bewusst still – die Liste ist optional, ohne sie überlegt die KI selbst.
  async function loadCatalogs(t = token) {
    try {
      const d = await adminListCatalogs(t)
      setCatalogs(d.catalogs || [])
    } catch { /* still */ }
  }

  // ── Fragenkatalog-Editor (nur Admin) ──
  function newCatalog() { setErr(''); setCatalogForm({ id: null, name: '', cats: [], chapters: [{ title: '', questions: [''] }] }) }
  function editCatalog(c) {
    setErr('')
    setCatalogForm({
      id: c.id, name: c.name || '', cats: [...(c.product_categories || [])],
      chapters: (c.chapters && c.chapters.length)
        ? c.chapters.map(ch => ({ title: ch.title || '', questions: (ch.questions && ch.questions.length) ? [...ch.questions] : [''] }))
        : [{ title: '', questions: [''] }],
    })
  }
  async function saveCatalog() {
    const cf = catalogForm; if (!cf) return
    const payload = {
      name: cf.name.trim(),
      product_categories: cf.cats,
      chapters: cf.chapters
        .map(ch => ({ title: ch.title.trim(), questions: ch.questions.map(q => q.trim()).filter(Boolean) }))
        .filter(ch => ch.title || ch.questions.length),
    }
    if (!payload.name) { setErr('Bitte einen Namen für den Katalog vergeben.'); return }
    setBusy(true); setErr('')
    try {
      if (cf.id) await adminUpdateCatalog(token, cf.id, payload)
      else await adminCreateCatalog(token, payload)
      setCatalogForm(null)
      await loadCatalogs()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  async function removeCatalog(c) {
    if (!window.confirm(`Fragenkatalog „${c.name}" löschen? Bücher, die ihn nutzen, fallen auf den KI-Standardmodus zurück.`)) return
    setBusy(true); setErr('')
    try { await adminDeleteCatalog(token, c.id); await loadCatalogs() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function openMemorial(memorial) {
    setSelected(memorial); setLoading(true); setErr('')
    setOrderEdit(false); setOrderDraft(null)
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

  // ── Auftragsdaten (Stammdaten) bearbeiten ──
  function startOrderEdit() {
    const m = selected
    if (!m) return
    setErr('')
    setOrderDraft({
      name: m.name || '',
      organizer: m.organizer || '',
      gender: m.gender || '',
      bookVariant: m.book_variant === 2 ? 2 : 1,
      funeralDate: m.funeral_date ? String(m.funeral_date).slice(0, 10) : '',
      cutoffDays: Number.isFinite(parseInt(m.cutoff_days, 10)) ? parseInt(m.cutoff_days, 10) : 7,
      showIntroVideo: m.show_intro_video !== false,
      intake: m.intake ? { ...m.intake } : {},
      languages: Array.isArray(m.languages) && m.languages.length ? [...m.languages] : ['de'],
      note: m.note || '',
      pickupAddress: m.pickup_address ? { ...EMPTY_PICKUP, ...m.pickup_address } : { ...EMPTY_PICKUP },
      imageStyle: m.image_style || DEFAULT_IMAGE_STYLE,
      bookLayout: m.book_layout || DEFAULT_BOOK_LAYOUT,
    })
    setOrderEdit(true)
  }

  function cancelOrderEdit() { setOrderEdit(false); setOrderDraft(null); setErr('') }

  async function saveOrderData() {
    if (!orderDraft || !selected) return
    const d = orderDraft
    if (!d.name.trim() || !d.organizer.trim()) { setErr('Name und Organisator dürfen nicht leer sein.'); return }
    setOrderSaving(true); setErr('')
    try {
      await adminUpdateMemorialMeta(token, selected.id, {
        name: d.name, organizer: d.organizer, gender: d.gender || null,
        bookVariant: d.bookVariant, funeralDate: d.funeralDate || null,
        cutoffDays: d.cutoffDays, showIntroVideo: d.showIntroVideo,
        intake: d.intake, languages: d.languages, note: d.note,
        pickupAddress: d.pickupAddress,
        imageStyle: d.imageStyle,
        bookLayout: d.bookLayout,
      })
      // Lokal spiegeln (Backend-Normalisierung nachbilden), damit Detail- und
      // Listenansicht ohne Neuladen aktuell sind.
      const pa = d.pickupAddress || {}
      const hasAddr = ['name', 'addon', 'street', 'zip', 'city'].some(k => (pa[k] || '').trim())
      const local = {
        name: d.name.trim(),
        organizer: d.organizer.trim(),
        gender: d.gender || null,
        book_variant: d.bookVariant === 2 ? 2 : 1,
        funeral_date: d.funeralDate || null,
        cutoff_days: Number.isFinite(parseInt(d.cutoffDays, 10)) && parseInt(d.cutoffDays, 10) >= 0 ? parseInt(d.cutoffDays, 10) : 7,
        show_intro_video: d.showIntroVideo !== false,
        intake: d.intake && Object.keys(d.intake).length ? d.intake : (d.intake || null),
        languages: (d.languages && d.languages.length) ? d.languages : ['de'],
        note: d.note.trim() || null,
        pickup_address: hasAddr ? { ...pa, country: (pa.country || '').trim() || 'Deutschland' } : null,
        image_style: d.imageStyle || DEFAULT_IMAGE_STYLE,
        book_layout: d.bookLayout || DEFAULT_BOOK_LAYOUT,
      }
      setSelected(s => ({ ...s, ...local }))
      setMemorials(ms => ms.map(x => x.id === selected.id ? { ...x, ...local } : x))
      setOrderEdit(false); setOrderDraft(null)
    } catch (e) { setErr(e.message) }
    finally { setOrderSaving(false) }
  }

  function logout() {
    sessionStorage.removeItem('lw_admin_token')
    sessionStorage.removeItem('lw_admin_auth')
    setToken(''); setAuth({ admin: false, cats: [], uid: null }); setView('login'); setUsername(''); setPassword('')
    setMemorials([]); setContribs([]); setSelected(null)
  }

  // Für den eingeloggten Benutzer freigeschaltete Kategorie-Slugs.
  const allowedSlugs = (auth.admin || auth.cats === '*')
    ? CATEGORY_ORDER
    : CATEGORY_ORDER.filter(s => Array.isArray(auth.cats) && auth.cats.includes(s))
  const showCategoryColumn = allowedSlugs.length > 1

  // Eigene Benutzer-ID: bevorzugt aus der Session, sonst aus dem Token
  // (robust gegen alte Sessions ohne uid). null = Env-Superadmin.
  const myUid  = auth.uid ?? decodeToken(token)?.uid ?? null
  // Anzeigename des eingeloggten Benutzers.
  const myName = auth.username || (myUid ? 'Benutzer' : 'Administrator')

  // Startet die Neuanlage: bei mehreren erlaubten Kategorien erst Auswahl,
  // sonst direkt das Formular der einzigen Kategorie.
  function startCreate() {
    setErr('')
    if (allowedSlugs.length <= 1) {
      const slug = allowedSlugs[0] || DEFAULT_CATEGORY
      setCreateForm({ ...EMPTY_CREATE, productCategory: slug, intake: {}, pickupAddress: { ...EMPTY_PICKUP } })
      setView('create')
    } else {
      setView('create-category')
    }
  }

  function chooseCategory(slug) {
    setCreateForm({ ...EMPTY_CREATE, productCategory: slug, intake: {}, pickupAddress: { ...EMPTY_PICKUP } })
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
        note: createForm.note?.trim() || null,
        pickupAddress: createForm.pickupAddress,
        catalogId: createForm.catalogId || null,
        followups: createForm.followups,
        imageStyle: createForm.imageStyle || DEFAULT_IMAGE_STYLE,
        bookLayout: createForm.bookLayout || DEFAULT_BOOK_LAYOUT,
      })
      setCreatedCode(code)
      setView('created')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  // ── Einstellungen (eigenes Firmenlogo) ──
  async function openSettings() {
    setErr(''); setLogoSaved(false); setLogoLoading(true); setView('settings')
    setPwForm({ current: '', next: '', next2: '' }); setPwErr(''); setPwSaved(false)
    try {
      const d = await getSettings(token)
      setLogo(d.logo || null)
    } catch (e) { setErr(e.message) }
    finally { setLogoLoading(false) }
  }

  function onLogoFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // erlaubt erneutes Wählen derselben Datei
    if (!file) return
    setErr(''); setLogoSaved(false)
    if (!/^image\//.test(file.type)) { setErr('Bitte eine Bilddatei auswählen.'); return }
    if (file.size > 1_000_000) { setErr('Das Logo ist zu groß (max. 1 MB).'); return }
    const reader = new FileReader()
    reader.onload = () => setLogo(reader.result)
    reader.onerror = () => setErr('Datei konnte nicht gelesen werden.')
    reader.readAsDataURL(file)
  }

  async function saveLogo(value) {
    setErr(''); setLogoSaved(false); setBusy(true)
    try {
      await saveSettings(token, { logo: value })
      setLogo(value)
      setLogoSaved(true)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  // Eigenes Passwort ändern (Einstellungen). Nur für Benutzerkonten.
  async function saveOwnPassword(e) {
    e?.preventDefault()
    setPwErr(''); setPwSaved(false)
    if (!pwForm.current) { setPwErr('Bitte das aktuelle Passwort eingeben.'); return }
    const policyErr = passwordError(pwForm.next)
    if (policyErr) { setPwErr(policyErr); return }
    if (pwForm.next !== pwForm.next2) { setPwErr('Die beiden neuen Passwörter stimmen nicht überein.'); return }
    setBusy(true)
    try {
      await changeOwnPassword(token, { currentPassword: pwForm.current, newPassword: pwForm.next })
      setPwForm({ current: '', next: '', next2: '' })
      setPwSaved(true)
    } catch (e) { setPwErr(e.message) }
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
  async function loadAudit() {
    setErr(''); setAuditLoading(true)
    try {
      const d = await adminListAudit(token, { limit: 200 })
      setAuditData(d)
    } catch (e) { setErr(e.message) } finally { setAuditLoading(false) }
  }
  function toggleUserFormCat(slug) {
    setUserForm(f => ({
      ...f,
      cats: f.cats.includes(slug) ? f.cats.filter(s => s !== slug) : [...f.cats, slug],
    }))
  }
  function inviteLink(tok) { return `${window.location.origin}/?invite=${encodeURIComponent(tok)}` }
  async function submitUser() {
    if (!userForm.username.trim()) { setErr('Benutzername erforderlich.'); return }
    setErr(''); setBusy(true)
    try {
      const u = await adminCreateUser(token, {
        username: userForm.username.trim(),
        allowed_categories: userForm.cats,
        demo: userForm.demo,
      })
      setUserForm({ username: '', cats: [], demo: true })
      if (u.invite_token) setCreatedInvite({ username: u.username, url: inviteLink(u.invite_token), demo: u.demo, demoError: u.demo_error })
      await loadUsers()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  function copyInviteLink(user) {
    if (!user.invite_token) return
    navigator.clipboard?.writeText(inviteLink(user.invite_token))
    setCreatedInvite({ username: user.username, url: inviteLink(user.invite_token) })
  }
  async function regenerateInvite(user) {
    setErr('')
    try {
      const d = await adminUpdateUser(token, user.id, { regenerate_invite: true })
      if (d.invite_token) {
        navigator.clipboard?.writeText(inviteLink(d.invite_token))
        setCreatedInvite({ username: user.username, url: inviteLink(d.invite_token) })
      }
      await loadUsers()
    } catch (e) { setErr(e.message) }
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
    const pw = window.prompt(`Neues Passwort für „${user.username}".\n${PASSWORD_RULES_TEXT}`)
    if (!pw) return
    const pwErr = passwordError(pw)
    if (pwErr) { window.alert(pwErr); return }
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

  // ── Tagesreport-Empfänger (nur Admin) ──
  async function loadRecipients() {
    setErr('')
    try { const d = await adminListRecipients(token); setRecipients(d.recipients || []) }
    catch (e) { setErr(e.message) }
  }
  async function submitRecipient() {
    const email = recipientForm.email.trim()
    if (!email) { setErr('E-Mail-Adresse erforderlich.'); return }
    setErr(''); setBusy(true)
    try {
      await adminAddRecipient(token, { email, name: recipientForm.name.trim() || null })
      setRecipientForm({ email: '', name: '' })
      await loadRecipients()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function toggleRecipient(r) {
    setErr('')
    try { await adminUpdateRecipient(token, r.id, { active: !r.active }); await loadRecipients() }
    catch (e) { setErr(e.message) }
  }
  async function removeRecipient(r) {
    if (!window.confirm(`Empfänger „${r.email}" entfernen?`)) return
    setErr('')
    try { await adminDeleteRecipient(token, r.id); await loadRecipients() }
    catch (e) { setErr(e.message) }
  }
  // Test-Versand: an eine eingegebene Adresse (sonst an alle aktiven Empfänger).
  async function sendReportNow(toOverride) {
    setErr(''); setReportMsg(''); setBusy(true)
    try {
      const d = await adminSendReportNow(token, toOverride ? { to: toOverride } : {})
      const parts = [`Report für ${d.date} erstellt`, `${d.sent}/${d.recipients} gesendet`, d.pdfBytes ? `PDF ${(d.pdfBytes / 1024).toFixed(0)} KB` : 'PDF fehlte']
      if (d.errors?.length) parts.push(`Fehler: ${d.errors.map(e => `${e.to} (${e.error})`).join('; ')}`)
      if (d.note) parts.push(d.note)
      setReportMsg(parts.join(' · '))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
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
        buch: { code: selected.id, name: selected.name, kategorie: selected.product_category },
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

  // Transkript-Korrektur rückgängig machen bzw. wieder anwenden (Bericht). Ändert
  // den Antworttext des Beitrags und den applied-Status der Korrektur; speichert
  // beides (ohne den „geprüft"-Stempel zu verändern).
  async function toggleTranscriptCorrection(contribId, corrId) {
    const c = contributions.find(x => x.id === contribId)
    if (!c) return
    const corrs = (Array.isArray(c.transcript_corrections) ? c.transcript_corrections : []).map(x => ({ ...x }))
    const corr = corrs.find(x => x.id === corrId)
    if (!corr) return
    const r = corr.applied ? revertCorrectionInMessages(c.messages, corr) : applyCorrectionToMessages(c.messages, corr)
    if (!r.ok) { setErr('Textstelle nicht gefunden – der Beitrag wurde evtl. zwischenzeitlich manuell geändert.'); return }
    corr.applied = !corr.applied
    setErr('')
    try {
      const updated = await adminSaveTranscriptCheck(token, contribId, { messages: r.messages, transcriptCorrections: corrs })
      setContribs(cs => cs.map(x => x.id === contribId ? { ...x, ...updated, transcript_corrections: corrs } : x))
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

  // Wählt per KI je Kapitel das beste Referenzfoto einer Person (anhand Bildtitel/
  // Beschreibung) für die Personen-Ähnlichkeit der KI-Bilder (image-to-image).
  // Rückgabe: { byChapter: {Kapitelnummer: path}, globalPath }. Der globalPath
  // (erstes Hochkant/erstes Foto) dient als Fallback für Kapitel ohne KI-Treffer.
  // Voll fehlertolerant: bei Problemen bleibt nur der Fallback. Serverseitig wird
  // die Referenz ohnehin nur genutzt, wenn AZURE_FLUX_IMG2IMG gesetzt ist.
  async function selectFaceRefs(chapters, uploads, kindKey, dir = '') {
    const list = Array.isArray(uploads) ? uploads : []
    const faceRef = list.find(u => u.orientation === 'portrait') || list[0]
    const globalPath = faceRef?.path || null
    const byChapter = {}
    if (list.length === 0 || !Array.isArray(chapters) || chapters.length === 0) return { byChapter, globalPath }
    const byId = {}
    for (const u of list) byId[u.id] = u
    try {
      const sys = faceRefSystem(chapters, list) + dir
      let parsed = null
      for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        const raw = await askLLM(sys, [{ role: 'user', content: 'Wähle die Referenzfotos jetzt (JSON).' }],
          { memorialCode: selected.id, kind: `${kindKey}_face_ref`, token })
        parsed = tryParseJSON(raw)
        if (!parsed && attempt < 2) await new Promise(r => setTimeout(r, 1200))
      }
      for (const r of (Array.isArray(parsed?.refs) ? parsed.refs : [])) {
        const u = byId[r.image_id]
        if (u?.path) byChapter[Number(r.chapter)] = u.path
      }
    } catch (e) { console.warn('Referenzfoto-Auswahl fehlgeschlagen (nicht kritisch):', e.message) }
    return { byChapter, globalPath }
  }

  // Bildgenerierung mit Auto-Retry. Zwei Klassen transienter Fehler:
  //  - 5xx/Timeout (FLUX läuft am 60s-Limit) → kurze Pause genügt.
  //  - Rate-Limit (FLUX „exceeded rate limit", pro-Minute-Kontingent in
  //    westeurope) → deutlich LÄNGER warten, sonst läuft man sofort wieder
  //    ins Limit. Jeder Versuch ist ein eigener Serverless-Call, das 60s-
  //    Budget wird also pro Versuch frisch vergeben – wir dürfen client-
  //    seitig beliebig lange warten.
  // `onWait(seconds, rateLimited)` darf optional den Fortschritt anzeigen.
  async function generateImageWithRetry(memorialId, prompt, { maxAttempts = 4, onWait, meta } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Grafikstil des Buchs bei JEDER Bildgenerierung mitgeben → alle Bilder
        // eines Buchs bleiben konsistent im gewählten Stil (Server hat zusätzlich
        // einen DB-Fallback). Explizites meta darf den Wert überschreiben.
        return await adminGenerateImage(token, memorialId, prompt, { imageStyle: selected?.image_style || DEFAULT_IMAGE_STYLE, ...(meta || {}) })
      } catch (e) {
        lastErr = e
        const msg = String(e?.message || '')
        const rateLimited = /rate.?limit|too many requests|exceeded|\b429\b/i.test(msg)
        // Auch ein 502 „Keine Bilddaten von FLUX erhalten" (FLUX wurde im
        // Zeitfenster nicht fertig) ist transient: ein erneuter Versuch mit
        // frischem 60-s-Budget gelingt fast immer.
        const transient = rateLimited || /HTTP 5\d\d|\b50[234]\b|bad gateway|timeout|timed out|FUNCTION_INVOCATION_TIMEOUT|fetch failed|keine bilddaten/i.test(msg)
        if (!transient || attempt === maxAttempts) throw e
        // Rate-Limit gilt pro Minute → 20s, 40s, 60s; sonst 3s, 6s, 9s.
        const waitMs = rateLimited ? 20000 * attempt : 3000 * attempt
        try { onWait?.(Math.round(waitMs / 1000), rateLimited) } catch {}
        await new Promise(r => setTimeout(r, waitMs))
      }
    }
    throw lastErr
  }

  // Kapitel-Generierung mit Auto-Retry: die KI liefert gelegentlich
  // ungültiges JSON oder läuft ins 60s-Timeout — beides ist transient,
  // ein zweiter/dritter Versuch klappt meistens.
  async function generateChapterWithRetry(sys, memorialCode, kind, { maxAttempts = 3 } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const chRaw = await askLLM(
          sys,
          [{ role: 'user', content: 'Erzeuge jetzt dieses eine Kapitel als JSON.' }],
          { memorialCode, kind, token }
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

  // Inhalts-/Datenschutzprüfung des fertigen Textes (separater KI-Call),
  // gespeichert in content_reports[field]. Genutzt von generate() und vom
  // Button „Prüfung wiederholen". Immer eine FRISCHE Prüfung: alle Befunde
  // sind offen. Da Korrekturen fest im Buchtext gespeichert sind, findet die
  // Prüfung bereits behobene Stellen schlicht nicht mehr.
  async function runContentReview(field, value) {
    try {
      const reportRaw = await askLLM(
        reviewSystemPrompt(selected),
        [{ role: 'user', content: `BUCHTEXT:\n${extractReviewText(value)}\n\n${contributionsContext(contributions)}` }],
        { memorialCode: selected.id, kind: 'review', token }
      )
      const parsed = tryParseJSON(reportRaw) || {}
      const report = {
        checked_at: new Date().toISOString(),
        model: 'KI (serverseitig gewählt)',
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      }
      await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: report })
      return report
    } catch (e) {
      try {
        await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: { checked_at: new Date().toISOString(), error: e.message || String(e) } })
      } catch {}
      throw e
    }
  }

  // Prüfung erneut auf den bereits gespeicherten Text anwenden (ohne neu zu
  // generieren) – praktisch zum Testen.
  async function recheck(key) {
    const gen = GENERATORS[key]
    const value = selected?.[gen.field]
    if (!value) return
    setReviewingKey(key); setErr(''); setReviewPct(0)
    // Simulierter Fortschritt: ein einzelner KI-Call liefert keinen echten
    // Zwischenstand; wir lassen die Anzeige gleichmäßig bis 90 % hochlaufen.
    // Gleichmäßig und bewusst langsam bis 92 % (ein einzelner KI-Call hat
    // keinen echten Zwischenstand); springt bei Abschluss auf 100 %.
    const iv = setInterval(() => {
      setReviewPct(p => Math.min(92, p + 2))
    }, 800)
    try {
      await runContentReview(gen.field, value)
      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json()
        setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) setSelected(u)
      }
      setReviewPct(100)
    } catch (e) { setErr(`Prüfung fehlgeschlagen: ${e.message}`) }
    finally { clearInterval(iv); setReviewingKey(null) }
  }

  // Wendet die vorgeschlagene Maßnahme eines Befunds direkt im Text an
  // (mode = 'delete' | 'rephrase'), speichert und markiert den Befund als
  // erledigt. field = 'book_v1' | 'book_v2' | 'eulogy_text'.
  async function applyFinding(field, index, mode) {
    const report = selected?.content_reports?.[field]
    const value = selected?.[field]
    const finding = report?.findings?.[index]
    if (!finding || value == null) return

    // Als unkritisch markieren: keine Textänderung, kein KI-Call, kein
    // Historien-Eintrag (es wurde ja nichts überarbeitet).
    if (mode === 'accept') {
      setApplyingFinding(`${field}:${index}`); setErr('')
      try {
        const newFindings = report.findings.map((f, i) => i === index
          ? { ...f, status: 'resolved', resolution: 'accept', resolved_at: new Date().toISOString() }
          : f)
        const newReport = { ...report, findings: newFindings }
        await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: newReport })
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const fresh = await r.json(); setMemorials(fresh)
          const u = fresh.find(m => m.id === selected.id)
          if (u) { setSelected(u); setReportModal(mm => mm ? { ...mm, report: u.content_reports?.[field] } : mm) }
        } else {
          setSelected(s => ({ ...s, content_reports: { ...(s.content_reports || {}), [field]: newReport } }))
          setReportModal(mm => mm ? { ...mm, report: newReport } : mm)
        }
      } catch (e) { setErr(`Aktion fehlgeschlagen: ${e.message}`) }
      finally { setApplyingFinding(null) }
      return
    }

    const quote = String(finding.quote || '')
    if (!quote) { setErr('Dieser Befund hat kein Zitat, das automatisch geändert werden kann.'); return }
    setApplyingFinding(`${field}:${index}`); setErr('')
    try {
      const isBook = value && typeof value === 'object' && Array.isArray(value.chapters)
      let chapterIdx = -1, target
      if (isBook) {
        chapterIdx = value.chapters.findIndex(ch => String(ch.body || '').includes(quote))
        if (chapterIdx === -1) throw new Error('Textstelle im Buch nicht gefunden (evtl. bereits geändert).')
        target = value.chapters[chapterIdx].body
      } else {
        if (!String(value).includes(quote)) throw new Error('Textstelle nicht gefunden (evtl. bereits geändert).')
        target = String(value)
      }
      let corrected, newText
      if (mode === 'delete') {
        // Stelle entfernen und Tippfehler-Artefakte (doppelte Leerzeichen,
        // Leerzeichen vor Satzzeichen, leere Absätze) glätten.
        corrected = target.replace(quote, '')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\s+([.,;:!?])/g, '$1')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        newText = ''
      } else {
        // Gezielt nur die Stelle umformulieren -> KI liefert den Ersatztext.
        const ctxPara = String(target).split('\n\n').find(p => p.includes(quote)) || quote
        const sys = 'Du bist ein sorgfältiger Lektor. Formuliere NUR die markierte Stelle neutral um, sodass der beanstandete Inhalt entfällt, der Ton aber erhalten bleibt und sie sich nahtlos in den umgebenden Text einfügt. Gib AUSSCHLIESSLICH den Ersatztext zurück – ohne Anführungszeichen, ohne Erklärung, ohne Markdown.'
        const user = `UMGEBENDER ABSATZ:\n${ctxPara}\n\nZU ERSETZENDE STELLE:\n${quote}\n\nHINWEIS DER PRÜFUNG:\n${finding.note || ''}`
        newText = String(await askLLM(sys, [{ role: 'user', content: user }], { memorialCode: selected.id, kind: 'review_fix', token })).trim().replace(/^[„"»«\s]+|[„"»«\s]+$/g, '')
        if (!newText) throw new Error('Leere Antwort der KI.')
        corrected = target.replace(quote, newText)
      }

      const newValue = isBook
        ? { ...value, chapters: value.chapters.map((ch, i) => i === chapterIdx ? { ...ch, body: corrected } : ch) }
        : corrected
      await adminSaveMemorialText(token, selected.id, field, newValue)

      const newFindings = report.findings.map((f, i) => i === index
        ? { ...f, status: 'resolved', resolution: mode, resolved_at: new Date().toISOString(), new_text: newText }
        : f)
      const newReport = { ...report, findings: newFindings }
      await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: newReport })

      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json()
        setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) { setSelected(u); setReportModal(mm => mm ? { ...mm, report: u.content_reports?.[field] } : mm) }
      } else {
        setSelected(s => ({ ...s, [field]: newValue, content_reports: { ...(s.content_reports || {}), [field]: newReport } }))
        setReportModal(mm => mm ? { ...mm, report: newReport } : mm)
      }
    } catch (e) { setErr(`Maßnahme fehlgeschlagen: ${e.message}`) }
    finally { setApplyingFinding(null) }
  }

  // Abbruch-Wunsch je Generierung (Ref, damit der laufende async-Lauf den
  // aktuellen Wert sieht). Greift zwischen den Schritten: der gerade laufende
  // Einzel-Call (z. B. ein Kapitel) wird noch zu Ende geführt, danach Stopp.
  const cancelGenRef = useRef({})
  function cancelGenerate(key) {
    cancelGenRef.current[key] = true
    setGenProgress(p => ({ ...p, [key]: 'Wird abgebrochen …' }))
  }

  // Manuelles Bearbeiten des Korrekturtexts einer bereits umformulierten Stelle.
  // Ersetzt die aktuelle Formulierung im Buch durch die vom Nutzer editierte und
  // dokumentiert das als eigenen Historien-Eintrag ('edit').
  async function editFindingText(field, index, newText) {
    const report = selected?.content_reports?.[field]
    const value = selected?.[field]
    const finding = report?.findings?.[index]
    if (!finding || value == null) return
    const current = String(finding.new_text || '')
    const edited = String(newText || '').trim()
    if (!edited) { setErr('Der Korrekturtext darf nicht leer sein.'); return }
    if (edited === current) { setEditingFinding(null); return }
    setApplyingFinding(`${field}:${index}`); setErr('')
    try {
      const isBook = value && typeof value === 'object' && Array.isArray(value.chapters)
      let newValue
      if (isBook) {
        const ci = value.chapters.findIndex(ch => String(ch.body || '').includes(current))
        if (ci === -1) throw new Error('Aktuelle Formulierung im Buch nicht gefunden (evtl. zwischenzeitlich geändert).')
        newValue = { ...value, chapters: value.chapters.map((ch, i) => i === ci ? { ...ch, body: ch.body.replace(current, edited) } : ch) }
      } else {
        if (!String(value).includes(current)) throw new Error('Aktuelle Formulierung nicht gefunden.')
        newValue = String(value).replace(current, edited)
      }
      await adminSaveMemorialText(token, selected.id, field, newValue)
      const newFindings = report.findings.map((f, i) => i === index ? { ...f, new_text: edited, resolved_at: new Date().toISOString() } : f)
      const newReport = { ...report, findings: newFindings }
      await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: newReport })
      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json(); setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) { setSelected(u); setReportModal(mm => mm ? { ...mm, report: u.content_reports?.[field] } : mm) }
      } else {
        setSelected(s => ({ ...s, [field]: newValue, content_reports: { ...(s.content_reports || {}), [field]: newReport } }))
        setReportModal(mm => mm ? { ...mm, report: newReport } : mm)
      }
      setEditingFinding(null)
    } catch (e) { setErr(`Bearbeiten fehlgeschlagen: ${e.message}`) }
    finally { setApplyingFinding(null) }
  }

  // Direkt im „Ansehen/Bearbeiten"-Modus geänderten Buch-/Redetext speichern.
  async function saveEdit(field, draft) {
    setSavingEdit(true); setErr('')
    try {
      await adminSaveMemorialText(token, selected.id, field, draft)
      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json(); setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) setSelected(u)
      } else {
        setSelected(s => ({ ...s, [field]: draft }))
      }
      setEditMode(false); setEditDraft(null)
    } catch (e) { setErr(`Speichern fehlgeschlagen: ${e.message}`) }
    finally { setSavingEdit(false) }
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
    setGenErr(p => ({ ...p, [key]: '' })) // Fehler DIESER Variante zurücksetzen
    setGenOwner(o => ({ ...o, [key]: selected.id })) // Fortschritt an dieses Buchprojekt binden
    setGenerating(g => ({ ...g, [key]: true }))
    setGenProgress(p => ({ ...p, [key]: 'Text wird generiert …' }))
    setGenPct(p => ({ ...p, [key]: 0 }))
    cancelGenRef.current[key] = false
    // Bewusst KEIN View-Wechsel: der Fortschritt ist in der Buch-Übersicht
    // (Detail) direkt an der Karte sichtbar; der Nutzer bleibt im Kontext.
    // Fortschritt in % – Schritte: Gerüst + je Kapitel + je Bild + Prüfung.
    let stepsDone = 0
    let stepsTotal = 1
    const bumpPct = (inc = 1) => {
      stepsDone += inc
      setGenPct(p => ({ ...p, [key]: Math.min(99, Math.round((stepsDone / stepsTotal) * 100)) }))
    }
    const checkCancel = () => { if (cancelGenRef.current[key]) throw new Error('__CANCELLED__') }
    try {
      let value

      if (gen.kind === 'book') {
        // Phase 1: Buch-Gerüst (Titel/Untertitel und ggf. Kapitelliste) ─
        setGenProgress(p => ({ ...p, [key]: 'Buch-Gerüst wird geplant …' }))
        // Das Gerüst kann – wie einzelne Kapitel – gelegentlich als ungültiges
        // JSON zurückkommen (sporadischer Modell-Ausrutscher / Zeitüberschreitung).
        // Deshalb bis zu 3 Versuche mit Backoff, bevor wir aufgeben.
        const outlineSys = gen.outlineSystem(selected, contributions) + dir
        let outline = null, lastOutlineRaw = ''
        for (let attempt = 1; attempt <= 3; attempt++) {
          checkCancel()
          lastOutlineRaw = await askLLM(
            outlineSys,
            [{ role: 'user', content: 'Erzeuge jetzt das Gerüst als JSON.' }],
            { memorialCode: selected.id, kind: `${key}_outline`, token }
          )
          const parsed = tryParseJSON(lastOutlineRaw)
          if (parsed && parsed.title) { outline = parsed; break }
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
        }
        if (!outline) {
          const snip = String(lastOutlineRaw || '').replace(/\s+/g, ' ').trim().slice(0, 200)
          throw new Error('Buch-Gerüst konnte nicht als JSON gelesen werden (auch nach mehreren Versuchen).' +
            (snip ? ` Antwort des KI-Dienstes begann mit: „${snip}…"` : ' Der KI-Dienst lieferte eine leere Antwort (evtl. nicht erreichbar oder Zeitüberschreitung).'))
        }

        // Kapitel-Plan: V1 = aus Beiträgen abgeleitet, V2 = aus Outline
        const chapterPlans = key === 'book_v1'
          ? contributions.map((c, i) => ({ number: i + 1, contribution: c }))
          : (Array.isArray(outline.chapters) ? outline.chapters : [])
        if (chapterPlans.length === 0) throw new Error('Keine Kapitel im Buch-Gerüst gefunden.')

        // Gesamtschritte jetzt bekannt: Gerüst(1) + Kapitel + Bilder + Prüfung(1)
        stepsTotal = 1 + chapterPlans.length + (skipImages ? 0 : chapterPlans.length) + 1
        bumpPct() // Gerüst fertig
        checkCancel()

        // Phase 2: jedes Kapitel einzeln schreiben ──────────────────────
        const chapters = []
        const writeErrors = []
        for (let i = 0; i < chapterPlans.length; i++) {
          const plan = chapterPlans[i]
          setGenProgress(p => ({ ...p, [key]: `Kapitel ${i + 1}/${chapterPlans.length} wird geschrieben …` }))
          checkCancel()
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
              // Stabiler Schlüssel für die spätere Bild-Wiederverwendung (V1).
              ...(key === 'book_v1' && plan.contribution?.id ? {
                contribution_id: plan.contribution.id,
                contributor_name: plan.contribution.contributor_name,
                relationship: plan.contribution.relationship,
              } : {}),
            })
          } catch (e) {
            writeErrors.push(`Kapitel ${plan.number}: ${e.message}`)
            chapters.push({
              number: plan.number,
              heading: plan.heading || `Kapitel ${plan.number}`,
              body: '',
              image_prompt: '',
              generate_error: e.message || String(e),
              ...(key === 'book_v1' && plan.contribution?.id ? {
                contribution_id: plan.contribution.id,
                contributor_name: plan.contribution.contributor_name,
                relationship: plan.contribution.relationship,
              } : {}),
            })
          }
          bumpPct() // Kapitel fertig
        }

        value = {
          title: outline.title,
          subtitle: outline.subtitle || '',
          language: genLang,
          chapters,
        }

        // Phase 2b: hochgeladene Fotos den Kapiteln zuordnen ────────────
        // Erst deterministisch (Contributor-Fotos mit contribution_id → Kapitel
        // dieses Beitrags, nur V1), dann per KI für den Rest. Ergebnis:
        // chapterAssign[Kapitelnummer] = [uploadObj, …].
        const uploads = Array.isArray(selected.uploaded_images) ? selected.uploaded_images : []
        const chapterAssign = {}
        const assignById = {}
        for (const u of uploads) assignById[u.id] = u
        const assignedIds = new Set()
        const takeFor = (num, u) => { (chapterAssign[num] = chapterAssign[num] || []).push(u) }
        if (key === 'book_v1') {
          for (const ch of value.chapters) {
            if (!ch.contribution_id) continue
            for (const u of uploads) {
              if (u.contribution_id && u.contribution_id === ch.contribution_id && !assignedIds.has(u.id)) {
                takeFor(ch.number, u); assignedIds.add(u.id)
              }
            }
          }
        }
        const remainingUploads = uploads.filter(u => !assignedIds.has(u.id))
        if (remainingUploads.length > 0) {
          try {
            setGenProgress(p => ({ ...p, [key]: 'Fotos werden Kapiteln zugeordnet …' }))
            const sysAssign = imageAssignSystem(value.chapters, remainingUploads) + dir
            let parsed = null
            for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
              checkCancel()
              const raw = await askLLM(sysAssign, [{ role: 'user', content: 'Ordne die Fotos jetzt zu (JSON).' }],
                { memorialCode: selected.id, kind: `${key}_image_assign`, token })
              parsed = tryParseJSON(raw)
              if (!parsed && attempt < 2) await new Promise(r => setTimeout(r, 1500))
            }
            for (const a of (Array.isArray(parsed?.assignments) ? parsed.assignments : [])) {
              const num = Number(a.chapter)
              for (const id of (Array.isArray(a.image_ids) ? a.image_ids : [])) {
                const u = assignById[id]
                if (u && !assignedIds.has(u.id)) { takeFor(num, u); assignedIds.add(u.id) }
              }
            }
          } catch (e) { console.warn('Bildzuordnung fehlgeschlagen (nicht kritisch):', e.message) }
        }
        // Referenzfoto PRO Kapitel per KI wählen (Personen-Ähnlichkeit, image-to-
        // image): das Foto der jeweils im Kapitel behandelten Person – anhand
        // Bildtitel/Beschreibung. Fallback: erstes Hochkant/erstes Foto. Server
        // nutzt die Referenz nur, wenn AZURE_FLUX_IMG2IMG gesetzt ist.
        if (uploads.length > 0) setGenProgress(p => ({ ...p, [key]: 'Referenzfotos werden Kapiteln zugeordnet …' }))
        const { byChapter: faceRefByChapter, globalPath: faceRefGlobal } = await selectFaceRefs(value.chapters, uploads, key, dir)

        // Phase 3: Bilder pro Kapitel (sequenziell, mit Auto-Retry) ─────
        // Per Checkbox überspringbar (Debug: spart die langsame Bildphase).
        const total = value.chapters.length
        const imageErrors = []
        // Bild-Wiederverwendung: vorhandene Bilder des alten Buchs den neuen
        // Kapiteln zuordnen (V1 über contribution_id/Überschrift, V2 über
        // Überschrift/Position). Neue/zusätzliche Kapitel ohne Treffer bekommen
        // ein frisches Bild. `selected[gen.field]` ist hier noch die alte Version.
        // Bilder bleiben bei der Neu-Generierung immer erhalten; gezielt einzelne
        // Bilder neu erzeugen geht über „Bilder überarbeiten".
        const oldChapters = Array.isArray(selected[gen.field]?.chapters) ? selected[gen.field].chapters : []
        const normH = s => String(s || '').trim().toLowerCase()
        const oldByContrib = new Map()
        const oldByHeading = new Map()
        for (const oc of oldChapters) {
          if (!oc?.image_path) continue
          if (oc.contribution_id) oldByContrib.set(oc.contribution_id, oc.image_path)
          if (oc.heading) oldByHeading.set(normH(oc.heading), oc.image_path)
        }
        let reusedCount = 0
        let freshCount = 0 // Zähler echter FLUX-Calls (für sanftes Pacing)
        if (skipImages) {
          setGenProgress(p => ({ ...p, [key]: 'Bilder werden übersprungen …' }))
        } else {
          for (let i = 0; i < total; i++) {
            const ch = value.chapters[i]
            setGenProgress(p => ({ ...p, [key]: `Bild ${i + 1}/${total} wird erstellt …` }))
            checkCancel()
            // Zugeordnete Uploads → EIN komponiertes Landscape-Doppelseiten-Bild
            // (Hochkant/mehrere/geringe Qualität werden serverseitig sinnvoll
            // gruppiert, Bildunterschriften eingebrannt). Hat Vorrang vor FLUX.
            const assigned = (chapterAssign[ch.number] || []).slice(0, 4)
            if (assigned.length > 0) {
              setGenProgress(p => ({ ...p, [key]: `Bild ${i + 1}/${total}: Fotos werden gesetzt …` }))
              try {
                const { storagePath } = await adminComposeImage(token, selected.id,
                  assigned.map(u => ({ path: u.path, caption: u.caption, orientation: u.orientation })),
                  { variant: key, chapterNumber: ch.number, chapterHeading: ch.heading })
                value.chapters[i] = { ...ch, image_path: storagePath, image_error: null, from_upload: true }
              } catch (e) {
                console.warn(`Kompositor für Kapitel ${ch.number}:`, e.message)
                value.chapters[i] = { ...ch, image_error: e.message || String(e) }
                imageErrors.push(`Kapitel ${ch.number}: ${imageErrorDe(e.message)}`)
              }
              bumpPct()
              continue
            }
            // Wenn möglich vorhandenes Bild wiederverwenden (kein neuer Call).
            {
              let reusedPath = null
              if (ch.contribution_id && oldByContrib.has(ch.contribution_id)) reusedPath = oldByContrib.get(ch.contribution_id)
              else if (oldByHeading.has(normH(ch.heading))) reusedPath = oldByHeading.get(normH(ch.heading))
              else if (oldChapters[i]?.image_path) reusedPath = oldChapters[i].image_path
              if (reusedPath) {
                value.chapters[i] = { ...ch, image_path: reusedPath, image_error: null }
                reusedCount++
                bumpPct() // wiederverwendet – Schritt erledigt
                continue
              }
            }
            if (!ch.image_prompt) {
              value.chapters[i] = { ...ch, image_error: 'kein image_prompt im Kapitel' }
              imageErrors.push(`Kapitel ${ch.number}: ${imageErrorDe('kein image_prompt')}`)
              bumpPct() // Bild-Schritt erledigt
              continue
            }
            // Sanftes Pacing: vor jedem weiteren FLUX-Call kurz warten, damit
            // das pro-Minute-Rate-Limit gar nicht erst gerissen wird.
            if (freshCount > 0) await new Promise(r => setTimeout(r, 1500))
            freshCount++
            try {
              const refPath = faceRefByChapter[ch.number] || faceRefGlobal
              const refPaths = refPath ? [refPath] : []
              const { storagePath } = await generateImageWithRetry(selected.id, ch.image_prompt, {
                meta: { variant: key, chapterNumber: ch.number, chapterHeading: ch.heading, ...(refPaths.length ? { referencePaths: refPaths } : {}) },
                onWait: (s, rl) => setGenProgress(p => ({ ...p, [key]: rl
                  ? `Bild ${i + 1}/${total}: Rate-Limit erreicht – warte ${s}s und versuche es erneut …`
                  : `Bild ${i + 1}/${total}: erneuter Versuch in ${s}s …` })),
              })
              value.chapters[i] = { ...ch, image_path: storagePath, image_error: null }
            } catch (e) {
              console.warn(`Bild für Kapitel ${ch.number}:`, e.message)
              value.chapters[i] = { ...ch, image_error: e.message || String(e) }
              imageErrors.push(`Kapitel ${ch.number}: ${imageErrorDe(e.message)}`)
            }
            bumpPct() // Bild fertig
          }
        }

        const errLines = []
        if (writeErrors.length > 0) errLines.push(`${writeErrors.length}/${chapterPlans.length} Kapitel-Fehler. Erster: ${writeErrors[0]}`)
        if (imageErrors.length > 0) errLines.push(`${imageErrors.length}/${total} Bildgenerierungen fehlgeschlagen. Erster Fehler: ${imageErrors[0]}`)
        if (errLines.length > 0) setGenErr(p => ({ ...p, [key]: errLines.join(' · ') }))

        const saveMsg = reusedCount > 0
          ? `${reusedCount} Bild${reusedCount > 1 ? 'er' : ''} übernommen · wird gespeichert …`
          : 'Wird gespeichert …'
        setGenProgress(p => ({ ...p, [key]: saveMsg }))
      } else if (gen.kind === 'eulogy') {
        // Endtext (z. B. Rede) in mehrere Abschnitte aufgeteilt — jeder ein
        // eigener KI-Call, damit niemand am 60s-Limit von api/ask.js stirbt.
        const sections = gen.sections || []
        const parts = []
        const sectionErrors = []
        stepsTotal = sections.length + 1 // Abschnitte + Prüfung
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]
          setGenProgress(p => ({ ...p, [key]: `Abschnitt ${i + 1}/${sections.length}: ${section.label} …` }))
          checkCancel()
          try {
            const raw = await askLLM(
              gen.sectionSystem(selected, contributions, section, extraArg) + dir,
              [{ role: 'user', content: `Schreibe jetzt den Abschnitt „${section.label}" der ${gen.noun}.` }],
              { memorialCode: selected.id, kind: key, token }
            )
            const text = String(raw || '').trim()
            if (!text) throw new Error('leere Antwort')
            parts.push(text)
          } catch (e) {
            sectionErrors.push(`${section.label}: ${e.message}`)
          }
          bumpPct() // Abschnitt fertig
        }
        if (parts.length === 0) throw new Error(`Kein Abschnitt der ${gen.noun} konnte generiert werden.`)
        value = parts.join('\n\n')
        if (sectionErrors.length > 0) setGenErr(p => ({ ...p, [key]: `${sectionErrors.length}/${sections.length} Abschnitt-Fehler. Erster: ${sectionErrors[0]}` }))
        setGenProgress(p => ({ ...p, [key]: 'Wird gespeichert …' }))
      } else {
        // Sonstige Plain-Text-Generatoren (derzeit keiner)
        const raw = await askLLM(
          gen.system(selected, contributions, extraArg),
          [{ role: 'user', content: gen.userPrompt }],
          { memorialCode: selected.id, kind: key }
        )
        value = raw
      }

      await adminSaveMemorialText(token, selected.id, gen.field, value)

      // Inhalts-/Datenschutzprüfung des generierten Textes (separater KI-
      // Call). Fehler hier dürfen die Generierung NICHT scheitern lassen –
      // der Text ist bereits gespeichert.
      setGenProgress(p => ({ ...p, [key]: 'Inhaltsprüfung läuft …' }))
      try { await runContentReview(gen.field, value) }
      catch (e) { console.warn('Inhaltsprüfung fehlgeschlagen:', e.message) }
      bumpPct() // Prüfung fertig

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
      setGenPct(p => ({ ...p, [key]: 100 }))
    } catch (e) {
      const m = e.message === '__CANCELLED__'
        ? 'Generierung abgebrochen. Bereits erzeugte Inhalte wurden nicht gespeichert.'
        : `Generieren fehlgeschlagen: ${e.message}`
      setGenErr(p => ({ ...p, [key]: m }))
    }
    finally {
      setGenerating(g => ({ ...g, [key]: false }))
      setGenProgress(p => ({ ...p, [key]: '' }))
      setGenPct(p => ({ ...p, [key]: undefined }))
      cancelGenRef.current[key] = false
    }
  }

  async function downloadGenerated(key) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data) return
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}.docx`
      if (gen.kind === 'book') await downloadStructuredDocx(filename, data, contributions, selected.owner_logo, getBookLayout(selected.book_layout))
      else                     await downloadAsDocx(filename, `${gen.label} – ${selected.name}`, data)
    } catch (e) { setErr(`Download fehlgeschlagen: ${e.message}`) }
  }

  // Druckfertiges PDF (nur Bücher): doppelseitiges Bild, Kapitel beginnen rechts.
  async function downloadGeneratedPdf(key) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data || gen.kind !== 'book') return
    setErr('')
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}_Druck.pdf`
      await downloadPrintPdf(filename, data, contributions, selected.owner_logo, getBookLayout(selected.book_layout))
    } catch (e) { setErr(`Druck-PDF fehlgeschlagen: ${e.message}`) }
  }

  function pickEulogyStyle(style) {
    setEulogyStyleModal(false)
    requestGenerate('eulogy', style.instruction)
  }

  // Hat ein Buch bereits generierte Bilder?
  function bookHasImages(book) {
    return Array.isArray(book?.chapters) && book.chapters.some(c => c?.image_path)
  }

  // Startet die Generierung; bei mehreren angebotenen Sprachen wird zuvor die
  // Zielsprache abgefragt. Vorhandene Bilder werden bei der Neu-Generierung
  // automatisch beibehalten (siehe generate()); gezielt einzelne Bilder neu
  // erzeugen geht über „Bilder überarbeiten".
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

  // ── Bilder überarbeiten: gezielt einzelne Kapitelbilder neu generieren ──
  function openImgEdit(key) {
    setImgEditSel(new Set())
    setImgEditProgress('')
    setImgEditMsg('')
    setImgEditModal({ key })
  }
  function toggleImgSel(i) {
    setImgEditSel(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  }
  async function regenerateSelectedImages() {
    const m = imgEditModal
    if (!m) return
    const gen = GENERATORS[m.key]
    const book = selected?.[gen.field]
    const indices = [...imgEditSel].sort((a, b) => a - b)
    if (!book?.chapters || indices.length === 0) return
    setImgEditBusy(true); setErr(''); setImgEditMsg('')
    try {
      const newChapters = book.chapters.map(c => ({ ...c }))
      // Referenzfoto JE KAPITEL per KI wählen (Personen-Ähnlichkeit, nur server-
      // seitig aktiv bei AZURE_FLUX_IMG2IMG) – nur für die neu zu erzeugenden
      // Kapitel; Fallback: erstes Hochkant/erstes Foto.
      const ups = Array.isArray(selected.uploaded_images) ? selected.uploaded_images : []
      if (ups.length > 0) setImgEditProgress('Referenzfotos werden zugeordnet …')
      const { byChapter: refByChapter, globalPath: refGlobal } = await selectFaceRefs(indices.map(i => newChapters[i]), ups, m.key)
      const errs = []
      let done = 0
      for (const i of indices) {
        const ch = newChapters[i]
        setImgEditProgress(`Bild ${done + 1}/${indices.length} wird neu erstellt …`)
        if (!ch.image_prompt) { errs.push(`Kapitel ${ch.number}: ${imageErrorDe('kein Bild-Prompt')}`); done++; continue }
        // Sanftes Pacing gegen das pro-Minute-Rate-Limit (FLUX).
        if (done > 0) await new Promise(r => setTimeout(r, 1500))
        try {
          const refPath = refByChapter[ch.number] || refGlobal
          const refPaths = refPath ? [refPath] : []
          const { storagePath } = await generateImageWithRetry(selected.id, ch.image_prompt, {
            meta: { variant: m.key, chapterNumber: ch.number, chapterHeading: ch.heading, ...(refPaths.length ? { referencePaths: refPaths } : {}) },
            onWait: (s, rl) => setImgEditProgress(rl
              ? `Bild ${done + 1}/${indices.length}: Rate-Limit – warte ${s}s und versuche es erneut …`
              : `Bild ${done + 1}/${indices.length}: erneuter Versuch in ${s}s …`),
          })
          newChapters[i] = { ...ch, image_path: storagePath, image_url: undefined, image_error: null }
        } catch (e) {
          errs.push(`Kapitel ${ch.number}: ${imageErrorDe(e.message)}`)
          newChapters[i] = { ...ch, image_error: e.message || String(e) }
        }
        done++
      }
      setImgEditProgress('Wird gespeichert …')
      // Speichern; der Server räumt die nun verwaisten alten Bilddateien auf.
      await adminSaveMemorialText(token, selected.id, gen.field, { ...book, chapters: newChapters })
      // Neu laden, damit frische signierte Bild-URLs ankommen.
      try {
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const fresh = await r.json()
          setMemorials(fresh)
          const updated = fresh.find(x => x.id === selected.id)
          if (updated) setSelected(updated)
        }
      } catch {}
      if (errs.length) setErr(`${errs.length} Bild(er) fehlgeschlagen. Erster: ${errs[0]}`)
      // Modal bewusst OFFEN lassen, damit die neu erzeugten Bilder direkt
      // sichtbar sind (Thumbnails haben sich durch den Reload aktualisiert).
      const ok = indices.length - errs.length
      setImgEditMsg(ok > 0 ? `✓ ${ok} Bild${ok > 1 ? 'er' : ''} neu erstellt.` : '')
      setImgEditSel(new Set())
    } catch (e) {
      setErr(e.message)
    } finally {
      setImgEditBusy(false); setImgEditProgress('')
    }
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

  const imgEditOverlay = imgEditModal ? (() => {
    const gen = GENERATORS[imgEditModal.key]
    const book = selected?.[gen.field]
    const chapters = Array.isArray(book?.chapters) ? book.chapters : []
    const selCount = imgEditSel.size
    const allSel = chapters.length > 0 && selCount === chapters.length
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
        <div style={{ ...S.card, maxWidth: 720, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
            <div>
              <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 4px' }}>Bilder überarbeiten · {gen.label}</h2>
              <p style={{ ...S.muted, margin:0 }}>Wähle die Bilder aus, die neu generiert werden sollen. Die übrigen bleiben unverändert.</p>
            </div>
            <button
              className="ghost"
              disabled={imgEditBusy}
              onClick={() => setImgEditSel(allSel ? new Set() : new Set(chapters.map((_, i) => i)))}
              style={{ fontSize:13, whiteSpace:'nowrap' }}
            >
              {allSel ? 'Keine' : 'Alle'}
            </button>
          </div>

          <div style={{ overflowY:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', alignItems:'start', gap:12, padding:'4px 2px', flex:1 }}>
            {chapters.map((ch, i) => {
              const on = imgEditSel.has(i)
              return (
                <div
                  key={i}
                  onClick={() => !imgEditBusy && toggleImgSel(i)}
                  style={{
                    border:`2px solid ${on ? '#1c1917' : '#e7e5e4'}`, borderRadius:10,
                    // KEIN overflow:hidden auf der Kachel — das beschnitt die Beschriftung.
                    cursor: imgEditBusy ? 'default' : 'pointer', background:'#fff', position:'relative',
                  }}
                >
                  <div style={{ position:'relative', aspectRatio:'3 / 2', background:'#f5f5f4', borderTopLeftRadius:8, borderTopRightRadius:8, overflow:'hidden' }}>
                    {ch.image_url
                      ? <img
                          src={ch.image_thumb_url || ch.image_url}
                          alt={ch.heading || `Kapitel ${ch.number}`}
                          loading="lazy" decoding="async"
                          onError={(e) => { if (ch.image_thumb_url && e.currentTarget.src !== ch.image_url) e.currentTarget.src = ch.image_url }}
                          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
                        />
                      : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#a8a29e' }}>kein Bild</div>}
                    {ch.image_url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setImgZoom({ url: ch.image_url, heading: ch.heading || `Kapitel ${ch.number}` }) }}
                        title="Größer ansehen"
                        style={{
                          position:'absolute', top:6, left:6, width:24, height:24, borderRadius:6,
                          background:'rgba(255,255,255,.85)', border:'1px solid #d6d3d1', cursor:'zoom-in',
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, lineHeight:1, padding:0,
                        }}
                      >🔍</button>
                    )}
                    <div style={{
                      position:'absolute', top:6, right:6, width:22, height:22, borderRadius:6,
                      background: on ? '#1c1917' : 'rgba(255,255,255,.85)', border:`1px solid ${on ? '#1c1917' : '#d6d3d1'}`,
                      display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:14, fontWeight:700,
                    }}>{on ? '✓' : ''}</div>
                  </div>
                  <div style={{ padding:'7px 9px 11px' }}>
                    <div style={{ fontSize:11, color:'#a8a29e', marginBottom:2 }}>Kapitel {ch.number}</div>
                    {/* Volltext-Umbruch statt Zeilen-Clamp: die Überschrift wird nie abgeschnitten. */}
                    <div style={{ fontSize:13, fontWeight:600, lineHeight:1.35, wordBreak:'break-word' }}>{ch.heading || '—'}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {imgEditBusy && imgEditProgress && (
            <p style={{ fontSize:13, color:'#78716c', margin:'12px 0 0' }}>⏳ {imgEditProgress}</p>
          )}
          {!imgEditBusy && imgEditMsg && (
            <p style={{ fontSize:13, color:'#15803d', margin:'12px 0 0' }}>{imgEditMsg}</p>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:12 }}>
            <button className="ghost" onClick={() => setImgEditModal(null)} disabled={imgEditBusy} style={{ fontSize:14 }}>Schließen</button>
            <button onClick={regenerateSelectedImages} disabled={imgEditBusy || selCount === 0} style={{ fontSize:14, padding:'10px 18px' }}>
              {imgEditBusy ? 'Wird generiert …' : `✨ Auswahl neu generieren${selCount ? ` (${selCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    )
  })() : null

  // Lightbox: ein einzelnes Kapitelbild groß ansehen (über dem Rework-Dialog).
  const imgZoomOverlay = imgZoom ? (
    <div
      onClick={() => setImgZoom(null)}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.82)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:200, padding:'2rem', cursor:'zoom-out' }}
    >
      <button onClick={() => setImgZoom(null)} title="Schließen"
        style={{ position:'fixed', top:14, right:20, fontSize:28, lineHeight:1, color:'#fff', background:'none', border:'none', cursor:'pointer' }}>×</button>
      <img
        src={imgZoom.url}
        alt={imgZoom.heading || ''}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth:'95vw', maxHeight:'88vh', objectFit:'contain', borderRadius:8, boxShadow:'0 8px 40px rgba(0,0,0,.5)' }}
      />
      {imgZoom.heading && <div style={{ color:'#fff', marginTop:12, fontSize:14, textAlign:'center' }}>{imgZoom.heading}</div>}
    </div>
  ) : null

  // Transkriptions-Bericht: alle vom Cron vorgenommenen Korrekturen, je Änderung
  // mit „Rückgängig" (bzw. „Wieder anwenden").
  const transcriptReportOverlay = transcriptReport ? (() => {
    const items = contributions.flatMap(c => (Array.isArray(c.transcript_corrections) ? c.transcript_corrections : [])
      .map(x => ({
        ...x, contribId: c.id, contributor: c.contributor_name || 'Unbekannt',
        content: (Array.isArray(c.messages) && typeof c.messages[x.message_index]?.content === 'string') ? c.messages[x.message_index].content : '',
      })))
    return (
      <div onClick={() => setTranscriptReport(false)} style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:150, padding:'1rem', overflowY:'auto' }}>
        <div onClick={e => e.stopPropagation()} style={{ ...S.card, maxWidth:720, width:'100%', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
            <div>
              <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 4px' }}>🔎 Transkriptions-Bericht</h2>
              <p style={{ ...S.muted, margin:0, fontSize:13 }}>Klare Verhörer &amp; Eigennamen werden automatisch korrigiert („Rückgängig" stellt das Original wieder her). Störeinschübe/Fremdgeräusche werden nur <strong>vorgeschlagen</strong> — per „Anwenden" übernehmen. Jede Stelle mit Kontext.</p>
            </div>
            <button className="ghost" onClick={() => setTranscriptReport(false)} style={{ fontSize:22, lineHeight:1 }}>×</button>
          </div>
          {err && <div style={{ fontSize:13, color:'#991b1b', background:'#fee2e2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 10px', margin:'0 0 10px' }}>{err}</div>}
          <div style={{ overflowY:'auto', flex:1, display:'flex', flexDirection:'column', gap:10, padding:'4px 2px' }}>
            {items.length === 0 ? (
              <p style={S.muted}>Noch keine Korrekturen gefunden. Neue Beiträge werden im Hintergrund geprüft.</p>
            ) : items.map(corr => {
              const isSug = corr.kind === 'suggestion'
              const pending = isSug && !corr.applied
              // Kontext-Umgebung: aktuell im Text stehende Stelle (angewandt → after, sonst → before).
              const needle = corr.applied ? corr.after : corr.before
              const content = corr.content || ''
              const pos = needle ? content.indexOf(needle) : -1
              const R = 80
              const ctx = pos >= 0 ? {
                pre: (pos > R ? '… ' : '') + content.slice(Math.max(0, pos - R), pos),
                mid: content.slice(pos, pos + needle.length),
                post: content.slice(pos + needle.length, Math.min(content.length, pos + needle.length + R)) + (pos + needle.length + R < content.length ? ' …' : ''),
              } : null
              return (
                <div key={corr.id} style={{ border:`1px solid ${pending ? '#fde68a' : '#e7e5e4'}`, borderRadius:10, padding:'10px 12px', background: pending ? '#fffbeb' : (corr.applied ? '#fff' : '#faf9f7') }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:7 }}>
                    <span style={{ fontSize:12, color:'#a8a29e' }}>{corr.contributor}{isSug ? ' · Vorschlag' : ''}</span>
                    <button className="secondary" onClick={() => toggleTranscriptCorrection(corr.contribId, corr.id)}
                      style={{ fontSize:12, padding:'4px 10px', ...(corr.applied ? {} : { color:'#15803d', borderColor:'#bbf7d0' }) }}>
                      {corr.applied ? '↩ Rückgängig' : '✓ Anwenden'}
                    </button>
                  </div>
                  {ctx && (
                    <div style={{ fontSize:13, lineHeight:1.6, color:'#57534e', background:'#f5f5f4', borderRadius:6, padding:'7px 9px', marginBottom:7 }}>
                      {ctx.pre}
                      <span style={{ background: corr.applied ? '#dcfce7' : '#fee2e2', color: corr.applied ? '#166534' : '#991b1b', padding:'0 3px', borderRadius:3, fontWeight:600 }}>{ctx.mid}</span>
                      {ctx.post}
                    </div>
                  )}
                  <div style={{ fontSize:13, lineHeight:1.6 }}>
                    <span style={{ background:'#fee2e2', color:'#991b1b', textDecoration:'line-through', padding:'0 3px', borderRadius:3 }}>{corr.before}</span>
                    {' → '}
                    <span style={{ background:'#dcfce7', color:'#166534', padding:'0 3px', borderRadius:3 }}>{corr.after || '∅ (entfernen)'}</span>
                  </div>
                  {corr.reason && <div style={{ fontSize:12, color:'#78716c', marginTop:5 }}>{corr.reason}</div>}
                  {pending && <div style={{ fontSize:11.5, color:'#b45309', marginTop:4 }}>Vorschlag – wird erst mit „Anwenden" übernommen.</div>}
                  {!corr.applied && !isSug && <div style={{ fontSize:11.5, color:'#b45309', marginTop:4 }}>rückgängig gemacht – Originaltext aktiv.</div>}
                </div>
              )
            })}
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:12 }}>
            <button className="secondary" onClick={() => setTranscriptReport(false)} style={{ fontSize:14 }}>Schließen</button>
          </div>
        </div>
      </div>
    )
  })() : null

  const sevStyle = sev => sev === 'hoch' ? { color:'#b91c1c', background:'#fee2e2' }
    : sev === 'mittel' ? { color:'#b45309', background:'#fef3c7' }
    : { color:'#78716c', background:'#f5f5f4' }
  const reportOverlay = reportModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 640, width:'100%', maxHeight:'85vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
          <h2 style={{ fontSize:18, fontWeight:700, margin:0 }}>🛡 Prüfbericht – {reportModal.title}</h2>
          <button className="ghost" onClick={() => setReportModal(null)} style={{ fontSize:20, lineHeight:1, padding:'0 6px' }}>×</button>
        </div>
        {reportModal.report?.checked_at && (
          <p style={{ ...S.muted, fontSize:12, marginTop:0, marginBottom:12 }}>
            Automatische Inhalts-/Datenschutzprüfung vom {new Date(reportModal.report.checked_at).toLocaleString('de-DE')}.
            Hinweis: KI-gestützt, ersetzt keine juristische Prüfung.
          </p>
        )}
        {reportModal.report?.error ? (
          <p style={{ fontSize:14, color:'#b91c1c' }}>Die Prüfung ist fehlgeschlagen: {reportModal.report.error}</p>
        ) : (reportModal.report?.findings?.length ? (
          <>
            {reportModal.report.summary && (
              <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', marginTop:0, marginBottom:14 }}>{reportModal.report.summary}</p>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {reportModal.report.findings.map((f, i) => {
                const resolved = f.status === 'resolved'
                const applying = applyingFinding === `${reportModal.field}:${i}`
                return (
                <div key={i} style={{ border:'1px solid', borderColor: resolved ? '#bbf7d0' : '#e7e5e4', background: resolved ? '#f0fdf4' : '#fff', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:600, fontSize:13 }}>{f.category || 'Befund'}</span>
                    <span style={{ ...sevStyle(f.severity), fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6, textTransform:'uppercase' }}>{f.severity || '—'}</span>
                  </div>
                  {f.location && <p style={{ fontSize:12, color:'#78716c', margin:'0 0 6px' }}>📍 {f.location}</p>}
                  {(() => { const struck = resolved && f.resolution !== 'accept'; return f.quote && <p style={{ fontSize:13, fontStyle:'italic', color: struck ? '#a8a29e' : '#44403c', textDecoration: struck ? 'line-through' : 'none', margin:'0 0 6px', borderLeft:'3px solid #e7e5e4', paddingLeft:10 }}>„{f.quote}"</p> })()}
                  {resolved && f.resolution === 'rephrase' && (() => {
                    const editKey = `${reportModal.field}:${i}`
                    if (editingFinding === editKey) return (
                      <div style={{ margin:'4px 0 6px', paddingLeft:10, borderLeft:'3px solid #bbf7d0' }}>
                        <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3} style={{ width:'100%', fontFamily:'inherit', fontSize:13, resize:'vertical' }} />
                        <div style={{ display:'flex', gap:8, marginTop:6 }}>
                          <button onClick={() => editFindingText(reportModal.field, i, editText)} disabled={!!applyingFinding} style={{ fontSize:12, padding:'5px 10px' }}>{applyingFinding === editKey ? 'Speichert …' : 'Speichern'}</button>
                          <button onClick={() => setEditingFinding(null)} className="ghost" style={{ fontSize:12 }}>Abbrechen</button>
                        </div>
                      </div>
                    )
                    return f.new_text ? (
                      <p style={{ fontSize:13, fontStyle:'italic', color:'#15803d', margin:'0 0 6px', borderLeft:'3px solid #bbf7d0', paddingLeft:10 }}>
                        → „{f.new_text}"{' '}
                        <button className="ghost" onClick={() => { setEditingFinding(editKey); setEditText(f.new_text) }} style={{ fontSize:12, padding:'0 4px', textDecoration:'underline', fontStyle:'normal' }}>✏ bearbeiten</button>
                      </p>
                    ) : null
                  })()}
                  {f.note && <p style={{ fontSize:13, color:'#57534e', margin:0 }}>{f.note}</p>}
                  {f.source_contributor && (
                    <p style={{ fontSize:12, color:'#78716c', margin:'6px 0 0' }}>
                      👤 Quelle: <strong style={{ color:'#57534e' }}>{f.source_contributor}</strong>
                      {f.source_quote ? <> – „{f.source_quote}"</> : null}
                    </p>
                  )}
                  {resolved ? (
                    <p style={{ fontSize:12, color:'#15803d', margin:'8px 0 0', fontWeight:600 }}>
                      ✓ {f.resolution === 'delete' ? 'Im Text gelöscht' : f.resolution === 'accept' ? 'Als in Ordnung markiert' : 'Im Text umformuliert'}{f.resolved_at ? ` · ${new Date(f.resolved_at).toLocaleString('de-DE')}` : ''}
                    </p>
                  ) : reportModal.field ? (
                    <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap', alignItems:'center' }}>
                      <button onClick={() => applyFinding(reportModal.field, i, 'rephrase')} disabled={!!applyingFinding} style={{ fontSize:12, padding:'6px 10px' }}>
                        {applying ? 'Wird angewendet …' : '✏ Umformulieren'}
                      </button>
                      <button onClick={() => applyFinding(reportModal.field, i, 'delete')} disabled={!!applyingFinding} className="secondary" style={{ fontSize:12, padding:'6px 10px', color:'#b91c1c', borderColor:'#fecaca' }}>
                        🗑 Löschen
                      </button>
                      <button onClick={() => applyFinding(reportModal.field, i, 'accept')} disabled={!!applyingFinding} className="secondary" style={{ fontSize:12, padding:'6px 10px', color:'#15803d', borderColor:'#bbf7d0' }}>
                        ✓ In Ordnung
                      </button>
                    </div>
                  ) : null}
                </div>
                )
              })}
            </div>
          </>
        ) : (
          <p style={{ fontSize:14, color:'#15803d' }}>✓ Keine kritischen Aussagen gefunden.</p>
        ))}
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:16 }}>
          <button className="ghost" onClick={() => setReportModal(null)} style={{ fontSize:14 }}>Schließen</button>
        </div>
      </div>
    </div>
  ) : null


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
  if (view === 'list') {
    // Sortierbare + filterbare Spalten (Reihenfolge = Spaltenreihenfolge).
    //  val  = Sortierwert,  disp = angezeigter/filterbarer Wert (String)
    const sortCols = [
      { key: 'name',      label: 'Name',          val: m => (m.name || '').toLowerCase(), disp: m => m.name || '—' },
      ...(showCategoryColumn ? [{ key: 'category', label: 'Kategorie', val: m => getCategory(m.product_category).label.toLowerCase(), disp: m => getCategory(m.product_category).label }] : []),
      ...(auth.admin ? [{ key: 'owner', label: 'Inhaber', val: m => (m.owner_username || '').toLowerCase(), disp: m => m.owner_username || '—' }] : []),
      { key: 'organizer', label: 'Organisator',   val: m => (m.organizer || '').toLowerCase(), disp: m => m.organizer || '—' },
      { key: 'variant',   label: 'Variante',      val: m => m.book_variant || 0, disp: m => m.book_variant ? `Variante ${m.book_variant}` : '—' },
      { key: 'cutoff',    label: 'Erfassung bis', val: m => { const d = cutoffDate(m.funeral_date, cutoffDays(m)); return d ? d.getTime() : Infinity }, disp: m => cutoffString(m.funeral_date, cutoffDays(m)) },
      { key: 'answers',   label: 'Antworten',     val: m => m.answer_count || 0, disp: m => `${m.answer_count || 0} Antworten` },
      ...(auth.admin ? [{ key: 'cost', label: 'Kosten', val: m => m.cost_total_eur || 0, disp: m => formatEur(m.cost_total_eur) }] : []),
    ]
    const colByKey = k => sortCols.find(c => c.key === k) || sortCols[0]
    const distinctVals = col => [...new Set(memorials.map(col.disp))].sort((a, b) => String(a).localeCompare(String(b), 'de', { numeric: true }))
    // Sichtbarkeit: ein Buch passt, wenn es in JEDER aktiven Filterspalte einen
    // ausgewählten Wert hat. Fehlt der Filtereintrag, ist die Spalte ungefiltert.
    const visibleMemorials = memorials.filter(m => sortCols.every(c => {
      const sel = filters[c.key]
      return !sel || sel.includes(c.disp(m))
    }))
    const activeCol = colByKey(sort.key)
    const sortedMemorials = [...visibleMemorials].sort((a, b) => {
      const va = activeCol.val(a), vb = activeCol.val(b)
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), 'de')
      return sort.dir === 'asc' ? cmp : -cmp
    })
    const toggleSort = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

    // Filter-Helfer (filters[key] = Liste erlaubter disp-Werte; fehlt = alle).
    const filterActive = key => { const sel = filters[key]; return sel && sel.length < distinctVals(colByKey(key)).length }
    const valChecked = (key, v) => { const sel = filters[key]; return !sel || sel.includes(v) }
    const allChecked = key => { const sel = filters[key]; return !sel || sel.length === distinctVals(colByKey(key)).length }
    const toggleVal = (key, v) => setFilters(f => {
      const all = distinctVals(colByKey(key))
      const cur = f[key] ? [...f[key]] : [...all]
      const i = cur.indexOf(v)
      if (i >= 0) cur.splice(i, 1); else cur.push(v)
      if (cur.length === all.length) { const n = { ...f }; delete n[key]; return n } // alle = kein Filter
      return { ...f, [key]: cur }
    })
    const toggleAll = key => setFilters(f => {
      if (allChecked(key)) return { ...f, [key]: [] }        // alle abwählen
      const n = { ...f }; delete n[key]; return n             // alle anwählen = kein Filter
    })
    return (
    <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <span style={{ fontSize: 13, color: '#78716c', marginLeft: 12 }}>
            {visibleMemorials.length < memorials.length ? `${visibleMemorials.length} / ${memorials.length}` : memorials.length} {memorials.length === 1 ? 'Buch' : 'Bücher'}
          </span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize: 13, color: '#78716c', marginRight: 4 }}>
            Angemeldet als <strong style={{ color:'#1c1917', fontWeight:600 }}>{myName}</strong>
          </span>
          {auth.admin && (
            <button className="secondary" onClick={() => { loadUsers(); setErr(''); setView('users') }} style={{ fontSize: 13, padding: '7px 14px' }}>Benutzer</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadAudit(); setErr(''); setView('audit') }} style={{ fontSize: 13, padding: '7px 14px' }}>Audit-Log</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadCatalogs(); setCatalogForm(null); setErr(''); setView('catalogs') }} style={{ fontSize: 13, padding: '7px 14px' }}>Fragenkataloge</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadRecipients(); setReportMsg(''); setErr(''); setView('reports') }} style={{ fontSize: 13, padding: '7px 14px' }}>Report</button>
          )}
          {myUid && (
            <button className="secondary" onClick={openSettings} style={{ fontSize: 13, padding: '7px 14px' }}>Einstellungen</button>
          )}
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem', gap:12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Alle Bücher</h2>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {Object.keys(filters).length > 0 && (
              <button className="secondary" onClick={() => setFilters({})} style={{ fontSize:13, padding:'8px 12px' }}>Filter zurücksetzen</button>
            )}
            <button onClick={startCreate} style={{ fontSize:14, padding:'9px 16px' }}>
              + Neues Buch
            </button>
          </div>
        </div>
        <Err msg={err} />
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : memorials.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
            <p style={S.muted}>Noch keine Bücher angelegt. Beginnen Sie mit „+ Neues Buch".</p>
          </div>
        ) : (
          <>
            {filterCol && <div onClick={() => setFilterCol(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'visible' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {sortCols.map(c => (
                    <th key={c.key} style={{ ...th, whiteSpace: 'nowrap', position: 'relative', zIndex: filterCol === c.key ? 40 : undefined }}>
                      <span onClick={() => toggleSort(c.key)} title="Spalte sortieren" style={{ cursor: 'pointer', userSelect: 'none' }}>
                        {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                      </span>
                      <span onClick={(e) => { e.stopPropagation(); setFilterCol(k => k === c.key ? null : c.key) }}
                            title="Spalte filtern"
                            style={{ marginLeft: 6, cursor: 'pointer', color: filterActive(c.key) ? '#1d4ed8' : '#a8a29e' }}>▼</span>
                      {filterCol === c.key && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 4, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.14)', padding: 6, minWidth: 240, maxWidth: 360, maxHeight: 320, overflowY: 'auto', textAlign: 'left', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start', padding: '4px 6px', fontSize: 13, fontWeight: 600, color: '#1c1917', cursor: 'pointer' }}>
                            <input type="checkbox" checked={allChecked(c.key)}
                                   ref={el => { if (el) el.indeterminate = !allChecked(c.key) && (filters[c.key]?.length > 0) }}
                                   onChange={() => toggleAll(c.key)} style={{ flexShrink: 0, margin: 0, width: 15, height: 15 }} />
                            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>Alle</span>
                          </label>
                          <div style={{ borderTop: '1px solid #f5f5f4', margin: '4px 0' }} />
                          {distinctVals(c).map(v => (
                            <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start', padding: '4px 6px', fontSize: 13, color: '#44403c', cursor: 'pointer' }}>
                              <input type="checkbox" checked={valChecked(c.key, v)} onChange={() => toggleVal(c.key, v)} style={{ flexShrink: 0, margin: 0, width: 15, height: 15 }} />
                              <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </th>
                  ))}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {sortedMemorials.map(m => {
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
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:7 }}>
                          <span style={{ color:'#57534e', lineHeight:0 }}><CategoryIcon slug={m.product_category} size={18} /></span>
                          {getCategory(m.product_category).label}
                        </span>
                      </td>
                      )}
                      {auth.admin && (
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }} onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.owner_username || '—'}</td>
                      )}
                      <td style={mainCell}                                                onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.organizer}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.book_variant ? `Variante ${m.book_variant}` : '—'}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{cutoffString(m.funeral_date, cutoffDays(m))}</td>
                      <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        {(m.contribution_count || 0)} {(m.contribution_count === 1) ? 'Beitrag' : 'Beiträge'} · {(m.answer_count || 0)} {(m.answer_count === 1) ? 'Antwort' : 'Antworten'}
                      </td>
                      {auth.admin && (
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
                      )}
                      <td style={{ ...col, textAlign:'right' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(m) }}
                          disabled={deletingId === m.id}
                          className="secondary"
                          style={{ fontSize:12, padding:'6px 12px', color:'#dc2626', borderColor:'#fecaca' }}
                          title={`${getCategory(m.product_category).nounBook} löschen`}
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
          </>
        )}
      </div>
    </div>
    )
  }

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
          {allowedSlugs.map(slug => {
            const c = categoryColor(slug)
            return (
            <div
              key={slug}
              onClick={() => chooseCategory(slug)}
              style={{ ...S.card, cursor:'pointer', padding:'16px 16px', borderLeft:`4px solid ${c}`, transition:'border-color .15s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c; e.currentTarget.style.background = `${c}0d` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e7e5e4'; e.currentTarget.style.borderLeftColor = c; e.currentTarget.style.background = '#fff' }}
            >
              <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ color:c, flexShrink:0, lineHeight:0, marginTop:1 }}><CategoryIcon slug={slug} size={28} /></span>
                <div>
                  <div style={{ fontWeight:600, fontSize:15, marginBottom:4, color:c }}>{CATEGORIES[slug].label}</div>
                  <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{CATEGORIES[slug].description}</div>
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  )

  // ── NEUES BUCH (kategorie-spezifisches Formular) ──
  if (view === 'create') {
    const cat = getCategory(createForm.productCategory)
    const ci  = cat.intake
    const canSubmit = createForm.name && createForm.organizer && (!ci.useGender || createForm.gender) && !busy
    const pa = createForm.pickupAddress || EMPTY_PICKUP
    const setPa = patch => setCreateForm(f => ({ ...f, pickupAddress: { ...f.pickupAddress, ...patch } }))
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
          <Lbl>Grafikstil der Bilder</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Alle im Buch erzeugten Bilder entstehen konsistent in diesem Stil. Später im Dashboard änderbar.</p>
          <ImageStylePicker value={createForm.imageStyle} onChange={k => setCreateForm({ ...createForm, imageStyle: k })} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Buchlayout (Schrift &amp; Design)</Lbl>
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Gleiches Format, unterschiedliche Typografie. Später im Dashboard änderbar.</p>
          <BookLayoutPicker value={createForm.bookLayout} onChange={k => setCreateForm({ ...createForm, bookLayout: k })} />
        </div>
        {(() => {
          const avail = catalogs.filter(c => (c.product_categories || []).includes(createForm.productCategory))
          if (avail.length === 0) return null
          return (
            <div style={{ marginBottom: 24 }}>
              <Lbl>Fragenkatalog</Lbl>
              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px' }}>
                Standard: die KI überlegt sich die Interviewfragen selbst. Alternativ führt sie das Interview entlang eines vordefinierten Katalogs.
              </p>
              <select
                value={createForm.catalogId}
                onChange={e => setCreateForm({ ...createForm, catalogId: e.target.value })}
                style={{ width:'100%', padding:'10px 12px', fontSize:14, fontFamily:'inherit' }}
              >
                <option value="">KI überlegt selbst (Standard)</option>
                {avail.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {createForm.catalogId && (
                <div style={{ marginTop:12 }}>
                  <Lbl>Nachfragen pro Frage (max.)</Lbl>
                  <input
                    type="number" min={0} max={30} step={1}
                    value={createForm.followups}
                    onChange={e => { const v = e.target.value; setCreateForm({ ...createForm, followups: v === '' ? '' : Math.max(0, Math.min(30, parseInt(v, 10) || 0)) }) }}
                    style={{ width:120 }}
                  />
                  <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
                    Wie viele vertiefende Nachfragen die KI höchstens zu jeder Katalogfrage stellt. Der Beitragende kann jederzeit „weiter" sagen. Standard: 7.
                  </p>
                </div>
              )}
            </div>
          )
        })()}
        {createForm.productCategory === 'memorial' && (
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
        )}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Bemerkung</Lbl>
          <textarea
            value={createForm.note}
            onChange={e => setCreateForm({ ...createForm, note: e.target.value })}
            placeholder="Interne Notiz zu diesem Buch (optional) – wird bei der Bucherstellung angezeigt."
            rows={3}
            style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14 }}
          />
          <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
            Nur intern sichtbar. Wird bei der Bucherstellung angezeigt – z. B. Hinweise zur Gestaltung oder zum Inhalt.
          </p>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Sammelbestellungs-Adresse (optional)</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'2px 0 10px' }}>
            Adresse, an die die gedruckten Bücher gesammelt geliefert / wo sie abgeholt werden. Kann leer bleiben.
          </p>
          <input value={pa.name} onChange={e => setPa({ name: e.target.value })} placeholder="Name / Empfänger" style={{ marginBottom:8 }} />
          <input value={pa.addon} onChange={e => setPa({ addon: e.target.value })} placeholder="Adresszusatz (z. B. c/o, Firma)" style={{ marginBottom:8 }} />
          <input value={pa.street} onChange={e => setPa({ street: e.target.value })} placeholder="Straße und Hausnummer" style={{ marginBottom:8 }} />
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input value={pa.zip} onChange={e => setPa({ zip: e.target.value })} placeholder="PLZ" style={{ flex:'0 0 120px' }} />
            <input value={pa.city} onChange={e => setPa({ city: e.target.value })} placeholder="Ort" style={{ flex:1 }} />
          </div>
          <input value={pa.country} onChange={e => setPa({ country: e.target.value })} placeholder="Land" />
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

  // ── EINSTELLUNGEN (eigenes Firmenlogo) ──
  if (view === 'settings') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Einstellungen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Hinterlegen Sie Ihr Firmenlogo. Es wird den Beitragenden Ihrer Bücher oben angezeigt –
          anstelle des Standard-Logos.
        </p>
        <Err msg={err} />

        <div style={{ ...S.card }}>
          <Lbl>Firmenlogo</Lbl>
          {logoLoading ? (
            <p style={S.muted}>Wird geladen …</p>
          ) : (
            <>
              <div style={{
                marginTop:8, marginBottom:14, padding:'18px',
                border:'1px dashed #d6d3d1', borderRadius:10, background:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center', minHeight:90,
              }}>
                {logo
                  ? <img src={logo} alt="Logo-Vorschau" style={{ maxHeight:80, maxWidth:'100%', objectFit:'contain' }} />
                  : <span style={{ fontSize:13, color:'#a8a29e' }}>Noch kein Logo hinterlegt</span>}
              </div>

              <div style={{ background:'#f5f5f4', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, color:'#78716c', marginBottom:6 }}>So sehen es die Beitragenden:</div>
                <PartnerBanner logoUrl={logo} />
              </div>

              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 12px' }}>
                PNG, JPG, SVG, WebP oder GIF · max. 1 MB. Querformat mit transparentem Hintergrund wirkt am besten.
              </p>

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <label className="secondary" style={{ fontSize:13, padding:'9px 16px', cursor:'pointer', display:'inline-block', borderRadius:8, border:'1px solid #d6d3d1' }}>
                  📁 Logo auswählen
                  <input type="file" accept="image/*" onChange={onLogoFile} style={{ display:'none' }} />
                </label>
                <button onClick={() => saveLogo(logo)} disabled={busy || !logo} style={{ fontSize:13, padding:'9px 16px' }}>
                  {busy ? 'Wird gespeichert …' : 'Speichern'}
                </button>
                <button onClick={() => saveLogo(null)} disabled={busy || !logo} className="secondary" style={{ fontSize:13, padding:'9px 16px', color:'#dc2626', borderColor:'#fecaca' }}>
                  Logo entfernen
                </button>
              </div>
              {logoSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>✓ Gespeichert.</p>}
            </>
          )}
        </div>

        <form onSubmit={saveOwnPassword} style={{ ...S.card, marginTop:'1.25rem' }}>
          <Lbl>Passwort ändern</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'4px 0 14px' }}>{PASSWORD_RULES_TEXT}</p>
          <Err msg={pwErr} />
          <div style={{ marginBottom:12 }}>
            <Lbl>Aktuelles Passwort</Lbl>
            <input type="password" autoComplete="current-password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl>Neues Passwort</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next}
              onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:14 }}>
            <Lbl>Neues Passwort wiederholen</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next2}
              onChange={e => setPwForm(f => ({ ...f, next2: e.target.value }))} placeholder="••••" />
          </div>
          <button type="submit" disabled={busy || !pwForm.current || !pwForm.next || !pwForm.next2} style={{ fontSize:13, padding:'9px 16px' }}>
            {busy ? 'Wird geändert …' : 'Passwort ändern'}
          </button>
          {pwSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>✓ Passwort geändert.</p>}
        </form>
      </div>
    </div>
  )

  // ── BENUTZER (nur Admin) ──
  if (view === 'audit') return (
    <AuditView auditData={auditData} auditLoading={auditLoading} err={err} logout={logout} loadAudit={loadAudit} setView={setView} />
  )

  // ── TAGESREPORT-EMPFÄNGER (nur Admin) ──
  if (view === 'reports') return (
    <ReportsView err={err} reportMsg={reportMsg} recipients={recipients} recipientForm={recipientForm} busy={busy} logout={logout} setView={setView} toggleRecipient={toggleRecipient} removeRecipient={removeRecipient} submitRecipient={submitRecipient} sendReportNow={sendReportNow} setRecipientForm={setRecipientForm} />
  )

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
                  <strong style={{ fontSize:15 }}>{u.username}</strong>
                  {u.is_admin && <span style={{ fontSize:11, marginLeft:8, color:'#1d4ed8' }}>Admin</span>}
                  {!u.has_password && <span style={{ fontSize:11, marginLeft:8, color:'#b45309' }}>Einladung offen</span>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {u.has_password ? (
                    <button className="secondary" onClick={() => resetUserPassword(u)} style={{ fontSize:12, padding:'5px 10px' }}>Passwort</button>
                  ) : (
                    <>
                      <button className="secondary" onClick={() => copyInviteLink(u)} style={{ fontSize:12, padding:'5px 10px' }}>Link kopieren</button>
                      <button className="secondary" onClick={() => regenerateInvite(u)} style={{ fontSize:12, padding:'5px 10px' }}>Neuer Link</button>
                    </>
                  )}
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

        {/* Einladungslink des zuletzt angelegten / neu erzeugten Benutzers */}
        {createdInvite && (
          <div style={{ ...S.card, marginBottom:24, borderColor:'#bbf7d0', background:'#f0fdf4' }}>
            <Lbl>Einladungslink für „{createdInvite.username}"</Lbl>
            <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 10px' }}>
              Schicken Sie diesen Link an den Benutzer. Beim ersten Aufruf vergibt er sich selbst ein Passwort. (Der Link ist 14 Tage gültig und wurde in die Zwischenablage kopiert.)
            </p>
            {createdInvite.demo && (
              <p style={{ fontSize:12, color:'#3f6212', margin:'0 0 10px' }}>✓ {createdInvite.demo.memorials} Demo-Bücher mit {createdInvite.demo.contributions} Beiträgen angelegt.</p>
            )}
            {createdInvite.demoError && (
              <p style={{ fontSize:12, color:'#b45309', margin:'0 0 10px' }}>Hinweis: Demo-Daten konnten nicht angelegt werden ({createdInvite.demoError}).</p>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <a href={createdInvite.url} style={{ fontSize:13, wordBreak:'break-all', flex:'1 1 220px' }}>{createdInvite.url}</a>
              <button className="secondary" onClick={() => { navigator.clipboard?.writeText(createdInvite.url) }} style={{ fontSize:12, padding:'5px 10px' }}>Kopieren</button>
              <button className="secondary" onClick={() => setCreatedInvite(null)} style={{ fontSize:12, padding:'5px 10px' }}>Schließen</button>
            </div>
          </div>
        )}

        {/* Neuer Benutzer */}
        <div style={{ ...S.card }}>
          <Lbl>Neuer Benutzer</Lbl>
          <input value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="Benutzername" style={{ marginBottom:6 }} />
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            Kein Passwort nötig: Nach dem Anlegen erhalten Sie einen Einladungslink, über den der Benutzer sich selbst ein Passwort vergibt.
          </p>
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
          <label style={{ display:'flex', alignItems:'flex-start', gap:8, margin:'4px 0 16px', cursor:'pointer', fontSize:14 }}>
            <input type="checkbox" checked={userForm.demo} onChange={e => setUserForm({ ...userForm, demo: e.target.checked })} style={{ marginTop:3 }} />
            <span>
              <strong>Demo-Daten anreichern</strong>
              <span style={{ ...S.muted, display:'block', fontSize:12 }}>Legt dem Benutzer 3 Beispiel-Trauerbücher mit je 10 Beitragenden an; das erste Buch ist bereits in beiden Varianten produziert.</span>
            </span>
          </label>
          <button onClick={submitUser} disabled={busy || !userForm.username.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? 'Wird angelegt …' : 'Benutzer anlegen'}</button>
        </div>
      </div>
    </div>
  )

  // ── FRAGENKATALOGE (nur Admin) ──
  if (view === 'catalogs') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => { setCatalogForm(null); setView('list') }} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Fragenkataloge</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Vordefinierte Kataloge aus Kapiteln und Fragen. Manager wählen sie beim Anlegen eines Buchs (nur für passende Produktkategorien); die KI führt das Interview dann daran entlang.
        </p>
        <Err msg={err} />

        {catalogForm ? (() => {
          const cf = catalogForm
          const setCf         = patch      => setCatalogForm(f => ({ ...f, ...patch }))
          const setChapter    = (ci, patch)=> setCatalogForm(f => { const chapters=[...f.chapters]; chapters[ci]={...chapters[ci],...patch}; return { ...f, chapters } })
          const setQuestion   = (ci,qi,val)=> setCatalogForm(f => { const chapters=[...f.chapters]; const questions=[...chapters[ci].questions]; questions[qi]=val; chapters[ci]={...chapters[ci],questions}; return { ...f, chapters } })
          const addQuestion   = ci         => setCatalogForm(f => { const chapters=[...f.chapters]; chapters[ci]={...chapters[ci],questions:[...chapters[ci].questions,'']}; return { ...f, chapters } })
          const removeQuestion= (ci,qi)    => setCatalogForm(f => { const chapters=[...f.chapters]; const questions=chapters[ci].questions.filter((_,i)=>i!==qi); chapters[ci]={...chapters[ci],questions:questions.length?questions:['']}; return { ...f, chapters } })
          const addChapter    = ()         => setCatalogForm(f => ({ ...f, chapters:[...f.chapters,{title:'',questions:['']}] }))
          const removeChapter = ci         => setCatalogForm(f => { const chapters=f.chapters.filter((_,i)=>i!==ci); return { ...f, chapters: chapters.length?chapters:[{title:'',questions:['']}] } })
          const toggleCat     = slug       => setCatalogForm(f => ({ ...f, cats: f.cats.includes(slug)?f.cats.filter(s=>s!==slug):[...f.cats,slug] }))
          return (
            <div style={{ ...S.card, marginBottom:24 }}>
              <Lbl>{cf.id ? 'Katalog bearbeiten' : 'Neuer Katalog'}</Lbl>
              <input value={cf.name} onChange={e=>setCf({ name:e.target.value })} placeholder="Name des Katalogs" style={{ marginBottom:14 }} />
              <Lbl>Produktkategorien</Lbl>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'6px 0 16px' }}>
                {CATEGORY_ORDER.map(slug => {
                  const on = cf.cats.includes(slug)
                  return (
                    <span key={slug} onClick={()=>toggleCat(slug)}
                      style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                        borderColor: on?'#1c1917':'#e7e5e4', background: on?'#1c1917':'#fff', color: on?'#fafaf9':'#78716c' }}>
                      {CATEGORIES[slug].label}
                    </span>
                  )
                })}
              </div>
              {cf.chapters.map((ch, ci) => (
                <div key={ci} style={{ border:'1px solid #e7e5e4', borderRadius:8, padding:12, marginBottom:12 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontSize:12, color:'#78716c', fontWeight:600, whiteSpace:'nowrap' }}>Kapitel {ci+1}</span>
                    <input value={ch.title} onChange={e=>setChapter(ci,{ title:e.target.value })} placeholder="Kapitel-Titel" style={{ flex:1 }} />
                    <button className="secondary" onClick={()=>removeChapter(ci)} title="Kapitel entfernen" style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>✕</button>
                  </div>
                  {ch.questions.map((q, qi) => (
                    <div key={qi} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, marginLeft:12 }}>
                      <span style={{ fontSize:12, color:'#a8a29e', whiteSpace:'nowrap' }}>{qi+1}.</span>
                      <input value={q} onChange={e=>setQuestion(ci,qi,e.target.value)} placeholder="Frage" style={{ flex:1 }} />
                      <button className="secondary" onClick={()=>removeQuestion(ci,qi)} title="Frage entfernen" style={{ fontSize:12, padding:'4px 9px' }}>✕</button>
                    </div>
                  ))}
                  <button className="secondary" onClick={()=>addQuestion(ci)} style={{ fontSize:12, padding:'5px 10px', marginLeft:12, marginTop:4 }}>+ Frage</button>
                </div>
              ))}
              <button className="secondary" onClick={addChapter} style={{ fontSize:13, padding:'7px 14px', marginBottom:16 }}>+ Kapitel</button>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={saveCatalog} disabled={busy || !cf.name.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy?'Speichert …':'Speichern'}</button>
                <button className="secondary" onClick={()=>{ setCatalogForm(null); setErr('') }} style={{ fontSize:14, padding:'9px 16px' }}>Abbrechen</button>
              </div>
            </div>
          )
        })() : (
          <button onClick={newCatalog} style={{ fontSize:14, padding:'9px 16px', marginBottom:20 }}>+ Neuer Katalog</button>
        )}

        {!catalogForm && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {catalogs.map(c => (
              <div key={c.id} style={{ ...S.card }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <strong style={{ fontSize:15 }}>{c.name}</strong>
                    <span style={{ fontSize:12, color:'#78716c', marginLeft:8 }}>
                      {(c.chapters||[]).length} Kapitel · {(c.chapters||[]).reduce((n,ch)=>n+((ch.questions||[]).length),0)} Fragen
                    </span>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
                      {(c.product_categories||[]).map(slug => CATEGORIES[slug] && (
                        <span key={slug} style={{ fontSize:11, padding:'3px 8px', borderRadius:999, background:'#f5f5f4', color:'#57534e' }}>{CATEGORIES[slug].label}</span>
                      ))}
                      {(c.product_categories||[]).length===0 && <span style={{ fontSize:11, color:'#b45309' }}>keiner Kategorie zugeordnet – für Manager nicht wählbar</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="secondary" onClick={()=>editCatalog(c)} style={{ fontSize:12, padding:'5px 10px' }}>Bearbeiten</button>
                    <button className="secondary" onClick={()=>removeCatalog(c)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
                  </div>
                </div>
              </div>
            ))}
            {catalogs.length===0 && <p style={S.muted}>Noch keine Kataloge. Legen Sie einen an.</p>}
          </div>
        )}
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
    // Auftragsdaten-Bearbeitung: Feldkonfiguration der Kategorie + Draft-Helfer.
    const oci = getCategory(selected.product_category).intake
    const od = orderDraft
    const setOd  = patch => setOrderDraft(o => ({ ...o, ...patch }))
    const setOdPa = patch => setOrderDraft(o => ({ ...o, pickupAddress: { ...o.pickupAddress, ...patch } }))
    const dash = '—'
    const orderVariant = BOOK_VARIANTS.find(v => v.value === selected.book_variant) || BOOK_VARIANTS[0]
    const orderLangLabels = (selected.languages || ['de']).map(c => (LANGUAGES.find(l => l.code === c) || { label: c }).label).join(', ')
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
            {selected.funeral_date ? ` · ${getCategory(selected.product_category).intake.dateLabel}: ${new Date(selected.funeral_date).toLocaleDateString('de-DE')}` : ''}
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
          ) : (<>
            {(() => {
              const corrs = contributions.flatMap(c => (Array.isArray(c.transcript_corrections) ? c.transcript_corrections : []).map(x => ({ ...x, contribId: c.id, contributor: c.contributor_name })))
              const appliedN = corrs.filter(x => x.applied).length
              const suggestN = corrs.filter(x => !x.applied && x.kind === 'suggestion').length
              const checkedN = contributions.filter(c => c.transcript_checked_at).length
              const totalN = contributions.length
              if (totalN === 0) return null
              return (
                <div style={{ ...S.card, marginBottom:'1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:15 }}>🔎 Transkriptions-Prüfung</div>
                    <p style={{ ...S.muted, fontSize:13, margin:'4px 0 0' }}>
                      {checkedN}/{totalN} Beiträge geprüft · {appliedN} übernommen{suggestN ? ` · ${suggestN} Vorschlag${suggestN === 1 ? '' : 'e'}` : ''}.
                      {checkedN < totalN ? ' Neue Beiträge werden im Hintergrund automatisch geprüft.' : ''}
                    </p>
                  </div>
                  <button className="secondary" onClick={() => setTranscriptReport(true)} disabled={corrs.length === 0} style={{ fontSize:13, padding:'8px 14px', flexShrink:0 }}>
                    Bericht öffnen{corrs.length ? ` (${corrs.length})` : ''}
                  </button>
                </div>
              )
            })()}
            {selected.purge_info ? (
              <div style={{ ...S.card, marginBottom:'1.5rem', background:'#fffbeb', borderColor:'#fde68a' }}>
                <div style={{ fontWeight:600, marginBottom:6 }}>🗄 Beiträge gelöscht (Aufbewahrungsfrist)</div>
                <p style={{ ...S.muted, fontSize:13, margin:'0 0 10px' }}>
                  Am {new Date(selected.purge_info.purged_at).toLocaleString('de-DE')} wurden die einzelnen Beiträge gemäß Aufbewahrungsfrist gelöscht. Das Buch bleibt vollständig erhalten (Ansehen &amp; Download weiterhin möglich).
                </p>
                {(selected.purge_info.contributions || []).length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {selected.purge_info.contributions.map((t, ti) => (
                      <div key={ti} style={{ fontSize:13, color:'#57534e', borderTop:'1px solid #fde68a', paddingTop:6 }}>
                        Beitrag #{ti + 1} — gelöscht am {new Date(t.deleted_at).toLocaleString('de-DE')} · {t.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : contributions.length === 0 ? (
              <div style={{ ...S.card, textAlign:'center', padding:'1.5rem', marginBottom:'1.5rem' }}>
                <p style={S.muted}>Noch keine Beiträge für dieses Buch.</p>
              </div>
            ) : (
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
            )}

            <ManagerPhotos
              code={selected.id}
              token={token}
              uploads={selected.uploaded_images}
              contributions={contributions}
              onChange={next => setSelected(s => ({ ...s, uploaded_images: next }))}
            />

            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch & {GENERATORS.eulogy.label}</h3>
            {(() => {
              const variant = BOOK_VARIANTS.find(v => v.value === selected.book_variant) || BOOK_VARIANTS[0]
              return (
                <div style={{ ...S.card, marginBottom:'1rem', background:'#f5f5f4', borderColor:'#e7e5e4' }}>
                  <Lbl>Gewählte Buch-Variante</Lbl>
                  <div style={{ fontWeight:600, fontSize:15, margin:'4px 0 2px' }}>{variant.title}</div>
                  <p style={{ ...S.muted, fontSize:13, margin:0 }}>{variant.sub}</p>
                  {selected.note && (
                    <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e7e5e4' }}>
                      <Lbl>Bemerkung</Lbl>
                      <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', margin:'4px 0 0', whiteSpace:'pre-wrap' }}>{selected.note}</p>
                    </div>
                  )}
                  {selected.pickup_address && (
                    <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e7e5e4' }}>
                      <Lbl>Sammelbestellungs-Adresse</Lbl>
                      <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', margin:'4px 0 0' }}>
                        {[
                          selected.pickup_address.name,
                          selected.pickup_address.addon,
                          selected.pickup_address.street,
                          [selected.pickup_address.zip, selected.pickup_address.city].filter(Boolean).join(' '),
                          selected.pickup_address.country,
                        ].filter(Boolean).map((line, i) => <span key={i}>{line}<br /></span>)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {[
                { key:'book_v1', icon:'📄', title:GENERATORS.book_v1.label, sub:'Jede Person als eigenes Kapitel (Ich-Form, fließender Text).' },
                { key:'book_v2', icon:'✨', title:GENERATORS.book_v2.label, sub:'KI webt alle Beiträge zu einem stimmigen, literarischen Text.' },
                { key:'eulogy',  icon:'🕯', title:GENERATORS.eulogy.label,  sub:`KI verfasst einen persönlichen Text (${GENERATORS.eulogy.noun}) zum Vorlesen.` },
              ].map(({ key, icon, title, sub }) => {
                const gen   = GENERATORS[key]
                const has   = !!selected[gen.field]
                const busy  = !!generating[key] && genOwner[key] === selected.id
                const report = selected.content_reports?.[gen.field]
                const totalFindings = report?.findings?.length || 0
                const openFindings = report?.findings?.filter(f => f.status !== 'resolved').length || 0
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
                      <button onClick={() => { setEditMode(false); setEditDraft(null); setView(gen.view) }} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        👁 Ansehen/Bearbeiten
                      </button>
                      <button onClick={() => downloadGenerated(key)} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        ⬇ Download .docx
                      </button>
                      {gen.kind === 'book' && (
                        <button onClick={() => downloadGeneratedPdf(key)} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          🖨 Druck-PDF
                        </button>
                      )}
                      {gen.kind === 'book' && (
                        <button onClick={() => openImgEdit(key)} disabled={!has || busy || !bookHasImages(selected[gen.field])} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          🖼 Bilder überarbeiten
                        </button>
                      )}
                      <button onClick={() => recheck(key)} disabled={!has || busy || reviewingKey === key} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {reviewingKey === key ? 'Prüft …' : '🛡 Prüfung wiederholen'}
                      </button>
                    </div>
                    {busy && (
                      <div style={{ marginTop:10 }}>
                        {genPct[key] != null && (
                          <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                            <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                          </div>
                        )}
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>
                          {genPct[key] != null ? `${genPct[key]} % · ` : ''}{genProgress[key] || 'Wird generiert …'}
                        </p>
                        <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:12, padding:'5px 10px', marginTop:8, color:'#b91c1c', borderColor:'#fecaca' }}>
                          ✕ Abbrechen
                        </button>
                      </div>
                    )}
                    {!busy && genErr[key] && genOwner[key] === selected.id && (
                      <div style={{ marginTop:10 }}><Err msg={genErr[key]} /></div>
                    )}
                    {reviewingKey === key && (
                      <div style={{ marginTop:10 }}>
                        <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                          <div style={{ width:`${reviewPct}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                        </div>
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>🛡 Inhaltsprüfung läuft … {reviewPct} %</p>
                      </div>
                    )}
                    {gen.kind === 'book' && (
                      <label style={{ display:'inline-flex', alignItems:'center', gap:8, marginTop:10, fontSize:12, color:'#78716c', cursor:'pointer' }}>
                        <input type="checkbox" checked={skipImages} onChange={e => setSkipImages(e.target.checked)} style={{ width:16, height:16, flexShrink:0, margin:0, cursor:'pointer' }} />
                        🐞 Bilder überspringen (schneller – für Tests)
                      </label>
                    )}
                    {has && !busy && report && (
                      <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid #f5f5f4' }}>
                        {report.error ? (
                          <span style={{ fontSize:12, color:'#b45309' }}>⚠ Inhaltsprüfung fehlgeschlagen.{' '}
                            <button className="ghost" onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:12, padding:0, textDecoration:'underline' }}>Details</button>
                          </span>
                        ) : openFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:13, padding:'7px 12px', background:'#b91c1c' }}>
                            🛡 Prüfbericht ansehen ({openFindings} offen{totalFindings > openFindings ? `, ${totalFindings - openFindings} erledigt` : ''})
                          </button>
                        ) : totalFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} className="secondary" style={{ fontSize:13, padding:'7px 12px', color:'#15803d', borderColor:'#bbf7d0' }}>
                            ✓ Alle {totalFindings} Befunde bearbeitet – Bericht ansehen
                          </button>
                        ) : (
                          <span style={{ fontSize:12, color:'#15803d' }}>🛡 Inhaltsprüfung durchgeführt – keine kritischen Aussagen gefunden.</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>)}

          <div style={S.divider} />

          {/* ── Auftragsdaten (Stammdaten) — selten gebraucht, daher unten ── */}
          <div style={{ ...S.card, marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom: orderEdit ? 16 : 4 }}>
              <h3 style={{ fontSize:16, fontWeight:600, margin:0 }}>Auftragsdaten</h3>
              {!orderEdit && (
                <button className="secondary" onClick={startOrderEdit} style={{ fontSize:13, padding:'8px 14px' }}>✎ Bearbeiten</button>
              )}
            </div>

            {!orderEdit ? (
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', columnGap:18, rowGap:8, fontSize:14 }}>
                {[
                  [oci.subjectLabel || 'Name', selected.name || dash],
                  ['Organisator', selected.organizer || dash],
                  ...(oci.useGender ? [['Geschlecht', selected.gender || dash]] : []),
                  ...((oci.extra || []).map(f => [f.label, selected.intake?.[f.key] || dash])),
                  ...(oci.useDate ? [[oci.dateLabel, selected.funeral_date ? new Date(selected.funeral_date).toLocaleDateString('de-DE') : dash]] : []),
                  ...(oci.useCutoff ? [['Erfassung bis', selected.funeral_date ? `${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} Tage vorher)` : `${cutoffDays(selected)} Tage vorher`]] : []),
                  ['Sprachen', orderLangLabels],
                  ['Buch-Variante', orderVariant.title],
                  ...(selected.product_category === 'memorial' ? [['Einführungsvideo', selected.show_intro_video !== false ? 'Ja' : 'Nein']] : []),
                  ['Bemerkung', selected.note || dash],
                  ['Sammelbestellungs-Adresse', selected.pickup_address
                    ? [selected.pickup_address.name, selected.pickup_address.addon, selected.pickup_address.street,
                       [selected.pickup_address.zip, selected.pickup_address.city].filter(Boolean).join(' '),
                       selected.pickup_address.country].filter(Boolean).join(', ')
                    : dash],
                ].map(([label, val], i) => (
                  <Fragment key={i}>
                    <div style={{ color:'#78716c', whiteSpace:'nowrap' }}>{label}</div>
                    <div style={{ color:'#44403c', whiteSpace:'pre-wrap' }}>{val}</div>
                  </Fragment>
                ))}
              </div>
            ) : od && (
              <div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>{oci.subjectLabel || 'Name'} *</Lbl>
                  <input value={od.name} onChange={e => setOd({ name: e.target.value })} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Organisator *</Lbl>
                  <input value={od.organizer} onChange={e => setOd({ organizer: e.target.value })} />
                </div>
                {oci.useGender && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.genderLabel}</Lbl>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                      {GENDERS.map(g => (
                        <div key={g.value} onClick={() => setOd({ gender: g.value })}
                          style={{ ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                            borderColor: od.gender === g.value ? '#1c1917' : '#e7e5e4', borderWidth: od.gender === g.value ? 2 : 1,
                            fontSize:14, fontWeight: od.gender === g.value ? 600 : 400 }}>
                          {g.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(oci.extra || []).map(f => (
                  <div key={f.key} style={{ marginBottom:14 }}>
                    <Lbl>{f.label}</Lbl>
                    <input value={od.intake?.[f.key] || ''} onChange={e => setOd({ intake: { ...od.intake, [f.key]: e.target.value } })} placeholder={f.placeholder || ''} />
                  </div>
                ))}
                {oci.useDate && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.dateLabel}</Lbl>
                    <input type="date" value={od.funeralDate} onChange={e => setOd({ funeralDate: e.target.value })} />
                  </div>
                )}
                {oci.useCutoff && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.cutoffLabel}</Lbl>
                    <input type="number" min={0} max={90} step={1} value={od.cutoffDays}
                      onChange={e => { const v = e.target.value; setOd({ cutoffDays: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) }) }} />
                    <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
                      {od.funeralDate && Number.isFinite(parseInt(od.cutoffDays, 10))
                        ? <>Beiträge fließen bis zum <strong>{cutoffString(od.funeralDate, parseInt(od.cutoffDays, 10))}</strong> ein.</>
                        : <>Standard sind 7 Tage.</>}
                    </p>
                  </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Sprachen *</Lbl>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {LANGUAGES.map(l => {
                      const on = od.languages.includes(l.code)
                      return (
                        <label key={l.code} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', ...S.card, padding:'10px 14px',
                          borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1 }}>
                          <input type="checkbox" checked={on}
                            onChange={() => setOrderDraft(o => {
                              const next = on ? o.languages.filter(c => c !== l.code) : [...o.languages, l.code]
                              return { ...o, languages: next.length ? next : o.languages }
                            })}
                            style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }} />
                          <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Buch-Variante *</Lbl>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
                    {BOOK_VARIANTS.map(v => (
                      <div key={v.value} onClick={() => setOd({ bookVariant: v.value })}
                        style={{ ...S.card, cursor:'pointer', padding:'14px 14px',
                          borderColor: od.bookVariant === v.value ? '#1c1917' : '#e7e5e4', borderWidth: od.bookVariant === v.value ? 2 : 1 }}>
                        <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                        <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Grafikstil der Bilder</Lbl>
                  <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Gilt für künftig erzeugte Bilder. Bereits generierte Bilder bleiben, bis sie neu erzeugt werden (im Buch über „🖼 Bilder überarbeiten").</p>
                  <ImageStylePicker value={od.imageStyle} onChange={k => setOd({ imageStyle: k })} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Buchlayout (Schrift &amp; Design)</Lbl>
                  <p style={{ ...S.muted, fontSize:12, margin:'0 0 8px' }}>Wirkt sofort auf Leseansicht und die nächsten Exporte (DOCX/Druck-PDF); der Buchinhalt bleibt gleich.</p>
                  <BookLayoutPicker value={od.bookLayout} onChange={k => setOd({ bookLayout: k })} />
                </div>
                {selected.product_category === 'memorial' && (
                <div style={{ marginBottom:14 }}>
                  <Lbl>Einführungsvideo</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.showIntroVideo} onChange={e => setOd({ showIntroVideo: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Einführungsvideo vor dem Sprach-Interview anzeigen</span>
                  </label>
                </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Bemerkung</Lbl>
                  <textarea value={od.note} onChange={e => setOd({ note: e.target.value })} rows={3}
                    placeholder="Interne Notiz zu diesem Buch (optional)."
                    style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14 }} />
                </div>
                <div style={{ marginBottom:20 }}>
                  <Lbl>Sammelbestellungs-Adresse (optional)</Lbl>
                  <input value={od.pickupAddress.name} onChange={e => setOdPa({ name: e.target.value })} placeholder="Name / Empfänger" style={{ marginBottom:8 }} />
                  <input value={od.pickupAddress.addon} onChange={e => setOdPa({ addon: e.target.value })} placeholder="Adresszusatz (z. B. c/o, Firma)" style={{ marginBottom:8 }} />
                  <input value={od.pickupAddress.street} onChange={e => setOdPa({ street: e.target.value })} placeholder="Straße und Hausnummer" style={{ marginBottom:8 }} />
                  <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                    <input value={od.pickupAddress.zip} onChange={e => setOdPa({ zip: e.target.value })} placeholder="PLZ" style={{ flex:'0 0 120px' }} />
                    <input value={od.pickupAddress.city} onChange={e => setOdPa({ city: e.target.value })} placeholder="Ort" style={{ flex:1 }} />
                  </div>
                  <input value={od.pickupAddress.country} onChange={e => setOdPa({ country: e.target.value })} placeholder="Land" />
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={saveOrderData} disabled={orderSaving} style={{ fontSize:14, padding:'10px 20px' }}>
                    {orderSaving ? 'Wird gespeichert …' : 'Speichern'}
                  </button>
                  <button className="secondary" onClick={cancelOrderEdit} disabled={orderSaving} style={{ fontSize:14, padding:'10px 20px' }}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>

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
        {imgEditOverlay}
        {imgZoomOverlay}
        {reportOverlay}
        {transcriptReportOverlay}
      </div>
    )
  }

  // ── KOSTEN-AUFSCHLÜSSELUNG ──
  if (view === 'costs' && selected) return (
    <CostsView selected={selected} costData={costData} costsLoading={costsLoading} err={err} setView={setView} logout={logout} />
  )

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

  // ── ANSEHEN (Bücher + Endtext/Rede) ──
  if (view === 'book-v1' || view === 'book-v2' || view === 'eulogy') {
    const key  = view === 'book-v1' ? 'book_v1' : view === 'book-v2' ? 'book_v2' : 'eulogy'
    const gen  = GENERATORS[key]
    const data = selected[gen.field]
    const busy = !!generating[key] && genOwner[key] === selected.id
    const bt = uiText(data?.language)
    const reviewReport = selected.content_reports?.[gen.field]
    const reviewMarks = (reviewReport?.findings || []).filter(f => f.quote && f.status !== 'resolved').map(f => ({ quote: String(f.quote), severity: f.severity }))
    const subtitle = view === 'book-v1' ? `${getCategory(selected?.product_category).nounBook} · Version 1`
                   : view === 'book-v2' ? `${getCategory(selected?.product_category).nounBook} · Version 2`
                   : GENERATORS.eulogy.label
    // Buchlayout (Typografie) für die Leseansicht.
    const bookLayout = getBookLayout(selected.book_layout)
    const headFont = { fontFamily: bookLayout.heading.css, letterSpacing: bookLayout.heading.track, ...(bookLayout.heading.upper ? { textTransform: 'uppercase' } : {}) }
    const bodyFont = { fontFamily: bookLayout.body.css }
    return (
      <div style={{ maxWidth:720, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
        <Back onClick={() => { setEditMode(false); setEditDraft(null); setView('detail') }} />
        <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
          <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>{subtitle}{editMode ? ' · Bearbeiten' : ''}</p>
          <h1 style={{ fontSize:24, fontWeight:600, ...headFont, color:'#78716c' }}>{selected.name}</h1>
        </div>

        {!busy && data && !editMode && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1.25rem' }}>
            <button onClick={() => { setEditDraft(structuredClone(data)); setEditMode(true) }} style={{ fontSize:13, padding:'8px 16px' }}>✏ Bearbeiten</button>
          </div>
        )}

        {genOwner[key] === selected.id && <Err msg={genErr[key]} />}
        <Err msg={err} />

        {busy ? (
          <div style={{ textAlign:'center', padding:'3rem 0' }}>
            <Dots />
            {genPct[key] != null && (
              <>
                <div style={{ fontSize:32, fontWeight:700, color:'#1c1917', marginTop:16 }}>{genPct[key]} %</div>
                <div style={{ maxWidth:320, height:8, background:'#e7e5e4', borderRadius:999, margin:'12px auto 0', overflow:'hidden' }}>
                  <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                </div>
              </>
            )}
            <p style={{ ...S.muted, marginTop:16 }}>{genProgress[key] || 'Die KI arbeitet …'}</p>
            <div style={{ marginTop:16 }}>
              <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:13, padding:'7px 14px', color:'#b91c1c', borderColor:'#fecaca' }}>✕ Abbrechen</button>
            </div>
          </div>
        ) : !data ? (
          <p style={{ ...S.muted, textAlign:'center', padding:'3rem 0' }}>Noch nichts generiert. Geh zurück und klicke „Generieren".</p>
        ) : editMode ? (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'1.5rem' }}>
            <p style={{ ...S.muted, fontSize:13, marginBottom:16 }}>
              Direkt im Text korrigieren (z. B. falsch verstandene Eigennamen). Änderungen werden beim Speichern übernommen. Bilder bleiben unverändert.
            </p>
            {gen.kind === 'book' && editDraft && typeof editDraft === 'object' ? (
              <>
                <Lbl>Titel</Lbl>
                <input value={editDraft.title || ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} style={{ marginBottom:12 }} />
                <Lbl>Untertitel</Lbl>
                <input value={editDraft.subtitle || ''} onChange={e => setEditDraft(d => ({ ...d, subtitle: e.target.value }))} style={{ marginBottom:20 }} />
                {(editDraft.chapters || []).map((ch, i) => (
                  <div key={i} style={{ marginBottom:20, paddingTop:16, borderTop:'1px solid #f5f5f4' }}>
                    <Lbl>{bt.chapterLabel} {ch.number ?? i + 1} – Überschrift</Lbl>
                    <input value={ch.heading || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, heading: e.target.value } : c) }))} style={{ marginBottom:8 }} />
                    <Lbl>Text</Lbl>
                    <textarea value={ch.body || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, body: e.target.value } : c) }))} rows={Math.max(6, String(ch.body || '').split('\n').length + 2)} style={{ width:'100%', fontFamily:'inherit', fontSize:14, lineHeight:1.6, resize:'vertical' }} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <Lbl>Text</Lbl>
                <textarea value={typeof editDraft === 'string' ? editDraft : ''} onChange={e => setEditDraft(e.target.value)} rows={24} style={{ width:'100%', fontFamily:'inherit', fontSize:15, lineHeight:1.7, resize:'vertical' }} />
              </>
            )}
            <div style={{ display:'flex', gap:10, marginTop:16 }}>
              <button onClick={() => saveEdit(gen.field, editDraft)} disabled={savingEdit} style={{ fontSize:14, padding:'9px 18px' }}>{savingEdit ? 'Speichert …' : '✓ Speichern'}</button>
              <button onClick={() => { setEditMode(false); setEditDraft(null) }} disabled={savingEdit} className="ghost" style={{ fontSize:14 }}>Abbrechen</button>
            </div>
          </div>
        ) : gen.kind === 'book' ? (
          <>
            <div style={{ textAlign:'center', padding:'2rem 0 3rem', borderTop:'1px solid #e7e5e4' }}>
              <h2 style={{ fontSize:36, fontWeight:700, ...headFont, marginBottom:12, color:'#1c1917' }}>{data.title || '—'}</h2>
              {data.subtitle && <p style={{ fontSize:18, fontStyle:'italic', color:'#78716c', ...bodyFont }}>{data.subtitle}</p>}
            </div>
            {reviewMarks.length > 0 && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginBottom:'2rem', fontSize:13, color:'#991b1b', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span>🛡 {reviewMarks.length} {reviewMarks.length === 1 ? 'Stelle' : 'Stellen'} aus der Inhaltsprüfung sind im Text farbig markiert.</span>
                <button className="secondary" onClick={() => setReportModal({ title: gen.label, field: gen.field, report: reviewReport })} style={{ fontSize:12, padding:'5px 10px' }}>Prüfbericht</button>
              </div>
            )}
            {(data.chapters || []).map((ch, i) => (
              <div key={i} style={{ marginBottom:'3rem' }}>
                <div style={{ textAlign:'center', marginBottom:'1.25rem' }}>
                  <p style={{ fontSize:11, letterSpacing:'.18em', textTransform:'uppercase', color:'#a8a29e', marginBottom:6 }}>{bt.chapterLabel} {ch.number ?? i + 1}</p>
                  <h3 style={{ fontSize:24, fontWeight:700, ...headFont }}>{ch.heading || ''}</h3>
                  {(() => {
                    // V1: Name + Beziehung des Beitragenden unter der Überschrift.
                    // Fallback über contribution_id für ältere Bücher ohne die Felder.
                    const src = ch.contributor_name ? ch : (contributions || []).find(x => x.id === ch.contribution_id)
                    const nm = ch.contributor_name || src?.contributor_name
                    const rel = ch.relationship || src?.relationship
                    return nm ? (
                      <p style={{ fontSize:15, fontStyle:'italic', color:'#78716c', ...bodyFont, marginTop:8 }}>
                        {rel ? `${nm} – ${rel}` : nm}
                      </p>
                    ) : null
                  })()}
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
                  ch.image_error ? (
                    <div style={{ background:'#fef2f2', border:'1px dashed #fecaca', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#991b1b', fontSize:13, lineHeight:1.5 }}>
                      🖼 Bildgenerierung fehlgeschlagen.<br />
                      <span style={{ display:'inline-block', marginTop:6, padding:'4px 10px', background:'#fff', border:'1px solid #fecaca', borderRadius:6, fontSize:12, color:'#7f1d1d' }}>
                        {imageErrorDe(ch.image_error)}
                      </span>
                      <div style={{ fontSize:12, color:'#7f1d1d', marginTop:8 }}>Prompt war: „{ch.image_prompt}"</div>
                    </div>
                  ) : (
                    <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13, lineHeight:1.5 }}>
                      🖼 Noch kein Bild – über „🖼 Bilder überarbeiten" erzeugen.
                      <div style={{ fontSize:12, color:'#a8a29e', marginTop:8 }}>Prompt: „{ch.image_prompt}"</div>
                    </div>
                  )
                ) : (
                  <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13 }}>
                    🖼 Kein image_prompt im Kapitel-JSON.
                  </div>
                )}
                <div style={{ fontSize:17, lineHeight:1.9, ...bodyFont }}>
                  {String(ch.body || '').split('\n\n').filter(Boolean).map((p, j) => <p key={j} style={{ marginBottom:'1.4rem' }}>{highlightParagraph(p, reviewMarks)}</p>)}
                </div>
              </div>
            ))}
            {contributions.length > 0 && (
              <div style={{ marginTop:'2rem', paddingTop:'2rem', borderTop:'1px solid #e7e5e4', textAlign:'center' }}>
                <h3 style={{ fontSize:24, fontWeight:700, ...headFont, marginBottom:'1.5rem' }}>{bt.contributorsHeading}</h3>
                {dedupeContributors(contributions).map(c => (
                  <p key={c.id} style={{ fontSize:16, lineHeight:1.7, ...bodyFont, margin:'0 0 6px' }}>
                    <strong>{c.contributor_name}</strong>{c.relationship ? <span style={{ color:'#78716c' }}> — {c.relationship}</span> : null}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem', fontSize:17, lineHeight:1.9, ...bodyFont }}>
            {renderRichText(data)}
          </div>
        )}

        {!busy && data && !editMode && (
          <div style={{ marginTop:'2.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4' }}>
            <p style={{ fontSize:12, fontWeight:700, color:'#78716c', margin:'0 0 6px' }}>{BOOK_DISCLAIMER_TITLE}</p>
            {selected?.owner_logo && (
              <img src={selected.owner_logo} alt="Logo" style={{ maxHeight:64, maxWidth:'60%', objectFit:'contain', display:'block', margin:'8px 0 10px' }} />
            )}
            <p style={{ fontSize:12, color:'#a8a29e', fontStyle:'italic', lineHeight:1.6, margin:0 }}>{BOOK_DISCLAIMER}</p>
          </div>
        )}

        {!busy && data && !editMode && (
          <div style={{ marginTop:'1.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4', display:'flex', gap:10, flexWrap:'wrap' }}>
            <button onClick={() => downloadGenerated(key)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Download .docx</button>
            {gen.kind === 'book' && (
              <button className="secondary" onClick={() => downloadGeneratedPdf(key)} style={{ fontSize:13, padding:'8px 16px' }}>🖨 Druck-PDF</button>
            )}
            <button className="secondary" onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} style={{ fontSize:13, padding:'8px 16px' }}>↻ Neu generieren</button>
          </div>
        )}
        {eulogyStyleOverlay}
        {genLangOverlay}
        {imgEditOverlay}
        {imgZoomOverlay}
        {reportOverlay}
        {transcriptReportOverlay}
      </div>
    )
  }

  return null
}

// ── Rechtstexte (Impressum / Datenschutz) ─────────────────────────
// HINWEIS (intern): Der Datenschutztext ist ein fundierter Entwurf, der die
// tatsächliche Verarbeitung abbildet. Vor produktivem Verlass darauf bitte
// juristisch prüfen lassen. Verantwortliche: HealthCare Futurists GmbH.


// ── Haupt-App ─────────────────────────────────────────────────────
// ── Einladungs-Flow (Aufruf per ?invite=TOKEN) ────────────────────
// Ein neu angelegter Benutzer vergibt sich hier beim ersten Aufruf selbst ein
// Passwort. Bei Erfolg wird er direkt eingeloggt und ins Admin-Dashboard
// weitergeleitet.
function InviteFlow({ token }) {
  const [status, setStatus]     = useState('loading') // loading|ready|invalid
  const [username, setUsername] = useState('')
  const [pw, setPw]             = useState('')
  const [pw2, setPw2]           = useState('')
  const [err, setErr]           = useState('')
  const [busy, setBusy]         = useState(false)

  useEffect(() => {
    let alive = true
    getInvite(token)
      .then(d => { if (alive) { setUsername(d.username || ''); setStatus('ready') } })
      .catch(e => { if (alive) { setErr(e.message); setStatus('invalid') } })
    return () => { alive = false }
  }, [token])

  async function submit(e) {
    e.preventDefault()
    const pErr = passwordError(pw)
    if (pErr) { setErr(pErr); return }
    if (pw !== pw2) { setErr('Die beiden Passwörter stimmen nicht überein.'); return }
    setErr(''); setBusy(true)
    try {
      const d = await redeemInvite(token, pw)
      sessionStorage.setItem('lw_admin_token', d.token)
      sessionStorage.setItem('lw_admin_auth', JSON.stringify({
        admin: Boolean(d.admin), cats: d.cats ?? [], uid: d.uid ?? null, username: d.username || username,
      }))
      // Ohne ?invite neu laden – das Dashboard liest den Token aus sessionStorage.
      window.location.href = '/'
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const card = { width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }
  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', padding: '1rem' }

  if (status === 'loading') return <div style={wrap}><div style={card}><p style={{ ...S.muted, margin: 0 }}>Einladung wird geprüft …</p></div></div>

  if (status === 'invalid') return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Einladung ungültig</h1>
        <Err msg={err} />
        <p style={{ ...S.muted, marginTop: 12, marginBottom: 0 }}>Bitte fordern Sie bei Ihrem Administrator einen neuen Einladungslink an.</p>
      </div>
    </div>
  )

  const okPw = !passwordError(pw)
  return (
    <div style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Willkommen{username ? `, ${username}` : ''}</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Bitte vergeben Sie ein Passwort für Ihr Konto.</p>
        <Err msg={err} />
        <div style={{ marginBottom: 12 }}>
          <Lbl>Neues Passwort</Lbl>
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Lbl>Passwort wiederholen</Lbl>
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 16, color: !pw ? '#78716c' : (okPw ? '#15803d' : '#b91c1c') }}>
          {!pw ? '' : (okPw ? '✓ ' : '• ')}{PASSWORD_RULES_TEXT}
        </p>
        <button type="submit" disabled={busy || !okPw || pw !== pw2} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {busy ? 'Wird gespeichert …' : 'Passwort festlegen & anmelden'}
        </button>
      </form>
    </div>
  )
}

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
      {inviteFromURL ? <InviteFlow token={inviteFromURL} />
        : codeFromURL ? <ContributorFlow code={codeFromURL} />
        : <Dashboard />}
      <LegalFooter />
    </>
  )
}
