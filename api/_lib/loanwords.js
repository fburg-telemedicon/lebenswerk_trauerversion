// api/_lib/loanwords.js
// Fremdwörter, die im DEUTSCHEN nicht deutsch ausgesprochen werden.
//
// Gemeldet am 2026-08-26 am fertigen Hörbuch: „Charme" und „Engagement" wurden
// buchstabengetreu deutsch gelesen. Es gäbe drei Wege, das zu beheben:
//
//   1. <phoneme alphabet='ipa'> bzw. ein Custom Lexicon — der saubere Weg, aber
//      die generativen Stimmen (MAI-Voice-2, DragonHD) setzen große Teile des
//      SSML nicht um; bei <break> ist das gemessen (siehe narrationInner in
//      tts.js). Ob sie `phoneme` beachten, lässt sich nur hören, nicht messen.
//   2. <lang xml:lang='fr-FR'> um einzelne Wörter — klingt nach Sprecherwechsel.
//   3. Den VORLESE-Text umschreiben. Wirkt unabhängig von Stimme und Generation,
//      ist nachvollziehbar und ändert nichts am Buch, weil er nur auf dem Weg
//      zur Sprachausgabe entsteht (wie die Emoji- und Bindestrich-Korrekturen
//      in stripForSpeech/narrationText).
//
// Gewählt ist Weg 3.
//
// Aufgenommen sind nur Wörter aus dem FRANZÖSISCHEN Erbe des Deutschen, also
// genau die Klasse, an der die Sprachausgabe scheitert: Nasal (-ent, -ant,
// -ance), stimmhaftes „sch" (-age, -ie), stummes Schluss-t. Anglizismen
// (Team, Computer, Job, Meeting, Manager, Interview, Service) stehen BEWUSST
// nicht hier: die spricht die Stimme richtig, und eine Umschreibung würde sie
// erst kaputtmachen.
//
// Erweitern: Eintrag unten ergänzen — links das Wort mit seinen Beugungen als
// Regex-Gruppe, rechts die Ersetzung mit `$1` für die unverändert übernommene
// Endung. Danach `node -e "…respellLoanwords('…')"` gegenprüfen, und vor allem
// eine Hörprobe machen: Aussprache beurteilt nur das Ohr.

// [Suchmuster ohne Wortgrenzen, Ersetzung]. Reihenfolge zählt: längere Wörter
// zuerst, damit „Journalist" nicht über „Journal" zerlegt wird.
const RULES = [
  // — die beiden gemeldeten Fälle —
  ['Charme', 'Scharm'],
  ['charmant(e|er|es|en|em|este|esten|ester)?', 'scharmant$1'],
  ['Engagement(s)?', 'Angaschmang$1'],
  ['engagiert(e|er|es|en|em|esten)?', 'angaschiert$1'],

  // — Nasal auf -ance/-ence/-ant/-ent —
  ['Chancen', 'Schangsen'],
  ['Chance', 'Schangse'],
  ['Renaissance', 'Renessangs'],
  ['Restaurant(s)?', 'Restorang$1'],
  ['Croissant(s)?', 'Kroassang$1'],
  ['Terrain(s)?', 'Terräng$1'],
  ['Bassin(s)?', 'Bassäng$1'],
  ['Cousine(n)?', 'Kusine$1'],
  ['Cousin(s)?', 'Kusäng$1'],
  ['Ensemble(s)?', 'Angsambl$1'],
  ['Rendezvous', 'Rangdewuh'],

  // — stimmhaftes „sch" (-age, -ie, -eur, J-) —
  ['Journalist(en|in|innen)?', 'Schurnalist$1'],
  ['Journal(e|s)?', 'Schurnal$1'],
  ['Jalousie(n)?', 'Schalusie$1'],
  ['Regisseur(e|s|in|innen)?', 'Reschissör$1'],
  ['Regie', 'Reschie'],
  ['Genie(s)?', 'Schenie$1'],
  ['Genre(s)?', 'Schangr$1'],
  ['Ingenieur(e|s|in|innen)?', 'Inschenjör$1'],
  ['Chauffeur(e|s|in|innen)?', 'Schoför$1'],
  ['Passagier(e|en|in|innen)?', 'Passaschier$1'],
  ['Etage(n)?', 'Etasche$1'],
  ['Garage(n)?', 'Garasche$1'],
  ['Massage(n)?', 'Massasche$1'],
  ['Vernissage(n)?', 'Wernissasche$1'],
  ['Blamage(n)?', 'Blamasche$1'],
  ['Courage', 'Kurasche'],
  ['Orange(n)?', 'Oransche$1'],

  // — stummes Schluss-t / -eau / sonstige —
  ['Budget(s)?', 'Büdschee$1'],
  ['Gourmet(s)?', 'Gurmee$1'],
  ['Portemonnaie(s)?', 'Portmonee$1'],
  ['Portier(s)?', 'Portjee$1'],
  ['Trottoir(s)?', 'Trottoar$1'],
  ['Boulevard(s)?', 'Bulewar$1'],
  ['Chaussee(n)?', 'Schossee$1'],
  ['Niveau(s)?', 'Niwo$1'],
  ['Plateau(s)?', 'Platoh$1'],
  ['Milieu(s)?', 'Miljö$1'],
  ['Souvenir(s)?', 'Suwenier$1'],
  ['Branche(n)?', 'Brangsche$1'],
  ['Toilette(n)?', 'Toalette$1'],
  ['Etui(s)?', 'Etwie$1'],
  ['Chef(s|in|innen)?', 'Schef$1'],
  ['beige', 'besch'],
]

// Wortgrenzen über Lookarounds statt \b: \b kennt keine Umlaute, und
// Zusammensetzungen („Chancengleichheit", „Chefarzt") bleiben so unangetastet —
// sie stehen im Zweifel richtig im Buch und die Stimme liest sie als Ganzes.
const COMPILED = RULES.map(([pattern, repl]) => [
  new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, 'giu'),
  repl,
])

// Groß-/Kleinschreibung des Originals übernehmen: „Charme" → „Scharm",
// „charme" → „scharm". Nur der erste Buchstabe, mehr braucht es im Deutschen
// nicht (Wörter in VERSALIEN kommen im Vorlesetext nicht vor).
function matchCase(original, replacement) {
  const first = original[0]
  if (!first || first !== first.toUpperCase() || first === first.toLowerCase()) return replacement
  return replacement[0].toUpperCase() + replacement.slice(1)
}

// Schreibt Fremdwörter für die Sprachausgabe lautnah um. NUR für den
// gesprochenen Text — der geschriebene Text (Buch, PDF, DOCX) bleibt, wie er ist.
function respellLoanwords(text) {
  let s = String(text || '')
  for (const [re, repl] of COMPILED) {
    s = s.replace(re, (m, word, suffix) => {
      const out = repl.replace('$1', suffix || '')
      return matchCase(word, out)
    })
  }
  return s
}

module.exports = { respellLoanwords, RULES }
