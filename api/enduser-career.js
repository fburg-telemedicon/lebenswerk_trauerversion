// api/enduser-career.js
// GET /api/enduser-career?code=ABC… → { name, language, cv, avoca, guide, match, documents }
//
// Was die ERZÄHLENDE PERSON von ihren eigenen Unterlagen sehen darf — und das
// ist alles, was über sie erzeugt wurde.
//
// WARUM ES DIESEN ENDPUNKT ÜBERHAUPT GIBT: Bis hierhin lagen Lebenslauf,
// Kompetenzprofil, Gesprächsleitfaden und Stellenabgleich ausschließlich im
// Dashboard des Managers. Die Person erzählte also eine Stunde lang ihr
// Berufsleben und bekam das Ergebnis nie zu Gesicht. Für eine Anamnese wäre das
// stimmig (der Bogen gehört der Klinik), für ein Produkt, dessen erster Satz
// „die Person ist Eigentümerin" lautet, nicht.
//
// AUTORISIERUNG wie bei den übrigen Endnutzer-Pfaden (api/enduser-book.js):
// eingeloggter Endnutzer (eu-Claim == code) ODER der Buch-Code allein. Beim
// Lebenslauf ist der Code — wie beim Lebenswerk — die Berechtigung der Person;
// wer ihn hat, ist sie (oder jemand, dem sie ihn gegeben hat).
//
// Was hier NICHT herausgeht: die Rohbeiträge (die kennt sie ohnehin), die
// Kostendaten und alles, was zum Manager gehört. Und der Endpunkt ist strikt
// lesend — die Person ändert hier nichts.

const { createClient } = require('./_lib/store')
const { checkAuth } = require('./_lib/auth')
const { enforce } = require('./_lib/ratelimit')
const { isCareerCategory } = require('./_lib/categories')
const { ensureLifeworkSchema } = require('./_lib/lifework')

const supabase = createClient()

const COLS = 'id, name, product_category, languages, cv, avoca, eulogy_text, job_match, documents, intake'

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!(await enforce(req, res, { name: 'enduser-career', limit: 60, windowSeconds: 60 }))) return
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'Code fehlt.' })

    await ensureLifeworkSchema().catch(() => {})
    const { data: m } = await supabase.from('memorials').select(COLS).eq('id', code).maybeSingle()
    if (!m) return res.status(404).json({ error: 'Nicht gefunden.' })
    if (!isCareerCategory(m.product_category)) {
      return res.status(403).json({ error: 'Nur beim Lebenslauf verfügbar.' })
    }
    // Ein mitgeschicktes Token muss zu DIESEM Zugang gehören; ohne Token
    // trägt der Code selbst die Berechtigung.
    if (/^Bearer\s/.test(req.headers.authorization || '')) {
      if (!checkAuth(req, res)) return
      if (req.auth.eu !== code && !req.auth.admin) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Zugang.' })
      }
    }

    // Dokumente nur als Übersicht: Was wurde ausgelesen, was ist bestätigt.
    // Die Person soll sehen, welche ihrer Unterlagen als Beleg zählen — die
    // vollständige Auslesung braucht sie dafür nicht.
    const documents = (Array.isArray(m.documents) ? m.documents : []).map(d => ({
      caption: d.caption || '',
      kind: d.data?.kind || '',
      organization: d.data?.organization || '',
      confirmed: d.confirmed === true,
      readable: d.data?.readable !== false,
    }))

    return res.json({
      name: m.name || '',
      language: (Array.isArray(m.languages) && m.languages[0]) || 'de',
      focus: m.intake?.focus || '',
      cv: m.cv || null,
      avoca: m.avoca || null,
      guide: m.eulogy_text || null,
      match: m.job_match || null,
      documents,
    })
  } catch (e) {
    console.error('[enduser-career]', e)
    return res.status(500).json({ error: e.message || 'Fehler beim Laden.' })
  }
}
