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
export async function createMemorial(token, { name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, productCategory, intake, languages, note, pickupAddress, catalogId, followups, imageStyle, bookLayout }) {
  const res = await fetch('/api/admin/memorials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo, productCategory, intake, languages, note, pickupAddress, catalogId, followups, imageStyle, bookLayout }),
  })
  return parseResponse(res) // { code }
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
export async function adminCreateUser(token, { username, allowed_categories, is_admin, demo }) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username, allowed_categories, is_admin, demo }),
  })
  return parseResponse(res) // { id, username, …, invite_token, invite_expires, demo? }
}

// ── Einladung einlösen (Self-Onboarding, ohne Login) ──────────────
// Beides läuft über den öffentlichen Login-Endpunkt (siehe api/admin/login.js).
export async function getInvite(inviteToken) {
  const res = await fetch(`/api/admin/login?invite=${encodeURIComponent(inviteToken)}`)
  return parseResponse(res) // { username }
}
export async function redeemInvite(inviteToken, password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite: inviteToken, password }),
  })
  return parseResponse(res) // { token, admin, cats, uid, username }
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
// Audit-Log lesen (admin-only). In users.js eingebettet (?audit=1) wegen
// des Vercel-12-Funktionen-Limits.
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
// iOS-Workaround: Audio-Element wird während der User-Geste vorbelegt,
// damit play() nach dem async fetch noch im aktivierten Kontext läuft.
let _primedAudio = null
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

export function primeAudio() {
  _primedAudio = new Audio()
  _primedAudio.src = SILENT_WAV
  _primedAudio.volume = 0
  _primedAudio.play().catch(() => {})
}

export function stopSpeaking() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

export async function speakText(text, { onStart, onEnd, onError, memorialCode, contributionId } = {}) {
  stopSpeaking()
  onStart?.()
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, memorialCode, contributionId }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    // Primed element wiederverwenden (iOS: bereits im aktivierten Zustand)
    const audio = _primedAudio ?? new Audio()
    _primedAudio = null
    currentAudio = audio
    audio.volume = 1
    audio.src = url
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; onEnd?.(); }
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; onError?.('Audiowiedergabe fehlgeschlagen.'); }
    try {
      await audio.play()
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
