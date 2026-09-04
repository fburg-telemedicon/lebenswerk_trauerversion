// api/_lib/mamazone.js
// Die Produktkategorie „mamazone Edition" backend-seitig: der Fragenkatalog.
//
// Aufbau wie api/_lib/anamnesis.js (ensureAnamnesisKvswCatalog): Der Katalog
// gehoert zum Produkt, nicht zu einem einzelnen Buch — deshalb steht er im Code
// und wird bei Bedarf idempotent in question_catalogs angelegt bzw.
// aktualisiert. Ohne das haenge das Produkt an einer Zeile, die jemand im
// Dashboard versehentlich loeschen kann.
//
// QUELLE: Fragenapparat von Pia Huebinger (E-Mail vom 03.09.2026), 1:1
// uebernommen — 13 Kapitel, 159 Fragen, Wortlaut und Reihenfolge unveraendert.
// Der Katalog ist in Du-Form notiert; die Anrede-Regel des Interviews stellt ihn
// bei Bedarf auf „Sie" um (wie beim Lebenswerk).

const MAMAZONE = 'mamazone'
const CATALOG_NAME = 'mamazone – Brustkrebs als Teil meiner Lebensgeschichte'

const CATALOG_CHAPTERS = [
  {
    title: 'Mein Leben vor der Erkrankung',
    questions: [
      'Wenn du an die Zeit vor deiner Diagnose denkst: Wie sah ein ganz normaler Tag bei dir aus?',
      'Was hast du damals besonders gern gemacht, wenn du Zeit nur für dich hattest?',
      'Wann hast du dich vor deiner Erkrankung zuletzt so richtig lebendig gefühlt? Was hast du da gemacht?',
      'Worüber konntest du dich richtig freuen?',
      'Was hat dich regelmäßig genervt oder auf die Palme gebracht?',
      'Mit welchen Menschen hast du besonders gern Zeit verbracht – und was habt ihr zusammen gemacht?',
      'Gab es etwas, worauf du damals gerade hingearbeitet oder worauf du dich gefreut hast?',
      'Wenn ich deine beste Freundin oder einen anderen Menschen, der dich sehr gut kennt, gefragt hätte, was typisch für dich ist: Was hätte sie oder er vermutlich erzählt?',
      'Was konntest du schon immer ziemlich gut?',
      'Gab es etwas, bei dem du manchmal selbst über dich lachen musstest?',
      'Was gehörte für dich ganz selbstverständlich zu deinem Leben?',
    ],
  },
  {
    title: 'Meine Geschichte mit Brustkrebs',
    questions: [
      'Wenn du möchtest: Erzähl mir, wie dieser Teil deiner Geschichte begonnen hat.',
      'Was ist dir aus der ersten Zeit besonders in Erinnerung geblieben?',
      'Gibt es einen Moment rund um deine Diagnose, an den du dich besonders deutlich erinnerst?',
      'Was hat sich mit der Diagnose von einem Moment auf den anderen verändert?',
      'Was war zunächst schwer zu begreifen?',
      'Was hat dir Angst gemacht?',
      'Was hat dich wütend gemacht?',
      'Was hat dich überrascht?',
      'Was war vielleicht ganz anders, als du vorher gedacht hattest?',
      'Was möchtest du über diese erste Zeit unbedingt festhalten?',
      'Wenn du an die Zeit seit deiner Diagnose denkst: Welche Momente sind dir besonders im Gedächtnis geblieben?',
      'Gab es einen Moment, in dem du dachtest: Jetzt ist wirklich alles anders?',
    ],
  },
  {
    title: 'Was sich verändert hat – und was geblieben ist',
    questions: [
      'Wenn du einen ganz normalen Tag heute mit einem Tag vor deiner Diagnose vergleichst: Wo merkst du den Unterschied am deutlichsten?',
      'Was in deinem Leben fühlt sich heute anders an?',
      'Gibt es etwas, das vorher selbstverständlich war und es heute nicht mehr ist?',
      'Gibt es etwas, das sich viel weniger verändert hat, als du erwartet hättest?',
      'Gab es seit deiner Diagnose einen Moment, in dem du etwas getan, gesagt oder gedacht hast und dachtest: Ja, das bin einfach ich?',
      'Was an dir erkennst du auch heute noch ganz deutlich als dich selbst?',
      'Gibt es etwas, das dir früher wichtig war und heute kaum noch eine Rolle spielt?',
      'Gibt es etwas, das dir heute wichtiger ist als früher?',
      'Gibt es Seiten von dir, die seit der Erkrankung weniger Raum bekommen?',
      'Gibt es Seiten von dir, die gerade stärker zum Vorschein kommen?',
    ],
  },
  {
    title: 'Mein Körper und mein Erleben',
    questions: [
      'Erinnerst du dich an einen Moment seit deiner Diagnose, in dem dir besonders bewusst wurde: Mein Körper fühlt sich anders an als vorher?',
      'Was hat sich in deiner Beziehung zu deinem Körper verändert?',
      'Gibt es Situationen, in denen dein Körper sich gerade fremd anfühlt?',
      'Gibt es Momente, in denen dein Körper einfach dein Körper ist und der Brustkrebs keine oder kaum eine Rolle spielt?',
      'Gibt es etwas, das dein Körper heute kann und worüber du dich freust?',
      'Welche Gefühle begleiten dich seit der Diagnose besonders häufig?',
      'Gibt es ein Gefühl, das dich selbst überrascht hat?',
      'Gibt es Tage oder Situationen, in denen sich alles ganz anders anfühlt?',
      'Welche Gedanken kommen seit der Erkrankung immer wieder?',
      'Gibt es Gedanken, von denen du manchmal gerne etwas Abstand hättest?',
      'Gibt es etwas, worüber du heute anders denkst als vor deiner Erkrankung?',
      'Gibt es etwas, das du heute anders wahrnimmst als früher – Zeit, Nähe, Berührungen, Natur, Essen, deinen Alltag oder etwas ganz anderes?',
    ],
  },
  {
    title: 'Wie ich mich selbst sehe',
    questions: [
      'Hat die Erkrankung verändert, wie du dich selbst siehst?',
      'Erinnerst du dich an einen Moment, in dem du dachtest: Ich erkenne mich gerade selbst nicht wieder?',
      'Gibt es etwas an deinem früheren Bild von dir, das gerade nicht mehr zu passen scheint?',
      'Gibt es etwas an dir, das du seit der Erkrankung neu kennengelernt hast?',
      'Gibt es Rollen in deinem Leben, in denen du dich weiterhin ganz selbstverständlich als du selbst erlebst?',
      'Erlebst du manchmal, dass andere dich vor allem als Krebspatientin wahrnehmen? Wie ist das für dich?',
      'Welche Worte passen für dich selbst zu dem, was du gerade bist?',
      'Gibt es Bezeichnungen wie „Patientin", „Betroffene", „Survivor" oder „Kämpferin", die sich für dich stimmig anfühlen?',
      'Gibt es solche Bezeichnungen, die überhaupt nicht zu dir passen?',
      'Wenn Brustkrebs nur ein Teil deiner Geschichte ist: Welche anderen Teile sollen auf keinen Fall aus dem Blick geraten?',
    ],
  },
  {
    title: 'Was ich schon geschafft habe',
    questions: [
      'Wenn du an dein Leben vor dem Brustkrebs denkst: Erinnerst du dich an eine Situation, bei der du damals dachtest: Ich weiß wirklich nicht, wie ich das schaffen soll?',
      'Was war damals los?',
      'Wie bist du da durchgekommen?',
      'Wer oder was hat dir dabei geholfen?',
      'Gab es etwas, von dem du vorher nicht wusstest, dass du es kannst?',
      'Hast du schon einmal eine Entscheidung getroffen, die dir sehr schwergefallen ist? Was hat dir damals geholfen?',
      'Erinnerst du dich an eine Zeit, in der etwas ganz anders kam, als du es geplant hattest? Wie bist du damit umgegangen?',
      'Was von dem, was dir früher geholfen hat, steht dir heute noch zur Verfügung?',
      'Gibt es etwas, worauf du dich früher verlassen konntest und das gerade nicht funktioniert?',
      'Was machst du, wenn das, worauf du dich früher verlassen konntest, gerade nicht funktioniert?',
      'Gab es seit deiner Diagnose einen Moment, in dem du selbst überrascht warst, was du geschafft hast?',
    ],
  },
  {
    title: 'Was und wer mich trägt',
    questions: [
      'Denk an einen Moment seit deiner Diagnose, an dem du dich nicht allein gefühlt hast. Was ist da passiert?',
      'Hat seit deiner Diagnose jemand etwas für dich getan, das vielleicht ganz klein war, dir aber viel bedeutet hat?',
      'Gab es jemanden, der genau im richtigen Moment da war?',
      'Bei wem musst du dich nicht erklären?',
      'Wen könntest du an einem richtig schlechten Tag anrufen, ohne vorher überlegen zu müssen, was du sagen sollst?',
      'Wer kann mit dir zusammen sein, ohne gleich etwas lösen zu wollen?',
      'Wer schafft es, dass du manchmal für eine Weile gar nicht an Brustkrebs denkst?',
      'Von wem kannst du gut Hilfe annehmen?',
      'Gibt es jemanden, dessen Hilfe zwar gut gemeint ist, dich aber manchmal eher anstrengt?',
      'Gibt es Menschen, an die du in schwierigen Momenten denkst, obwohl sie vielleicht gar nicht mehr leben?',
      'Gibt es einen Ort, an dem es dir gerade leichter fällt, einfach zu sein?',
      'Gibt es ein Tier, Musik, ein Buch, eine Tätigkeit, ein Ritual, deinen Glauben, Natur oder etwas anderes, das dich gerade begleitet?',
      'Gibt es etwas, das du immer wieder hörst, liest, anschaust oder tust, weil es dir guttut?',
      'Wenn du nicht alles allein tragen müsstest: Wer oder was dürfte ein Stück davon mittragen?',
    ],
  },
  {
    title: 'Wo ich handeln und entscheiden kann',
    questions: [
      'Vieles an dieser Erkrankung kannst du nicht bestimmen. Wo erlebst du trotzdem: Hier kann ich entscheiden?',
      'Erinnerst du dich an eine Situation seit deiner Diagnose, in der es dir wichtig war, selbst zu entscheiden?',
      'Gab es einen Moment, in dem du gesagt hast: Das möchte ich – oder das möchte ich nicht?',
      'Wo möchtest du stärker gehört werden?',
      'Wo gelingt es dir, eine Grenze zu setzen?',
      'Gibt es eine Grenze, die du gerne setzen würdest, bei der es dir aber schwerfällt?',
      'Bei welchen Entscheidungen möchtest du Unterstützung?',
      'Wo möchtest du gerade ausdrücklich nichts entscheiden müssen?',
      'Wann hattest du in den vergangenen Wochen das Gefühl: Das habe ich selbst gemacht oder entschieden?',
      'Was möchtest du dir von der Krankheit möglichst nicht nehmen lassen?',
    ],
  },
  {
    title: 'Freude, Lebendigkeit und das ganz normale Leben',
    questions: [
      'Gab es in letzter Zeit einen Moment, der einfach gut war?',
      'Wann hast du zuletzt richtig gelacht?',
      'Was ist in deinem Leben gerade schön?',
      'Was macht dir auch jetzt noch Freude?',
      'Was lässt dich manchmal für eine Weile vergessen, dass du krank bist?',
      'Gibt es etwas ganz Gewöhnliches, das dir gerade besonders guttut?',
      'Was schmeckt, riecht oder fühlt sich gerade besonders gut an?',
      'Wann hattest du zuletzt einen Moment, in dem du dich richtig lebendig gefühlt hast?',
      'Was möchtest du gerade einfach genießen, ohne dass es irgendeinen tieferen Sinn haben muss?',
      'Gibt es etwas, das in deinem Leben gerade genauso banal, nervig, lustig oder alltäglich ist wie früher?',
      'Was hatte heute oder in den vergangenen Tagen überhaupt nichts mit Brustkrebs zu tun?',
    ],
  },
  {
    title: 'Was vor mir liegt',
    questions: [
      'Gibt es etwas in den nächsten Tagen oder Wochen, auf das du dich freust?',
      'Wenn du an die kommende Woche denkst: Was möchtest du auf keinen Fall nur wegen des Brustkrebses verpassen?',
      'Gibt es etwas ganz Alltägliches, das du bald wieder machen möchtest?',
      'Was wäre ein richtig guter Tag für dich – so, wie dein Leben gerade ist?',
      'Gibt es jemanden, mit dem du in nächster Zeit gerne etwas unternehmen möchtest? Was?',
      'Gibt es etwas aus deinem Leben vor der Erkrankung, das du vermisst und gerne wieder mehr in deinem Leben hättest?',
      'Was möchtest du unbedingt wieder einmal tun, sobald es für dich möglich ist?',
      'Gibt es etwas, von dem du hoffst, dass es irgendwann wieder ganz selbstverständlich wird?',
      'Was möchtest du aus deinem Leben vor der Erkrankung unbedingt mit in das nehmen, was vor dir liegt?',
      'Gibt es etwas, von dem du heute schon weißt: So wie vorher möchte ich es nicht mehr?',
      'Hast du seit deiner Erkrankung einmal gedacht: Wenn ich wieder mehr Kraft habe, dann möchte ich …?',
      'Gibt es etwas, für das du dir in deinem zukünftigen Leben mehr Zeit oder Raum wünschst?',
      'Gibt es einen Wunsch, den du schon lange mit dir herumträgst und an den du in letzter Zeit wieder häufiger denkst?',
      'Was möchtest du unbedingt noch einmal erleben?',
      'Gibt es einen Ort, an den du gerne reisen möchtest?',
      'Gibt es etwas, das du noch lernen oder ausprobieren möchtest?',
      'Mit wem möchtest du gerne noch viel Zeit verbringen?',
      'Wenn du für einen Moment nicht darüber nachdenken müsstest, ob etwas vernünftig oder realistisch ist: Worauf hättest du Lust?',
      'Wenn du dir dich selbst in einem Jahr vorstellst: Was hoffst du, dass dann wieder ganz selbstverständlich zu deinem Leben gehört?',
      'Was von der Frau, die du vor deiner Erkrankung warst, möchtest du auf jeden Fall mitnehmen?',
      'Gibt es etwas an dir, das du gerade neu kennenlernst und gerne behalten möchtest?',
      'Wenn Menschen, die dich lieben, dich in ein paar Jahren beschreiben: Was hoffst du, dass sie über dich erzählen – ganz unabhängig vom Brustkrebs?',
      'Gibt es etwas an der Zukunft, woran du gerade lieber nicht denkst?',
      'Wie weit nach vorne kannst du im Moment gut denken – bis morgen, bis zum nächsten Wochenende, bis zum Sommer oder viel weiter?',
      'Gibt es etwas, das du planst, obwohl du nicht wissen kannst, wie genau es kommen wird?',
      'Wenn deine Gedanken weit vorausgehen und es schwierig wird: Was hilft dir manchmal, wieder bei dem anzukommen, was heute ist?',
      'Wenn der Brustkrebs in deiner Geschichte irgendwann einmal weniger Raum einnimmt als heute: Was soll dann wieder mehr Raum bekommen?',
    ],
  },
  {
    title: 'Was ich anderen Frauen mitgeben möchte',
    questions: [
      'Wenn heute eine Frau dieselbe Diagnose bekommt, die du damals bekommen hast: Was würdest du ihr gerne aus deiner Erfahrung erzählen?',
      'Was hättest du damals gern von einer anderen betroffenen Frau gehört?',
      'Was hätte dir in den ersten Tagen oder Wochen geholfen zu wissen?',
      'Was hat dir niemand gesagt?',
      'Gibt es etwas, von dem du heute denkst: Das hätte mir damals jemand erzählen sollen?',
      'Gibt es etwas, vor dem andere dich gewarnt haben, das du selbst ganz anders erlebt hast?',
      'Was muss vielleicht jede Frau für sich selbst herausfinden?',
      'Gibt es etwas, das du einer neu erkrankten Frau ausdrücklich nicht sagen würdest?',
      'Gibt es eine Erfahrung, von der du denkst, dass sie einer anderen Frau helfen könnte, sich weniger allein zu fühlen?',
      'Wenn eine andere Frau deine Geschichte liest oder hört: Was wünschst du dir, dass sie daraus mitnimmt?',
    ],
  },
  {
    title: 'Was Ärztinnen, Ärzte und das Gesundheitssystem aus meiner Geschichte wissen sollten',
    questions: [
      'Wenn die Menschen, die Brustkrebs behandeln, deine Geschichte hören könnten: Was sollten sie daraus verstehen?',
      'Erinnerst du dich an einen Moment während deiner Behandlung, in dem du dich wirklich gesehen gefühlt hast?',
      'Was hat die Person damals getan oder gesagt?',
      'Gab es einen Moment, in dem du dich eher wie ein Fall als wie ein Mensch gefühlt hast?',
      'Was hätte in dieser Situation anders sein sollen?',
      'Welche Information kam für dich genau im richtigen Moment?',
      'Gab es Informationen, die zu spät kamen?',
      'Gab es einen Moment, in dem dir etwas medizinisch erklärt wurde und du hinterher wirklich verstanden hast, worum es geht?',
      'Gab es eine Situation, in der du eine Entscheidung treffen solltest und dich dafür nicht ausreichend informiert oder vorbereitet gefühlt hast?',
      'Wann hattest du das Gefühl, wirklich an einer Entscheidung beteiligt zu sein?',
      'Welche Unterstützung hat dir gefehlt?',
      'Gab es Unterstützung, von der du erst später erfahren hast und die du gerne früher gekannt hättest?',
      'Was sollten Ärztinnen, Ärzte oder Pflegekräfte Frauen mit Brustkrebs häufiger fragen?',
      'Was sollten sie vielleicht seltener sagen?',
      'Gibt es etwas, das in einer Krankenakte über dich niemals sichtbar würde, für deine Behandlung und dein Erleben aber wichtig war?',
      'Wenn du im Gesundheitssystem eine Sache aufgrund deiner Erfahrung verändern könntest: Welche wäre das?',
    ],
  },
  {
    title: 'Was noch zu meiner Geschichte gehört',
    questions: [
      'Gibt es etwas Wichtiges, nach dem ich dich noch nicht gefragt habe?',
      'Gibt es eine Geschichte aus dieser Zeit, die du unbedingt erzählen möchtest?',
      'Gibt es etwas, über das im Zusammenhang mit Brustkrebs deiner Erfahrung nach viel zu selten gesprochen wird?',
      'Gibt es etwas, das in deiner Geschichte viel wichtiger ist, als es in unseren bisherigen Gesprächen vorkam?',
      'Gibt es etwas über dich, das jemand, der nur deine Brustkrebsgeschichte kennt, noch unbedingt wissen sollte?',
    ],
  },
]

// Legt den Katalog an bzw. zieht ihn auf den Stand im Code nach und gibt seine
// id zurueck. Ein Katalog GLEICHEN NAMENS wird aktualisiert statt ein zweiter
// angelegt — so bleibt die Zuordnung bestehender Buecher erhalten.
async function ensureMamazoneCatalog(supabase) {
  const { data: found } = await supabase
    .from('question_catalogs').select('id, product_categories').eq('name', CATALOG_NAME).maybeSingle()
  if (found && found.id) {
    // Die Kategorie nachtragen, falls der Katalog noch aus der Zeit stammt, in
    // der die mamazone-Buecher als Lebenswerk liefen.
    const cats = Array.isArray(found.product_categories) ? found.product_categories : []
    if (!cats.includes(MAMAZONE)) {
      await supabase.from('question_catalogs')
        .update({ product_categories: [...cats, MAMAZONE] }).eq('id', found.id)
    }
    return found.id
  }
  const { data, error } = await supabase.from('question_catalogs')
    .insert({ name: CATALOG_NAME, product_categories: [MAMAZONE], chapters: CATALOG_CHAPTERS })
    .select('id').single()
  if (error) throw error
  return data.id
}

module.exports = { MAMAZONE, CATALOG_NAME, CATALOG_CHAPTERS, ensureMamazoneCatalog }
