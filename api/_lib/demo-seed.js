// api/_lib/demo-seed.js
// Demo-Daten für einen neu angelegten Benutzer.
//
// Erzeugt für den Benutzer 3 Trauerbücher, jeweils mit 10 Beitragenden, die je
// 15 Fragen mit Antworten aus je 3 Sätzen beantwortet haben (= 150 Beiträge).
// Es wird KEIN Buch vorproduziert – das generiert der Benutzer selbst über den
// normalen Weg.
//
// Der INHALT ist für jeden Benutzer identisch (bewusst, siehe Anforderung) –
// nur die Codes (memorials.id / contributions.id), der Eigentümer und das
// Bestattungsdatum (= Anlagedatum + 1 Monat) werden je Aufruf neu gesetzt.
// Alles deterministisch (keine Zufallstexte).
//
// Reines Einfügen in Supabase, KEINE LLM-/Bild-Aufrufe → schnell und kostenlos.

const { genCode } = require('./codes')

// ── 3 Verstorbene ─────────────────────────────────────────────────
// Hinweis: Der Name des/der Verstorbenen trägt bei Demo-Büchern immer den
// Zusatz „(Demo)" am Ende, damit Demo-Bücher in jeder Liste sofort erkennbar
// sind. `first` bleibt der reine Vorname (für die Beitragstexte).
const PERSONS = [
  { first: 'Margarete', name: 'Margarete Hoffmann (Demo)', gender: 'weiblich', birth: '1936', death: '2025', organizer: 'Familie Hoffmann' },
  { first: 'Karl',      name: 'Karl Bauer (Demo)',         gender: 'männlich', birth: '1940', death: '2024', organizer: 'Familie Bauer' },
  { first: 'Ingrid',    name: 'Ingrid Wagner (Demo)',      gender: 'weiblich', birth: '1945', death: '2025', organizer: 'Familie Wagner' },
]

// ── je 10 Beitragende pro Buch ────────────────────────────────────
const CONTRIBUTORS = [
  [
    { name: 'Thomas Hoffmann', relationship: 'Sohn', gender: 'männlich' },
    { name: 'Sabine Krüger', relationship: 'Tochter', gender: 'weiblich' },
    { name: 'Wolfgang Hoffmann', relationship: 'Sohn', gender: 'männlich' },
    { name: 'Lena Hoffmann', relationship: 'Enkelin', gender: 'weiblich' },
    { name: 'Jonas Krüger', relationship: 'Enkel', gender: 'männlich' },
    { name: 'Mia Hoffmann', relationship: 'Enkelin', gender: 'weiblich' },
    { name: 'Heinrich Vogt', relationship: 'Nachbar', gender: 'männlich' },
    { name: 'Ruth Lindemann', relationship: 'beste Freundin', gender: 'weiblich' },
    { name: 'Dieter Hoffmann', relationship: 'Schwager', gender: 'männlich' },
    { name: 'Brigitte Vogt', relationship: 'Nachbarin', gender: 'weiblich' },
  ],
  [
    { name: 'Andreas Bauer', relationship: 'Sohn', gender: 'männlich' },
    { name: 'Petra Schmitt', relationship: 'Tochter', gender: 'weiblich' },
    { name: 'Michael Bauer', relationship: 'Sohn', gender: 'männlich' },
    { name: 'Julia Bauer', relationship: 'Enkelin', gender: 'weiblich' },
    { name: 'Tobias Schmitt', relationship: 'Enkel', gender: 'männlich' },
    { name: 'Hannah Bauer', relationship: 'Enkelin', gender: 'weiblich' },
    { name: 'Werner Klein', relationship: 'Freund', gender: 'männlich' },
    { name: 'Renate Bauer', relationship: 'Schwägerin', gender: 'weiblich' },
    { name: 'Klaus Berger', relationship: 'ehemaliger Kollege', gender: 'männlich' },
    { name: 'Ursula Klein', relationship: 'Nachbarin', gender: 'weiblich' },
  ],
  [
    { name: 'Stefan Wagner', relationship: 'Sohn', gender: 'männlich' },
    { name: 'Claudia Frank', relationship: 'Tochter', gender: 'weiblich' },
    { name: 'Martin Wagner', relationship: 'Sohn', gender: 'männlich' },
    { name: 'Sophie Wagner', relationship: 'Enkelin', gender: 'weiblich' },
    { name: 'Lukas Frank', relationship: 'Enkel', gender: 'männlich' },
    { name: 'Emma Wagner', relationship: 'Enkelin', gender: 'weiblich' },
    { name: 'Gerda Hofmann', relationship: 'Schwester', gender: 'weiblich' },
    { name: 'Manfred Wagner', relationship: 'Schwager', gender: 'männlich' },
    { name: 'Ingrid Sommer', relationship: 'beste Freundin', gender: 'weiblich' },
    { name: 'Paul Richter', relationship: 'Nachbar', gender: 'männlich' },
  ],
]

// Familiäre Beziehungen bekommen eine andere Einstiegsfrage als Bekannte.
const FAMILY_RELS = new Set([
  'Sohn', 'Tochter', 'Enkel', 'Enkelin', 'Schwester', 'Bruder',
  'Schwager', 'Schwägerin', 'Nichte', 'Neffe',
])

// ── 15 Fragen mit je 4 Antwortvarianten (3 Sätze, deterministisch gewählt) ──
// q(n,r,isFamily) → Frage;  a = [ (n,r) => Antwort ]
const QUESTIONS = [
  {
    q: (n, r, fam) => fam
      ? `Wie würden Sie Ihre Beziehung zu ${n} als ${r} beschreiben?`
      : `Wie haben Sie ${n} kennengelernt, und was hat Sie verbunden?`,
    a: [
      (n, r) => `Als ${r} stand ich ${n} mein Leben lang besonders nahe. Wir haben unzählige Stunden miteinander verbracht und vieles gemeinsam durchlebt. Diese enge Verbindung hat mich zu dem Menschen gemacht, der ich heute bin.`,
      (n, r) => `${n} war für mich weit mehr als nur ein vertrauter Mensch. Als ${r} habe ich früh gelernt, wie viel Halt eine solche Beziehung geben kann. Auf ${n} war einfach immer Verlass.`,
      (n, r) => `Unsere Beziehung war von tiefem Vertrauen geprägt. Als ${r} konnte ich mit ${n} über alles reden, im Guten wie im Schweren. Dafür bin ich unendlich dankbar.`,
      (n, r) => `Ich hatte das große Glück, ${n} als ${r} so nah zu sein. Gemeinsame Feste, Sorgen und Freuden haben uns über die Jahre fest verbunden. Diese Nähe werde ich für immer in meinem Herzen tragen.`,
    ],
  },
  {
    q: (n) => `Gibt es eine Erinnerung an ${n}, die Ihnen sofort in den Sinn kommt?`,
    a: [
      (n) => `Eine Erinnerung ist mir besonders geblieben. Ich sehe ${n} noch genau vor mir, wie an einem ganz gewöhnlichen Nachmittag. Dieser Augenblick bedeutet mir bis heute sehr viel.`,
      (n) => `Wenn ich zurückdenke, taucht sofort ein bestimmtes Bild auf. Unsere gemeinsamen Sommer und die langen Gespräche werde ich nie vergessen. Daran denke ich noch oft mit einem warmen Gefühl.`,
      (n) => `Es gibt einen Moment, den ich nie vergessen werde. ${n} nahm sich Zeit für mich, als ich sie am dringendsten brauchte. Solche Momente machen mich dankbar für die gemeinsame Zeit.`,
      (n) => `Eine Begebenheit kommt mir immer wieder in den Sinn. Wie ${n} bei jedem Wiedersehen strahlte, ist mir unvergesslich. Daran erinnere ich mich mit großer Zärtlichkeit.`,
    ],
  },
  {
    q: (n) => `Welche Eigenschaften haben ${n} als Menschen besonders ausgemacht?`,
    a: [
      (n) => `Was ${n} als Mensch ausgemacht hat, lässt sich kaum in Worte fassen. ${n} war der ruhende Pol und hatte für jeden ein offenes Ohr. Genau das werde ich immer in Erinnerung behalten.`,
      (n) => `${n} hatte ein ganz besonderes Wesen. ${n} hatte ein großes Herz für alle, die es im Leben schwer hatten. Diese Eigenschaften haben alle Menschen ringsum geprägt.`,
      (n) => `Über den Charakter von ${n} könnte ich endlos erzählen. ${n} war bescheiden und stellte die Bedürfnisse anderer stets über die eigenen. So bleibt ${n} für immer im Gedächtnis.`,
      (n) => `${n} strahlte eine Wärme aus, die jeden Raum heller machte. Ehrlichkeit und Güte waren ${n} wichtiger als alles andere. Daran wird man sich noch lange erinnern.`,
    ],
  },
  {
    q: (n) => `Was haben Sie am liebsten gemeinsam mit ${n} unternommen?`,
    a: [
      (n) => `Mit ${n} ließ sich aus dem einfachsten Anlass ein schöner Tag machen. Ob bei einem Kaffee oder einem kleinen Ausflug, die Zeit verging immer wie im Flug. Daran erinnere ich mich besonders gern.`,
      (n) => `Wir haben viele Unternehmungen miteinander geteilt, große wie kleine. ${n} war dabei stets mit Herz und voller Begeisterung bei der Sache. Solche Momente bleiben unvergesslich.`,
      (n) => `Egal was wir zusammen taten, mit ${n} wurde es zu einer schönen Erinnerung. Gemeinsame Feiern und ruhige Nachmittage gehörten gleichermaßen dazu. Ich bin dankbar für jede dieser Stunden.`,
      (n) => `Am liebsten haben wir gemeinsam Zeit in Ruhe verbracht, ganz ohne großes Programm. Schon ein Spaziergang oder ein langes Gespräch mit ${n} war etwas Besonderes. Diese Stunden fehlen mir heute am meisten.`,
    ],
  },
  {
    q: (n) => `Wie hat ${n} Ihnen in schwierigen Zeiten zur Seite gestanden?`,
    a: [
      (n) => `${n} hat mich durch manche dunkle Stunde getragen. Mit Ruhe und Zuversicht wurde aus jedem Problem etwas Lösbares. Dafür bin ich für immer dankbar.`,
      (n) => `Gerade in Krisen zeigte sich, was in ${n} steckte. Da war immer ein offenes Ohr und eine helfende Hand. Diese Verlässlichkeit hat mir oft Kraft gegeben.`,
      (n) => `Auf ${n} war Verlass, wenn es darauf ankam. In schwierigen Momenten gab es Trost und Ermutigung statt leerer Worte. Das hat mir mehr bedeutet, als ich je sagen konnte.`,
      (n) => `Wenn es mir einmal nicht gut ging, war ${n} sofort zur Stelle. Ohne viel Aufhebens wurde geholfen, ganz selbstverständlich. So einen Menschen an seiner Seite zu wissen, war ein großes Glück.`,
    ],
  },
  {
    q: (n) => `Gibt es eine Geschichte oder Begebenheit, die typisch für ${n} war?`,
    a: [
      (n) => `An eine Sache erinnern wir uns immer wieder mit einem Lächeln. ${n} brachte uns mit einer beiläufigen Bemerkung zum Lachen, ganz ohne Absicht. Genau das machte ${n} so liebenswert.`,
      (n) => `Mit ${n} wurde es nie langweilig, dafür war stets gesorgt. Eine kleine Anekdote nach der anderen begleitete unsere gemeinsamen Stunden. Diese Leichtigkeit werde ich besonders vermissen.`,
      (n) => `Typisch ${n} war dieser ganz besondere Humor, der jede Runde auflockerte. Eine kleine Bemerkung reichte, und alle mussten lachen. Wenn ich daran denke, muss ich noch heute schmunzeln.`,
      (n) => `${n} hatte ein Talent dafür, im richtigen Moment das Richtige zu sagen. Manche Bemerkung sorgt in der Familie bis heute für Gelächter. Solche Geschichten halten die Erinnerung lebendig.`,
    ],
  },
  {
    q: (n) => `Welche Werte oder welche Weisheit von ${n} tragen Sie bis heute weiter?`,
    a: [
      (n) => `Von ${n} habe ich fürs Leben viel mitgenommen. ${n} lehrte mich, dass man mit Ehrlichkeit am weitesten kommt und niemanden im Stich lässt. An diesen Leitsatz halte ich mich bis heute.`,
      (n) => `${n} hat mir Werte vermittelt, die mich bis heute tragen. ${n} brachte mir bei, dass jeder Tag ein Geschenk ist, das man bewusst nutzen sollte. Dieses Vermächtnis gebe ich gern weiter.`,
      (n) => `Eines hat mich besonders geprägt. Von ${n} habe ich gelernt, auch in schwierigen Zeiten die Zuversicht nicht zu verlieren. Dafür bin ich für immer dankbar.`,
      (n) => `${n} zeigte mir, dass man mit Freundlichkeit mehr erreicht als mit Härte. Diese Haltung hat mein ganzes Leben geprägt. Ich versuche, sie an meine Kinder weiterzugeben.`,
    ],
  },
  {
    q: (n) => `Wofür hat ${n} im Leben besonders gebrannt?`,
    a: [
      (n) => `Die Gartenarbeit war für ${n} weit mehr als nur ein Zeitvertreib. Mit viel Liebe zum Detail war ${n} stets bei der Sache. Daran denke ich besonders gern zurück.`,
      (n) => `Die Leidenschaft von ${n} für das Backen war wirklich ansteckend. Mit Hingabe und Ausdauer war ${n} immer dabei. Davon konnte sich jeder eine Scheibe abschneiden.`,
      (n) => `Wenn es um die Musik ging, blühte ${n} regelrecht auf. Diese Begeisterung hat viele Menschen im Umfeld angesteckt. Es war schön, ${n} dabei zu erleben.`,
      (n) => `Für lange Spaziergänge in der Natur konnte ${n} sich jederzeit begeistern. Stundenlang ging ${n} darin auf und vergaß die Zeit. Das gehörte einfach zu ${n}.`,
    ],
  },
  {
    q: (n) => `Was werden Sie an ${n} am meisten vermissen?`,
    a: [
      (n) => `Ich vermisse die Gespräche mit ${n} mehr, als Worte sagen können. Es gab immer ein offenes Ohr und einen guten Rat. Diese Nähe wird mir für immer fehlen.`,
      (n) => `Das Schwerste ist, dass ${n} nun nicht mehr da ist, wenn ich Rat suche. So oft möchte ich noch zum Hörer greifen. Dieser Verlust begleitet mich jeden Tag.`,
      (n) => `Mir fehlt die herzliche Art von ${n}, die jeden Raum wärmer machte. Gerade die kleinen Momente des Alltags vermisse ich am meisten. Es bleibt eine große Leere.`,
      (n) => `Am meisten werde ich die Gegenwart von ${n} vermissen, dieses Gefühl von Geborgenheit. Schon eine kurze Begegnung konnte den ganzen Tag heller machen. Diese Lücke lässt sich nicht füllen.`,
    ],
  },
  {
    q: (n) => `Was möchten Sie ${n} zum Abschied sagen?`,
    a: [
      (n) => `Liebe Grüße in den Himmel, ${n}. Was du mir gegeben hast, nehme ich für mein ganzes Leben mit. Bis wir uns eines Tages wiedersehen.`,
      (n) => `${n}, danke, dass ich dich kennen und schätzen durfte. Deine Wärme und dein Vorbild werden mich immer begleiten. Schlaf gut und ruhe sanft.`,
      (n) => `${n}, du fehlst uns mehr, als sich in Worte fassen lässt. Wir werden dich in liebevoller Erinnerung behalten und oft von dir erzählen. Mach es gut, geliebter Mensch.`,
      (n) => `Ich danke dir von Herzen für all die gemeinsamen Jahre, ${n}. Du wirst für immer einen festen Platz in meinem Herzen behalten. Ruhe nun in Frieden.`,
    ],
  },
  {
    q: (n) => `Wie hätte ${n} sich gewünscht, in Erinnerung zu bleiben?`,
    a: [
      (n) => `${n} hätte sich gewünscht, als jemand in Erinnerung zu bleiben, der für andere da war. Nicht großer Worte wegen, sondern wegen der kleinen Gesten. Genau so werden wir ${n} bewahren.`,
      (n) => `Ich glaube, ${n} wollte vor allem als fröhlicher Mensch erinnert werden. Lieber ein Lächeln als eine Träne, hieß es oft. Diesen Wunsch wollen wir erfüllen.`,
      (n) => `${n} legte nie Wert auf Aufhebens um die eigene Person. Im Herzen der Familie weiterzuleben, war ${n} genug. Dort hat ${n} für immer einen Platz.`,
      (n) => `Für ${n} zählte, dass die Liebe in der Familie weitergetragen wird. So möchte ${n} in Erinnerung bleiben, lebendig in allem, was wir tun. Daran halten wir uns.`,
    ],
  },
  {
    q: (n) => `Gab es ein gemeinsames Ritual oder eine Tradition mit ${n}?`,
    a: [
      (n) => `Mit ${n} gab es ein festes Ritual, auf das wir uns jede Woche freuten. Der gemeinsame Sonntagskaffee war für uns alle heilig. Diese Beständigkeit hat unserer Familie Halt gegeben.`,
      (n) => `${n} hielt an liebgewonnenen Traditionen fest, und wir liebten das. Kein Weihnachtsfest verging ohne die selbst gebackenen Plätzchen. Diese Bräuche führen wir heute zu Ehren von ${n} weiter.`,
      (n) => `Jedes Jahr aufs Neue gab es mit ${n} dasselbe schöne Ritual. Der erste warme Tag wurde stets mit einem Ausflug gefeiert. Daran halten wir bis heute fest.`,
      (n) => `Es waren die kleinen wiederkehrenden Gewohnheiten, die ${n} ausmachten. Das abendliche Telefonat gehörte für mich fest dazu. Wie sehr mir das heute fehlt.`,
    ],
  },
  {
    q: (n) => `Welchen Rat von ${n} haben Sie nie vergessen?`,
    a: [
      (n) => `Ein Rat von ${n} hat mich durchs Leben begleitet. „Bleib dir selbst treu", sagte ${n} oft. Diese Worte haben mir in vielen Situationen geholfen.`,
      (n) => `${n} gab mir einen Rat, den ich nie vergessen habe. Man solle die Menschen so behandeln, wie man selbst behandelt werden möchte. Daran versuche ich mich jeden Tag zu halten.`,
      (n) => `Wenn ich unsicher war, hatte ${n} immer den richtigen Satz parat. „Erst schlafen, dann entscheiden", war so einer. Wie recht ${n} damit hatte.`,
      (n) => `${n} riet mir einmal, niemals den Humor zu verlieren. Selbst in schweren Stunden helfe ein Lächeln weiter. Dieser Rat trägt mich bis heute.`,
    ],
  },
  {
    q: (n) => `Gibt es einen Ort, der für Sie untrennbar mit ${n} verbunden ist?`,
    a: [
      (n) => `Ein bestimmter Ort wird für mich immer zu ${n} gehören. Im Garten hinter dem Haus verbrachten wir die schönsten Stunden. Wenn ich dort stehe, ist ${n} mir ganz nah.`,
      (n) => `Es gibt einen Platz, an dem ich ${n} besonders spüre. Die alte Bank am See war unser liebster Treffpunkt. Diesen Ort werde ich immer in Ehren halten.`,
      (n) => `Die gemütliche Küche von ${n} ist ein Ort voller Erinnerungen. Dort wurde gelacht, getröstet und erzählt. Schon der Gedanke daran wärmt mein Herz.`,
      (n) => `Mit ${n} verbinde ich vor allem das kleine Ferienhaus. Jeder Sommer dort war ein Geschenk. Diese Bilder trage ich für immer in mir.`,
    ],
  },
  {
    q: (n) => `Was brachte ${n} zum Lachen?`,
    a: [
      (n) => `${n} konnte über die kleinsten Dinge herzlich lachen. Ein guter Witz oder ein Missgeschick reichten völlig aus. Dieses Lachen steckte einfach jeden an.`,
      (n) => `Nichts brachte ${n} so zum Strahlen wie die Kinder im Haus. Ihr Übermut war Medizin für die Seele. Diese Freude werde ich nie vergessen.`,
      (n) => `${n} liebte es, alte Geschichten zum Besten zu geben. Spätestens bei der Pointe lachte ${n} am lautesten von allen. Solche Abende waren das Größte.`,
      (n) => `Ein gutes Essen in fröhlicher Runde – mehr brauchte ${n} nicht zum Glück. Da wurde gelacht, bis allen die Tränen kamen. Genau so will ich ${n} in Erinnerung behalten.`,
    ],
  },
]

// Baut den Nachrichtenverlauf (15 × Frage+Antwort) eines Beitragenden.
function buildMessages(personFirst, contributor, idx) {
  const isFamily = FAMILY_RELS.has(contributor.relationship)
  const msgs = []
  for (const item of QUESTIONS) {
    const question = item.q(personFirst, contributor.relationship, isFamily)
    const answer = item.a[idx % item.a.length](personFirst, contributor.relationship)
    msgs.push({ role: 'assistant', content: question })
    msgs.push({ role: 'user', content: answer })
  }
  return msgs
}

// Hinweis: Demo-Bücher werden bewusst NICHT vorproduziert (kein book_v1/book_v2).
// Es werden nur die Beiträge angelegt; das Buch generiert der Benutzer selbst über
// den normalen Weg.

// Erzeugt eindeutige Codes (für PKs), die sich innerhalb dieses Aufrufs nicht
// wiederholen.
function uniqueCodes(count, used) {
  const out = []
  while (out.length < count) {
    const c = genCode()
    if (used.has(c)) continue
    used.add(c)
    out.push(c)
  }
  return out
}

// Hauptfunktion: legt die Demo-Bücher für den Benutzer `ownerUid` an.
// `productCategory` = Kategorie, unter der die Bücher erscheinen (sollte beim
// Benutzer freigeschaltet sein, damit er sie sieht). Wirft bei DB-Fehlern.
async function seedDemoData(supabase, ownerUid, productCategory = 'memorial') {
  const usedCodes = new Set()
  const funeralDate = new Date()
  funeralDate.setMonth(funeralDate.getMonth() + 1)
  const funeralISO = funeralDate.toISOString().slice(0, 10)

  const memorialRows = []
  const contributionRows = []

  PERSONS.forEach((person, pIdx) => {
    const memCode = uniqueCodes(1, usedCodes)[0]
    const contributors = CONTRIBUTORS[pIdx]
    const contribCodes = uniqueCodes(contributors.length, usedCodes)

    memorialRows.push({
      id: memCode,
      name: person.name,
      birth_year: person.birth,
      death_year: person.death,
      organizer: person.organizer,
      gender: person.gender,
      product_category: productCategory,
      languages: ['de'],
      funeral_date: funeralISO,
      book_variant: 1,
      owner_user: ownerUid,
    })

    contributors.forEach((c, i) => {
      contributionRows.push({
        id: contribCodes[i],
        memorial_id: memCode,
        contributor_name: c.name,
        relationship: c.relationship,
        contributor_gender: c.gender,
        messages: buildMessages(person.first, c, i),
      })
    })
  })

  const { error: memErr } = await supabase.from('memorials').insert(memorialRows)
  if (memErr) throw memErr
  const { error: conErr } = await supabase.from('contributions').insert(contributionRows)
  if (conErr) throw conErr

  return { memorials: memorialRows.length, contributions: contributionRows.length }
}

module.exports = { seedDemoData }
