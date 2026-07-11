// src/shared.js — geteilte, zustandslose Helfer (Bild-Downscaling, Bildfehler-
// Text, lokale Session-Persistenz, ID-Generierung, Audio-Freischaltung). Von der
// Admin-App UND vom Beitragenden-Flow genutzt.

import { primeAudio } from './api.js'

// Liest eine Bilddatei und gibt eine herunterskalierte JPEG-Data-URL zurück
// (längste Kante ≤ maxEdge). Hält die Upload-Nutzlast unter dem Vercel-Body-
// Limit und beschleunigt den Upload. Bei nicht darstellbaren Formaten (z. B.
// HEIC) fällt sie auf die Original-Data-URL zurück (sharp kann sie serverseitig).
export function fileToDownscaledDataURL(file, maxEdge = 2400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          let { width, height } = img
          const scale = Math.min(1, maxEdge / Math.max(width, height))
          width = Math.round(width * scale); height = Math.round(height * scale)
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch { resolve(reader.result) }
      }
      img.onerror = () => resolve(reader.result)
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// Übersetzt eine (oft englische, technische) Bildgenerierungs-Fehlermeldung in
// einen verständlichen deutschen Hinweis und ergänzt die Aufforderung, sich an
// den Administrator zu wenden. Wird an allen Anzeigestellen verwendet; die
// rohe Meldung bleibt für die Diagnose in den Daten erhalten.
export function imageErrorDe(raw) {
  const core = String(raw || '').replace(/^Bildgenerierung fehlgeschlagen(?: \([^)]*\))?:\s*/i, '')
  const admin = ' Bitte wenden Sie sich an den Administrator.'
  let de
  if (/RAI policy|BingBlockList|responsible ai|content (policy|filter|management)|blocklist|block list|moderat|flagged/i.test(core))
    de = 'Das KI-Bildmotiv wurde vom Inhaltsfilter abgelehnt.'
  else if (/rate.?limit|too many requests|exceeded|\b429\b/i.test(core))
    de = 'Das Bildlimit wurde kurzzeitig erreicht (zu viele Anfragen in kurzer Zeit).'
  else if (/image_prompt|Bild-Prompt|kein image_prompt/i.test(core))
    de = 'Für dieses Kapitel wurde kein Bildmotiv erzeugt.'
  else if (/timeout|timed out|nicht rechtzeitig|keine bilddaten|HTTP 5\d\d|\b50[234]\b|bad gateway|FUNCTION_INVOCATION_TIMEOUT|fetch failed/i.test(core))
    de = 'Die Bilderzeugung hat zu lange gedauert oder der Bilddienst war nicht erreichbar.'
  else if (/Storage|Upload/i.test(core))
    de = 'Das erzeugte Bild konnte nicht gespeichert werden.'
  else if (/nicht konfiguriert|AZURE_FLUX/i.test(core))
    de = 'Der Bilddienst ist nicht korrekt konfiguriert.'
  else
    de = 'Die Bilderzeugung ist fehlgeschlagen.'
  return de + admin
}

// ── Lokale Session-Persistenz (Option 1: localStorage) ────────────
const SESSION_TTL_DAYS = 60

function sessionKey(code) { return `lw_session_${code}` }

export function saveLocalSession(code, data) {
  try { localStorage.setItem(sessionKey(code), JSON.stringify({ ...data, savedAt: Date.now() })) } catch {}
}

export function loadLocalSession(code) {
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

export function clearLocalSession(code) {
  try { localStorage.removeItem(sessionKey(code)) } catch {}
}

export function genContribId() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 14 }, () => a[Math.floor(Math.random() * a.length)]).join('')
}

export function unlockAudio() {
  // Bereitet das Audio-Element vor, das speakText() später wiederverwendet
  primeAudio()
}

export function cutoffDays(memorial) {
  const n = parseInt(memorial?.cutoff_days, 10)
  return Number.isFinite(n) && n >= 0 ? n : 7
}

export function cutoffDate(funeralDate, days) {
  if (!funeralDate) return null
  const d = new Date(funeralDate)
  d.setDate(d.getDate() - (Number.isFinite(days) ? days : 7))
  return d
}

export function cutoffString(funeralDate, days = 7) {
  const d = cutoffDate(funeralDate, days)
  return d ? d.toLocaleDateString('de-DE') : '—'
}

export function formatEur(n) {
  const v = Number(n || 0)
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

const COST_KIND_LABEL = {
  interview:  'Interview-Fragen (KI)',
  reasoning:  'Sonstiges KI-Reasoning',
  book_v1:    'Buch V1 – Generierung',
  book_v2:    'Buch V2 – Generierung',
  eulogy:     'Endtext (Rede) – Generierung',
  tts:        'Sprachausgabe (TTS)',
  stt:        'Spracherkennung (STT)',
  image:      'Bildgenerierung (FLUX)',
}
export function costKindLabel(k) { return COST_KIND_LABEL[k] || k || 'Sonstiges' }

export const PASSWORD_RULES_TEXT = 'Mindestens 8 Zeichen, davon mindestens eine Ziffer und ein Sonderzeichen.'
export function passwordError(p) {
  const s = String(p ?? '')
  if (s.length < 8) return 'Passwort muss mindestens 8 Zeichen haben.'
  if (!/[0-9]/.test(s)) return 'Passwort muss mindestens eine Ziffer enthalten.'
  if (!/[^A-Za-z0-9]/.test(s)) return 'Passwort muss mindestens ein Sonderzeichen enthalten.'
  return null
}
