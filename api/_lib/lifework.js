// api/_lib/lifework.js
// Alles, was die Produktkategorie „Lebenswerk" (Autobiographie) backend-seitig
// von den anderen Kategorien unterscheidet:
//
//   1. ensureLifeworkSchema()  – die Spalten für Endnutzer-Konten (idempotent).
//   2. ensureLifeworkCatalog() – der Standard-Fragenkatalog (12 Sitzungen à 10
//      Fragen) als Zeile in question_catalogs; wird beim ersten Bedarf angelegt.
//
// Rollen im Projekt: Admin → Manager (app_users) → Beitragende (Interview per
// Einladungslink) → NEU: Endnutzer. Ein Endnutzer ist der Mensch, dessen
// Autobiographie entsteht: Er hat ein eigenes Login (Konto in app_users mit
// is_enduser = true), aber KEIN Dashboard — er landet direkt in seinem Interview.
// `enduser_memorial` bindet das Konto an genau ein Buch, `lang` hält die vom
// Admin vorgegebene Sprache (null = der Endnutzer wählt beim ersten Start selbst).

const { pool } = require('./store')

const LIFEWORK = 'lifework'
const CATALOG_NAME = 'Lebenswerk – Standardfragen'

// Der Katalog aus dem Fragenkatalog-PDF: 12 Sitzungen mit je 10 Fragen.
// Die Du/Sie-Ansprache regelt der Interview-Prompt (der Endnutzer wählt sie beim
// Start) — die Fragen sind hier bewusst in Du-Form notiert und werden von der KI
// natürlich umformuliert.
const CATALOG_CHAPTERS = [
  { title: 'Einleitung und Kindheit', questions: [
    'Welche ersten Erinnerungen aus deiner Kindheit kommen dir in den Sinn?',
    'Wie würdest du deine Eltern und ihre Rollen in deinem Leben beschreiben?',
    'Gab es prägende Werte oder Traditionen in deiner Familie?',
    'Welche Rolle spielten Geschwister oder andere enge Verwandte in deiner Kindheit?',
    'Wie war die Umgebung, in der du aufgewachsen bist, und wie hat sie dich geprägt?',
    'Was war dein Lieblingsort in deiner Kindheit, und warum?',
    'Gab es besondere Ereignisse, die deine frühen Jahre beeinflusst haben?',
    'Welche Hobbys oder Interessen hattest du als Kind?',
    'Wie haben deine Eltern oder andere Bezugspersonen deine Entwicklung gefördert?',
    'Wenn du ein bestimmtes Ereignis aus deiner Kindheit ändern könntest, welches wäre es?',
  ] },
  { title: 'Jugendzeit und Schuljahre', questions: [
    'Wie hast du dich in der Schule gefühlt, und welche Fächer haben dir gefallen?',
    'Gab es Lehrer*innen, die einen besonderen Einfluss auf dich hatten?',
    'Was waren deine größten Erfolge oder Herausforderungen in der Schulzeit?',
    'Wie hast du deine Freizeit in der Jugend verbracht?',
    'Wer waren deine engsten Freunde, und was habt ihr zusammen erlebt?',
    'Gab es ein Ereignis, das deine Persönlichkeit in dieser Zeit geprägt hat?',
    'Hast du in der Jugendzeit von einem bestimmten Beruf oder Lebenstraum geträumt?',
    'Welche Regeln oder Freiheiten gab es zu Hause, und wie hast du sie empfunden?',
    'Wie bist du mit der Pubertät und den Veränderungen in dieser Phase umgegangen?',
    'Gibt es eine prägende Erinnerung aus deiner Jugend, die du heute noch oft erzählst?',
  ] },
  { title: 'Übergang ins Erwachsenenalter', questions: [
    'Wie hast du den Übergang von der Schule in den nächsten Lebensabschnitt erlebt?',
    'Was hat dich bei der Wahl deines ersten Berufs oder Studiums beeinflusst?',
    'Gab es einen Moment, in dem du das Gefühl hattest, erwachsen zu werden?',
    'Welche Personen oder Ereignisse haben dir bei wichtigen Entscheidungen geholfen?',
    'Hast du in dieser Phase Fehler gemacht, aus denen du viel gelernt hast?',
    'Welche Träume oder Ziele hattest du für dein Erwachsenenleben?',
    'Wie war dein erster Job, und was hast du dabei gelernt?',
    'Gab es persönliche Herausforderungen oder Erfolge in dieser Phase?',
    'Wie haben Beziehungen (Freunde, Partner*innen) in dieser Zeit dein Leben geprägt?',
    'Welche Ratschläge würdest du deinem jüngeren Ich geben, wenn du könntest?',
  ] },
  { title: 'Berufliche Laufbahn', questions: [
    'Wie würdest du deinen beruflichen Werdegang zusammenfassen?',
    'Was hat dich in deinem Beruf motiviert oder inspiriert?',
    'Gab es Wendepunkte in deiner Karriere, die besonders entscheidend waren?',
    'Wie bist du mit beruflichen Herausforderungen oder Rückschlägen umgegangen?',
    'Welche Rolle spielte die Arbeit in deinem Leben – eher Mittel zum Zweck oder Leidenschaft?',
    'Gab es eine Tätigkeit oder Aufgabe, die dir im Laufe deines Lebens besonders viel Freude oder Erfüllung gebracht hat?',
    'Welche Personen (Kollegen, Vorgesetzte) haben deine berufliche Laufbahn beeinflusst?',
    'Was war dein stolzester Moment in deiner Karriere?',
    'Hattest du jemals das Gefühl, deine beruflichen Träume verwirklicht zu haben?',
    'Welche Veränderungen im Arbeitsleben hast du im Laufe der Zeit erlebt?',
  ] },
  { title: 'Familienleben', questions: [
    'Wie hast du deine Partnerin bzw. deinen Partner kennengelernt, falls zutreffend?',
    'Welche Bedeutung hatte Familie für dich im Laufe deines Lebens?',
    'Was sind die schönsten Erinnerungen an gemeinsame Zeit mit deiner Familie?',
    'Welche Herausforderungen habt ihr als Familie gemeinsam bewältigt?',
    'Was möchtest du deinen Kindern (oder der nächsten Generation) mitgeben?',
    'Welche Traditionen oder Werte waren dir im Familienleben wichtig?',
    'Wie hat deine Familie dich in schwierigen Zeiten unterstützt?',
    'Was würdest du sagen, ist das Geheimnis einer funktionierenden Beziehung?',
    'Gibt es eine Familiengeschichte, die du immer wieder gerne erzählst?',
    'Was hast du durch deine Familie über dich selbst gelernt?',
  ] },
  { title: 'Persönliche Werte und Überzeugungen', questions: [
    'Was sind die wichtigsten Werte, nach denen du dein Leben ausrichtest?',
    'Wie haben diese Werte sich im Laufe deines Lebens verändert?',
    'Welche Rolle spielt Spiritualität oder Religion in deinem Leben?',
    'Gibt es ein Zitat oder eine Lebensweisheit, die dich besonders geprägt hat?',
    'Welche gesellschaftlichen oder politischen Themen sind dir besonders wichtig?',
    'Wie gehst du mit Menschen um, die andere Überzeugungen haben als du?',
    'Welche Erfahrungen haben deine Werte am stärksten beeinflusst?',
    'Gibt es Entscheidungen, die du aufgrund deiner Überzeugungen getroffen hast?',
    'Wie definierst du für dich selbst Erfolg?',
    'Was möchtest du, dass andere über deine Werte und Überzeugungen wissen?',
  ] },
  { title: 'Herausforderungen und Krisen', questions: [
    'Was war die größte Herausforderung, der du dich je stellen musstest?',
    'Wie hast du schwierige Zeiten gemeistert?',
    'Wer oder was hat dir in Krisensituationen am meisten geholfen?',
    'Gab es Momente, in denen du an dir selbst gezweifelt hast?',
    'Welche Verluste oder Enttäuschungen haben dich geprägt?',
    'Was hast du aus deinen schwierigsten Erfahrungen gelernt?',
    'Gibt es etwas, das du heute anders machen würdest?',
    'Welche Rolle spielte Glaube in herausfordernden Zeiten?',
    'Gibt es ein bestimmtes Ereignis, das rückblickend einen positiven Einfluss hatte, obwohl es damals schwierig war?',
    'Wie hast du es geschafft, nach Krisen wieder Hoffnung zu schöpfen?',
  ] },
  { title: 'Leidenschaften und Hobbys', questions: [
    'Welche Hobbys haben dich in deinem Leben begleitet?',
    'Was hat dich an diesen Aktivitäten besonders begeistert?',
    'Wie haben deine Leidenschaften dein Leben bereichert?',
    'Gibt es kreative Projekte, auf die du besonders stolz bist?',
    'Wie viel Zeit nimmst du dir für deine Hobbys, und warum?',
    'Haben sich deine Interessen im Laufe deines Lebens verändert?',
    'Gab es Momente, in denen du durch ein Hobby neue Freundschaften geschlossen hast?',
    'Wie haben deine Leidenschaften dir in schwierigen Zeiten geholfen?',
    'Gibt es ein Hobby, das du gerne angefangen hättest, aber nie dazu gekommen bist?',
    'Welche Bedeutung hat Entspannung und Freude in deinem Alltag?',
  ] },
  { title: 'Reisen und kulturelle Erfahrungen', questions: [
    'Welche Reise hat dein Leben am meisten beeinflusst, und warum?',
    'Was sind die schönsten Erinnerungen, die du von deinen Reisen hast?',
    'Welche kulturellen Unterschiede haben dich beeindruckt oder inspiriert?',
    'Gibt es ein Land oder einen Ort, an den du immer wieder zurückkehren möchtest?',
    'Was hast du durch das Reisen über dich selbst gelernt?',
    'Gab es Reisen, die dich mit Herausforderungen konfrontiert haben?',
    'Welche Begegnungen mit anderen Menschen sind dir besonders in Erinnerung geblieben?',
    'Gibt es eine Kultur, die du als besonders bereichernd empfunden hast?',
    'Wie haben Reisen dein Weltbild verändert?',
    'Gibt es einen Ort, den du immer wieder besucht hast, und was macht ihn für dich so besonders?',
  ] },
  { title: 'Lebensphilosophie und Weisheiten', questions: [
    'Was sind die wichtigsten Lektionen, die du im Leben gelernt hast?',
    'Was bedeutet für dich ein erfülltes Leben?',
    'Welche Entscheidungen waren rückblickend die besten deines Lebens?',
    'Wie gehst du mit Veränderungen oder Unsicherheiten um?',
    'Gibt es eine bestimmte Philosophie, nach der du dein Leben ausrichtest?',
    'Was würdest du jüngeren Generationen als Rat mitgeben?',
    'Was macht dich stolz auf dein bisheriges Leben?',
    'Wie definierst du Glück?',
    'Gibt es Fehler, die du als wertvoll empfindest, weil du aus ihnen gelernt hast?',
    'Was möchtest du anderen Menschen über das Leben beibringen?',
  ] },
  { title: 'Zukunft und Vermächtnis', questions: [
    'Was möchtest du in der Zukunft noch erreichen?',
    'Wie stellst du dir dein ideales Lebensende vor?',
    'Was möchtest du der Welt hinterlassen?',
    'Welche Botschaft möchtest du zukünftigen Generationen vermitteln?',
    'Gibt es Projekte oder Ideen, die du noch verwirklichen möchtest?',
    'Wie würdest du gerne in Erinnerung bleiben?',
    'Was macht dir Hoffnung für die Zukunft?',
    'Welche Träume sind noch offen?',
    'Wie möchtest du deinen Alltag in der Zukunft gestalten?',
    'Was bedeutet Vermächtnis für dich?',
  ] },
  { title: 'Schlussbetrachtung und offene Fragen', questions: [
    'Gibt es Geschichten oder Details, die wir bisher ausgelassen haben?',
    'Welche Kapitel deines Lebens möchtest du besonders hervorheben?',
    'Gibt es Menschen, die in deiner Biographie nicht fehlen dürfen?',
    'Möchtest du einen bestimmten Stil oder Fokus für das Buch festlegen?',
    'Gibt es Fragen, die du dir selbst gerne stellen würdest?',
    'Wie möchtest du, dass die Leser*innen dein Leben wahrnehmen?',
    'Gibt es bestimmte Ereignisse, die wir genauer beleuchten sollten?',
    'Welche Emotionen oder Gedanken hast du während des Interviews erlebt?',
    'Gibt es jemanden, dem du dieses Buch widmen möchtest?',
    'Wie fühlst du dich am Ende dieses Prozesses?',
  ] },
]

// Spalten für Endnutzer-Konten. Das Projekt kennt keine Migrationsläufe; ein
// vergessenes `psql -f db/lifework.sql` würde Login und Anlage mit 500ern
// quittieren. `if not exists` ist idempotent und kostet im warmen Container
// nichts (Ergebnis wird gemerkt).
let schemaReady = false
async function ensureLifeworkSchema() {
  if (schemaReady) return
  await pool().query(`
    alter table app_users
      add column if not exists is_enduser       boolean not null default false,
      add column if not exists enduser_memorial varchar(6),
      add column if not exists lang             text
  `)
  // Die beiden grafischen Nebenprodukte des Lebenswerks werden als extrahiertes
  // JSON am Buch gespeichert (gezeichnet wird daraus im Browser).
  await pool().query(`
    alter table memorials
      add column if not exists family_tree jsonb,
      add column if not exists life_poster jsonb
  `)
  schemaReady = true
}

// Der Standard-Fragenkatalog der Kategorie. Existiert er noch nicht, wird er
// angelegt; sonst wird die vorhandene Zeile weiterverwendet — der Admin darf ihn
// im Dashboard also überarbeiten, ohne dass wir seine Änderungen überschreiben.
async function ensureLifeworkCatalog(supabase) {
  const { data: found } = await supabase
    .from('question_catalogs').select('id').eq('name', CATALOG_NAME).maybeSingle()
  if (found?.id) return found.id

  const { data, error } = await supabase
    .from('question_catalogs')
    .insert({ name: CATALOG_NAME, product_categories: [LIFEWORK], chapters: CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

module.exports = { LIFEWORK, CATALOG_NAME, CATALOG_CHAPTERS, ensureLifeworkSchema, ensureLifeworkCatalog }
