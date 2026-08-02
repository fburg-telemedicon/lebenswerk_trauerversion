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


// Zugangscodes lesbar gruppieren: 10 Zeichen als 3-4-3 (QVZ-Y2R2-5WF). Das ist die
// Portionsgröße, die man sich beim Abtippen merken kann. Ältere 6-stellige Codes
// werden als 3-3 gruppiert; alles andere bleibt ungruppiert. Die Trennstriche sind
// reine Anzeige — beim Einlesen werden sie entfernt.
export function formatCode(raw) {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (c.length === 10) return `${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`
  if (c.length === 6) return `${c.slice(0, 3)}-${c.slice(3)}`
  return c
}
export const stripCode = raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)

export function cutoffDays(memorial) {
  const n = parseInt(memorial?.cutoff_days, 10)
  return Number.isFinite(n) && n >= 0 ? n : 7
}

// Letzter Tag der Erfassungsfrist — und zwar bis 23:59:59.999 ORTSZEIT.
// Wichtig: 'YYYY-MM-DD' wird von new Date() als UTC-Mitternacht gelesen. Verglichen
// mit Date.now() galt die Frist dadurch schon am Morgen des letzten Tages als
// abgelaufen (in MESZ ab 02:00 Uhr). Deshalb wird das Datum hier aus seinen Teilen
// als LOKALES Datum gebaut und auf das Tagesende gesetzt: der letzte Tag zählt ganz.
export function cutoffDate(funeralDate, days) {
  if (!funeralDate) return null
  const m = String(funeralDate).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(funeralDate)
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() - (Number.isFinite(days) ? days : 7))
  d.setHours(23, 59, 59, 999)
  return d
}

export function cutoffString(funeralDate, days = 7) {
  const d = cutoffDate(funeralDate, days)
  return d ? d.toLocaleDateString('de-DE') : '—'
}

// Einzelauflistung (Kategorie-/Event-Tabelle): bis zu 4 Nachkommastellen, damit
// Cent-Bruchteile einzelner Events nicht auf 0,00 gerundet verschwinden.
export function formatEur(n) {
  const v = Number(n || 0)
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

// Summen im Dashboard (Gesamtkosten je Buch, Buchliste): genau 2 Nachkommastellen.
export function formatEurSum(n) {
  const v = Number(n || 0)
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Bruttopreis eines Gutscheins/Freischaltcodes: liegt als ganzzahliger CENT-Wert
// in der DB (siehe api/_lib/unlockcodes.js), damit nichts wegrundet.
// Eingabe des Admins ("49,90", "49.90", "49 €") → Cent. null = leer, NaN = ungültig.
export function parsePriceCents(input) {
  if (input === null || input === undefined) return null
  const s = String(input).replace(/[€\s]/g, '').replace(',', '.').trim()
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN
  return Math.round(parseFloat(s) * 100)
}

// Cent → "49,90 €" (leerer Preis → null, damit der Aufrufer die Zeile weglassen kann).
export function formatPriceCents(cents) {
  if (cents === null || cents === undefined || cents === '') return null
  return formatEurSum(Number(cents) / 100)
}

// Cent → "49,90" fürs Eingabefeld (ohne Währungszeichen).
export function priceCentsToInput(cents) {
  if (cents === null || cents === undefined || cents === '') return ''
  return (Number(cents) / 100).toFixed(2).replace('.', ',')
}

const COST_KIND_LABEL = {
  interview:  'Interview-Fragen (KI)',
  reasoning:  'Sonstiges KI-Reasoning',
  book_v1:    'Buch V1 – Generierung',
  book_v2:    'Buch V2 – Generierung',
  eulogy:     'Endtext (Rede) – Generierung',
  tree:       'Stammbaum – Generierung',
  poster:     'Lebensposter – Generierung',
  care:       'Betreuungsverfügung – Generierung',
  poa:        'Vorsorgevollmacht – Generierung',
  anamnese_section:   'Anamnesebogen – Generierung',
  anamnese_translate: 'Anamnesebogen – Übersetzung',
  anamnese_edit:      'Anamnesebogen – Korrektur',
  'support-assist':   'Support – KI-Antwortvorschlag',
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

// QR-Codes entstehen IM BROWSER. Vorher lief das über api.qrserver.com — dabei
// ging die vollständige Einladungs-URL samt Buch-Code an einen fremden Server,
// und beim Lebenswerk IST dieser Code die gesamte Berechtigung des Endnutzers.
// Die Muster-Bibliothek wird erst beim ersten QR geladen (eigener Chunk), damit
// der Beitragenden-Flow davon nichts mitträgt.
let qrLib = null
export async function qrCodeDataUrl(text, size = 240) {
  if (!qrLib) qrLib = (await import('qrcode')).default || (await import('qrcode'))
  return qrLib.toDataURL(String(text || ''), {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#1c1917ff', light: '#ffffffff' },
  })
}
