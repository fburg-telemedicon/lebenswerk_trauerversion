// api/admin/duplicate-memorial.js
// Legt eine ECHTE 1:1-Kopie eines Buchprojekts an: eigene Zeile, eigener Code,
// eigene Bilddateien. Gedacht als Arbeitskopie — eine Fassung überarbeiten,
// ausprobieren oder dem Kunden zeigen, ohne das Original anzufassen.
//
// Warum ein eigener Endpunkt und nicht "neu anlegen + Buch hineinkopieren":
// Ein Buch besteht nicht nur aus Text. Die Kapitelbilder liegen als Blobs unter
// <CODE>/… und werden über genau diesen Pfad signiert. Kopiert man nur das JSON,
// zeigen beide Projekte auf DIESELBEN Dateien. Das ist aus zwei Gründen schlecht:
// Die Aufbewahrungs-Löschung des Originals nimmt der Kopie die Bilder weg, und
// die Waisen-Bereinigung beim Speichern eines Buchs arbeitet über Pfade. Eine
// Kopie muss ihre Bilder deshalb BESITZEN, nicht ausleihen.
//
// POST /api/admin/duplicate-memorial
//   { code, name?, withContributions?, bookVariant? }
//   withContributions: Standard true
//   bookVariant: 1 | 2 — nur nötig, wenn die Kopie eine ANDERE Variante tragen
//     soll als das Original. Die Variante ist nach der Anlage gesperrt (die
//     Beitragenden haben ihre Einwilligung im Vertrauen auf die damals geltende
//     Variante gegeben), lässt sich also nur BEI der Anlage bestimmen — und die
//     Kopie wird hier angelegt. Gebraucht wird das bei Altbeständen, in denen
//     Variante und tatsächlich vorhandenes Buch auseinanderlaufen: Ohne dieses
//     Feld liesse sich das kopierte Buch in der Kopie nie wieder speichern.
// → { code, name, images, contributions }

const { createClient } = require('../_lib/store')
const { checkAuth, canAccessCategory } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { genCode } = require('../_lib/codes')
const { audit } = require('../_lib/audit')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const IMAGE_BUCKET = 'memorial-images'

// Spalten, die NICHT mitkopiert werden. Sie gehören zur Identität, zur
// Vorgeschichte oder zum Zugang des Originals — nicht zum Inhalt.
const SKIP_COLS = new Set([
  'id',              // neuer Code
  'created_at',      // die Kopie entsteht jetzt
  'guest_code',      // muss eindeutig sein; Gastzugang wird bewusst NICHT geerbt
  'edit_lock',       // Bearbeitungs-Lock des Originals
  'stored_pdfs',     // zeigen auf abgelegte PDFs des Originals
  'purge_info',      // Löschprotokoll des Originals
  'archived_at',
  'proof_used',      // Probedruck-Zähler beginnt bei 0
  // Fortlaufende Projektnummer: eigene Sequenz + UNIQUE-Index
  // (memorials_project_no_uidx, siehe api/_lib/lifework.js). Mitkopieren
  // verletzt den Index — die Kopie zieht ihre eigene Nummer aus der Sequenz.
  'project_no',
  'book_v1_at', 'book_v2_at', 'eulogy_at',
])

const contentTypeOf = (p) => {
  const e = String(p).toLowerCase().split('.').pop()
  return e === 'png' ? 'image/png'
    : (e === 'jpg' || e === 'jpeg') ? 'image/jpeg'
    : e === 'webp' ? 'image/webp'
    : e === 'pdf' ? 'application/pdf'
    : 'application/octet-stream'
}

// Nur echte JSON-Objekte werden rekursiv durchlaufen. Wichtig: Der pg-Treiber
// liefert Datumsspalten als Date-INSTANZ. Wuerde die Rekursion darauf laufen,
// bliebe ein leeres Objekt uebrig — und der Insert scheiterte mit
// "column is of type date but expression is of type jsonb".
const isPlainObject = v => v !== null && typeof v === 'object'
  && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v)

// Ersetzt in JEDEM String, der mit "<from>/" beginnt, das Präfix durch "<to>/".
// Läuft rekursiv durch das ganze JSON, damit auch Felder erfasst werden, die
// heute noch niemand kennt (neue Nebenprodukte, neue Bildfelder).
function rewritePaths(value, from, to) {
  if (typeof value === 'string') {
    return value.startsWith(`${from}/`) ? `${to}/${value.slice(from.length + 1)}` : value
  }
  if (Array.isArray(value)) return value.map(v => rewritePaths(v, from, to))
  if (isPlainObject(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewritePaths(v, from, to)
    return out
  }
  return value
}

// Signierte URLs des Originals dürfen nicht mitwandern: Sie laufen nach einer
// Stunde ab und werden bei jedem Laden neu erzeugt. Gespeichert gehören sie nie.
function stripSignedUrls(value) {
  if (Array.isArray(value)) return value.map(stripSignedUrls)
  if (isPlainObject(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (/_url$/.test(k) && typeof v === 'string' && v.includes('blob.core.windows.net')) continue
      out[k] = stripSignedUrls(v)
    }
    return out
  }
  return value
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const code = String(req.body?.code || '').toUpperCase().trim()
    if (!code) return res.status(400).json({ error: 'code fehlt.' })
    const withContributions = req.body?.withContributions !== false

    // IDOR-Schutz: fremde Bücher gibt es für diesen Nutzer nicht (404, nicht 403).
    const access = await loadAccessibleMemorial(supabase, req.auth, code, 'id, product_category')
    if (access.error) return res.status(access.status).json({ error: access.error })
    if (!canAccessCategory(req.auth, access.memorial.product_category)) {
      return res.status(403).json({ error: 'Keine Berechtigung für diese Produktkategorie.' })
    }

    const { data: src, error: srcErr } = await supabase.from('memorials').select('*').eq('id', code).single()
    if (srcErr) throw srcErr

    // Freien Code würfeln (32^10 — Kollision praktisch ausgeschlossen, trotzdem prüfen).
    let newCode = null
    for (let i = 0; i < 5 && !newCode; i++) {
      const cand = genCode()
      const { data: taken } = await supabase.from('memorials').select('id').eq('id', cand).maybeSingle()
      if (!taken) newCode = cand
    }
    if (!newCode) return res.status(500).json({ error: 'Konnte keinen freien Code erzeugen.' })

    // ── 1) Bilddateien kopieren ────────────────────────────────────────────
    // Der ganze Ordner, nicht nur die im Buch referenzierten Pfade: So wandern
    // auch Thumbnails, Cover-Hintergründe und hochgeladene Originalfotos mit.
    const images = { copied: 0, failed: [] }
    const { data: files, error: listErr } = await supabase.storage.from(IMAGE_BUCKET).list(code, { limit: 1000 })
    if (listErr) return res.status(502).json({ error: `Bilder konnten nicht gelistet werden: ${listErr.message}` })
    for (const f of (files || [])) {
      if (!f?.name) continue
      const from = `${code}/${f.name}`
      const to = `${newCode}/${f.name}`
      const { data: blob, error: dErr } = await supabase.storage.from(IMAGE_BUCKET).download(from)
      if (dErr || !blob) { images.failed.push(from); continue }
      const buf = Buffer.from(await blob.arrayBuffer())
      const { error: uErr } = await supabase.storage.from(IMAGE_BUCKET)
        .upload(to, buf, { contentType: contentTypeOf(f.name), upsert: true })
      if (uErr) { images.failed.push(from); continue }
      images.copied++
    }
    // Ohne Bilder wäre es keine 1:1-Kopie — dann lieber gar kein Projekt anlegen
    // und die schon kopierten Dateien wieder wegräumen.
    if (images.failed.length) {
      const { data: made } = await supabase.storage.from(IMAGE_BUCKET).list(newCode, { limit: 1000 })
      const paths = (made || []).filter(x => x?.name).map(x => `${newCode}/${x.name}`)
      if (paths.length) await supabase.storage.from(IMAGE_BUCKET).remove(paths)
      return res.status(502).json({ error: `${images.failed.length} Bilddatei(en) ließen sich nicht kopieren — abgebrochen, nichts angelegt.` })
    }

    // ── 2) Zeile kopieren, Pfade umschreiben ───────────────────────────────
    const row = { id: newCode }
    for (const [k, v] of Object.entries(src)) {
      if (SKIP_COLS.has(k)) continue
      row[k] = rewritePaths(stripSignedUrls(v), code, newCode)
    }
    if (req.body?.name) row.name = String(req.body.name).slice(0, 200)
    const wantVariant = String(req.body?.bookVariant ?? '')
    if (wantVariant === '1' || wantVariant === '2') row.book_variant = wantVariant

    const { error: insErr } = await supabase.from('memorials').insert(row)
    if (insErr) {
      const { data: made } = await supabase.storage.from(IMAGE_BUCKET).list(newCode, { limit: 1000 })
      const paths = (made || []).filter(x => x?.name).map(x => `${newCode}/${x.name}`)
      if (paths.length) await supabase.storage.from(IMAGE_BUCKET).remove(paths)
      throw insErr
    }

    // ── 3) Beiträge kopieren (eigene IDs) ──────────────────────────────────
    let contributions = 0
    if (withContributions) {
      const { data: cons } = await supabase.from('contributions').select('*').eq('memorial_id', code)
      const rows = (cons || []).map(c => {
        const out = { ...c, id: genCode(), memorial_id: newCode }
        delete out.created_at
        return rewritePaths(out, code, newCode)
      })
      if (rows.length) {
        const { error: cErr } = await supabase.from('contributions').insert(rows)
        if (cErr) console.error('Beiträge konnten nicht kopiert werden:', cErr.message)
        else contributions = rows.length
      }
    }

    await audit(req, { actor: req.auth, action: 'memorial.duplicate', target: newCode, detail: { from: code, images: images.copied, contributions } })
    return res.json({ code: newCode, name: row.name, images: images.copied, contributions })
  } catch (e) {
    console.error('duplicate-memorial:', e)
    return res.status(500).json({ error: e.message })
  }
}
