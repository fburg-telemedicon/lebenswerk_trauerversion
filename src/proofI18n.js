// src/proofI18n.js
// Übersetzungen der „Probedruck"-Ansicht (ProofTab). Deutsch berücksichtigt die
// Anredeform (Du/Sie); Englisch ist neutral. Alle übrigen Sprachen stehen in
// proofI18nLangs.js; Schweizer Hochdeutsch wird aus dem Deutschen abgeleitet
// (swissify, kein ß). Fehlt ein Schlüssel, greift der deutsche Rückfall.

function de(du) {
  const you = du ? 'du' : 'Sie'
  const your = du ? 'dein' : 'Ihr'
  const yourN = du ? 'deinen' : 'Ihren'   // Akkusativ (… deinen/Ihren Antworten)
  const canYou = du ? 'du kannst' : 'Sie können'
  const haveYou = du ? 'du hast' : 'Sie haben'
  const Your = du ? 'Dein' : 'Ihr'
  return {
    title: 'Zwischenstand / Endversion',
    entryBtn: 'Zwischenstand / Endversion',
    remaining: (r, m) => `Noch ${r} von ${m} Vorschauen`,
    preparing: 'Wird vorbereitet …',
    progInterview: 'Interview wird abgeschlossen …',
    progText: 'Buchtext wird erstellt …',
    progImg: (i, n) => `Bild ${i} von ${n} …`,
    back: '← Zurück',
    intro: 'Aus deinen bisherigen Antworten kann hier ein Buch entstehen — als Zwischenstand zum Ansehen oder als vorläufige Druckversion mit Bildern.',
    cancel: 'Abbrechen',
    lockedByOther: 'Das Buch wird gerade an anderer Stelle bearbeitet.',
    noAnswers: du
      ? 'Es sind noch keine Interview-Antworten vorhanden. Bitte beantworte zuerst ein paar Fragen.'
      : 'Es sind noch keine Interview-Antworten vorhanden. Bitte beantworten Sie zuerst ein paar Fragen.',
    // Zu wenig eigenes Material. Aus ein paar Sätzen kann die KI keine
    // Lebensgeschichte erzählen — sie würde Kindheit, Beruf und Familie erfinden.
    // Lieber hier bremsen, als eine der wenigen Vorschauen für ein erfundenes
    // Leben zu verbrauchen.
    tooFewWords: (n, min) => du
      ? `Bisher hast du erst ${n} ${n === 1 ? 'Wort' : 'Wörter'} erzählt (empfohlen: mindestens ${min}). Daraus kann noch kein Buch entstehen — die KI müsste den größten Teil erfinden. Erzähl bitte noch ein wenig weiter, dann geht es hier los.`
      : `Bisher haben Sie erst ${n} ${n === 1 ? 'Wort' : 'Wörter'} erzählt (empfohlen: mindestens ${min}). Daraus kann noch kein Buch entstehen — die KI müsste den größten Teil erfinden. Erzählen Sie bitte noch ein wenig weiter, dann geht es hier los.`,
    // Auswahl
    chooseTitle: 'Was möchten ' + (du ? 'du' : 'Sie') + '?',
    zwCardTitle: '📖 Zwischenstand',
    zwCardText: du
      ? 'Eine erste Textfassung aus deinen bisherigen Antworten — nur zum Ansehen. Du kannst danach jederzeit weiter erzählen.'
      : 'Eine erste Textfassung aus Ihren bisherigen Antworten — nur zum Ansehen. Sie können danach jederzeit weiter erzählen.',
    zwCardBtn: '📖 Zwischenstand ansehen',
    zwUsedUp: (m) => `${du ? 'Du hast' : 'Sie haben'} alle ${m} Vorschauen aufgebraucht.`,
    endCardTitle: '📕 Vorläufige Druckversion',
    endCardText: `Das fertige Buch mit Bildern zum Ansehen und für den Feinschliff (Text bearbeiten, Bilder neu generieren). Achtung: Der Interview-Teil wird damit endgültig abgeschlossen und kann nicht mehr genutzt werden.`,
    endCardBtn: '📕 Druckversion erstellen',
    // Zwischenstand-View
    zwRegen: '↻ Zwischenstand neu erzeugen',
    zwConfirmTitle: 'Zwischenstand erstellen?',
    zwConfirmText: (r, m, has) => (du
      ? `Dein Buch wird jetzt aus deinen bisherigen Antworten erzeugt (reiner Text, ohne Bilder). Das zählt zu deinen Vorschauen: danach noch ${r} von ${m} übrig${has ? '. Ein vorhandener Zwischenstand wird ersetzt' : ''}.`
      : `Ihr Buch wird jetzt aus Ihren bisherigen Antworten erzeugt (reiner Text, ohne Bilder). Das zählt zu Ihren Vorschauen: danach noch ${r} von ${m} übrig${has ? '. Ein vorhandener Zwischenstand wird ersetzt' : ''}.`),
    createNow: 'Jetzt erstellen',
    // Druckversion
    printWarnTitle: 'Druckversion erstellen?',
    printWarnText: du
      ? 'Damit wird dein Interview endgültig abgeschlossen und kann nicht mehr genutzt werden. Anschließend entsteht das Buch mit Bildern, das du noch bearbeiten kannst. Das kann einige Minuten dauern.'
      : 'Damit wird Ihr Interview endgültig abgeschlossen und kann nicht mehr genutzt werden. Anschließend entsteht das Buch mit Bildern, das Sie noch bearbeiten können. Das kann einige Minuten dauern.',
    printWarnBtn: 'Ja, abschließen & erstellen',
    printBanner: `Der Interview-Teil ist abgeschlossen. Dies ist die vorläufige Druckversion — ${canYou} Text und Bilder bearbeiten und das Buch anschließend abschließen.`,
    save: '✓ Speichern',
    saved: 'Gespeichert.',
    finalizeBtn: '✅ Abschließen',
    fieldTitle: 'Titel',
    fieldSubtitle: 'Untertitel (optional)',
    chapter: (n) => `Kapitel ${n}`,
    headingPh: 'Überschrift',
    audioEditBtn: '🎤 Abschnitt per Sprache überarbeiten',
    audioEditStop: '⏹ Aufnahme stoppen',
    audioEditBusy: '⏳ Wird überarbeitet …',
    audioEditHint: 'Text markieren = nur das Markierte; sonst der ganze Abschnitt',
    audioNoText: 'Es wurde nichts verstanden. Bitte erneut versuchen.',
    audioBar: '🎤 Markiertes per Sprache überarbeiten',
    audioBarHint: 'Wirkt auf den zuletzt angetippten Absatz oder die Überschrift (markierter Teil, sonst das ganze Feld).',
    audioPickFirst: 'Bitte zuerst in einen Textabschnitt oder eine Überschrift tippen (und optional Text markieren).',
    imgRegen: '↻ Neu generieren',
    imgCreate: '🖼 Bild erzeugen',
    imgBusy: '⏳ Wird erzeugt …',
    imgLeft: (n) => `noch ${n}×`,
    imgNoneLeft: 'keine Neugenerierung mehr',
    imgNone: 'Noch kein Bild',
    imgHistory: 'Frühere Bilder (zum Zurückwechseln antippen):',
    finalizeTitle: 'Buch endgültig abschließen?',
    finalizeText: `Danach ist keine weitere Bearbeitung mehr möglich. ${Your} Buch geht in den Druck. Zum Bestätigen bitte OK eintippen.`,
    finalize: 'Abschließen',
    finalizedBanner: `${Your} Buch ist abgeschlossen und wird gedruckt. Eine Bearbeitung ist nicht mehr möglich.`,
  }
}

function en() {
  return {
    title: 'Draft / Final version',
    entryBtn: 'Draft / Final version',
    remaining: (r, m) => `${r} of ${m} previews left`,
    preparing: 'Preparing …',
    progInterview: 'Finishing the interview …',
    progText: 'Creating the book text …',
    progImg: (i, n) => `Image ${i} of ${n} …`,
    intro: 'A book can grow from your answers here — as a draft to review or as a preliminary print version with images.',
    cancel: 'Cancel',
    lockedByOther: 'The book is currently being edited elsewhere.',
    noAnswers: 'There are no interview answers yet. Please answer a few questions first.',
    tooFewWords: (n, min) => `So far you have told us only ${n} ${n === 1 ? 'word' : 'words'} (recommended: at least ${min}). That is not enough for a book yet — the AI would have to invent most of it. Please tell us a little more, then we can start here.`,
    chooseTitle: 'What would you like to do?',
    zwCardTitle: '📖 Draft',
    zwCardText: 'A first text version from your answers so far — just to review. You can keep telling your story afterwards.',
    zwCardBtn: '📖 View draft',
    zwUsedUp: (m) => `You have used all ${m} previews.`,
    endCardTitle: '📕 Preliminary print version',
    endCardText: 'The finished book with images to review and fine-tune (edit text, regenerate images). Note: this ends the interview part for good — it can no longer be used.',
    endCardBtn: '📕 Create print version',
    zwRegen: '↻ Regenerate draft',
    zwConfirmTitle: 'Create draft?',
    zwConfirmText: (r, m, has) => `Your book will now be created from your answers so far (text only, no images). This counts towards your previews: ${r} of ${m} left afterwards${has ? '. An existing draft will be replaced' : ''}.`,
    createNow: 'Create now',
    printWarnTitle: 'Create print version?',
    printWarnText: 'This ends your interview for good — it can no longer be used. The book with images is then created, which you can still edit. This may take a few minutes.',
    printWarnBtn: 'Yes, finish & create',
    printBanner: 'The interview part is finished. This is the preliminary print version — you can edit text and images and then finalize the book.',
    save: '✓ Save',
    saved: 'Saved.',
    finalizeBtn: '✅ Finalize',
    fieldTitle: 'Title',
    fieldSubtitle: 'Subtitle (optional)',
    chapter: (n) => `Chapter ${n}`,
    headingPh: 'Heading',
    audioEditBtn: '🎤 Revise section by voice',
    audioEditStop: '⏹ Stop recording',
    audioEditBusy: '⏳ Revising …',
    audioEditHint: 'Select text = only the selection; otherwise the whole section',
    audioNoText: 'Nothing was understood. Please try again.',
    audioBar: '🎤 Revise selection by voice',
    audioBarHint: 'Applies to the last tapped paragraph or heading (selected part, otherwise the whole field).',
    audioPickFirst: 'Please tap into a text section or heading first (optionally select text).',
    imgRegen: '↻ Regenerate',
    imgCreate: '🖼 Create image',
    imgBusy: '⏳ Creating …',
    imgLeft: (n) => `${n}× left`,
    imgNoneLeft: 'no regeneration left',
    imgNone: 'No image yet',
    imgHistory: 'Earlier images (tap to switch back):',
    finalizeTitle: 'Finalize the book for good?',
    finalizeText: 'No further editing will be possible after this. Your book goes to print. Please type OK to confirm.',
    finalize: 'Finalize',
    finalizedBanner: 'Your book is finalized and will be printed. Editing is no longer possible.',
  }
}

// ── Weitere Sprachen ────────────────────────────────────────────────────────
// Deutsch (mit Du/Sie) und Englisch stehen oben; die übrigen elf Sprachen liegen
// als reine Daten in proofI18nLangs.js. Dort sind Platzhalter {r}, {m}, {n}, {min},
// {i} eingesetzt — die Funktionen unten bauen daraus wieder Funktionen. Fehlt ein
// Schlüssel, bleibt der deutsche Wert stehen.
import { PROOF_LANGS } from './proofI18nLangs.js'
import { swissify } from './i18nLangs.js'

// Welche Bausteine sind Funktionen — und in welcher Reihenfolge kommen ihre Werte?
const ARGS = {
  remaining: ['r', 'm'],
  progImg: ['i', 'n'],
  tooFewWords: ['n', 'min'],
  zwUsedUp: ['m'],
  zwConfirmText: ['r', 'm'],
  chapter: ['n'],
  imgLeft: ['n'],
}

// Symbole stehen nicht in den Übersetzungen (sie sind sprachunabhängig) und werden
// hier wieder vorangestellt — sonst verlören die Knöpfe ihr Bild.
const SYMBOL = {
  zwCardTitle: '📖 ', zwCardBtn: '📖 ', endCardTitle: '📕 ', endCardBtn: '📕 ',
  zwRegen: '↻ ', save: '✓ ', finalizeBtn: '✅ ', imgRegen: '↻ ', imgCreate: '🖼 ',
  imgBusy: '⏳ ', audioEditBtn: '🎤 ', audioEditStop: '⏹ ', audioEditBusy: '⏳ ', audioBar: '🎤 ',
}

const setzeEin = (vorlage, namen, werte) =>
  namen.reduce((s, name, i) => s.split(`{${name}}`).join(String(werte[i] ?? '')), String(vorlage))

function ausUebersetzung(lang, du) {
  const uebersetzt = PROOF_LANGS[lang]
  if (!uebersetzt) return null
  const basis = de(du)
  const out = { ...basis }
  for (const key of Object.keys(basis)) {
    const wert = uebersetzt[key]
    if (!wert) continue                      // fehlt → deutscher Rückfall
    const symbol = SYMBOL[key] || ''
    if (ARGS[key]) {
      const namen = ARGS[key]
      // Der Zwischenstand-Hinweis hat einen optionalen Zusatz (has).
      if (key === 'zwConfirmText') {
        const zusatz = uebersetzt.zwConfirmReplace || ''
        out[key] = (r, m, has) => setzeEin(wert, namen, [r, m]) + (has && zusatz ? ' ' + zusatz : '')
      } else {
        out[key] = (...werte) => symbol + setzeEin(wert, namen, werte)
      }
    } else if (typeof basis[key] !== 'function') {
      out[key] = symbol + wert
    }
  }
  return out
}

// lang: 'de'|'en'|… (Fallback de). du: nur im Deutschen relevant (Anredeform).
export function proofT(lang, du) {
  if (lang === 'en') return en()
  // Schweiz: kein eigenes Wörterbuch — deutscher Text ohne ß, genau wie uiText()
  // es macht. Ohne das stand hier als einziger Ansicht der Oberfläche „schließen"
  // statt „schliessen".
  if (lang === 'de-CH') return swissify(de(du))
  return ausUebersetzung(lang, du) || de(du)
}
