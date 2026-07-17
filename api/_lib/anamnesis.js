// api/_lib/anamnesis.js
// Backend-Spezifika der Produktkategorie „Anamnese" (ambulante Reha, Vorbild ZAR).
//
// Technik wie beim Lebenswerk-Standardkatalog: ein fester Fragebogen liegt als Zeile
// in `question_catalogs` und ist beim Anlegen wählbar (Default) — der INHALT ist aber
// ein komplett eigener, medizinischer Anamnese-Fragebogen (KEINE Biografie-Fragen).
// Die KI führt das Interview daran entlang (catalogRules in src/categories.js) und
// stellt je Frage bis zu N Vertiefungsfragen; das ärztliche Schema (mehrere
// Beschwerden vollständig erfassen, Schmerz-/Symptomabklärung) steckt zusätzlich im
// Interview-Prompt (ANAMNESIS_SCHEME_RULE) und greift auch im Katalog-Modus.
//
// Fragen sind in „Sie"-Form notiert; die tatsächliche Anrede (Du/Sie) und die
// natürliche, professionelle Umformulierung übernimmt der Interview-Prompt.

const ANAMNESIS_CATALOG_NAME = 'Anamnese – Standardfragebogen'

const ANAMNESIS_CATALOG_CHAPTERS = [
  { title: 'Anlass und Zuweisung', questions: [
    'Was ist der Anlass für Ihre Rehabilitation?',
    'Welche Diagnose wurde Ihnen für die Reha genannt?',
    'Wer hat die Reha veranlasst (z. B. Krankenhaus, Hausärztin/Hausarzt, Kostenträger)?',
    'Waren Sie wegen dieser Erkrankung zuletzt im Krankenhaus oder in Behandlung?',
  ] },
  { title: 'Aktuelle Beschwerden', questions: [
    'Welche Beschwerden stehen für Sie im Moment im Vordergrund?',
    'Falls Sie mehrere Beschwerden haben: Nennen Sie mir bitte jede einzelne und wo genau sie auftritt.',
    'Seit wann bestehen diese Beschwerden, und wie haben sie sich seither entwickelt?',
    'Wie würden Sie die Beschwerden beschreiben (z. B. dumpf, stechend, brennend), und wie stark sind sie auf einer Skala von 0 bis 10?',
    'Wodurch werden die Beschwerden besser und wodurch schlechter?',
    'Wie wirken sich die Beschwerden auf Ihren Alltag aus – was können Sie dadurch nicht mehr wie gewohnt tun?',
  ] },
  { title: 'Vorerkrankungen und Operationen', questions: [
    'Welche Erkrankungen haben oder hatten Sie in der Vergangenheit?',
    'Wurden Sie schon einmal operiert? Wenn ja, woran und wann?',
    'Sind bei Ihnen chronische Erkrankungen bekannt (z. B. Bluthochdruck, Diabetes, Herz- oder Lungenerkrankungen)?',
  ] },
  { title: 'Medikamente', questions: [
    'Welche Medikamente nehmen Sie derzeit regelmäßig ein?',
    'Wissen Sie die Dosierung und wie oft Sie diese einnehmen?',
    'Nehmen Sie zusätzlich Schmerzmittel oder frei verkäufliche Mittel, Vitamine oder pflanzliche Präparate?',
  ] },
  { title: 'Allergien und Unverträglichkeiten', questions: [
    'Sind bei Ihnen Allergien bekannt (z. B. gegen Medikamente, Lebensmittel, Kontaktstoffe)?',
    'Gibt es Dinge, die Sie nicht vertragen – und wie äußert sich das?',
  ] },
  { title: 'Vegetative Anamnese', questions: [
    'Wie sind Appetit und Gewicht in letzter Zeit – gab es Veränderungen?',
    'Wie schlafen Sie?',
    'Gibt es Probleme mit der Verdauung, dem Stuhlgang oder dem Wasserlassen?',
    'Rauchen Sie, und trinken Sie Alkohol? Wenn ja, wie viel und wie oft?',
  ] },
  { title: 'Familienanamnese', questions: [
    'Gibt es in Ihrer Familie Erkrankungen, die häufiger vorkommen (z. B. Herz-Kreislauf, Diabetes, Krebs)?',
  ] },
  { title: 'Sozial- und Berufssituation', questions: [
    'Wie sieht Ihre Wohn- und Lebenssituation aus – leben Sie allein oder mit anderen zusammen?',
    'Welchen Beruf üben Sie aus, und arbeiten Sie derzeit?',
    'Beeinträchtigt Ihre Erkrankung Ihre Arbeitsfähigkeit, und ist Ihr Arbeitsplatz gefährdet?',
    'Wünschen Sie sich Unterstützung bei der Rückkehr an den Arbeitsplatz (Wiedereingliederung)?',
  ] },
  { title: 'Alltag, Selbstständigkeit und Hilfsmittel', questions: [
    'Wie gut kommen Sie im Alltag allein zurecht (Körperpflege, An- und Auskleiden, Haushalt, Einkaufen)?',
    'Nutzen Sie Hilfsmittel (z. B. Gehstock, Rollator, Brille, Hörgerät)?',
    'Wobei brauchen Sie derzeit Unterstützung?',
  ] },
  { title: 'Seelische Belastung', questions: [
    'Wie geht es Ihnen seelisch mit Ihrer Erkrankung und der aktuellen Situation?',
    'Fühlen Sie sich in letzter Zeit häufiger niedergeschlagen, ängstlich oder angespannt?',
    'Haben Sie Menschen in Ihrem Umfeld, die Sie unterstützen?',
  ] },
  { title: 'Reha-Ziele und Erwartungen', questions: [
    'Was möchten Sie mit der Reha vor allem erreichen?',
    'Welche konkreten Ziele für Alltag oder Beruf sind Ihnen wichtig?',
    'Gibt es etwas, das die behandelnden Fachleute unbedingt über Sie wissen sollten?',
  ] },
]

// Der Standard-Fragebogen der Kategorie. Existiert er noch nicht, wird er angelegt;
// sonst wird die vorhandene Zeile weiterverwendet — der Admin darf ihn im Dashboard
// also überarbeiten, ohne dass wir seine Änderungen überschreiben. (Muster wie
// ensureLifeworkCatalog.)
async function ensureAnamnesisCatalog(supabase) {
  const { data: found } = await supabase
    .from('question_catalogs').select('id').eq('name', ANAMNESIS_CATALOG_NAME).maybeSingle()
  if (found?.id) return found.id

  const { data, error } = await supabase
    .from('question_catalogs')
    .insert({ name: ANAMNESIS_CATALOG_NAME, product_categories: ['anamnesis'], chapters: ANAMNESIS_CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

module.exports = { ANAMNESIS_CATALOG_NAME, ANAMNESIS_CATALOG_CHAPTERS, ensureAnamnesisCatalog }
