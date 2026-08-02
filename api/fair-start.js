// api/fair-start.js
// POST /api/fair-start  { code, lang? }   (öffentlich, rate-limited)
//
// Löst einen MESSE-CODE ein: Aus einer verteilten Karte wird ein laufendes
// Interview — ohne E-Mail, ohne Passwort, ohne Registrierung. Antwort:
// { memorialCode, reused, timerSeconds } — der Browser springt danach auf
// /?code=<memorialCode> und ist im gewohnten Beitragenden-Flow.
//
// KEINE E-MAIL, UND DAS IST ABSICHT: Am Messestand ist jede Adresseingabe eine
// Hürde, an der die Hälfte abspringt. Datenschutzrechtlich ist das unbedenklich —
// es werden hier KEINE personenbezogenen Daten erhoben; Name und Einwilligung
// folgen wie bei jedem Lebenswerk erst beim Interview-Start im Flow selbst.
//
// DER ZWEITE SCAN FÜHRT ZURÜCK. redeem() ist idempotent: Dieselbe Karte öffnet
// immer dasselbe Interview. Die Karte IST der Zugang — genau wie beim Lebenswerk
// üblich, wo der Buch-Code die einzige Berechtigung des Endnutzers ist.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { genCode } = require('./_lib/codes')
const { redeem } = require('./_lib/faircodes')
const { ensureLifeworkSchema, ensureLifeworkCatalog } = require('./_lib/lifework')
const { ALLOWED_LANGS } = require('./_lib/languages')
const { audit } = require('./_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Kartencodes sind nicht zu erraten (10^15), aber Durchprobieren soll trotzdem
  // nicht lohnen — und jeder Treffer legt ein Buchprojekt an.
  if (!(await enforce(req, res, { name: 'fair-start', limit: 10, windowSeconds: 60 }))) return

  try {
    const raw = String(req.body?.code || '')
    const lang = ALLOWED_LANGS.includes(req.body?.lang) ? req.body.lang : 'de'

    await ensureLifeworkSchema()
    const catalog = await ensureLifeworkCatalog(supabase).catch(() => null)

    const result = await redeem(raw, async ({ timerSeconds, batch }) => {
      const code = genCode()
      // Wie api/register.js, aber ohne Endnutzer-Konto: Es gibt keine E-Mail, an
      // die ein Zugang ginge — die Karte selbst ist der Zugang.
      const insertRow = {
        id: code,
        name: '',
        organizer: '',
        gender: null,
        book_variant: 2,
        funeral_date: null,
        cutoff_days: 0,
        show_intro_video: false,
        show_transcript: true,
        show_contributors: false,
        photo_upload_tab: true,
        product_category: 'lifework',
        owner_user: null,
        intake: null,
        languages: [lang],
        note: `Messe-Code${batch ? ` · ${batch}` : ''}`,
        pickup_address: null,
        catalog_id: catalog,
        followups: 7,
        interview_timer_seconds: timerSeconds,
        companion_mode: false,
        proof_enabled: false,
        detail_choice: false,
        guest_enabled: false,
      }
      let { error } = await supabase.from('memorials').insert(insertRow)
      if (error && /interview_timer_seconds|companion_mode|show_contributors|catalog_id|followups|proof_enabled|detail_choice|guest_enabled|column/i.test(error.message || '')) {
        delete insertRow.interview_timer_seconds
        delete insertRow.companion_mode
        delete insertRow.show_contributors
        delete insertRow.proof_enabled
        delete insertRow.detail_choice
        delete insertRow.guest_enabled
        ;({ error } = await supabase.from('memorials').insert(insertRow))
      }
      if (error) throw error
      return code
    })

    if (result.error === 'unknown' || result.error === 'invalid') {
      // Bewusst dieselbe Meldung für „gibt es nicht" und „unlesbar": Wer Codes
      // durchprobiert, soll daraus nichts ableiten können.
      return res.status(404).json({ error: 'Dieser Code ist ungültig. Bitte prüfen Sie die Eingabe.' })
    }

    if (!result.reused) {
      await audit(req, { actor: null, action: 'fair.redeem', target: result.memorialCode })
    }
    return res.json({ memorialCode: result.memorialCode, reused: !!result.reused })
  } catch (e) {
    console.error('/api/fair-start:', e)
    res.status(500).json({ error: 'Der Zugang konnte nicht geöffnet werden. Bitte später erneut versuchen.' })
  }
}
