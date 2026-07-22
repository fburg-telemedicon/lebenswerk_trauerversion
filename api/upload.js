// api/upload.js
// POST /api/upload?code=ABC123
//   { image (base64/dataURL), caption, description, consent:true, contributionId? }
//   → { image: <uploaded_images-Eintrag ohne interne Pfade sind hier ok> }
//
// Öffentlicher Foto-Upload für BEITRAGENDE (am Ende des Interviews). Kein Login,
// deshalb: gültiger, existierender Code nötig (kein anonymer Storage-Proxy),
// Rate-Limit, und ZWINGEND das Einverständnis (Recht am Bild + KI-Verarbeitung
// aller abgebildeten Personen). Ohne consent → 400.

const { createClient } = require('./_lib/store')
const { enforce } = require('./_lib/ratelimit')
const { resolvePublicCode } = require('./_lib/access')
const { appendUpload } = require('./_lib/upload-asset')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const code = (req.query.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'Code fehlt.' })

    // Missbrauchsschutz: begrenzt Uploads pro IP (fail-open).
    if (!(await enforce(req, res, { name: 'upload', limit: 40, windowSeconds: 300 }))) return

    // Buch-Code ODER Gast-Code (Gastbeiträge zum Lebenswerk). Das Foto gehört in
    // JEDEM Fall zum echten Buch — Gastfotos sind der wertvollste Teil des
    // Gastbeitrags und sollen im selben Ordner liegen (Art.-17-Löschung).
    const target = await resolvePublicCode(supabase, code)
    if (!target) {
      return res.status(404).json({ error: `Code „${code}" nicht gefunden.` })
    }

    const { image, caption, description, consent, contributionId } = req.body || {}
    if (!image) return res.status(400).json({ error: 'Kein Bild übergeben.' })
    if (!consent) return res.status(400).json({ error: 'Ohne Einverständniserklärung ist kein Upload möglich.' })

    const entry = await appendUpload(supabase, target.id, {
      base64: image,
      caption,
      description,
      source: target.guest ? 'guest' : 'contributor',
      contributionId: contributionId || null,
      consent: true,
    })
    // Interne Pfade nicht nach außen geben (Signierung passiert nur im Admin-GET).
    const { path, thumb_path, ...safe } = entry
    return res.json({ image: safe })
  } catch (e) {
    console.error('/api/upload:', e)
    // Die Bildprüfung (storeUpload) weiß genau, WARUM sie ablehnt — „Bildformat
    // nicht unterstützt", „Bild ist zu groß (max. 15 MB)" … Das dem Nutzer
    // vorzuenthalten und pauschal „fehlgeschlagen, später erneut versuchen" zu
    // zeigen, schickt ihn ins Leere: Ein HEIC-Foto wird auch morgen nicht gehen.
    // Bekannte Prüf-Fehler deshalb als 400 mit Klartext durchreichen; alles andere
    // bleibt ein echter Serverfehler.
    const msg = String(e?.message || '')
    if (/^(Kein Bild|Bilddaten|Bild ist zu groß|Bildformat|Bild konnte nicht)/i.test(msg)) {
      return res.status(400).json({ error: msg })
    }
    res.status(500).json({ error: 'Der Upload ist fehlgeschlagen. Bitte später erneut versuchen.' })
  }
}
