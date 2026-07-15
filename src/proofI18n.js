// src/proofI18n.js
// Übersetzungen der „Probedruck"-Ansicht (ProofTab). Deutsch berücksichtigt die
// Anredeform (Du/Sie); Englisch ist neutral. Für andere Sprachen fällt es auf
// Deutsch (Sie) zurück — die Interview-Inhalte selbst laufen weiter in der
// gewählten Sprache, nur die Bedien-Beschriftungen der Vorschau sind hier gebündelt.

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

// lang: 'de'|'en'|… (Fallback de). du: nur im Deutschen relevant (Anredeform).
export function proofT(lang, du) {
  return lang === 'en' ? en() : de(du)
}
