// api/_lib/career.js
// Backend-Teil der Produktkategorie „Lebenslauf" (`career`).
//
// Aufbau exakt wie api/_lib/lifework.js und api/_lib/mamazone.js: EIN
// Standard-Fragenkatalog als Zeile in question_catalogs, beim ersten Bedarf
// angelegt und danach im Dashboard normal bearbeitbar. Die Kategorie ist eine
// Endnutzer-Kategorie — ein Mensch erzählt seinen eigenen Berufsweg, der
// Zugangscode ist seine Berechtigung.
//
// Die Spalte `cv` (jsonb) legt ensureLifeworkSchema() in lifework.js an; sie ist
// dort bewusst mit den übrigen memorials-Spalten zusammengefasst, damit es nur
// EINE Stelle gibt, die das Schema nachzieht.
//
// Der Katalog führt das Interview chronologisch durch den Berufsweg und holt
// anschließend je AVOCA-Dimension Erzählsituationen. Er ist bewusst OHNE
// anlassabhängige Fragen (Bewerbung/Outplacement/Interim) — die kommen aus dem
// Interview-Prompt, weil sie von `intake.focus` abhängen und ein Katalog für
// alle vier Anlässe gilt.

const { pool } = require('./store')

const CAREER = 'career'
const CATALOG_NAME = 'Lebenslauf – Standardfragen'

// Die Fragen sind in Du-Form notiert; die Anrede (Du/Sie) regelt der
// Interview-Prompt anhand der Wahl des Endnutzers, die KI formuliert um.
const CATALOG_CHAPTERS = [
  { title: 'Einstieg und Selbstbild', questions: [
    'Wie würdest du dich selbst beschreiben – jenseits von Titeln und Stationen?',
    'Wie würde dich ein guter Freund oder eine gute Freundin in drei Sätzen beschreiben?',
    'Welche Eigenschaft an dir schätzen Kolleginnen und Kollegen am meisten?',
    'Welche Eigenschaft steht dir manchmal im Weg?',
    'Womit verbringst du bei der Arbeit am liebsten deine Zeit?',
  ] },
  { title: 'Der Anfang', questions: [
    'Wo hat dein Berufsleben angefangen, und was hat dich dorthin gebracht?',
    'Welche Ausbildung oder welches Studium steht am Beginn – und warum diese Wahl?',
    'Gab es einen Menschen, der deinen beruflichen Weg früh geprägt hat?',
    'Was hast du in den ersten Berufsjahren gelernt, das heute noch trägt?',
  ] },
  { title: 'Die Stationen', questions: [
    'Lass uns deine Stationen der Reihe nach durchgehen: Wo ging es nach dem Anfang weiter?',
    'Was war dort deine Aufgabe – wofür warst du verantwortlich?',
    'Was hast du an dieser Station verändert oder aufgebaut?',
    'Wie groß war dein Verantwortungsbereich – Team, Budget, Region, Produkt?',
    'Woran hast du gemerkt, dass es gut lief?',
    'Warum bist du gegangen, und wie ging es weiter?',
    'Gab es Brüche, Umwege oder Pausen in deinem Weg?',
    'Was hast du in diesen Phasen gelernt?',
    'Welche Station war rückblickend die wichtigste, und warum?',
    'Was machst du heute, und seit wann?',
  ] },
  { title: 'Herausforderungen und Entscheidungen', questions: [
    'Was war die größte berufliche Herausforderung deines Lebens, und wie bist du da durchgekommen?',
    'Welche Art von Problemen löst du besonders gern?',
    'Erzähl von einer Entscheidung, die du heute anders treffen würdest.',
    'Wann hast du zuletzt etwas verantwortet, das schiefgegangen ist – und was ist daraus geworden?',
    'Welche Zusammenarbeit ist dir besonders in Erinnerung geblieben?',
  ] },
  { title: 'Agilität', questions: [
    'Erzähl von einem Moment, in dem du einen Plan komplett umgeworfen hast.',
    'Wann hast du zuletzt etwas nach dem ersten Versuch grundlegend anders gemacht?',
    'Wie bist du mit einer Veränderung umgegangen, die du dir nicht ausgesucht hast?',
  ] },
  { title: 'Vision', questions: [
    'Wie sieht dein Arbeitsfeld in zehn Jahren aus, und was tust du heute dafür?',
    'Erzähl von etwas, das du angestoßen hast, bevor andere den Bedarf sahen.',
    'Wofür hast du andere gewinnen müssen, bevor es losgehen konnte?',
  ] },
  { title: 'Offenheit', questions: [
    'Wann hat dich zuletzt jemand von etwas überzeugt, das du vorher anders gesehen hast?',
    'Erzähl von einer Zusammenarbeit mit jemandem, der ganz anders tickt als du.',
    'Wie gehst du mit Widerspruch um, der öffentlich kommt?',
  ] },
  { title: 'Curiosity', questions: [
    'Was hast du in den letzten zwölf Monaten gelernt, ohne dass es jemand verlangt hat?',
    'Welche Frage beschäftigt dich gerade, für die du noch keine Antwort hast?',
    'Wie kommst du an Wissen, das in deinem Umfeld niemand hat?',
  ] },
  { title: 'Ambiguitätstoleranz', questions: [
    'Erzähl von einer Situation, in der du handeln musstest, obwohl vieles unklar war.',
    'Wie bist du mit einer Phase umgegangen, in der du nicht wusstest, ob deine Entscheidung richtig war?',
    'Wann hast du eine Entscheidung bewusst offen gelassen – und was hat das gekostet?',
  ] },
  { title: 'Ausblick', questions: [
    'Welche Aufgabe würdest du als Nächstes gern übernehmen?',
    'Was soll in deiner nächsten Station anders sein als bisher?',
    'Welche deiner Stärken kam zuletzt zu kurz?',
    'Gibt es etwas aus deinem Berufsweg, das wir noch nicht besprochen haben und das dazugehört?',
  ] },
]

// Der Standard-Fragenkatalog der Kategorie. Existiert er schon, wird die
// vorhandene Zeile weiterverwendet — der Manager darf ihn im Dashboard
// überarbeiten, ohne dass wir seine Änderungen überschreiben.
async function ensureCareerCatalog(supabase) {
  const { data: found } = await supabase
    .from('question_catalogs').select('id').eq('name', CATALOG_NAME).maybeSingle()
  if (found?.id) return found.id

  const { data, error } = await supabase
    .from('question_catalogs')
    .insert({ name: CATALOG_NAME, product_categories: [CAREER], chapters: CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

// Nur der Vollständigkeit halber exportiert: Die Spalte selbst zieht
// ensureLifeworkSchema() nach (eine Stelle für alle memorials-Spalten).
async function ensureCareerSchema() {
  await pool().query(`alter table memorials add column if not exists cv jsonb`).catch(() => {})
}

module.exports = { CAREER, CATALOG_NAME, CATALOG_CHAPTERS, ensureCareerCatalog, ensureCareerSchema }
