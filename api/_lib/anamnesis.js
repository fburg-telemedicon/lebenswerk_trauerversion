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
    'Ich gehe jetzt einige häufige Vorerkrankungen einzeln mit Ihnen durch. Haben oder hatten Sie Bluthochdruck?',
    'Haben oder hatten Sie Diabetes (Zuckerkrankheit)?',
    'Haben oder hatten Sie eine Herzerkrankung (z. B. Herzinfarkt, koronare Herzkrankheit)?',
    'Hatten Sie schon einmal einen Schlaganfall?',
    'Haben oder hatten Sie eine Lungenerkrankung (z. B. Asthma, COPD)?',
    'Haben oder hatten Sie eine Nieren-, Leber- oder Schilddrüsenerkrankung?',
    'Haben oder hatten Sie eine Krebserkrankung?',
    'Haben oder hatten Sie eine psychische Erkrankung (z. B. Depression, Angststörung)?',
    'Haben oder hatten Sie Rheuma oder eine andere Gelenkerkrankung?',
    'Hatten Sie schon einmal eine Thrombose oder Embolie?',
    'Wurden Sie schon einmal operiert? Wenn ja, woran und wann?',
    'Gibt es sonst noch eine Erkrankung, die wir bisher nicht besprochen haben?',
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
    'Nun zu Erkrankungen in Ihrer Familie (Eltern, Geschwister). Gab es Herzinfarkte oder Herz-Kreislauf-Erkrankungen?',
    'Gab es Schlaganfälle?',
    'Gibt es Bluthochdruck?',
    'Gibt es Diabetes?',
    'Gibt es Krebserkrankungen?',
    'Gibt es psychische Erkrankungen?',
    'Sind Erbkrankheiten bekannt?',
    'Gibt es sonst noch eine Erkrankung in der Familie, die wir nicht genannt haben?',
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
  // Abschluss-Check: gezielt nach vergessenen/ergänzenden Punkten fragen, damit
  // nichts übersehen wird, das nicht auf der Liste stand.
  { title: 'Vergessenes und Ergänzungen', questions: [
    'Wir sind das Wichtigste durchgegangen. Wenn Sie in Gedanken unser Gespräch noch einmal durchgehen: Fällt Ihnen etwas ein, das wir vergessen haben oder das Sie ergänzen möchten?',
    'Gibt es weitere Beschwerden oder Symptome, die wir bisher nicht besprochen haben – auch scheinbar kleine?',
    'Nehmen Sie noch weitere Medikamente, Präparate oder Behandlungen, die wir noch nicht erfasst haben?',
    'Gab es frühere Rehabilitationen, Kuren oder wichtige Behandlungen, die wir noch nicht genannt haben?',
    'Möchten Sie den behandelnden Fachleuten abschließend noch etwas mitteilen, das bisher nicht zur Sprache kam?',
  ] },
]

// Der Standard-Fragebogen der Kategorie. Existiert er noch nicht, wird er angelegt;
// sonst wird die vorhandene Zeile weiterverwendet — der Admin darf ihn im Dashboard
// also überarbeiten, ohne dass wir seine Änderungen überschreiben. (Muster wie
// ensureLifeworkCatalog.)
async function ensureAnamnesisCatalog(supabase) {
  // Der Standard-Fragebogen ist CODE-verwaltet (medizinischer Standard): Inhalt in
  // ANAMNESIS_CATALOG_CHAPTERS pflegen, NICHT im Dashboard (Dashboard-Änderungen an
  // dieser einen Zeile werden bei der nächsten Ausführung überschrieben).
  // Bewusst KEIN .maybeSingle(): das wirft, sobald (durch frühere Rennen) mehrere
  // gleichnamige Zeilen existieren. Die älteste ist die kanonische Zeile; ihre
  // Kapitel werden mit dem Code synchronisiert, damit bestehende Bücher (die auf
  // dieselbe catalog_id zeigen) die aktualisierten Fragen bekommen.
  const { data: rows } = await supabase
    .from('question_catalogs').select('id').eq('name', ANAMNESIS_CATALOG_NAME)
    .order('created_at', { ascending: true })
  if (Array.isArray(rows) && rows.length && rows[0]?.id) {
    const id = rows[0].id
    await supabase.from('question_catalogs')
      .update({ product_categories: ['anamnesis'], chapters: ANAMNESIS_CATALOG_CHAPTERS })
      .eq('id', id)
    return id
  }

  const { data, error } = await supabase
    .from('question_catalogs')
    .insert({ name: ANAMNESIS_CATALOG_NAME, product_categories: ['anamnesis'], chapters: ANAMNESIS_CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

// ────────────────────────────────────────────────────────────────────────────
// ANAMNESE KVSW — Aufnahmefragebogen für die Krankenhausaufnahme (Klinikverbund
// Südwest). Technisch identisch zum Reha-Standardfragebogen (eigene Zeile in
// question_catalogs, product_categories:['anamnesis_kvsw']), inhaltlich auf die
// Akutaufnahme angepasst: Aufnahmegrund/geplanter Eingriff statt Reha-Anlass,
// Medikamente mit Blutverdünner-Frage, Versorgung nach Entlassung, Patienten-
// verfügung/Infektionen — statt MBOR/Wiedereingliederung und Reha-Zielen.
// ────────────────────────────────────────────────────────────────────────────

const ANAMNESIS_KVSW_CATALOG_NAME = 'Anamnese KVSW – Aufnahmefragebogen'

const ANAMNESIS_KVSW_CATALOG_CHAPTERS = [
  { title: 'Aufnahmegrund und Einweisung', questions: [
    'Was ist der Grund für Ihre Aufnahme im Krankenhaus?',
    'Kommen Sie akut (z. B. über die Notaufnahme) oder handelt es sich um eine geplante Aufnahme?',
    'Ist ein bestimmter Eingriff oder eine Operation vorgesehen? Wenn ja, welche?',
    'Wer hat Sie eingewiesen oder überwiesen (z. B. Notaufnahme, Hausärztin/Hausarzt, Facharztpraxis)?',
    'Welche Diagnose wurde Ihnen für diese Aufnahme genannt?',
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
    'Ich gehe jetzt einige häufige Vorerkrankungen einzeln mit Ihnen durch. Haben oder hatten Sie Bluthochdruck?',
    'Haben oder hatten Sie Diabetes (Zuckerkrankheit)?',
    'Haben oder hatten Sie eine Herzerkrankung (z. B. Herzinfarkt, koronare Herzkrankheit)?',
    'Hatten Sie schon einmal einen Schlaganfall?',
    'Haben oder hatten Sie eine Lungenerkrankung (z. B. Asthma, COPD)?',
    'Haben oder hatten Sie eine Nieren-, Leber- oder Schilddrüsenerkrankung?',
    'Haben oder hatten Sie eine Krebserkrankung?',
    'Haben oder hatten Sie eine psychische Erkrankung (z. B. Depression, Angststörung)?',
    'Haben oder hatten Sie Rheuma oder eine andere Gelenkerkrankung?',
    'Hatten Sie schon einmal eine Thrombose oder Embolie?',
    'Wurden Sie schon einmal operiert? Wenn ja, woran und wann?',
    'Gibt es sonst noch eine Erkrankung, die wir bisher nicht besprochen haben?',
  ] },
  { title: 'Medikamente (inkl. Blutverdünner)', questions: [
    'Welche Medikamente nehmen Sie derzeit regelmäßig ein?',
    'Wissen Sie die Dosierung und wie oft Sie diese einnehmen?',
    'Nehmen Sie blutverdünnende oder gerinnungshemmende Mittel ein (z. B. Marcumar, ASS/Aspirin, Eliquis, Xarelto, Clopidogrel)?',
    'Nehmen Sie zusätzlich Schmerzmittel oder frei verkäufliche Mittel, Vitamine oder pflanzliche Präparate?',
  ] },
  { title: 'Allergien und Unverträglichkeiten', questions: [
    'Sind bei Ihnen Allergien bekannt (z. B. gegen Medikamente, Lebensmittel, Kontaktstoffe, Latex, Röntgenkontrastmittel)?',
    'Gibt es Dinge, die Sie nicht vertragen – und wie äußert sich das?',
  ] },
  { title: 'Vegetative Anamnese', questions: [
    'Wie sind Appetit und Gewicht in letzter Zeit – gab es Veränderungen?',
    'Wie schlafen Sie?',
    'Gibt es Probleme mit der Verdauung, dem Stuhlgang oder dem Wasserlassen?',
    'Rauchen Sie, und trinken Sie Alkohol? Wenn ja, wie viel und wie oft?',
  ] },
  { title: 'Familienanamnese', questions: [
    'Nun zu Erkrankungen in Ihrer Familie (Eltern, Geschwister). Gab es Herzinfarkte oder Herz-Kreislauf-Erkrankungen?',
    'Gab es Schlaganfälle?',
    'Gibt es Bluthochdruck?',
    'Gibt es Diabetes?',
    'Gibt es Krebserkrankungen?',
    'Gibt es psychische Erkrankungen?',
    'Sind Erbkrankheiten bekannt?',
    'Gibt es sonst noch eine Erkrankung in der Familie, die wir nicht genannt haben?',
  ] },
  { title: 'Wohn- und Lebenssituation', questions: [
    'Wie sieht Ihre Wohn- und Lebenssituation aus – leben Sie allein oder mit anderen zusammen?',
    'Welchen Beruf üben Sie aus, und arbeiten Sie derzeit?',
    'Wer versorgt Sie zu Hause, und ist die Versorgung nach der Entlassung gesichert?',
    'Gibt es einen Pflegegrad oder eine Betreuung, oder benötigen Sie nach dem Aufenthalt voraussichtlich Unterstützung?',
  ] },
  { title: 'Alltag, Selbstständigkeit und Hilfsmittel', questions: [
    'Wie gut kommen Sie im Alltag allein zurecht (Körperpflege, An- und Auskleiden, Haushalt, Einkaufen)?',
    'Nutzen Sie Hilfsmittel (z. B. Gehstock, Rollator, Brille, Hörgerät)?',
    'Wobei brauchen Sie derzeit Unterstützung?',
  ] },
  { title: 'Seelische Situation', questions: [
    'Wie geht es Ihnen seelisch mit Ihrer Erkrankung und dem bevorstehenden Aufenthalt?',
    'Fühlen Sie sich in letzter Zeit häufiger niedergeschlagen, ängstlich oder angespannt?',
    'Haben Sie Menschen in Ihrem Umfeld, die Sie unterstützen?',
  ] },
  { title: 'Besonderheiten für den Aufenthalt', questions: [
    'Haben Sie eine Patientenverfügung oder eine Vorsorgevollmacht? Wenn ja, ist sie hinterlegt oder bringen Sie sie mit?',
    'Ist bei Ihnen eine Infektion oder Besiedlung bekannt (z. B. MRSA oder ein anderer resistenter Keim)?',
    'Benötigen Sie während des Aufenthalts oder bei der Entlassung besondere Hilfen oder haben Sie besondere Bedürfnisse?',
    'Was möchten Sie mit diesem Aufenthalt erreichen, und welche Fragen oder Erwartungen haben Sie an das Behandlungsteam?',
  ] },
  { title: 'Vergessenes und Ergänzungen', questions: [
    'Wir sind das Wichtigste durchgegangen. Wenn Sie in Gedanken unser Gespräch noch einmal durchgehen: Fällt Ihnen etwas ein, das wir vergessen haben oder das Sie ergänzen möchten?',
    'Gibt es weitere Beschwerden oder Symptome, die wir bisher nicht besprochen haben – auch scheinbar kleine?',
    'Nehmen Sie noch weitere Medikamente, Präparate oder Behandlungen, die wir noch nicht erfasst haben?',
    'Gab es frühere Krankenhausaufenthalte oder wichtige Behandlungen, die wir noch nicht genannt haben?',
    'Möchten Sie dem Behandlungsteam abschließend noch etwas mitteilen, das bisher nicht zur Sprache kam?',
  ] },
]

// Standard-Fragebogen der KVSW-Anamnese (Muster wie ensureAnamnesisCatalog):
// CODE-verwaltet — Inhalt hier pflegen, nicht im Dashboard.
async function ensureAnamnesisKvswCatalog(supabase) {
  const { data: rows } = await supabase
    .from('question_catalogs').select('id').eq('name', ANAMNESIS_KVSW_CATALOG_NAME)
    .order('created_at', { ascending: true })
  if (Array.isArray(rows) && rows.length && rows[0]?.id) {
    const id = rows[0].id
    await supabase.from('question_catalogs')
      .update({ product_categories: ['anamnesis_kvsw'], chapters: ANAMNESIS_KVSW_CATALOG_CHAPTERS })
      .eq('id', id)
    return id
  }
  const { data, error } = await supabase
    .from('question_catalogs')
    .insert({ name: ANAMNESIS_KVSW_CATALOG_NAME, product_categories: ['anamnesis_kvsw'], chapters: ANAMNESIS_KVSW_CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

module.exports = {
  ANAMNESIS_CATALOG_NAME, ANAMNESIS_CATALOG_CHAPTERS, ensureAnamnesisCatalog,
  ANAMNESIS_KVSW_CATALOG_NAME, ANAMNESIS_KVSW_CATALOG_CHAPTERS, ensureAnamnesisKvswCatalog,
}
