// api/voicelive-token.js
// POST /api/voicelive-token  { memorialCode, contributionId?, language? }
//   → { ticket, path, expiresInMs, locale, voice }
//   → 409 { code:'realtime_unavailable' }  wenn der Modus für dieses Buch
//     ausgeschaltet, nicht konfiguriert oder die Sprache nicht abgedeckt ist.
//
// Stellt KEIN Azure-Token aus (das läge im Browser), sondern ein kurzlebiges,
// signiertes RELAY-Ticket: die Erlaubnis, genau eine Live-Sitzung für genau
// dieses Buch über /api/voicelive-relay zu öffnen. Der Ressourcenschlüssel bleibt
// im Server. Hintergrund + Sitzungs-Bausteine in api/_lib/voicelive.js.
//
// Der Client behandelt JEDE Fehlerantwort als „Live-Gespräch nicht verfügbar"
// und bleibt bei den bisherigen Mikrofon-Modi — das Feature darf nie ein
// Interview blockieren.

const { createClient } = require('./_lib/store')
const { enforceBudget } = require('./_lib/cost')
const { resolvePublicCode } = require('./_lib/access')
const { enforce } = require('./_lib/ratelimit')
const { isVoiceLiveConfigured, signTicket, TICKET_TTL_MS } = require('./_lib/voicelive')
const { ALLOWED_TTS_VOICES } = require('./_lib/ttsvoices')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Sprachen, die das Live-Gespräch anbietet, mit ihrem Azure-Speech-Locale.
// Bewusst dieselben Locales wie api/transcribe.js (dort LOCALE) — die STT-Seite
// von Voice Live ist derselbe Dienst.
//
// NICHT dabei und bewusst so: `eu` (Baskisch) und `de-CH` (Schweizer Mundart).
// Für beide ist die Abdeckung der Voice-Live-Strecke nicht belegt; sie laufen
// weiter über den bewährten Fast-Transcription-Pfad, wo sie nachweislich
// funktionieren. Lieber ein Modus weniger als ein unbrauchbares Transkript.
const REALTIME_LOCALES = {
  de: 'de-DE', en: 'en-US', pl: 'pl-PL', es: 'es-ES', it: 'it-IT',
  fr: 'fr-FR', ro: 'ro-RO', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA',
  he: 'he-IL', ar: process.env.AZURE_SPEECH_STT_LOCALE_AR || 'ar-EG',
}

const UNAVAILABLE = { error: 'Live-Sprachgespräch steht für dieses Buch nicht zur Verfügung.', code: 'realtime_unavailable' }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Ein Ticket eröffnet eine kostenpflichtige Sitzung → eng drosseln.
    if (!(await enforce(req, res, { name: 'voicelive-token', limit: 10, windowSeconds: 60 }))) return

    // Ohne Ressource/Signaturschlüssel gibt es das Feature schlicht nicht.
    if (!isVoiceLiveConfigured() || !process.env.ADMIN_TOKEN_SECRET) {
      return res.status(409).json(UNAVAILABLE)
    }

    const { memorialCode, contributionId, language, voice: wantVoice } = req.body || {}
    const code = String(memorialCode || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'memorialCode fehlt.' })

    // Buch-Code ODER Gast-Code; die Sitzung wird immer aufs echte Buch gebucht.
    const target = await resolvePublicCode(supabase, code)
    if (!target) return res.status(403).json({ error: 'Ungültiger Code.' })

    // Kosten-Obergrenze je Buch erschöpft → gar keine Sitzung mehr eröffnen (402).
    // Wichtiger als bei den Einzel-Endpunkten: eine Live-Sitzung läuft frei
    // weiter, sobald sie einmal offen ist.
    if (!(await enforceBudget(res, target.id))) return

    // Kein Buch-Flag mehr: Der Live-Modus steht allen offen und ist immer die
    // bewusste Wahl der erzählenden Person (2026-08-02). Gelesen wird hier nur
    // noch die Buchstimme, damit beide Modi gleich klingen.
    let voice = null
    {
      const { data } = await supabase.from('memorials').select('tts_voice').eq('id', target.id).maybeSingle()
      voice = data?.tts_voice || null
    }

    // Stimme: Der Beitragenden-Flow wählt sie mit `interviewTtsVoice` (Regel dort:
    // nach Geschlecht) und schickt sie mit. Ohne das sprach dasselbe Buch im
    // Live-Modus mit einer ANDEREN Stimme als im Mikrofon-Modus — beim Wechsel
    // zwischen den Modi hörte man abwechselnd Mann und Frau.
    //
    // Die Wahl kommt aus dem Browser, deshalb gegen die Allowlist prüfen (wie in
    // api/speak.js); alles Unbekannte fällt auf die am Buch hinterlegte Stimme
    // zurück. So kann niemand über den offenen Endpunkt eine beliebige (etwa
    // teure Custom-)Stimme anfordern.
    if (typeof wantVoice === 'string' && ALLOWED_TTS_VOICES.has(wantVoice)) voice = wantVoice

    const lang = String(language || 'de')
    const locale = REALTIME_LOCALES[lang]
    if (!locale) return res.status(409).json(UNAVAILABLE)

    const ticket = signTicket({
      id: target.id,
      code: target.code,          // der Code, den der Aufrufer geschickt hat (Gast sieht nie den Buch-Code)
      guest: target.guest === true,
      contributionId: contributionId || null,
      language: lang,
      locale,
      voice,
    })
    if (!ticket) return res.status(409).json(UNAVAILABLE)

    return res.json({ ticket, path: '/api/voicelive-relay', expiresInMs: TICKET_TTL_MS, locale, voice })
  } catch (e) {
    console.error('/api/voicelive-token error:', e)
    // Auch hier: kein 500-Drama im Interview — der Client fällt still zurück.
    res.status(409).json(UNAVAILABLE)
  }
}
