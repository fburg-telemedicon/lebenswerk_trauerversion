import { useState, useEffect, useRef, Fragment } from 'react'
import JSZip from 'jszip'
import {
  createMemorial, getMemorial, getContribution, addContribution,
  askLLM, speakText, stopSpeaking, primeAudio, adminDeleteMemorial, adminSaveMemorialText, adminUpdateMemorialMeta, adminGenerateImage,
  uploadContributorImage, adminUploadImage, adminDeleteUpload, adminUpdateUpload,
  enqueueGeneration, getGenerationJob, cancelGenerationJob,
  adminDeleteContribution, adminUpdateContributionMessages, adminUpdateContributionMeta, adminSaveTranscriptCheck,
  getMemorialCosts,
  adminListUsers, adminCreateUser, adminUpdateUser, adminDeleteUser, adminListAudit, adminListFeedback, adminSetFeedbackDone, adminDeleteFeedback,
  adminListCatalogs, adminCreateCatalog, adminUpdateCatalog, adminDeleteCatalog,
  adminGetBookDefaults, adminSaveBookDefaults, adminResetBookDefaults,
  adminListRecipients, adminAddRecipient, adminUpdateRecipient, adminDeleteRecipient, adminSendReportNow,
  getSettings, saveSettings, changeOwnPassword,
  getInvite, redeemInvite, requestPasswordReset,
  storeMemorialPdf,
} from './api.js'
import { CATEGORIES, CATEGORY_ORDER, DEFAULT_CATEGORY, getCategory, categoryColor, defaultTextStyle } from './categories.js'
import { IMAGE_STYLES, DEFAULT_IMAGE_STYLE, imageStyleLabel } from './imageStyles.js'
import { BOOK_LAYOUTS, DEFAULT_BOOK_LAYOUT, getBookLayout, bookLayoutLabel } from './bookLayouts.js'
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, langDirective, uiText, contributorL10n } from './i18n.js'
import CategoryIcon from './CategoryIcon.jsx'
import { reviewSystemPrompt, extractReviewText, contributionsContext } from './review.js'
import { applyCorrectionToMessages, revertCorrectionInMessages } from './transcript.js'
import { BOOK_DISCLAIMER, BOOK_DISCLAIMER_TITLE, formatContribution, downloadBlob, downloadFile, safeName, buildContributionPdf, dedupeContributors, downloadStructuredDocx, downloadPrintPdf, downloadAsDocx, downloadTextPdf } from './bookExport.js'
import { prepareCover, drawCoverPreview, downloadCoverPdf, spineWidthMm, BOX_POSITIONS } from './coverExport.js'

// Version des Cover-Prompts (coverPrompt). Bei jeder inhaltlichen Änderung
// hochzählen — dann werden bereits gespeicherte Cover-Hintergründe beim nächsten
// Export einmalig neu erzeugt, statt veraltet liegen zu bleiben.
// v2: „book cover"/Buchtitel aus dem Prompt entfernt (FLUX malte sonst ein
//     Cover-Mockup mit eingewebtem Titel, Pseudo-Untertitel und Fantasie-Logo).
// v3: Bildaufteilung vorgegeben — rechts (Vorderseite) das Hauptmotiv, links
//     (Rückseite) ruhiger; jede Hälfte muss für sich allein funktionieren.
const COVER_PROMPT_VERSION = 3

// Eine Cover-Variante als Bild. Zeichnet exakt das, was auch ins PDF geht
// (gleiche Geometrie, gleicher Zeilenumbruch – beides kommt aus prepareCover).
function CoverPreview({ prep, posKey, width = 420 }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !prep) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(width * (prep.H / prep.W) * dpr)
    cv.style.width = `${width}px`
    cv.style.height = `${Math.round(width * (prep.H / prep.W))}px`
    drawCoverPreview(cv, prep, posKey)
  }, [prep, posKey, width])
  return <canvas ref={ref} style={{ display:'block', borderRadius:6, border:'1px solid #e7e5e4' }} />
}
import { CONSENT_VERSION } from './constants.js'
import { Impressum, Datenschutz, LegalFooter } from './LegalPages.jsx'
import { S, Lbl, Err, Back, Dots, PartnerBanner, col, th } from './ui.jsx'
import { AdminLangProvider } from './adminI18n.jsx'
import { uploadPrintInfo, ImageStylePicker, BookLayoutPicker, TextStylePicker } from './pickers.jsx'
import { fileToDownscaledDataURL, imageErrorDe, saveLocalSession, loadLocalSession, clearLocalSession, genContribId, unlockAudio, passwordError, PASSWORD_RULES_TEXT, qrCodeUrl } from './shared.js'
import { ContributorFlow } from './contributor.jsx'
import { treeSystem, posterSystem, downloadTreePdf, downloadPosterPdf, downloadPosterScenePdf, downloadPosterVariantPdf, POSTER_STYLES } from './lifeworkExtras.js'
import { GENDERS, EMPTY_PICKUP, BOOK_VARIANTS } from './constants.js'
import { cutoffDays, cutoffDate, cutoffString } from './shared.js'
import { AuditView, ReportsView, CostsView, SettingsView, BookDefaultsView, CreatedView, UsersView, CatalogsView, ListView, CreateCategoryView, CreateView, ContributionView, BookView, DetailView, QMView } from './adminViews.jsx'
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





// Leeres Anlage-Formular (inkl. Produktkategorie + kategorieabhängige Felder).
const EMPTY_CREATE = {
  name: '', organizer: '', gender: '', bookVariant: 1,
  funeralDate: '', cutoffDays: 7, showIntroVideo: false, showTranscript: true, showContributors: true, photoUploadTab: false,
  productCategory: DEFAULT_CATEGORY, intake: {},
  languages: [DEFAULT_LANGUAGE], note: '',
  pickupAddress: { ...EMPTY_PICKUP },
  catalogId: '', followups: 7,
  imageStyle: DEFAULT_IMAGE_STYLE,
  bookLayout: DEFAULT_BOOK_LAYOUT,
  textStyle: 'literary',   // je Kategorie in freshCreateForm auf den Default gesetzt
  timerOn: false, timerMinutes: 5,   // Test-Zeitlimit fürs Interview (aus = unbegrenzt)
  companionMode: false,              // begleiteter Co-Interview-Modus (nur Lebenswerk)
  // nur Kategorie Lebenswerk
  enduserEmail: '',
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
  // Passwort-Reset am Login (Self-Service)
  const [showReset, setShowReset]     = useState(false)
  const [resetEmail, setResetEmail]   = useState('')
  const [resetMsg, setResetMsg]       = useState('')
  const [resetBusy, setResetBusy]     = useState(false)
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
  const [qmData, setQmData]           = useState([])
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
  // Buch-Standardwerte: Vorbelegung der Anlage-Maske, im Dashboard änderbar
  // (View 'book-defaults'). `bookDefaults` = die geltenden Werte, `bdForm` = der
  // Bearbeitungsstand in der Maske.
  const [bookDefaults, setBookDefaults] = useState(null)
  const [bdForm, setBdForm]             = useState(null)
  const [bdSaved, setBdSaved]           = useState(false)
  const [bdMsg, setBdMsg]               = useState('')
  // Lebenswerk-Nebenprodukte (Stammbaum / Lebensposter): '' | 'tree' | 'poster'
  const [extraBusy, setExtraBusy]       = useState('')
  const [extraMsg, setExtraMsg]         = useState('')
  // Download eines Nebenprodukts läuft (Bilder laden + PDF zeichnen dauert):
  // '' | 'tree' | 'poster'
  const [extraDl, setExtraDl]           = useState('')
  // Sprachwahl BEIM SPEICHERN (Pflegeexzerpt): { key } | null
  const [dlLangModal, setDlLangModal]   = useState(null)
  // Stilwahl vor dem Erzeugen des Lebensposters
  const [posterZoom, setPosterZoom] = useState(null)   // { url, label } — Poster groß
  const [posterStyleModal, setPosterStyleModal] = useState(false)
  const [posterStyleSel, setPosterStyleSel] = useState(new Set())
  const [catalogForm, setCatalogForm] = useState(null)  // Editor-State (null = kein Editor offen)
  const [generating, setGenerating]   = useState({}) // { book_v1: true, ... }
  const [genProgress, setGenProgress] = useState({}) // { book_v1: 'Bild 3/7 …' }
  const [genPct, setGenPct]           = useState({}) // { book_v1: 42 } – Fortschritt in %
  const [genErr, setGenErr]           = useState({}) // { book_v1: 'Fehler …' } – Fehler PRO Variante (nicht global)
  const [genOwner, setGenOwner]       = useState({}) // { book_v1: <memorialId> } – welches Buchprojekt diese Variante generiert; Fortschritt/Fehler NUR dort anzeigen
  const [skipImages, setSkipImages]   = useState(false) // Debug: Bildgenerierung überspringen
  const [dlBusy, setDlBusy]           = useState('') // läuft ein Export? z. B. 'book_v1:docx'
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
  const [promptEdit, setPromptEdit]     = useState(null) // { i, text } – Bild-Prompt eines Kapitels bearbeiten
  const [promptSaving, setPromptSaving] = useState(false)
  const [coverModal, setCoverModal]     = useState(null) // { key, prep, filename } – Cover-Vorschau/Auswahl
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
  // Sortierung und Filter der Buchliste überdauern die Sitzung: Sie sind eine
  // Arbeitseinstellung des Menschen vor dem Bildschirm, keine Eigenschaft der
  // Daten — deshalb localStorage (pro Browser) und nicht die Datenbank. Ein
  // kaputter Eintrag darf das Dashboard nicht blockieren → im Zweifel Standard.
  const LIST_PREFS_KEY = 'lw_list_prefs'
  const loadListPrefs = () => {
    try {
      const p = JSON.parse(localStorage.getItem(LIST_PREFS_KEY) || 'null')
      return {
        sort: p?.sort?.key ? { key: String(p.sort.key), dir: p.sort.dir === 'desc' ? 'desc' : 'asc' } : { key: 'cutoff', dir: 'asc' },
        filters: p?.filters && typeof p.filters === 'object' ? p.filters : {},
      }
    } catch { return { sort: { key: 'cutoff', dir: 'asc' }, filters: {} } }
  }
  const [listPrefs] = useState(loadListPrefs)
  const [sort, setSort]               = useState(listPrefs.sort)   // Sortierung der Buchliste
  const [filters, setFilters]         = useState(listPrefs.filters) // { colKey: [erlaubte Werte] } – fehlt = keine Filterung
  const [filterCol, setFilterCol]     = useState(null) // welches Spalten-Filtermenü offen ist

  useEffect(() => {
    try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify({ sort, filters })) } catch { /* privater Modus */ }
  }, [sort, filters])

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
      const authInfo = {
        admin: Boolean(d.admin), cats: d.cats ?? [], uid: d.uid ?? null, username: d.username || username,
        // Endnutzer (Lebenswerk): kein Dashboard, sondern direkt das eigene Interview.
        enduser: Boolean(d.enduser), code: d.code || null,
      }
      sessionStorage.setItem('lw_admin_auth', JSON.stringify(authInfo))
      setToken(d.token); setAuth(authInfo)
      if (!authInfo.enduser) await loadMemorials(d.token)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function submitReset(e) {
    e.preventDefault()
    setResetBusy(true); setResetMsg('')
    try {
      await requestPasswordReset(resetEmail.trim())
    } catch { /* generisch bleiben */ }
    // Immer dieselbe Meldung – kein Rückschluss, ob die Adresse existiert.
    setResetMsg('Falls ein Konto zu dieser E-Mail existiert, haben wir einen Link zum Zurücksetzen des Passworts gesendet.')
    setResetBusy(false)
  }

  async function loadMemorials(t) {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401) { logout(); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMemorials(d); setView('list')
      loadCatalogs(t)      // Kataloge im Hintergrund laden (für Auswahl beim Anlegen)
      loadBookDefaults(t)  // Standardwerte der Anlage-Maske
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // ── Buch-Standardwerte ──
  // Fehler bewusst still: ohne geladene Werte greifen die Fallbacks aus
  // EMPTY_CREATE, die Anlage-Maske funktioniert also weiter.
  async function loadBookDefaults(t = token) {
    try {
      const d = await adminGetBookDefaults(t)
      setBookDefaults(d.defaults || null)
      setBdSaved(Boolean(d.saved))
    } catch { /* still */ }
  }

  async function openBookDefaults() {
    setErr(''); setBdMsg(''); setView('book-defaults')
    try {
      const d = await adminGetBookDefaults(token)
      setBookDefaults(d.defaults); setBdSaved(Boolean(d.saved))
      setBdForm({ ...d.defaults, pickupAddress: { ...EMPTY_PICKUP, ...(d.defaults.pickupAddress || {}) } })
    } catch (e) { setErr(e.message) }
  }

  async function saveBookDefaults() {
    if (!bdForm) return
    setBusy(true); setErr(''); setBdMsg('')
    try {
      const d = await adminSaveBookDefaults(token, bdForm)
      setBookDefaults(d.defaults); setBdSaved(true)
      setBdForm({ ...d.defaults, pickupAddress: { ...EMPTY_PICKUP, ...(d.defaults.pickupAddress || {}) } })
      setBdMsg('Gespeichert. Die Werte gelten für alle künftig angelegten Bücher.')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function resetBookDefaults() {
    if (!window.confirm('Standardwerte auf den Auslieferungszustand zurücksetzen?')) return
    setBusy(true); setErr(''); setBdMsg('')
    try {
      const d = await adminResetBookDefaults(token)
      setBookDefaults(d.defaults); setBdSaved(false)
      setBdForm({ ...d.defaults, pickupAddress: { ...EMPTY_PICKUP, ...(d.defaults.pickupAddress || {}) } })
      setBdMsg('Zurückgesetzt.')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
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
      resumeActiveJobs(memorial.id) // laufende serverseitige Jobs weiter anzeigen
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
      showTranscript: m.show_transcript !== false,
      showContributors: m.show_contributors !== false,
      photoUploadTab: m.photo_upload_tab === true,
      intake: m.intake ? { ...m.intake } : {},
      languages: Array.isArray(m.languages) && m.languages.length ? [...m.languages] : ['de'],
      note: m.note || '',
      pickupAddress: m.pickup_address ? { ...EMPTY_PICKUP, ...m.pickup_address } : { ...EMPTY_PICKUP },
      imageStyle: m.image_style || DEFAULT_IMAGE_STYLE,
      bookLayout: m.book_layout || DEFAULT_BOOK_LAYOUT,
      textStyle: m.text_style || defaultTextStyle(m.product_category),
      timerOn: (m.interview_timer_seconds || 0) > 0,
      timerMinutes: (m.interview_timer_seconds || 0) > 0 ? Math.round(m.interview_timer_seconds / 60) : 5,
      companionMode: m.companion_mode === true,
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
        cutoffDays: d.cutoffDays, showIntroVideo: d.showIntroVideo, showTranscript: d.showTranscript,
        showContributors: d.showContributors, photoUploadTab: d.photoUploadTab,
        intake: d.intake, languages: d.languages, note: d.note,
        pickupAddress: d.pickupAddress,
        imageStyle: d.imageStyle,
        bookLayout: d.bookLayout,
        textStyle: d.textStyle,
        productCategory: selected.product_category,   // erlaubt serverseitig die kategoriegenaue Normalisierung des Textstils
        interviewTimerSeconds: d.timerOn ? (parseInt(d.timerMinutes, 10) || 5) * 60 : 0,
        companionMode: d.companionMode === true,
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
        show_transcript: d.showTranscript !== false,
        show_contributors: d.showContributors !== false,
        photo_upload_tab: d.photoUploadTab === true,
        intake: d.intake && Object.keys(d.intake).length ? d.intake : (d.intake || null),
        languages: (d.languages && d.languages.length) ? d.languages : ['de'],
        note: d.note.trim() || null,
        pickup_address: hasAddr ? { ...pa, country: (pa.country || '').trim() || 'Deutschland' } : null,
        image_style: d.imageStyle || DEFAULT_IMAGE_STYLE,
        book_layout: d.bookLayout || DEFAULT_BOOK_LAYOUT,
        text_style: d.textStyle || defaultTextStyle(selected.product_category),
        interview_timer_seconds: d.timerOn ? (parseInt(d.timerMinutes, 10) || 5) * 60 : 0,
        companion_mode: d.companionMode === true,
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

  // Leeres Anlage-Formular für eine Kategorie: die Sockelwerte aus EMPTY_CREATE,
  // überschrieben von den im Dashboard gepflegten Standardwerten (falls geladen).
  function freshCreateForm(slug) {
    const d = bookDefaults || {}
    const base = {
      ...EMPTY_CREATE,
      ...d,
      productCategory: slug,
      intake: {},
      textStyle: defaultTextStyle(slug),
      pickupAddress: { ...EMPTY_PICKUP, ...(d.pickupAddress || {}) },
      languages: d.languages?.length ? [...d.languages] : [DEFAULT_LANGUAGE],
    }
    if (slug !== 'lifework') return base
    // Lebenswerk hat feste Regeln, die die allgemeinen Standardwerte überstimmen:
    // nur Variante 2, keine Frist, Foto-Upload an, Transkript-Umschalter aus,
    // keine Mitwirkenden-Liste (es erzählt nur ein Mensch).
    return {
      ...base,
      bookVariant: 2,
      cutoffDays: 0,
      showIntroVideo: false,
      showTranscript: false,
      showContributors: false,
      photoUploadTab: true,
      enduserEmail: '',
    }
  }

  // Startet die Neuanlage: bei mehreren erlaubten Kategorien erst Auswahl,
  // sonst direkt das Formular der einzigen Kategorie.
  function startCreate() {
    setErr('')
    if (allowedSlugs.length <= 1) {
      const slug = allowedSlugs[0] || DEFAULT_CATEGORY
      setCreateForm(freshCreateForm(slug))
      setView('create')
    } else {
      setView('create-category')
    }
  }

  function chooseCategory(slug) {
    setCreateForm(freshCreateForm(slug))
    setView('create')
  }

  async function handleCreate() {
    setErr(''); setBusy(true)
    try {
      const cat = getCategory(createForm.productCategory)
      const { code } = await createMemorial(token, {
        name: createForm.name.trim(),
        // Lebenswerk kennt keinen Organisator: Der Endnutzer erzählt sein eigenes
        // Leben. Damit die Spalte (Pflichtfeld, u. a. in der Buchliste sichtbar)
        // etwas Sinnvolles enthält, steht dort sein Name.
        organizer: createForm.productCategory === 'lifework'
          ? createForm.name.trim()
          : createForm.organizer.trim(),
        gender: cat.intake.useGender ? (createForm.gender || null) : null,
        bookVariant: createForm.bookVariant,
        funeralDate: cat.intake.useDate ? (createForm.funeralDate || null) : null,
        cutoffDays: createForm.cutoffDays,
        showIntroVideo: createForm.showIntroVideo,
        showTranscript: createForm.showTranscript,
        showContributors: createForm.showContributors,
        photoUploadTab: createForm.photoUploadTab,
        productCategory: createForm.productCategory,
        intake: createForm.intake || {},
        languages: createForm.languages?.length ? createForm.languages : [DEFAULT_LANGUAGE],
        note: createForm.note?.trim() || null,
        pickupAddress: createForm.pickupAddress,
        catalogId: createForm.catalogId || null,
        followups: createForm.followups,
        imageStyle: createForm.imageStyle || DEFAULT_IMAGE_STYLE,
        bookLayout: createForm.bookLayout || DEFAULT_BOOK_LAYOUT,
        textStyle: createForm.textStyle || defaultTextStyle(createForm.productCategory),
        interviewTimerSeconds: createForm.timerOn ? (parseInt(createForm.timerMinutes, 10) || 5) * 60 : 0,
        companionMode: createForm.companionMode === true,
        // Lebenswerk: Endnutzer-Konto + Einladung (Server legt beides an) und die
        // Wahl, ob statt des Standardkatalogs frei generierte KI-Fragen laufen.
        enduserEmail: createForm.enduserEmail?.trim() || null,
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
  async function loadFeedback() {
    setErr(''); setLoading(true)
    try { setQmData(await adminListFeedback(token)) }
    catch (e) { setErr(e.message) } finally { setLoading(false) }
  }
  // Bewertung als „erledigt" markieren (optimistisch, dann Server).
  async function toggleFeedbackDone(id, done) {
    setQmData(rows => rows.map(r => r.id === id ? { ...r, done } : r))
    try { await adminSetFeedbackDone(token, id, done) }
    catch (e) { setErr(e.message); setQmData(rows => rows.map(r => r.id === id ? { ...r, done: !done } : r)) }
  }
  // Bewertung entfernen (nach Rückfrage). Contribution bleibt bestehen.
  async function deleteFeedback(id) {
    if (!window.confirm('Diese Bewertung wirklich löschen? Der zugehörige Beitrag bleibt erhalten.')) return
    const prev = qmData
    setQmData(rows => rows.filter(r => r.id !== id))
    try { await adminDeleteFeedback(token, id) }
    catch (e) { setErr(e.message); setQmData(prev) }
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
      if (u.invite_token) setCreatedInvite({ username: u.username, url: inviteLink(u.invite_token), demo: u.demo, demoError: u.demo_error, emailSent: u.email_sent, emailError: u.email_error })
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
        setCreatedInvite({ username: user.username, url: inviteLink(d.invite_token), emailSent: d.email_sent, emailError: d.email_error })
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

  // Den Text einer einzelnen Antwort (Nachricht an Index idx) korrigieren.
  async function saveAnswerText(c, idx, text) {
    setErr('')
    const newMessages = c.messages.map((m, i) => i === idx ? { ...m, content: text } : m)
    try {
      const updated = await adminUpdateContributionMessages(token, c.id, newMessages)
      setContribs(cs => cs.map(x => x.id === c.id ? updated : x))
      if (selectedContrib?.id === c.id) setSelectedContrib(updated)
      return true
    } catch (e) { setErr(e.message); return false }
  }

  // Stammdaten eines Beitrags ändern (Name des/der Beitragenden, Beziehung).
  async function saveContribMeta(id, patch) {
    setErr('')
    try {
      const updated = await adminUpdateContributionMeta(token, id, patch)
      setContribs(cs => cs.map(x => x.id === id ? updated : x))
      if (selectedContrib?.id === id) setSelectedContrib(updated)
      return true
    } catch (e) { setErr(e.message); return false }
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
        // Faktentreue-Befunde brauchen eine ANDERE Korrektur als Datenschutz-
        // Befunde: Eine Erfindung darf nicht „neutral umformuliert", sondern muss
        // auf das zurückgeschnitten werden, was tatsächlich belegt ist — notfalls
        // ersatzlos. „Neutralisieren" würde die erfundene Substanz stehen lassen.
        const factual = f => ['Nicht belegt/erfunden', 'Wiederholung'].includes(String(f?.category || ''))
        const sys = factual(finding)
          ? 'Du bist ein sorgfältiger Lektor. Die markierte Stelle enthält Inhalt, der durch die Quellen NICHT gedeckt ist (erfunden) oder an anderer Stelle bereits erzählt wurde. Streiche den nicht belegten bzw. doppelten Inhalt ERSATZLOS und gib nur so viel Text zurück, wie nötig ist, damit der Absatz sprachlich weiterläuft — im Zweifel einen kürzeren Satz oder gar nichts (leere Antwort ist erlaubt, wenn die Stelle komplett entfallen kann). Erfinde KEINEN Ersatzinhalt und formuliere die Behauptung nicht bloß vorsichtiger („vielleicht", „womöglich") — sie muss weg. Gib AUSSCHLIESSLICH den Ersatztext zurück – ohne Anführungszeichen, ohne Erklärung, ohne Markdown.'
          : 'Du bist ein sorgfältiger Lektor. Formuliere NUR die markierte Stelle neutral um, sodass der beanstandete Inhalt entfällt, der Ton aber erhalten bleibt und sie sich nahtlos in den umgebenden Text einfügt. Gib AUSSCHLIESSLICH den Ersatztext zurück – ohne Anführungszeichen, ohne Erklärung, ohne Markdown.'
        const user = `UMGEBENDER ABSATZ:\n${ctxPara}\n\nZU ERSETZENDE STELLE:\n${quote}\n\nHINWEIS DER PRÜFUNG:\n${finding.note || ''}`
        newText = String(await askLLM(sys, [{ role: 'user', content: user }], { memorialCode: selected.id, kind: 'review_fix', token })).trim().replace(/^[„"»«\s]+|[„"»«\s]+$/g, '')
        // Bei Faktentreue-Befunden ist eine leere Antwort ein gültiges Ergebnis:
        // Die erfundene/doppelte Stelle entfällt ersatzlos.
        if (!newText && !factual(finding)) throw new Error('Leere Antwort der KI.')
        corrected = newText
          ? target.replace(quote, newText)
          : target.replace(quote, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
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
  // Aktive serverseitige Job-IDs je Generator-Key (für Cancel + Wiederaufnahme).
  const genJobRef = useRef({})
  function cancelGenerate(key) {
    cancelGenRef.current[key] = true
    setGenProgress(p => ({ ...p, [key]: 'Wird abgebrochen …' }))
    const jid = genJobRef.current[key]
    if (jid) cancelGenerationJob(token, jid).catch(() => {})
  }

  // Pollt einen serverseitigen Generierungs-Job bis done/error/canceled und
  // spiegelt den Fortschritt ins UI. Abbruch via cancelGenRef → __CANCELLED__.
  async function pollGeneration(key, jobId) {
    while (true) {
      if (cancelGenRef.current[key]) { try { await cancelGenerationJob(token, jobId) } catch {} throw new Error('__CANCELLED__') }
      let job = null
      try { job = (await getGenerationJob(token, { id: jobId })).job } catch { /* transient, weiter pollen */ }
      if (job) {
        const pr = job.progress || {}
        if (pr.total) setGenPct(p => ({ ...p, [key]: Math.min(99, Math.round(((pr.cursor || 0) / pr.total) * 100)) }))
        if (pr.message) setGenProgress(p => ({ ...p, [key]: `${pr.message} …` }))
        if (job.status === 'done') return job
        if (job.status === 'canceled') throw new Error('__CANCELLED__')
        if (job.status === 'error') throw new Error(job.error || 'Generierung fehlgeschlagen.')
      }
      await new Promise(r => setTimeout(r, 2500))
    }
  }

  // Beim Öffnen eines Buchprojekts noch laufende serverseitige Jobs erkennen und
  // die Fortschrittsanzeige wieder aufnehmen (falls die Erstellung in einem
  // anderen Tab/nach Reload weiterläuft). Rein additiv, voll fehlertolerant.
  async function resumeActiveJobs(memId) {
    try {
      const { jobs } = await getGenerationJob(token, { memorialCode: memId })
      for (const job of (jobs || [])) {
        if (job.status !== 'queued' && job.status !== 'running') continue
        const key = job.kind
        if (!key || genJobRef.current[key] === job.id) continue // schon dran
        genJobRef.current[key] = job.id
        cancelGenRef.current[key] = false
        setGenOwner(o => ({ ...o, [key]: memId }))
        setGenErr(p => ({ ...p, [key]: '' }))
        setGenerating(g => ({ ...g, [key]: true }))
        setGenProgress(p => ({ ...p, [key]: 'Wird serverseitig erstellt …' }))
        ;(async () => {
          try {
            await pollGeneration(key, job.id)
            const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
            if (r.ok) { const fresh = await r.json(); setMemorials(fresh); const u = fresh.find(m => m.id === memId); if (u) setSelected(s => (s && s.id === memId ? u : s)) }
            setGenPct(p => ({ ...p, [key]: 100 }))
          } catch (e) {
            if (e.message !== '__CANCELLED__') setGenErr(p => ({ ...p, [key]: `Generieren fehlgeschlagen: ${e.message}` }))
          } finally {
            setGenerating(g => ({ ...g, [key]: false }))
            setGenProgress(p => ({ ...p, [key]: '' }))
            setGenPct(p => ({ ...p, [key]: undefined }))
            genJobRef.current[key] = null
          }
        })()
      }
    } catch { /* egal – nur Komfort */ }
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
      let serverSaved = false // true, wenn der serverseitige Worker bereits gespeichert hat

      if (gen.kind === 'book') {
        // Phase 1: Buch-Gerüst (Outline) – client-seitig, damit die Kapitel-
        // Prompts gebaut werden können (kurzer Call). Die lange Kapitel- und
        // Bildphase läuft danach serverseitig robust (Job + Worker), unabhängig
        // von der Browser-Verbindung.
        setGenProgress(p => ({ ...p, [key]: 'Buch-Gerüst wird geplant …' }))
        const outlineSys = gen.outlineSystem(selected, contributions) + dir
        let outline = null, lastOutlineRaw = ''
        for (let attempt = 1; attempt <= 3; attempt++) {
          checkCancel()
          lastOutlineRaw = await askLLM(outlineSys, [{ role: 'user', content: 'Erzeuge jetzt das Gerüst als JSON.' }], { memorialCode: selected.id, kind: `${key}_outline`, token })
          const parsed = tryParseJSON(lastOutlineRaw)
          if (parsed && parsed.title) { outline = parsed; break }
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
        }
        if (!outline) {
          const snip = String(lastOutlineRaw || '').replace(/\s+/g, ' ').trim().slice(0, 200)
          throw new Error('Buch-Gerüst konnte nicht als JSON gelesen werden (auch nach mehreren Versuchen).' + (snip ? ` Antwort des KI-Dienstes begann mit: „${snip}…"` : ' Der KI-Dienst lieferte eine leere Antwort.'))
        }
        const chapterPlans = key === 'book_v1'
          ? contributions.map((c, i) => ({ number: i + 1, contribution: c }))
          : (Array.isArray(outline.chapters) ? outline.chapters : [])
        if (chapterPlans.length === 0) throw new Error('Keine Kapitel im Buch-Gerüst gefunden.')
        // Kapitel-Prompts als Job-Plan – der Worker schreibt die Kapitel, ordnet
        // Fotos zu und erzeugt die Bilder serverseitig.
        const chapterSteps = chapterPlans.map(plan => ({
          system: (key === 'book_v1'
            ? gen.chapterSystem(selected, plan.contribution, plan.number)
            // Die GANZE Gliederung mitgeben: Jedes Kapitel entsteht in einem eigenen
            // KI-Aufruf mit allen Beiträgen im Kontext — ohne die Gliederung landete
            // dieselbe Anekdote in mehreren Kapiteln.
            : gen.chapterSystem(selected, contributions, plan, chapterPlans)) + dir,
          user: 'Erzeuge jetzt dieses eine Kapitel als JSON.',
          meta: {
            number: plan.number,
            ...(plan.heading ? { heading: plan.heading } : {}),
            ...(key === 'book_v1' && plan.contribution?.id ? { contribution_id: plan.contribution.id, contributor_name: plan.contribution.contributor_name, relationship: plan.contribution.relationship } : {}),
          },
        }))
        const uploads = Array.isArray(selected.uploaded_images) ? selected.uploaded_images : []
        const oldChapters = Array.isArray(selected[gen.field]?.chapters) ? selected[gen.field].chapters : []
        setGenProgress(p => ({ ...p, [key]: 'Wird serverseitig erstellt …' }))
        const { jobId } = await enqueueGeneration(token, selected.id, key, {
          resultType: 'book', field: gen.field, variant: key, language: genLang,
          title: outline.title, subtitle: outline.subtitle || '',
          dir, skipImages, imageStyle: selected.image_style || DEFAULT_IMAGE_STYLE,
          uploads, oldChapters, chapterSteps,
          reviewSystem: reviewSystemPrompt(selected), reviewContribContext: contributionsContext(contributions),
        })
        genJobRef.current[key] = jobId
        const finalJob = await pollGeneration(key, jobId)
        const pe = finalJob?.progress || {}
        if (pe.errors > 0) setGenErr(p => ({ ...p, [key]: `${pe.errors} Teil-Fehler bei der Erstellung.${pe.firstError ? ' Erster: ' + pe.firstError : ''}` }))
        // Gespeichertes Buch laden (für die Inhaltsprüfung im geteilten Tail).
        try {
          const rr = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
          if (rr.ok) { const fresh = await rr.json(); const u = fresh.find(m => m.id === selected.id); value = (u && u[gen.field]) || null }
        } catch {}
        serverSaved = true
        stepsDone = stepsTotal
      } else if (gen.kind === 'eulogy') {
        // Serverseitig erzeugen: Die Abschnitts-Prompts werden hier (mit
        // categories.js) gebaut und als Job-Plan an den Worker übergeben. Der
        // arbeitet sie robust ab und speichert selbst — bricht die Browser-
        // Verbindung ab, läuft der Job weiter; das UI pollt nur den Status.
        const sections = gen.sections || []
        // Das Pflegeexzerpt ist ein GEGLIEDERTES Dokument: Jeder Abschnitt bekommt
        // seine Überschrift (in ALLEN Stilvarianten identisch — sie kommt vom
        // Layout, nicht von der KI). Eine Rede dagegen wird am Stück vorgelesen und
        // bleibt ohne Zwischenüberschriften.
        const withHeadings = selected?.product_category === 'lifework'
        const steps = sections.map(section => ({
          system: gen.sectionSystem(selected, contributions, section, extraArg) + dir,
          user: `Schreibe jetzt den Abschnitt „${section.label}" der ${gen.noun}.`,
          label: `Abschnitt: ${section.label}`,
          ...(withHeadings ? { prefix: `## ${section.label}` } : {}),
        }))
        stepsTotal = steps.length
        setGenProgress(p => ({ ...p, [key]: 'Wird serverseitig erstellt …' }))
        const { jobId } = await enqueueGeneration(token, selected.id, key, {
          field: gen.field, resultType: 'text-join', combine: '\n\n', steps,
          // Pflegeexzerpt: NUR Faktentreue prüfen. Es geht an die Pflegekräfte, die
          // diesen Menschen betreuen — sie müssen gerade das Schwierige wissen; eine
          // Datenschutzprüfung würde genau den Zweck des Dokuments anmahnen.
          reviewSystem: reviewSystemPrompt(selected, { mode: withHeadings ? 'facts' : 'full' }),
          reviewContribContext: contributionsContext(contributions),
        })
        genJobRef.current[key] = jobId
        const finalJob = await pollGeneration(key, jobId) // wartet bis done/error/canceled
        // Teil-Fehler (einzelne Abschnitte) als nicht-fatalen Hinweis zeigen.
        const pe = finalJob?.progress || {}
        if (pe.errors > 0) setGenErr(p => ({ ...p, [key]: `${pe.errors}/${stepsTotal} Abschnitt-Fehler.${pe.firstError ? ' Erster: ' + pe.firstError : ''}` }))
        // Der Worker hat gespeichert → aktuellen Text laden (für Inhaltsprüfung).
        try {
          const rr = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
          if (rr.ok) { const fresh = await rr.json(); const u = fresh.find(m => m.id === selected.id); value = (u && u[gen.field]) || '' }
        } catch {}
        serverSaved = true
        stepsDone = stepsTotal // Prozent bleibt bei ~99 %, bis der Reload 100 % setzt
      } else {
        // Sonstige Plain-Text-Generatoren (derzeit keiner)
        const raw = await askLLM(
          gen.system(selected, contributions, extraArg),
          [{ role: 'user', content: gen.userPrompt }],
          { memorialCode: selected.id, kind: key }
        )
        value = raw
      }

      // Nur speichern, wenn NICHT bereits serverseitig geschrieben (Job-Weg).
      if (!serverSaved) await adminSaveMemorialText(token, selected.id, gen.field, value)

      // Inhalts-/Datenschutzprüfung des generierten Textes (separater KI-
      // Call). Fehler hier dürfen die Generierung NICHT scheitern lassen –
      // der Text ist bereits gespeichert.
      // Inhaltsprüfung: bei serverseitigen Jobs erledigt sie der Worker (läuft
      // IMMER, auch bei Verbindungsabbruch). Nur beim (derzeit ungenutzten)
      // Client-Pfad hier prüfen.
      if (!serverSaved) {
        setGenProgress(p => ({ ...p, [key]: 'Inhaltsprüfung läuft …' }))
        try { if (value) await runContentReview(gen.field, value) }
        catch (e) { console.warn('Inhaltsprüfung fehlgeschlagen:', e.message) }
      }
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

  // Download anstoßen. Sonderfall Pflegeexzerpt (Lebenswerk): Der Text entsteht
  // IMMER auf Deutsch; erst beim Speichern wird die Zielsprache gefragt — es geht
  // in eine Pflegeakte, die Sprache hängt am Pflegeteam, nicht am Buch.
  // fmt: 'docx' | 'pdf'
  function requestDownload(key, fmt = 'docx') {
    if (key === 'eulogy' && selected?.product_category === 'lifework' && selected?.eulogy_text) {
      setDlLangModal({ key, fmt })
      return
    }
    if (key === 'eulogy' && fmt === 'pdf') { downloadTextAsPdf(selected?.eulogy_text, selected?.languages?.[0] || 'de'); return }
    downloadGenerated(key)
  }

  // Fließtext-PDF (Pflegeexzerpt/Rede). `lang` steuert nur den KI-Hinweis am Ende.
  function downloadTextAsPdf(text, lang, suffix = '') {
    if (!text) return
    const gen = GENERATORS.eulogy
    setDlBusy('eulogy:pdf'); setErr('')
    try {
      downloadTextPdf(
        `${gen.filename}_${safeName(selected.name)}${suffix}.pdf`,
        `${gen.label} – ${selected.name}`,
        text, lang,
      )
    } catch (e) { setErr(`PDF fehlgeschlagen: ${e.message}`) }
    finally { setDlBusy('') }
  }

  // Zielsprache des Exzerpts gewählt: Deutsch → direkt laden, sonst erst
  // übersetzen. Das Original (Deutsch) bleibt am Buch gespeichert; übersetzt wird
  // nur die heruntergeladene Fassung.
  async function pickDlLang(code) {
    const m = dlLangModal
    setDlLangModal(null)
    if (!m) return
    const fmt = m.fmt || 'docx'
    if (code === 'de') {
      if (fmt === 'pdf') downloadTextAsPdf(selected?.eulogy_text, 'de')
      else downloadGenerated('eulogy')
      return
    }

    const gen = GENERATORS.eulogy
    const source = selected?.eulogy_text
    if (!source) return
    setDlBusy(`eulogy:${fmt}`); setErr('')
    try {
      const target = LANGUAGES.find(l => l.code === code)?.label || code
      const sys = `Du bist ein professioneller Fachübersetzer für Pflegedokumentation. Übersetze den folgenden deutschen Text („${gen.noun}", Bestandteil einer Pflegeakte) nach ${target} (Sprachcode ${code}).

Regeln:
- Übersetze VOLLSTÄNDIG und sinngetreu. Nichts weglassen, nichts hinzufügen, nichts interpretieren.
- Struktur exakt beibehalten: Absätze, Reihenfolge, Abschnittsüberschriften (auch die Überschriften übersetzen).
- Eigennamen, Orte und Jahreszahlen unverändert lassen.
- Pflegefachliche Begriffe in der Zielsprache fachlich korrekt und gebräuchlich wiedergeben.
- Gib AUSSCHLIESSLICH den übersetzten Text aus — keine Vorbemerkung, keine Erklärung, kein Markdown.`
      const translated = await askLLM(sys, [{ role: 'user', content: String(source) }],
        { memorialCode: selected.id, kind: 'eulogy_translate', token })
      if (!String(translated || '').trim()) throw new Error('Die Übersetzung kam leer zurück.')
      if (fmt === 'pdf') {
        downloadTextAsPdf(translated, code, `_${code.toUpperCase()}`)
      } else {
        const filename = `${gen.filename}_${safeName(selected.name)}_${code.toUpperCase()}.docx`
        await downloadAsDocx(filename, `${gen.label} – ${selected.name}`, translated, code)
      }
    } catch (e) { setErr(`Übersetzung/Download fehlgeschlagen: ${e.message}`) }
    finally { setDlBusy('') }
  }

  async function downloadGenerated(key) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data || dlBusy) return
    setDlBusy(`${key}:docx`); setErr('')
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}.docx`
      if (gen.kind === 'book') await downloadStructuredDocx(filename, data, contributions, selected.owner_logo, getBookLayout(selected.book_layout), { showContributors: selected.show_contributors !== false, selfNarrated: selected.product_category === 'lifework' })
      else                     await downloadAsDocx(filename, `${gen.label} – ${selected.name}`, data, selected.languages?.[0] || 'de')
    } catch (e) { setErr(`Download fehlgeschlagen: ${e.message}`) }
    finally { setDlBusy('') }
  }

  // Druckfertiges PDF (nur Bücher): doppelseitiges Bild, Kapitel beginnen rechts.
  async function downloadGeneratedPdf(key, store = false) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data || gen.kind !== 'book' || dlBusy) return
    setDlBusy(`${key}:pdf`); setErr('')
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}_Druck.pdf`
      const { pages, blob } = await downloadPrintPdf(filename, data, contributions, selected.owner_logo, getBookLayout(selected.book_layout), { showContributors: selected.show_contributors !== false, selfNarrated: selected.product_category === 'lifework' })
      // Seitenzahl am Buch festhalten — sie bestimmt die Rückenstärke des Covers
      // und schaltet den Cover-Button frei.
      if (pages && pages !== data.print_pages) {
        const updated = { ...data, print_pages: pages }
        await adminSaveMemorialText(token, selected.id, gen.field, updated)
        setSelected(s => ({ ...s, [gen.field]: updated }))
        setMemorials(ms => ms.map(x => x.id === selected.id ? { ...x, [gen.field]: updated } : x))
      }
      // Optional: dieselbe PDF-Datei zusätzlich auf dem Server ablegen und einen
      // dauerhaften (signierten) Download-Link in der Detailansicht anzeigen.
      if (store && blob) {
        setDlBusy(`${key}:pdf-store`)
        const dataBase64 = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Datei-Lesefehler')); r.readAsDataURL(blob)
        })
        const out = await storeMemorialPdf(token, selected.id, { variant: key, filename, dataBase64 })
        const entry = { url: out.url, slug: out.stored_pdfs?.[key]?.slug || null, filename, at: new Date().toISOString() }
        setSelected(s => ({ ...s, stored_pdf_urls: { ...(s.stored_pdf_urls || {}), [key]: entry } }))
        setMemorials(ms => ms.map(x => x.id === selected.id ? { ...x, stored_pdf_urls: { ...(x.stored_pdf_urls || {}), [key]: entry } } : x))
      }
    } catch (e) { setErr(`Druck-PDF fehlgeschlagen: ${e.message}`) }
    finally { setDlBusy('') }
  }

  // Motiv für den Cover-Hintergrund. Bewusst ruhig und ohne Personen im Zentrum:
  // Über die Bildmitte läuft der Buchrücken, links liegt der Logo-Kasten, rechts
  // der Titelkasten. Der Grafikstil kommt serverseitig dazu (image-styles.js).
  // WICHTIG: Weder „book cover" noch den Buchtitel erwähnen! Beides hat FLUX dazu
  // gebracht, ein fertiges Cover-MOCKUP zu malen — mit eingewebtem Titel, Pseudo-
  // Untertitel und erfundenem Logo. Das nachgestellte „no text" verliert gegen so
  // eine Ansage. Der Prompt beschreibt deshalb ausschließlich die SZENE; dass es
  // ein Cover wird, ist allein Sache des Layouts hier im Code.
  function coverPrompt(book, mem) {
    const motifs = (book.chapters || [])
      .map(c => c.image_prompt).filter(Boolean).slice(0, 3).join(' / ')
    return [
      'A wide, calm establishing scene — an atmospheric place, landscape or interior.',
      motifs ? `Echo the world of these scenes: ${motifs}.` : '',
      // Die Hälften werden im fertigen Buch NIE zusammen gesehen (der Rücken
      // trennt sie): rechts = Vorderseite (Hauptmotiv), links = Rückseite (ruhig,
      // aber für sich stimmig). Jede Hälfte muss allein als Bild funktionieren.
      'Composition: the RIGHT half carries the main motif — it is the visual centre of gravity, with the most detail and interest.',
      'The LEFT half is markedly calmer and more open, but still a coherent little scene in its own right, not empty filler.',
      'Each half must work as a complete picture on its own; keep the exact vertical centre free of important elements.',
      'Leave some quiet, low-detail areas so text can be placed on top later.',
      'Soft harmonious colors, gentle light, tranquil and dignified mood.',
      'No people in the foreground and no close-up faces.',
      'Absolutely no text, no letters, no words, no title, no captions, no signage, no logos, no watermarks.',
    ].filter(Boolean).join(' ')
  }

  // ── Druck-Cover (eigenes PDF: Rückseite + Buchrücken + Vorderseite) ──
  // Braucht die Seitenzahl des Druck-PDFs (Rückenstärke) → erst danach aktiv.
  // Der Hintergrund wird erzeugt und am Buch gespeichert (cover_image_path) — ein
  // erneuter Klick verwendet ihn wieder und kostet nichts. ABER: Zusammen mit dem
  // Pfad wird der Grafikstil festgehalten (cover_image_style). Wird der Stil des
  // Buchs später geändert, passt der gespeicherte Hintergrund nicht mehr und wird
  // automatisch neu erzeugt — sonst bliebe das Cover im alten Stil hängen.
  async function downloadCover(key) {
    const gen = GENERATORS[key]
    const book = selected?.[gen.field]
    if (!book || gen.kind !== 'book' || dlBusy) return
    const pages = book.print_pages
    if (!pages) { setErr('Bitte zuerst das Druck-PDF erzeugen — daraus ergibt sich die Rückenstärke.'); return }

    setDlBusy(`${key}:cover`); setErr('')
    try {
      // Rückenstärke früh prüfen (>400 Seiten → klare Fehlermeldung, kein Bild erzeugen).
      spineWidthMm(pages)

      const style = selected.image_style || DEFAULT_IMAGE_STYLE
      let bgUrl = book.cover_image_url
      const styleChanged = book.cover_image_style !== style
      // Version des Cover-Prompts: Wird der Prompt verbessert, sind alle mit dem
      // alten erzeugten Hintergründe überholt und werden einmalig neu erzeugt.
      const promptOld = (book.cover_prompt_v || 1) < COVER_PROMPT_VERSION
      if (!book.cover_image_path || !bgUrl || styleChanged || promptOld) {
        setDlBusy(`${key}:cover-img`)
        const prompt = coverPrompt(book, selected)
        const { storagePath } = await generateImageWithRetry(selected.id, prompt, {
          meta: { variant: key, chapterNumber: 0, chapterHeading: 'Cover' },
          onWait: (s, rl) => setErr(rl ? `Rate-Limit — neuer Versuch in ${s}s …` : `Erneuter Versuch in ${s}s …`),
        })
        setErr('')
        // Der alte Hintergrund wird beim Speichern serverseitig aufgeräumt
        // (collectImagePaths kennt cover_image_path).
        const updated = { ...book, cover_image_path: storagePath, cover_image_style: style, cover_prompt_v: COVER_PROMPT_VERSION }
        await adminSaveMemorialText(token, selected.id, gen.field, updated)
        // Neu laden, damit die signierte URL für den frischen Hintergrund ankommt.
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (!r.ok) throw new Error('Cover-Hintergrund konnte nicht geladen werden.')
        const fresh = await r.json()
        setMemorials(fresh)
        const m = fresh.find(x => x.id === selected.id)
        if (m) setSelected(m)
        bgUrl = m?.[gen.field]?.cover_image_url
        if (!bgUrl) throw new Error('Cover-Hintergrund wurde erzeugt, aber keine Bild-URL erhalten.')
      }

      setDlBusy(`${key}:cover`)
      // Nicht direkt herunterladen: erst die Lagen des Titelstreifens zeigen und
      // den Admin wählen lassen. Die automatische Wahl trifft nicht jedes Motiv.
      const prep = await prepareCover({
        bgUrl,
        pages,
        title: book.title || selected.name,
        subtitle: book.subtitle || '',
        layout: getBookLayout(selected.book_layout),
      })
      setCoverModal({ key, prep, filename: `${gen.filename}_${safeName(selected.name)}_Cover.pdf` })
    } catch (e) { setErr(`Druck-Cover fehlgeschlagen: ${e.message}`) }
    finally { setDlBusy('') }
  }

  function saveCover(posKey) {
    if (!coverModal) return
    try {
      downloadCoverPdf(coverModal.filename, coverModal.prep, posKey)
      setCoverModal(null)
    } catch (e) { setErr(`Druck-Cover fehlgeschlagen: ${e.message}`) }
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
    const langs = genLangs(key)
    if (langs.length > 1) { setGenLangModal({ key, extraArg }); return }
    generate(key, extraArg, { lang: langs[0], skipConfirm: extraArg !== undefined })
  }
  // Zur Auswahl stehende Sprachen einer Erzeugung. Sonderfall Pflegeexzerpt
  // (Lebenswerk): Es entsteht IMMER auf Deutsch — die Zielsprache wird erst beim
  // Speichern gefragt und der Text dann übersetzt (siehe pickDlLang).
  function genLangs(key) {
    const langs = (selected?.languages && selected.languages.length) ? selected.languages : [DEFAULT_LANGUAGE]
    if (key === 'eulogy' && selected?.product_category === 'lifework') return ['de']
    return langs
  }
  function pickGenLang(code) {
    const m = genLangModal
    setGenLangModal(null)
    if (m) generate(m.key, m.extraArg, { lang: code, skipConfirm: m.extraArg !== undefined })
  }

  // ── Lebenswerk-Nebenprodukte: Stammbaum + Lebensposter ──
  // Ablauf für beide: Die KI liest das Interview und liefert STRUKTURIERTES JSON,
  // das am Buch gespeichert wird; gezeichnet (und als PDF geladen) wird daraus im
  // Browser (src/lifeworkExtras.js).
  //
  // Beim POSTER kommt die Bildarbeit dazu: Zu jeder Lebensstation entsteht eine
  // freigestellte Vignette (FLUX im Modus 'vignette', im gewählten Poster-Stil).
  // Ein einzelnes fehlgeschlagenes Bild ist NICHT fatal — die Station bekommt dann
  // nur einen leeren Kreis, das Poster entsteht trotzdem.
  // Beide Nebenprodukte laufen SERVERSEITIG als Job (wie Buch und Rede): Der
  // Browser stellt den Auftrag ein und pollt nur noch den Fortschritt. Schließt
  // man den Tab, läuft die Erzeugung weiter — und sie lässt sich abbrechen.
  // Vor der Poster-Erzeugung wählt der Nutzer die Stile (1–5). Jeder Stil kostet
  // einen eigenen Satz Szenenbilder — die Auswahl bestimmt also Dauer und Kosten.
  function requestPoster() {
    if (!selected) return
    if (contributions.length === 0) { setErr('Es liegt noch kein Interview vor.'); return }
    setPosterStyleSel(new Set(POSTER_STYLES.map(s => s.key)))
    setPosterStyleModal(true)
  }

  async function generateExtra(kind, posterStyles = POSTER_STYLES.map(s => s.key)) {
    if (!selected) return
    const isTree = kind === 'tree'
    const field = isTree ? 'family_tree' : 'life_poster'
    if (contributions.length === 0) { setErr('Es liegt noch kein Interview vor.'); return }
    if (selected[field] && !window.confirm(`${isTree ? 'Der Stammbaum' : 'Das Lebensposter'} wird neu erzeugt und ersetzt die bisherige Fassung. Fortfahren?`)) return

    setErr('')
    setGenErr(p => ({ ...p, [kind]: '' }))
    setGenOwner(o => ({ ...o, [kind]: selected.id }))
    setGenerating(g => ({ ...g, [kind]: true }))
    setGenProgress(p => ({ ...p, [kind]: isTree ? 'Familie wird gelesen …' : 'Lebensstationen werden gesammelt …' }))
    setGenPct(p => ({ ...p, [kind]: 0 }))
    cancelGenRef.current[kind] = false
    try {
      const params = isTree
        ? { resultType: 'json', field, kind: 'family_tree', memorialCode: selected.id, label: 'Familie wird gelesen',
            system: treeSystem(selected, contributions), user: 'Gib jetzt das JSON aus.' }
        // Poster: EIN Satz Inhalte, daraus je gewähltem Stil ein Blatt. Der Worker
        // zeichnet die Szenen einzeln; die Detailansicht zeigt die Blätter nebeneinander.
        : { resultType: 'poster', field, kind: 'life_poster', memorialCode: selected.id,
            posterStyles,
            system: posterSystem(selected, contributions), user: 'Gib jetzt das JSON aus.' }
      const { jobId } = await enqueueGeneration(token, selected.id, kind, params)
      genJobRef.current[kind] = jobId
      await pollGeneration(kind, jobId)

      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json(); setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) setSelected(u)
      }
      setGenPct(p => ({ ...p, [kind]: 100 }))
    } catch (e) {
      const msg = e.message === '__CANCELLED__' ? 'Abgebrochen.' : e.message
      setGenErr(p => ({ ...p, [kind]: msg }))
    } finally {
      setGenerating(g => ({ ...g, [kind]: false }))
      setGenProgress(p => ({ ...p, [kind]: '' }))
    }
  }

  // Lädt das PDF aus dem gespeicherten JSON — ohne die KI erneut zu bemühen.
  // Dauert trotzdem spürbar: Beim Poster werden bis zu 20 Vignetten geladen und
  // ein mehrere MB großes PDF gezeichnet. Deshalb ein eigener Busy-Zustand.
  async function downloadExtra(kind, mem = selected, styleKey = null) {
    const isTree = kind === 'tree'
    const data = isTree ? mem?.family_tree : mem?.life_poster
    if (!data) { setErr(isTree ? 'Es gibt noch keinen Stammbaum.' : 'Es gibt noch kein Lebensposter.'); return }
    const base = `${isTree ? 'Stammbaum' : 'Lebensposter'}_${(mem.name || '').replace(/[^\w\säöüÄÖÜß-]/g, '').trim().replace(/\s+/g, '_')}`
    setExtraDl(styleKey ? `poster:${styleKey}` : kind); setErr('')
    try {
      if (isTree) downloadTreePdf(`${base}.pdf`, data, mem)
      // Aktuelles Poster: EIN gemaltes Blatt je Stil, Text als Vektor darüber.
      else if (Array.isArray(data.variants) && data.variants.length) {
        const v = data.variants.find(x => x.style === styleKey) || data.variants[0]
        await downloadPosterVariantPdf(`${base}_${v.style}.pdf`, data, v, v.style)
      }
      // Ältere Poster bleiben ladbar: ein Gesamtmotiv mit Vektortext darüber …
      else if (data.scene_url || data.scene_path) {
        if (!data.scene_url) throw new Error('Das Poster-Motiv konnte nicht geladen werden — bitte die Seite neu laden.')
        await downloadPosterScenePdf(`${base}.pdf`, data, data.scene_url, data.style)
      }
      // … bzw. die allererste Fassung mit einer Vignette je Station.
      else {
        const urls = {}
        ;(data.sections || []).forEach((sec, si) => {
          ;(sec.stations || []).forEach((st, ti) => { if (st?.image_url) urls[`${si}:${ti}`] = st.image_url })
        })
        await downloadPosterPdf(`${base}.pdf`, data, urls, data.style)
      }
    } catch (e) { setErr(e.message) }
    finally { setExtraDl('') }
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

  // ── Bild-Prompt eines Kapitels von Hand ändern ──
  // Der Prompt wird im Buch gespeichert (chapters[i].image_prompt) und ist damit
  // genau der Text, den regenerateSelectedImages an FLUX schickt. Grafikstil und
  // Doppelseiten-Komposition kommen weiterhin serverseitig dazu (image-styles.js /
  // SPREAD_DIRECTIVE) – die muss (und soll) man hier nicht mitschreiben.
  function openPromptEdit(i) {
    const gen = GENERATORS[imgEditModal.key]
    const ch = selected?.[gen.field]?.chapters?.[i]
    setPromptEdit({ i, text: ch?.image_prompt || '' })
  }

  async function savePromptEdit({ regenerate = false } = {}) {
    if (!promptEdit || !imgEditModal) return
    const { i, text } = promptEdit
    const gen = GENERATORS[imgEditModal.key]
    const book = selected?.[gen.field]
    if (!book?.chapters?.[i]) return
    const clean = String(text || '').trim()
    if (!clean) { setErr('Der Bild-Prompt darf nicht leer sein.'); return }
    setPromptSaving(true); setErr('')
    try {
      const newChapters = book.chapters.map((c, idx) => idx === i ? { ...c, image_prompt: clean } : c)
      await adminSaveMemorialText(token, selected.id, gen.field, { ...book, chapters: newChapters })
      const updatedBook = { ...book, chapters: newChapters }
      setSelected(s => ({ ...s, [gen.field]: updatedBook }))
      setMemorials(ms => ms.map(x => x.id === selected.id ? { ...x, [gen.field]: updatedBook } : x))
      setPromptEdit(null)
      setPromptSaving(false)
      if (regenerate) {
        setImgEditMsg('')
        setImgEditSel(new Set([i]))
        // Buch + Index explizit übergeben: setSelected greift erst im nächsten Render.
        await regenerateSelectedImages({ book: updatedBook, indices: [i] })
      } else {
        setImgEditMsg('✓ Prompt gespeichert. Er wird beim nächsten Neu-Generieren dieses Bildes verwendet.')
      }
    } catch (e) { setErr(e.message); setPromptSaving(false) }
  }
  // opts.book/opts.indices: explizit übergeben, wenn der Aufrufer den frischen
  // Stand schon kennt (React-State ist im selben Tick noch der alte).
  async function regenerateSelectedImages(opts = {}) {
    const m = imgEditModal
    if (!m) return
    const gen = GENERATORS[m.key]
    const book = opts.book || selected?.[gen.field]
    const indices = [...(opts.indices || imgEditSel)].sort((a, b) => a - b)
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
        <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>
          {genLangModal.key === 'eulogy'
            ? `In welcher Sprache soll ${GENERATORS.eulogy.noun ? 'das ' + GENERATORS.eulogy.noun : 'der Text'} erstellt werden?`
            : 'In welcher Sprache soll das Buch erstellt werden?'}
        </h2>
        <p style={{ ...S.muted, marginBottom:16 }}>
          {genLangModal.key === 'eulogy' && selected?.product_category === 'lifework'
            ? 'Das Pflegeexzerpt wird in der hier gewählten Sprache geschrieben – unabhängig von der Sprache des Buches.'
            : 'Für dieses Buch sind mehrere Sprachen freigeschaltet.'}
        </p>
        <div style={{ display:'grid', gap:10, marginBottom:14 }}>
          {genLangs(genLangModal.key).map(code => {
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

  // Lightbox: ein Poster-Stil groß. Das Vorschaubild ist dasselbe, das schon als
  // Thumbnail gerendert wurde — hier nur formatfüllend dargestellt.
  const posterZoomOverlay = posterZoom ? (
    <div
      onClick={() => setPosterZoom(null)}
      style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.82)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:120, padding:'1.5rem', cursor:'zoom-out' }}
    >
      <img src={posterZoom.url} alt={posterZoom.label} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', boxShadow:'0 20px 60px rgba(0,0,0,.5)', borderRadius:4 }} />
    </div>
  ) : null

  // Stilwahl vor der Erzeugung: 1–5 Stile ankreuzen. Jeder Stil braucht einen
  // eigenen Satz Szenenbilder — die Auswahl bestimmt also unmittelbar Dauer und
  // Kosten. Deshalb steht der geschätzte Aufwand direkt am Knopf.
  const posterStyleOverlay = posterStyleModal ? (() => {
    const chosen = POSTER_STYLES.filter(s => posterStyleSel.has(s.key))
    const imgs = chosen.length            // ein gemaltes Blatt je Stil
    const eur = (imgs * 0.047 * 0.92).toFixed(2).replace('.', ',')
    const mins = Math.max(1, Math.round(imgs * 1.5))
    const toggle = key => setPosterStyleSel(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
        <div style={{ ...S.card, maxWidth: 620, width:'100%' }}>
          <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>In welchen Stilen soll das Lebensposter entstehen?</h2>
          <p style={{ ...S.muted, marginBottom:16 }}>
            Die Lebensstationen werden nur einmal gesammelt und gelten für alle Blätter — jeder Stil bekommt aber
            sein eigenes, vollständig gemaltes Blatt. Mehrere Stile lassen sich hinterher nebeneinander vergleichen.
          </p>
          <div style={{ display:'grid', gap:10, marginBottom:14 }}>
            {POSTER_STYLES.map(s => {
              const on = posterStyleSel.has(s.key)
              return (
                <label
                  key={s.key}
                  style={{ ...S.card, cursor:'pointer', padding:'12px 14px', display:'flex', alignItems:'center', gap:12,
                           borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1 }}
                >
                  <input
                    type="checkbox" checked={on} onChange={() => toggle(s.key)}
                    style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }}
                  />
                  <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                    {[...Array(4)].map((_, i) => {
                      const c = s.accents[i % s.accents.length]
                      return <span key={i} style={{ width:12, height:26, borderRadius:3, background:`rgb(${c[0]},${c[1]},${c[2]})`, display:'inline-block' }} />
                    })}
                    <span style={{ width:12, height:26, borderRadius:3, background:`rgb(${s.paper[0]},${s.paper[1]},${s.paper[2]})`, border:'1px solid #e7e5e4', display:'inline-block' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight:600, fontSize:14, marginBottom:2 }}>{s.label}</div>
                    <div style={{ fontSize:12.5, color:'#78716c', lineHeight:1.5 }}>{s.description}</div>
                  </div>
                </label>
              )
            })}
          </div>
          <p style={{ fontSize:12.5, color:'#78716c', marginBottom:12 }}>
            {chosen.length === 0
              ? 'Bitte mindestens einen Stil wählen.'
              : `${chosen.length} ${chosen.length === 1 ? 'Stil' : 'Stile'} · rund ${imgs} Bilder, ca. ${eur} € und etwa ${mins} Minuten.`}
          </p>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, borderTop:'1px solid #e7e5e4', paddingTop:12 }}>
            <button className="ghost" onClick={() => setPosterStyleModal(false)} style={{ fontSize:14 }}>Abbrechen</button>
            <button
              disabled={chosen.length === 0}
              onClick={() => { setPosterStyleModal(false); generateExtra('poster', chosen.map(s => s.key)) }}
              style={{ fontSize:14 }}
            >
              ✨ Erzeugen
            </button>
          </div>
        </div>
      </div>
    )
  })() : null


  // Sprachwahl BEIM SPEICHERN des Pflegeexzerpts. Der Text liegt auf Deutsch am
  // Buch; wird eine andere Sprache gewählt, übersetzt die KI die Datei — das
  // deutsche Original bleibt unverändert erhalten.
  const dlLangOverlay = dlLangModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 420, width:'100%' }}>
        <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>In welcher Sprache soll das {GENERATORS.eulogy.noun} gespeichert werden?</h2>
        <p style={{ ...S.muted, marginBottom:16 }}>
          Erstellt wurde es auf Deutsch. Wählen Sie eine andere Sprache, wird die Datei vor dem Download übersetzt;
          die deutsche Fassung im Dashboard bleibt erhalten.
        </p>
        <div style={{ display:'grid', gap:10, marginBottom:14 }}>
          {LANGUAGES.map(l => (
            <button key={l.code} onClick={() => pickDlLang(l.code)} style={{ fontSize:15, padding:'12px 16px' }}>
              {l.label}{l.code === 'de' ? ' (Original)' : ' – übersetzen'}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12 }}>
          <button className="ghost" onClick={() => setDlLangModal(null)} style={{ fontSize:14 }}>Abbrechen</button>
        </div>
      </div>
    </div>
  ) : null

  // Prompt-Fenster: liegt ÜBER dem Bilder-Modal (höherer z-index), damit die
  // Auswahl dahinter erhalten bleibt.
  // Cover-Auswahl: vier Lagen des Titelstreifens als Vorschau. Der Admin wählt,
  // erst dann entsteht das PDF — die automatische Wahl passt nicht zu jedem Motiv.
  const coverOverlay = coverModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:120, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 960, width:'100%', maxHeight:'92vh', display:'flex', flexDirection:'column' }}>
        <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 4px' }}>Druck-Cover · Titelstreifen platzieren</h2>
        <p style={{ ...S.muted, margin:'0 0 14px' }}>
          Rückenstärke {coverModal.prep.B} mm · Format {coverModal.prep.W} × {coverModal.prep.H} mm.
          Wähle die Lage des Titelstreifens — die Vorschau zeigt exakt das spätere PDF.
        </p>
        <div style={{ overflowY:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:16, padding:'2px' }}>
          {BOX_POSITIONS.map(pos => (
            <div key={pos.key} style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <CoverPreview prep={coverModal.prep} posKey={pos.key} width={420} />
              <button onClick={() => saveCover(pos.key)} style={{ fontSize:14, padding:'9px 14px' }}>
                ⬇ {pos.label}{pos.hint ? ` (${pos.hint})` : ''}
              </button>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-start', borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:12 }}>
          <button className="ghost" onClick={() => setCoverModal(null)} style={{ fontSize:14 }}>Abbrechen</button>
        </div>
      </div>
    </div>
  ) : null

  const promptEditOverlay = (promptEdit && imgEditModal) ? (() => {
    const gen = GENERATORS[imgEditModal.key]
    const ch = selected?.[gen.field]?.chapters?.[promptEdit.i]
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:110, padding:'1rem', overflowY:'auto' }}>
        <div style={{ ...S.card, maxWidth: 640, width:'100%' }}>
          <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 4px' }}>Bild-Prompt bearbeiten</h2>
          <p style={{ ...S.muted, margin:'0 0 12px' }}>
            Kapitel {ch?.number} · {ch?.heading || '—'}
          </p>
          <textarea
            value={promptEdit.text}
            onChange={e => setPromptEdit(p => ({ ...p, text: e.target.value }))}
            disabled={promptSaving}
            rows={6}
            autoFocus
            style={{ width:'100%', fontSize:14, lineHeight:1.5, padding:'10px 12px', borderRadius:8, border:'1px solid #d6d3d1', fontFamily:'inherit', resize:'vertical' }}
          />
          <p style={{ fontSize:12, color:'#78716c', margin:'8px 0 0' }}>
            Beschreibe nur das <strong>Motiv</strong> (Szene, Personen, Epoche) — am besten auf Englisch, das versteht die Bild-KI am zuverlässigsten.
            Grafikstil und das Doppelseiten-Format kommen automatisch dazu; Angaben wie „oil painting" oder „photo" werden deshalb ignoriert
            und würden den einheitlichen Stil des Buchs nur stören.
          </p>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:14 }}>
            <button className="ghost" onClick={() => setPromptEdit(null)} disabled={promptSaving} style={{ fontSize:14 }}>Abbrechen</button>
            <div style={{ display:'flex', gap:8 }}>
              <button className="secondary" onClick={() => savePromptEdit()} disabled={promptSaving} style={{ fontSize:14, padding:'10px 16px' }}>
                {promptSaving ? 'Speichert …' : 'Speichern'}
              </button>
              <button onClick={() => savePromptEdit({ regenerate: true })} disabled={promptSaving} style={{ fontSize:14, padding:'10px 16px' }}>
                ✨ Speichern &amp; Bild neu generieren
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  })() : null

  const imgEditOverlay = imgEditModal ? (() => {
    const gen = GENERATORS[imgEditModal.key]
    const book = selected?.[gen.field]
    const chapters = Array.isArray(book?.chapters) ? book.chapters : []
    const selCount = imgEditSel.size
    const allSel = chapters.length > 0 && selCount === chapters.length
    return (
      <>
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
                    <button
                      className="ghost"
                      disabled={imgEditBusy}
                      onClick={(e) => { e.stopPropagation(); openPromptEdit(i) }}
                      title="Bild-Prompt bearbeiten"
                      style={{ fontSize:11, padding:'4px 8px', marginTop:7, width:'100%' }}
                    >✏️ Prompt</button>
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
            <button onClick={() => regenerateSelectedImages()} disabled={imgEditBusy || selCount === 0} style={{ fontSize:14, padding:'10px 18px' }}>
              {imgEditBusy ? 'Wird generiert …' : `✨ Auswahl neu generieren${selCount ? ` (${selCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>
      {promptEditOverlay}
      </>
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
            Automatische Prüfung auf Faktentreue (Erfundenes/Wiederholungen) und Datenschutz vom {new Date(reportModal.report.checked_at).toLocaleString('de-DE')}.
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
                // Faktentreue-Befunde (Erfundenes/Wiederholung) sind die gravierendsten:
                // Sie stellen den Inhalt des Buches selbst infrage, nicht seine Form.
                const isFact = ['Nicht belegt/erfunden', 'Wiederholung'].includes(String(f.category || ''))
                return (
                <div key={i} style={{ border:'1px solid', borderColor: resolved ? '#bbf7d0' : (isFact ? '#fecaca' : '#e7e5e4'), background: resolved ? '#f0fdf4' : (isFact ? '#fef2f2' : '#fff'), borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:600, fontSize:13 }}>{isFact ? '⚠ ' : ''}{f.category || 'Befund'}</span>
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


  // ── ENDNUTZER (Lebenswerk) ──
  // Kein Dashboard: Wer als Endnutzer eingeloggt ist, landet direkt in seinem
  // eigenen Interview — Sprachwahl (falls der Admin keine Sprache gesetzt hat),
  // dann Angaben zur Person, dann das Gespräch.
  if (token && auth.enduser && auth.code) {
    return <ContributorFlow code={auth.code} endUserToken={token} onLogout={logout} />
  }

  // ── LOGIN ──
  if (view === 'login') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
      {!showReset ? (
      <form onSubmit={login} style={{ width: '100%', maxWidth: 360, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Lebenswerk Admin</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Bitte melden Sie sich an.</p>
        <Err msg={err} />
        <div style={{ marginBottom: 12 }}>
          <Lbl>E-Mail-Adresse</Lbl>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="name@beispiel.de" autoFocus />
        </div>
        <div style={{ marginBottom: 20 }}>
          <Lbl>Passwort</Lbl>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••" />
        </div>
        <button type="submit" disabled={loading || !username || !password} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {loading ? 'Wird überprüft …' : 'Anmelden'}
        </button>
        <button type="button" onClick={() => { setShowReset(true); setResetEmail(username); setResetMsg(''); setErr('') }}
          style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: '#78716c', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
          Passwort vergessen?
        </button>
      </form>
      ) : (
      <form onSubmit={submitReset} style={{ width: '100%', maxWidth: 360, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Passwort zurücksetzen</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Geben Sie Ihre E-Mail-Adresse ein. Wir senden Ihnen einen Link zum Festlegen eines neuen Passworts.</p>
        {resetMsg
          ? <p style={{ fontSize: 14, color: '#3f6212', background: '#f7fee7', border: '1px solid #d9f99d', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>{resetMsg}</p>
          : (<>
              <div style={{ marginBottom: 20 }}>
                <Lbl>E-Mail-Adresse</Lbl>
                <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="name@beispiel.de" autoFocus />
              </div>
              <button type="submit" disabled={resetBusy || !resetEmail.trim()} style={{ width: '100%', padding: 12, fontSize: 15 }}>
                {resetBusy ? 'Wird gesendet …' : 'Reset-Link senden'}
              </button>
            </>)}
        <button type="button" onClick={() => { setShowReset(false); setResetMsg(''); setErr('') }}
          style={{ display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: '#78716c', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
          ← Zurück zum Login
        </button>
      </form>
      )}
    </div>
  )

  // ── LISTE ──
  if (view === 'list') return (
    <ListView showCategoryColumn={showCategoryColumn} auth={auth} memorials={memorials} filters={filters} sort={sort} myName={myName} myUid={myUid} loading={loading} filterCol={filterCol} hoveredRow={hoveredRow} err={err} deletingId={deletingId} setSort={setSort} setFilters={setFilters} setFilterCol={setFilterCol} setHoveredRow={setHoveredRow} loadUsers={loadUsers} setErr={setErr} setView={setView} loadAudit={loadAudit} loadCatalogs={loadCatalogs} setCatalogForm={setCatalogForm} loadRecipients={loadRecipients} setReportMsg={setReportMsg} loadFeedback={loadFeedback} openSettings={openSettings} openBookDefaults={openBookDefaults} logout={logout} startCreate={startCreate} openMemorial={openMemorial} openCosts={openCosts} handleDelete={handleDelete} />
  )

  // ── BUCH-STANDARDWERTE (nur Admin) ──
  if (view === 'book-defaults') return (
    <BookDefaultsView err={err} busy={busy} bdForm={bdForm} bdSaved={bdSaved} bdMsg={bdMsg} setBdForm={setBdForm} setView={setView} logout={logout} saveBookDefaults={saveBookDefaults} resetBookDefaults={resetBookDefaults} />
  )

  // ── PRODUKTKATEGORIE WÄHLEN (vor der Anlage) ──
  if (view === 'create-category') return (
    <CreateCategoryView err={err} allowedSlugs={allowedSlugs} logout={logout} setView={setView} chooseCategory={chooseCategory} />
  )

  // ── NEUES BUCH (kategorie-spezifisches Formular) ──
  if (view === 'create') return (
    <CreateView createForm={createForm} busy={busy} err={err} allowedSlugs={allowedSlugs} catalogs={catalogs} logout={logout} setView={setView} setCreateForm={setCreateForm} handleCreate={handleCreate} />
  )

  // ── EINSTELLUNGEN (eigenes Firmenlogo) ──
  if (view === 'settings') return (
    <SettingsView err={err} logoLoading={logoLoading} logo={logo} busy={busy} logoSaved={logoSaved} pwErr={pwErr} pwForm={pwForm} pwSaved={pwSaved} logout={logout} setView={setView} onLogoFile={onLogoFile} saveLogo={saveLogo} saveOwnPassword={saveOwnPassword} setPwForm={setPwForm} />
  )

  // ── BENUTZER (nur Admin) ──
  if (view === 'quality') return (
    <QMView qmData={qmData} loading={loading} err={err} setView={setView} logout={logout} toggleFeedbackDone={toggleFeedbackDone} deleteFeedback={deleteFeedback} />
  )

  if (view === 'audit') return (
    <AuditView auditData={auditData} auditLoading={auditLoading} err={err} logout={logout} loadAudit={loadAudit} setView={setView} />
  )

  // ── TAGESREPORT-EMPFÄNGER (nur Admin) ──
  if (view === 'reports') return (
    <ReportsView err={err} reportMsg={reportMsg} recipients={recipients} recipientForm={recipientForm} busy={busy} logout={logout} setView={setView} toggleRecipient={toggleRecipient} removeRecipient={removeRecipient} submitRecipient={submitRecipient} sendReportNow={sendReportNow} setRecipientForm={setRecipientForm} />
  )

  if (view === 'users') return (
    <UsersView err={err} usersData={usersData} createdInvite={createdInvite} userForm={userForm} busy={busy} logout={logout} setView={setView} resetUserPassword={resetUserPassword} copyInviteLink={copyInviteLink} regenerateInvite={regenerateInvite} removeUser={removeUser} saveUserCats={saveUserCats} setCreatedInvite={setCreatedInvite} setUserForm={setUserForm} toggleUserFormCat={toggleUserFormCat} submitUser={submitUser} />
  )

  // ── FRAGENKATALOGE (nur Admin) ──
  if (view === 'catalogs') return (
    <CatalogsView err={err} catalogForm={catalogForm} catalogs={catalogs} busy={busy} logout={logout} setView={setView} setCatalogForm={setCatalogForm} saveCatalog={saveCatalog} setErr={setErr} newCatalog={newCatalog} editCatalog={editCatalog} removeCatalog={removeCatalog} />
  )

  // ── GERADE ERSTELLT ──
  if (view === 'created') return (
    <CreatedView createdCode={createdCode} copied={copied} token={token} logout={logout} copyInvite={copyInvite} copyQR={copyQR} loadMemorials={loadMemorials} />
  )

  // ── DETAIL ──
  if (view === 'detail') return (
    <DetailView selected={selected} orderDraft={orderDraft} setOrderDraft={setOrderDraft} setView={setView} reloadContributions={reloadContributions} loading={loading} contributions={contributions} dlAll={dlAll} logout={logout} err={err} copyInvite={copyInvite} copied={copied} copyQR={copyQR} setTranscriptReport={setTranscriptReport} setSelectedContrib={setSelectedContrib} dlOne={dlOne} deleteContribution={deleteContribution} token={token} setSelected={setSelected} GENERATORS={GENERATORS} generating={generating} genOwner={genOwner} setEulogyStyleModal={setEulogyStyleModal} requestGenerate={requestGenerate} setEditMode={setEditMode} setEditDraft={setEditDraft} downloadGenerated={downloadGenerated} requestDownload={requestDownload} dlLangOverlay={dlLangOverlay} downloadGeneratedPdf={downloadGeneratedPdf} downloadCover={downloadCover} dlBusy={dlBusy} openImgEdit={openImgEdit} recheck={recheck} reviewingKey={reviewingKey} genPct={genPct} genProgress={genProgress} cancelGenerate={cancelGenerate} cancelGenRef={cancelGenRef} genErr={genErr} reviewPct={reviewPct} skipImages={skipImages} setSkipImages={setSkipImages} setReportModal={setReportModal} orderEdit={orderEdit} startOrderEdit={startOrderEdit} saveOrderData={saveOrderData} orderSaving={orderSaving} cancelOrderEdit={cancelOrderEdit} handleDelete={handleDelete} deletingId={deletingId} eulogyStyleOverlay={eulogyStyleOverlay} genLangOverlay={genLangOverlay} imgEditOverlay={imgEditOverlay} coverOverlay={coverOverlay} imgZoomOverlay={imgZoomOverlay} reportOverlay={reportOverlay} transcriptReportOverlay={transcriptReportOverlay} ManagerPhotos={ManagerPhotos} bookHasImages={bookHasImages} generateExtra={generateExtra} downloadExtra={downloadExtra} extraDl={extraDl} setPosterZoom={setPosterZoom} posterZoomOverlay={posterZoomOverlay} requestPoster={requestPoster} posterStyleOverlay={posterStyleOverlay} />
  )

  // ── KOSTEN-AUFSCHLÜSSELUNG ──
  if (view === 'costs' && selected) return (
    <CostsView selected={selected} costData={costData} costsLoading={costsLoading} err={err} setView={setView} logout={logout} />
  )

  // ── EINZELNER BEITRAG ──
  if (view === 'contribution' && selectedContrib) return (
    <ContributionView selectedContrib={selectedContrib} selected={selected} setView={setView} dlOne={dlOne} exportContribution={exportContribution} deleteContribution={deleteContribution} logout={logout} deleteMessages={deleteMessages} saveContribMeta={saveContribMeta} saveAnswerText={saveAnswerText} />
  )

  // ── ANSEHEN (Bücher + Endtext/Rede) ──
  if (view === 'book-v1' || view === 'book-v2' || view === 'eulogy') return (
    <BookView view={view} selected={selected} generating={generating} genOwner={genOwner} contributions={contributions} editMode={editMode} editDraft={editDraft} savingEdit={savingEdit} err={err} genErr={genErr} genPct={genPct} genProgress={genProgress} GENERATORS={GENERATORS} cancelGenRef={cancelGenRef} setEditMode={setEditMode} setEditDraft={setEditDraft} setView={setView} cancelGenerate={cancelGenerate} saveEdit={saveEdit} setReportModal={setReportModal} downloadGenerated={downloadGenerated} requestDownload={requestDownload} dlLangOverlay={dlLangOverlay} downloadGeneratedPdf={downloadGeneratedPdf} downloadCover={downloadCover} dlBusy={dlBusy} setEulogyStyleModal={setEulogyStyleModal} requestGenerate={requestGenerate} eulogyStyleOverlay={eulogyStyleOverlay} genLangOverlay={genLangOverlay} imgEditOverlay={imgEditOverlay} coverOverlay={coverOverlay} imgZoomOverlay={imgZoomOverlay} reportOverlay={reportOverlay} transcriptReportOverlay={transcriptReportOverlay} highlightParagraph={highlightParagraph} renderRichText={renderRichText} />
  )

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
// Lokalisierung des Einlöse-Bildschirms (Selbst-Registrierung). Der Endnutzer wählt
// beim Lebenswerk seine Sprache VOR der Passwortvergabe — dann sind Passwort-Screen
// UND Bestätigungsmail in seiner Sprache. Manager sehen Deutsch (Default).
const INV_L10N = {
  de: { pickLang:'Bitte wählen Sie Ihre Sprache', welcome:n=>`Willkommen${n?`, ${n}`:''}`, pwIntro:'Bitte vergeben Sie ein Passwort für Ihr Konto.', pwNew:'Neues Passwort', pwRepeat:'Passwort wiederholen', submit:'Passwort festlegen & anmelden', saving:'Wird gespeichert …', checking:'Einladung wird geprüft …', invalidTitle:'Einladung ungültig', invalidBody:'Bitte fordern Sie bei Ihrem Administrator einen neuen Einladungslink an.', mismatch:'Die beiden Passwörter stimmen nicht überein.' },
  en: { pickLang:'Please choose your language', welcome:n=>`Welcome${n?`, ${n}`:''}`, pwIntro:'Please set a password for your account.', pwNew:'New password', pwRepeat:'Repeat password', submit:'Set password & sign in', saving:'Saving …', checking:'Checking invitation …', invalidTitle:'Invitation invalid', invalidBody:'Please ask your administrator for a new invitation link.', mismatch:'The two passwords do not match.' },
  pl: { pickLang:'Wybierz swój język', welcome:n=>`Witamy${n?`, ${n}`:''}`, pwIntro:'Ustaw hasło dla swojego konta.', pwNew:'Nowe hasło', pwRepeat:'Powtórz hasło', submit:'Ustaw hasło i zaloguj', saving:'Zapisywanie …', checking:'Sprawdzanie zaproszenia …', invalidTitle:'Zaproszenie nieważne', invalidBody:'Poproś administratora o nowy link z zaproszeniem.', mismatch:'Oba hasła nie są zgodne.' },
  es: { pickLang:'Elija su idioma', welcome:n=>`Bienvenido${n?`, ${n}`:''}`, pwIntro:'Establezca una contraseña para su cuenta.', pwNew:'Nueva contraseña', pwRepeat:'Repetir contraseña', submit:'Establecer contraseña e iniciar sesión', saving:'Guardando …', checking:'Comprobando la invitación …', invalidTitle:'Invitación no válida', invalidBody:'Solicite a su administrador un nuevo enlace de invitación.', mismatch:'Las dos contraseñas no coinciden.' },
  it: { pickLang:'Scelga la sua lingua', welcome:n=>`Benvenuto${n?`, ${n}`:''}`, pwIntro:'Imposti una password per il suo account.', pwNew:'Nuova password', pwRepeat:'Ripeti password', submit:'Imposta password e accedi', saving:'Salvataggio …', checking:'Verifica dell’invito …', invalidTitle:'Invito non valido', invalidBody:'Chieda al suo amministratore un nuovo link di invito.', mismatch:'Le due password non coincidono.' },
  eu: { pickLang:'Aukeratu zure hizkuntza', welcome:n=>`Ongi etorri${n?`, ${n}`:''}`, pwIntro:'Ezarri pasahitz bat zure konturako.', pwNew:'Pasahitz berria', pwRepeat:'Errepikatu pasahitza', submit:'Ezarri pasahitza eta hasi saioa', saving:'Gordetzen …', checking:'Gonbidapena egiaztatzen …', invalidTitle:'Gonbidapena baliogabea', invalidBody:'Eskatu zure administratzaileari gonbidapen-esteka berri bat.', mismatch:'Bi pasahitzak ez datoz bat.' },
  he: { pickLang:'בחר את השפה שלך', welcome:n=>`ברוך הבא${n?`, ${n}`:''}`, pwIntro:'אנא הגדר סיסמה לחשבונך.', pwNew:'סיסמה חדשה', pwRepeat:'חזור על הסיסמה', submit:'הגדר סיסמה והתחבר', saving:'שומר …', checking:'בודק את ההזמנה …', invalidTitle:'ההזמנה אינה תקפה', invalidBody:'אנא בקש מהמנהל קישור הזמנה חדש.', mismatch:'שתי הסיסמאות אינן תואמות.' },
  ar: { pickLang:'اختر لغتك', welcome:n=>`مرحباً${n?`، ${n}`:''}`, pwIntro:'يرجى تعيين كلمة مرور لحسابك.', pwNew:'كلمة مرور جديدة', pwRepeat:'أعد كلمة المرور', submit:'تعيين كلمة المرور وتسجيل الدخول', saving:'جارٍ الحفظ …', checking:'جارٍ التحقق من الدعوة …', invalidTitle:'الدعوة غير صالحة', invalidBody:'يرجى طلب رابط دعوة جديد من المسؤول.', mismatch:'كلمتا المرور غير متطابقتين.' },
}

function InviteFlow({ token }) {
  const [status, setStatus]     = useState('loading') // loading|ready|invalid
  const [username, setUsername] = useState('')
  const [langs, setLangs]       = useState([])        // beim Endnutzer angebotene Sprachen
  const [chosenLang, setChosenLang] = useState(null)
  const [step, setStep]         = useState('pw')      // 'lang' | 'pw'
  const [pw, setPw]             = useState('')
  const [pw2, setPw2]           = useState('')
  const [err, setErr]           = useState('')
  const [busy, setBusy]         = useState(false)

  useEffect(() => {
    let alive = true
    getInvite(token)
      .then(d => {
        if (!alive) return
        setUsername(d.username || '')
        const ls = Array.isArray(d.langs) ? d.langs : []
        setLangs(ls)
        // Endnutzer mit echter Auswahl (mehrere Sprachen, noch nicht festgelegt) →
        // erst Sprache wählen. Sonst steht die Sprache fest → direkt Passwort.
        if (d.enduser && ls.length > 1 && !d.lang) { setStep('lang') }
        else { setChosenLang(d.lang || (ls.length === 1 ? ls[0] : null)); setStep('pw') }
        setStatus('ready')
      })
      .catch(e => { if (alive) { setErr(e.message); setStatus('invalid') } })
    return () => { alive = false }
  }, [token])

  const T = INV_L10N[chosenLang] || INV_L10N.de
  const dir = (chosenLang === 'he' || chosenLang === 'ar') ? 'rtl' : 'ltr'

  async function submit(e) {
    e.preventDefault()
    const pErr = passwordError(pw)
    if (pErr) { setErr(pErr); return }
    if (pw !== pw2) { setErr(T.mismatch); return }
    setErr(''); setBusy(true)
    try {
      const d = await redeemInvite(token, pw, chosenLang)
      sessionStorage.setItem('lw_admin_token', d.token)
      sessionStorage.setItem('lw_admin_auth', JSON.stringify({
        admin: Boolean(d.admin), cats: d.cats ?? [], uid: d.uid ?? null, username: d.username || username,
        // Endnutzer landen nach dem Einlösen direkt in ihrem Interview, nicht im Dashboard.
        enduser: Boolean(d.enduser), code: d.code || null,
      }))
      // Ohne ?invite neu laden – die Sitzung wird aus sessionStorage gelesen.
      window.location.href = '/'
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const card = { width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }
  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', padding: '1rem' }

  if (status === 'loading') return <div style={wrap}><div style={card}><p style={{ ...S.muted, margin: 0 }}>{INV_L10N.de.checking}</p></div></div>

  if (status === 'invalid') return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{INV_L10N.de.invalidTitle}</h1>
        <Err msg={err} />
        <p style={{ ...S.muted, marginTop: 12, marginBottom: 0 }}>{INV_L10N.de.invalidBody}</p>
      </div>
    </div>
  )

  // Sprachwahl VOR der Passwortvergabe (Endnutzer). Überschrift bewusst zweisprachig,
  // da die Sprache hier ja gerade erst gewählt wird.
  if (step === 'lang') return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Sprache wählen · Choose language</h1>
        <div style={{ display: 'grid', gap: 10, maxHeight: '60vh', overflowY: 'auto', padding: 2 }}>
          {langs.map(lc => {
            const meta = LANGUAGES.find(x => x.code === lc) || { code: lc, label: lc }
            return <button key={lc} onClick={() => { setChosenLang(lc); setStep('pw') }} style={{ padding: '14px', fontSize: 16 }}>{meta.label}</button>
          })}
        </div>
      </div>
    </div>
  )

  const okPw = !passwordError(pw)
  return (
    <div style={wrap} dir={dir}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{T.welcome(username)}</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>{T.pwIntro}</p>
        <Err msg={err} />
        <div style={{ marginBottom: 12 }}>
          <Lbl>{T.pwNew}</Lbl>
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Lbl>{T.pwRepeat}</Lbl>
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 16, color: !pw ? '#78716c' : (okPw ? '#15803d' : '#b91c1c') }}>
          {!pw ? '' : (okPw ? '✓ ' : '• ')}{PASSWORD_RULES_TEXT}
        </p>
        <button type="submit" disabled={busy || !okPw || pw !== pw2} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {busy ? T.saving : T.submit}
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
        : <AdminLangProvider><Dashboard /></AdminLangProvider>}
      <LegalFooter />
    </>
  )
}
