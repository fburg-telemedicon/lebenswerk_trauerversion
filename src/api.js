// src/api.js – zentraler API-Client für das Frontend

// ── Gedenkbuch ────────────────────────────────────────────────────
export async function createMemorial({ name, organizer, gender, bookVariant, funeralDate, cutoffDays }) {
  const res = await fetch('/api/memorial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, organizer, gender, bookVariant, funeralDate, cutoffDays }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error)
  return d // { code }
}

export async function adminDeleteMemorial(token, code) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
  return d
}

export async function adminSaveMemorialText(token, code, field, text) {
  const res = await fetch(`/api/admin/memorials?code=${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ field, text }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
  return d
}

export async function adminGenerateImage(token, memorialCode, prompt) {
  const res = await fetch('/api/admin/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ memorialCode, prompt }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
  return d // { storagePath }
}

export async function getMemorial(code) {
  const res = await fetch(`/api/memorial?code=${encodeURIComponent(code)}`)
  const d = await res.json()
  if (!res.ok) throw new Error(d.error)
  return d // { id, name, birth_year, death_year, organizer, created_at }
}

// ── Beiträge ──────────────────────────────────────────────────────
export async function getContributions(code) {
  const res = await fetch(`/api/contributions?code=${encodeURIComponent(code)}`)
  const d = await res.json()
  if (!res.ok) throw new Error(d.error)
  return d // array of contributions
}

export async function addContribution({ contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress }) {
  const res = await fetch('/api/contributions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contributionId, memorialCode, contributorName, relationship, messages, contributorGender, contributorAddress }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error)
  return d // { id }
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
  const d = await res.json()
  if (!res.ok) throw new Error(d.error)
  return d.text
}

// ── Kosten ────────────────────────────────────────────────────────
export async function getMemorialCosts(token, code) {
  const res = await fetch(`/api/admin/costs?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
  return d // { events, byKind, total_eur, total_usd }
}

// ── Sprachausgabe (OpenAI TTS) ────────────────────────────────────
let currentAudio = null

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
    const audio = new Audio(url)
    currentAudio = audio
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
