// api/_lib/precaution.js
// Backend-Teil der Produktkategorie „Vorsorgevollmacht" (`precaution`).
//
// Aufbau wie api/_lib/career.js: EIN Standard-Fragenkatalog als Zeile in
// question_catalogs, beim ersten Bedarf angelegt und danach im Dashboard normal
// bearbeitbar. Endnutzer-Kategorie — ein Mensch beantwortet die Fragen, aus
// denen SEINE EIGENE Vorsorgen-Mappe entsteht; der Zugangscode ist seine
// Berechtigung.
//
// DER UNTERSCHIED ZUR VORSORGEMAPPE DES LEBENSWERKS (src/provisionFolder.js):
// Dort leitet die KI Wünsche aus einer erzählten Lebensgeschichte ab — sie darf
// deshalb niemanden benennen und keine Behandlungsentscheidung treffen. HIER
// wird jede Angabe ausdrücklich für dieses Dokument erfragt und diktiert. Die
// KI erfindet weiterhin nichts; sie schreibt nur auf, was gesagt wurde.
//
// Der Katalog folgt der „VORSORGEN! Mappe" der Deutschen PalliativStiftung
// (13. Auflage, Rechtslage 2026, Stand 09/2026) — Reihenfolge und Zuschnitt der
// Fragen entsprechen ihren acht Formularen, damit aus den Antworten am Ende
// wirklich jedes Feld gefüllt werden kann und keine Frage ins Leere läuft:
//
//   1 (Vorsorge)Vollmacht · 2 Patientenverfügung · 3 Meine Wertvorstellungen
//   4 Bestattungsverfügung · 5 Palliativ-Ampel · 6 Untervollmacht
//   7 Betreuungsverfügung · 8 Vertreterverfügung
//
// Die Spalte `precaution` (jsonb) legt ensureLifeworkSchema() in lifework.js an
// — eine Stelle für alle memorials-Spalten.
//
// ZWEI DINGE, DIE DIESER KATALOG BEWUSST NICHT TUT:
//  • Er berät nicht. Keine Frage legt eine Antwort nahe, keine erklärt, was
//    „richtig" wäre. Was die einzelnen Festlegungen medizinisch bedeuten,
//    gehört in ein Gespräch mit einer Ärztin oder einem Arzt — darauf weist die
//    Mappe an mehreren Stellen hin.
//  • Er drängt nicht. Zu JEDER Festlegung ist „das soll jemand anders
//    entscheiden" bzw. „dazu möchte ich mich nicht äußern" eine vollwertige
//    Antwort; im Dokument bleibt das Feld dann leer statt falsch angekreuzt.

const { pool } = require('./store')

const PRECAUTION = 'precaution'
const CATALOG_NAME = 'Vorsorgevollmacht – Standardfragen'

// Die Fragen sind in Du-Form notiert; die Anrede (Du/Sie) regelt der
// Interview-Prompt anhand der Wahl des Endnutzers, die KI formuliert um.
const CATALOG_CHAPTERS = [
  { title: 'Wer du bist', questions: [
    'Wie heißt du mit vollem Namen, so wie er in deinem Ausweis steht?',
    'Wann und wo bist du geboren?',
    'Wie lautet deine vollständige Anschrift?',
    'Unter welcher Telefonnummer und E-Mail-Adresse bist du erreichbar?',
    'Hast du schon einmal eine Vorsorgevollmacht, eine Patientenverfügung oder ein Testament gemacht – und wenn ja, wann und wo liegen die Papiere?',
    'Was hat dich dazu gebracht, dich jetzt darum zu kümmern?',
  ] },

  { title: 'Wem du vertraust', questions: [
    'Wen möchtest du bevollmächtigen – wer soll für dich handeln dürfen, wenn du es selbst nicht mehr kannst?',
    'Wie heißt diese Person mit vollem Namen, und wann ist sie geboren?',
    'Wie lautet ihre Anschrift?',
    'Wie ist sie telefonisch und per E-Mail erreichbar?',
    'In welchem Verhältnis steht sie zu dir?',
    'Hast du mit ihr darüber gesprochen, und weiß sie, dass du sie einsetzen möchtest?',
    'Möchtest du eine zweite Person benennen, die einspringt, wenn die erste verhindert ist oder nicht mehr kann?',
    'Wie heißt diese zweite Person, wann ist sie geboren, wo wohnt sie und wie ist sie erreichbar?',
    'Möchtest du noch eine dritte Person benennen?',
    'Wenn du mehrere Personen benennst: Soll jede von ihnen allein für dich handeln dürfen, oder nur alle gemeinsam?',
    'Gibt es einen Menschen, der auf keinen Fall für dich entscheiden soll?',
  ] },

  { title: 'Wofür die Vollmacht gelten soll', questions: [
    'Soll die bevollmächtigte Person über deine Gesundheit und deine Pflege entscheiden dürfen – also mit Ärzten sprechen, in Behandlungen einwilligen und Pflege organisieren?',
    'Soll sie auch dann entscheiden dürfen, wenn eine Behandlung lebensgefährlich ist oder das Unterlassen zu deinem Tod führen kann? (Das ist ein eigener Punkt, § 1829 BGB – ohne ihn gilt die Vollmacht genau in diesen Fällen nicht.)',
    'Soll sie bestimmen dürfen, wo du wohnst – deine Wohnung kündigen, den Haushalt auflösen, einen Heimvertrag abschließen?',
    'Soll sie auch über eine geschlossene Unterbringung oder über Bettgitter, Gurte und ähnliche Maßnahmen entscheiden dürfen? (Ebenfalls ein eigener Punkt, § 1831 BGB.)',
    'Soll sie dein Geld verwalten dürfen – Konten führen, Zahlungen leisten, Verträge schließen und kündigen?',
    'Soll sie auch über Grundstücke oder Immobilien verfügen dürfen? (Dafür ist zwingend ein Notartermin nötig.)',
    'Soll sie Schenkungen machen dürfen, wie es auch ein Betreuer dürfte – etwa die üblichen Geschenke zu Geburtstagen und Festen?',
    'Soll sie dich gegenüber Behörden, Versicherungen, Renten- und Sozialleistungsträgern vertreten dürfen?',
    'Soll sie dich vor Gericht vertreten dürfen?',
    'Soll sie deine Post entgegennehmen und öffnen dürfen und über Telefon- und Internetverträge entscheiden?',
    'Soll sie auf deine Konten im Internet, dein Handy und deinen Computer zugreifen und entscheiden dürfen, was damit passiert?',
    'Soll sie die Vollmacht an jemanden weitergeben dürfen (Untervollmacht)?',
    'Soll die Vollmacht über deinen Tod hinaus gelten?',
    'Soll die bevollmächtigte Person auch deine Bestattung nach deinen Wünschen regeln?',
    'Gibt es etwas, das sie ausdrücklich NICHT tun können soll?',
  ] },

  { title: 'Wie entschieden werden soll', questions: [
    'Wie soll die bevollmächtigte Person mit dir umgehen, solange du dich noch äußern kannst?',
    'Wer soll bei wichtigen Entscheidungen einbezogen werden – und wer ausdrücklich nicht?',
    'Soll sie dir oder jemandem aus deiner Familie Rechenschaft über das ablegen, was sie tut?',
    'Wie soll mit deinem Geld umgegangen werden – eher sparsam oder eher großzügig, und wofür darf es ausgegeben werden?',
    'Was ist dir in deinem Alltag so wichtig, dass es auch dann beachtet werden soll, wenn du es nicht mehr sagen kannst?',
    'Gibt es etwas, das dir Angst macht, wenn du an eine solche Situation denkst?',
  ] },

  { title: 'Falls doch ein Gericht entscheidet', questions: [
    'Wenn trotz der Vollmacht ein Gericht einen Betreuer für dich bestellen müsste: Wen sollte das Gericht bestellen?',
    'Wie heißt diese Person mit vollem Namen, wo wohnt sie, und wie ist sie erreichbar?',
    'Wen soll das Gericht auf keinen Fall zum Betreuer bestellen?',
    'Welche Wünsche hast du an die Art, wie eine Betreuung geführt wird?',
    'Wenn du in ein Heim müsstest: Welches käme in Frage, welches auf keinen Fall?',
  ] },

  { title: 'In welchen Situationen deine Patientenverfügung gelten soll', questions: [
    'Soll deine Patientenverfügung gelten, wenn du nach ärztlicher Feststellung unabwendbar im Sterben liegst?',
    'Soll sie gelten, wenn du im Endstadium einer unheilbaren, tödlich verlaufenden Krankheit bist – auch wenn noch nicht absehbar ist, wann du stirbst?',
    'Soll sie gelten, wenn du nach einer Hirnschädigung so weit nicht mehr entscheiden und dich verständigen kannst, dass ein Leben, in dem du dich äußern kannst, nicht mehr möglich ist?',
    'Soll sie auch dann gelten, wenn diese Fähigkeit unwiederbringlich vollständig verloren ist?',
    'Ist dir bewusst, dass in solchen Zuständen die Fähigkeit zu empfinden erhalten sein kann und ein Erwachen sehr unwahrscheinlich, aber nicht ausgeschlossen ist – und bleibt es trotzdem bei deiner Antwort?',
    'Soll sie gelten, wenn du durch einen weit fortgeschrittenen Abbau des Gehirns, etwa bei Demenz, auch mit Hilfe nicht mehr essen und trinken kannst?',
    'Gibt es eine andere Lebenslage, in der deine Verfügung gelten soll? Beschreibe sie bitte.',
    'Soll deine Verfügung erst in diesen Situationen gelten – oder schon jetzt, also auch bei einem Schlaganfall, einem Herzinfarkt oder einer schweren Lungenentzündung?',
  ] },

  { title: 'Was behandelt werden soll und was nicht', questions: [
    'Möchtest du in den genannten Situationen ins Krankenhaus eingewiesen werden, wenn du sonst vielleicht stirbst?',
    'Oder möchtest du schon jetzt auf keinen Fall mehr ins Krankenhaus, unabhängig von diesen Situationen?',
    'Sollen alle medizinisch möglichen Behandlungen gemacht werden, um dein Leben zu erhalten?',
    'Möchtest du dein Lebensende möglichst bewusst erleben, wenn es geht?',
    'Möchtest du Mittel bekommen, die dein Bewusstsein dämpfen, wenn es zur Linderung nötig ist?',
    'Würdest du hinnehmen, wenn solche Mittel dein Leben in seltenen Fällen verkürzen?',
    'Sollen Hunger und Durst nur auf natürlichem Weg gestillt werden, mit Hilfe beim Essen und Trinken und guter Mundpflege?',
    'Oder wünschst du künstliche Ernährung und Flüssigkeit, etwa über eine Magensonde oder einen Zugang in die Vene?',
    'Wünschst du bei einem Herz-Kreislauf-Stillstand Notruf und sofortige Wiederbelebung?',
    'Soll der Rettungsdienst, wenn er da ist, über deine Ablehnung einer Wiederbelebung informiert werden?',
    'Wünschst du künstliche Beatmung oder Sauerstoff, wenn das dein Leben verlängern kann?',
    'Wünschst du eine Blutwäsche, also Dialyse, wenn das dein Leben verlängern kann?',
    'Wünschst du Antibiotika, wenn sie dein Leben verlängern können?',
    'Wünschst du Blut oder Blutbestandteile, wenn das dein Leben verlängern kann?',
    'Wünschst du einen Herzschrittmacher oder einen Defibrillator, wenn das dein Leben verlängern kann?',
    'Falls du bereits einen Schrittmacher oder Defibrillator hast: Soll er rechtzeitig abgeschaltet werden?',
    'Möchtest du stattdessen, dass alle diese Maßnahmen nicht zur Lebensverlängerung eingesetzt werden und nur noch gelindert wird – bis hin zu einer palliativen Sedierung?',
    'Gibt es Behandlungen, die du ausdrücklich wünschst und die wir noch nicht besprochen haben?',
    'Verzichtest du auf eine weitere ärztliche Aufklärung zu dem, was du hier festlegst?',
  ] },

  { title: 'Organspende, Geltung und Durchsetzung', questions: [
    'Stimmst du einer Entnahme deiner Organe und Gewebe zur Transplantation zu, nachdem dein Tod ärztlich festgestellt wurde?',
    'Gibt es Organe oder Gewebe, die du ausnehmen möchtest – oder nur bestimmte, die du freigeben möchtest?',
    'Wenn für eine Organspende Maßnahmen nötig wären, die du in deiner Patientenverfügung abgelehnt hast: Was soll dann Vorrang haben – deine Bereitschaft zur Organspende oder deine Patientenverfügung?',
    'Hast du einen Organspendeausweis?',
    'Wenn es dauerhaft verschiedene Meinungen darüber gibt, was du wolltest: Auf wessen Auffassung soll es besonders ankommen – die der bevollmächtigten Person, die der behandelnden Ärztin oder eines anderen Menschen?',
    'Wenn Beteiligte deinen Willen nicht befolgen wollen: Erwartest du, dass für eine andere Behandlung oder eine andere Unterbringung gesorgt wird?',
    'Hast du dich vor diesen Festlegungen beraten lassen – und wenn ja, von wem?',
    'Ist dir bewusst, dass du all das jederzeit ändern und widerrufen kannst, und triffst du diese Entscheidungen ohne Druck von außen?',
  ] },

  { title: 'Was dir wichtig ist', questions: [
    'Wo möchtest du sterben, wenn es sich einrichten lässt – zu Hause, in einem Hospiz, auf einer Palliativstation oder im Krankenhaus?',
    'Möchtest du seelsorglichen Beistand?',
    'Möchtest du hospizliche Begleitung?',
    'Welche Menschen sollen in dieser Zeit bei dir sein – und gibt es jemanden, der nicht dabei sein soll?',
    'Gehörst du einer Glaubensgemeinschaft an, und spielt sie dabei eine Rolle?',
    'Was gehört zu deinem Leben, das jemand wissen muss, der dich pflegt und nicht kennt – Gewohnheiten, Vorlieben, Abneigungen?',
    'Magst du es eher warm oder kühl, eher ruhig oder eher Menschen um dich?',
    'Was tut dir gut, wenn es dir schlecht geht?',
    'Wovor hast du Angst, wenn du an Krankheit und Sterben denkst?',
    'Was bedeutet Würde für dich ganz konkret?',
    'Gibt es Tiere, Pflanzen oder Dinge, um die sich jemand kümmern müsste?',
    'Was möchtest du den Menschen sagen, die später für dich entscheiden müssen?',
  ] },

  { title: 'Deine Bestattung', questions: [
    'Möchtest du eine Erdbestattung im Sarg, eine Feuerbestattung mit Urne, eine Reerdigung – oder sollen das andere entscheiden?',
    'Wo sollst du beigesetzt werden – auf einem Friedhof, im Meer, in einem Begräbniswald oder an einem anderen Ort?',
    'Welche Grabart wünschst du dir – Wahlgrab, Reihengrab, grüne Wiese, Urnenwand oder Baumgrab?',
    'Weißt du den Ort oder den Friedhof schon genau?',
    'Welche Abschiedsfeier wünschst du dir – eine weltliche, eine religiöse, eine Lebensfeier oder gar keine?',
    'In welchem Rahmen soll sie stattfinden – engster Familienkreis, erweiterter Kreis aus Familie und Freunden oder öffentlich?',
    'Möchtest du eine Rede, und wenn ja: von wem?',
    'Welche Musik soll bei deinem Abschied gespielt werden?',
    'Hast du besondere Wünsche zu Trauerkarten, Anzeigen, Aufbahrung, Blumen, Grabmal oder Grabpflege?',
    'Hast du mit einem Bestattungsinstitut schon etwas geregelt oder eine Sterbegeldversicherung?',
    'Wer soll sich um Trauerfeier, Beisetzung und Grabpflege kümmern?',
    'Gibt es etwas, das an deinem Abschied auf keinen Fall vorkommen soll?',
  ] },

  { title: 'Für den Notfall und zum Schluss', questions: [
    'Wenn im Notfall jemand an dein Bett kommt, der dich nicht kennt: Soll er sofort alles medizinisch Mögliche tun, nur gut erreichbare Ziele behandeln, oder zuerst innehalten und lindern?',
    'Soll bei Bedarf eine Krankenhauseinweisung erfolgen?',
    'Wo sollen deine Vorsorgedokumente liegen, damit sie im Ernstfall gefunden werden?',
    'Wer soll eine Kopie bekommen?',
    'Möchtest du deine Vollmacht im Zentralen Vorsorgeregister eintragen lassen?',
    'Wer soll im Notfall als Erstes angerufen werden – Name und Handynummer?',
    'Gibt es etwas, das wir noch nicht besprochen haben und das in deine Vorsorge gehört?',
  ] },
]

// Der Standard-Fragenkatalog der Kategorie. Existiert er schon, wird die
// vorhandene Zeile weiterverwendet — der Manager darf ihn im Dashboard
// überarbeiten, ohne dass wir seine Änderungen überschreiben.
async function ensurePrecautionCatalog(supabase) {
  const { data: found } = await supabase
    .from('question_catalogs').select('id').eq('name', CATALOG_NAME).maybeSingle()
  if (found?.id) return found.id

  const { data, error } = await supabase
    .from('question_catalogs')
    .insert({ name: CATALOG_NAME, product_categories: [PRECAUTION], chapters: CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

// Nur der Vollständigkeit halber exportiert: Die Spalte selbst zieht
// ensureLifeworkSchema() nach (eine Stelle für alle memorials-Spalten).
async function ensurePrecautionSchema() {
  await pool().query(`alter table memorials add column if not exists precaution jsonb`).catch(() => {})
}

module.exports = { PRECAUTION, CATALOG_NAME, CATALOG_CHAPTERS, ensurePrecautionCatalog, ensurePrecautionSchema }
