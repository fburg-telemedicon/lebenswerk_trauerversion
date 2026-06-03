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

// ── Gedenkbuch ────────────────────────────────────────────────────
export async function createMemorial({ name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo }) {
  const res = await fetch('/api/memorial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, organizer, gender, bookVariant, funeralDate, cutoffDays, showIntroVideo }),
  })
  return parseResponse(res) // { code }
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

export async function adminGenerateImage(token, memorialCode, prompt) {
  const res = await fetch('/api/admin/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ memorialCode, prompt }),
  })
  return parseResponse(res) // { storagePath }
}

export async function getMemorial(code) {
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`)
  return parseResponse(res) // { id, name, birth_year, death_year, organizer, created_at }
}

// ── Beiträge ──────────────────────────────────────────────────────
export async function getContributions(code) {
  const res = await fetch(`/api/contributions?code=${encodeURIComponent(code)}`)
  return parseResponse(res) // array of contributions
}

export async function addContribution({ contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress }) {
  const res = await fetch('/api/contributions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress }),
  })
  return parseResponse(res) // { id }
}

// ── Claude ────────────────────────────────────────────────────────
export async function askClaude(system, messages, opts = {}) {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
