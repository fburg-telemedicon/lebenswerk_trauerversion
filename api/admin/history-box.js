// api/admin/history-box.js
// POST /api/admin/history-box
//   { code, variant: 'book_v1'|'book_v2', kapitel, ereignis, anzeige?, ort?, withImage? }
//   → { ok, box, chapter, book }
//
// Setzt zu EINEM zeitgeschichtlichen Ereignis einen Kasten in das Kapitel, in
// dem die zugehoerige Datierung steht. Der Kasten ist derselbe Mechanismus, den
// die Zusatzfragen schon nutzen (`chapter.boxes = [{ title, text }]`) — er wird
// also von PDF-Export, Hoerbuch und Anzeige ohne weiteres Zutun mitgerendert.
// Neu ist nur `kind: 'history'` und das optionale Bild.
//
// Warum serverseitig statt im Browser: Der Kasten entsteht aus einem LLM-Aufruf
// und optional einem Bild, das in den privaten Container hochgeladen werden
// muss. Beides gehoert hinter die Admin-Auth; ausserdem wird das Buch hier in
// EINEM Schritt gelesen, ergaenzt und zurueckgeschrieben.
//
// Der IDOR-Schutz laeuft wie ueberall ueber loadAccessibleMemorial (404 statt
// 403 fuer fremde Buecher).

const crypto = require('crypto')
const { createClient } = require('../_lib/store')
const { checkAuth } = require('../_lib/auth')
const { loadAccessibleMemorial } = require('../_lib/access')
const { ensureLifeworkSchema } = require('../_lib/lifework')
const { callAzure } = require('../_lib/llm')
const { costLLM, costImage, recordCost, enforceBudget } = require('../_lib/cost')
const { IMAGE_BUCKET } = require('../_lib/delete-memorial')
const { normalizeStyle, styleDirective, styleAnchor, DEFAULT_STYLE } = require('../_lib/image-styles')
const { stripMedium, isContentPolicyError, generateAzureFlux } = require('../_lib/flux')
const { tryParseJSON } = require('../_lib/genprompts')
const { langNameDe } = require('../_lib/languages')

const supabase = createClient()
const BUCKET = IMAGE_BUCKET
const VARIANTS = new Set(['book_v1', 'book_v2'])
const MAX_BOXES_PER_CHAPTER = 4

// Der Kasten soll das Ereignis erklaeren, nicht die Lebensgeschichte deuten.
// Die Trennung ist wichtig: Sonst schreibt das Modell der Person Erlebnisse zu,
// die nirgends erzaehlt wurden.
function boxSystem(ereignis, anzeige, ort, kapitelTitel, sprache) {
  return `Du bist Zeithistoriker und schreibst einen kurzen Informationskasten fuer ein Erinnerungsbuch.

Das Ereignis: ${ereignis}${ort ? ` (${ort})` : ''}
Der Zeitpunkt: ${anzeige || 'siehe Ereignis'}
Der Kasten erscheint im Kapitel: ${kapitelTitel}

Schreibe einen sachlichen, gut lesbaren Kasten, der dieses Ereignis einordnet — fuer jemanden, der davon noch nie gehoert hat.

Regeln:
- 3 bis 5 Saetze, Fliesstext, keine Aufzaehlung. Ruhiger, erklaerender Ton.
- NUR das Ereignis. Kein Bezug zur Person des Buchs, keine Vermutung, was sie dabei erlebt oder empfunden haben koennte, keine Anrede.
- Nur gesichertes Wissen. Bist du dir bei einer Einzelheit nicht sicher, lass sie weg statt zu raten. Erfinde keine Namen, Zahlen oder Orte.
- Keine Wertung, keine Moral, kein Ausblick auf Spaeteres.
- Die Ueberschrift muss ein grammatisch vollstaendiger, richtig gebeugter Ausdruck sein — Artikel, Adjektive und Substantiv muessen zusammenpassen ("Erster ZDF-Fernsehgarten", NICHT "Erstes Fernsehgarten"). Kuerze lieber, als einen Ausdruck mittendrin abzuschneiden; im Zweifel nimm das blosse Substantiv ("Der Fernsehgarten"). Kein Satzpunkt am Ende.
- Sprache: ${sprache}. Überschrift und Text in dieser Sprache; nur image_prompt bleibt englisch.

Gib REINES, GUELTIGES JSON aus (kein Markdown, keine Erklaerungen):
{
  "title": "kurze Ueberschrift, hoechstens 6 Woerter",
  "text": "die 3-5 Saetze",
  "image_prompt": "englische Bildbeschreibung der Szene, 15-30 Woerter, ohne Personen der Familie, ohne Text/Schrift im Bild, ohne Logos"
}`
}

module.exports = async function handler(req, res) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, variant, kapitel, ereignis, anzeige, ort, withImage } = req.body || {}
  if (!code || !ereignis) return res.status(400).json({ error: 'code und ereignis sind nötig.' })
  if (!VARIANTS.has(variant)) return res.status(400).json({ error: 'Unbekannte Buchfassung.' })

  try {
    await ensureLifeworkSchema()
    const access = await loadAccessibleMemorial(supabase, req.auth, code,
      `id, name, product_category, owner_user, image_style, ${variant}`)
    if (access.error) return res.status(access.status).json({ error: access.error })
    const mem = access.memorial

    const book = mem[variant]
    if (!book || !Array.isArray(book.chapters) || book.chapters.length === 0) {
      return res.status(400).json({ error: 'Für diese Buchfassung liegt noch kein Text vor.' })
    }

    // Kapitel bestimmen: erst über die Nummer, sonst das erste.
    const nr = parseInt(kapitel, 10)
    let idx = book.chapters.findIndex((c, i) => (parseInt(c?.number, 10) || i + 1) === nr)
    if (idx < 0) idx = 0
    const ch = book.chapters[idx]
    const vorhandene = Array.isArray(ch.boxes) ? ch.boxes : []
    if (vorhandene.length >= MAX_BOXES_PER_CHAPTER) {
      return res.status(400).json({ error: `Dieses Kapitel hat schon ${vorhandene.length} Kästen. Bitte zuerst einen entfernen.` })
    }
    // Denselben Kasten nicht zweimal: Ereignistext ist der Schlüssel. Geprüft
    // wird das GANZE Buch, nicht nur dieses Kapitel — nach einem Neulauf der
    // Parallelen kann dasselbe Ereignis einem anderen Kapitel zugeordnet sein,
    // und dann entstand lautlos ein zweiter Kasten.
    const doppelt = book.chapters.findIndex((c, i2) =>
      (Array.isArray(c?.boxes) ? c.boxes : []).some(b => b?.kind === 'history' && String(b?.source || '') === String(ereignis)))
    if (doppelt >= 0) {
      const nr = book.chapters[doppelt]?.number || doppelt + 1
      return res.status(400).json({ error: `Zu diesem Ereignis steht in Kapitel ${nr} schon ein Kasten. Entfernen geht in der Buchansicht unter „Bearbeiten".` })
    }

    if (!(await enforceBudget(res, code))) return

    // ── Text ────────────────────────────────────────────────────────
    const kapitelTitel = String(ch.heading || ch.title || `Kapitel ${nr || idx + 1}`)
    const llm = await callAzure({
      // Der Kasten steht im Buch — also in der Sprache des Buchs, nicht fest Deutsch.
      system: boxSystem(ereignis, anzeige, ort, kapitelTitel, langNameDe(book.language)),
      messages: [{ role: 'user', content: 'Gib jetzt das JSON aus.' }],
    })
    await recordCost({
      memorial_id: code, kind: 'llm', provider: llm.provider, model: llm.model,
      input_tokens: llm.inT, output_tokens: llm.outT,
      cost_usd: costLLM(llm.model, llm.inT, llm.outT),
      metadata: { zweck: 'history-box', variant, kapitel: nr || idx + 1 },
    })
    const parsed = tryParseJSON(llm.text)
    if (!parsed?.text) return res.status(502).json({ error: 'Die KI hat keinen verwertbaren Kasten geliefert.' })

    const box = {
      kind: 'history',
      title: String(parsed.title || anzeige || 'Zeitgeschehen').trim(),
      text: String(parsed.text).trim(),
      // `source` merkt sich, woraus der Kasten entstand — fürs Erkennen von
      // Doppelungen und damit später nachvollziehbar bleibt, woher er kommt.
      source: String(ereignis),
      when: anzeige ? String(anzeige) : null,
      created_at: new Date().toISOString(),
    }

    // ── Bild (optional) ─────────────────────────────────────────────
    if (withImage && parsed.image_prompt) {
      try {
        const style = normalizeStyle(mem.image_style) || DEFAULT_STYLE
        const prompt = `${styleDirective(style)}\n\nSubject: ${stripMedium(parsed.image_prompt)}\n\n${styleAnchor(style)}`
        const bild = await generateAzureFlux(prompt)
        const storagePath = `${code}/${crypto.randomUUID()}.png`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, bild.buffer, {
          contentType: 'image/png', upsert: false,
        })
        if (upErr) throw new Error(upErr.message)
        box.image_path = storagePath
        await recordCost({
          memorial_id: code, kind: 'image', provider: bild.provider, model: bild.model, images: 1,
          cost_usd: costImage(bild.model, 1),
          metadata: { zweck: 'history-box', storage_path: storagePath, variant, kapitel: nr || idx + 1 },
        })
      } catch (e) {
        // Ein fehlendes Bild darf den Kasten nicht verhindern — der Text ist die
        // Hauptsache. Der Aufrufer erfährt es über `image_error`.
        console.warn('history-box: Bild fehlgeschlagen:', e.message)
        box.image_error = isContentPolicyError(e.message)
          ? 'Der Inhaltsfilter hat das Motiv abgelehnt.'
          : e.message
      }
    }

    // ── In das Buch einsetzen ───────────────────────────────────────
    const neu = { ...book, chapters: book.chapters.map((c, i) => i === idx ? { ...c, boxes: [...vorhandene, box] } : c) }
    const { error } = await supabase.from('memorials').update({ [variant]: neu }).eq('id', code)
    if (error) throw error

    return res.status(200).json({
      ok: true, box, chapter: nr || idx + 1, chapterHeading: kapitelTitel,
      imageError: box.image_error || null,
    })
  } catch (e) {
    console.error('/api/admin/history-box:', e)
    return res.status(500).json({ error: e.message || 'Kasten konnte nicht erzeugt werden.' })
  }
}
