// src/api.js – zentraler API-Client für das Frontend

// Liest eine fetch-Response defensiv als JSON. Wenn Vercel/der Server
// kein JSON liefert (Timeout-/Crash-Page, 502/504 in Plain-Text/HTML),
// wirft die Funktion einen Fehler mit HTTP-Status + Antwort-Auszug,
// statt eines kryptischen "Unexpected token"-Parse-Fehlers.
async function parseResponse(res) {
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} }
  catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim()
    throw new Error(
      res.ok
        ? `Unerwartete Server-Antwort: ${snippet}`
        : `HTTP ${res.status}${snippet ? ` – ${snippet}` : ''}`
    )
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ── Gedenkbuch / Buch ─────────────────────────────────────────────
// Anlage läuft jetzt authentifiziert über den Admin-Endpoint, damit
// Produktkategorie + Eigentümer-Gruppe serverseitig vertrauenswürdig
// gesetzt werden können.
export async function createMemorial(token, { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, showTranscript, showContributors, photoUploadTab, productCategory, intake, languages, note, pickupAddress, catalogId, followups, imageStyle, bookLayout, textStyle, interviewTimerSeconds, companionMode, proofEnabled, proofMax, enduserEmail, showOnboarding, ttsVoice, gamification, handsFree, micManualStop, micModeSwitch, realtimeEnabled }) {
  const res = await fetch('/api/admin/memorials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, showTranscript, showContributors, photoUploadTab, productCategory, intake, languages, note, pickupAddress, catalogId, followups, imageStyle, bookLayout, textStyle, interviewTimerSeconds, companionMode, proofEnabled, proofMax, enduserEmail, showOnboarding, ttsVoice, gamification, handsFree, micManualStop, micModeSwitch, realtimeEnabled }),
  })
  // Lebenswerk zusätzlich: { enduser_id, invite_token, email_sent }
  return parseResponse(res) // { code }
}

// ── Endnutzer (Lebenswerk) ────────────────────────────────────────
// Der Endnutzer darf an SEINEM Buch nur Grafik- und Textstil ändern. Ist er
// eingeloggt, autorisiert der `eu`-Claim seines Tokens; ohne Login (E-Mail ist
// beim Lebenswerk optional) genügt der Buch-Code — dann OHNE Authorization-Header,
// der Server lässt das nur beim Lebenswerk zu.
export async function updateOwnMemorial(token, code, { imageStyle, bookLayout, textStyle } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers,
    // Nur gesetzte Felder senden (nicht jeder Aufruf ändert alle drei).
    body: JSON.stringify({
      ...(imageStyle !== undefined ? { imageStyle } : {}),
      ...(bookLayout !== undefined ? { bookLayout } : {}),
      ...(textStyle !== undefined ? { textStyle } : {}),
    }),
  })
  return parseResponse(res) // { ok }
}

// Namen nachtragen: Beim Lebenswerk ist der Name bei der Anlage optional. Fehlt er,
// gibt ihn der Endnutzer beim Start selbst ein — er gehört ans BUCH (Titel, Poster,
// Stammbaum), nicht nur an den Beitrag. Der Server nimmt ihn nur an, solange das
// Feld leer ist.
// Endnutzer trägt beim Start seine Stammdaten nach (Lebenswerk): Name, Geschlecht
// und Anredeform (Du/Sie). Der Server übernimmt jedes Feld nur, solange es am Buch
// leer ist. Nur die tatsächlich gefüllten Felder werden gesendet.
export async function claimEnduserStart(code, { name, gender, address } = {}) {
  const body = {}
  if (name)    body.name = name
  if (gender)  body.gender = gender
  if (address) body.address = address
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseResponse(res) // { ok, name?, gender?, intake? }
}

// Optionale Server-Ablage des im Browser erzeugten Druck-PDFs (Checkbox in der
// Detailansicht). Legt eine Kopie im Blob-Storage ab und gibt einen signierten
// Download-Link zurück; beim Löschen des Buchs verschwindet die Kopie automatisch.
export async function storeMemorialPdf(token, code, { variant, filename, dataBase64 }) {
  const res = await fetch(`/api/admin/store-pdf?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ variant, filename, dataBase64 }),
  })
  return parseResponse(res) // { ok, variant, url, stored_pdfs }
}

// Sprachwahl des Endnutzers festschreiben: Beim Lebenswerk wird das Buch fest auf
// die gewählte Sprache gepinnt, damit die Sprachauswahl nicht bei jedem Start
// erneut erscheint. Nur beim Lebenswerk erlaubt; Code genügt (kein Login nötig).
export async function pinMemorialLang(code, language) {
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  })
  return parseResponse(res) // { ok, languages }
}

// Anamnesebogen des Patienten speichern/bestätigen (Kategorie „anamnesis", Step 2).
// Gespeichert wird der KANONISCH deutsche Bogen (eulogy_text); `confirmed:true` setzt
// den Bestätigungs-Zeitstempel (Patient hat mit „ok" bestätigt). Autorisierung wie
// beim Einstellungs-Tab: eingeloggter Endnutzer (Token) ODER der Buch-Code allein.
export async function saveAnamneseBogen(code, token, { text, confirmed = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ anamneseBogen: { text, confirmed } }),
  })
  return parseResponse(res) // { ok, confirmed, bogen_confirmed_at }
}

// ── Buch-Standardwerte ────────────────────────────────────────────
// Vorbelegung der Anlage-Maske. Lesen: jeder eingeloggte Benutzer (die Maske
// braucht die Werte). Ändern/Zurücksetzen: nur Admin.
export async function adminGetBookDefaults(token) {
  const res = await fetch('/api/admin/settings?key=book_defaults', { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { defaults, saved }
}
export async function adminSaveBookDefaults(token, defaults) {
  const res = await fetch('/api/admin/settings?key=book_defaults', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ defaults }),
  })
  return parseResponse(res) // { defaults, saved }
}
export async function adminResetBookDefaults(token) {
  const res = await fetch('/api/admin/settings?key=book_defaults', {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { defaults, saved:false }
}

// ── Fragenkataloge ────────────────────────────────────────────────
// CRUD ist in api/admin/memorials.js (?catalogs) eingebettet wegen des
// Vercel-12-Funktionen-Limits. Lesen: jeder eingeloggte Benutzer (gefiltert
// auf seine Kategorien) für die Auswahl beim Buch-Anlegen. Schreiben: nur Admin.
export async function adminListCatalogs(token) {
  const res = await fetch('/api/admin/memorials?catalogs=1', { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { catalogs }
}
export async function adminCreateCatalog(token, { name, product_categories, chapters }) {
  const res = await fetch('/api/admin/memorials?catalogs=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, product_categories, chapters }),
  })
  return parseResponse(res) // { catalog }
}
export async function adminUpdateCatalog(token, id, { name, product_categories, chapters }) {
  const res = await fetch(`/api/admin/memorials?catalogs=1&id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, product_categories, chapters }),
  })
  return parseResponse(res) // { ok }
}
export async function adminDeleteCatalog(token, id) {
  const res = await fetch(`/api/admin/memorials?catalogs=1&id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { ok }
}

// ── Benutzer (Admin) ──────────────────────────────────────────────
export async function adminListUsers(token) {
  const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { users }
}
// Legt einen Benutzer OHNE Passwort an; die Antwort enthält invite_token, aus
// dem das Frontend den Einladungslink (?invite=…) baut.
export async function adminCreateUser(token, { username, allowed_categories, is_admin, demo, lang }) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username, allowed_categories, is_admin, demo, lang }),
  })
  return parseResponse(res) // { id, username, …, invite_token, invite_expires, demo? }
}

// ── Einladung einlösen (Self-Onboarding, ohne Login) ──────────────
// Beides läuft über den öffentlichen Login-Endpunkt (siehe api/admin/login.js).
export async function getInvite(inviteToken) {
  const res = await fetch(`/api/admin/login?invite=${encodeURIComponent(inviteToken)}`)
  return parseResponse(res) // { username, enduser, langs, lang }
}
// lang (optional): beim Endnutzer die VOR der Passwortvergabe gewählte Sprache —
// der Server schreibt sie fest und pinnt das Buch darauf.
export async function redeemInvite(inviteToken, password, lang = null) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite: inviteToken, password, ...(lang ? { lang } : {}) }),
  })
  return parseResponse(res) // { token, admin, cats, uid, username, enduser, code, lang }
}
// Passwort-Reset anfordern: schickt (falls die Adresse existiert) einen Reset-Link
// per E-Mail. Antwort ist bewusst immer generisch { ok:true }.
export async function requestPasswordReset(email) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reset: email }),
  })
  return parseResponse(res) // { ok:true }
}
// ── Endnutzer-Buchvorschau („Probedruck", nur Lebenswerk) ─────────
// Alle Operationen laufen über /api/enduser-book. Autorisierung: eingeloggter
// Endnutzer (Token) ODER der Buch-Code allein (beim Lebenswerk erlaubt).
async function enduserBook(code, token, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/enduser-book?code=${encodeURIComponent(code)}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return parseResponse(res)
}
export const getEnduserBook   = (code, token)            => enduserBook(code, token, { action: 'get-book' })
export const acquireEditLock  = (code, token)            => enduserBook(code, token, { action: 'lock-acquire' })      // { token, expires }
export const heartbeatEditLock= (code, token, lockToken)=> enduserBook(code, token, { action: 'lock-heartbeat', token: lockToken })
export const releaseEditLock  = (code, token, lockToken)=> enduserBook(code, token, { action: 'lock-release', token: lockToken })
export const consumeProof     = (code, token)            => enduserBook(code, token, { action: 'proof-consume' })     // { used, max, remaining }
export const saveEnduserBook  = (code, token, lockToken, book) => enduserBook(code, token, { action: 'save-book', token: lockToken, book })
export const startPrintVersion= (code, token)            => enduserBook(code, token, { action: 'start-print' })       // { token, expires, interview_closed }
export const finalizeBook     = (code, token, lockToken) => enduserBook(code, token, { action: 'finalize', token: lockToken })

// Ein Kapitel-Bild für die vorläufige Druckversion erzeugen (FLUX, kostenpflichtig).
// Braucht den Bearbeitungs-Lock (lockToken). Gibt { storagePath, count, max } zurück.
export async function enduserGenerateImage(code, token, { chapterNumber, prompt, lockToken, imageStyle }) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/enduser-image?code=${encodeURIComponent(code)}`, {
    method: 'POST', headers,
    body: JSON.stringify({ chapterNumber, prompt, token: lockToken, imageStyle }),
  })
  return parseResponse(res)
}

// Self-Service-Registrierung als Endnutzer eines Lebenswerks (öffentlich, ohne
// Login). Legt Buch (Default-Werte + 5-Min-Testlimit) + Konto an und verschickt
// die Zugangs-Mail (BCC an den Betreiber). Antwort { ok, email_sent }.
export async function registerLifework({ name, email, lang, consent }) {
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, lang, consent }),
  })
  return parseResponse(res)
}
export async function adminUpdateUser(token, id, patch) {
  const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  })
  return parseResponse(res)
}
export async function adminDeleteUser(token, id) {
  const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res)
}

// ── Freischaltcodes ───────────────────────────────────────────────
// Endnutzer löst einen Code ein, um das Zeitlimit seines Buchs aufzuheben
// (öffentlich; Buch-Code genügt als Berechtigung).
export async function redeemUnlockCode(memorialCode, code) {
  const res = await fetch('/api/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memorial: memorialCode, code }),
  })
  return parseResponse(res) // { ok, already? }
}
// ── Anonymer Tageszähler ──────────────────────────────────────────
// Zählt technische Ereignisse (v. a. „Mikrofon blockiert") als reines Aggregat —
// ohne Buch-Code, ohne Kennung, ohne Zeitstempel. Jede Kennzahl wird pro
// Browser-Sitzung höchstens EINMAL gesendet, sonst zählte ein Nutzer, der
// zehnmal aufs Mikrofon tippt, wie zehn Betroffene.
// Fehler werden bewusst verschluckt: Eine Statistik darf nie ein Interview stören.
function metricPlatform() {
  try {
    const ua = navigator.userAgent || ''
    const pwa = window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.matchMedia?.('(display-mode: fullscreen)')?.matches
      || window.navigator.standalone === true
    if (/Android/.test(ua)) return pwa ? 'android_pwa' : 'android'
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return pwa ? 'ios_pwa' : 'ios'
    if (/Windows|Mac OS X|Linux|CrOS/.test(ua)) return 'desktop'
    return 'other'
  } catch { return 'other' }
}
// Entdopplung bewusst NUR im Arbeitsspeicher: Ein Eintrag in localStorage/
// sessionStorage wäre ein Zugriff auf das Endgerät (§ 25 TDDDG) und damit
// einwilligungspflichtig — für eine Statistik unangemessen. Die SPA lädt während
// eines Interviews ohnehin nicht neu, die Entdopplung greift also zuverlässig.
const metricsSent = new Set()
export function recordMetric(kind) {
  if (metricsSent.has(kind)) return
  metricsSent.add(kind)
  try {
    fetch('/api/metric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, platform: metricPlatform() }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* egal */ }
}

// ── Support-Anfrage (öffentlich) ──────────────────────────────────
// Nachricht/Fehlermeldung + Antwort-Adresse + Diagnose-Kontext an den Betreiber.
// Rückkanal: replyEmail ODER replyPhone genügt (mindestens eines ist Pflicht).
// preferredChannel: 'email' | 'phone' | null (Kontaktwunsch des Nutzers).
export async function sendSupport({ message, replyEmail, replyPhone, preferredChannel, name, context }) {
  const res = await fetch('/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, replyEmail, replyPhone, preferredChannel, name, context }),
  })
  return parseResponse(res) // { ok, email_sent }
}

// Support-Tickets verwalten (nur Admin).
export async function adminListSupport(token) {
  const res = await fetch('/api/support', { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { tickets }
}
export async function adminSetSupportHandled(token, id, handled) {
  const res = await fetch(`/api/support?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ handled }),
  })
  return parseResponse(res) // { ok, handled }
}
export async function adminDeleteSupport(token, id) {
  const res = await fetch(`/api/support?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { ok }
}
// KI-Antwortvorschlag (neu) generieren – für ältere Tickets ohne Vorschlag.
export async function adminGenerateSupportAssist(token, id) {
  const res = await fetch(`/api/support?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ generate: true }),
  })
  return parseResponse(res) // { ok, reply_draft, repair_prompt }
}
// Antwort-Entwurf speichern (ohne zu senden).
export async function adminSaveSupportDraft(token, id, reply_draft) {
  const res = await fetch(`/api/support?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reply_draft }),
  })
  return parseResponse(res) // { ok }
}
// Antwort per E-Mail an den Absender senden (BCC ins Support-Postfach).
export async function adminSendSupportReply(token, id, text) {
  const res = await fetch(`/api/support?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ send_reply: text }),
  })
  return parseResponse(res) // { ok, sent_to, reply_sent_at, handled }
}

// Verwaltung (nur Admin).
// `memorial` (optional) → nur die für DIESES Buch eingelösten Codes (Buch-Detailseite).
export async function adminListUnlockCodes(token, memorial) {
  const qs = memorial ? `?memorial=${encodeURIComponent(memorial)}` : ''
  const res = await fetch(`/api/admin/unlock-codes${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { codes }
}
export async function adminCreateUnlockCode(token, { recipient_name, recipient_email, note, gross_price_cents, send } = {}) {
  const res = await fetch('/api/admin/unlock-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient_name, recipient_email, note, gross_price_cents, send }),
  })
  return parseResponse(res) // created code (+ email_sent?)
}
export async function adminSendUnlockCode(token, code, recipient_email) {
  const res = await fetch(`/api/admin/unlock-codes?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'send', ...(recipient_email ? { recipient_email } : {}) }),
  })
  return parseResponse(res) // { ok, email_sent, email_sent_at }
}
export async function adminDeleteUnlockCode(token, code) {
  const res = await fetch(`/api/admin/unlock-codes?code=${encodeURIComponent(code)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { ok }
}
// Audit-Log lesen (admin-only). In users.js eingebettet (?audit=1) wegen
// des Vercel-12-Funktionen-Limits.
// Qualitätsmanagement: Beitragenden-Bewertungen (Feedback) aller zugänglichen Bücher.
export async function adminListFeedback(token) {
  const res = await fetch('/api/admin/feedback', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // [ { id, memorial_name, contributor_name, rating, text, at, done, ... } ]
}
// Bewertung als „erledigt" markieren/zurücksetzen.
export async function adminSetFeedbackDone(token, id, done) {
  const res = await fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ done }),
  })
  return parseResponse(res) // { ok, done }
}
// Bewertung entfernen (Contribution bleibt bestehen).
export async function adminDeleteFeedback(token, id) {
  const res = await fetch(`/api/admin/feedback?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { ok }
}

export async function adminListAudit(token, { limit = 100, action } = {}) {
  const qs = new URLSearchParams({ audit: '1', limit: String(limit) })
  if (action) qs.set('action', action)
  const res = await fetch(`/api/admin/users?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { entries }
}

// ── Tagesreport-Empfänger (Admin) ─────────────────────────────────
export async function adminListRecipients(token) {
  const res = await fetch('/api/admin/reports', { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { recipients }
}
export async function adminAddRecipient(token, { email, name }) {
  const res = await fetch('/api/admin/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, name }),
  })
  return parseResponse(res) // { recipient }
}
export async function adminUpdateRecipient(token, id, patch) {
  const res = await fetch(`/api/admin/reports?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  })
  return parseResponse(res) // { ok }
}
export async function adminDeleteRecipient(token, id) {
  const res = await fetch(`/api/admin/reports?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { ok }
}
// Report jetzt bauen & senden. Ohne `to` an die aktiven Empfänger, sonst an die
// angegebene Adresse (String) – praktisch zum Testen.
export async function adminSendReportNow(token, { to } = {}) {
  const res = await fetch('/api/admin/reports?send=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(to ? { to } : {}),
  })
  return parseResponse(res) // { ok, sent, recipients, errors, pdfBytes, ... }
}

// ── Eigene Einstellungen (Firmenlogo) ─────────────────────────────
// Liegt aus Funktions-Limit-Gründen mit der Benutzerverwaltung im selben
// Endpoint (?self=1 umgeht dort die Admin-Schranke).
export async function getSettings(token) {
  const res = await fetch('/api/admin/users?self=1', { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { logo }
}
export async function saveSettings(token, { logo }) {
  const res = await fetch('/api/admin/users?self=1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ logo }),
  })
  return parseResponse(res) // { ok }
}

// Eigenes Passwort ändern (nur Benutzerkonten, nicht der Env-Admin).
export async function changeOwnPassword(token, { currentPassword, newPassword }) {
  const res = await fetch('/api/admin/users?self=1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  return parseResponse(res) // { ok }
}
// Eigene Dashboard-Sprache (de/en) am Konto speichern — beim ersten Login gewählt.
export async function saveOwnLang(token, lang) {
  const res = await fetch('/api/admin/users?self=1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lang }),
  })
  return parseResponse(res) // { ok, lang }
}

export async function adminDeleteMemorial(token, code) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res)
}

export async function adminSaveMemorialText(token, code, field, text) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ field, text }),
  })
  return parseResponse(res)
}

// ── Serverseitige Generierung (Job-Queue, robust gegen Verbindungsabbruch) ──
// Job anlegen (Worker startet sofort). params = { field, resultType, combine, steps:[{system,user,label}] }.
export async function enqueueGeneration(token, memorialCode, kind, params) {
  const res = await fetch('/api/admin/generate-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ memorialCode, kind, params }),
  })
  return parseResponse(res) // { jobId }
}
// Job-Status pollen (per id) bzw. offene Jobs eines Buchs holen (per memorialCode).
export async function getGenerationJob(token, { id, memorialCode } = {}) {
  const qs = id ? `id=${encodeURIComponent(id)}` : `memorialCode=${encodeURIComponent(memorialCode)}`
  const res = await fetch(`/api/admin/generate-job?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  return parseResponse(res) // { job } | { jobs }
}
export async function cancelGenerationJob(token, id) {
  const res = await fetch(`/api/admin/generate-job?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res)
}

// Auftragsdaten (Stammdaten) eines Buchs bearbeiten. `meta` enthält nur die
// zu ändernden Felder (name, organizer, gender, bookVariant, funeralDate,
// cutoffDays, showIntroVideo, intake, languages, note, pickupAddress).
export async function adminUpdateMemorialMeta(token, code, meta) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ meta }),
  })
  return parseResponse(res) // { ok }
}

// Admin-Bearbeitungs-Lock (Gegenstück zum Endnutzer-Lock). action: 'acquire'|'heartbeat'|'release'.
// 'acquire' wirft bei aktivem Endnutzer-Lock (HTTP 409).
export async function adminLockAction(token, code, action, lockToken) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lock: { action, token: lockToken } }),
  })
  return parseResponse(res) // acquire → { token, expires }; sonst { ok }
}

export async function adminDeleteContribution(token, id) {
  const res = await fetch(`/api/admin/contributions?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res)
}

export async function adminUpdateContributionMessages(token, id, messages) {
  const res = await fetch(`/api/admin/contributions?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  })
  return parseResponse(res) // updated contribution row
}
// Stammdaten eines Beitrags ändern (Name des/der Beitragenden, Beziehung).
export async function adminUpdateContributionMeta(token, id, { contributorName, relationship }) {
  const res = await fetch(`/api/admin/contributions?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ contributorName, relationship }),
  })
  return parseResponse(res) // updated contribution row
}

// Kuratierung eines Gastbeitrags (Gastbeiträge zum Lebenswerk):
// 'approved' | 'rejected' | 'pending'. Der Server prüft den Wert und die
// Zugehörigkeit des Beitrags; ohne die Spalte antwortet er mit 503 statt still
// zu schlucken — eine verschluckte Freigabe wäre schlimmer als ein Fehler.
export async function adminSetGuestStatus(token, id, guestStatus) {
  const res = await fetch(`/api/admin/contributions?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ guestStatus }),
  })
  return parseResponse(res) // updated contribution row
}

// Transkript-Prüfung speichern: korrigierte messages + optional Prüf-Zeitstempel
// und Korrekturliste (für Bericht/Undo). Für Undo/Redo nur messages+corrections
// senden (transcriptCheckedAt weglassen, damit der „geprüft"-Stempel bleibt).
export async function adminSaveTranscriptCheck(token, id, { messages, transcriptCheckedAt, transcriptCorrections }) {
  const body = { messages }
  if (transcriptCheckedAt !== undefined) body.transcriptCheckedAt = transcriptCheckedAt
  if (transcriptCorrections !== undefined) body.transcriptCorrections = transcriptCorrections
  const res = await fetch(`/api/admin/contributions?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return parseResponse(res) // updated contribution row
}

export async function adminGenerateImage(token, memorialCode, prompt, meta = {}) {
  // meta (optional): { variant, chapterNumber, chapterHeading } – nur für die
  // Kosten-Zuordnung (welche Buch-Variante / welches Kapitel).
  const res = await fetch('/api/admin/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ memorialCode, prompt, ...meta }),
  })
  return parseResponse(res) // { storagePath }
}

// ── Hochgeladene Fotos ────────────────────────────────────────────
// Beitragender lädt am Ende des Interviews ein Foto hoch (öffentlich, Code +
// Einverständnis Pflicht). `image` = Data-URL/base64 (Client skaliert vorher).
export async function uploadContributorImage(code, { image, caption, description, consent, contributionId }) {
  const res = await fetch(`/api/upload?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, caption, description, consent, contributionId }),
  })
  return parseResponse(res) // { image }
}

// Beitragenden-Feedback nach dem Interview (Smiley 1..5 + optionaler Text).
export async function submitFeedback(code, contributionId, rating, text) {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memorialCode: code, contributionId, rating, text }),
  })
  return parseResponse(res) // { ok }
}

// Wiederaufnahme-Link dem Beitragenden per E-Mail schicken — AUS DER APP (statt
// die externe Mail-App zu öffnen). session = geheime Beitrags-ID (Capability).
export async function sendResumeLink(code, session, email, { subject, body } = {}) {
  const res = await fetch('/api/send-resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memorialCode: code, session, email, subject, body }),
  })
  return parseResponse(res) // { ok }
}

// Manager lädt ein eigenes Foto zum Buch hoch (auth).
export async function adminUploadImage(token, code, { image, caption, description }) {
  const res = await fetch(`/api/admin/upload-image?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image, caption, description }),
  })
  return parseResponse(res) // { image }
}

export async function adminDeleteUpload(token, code, imageId) {
  const res = await fetch(`/api/admin/upload-image?code=${encodeURIComponent(code)}&imageId=${encodeURIComponent(imageId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { removed }
}

// Bildunterschrift/-beschreibung eines Uploads bearbeiten.
export async function adminUpdateUpload(token, code, uploadEdit) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ uploadEdit }),
  })
  return parseResponse(res) // { ok }
}

// Setzt aus 1..4 Uploads EIN Landscape-Doppelseiten-Bild zusammen (auth).
export async function adminComposeImage(token, memorialCode, images, meta = {}) {
  const res = await fetch('/api/admin/compose-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ memorialCode, images, ...meta }),
  })
  return parseResponse(res) // { storagePath }
}

export async function getMemorial(code) {
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`)
  return parseResponse(res) // { id, name, birth_year, death_year, organizer, created_at }
}

// ── Beiträge ──────────────────────────────────────────────────────
// Holt GENAU EINEN Beitrag über seine geheime ID (Capability aus der
// Session-URL). Bewusst nicht die ganze Liste – die gibt es nur
// authentifiziert über /api/admin/contributions.
export async function getContribution(id, code) {
  const qs = new URLSearchParams({ id })
  if (code) qs.set('code', code)
  const res = await fetch(`/api/contributions?${qs.toString()}`)
  return parseResponse(res) // single contribution row or null
}

// Endnutzer-Wiederaufnahme OHNE geheime Sitzungs-ID, nur per Code — der Server gibt
// den letzten Beitrag NUR für Endnutzer-Kategorien heraus (Anamnese/Lebenswerk: EINE
// Person je Buch, Code ist privat). Für geteilte Bücher liefert er null. Nötig, weil
// installierte iOS-Apps einen eigenen Speicher haben (localStorage von Safari fehlt).
export async function getEnduserResume(code) {
  const res = await fetch(`/api/contributions?code=${encodeURIComponent(code)}&enduser=1`)
  return parseResponse(res) // contribution row or null
}

export async function addContribution({ contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress, consentAt, consentVersion }) {
  const res = await fetch('/api/contributions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress, consentAt, consentVersion }),
  })
  return parseResponse(res) // { id }
}

// ── LLM (Provider serverseitig gewählt; siehe api/ask.js) ──────────
export async function askLLM(system, messages, opts = {}) {
  // Bei Admin-Generierung wird der Bearer-Token mitgeschickt: serverseitig
  // umgeht ein gültiger Token die IP-Drossel (viele Calls in Folge sind legitim).
  const headers = { 'Content-Type': 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      system,
      messages,
      memorialCode: opts.memorialCode,
      contributionId: opts.contributionId,
      kind: opts.kind,
    }),
  })
  const d = await parseResponse(res)
  return d.text
}

// ── Kosten ────────────────────────────────────────────────────────
export async function getMemorialCosts(token, code) {
  const res = await fetch(`/api/admin/costs?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse(res) // { events, byKind, total_eur, total_usd }
}

// ── Sprachausgabe (OpenAI TTS) ────────────────────────────────────
let currentAudio = null
// iOS-Workaround: EIN persistentes Audio-Element, das während einer Nutzer-Geste
// freigeschaltet wird (stummes WAV abspielen). iOS erlaubt spätere programmatische
// play()-Aufrufe (nach dem async fetch) nur auf DEMSELBEN, bereits freigeschalteten
// Element – deshalb wird es dauerhaft wiederverwendet. (Früher wurde das vorbelegte
// Element nur einmal genutzt, danach `new Audio()` → ab der 2. Frage scheiterte die
// Wiedergabe auf iOS Safari mit „Audiowiedergabe fehlgeschlagen".)
let ttsAudio = null
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

function getTtsAudio() {
  if (!ttsAudio) ttsAudio = new Audio()
  return ttsAudio
}

export function primeAudio() {
  // Innerhalb einer Nutzer-Geste aufrufen (Button-Tap): schaltet das persistente
  // Element frei. Muss dasselbe Element sein, das speakText() später abspielt.
  const a = getTtsAudio()
  try { a.src = SILENT_WAV; a.volume = 0; a.play().catch(() => {}) } catch {}
}

// Monoton steigende Sequenz: jeder stopSpeaking()/speakText()-Start erhöht sie.
// Ein laufender speakText, dessen erfasste Sequenz nicht mehr aktuell ist, wurde
// zwischenzeitlich abgebrochen (z. B. durch Löschen eines Beitrags) und darf weder
// abspielen noch Callbacks feuern – sonst bleibt „Lädt" hängen oder es spielt die
// bereits verworfene Frage.
let speakSeq = 0

export function stopSpeaking() {
  speakSeq++
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

export async function speakText(text, { onStart, onPlay, onEnd, onError, memorialCode, contributionId, language, voice } = {}) {
  stopSpeaking()
  const mySeq = speakSeq
  onStart?.()
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, memorialCode, contributionId, language, voice }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    if (mySeq !== speakSeq) return null // während des Ladens abgebrochen → still verwerfen
    const url = URL.createObjectURL(blob)
    // Immer das persistente, per Nutzer-Geste freigeschaltete Element wiederverwenden
    // (iOS Safari erlaubt programmatisches play() nur auf diesem Element).
    const audio = getTtsAudio()
    currentAudio = audio
    audio.volume = 1
    audio.src = url
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; onEnd?.(); }
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; onError?.('Audiowiedergabe fehlgeschlagen.'); }
    try {
      await audio.play()
      if (mySeq !== speakSeq) { audio.pause(); URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; return null }
      onPlay?.() // Wiedergabe läuft jetzt tatsächlich (Ladephase vorbei)
      return audio
    } catch (playErr) {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      const err = new Error(playErr.message || 'Wiedergabe blockiert')
      err.name = playErr.name
      throw err
    }
  } catch (e) {
    onError?.(e.message, e.name)
    return null
  }
}
