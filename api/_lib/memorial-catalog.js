// api/_lib/memorial-catalog.js
// Der Fragenkatalog fuer das Gedenkbuch (Kategorie `memorial`).
//
// Anders als beim Lebenswerk ist er NICHT der Standard: Ein Gedenkbuch fragt
// weiterhin frei (die KI ueberlegt die Fragen selbst). Der Katalog ist eine
// Wahlmoeglichkeit im Expertenmodus der Anlage-Maske — dort erscheint er, weil
// er fuer `memorial` freigegeben ist. Nachfragen je Frage (`followups`,
// Standard 2) und die Wahl durch den Beitragenden (`detail_choice`, Standard
// aus) laufen ueber dieselben Einstellungen wie bei jedem anderen Katalog.
//
// Aufbau wie api/_lib/mamazone.js: Der Katalog gehoert zum Produkt und steht
// deshalb im Code; er wird bei Bedarf idempotent in question_catalogs angelegt.
// Aendert sich hier der Wortlaut, zieht der naechste Abruf die Zeile nach.

const MEMORIAL = 'memorial'
const CATALOG_NAME = 'Gedenkbuch – Standardfragen'

const CATALOG_CHAPTERS = [
  {
    title: 'Erinnerungen',
    questions: [
      'Wenn Sie an die verstorbene Person denken – was taucht gerade als Erstes in Ihnen auf?',
      'Woher kannten Sie diesen Menschen? Wie haben Sie sich kennengelernt?',
      'Was hat Ihre Beziehung zu diesem Menschen für Sie besonders gemacht?',
      'Gibt es einen Moment mit diesem Menschen, der Ihnen besonders in Erinnerung geblieben ist?',
      'Gab es etwas, das Sie mit ihm oder ihr verbunden hat? Etwas, das typisch für Sie beide war?',
      'Gibt es etwas, worüber Sie gemeinsam lachen konnten – oder einen Moment, der Ihnen bis heute ein Lächeln schenkt?',
      'Was hat diesen Menschen für Sie ausgemacht?',
      'Was hat dieser Mensch in Ihrem Leben hinterlassen?',
      'Gibt es noch etwas, das Sie sagen möchten – vielleicht etwas, das bisher keinen Platz hatte?',
      'Wenn Sie an diesen Menschen denken: Was soll aus Ihrer Sicht in Erinnerung bleiben?',
    ],
  },
]

// Legt den Katalog an bzw. zieht Fragen und Kategorie auf den Stand im Code
// nach und gibt seine id zurueck. Gleicher Name → dieselbe Zeile, damit die
// Zuordnung bestehender Buecher erhalten bleibt.
async function ensureMemorialCatalog(supabase) {
  const { data: found } = await supabase
    .from('question_catalogs').select('id, product_categories, chapters').eq('name', CATALOG_NAME).maybeSingle()
  if (found && found.id) {
    const cats = Array.isArray(found.product_categories) ? found.product_categories : []
    const patch = {}
    if (!cats.includes(MEMORIAL)) patch.product_categories = [...cats, MEMORIAL]
    if (JSON.stringify(found.chapters) !== JSON.stringify(CATALOG_CHAPTERS)) patch.chapters = CATALOG_CHAPTERS
    if (Object.keys(patch).length) await supabase.from('question_catalogs').update(patch).eq('id', found.id)
    return found.id
  }
  const { data, error } = await supabase.from('question_catalogs')
    .insert({ name: CATALOG_NAME, product_categories: [MEMORIAL], chapters: CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

module.exports = { MEMORIAL, CATALOG_NAME, CATALOG_CHAPTERS, ensureMemorialCatalog }
