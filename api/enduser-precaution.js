// api/enduser-precaution.js
// GET /api/enduser-precaution?code=ABC… → { name, language, precaution, guide }
//
// Was die vorsorgende Person von ihren eigenen Unterlagen sehen darf.
//
// WARUM ES DIESEN ENDPUNKT GIBT: Bei dieser Kategorie ist die Person nicht
// Zulieferin eines Produkts, sondern seine Eigentümerin — die Mappe IST ihre
// Erklärung, und unterschreiben kann sie nur sie selbst. Läge die Mappe allein
// im Dashboard des Managers, hätte jemand eine Stunde lang seine Vollmacht,
// seine Patientenverfügung und seine Bestattungswünsche diktiert und bekäme das
// Papier nie in die Hand. Dasselbe Argument wie bei api/enduser-career.js, hier
// nur noch zwingender.
//
// AUTORISIERUNG wie bei den übrigen Endnutzer-Pfaden: eingeloggter Endnutzer
// (eu-Claim == code) ODER der Zugangscode allein. Bei den Endnutzer-Kategorien
// ist der Code die Berechtigung der Person.
//
// Was hier NICHT herausgeht: Rohbeiträge, Kostendaten, alles Manager-Eigene.
// Der Endpunkt ist strikt lesend.

const { createClient } = require('./_lib/store')
const { checkAuth } = require('./_lib/auth')
const { enforce } = require('./_lib/ratelimit')
const { isPrecautionCategory } = require('./_lib/categories')
const { ensureLifeworkSchema } = require('./_lib/lifework')

const supabase = createClient()

const COLS = 'id, name, product_category, languages, precaution, eulogy_text'

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!(await enforce(req, res, { name: 'enduser-precaution', limit: 60, windowSeconds: 60 }))) return
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'Code fehlt.' })

    await ensureLifeworkSchema().catch(() => {})
    const { data: m } = await supabase.from('memorials').select(COLS).eq('id', code).maybeSingle()
    if (!m) return res.status(404).json({ error: 'Nicht gefunden.' })
    if (!isPrecautionCategory(m.product_category)) {
      return res.status(403).json({ error: 'Nur bei der Vorsorgevollmacht verfügbar.' })
    }
    if (/^Bearer\s/.test(req.headers.authorization || '')) {
      if (!checkAuth(req, res)) return
      if (req.auth.eu !== code && !req.auth.admin) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Zugang.' })
      }
    }

    return res.json({
      name: m.name || '',
      language: (Array.isArray(m.languages) && m.languages[0]) || 'de',
      precaution: m.precaution || null,
      guide: m.eulogy_text || null,
    })
  } catch (e) {
    console.error('[enduser-precaution]', e)
    return res.status(500).json({ error: e.message || 'Fehler beim Laden.' })
  }
}
