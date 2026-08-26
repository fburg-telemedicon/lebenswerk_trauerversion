// src/i18n.js
// Mehrsprachigkeit für den Beitragenden-Flow (Deutsch, Polnisch, Englisch).
//
// - LANGUAGES        : auswählbare Sprachen (Code + native Bezeichnung)
// - langDirective()  : Sprach-Override, das dem KI-Interview-Prompt vorangestellt
//                      wird, damit das Gespräch in der gewählten Sprache läuft.
// - uiText(lang)     : feste UI-Texte des Beitragenden-Flows
// - contributorL10n(slug, lang) : kategorie-spezifische, beitragendenseitige
//                      Texte (Überschrift, Beziehungs-Label, Buch-Substantiv …);
//                      Deutsch kommt aus src/categories.js, pl/en als Overlay.

import { CATEGORIES } from './categories.js'
import { swissify, ES, IT, EU, HE, AR, FR, RO, TR, RU, UK } from './i18nLangs.js'

// `rtl: true` = Schreibrichtung rechts nach links. Das betrifft nicht nur die
// Textausrichtung, sondern auch den Druck-PDF-Export: jsPDF kann arabische
// Buchstabenverbindungen nicht formen, deshalb bleibt der Druck-PDF-Knopf für
// diese Sprachen gesperrt (DOCX kann es — Word formt selbst).
// Reihenfolge: Deutsch immer zuerst, alle weiteren alphabetisch nach ihrer
// nativen Bezeichnung (lateinisch, dann kyrillisch, dann RTL-Schriften). Diese
// Reihenfolge gilt ÜBERALL, weil sämtliche Sprach-Auswahllisten über LANGUAGES
// (bzw. sortLangs) iterieren.
// `label` = Originalname (native, so wie ihn ein Sprecher dieser Sprache liest).
// `de`/`en` = Sprachname auf Deutsch bzw. Englisch (fürs Dashboard-Label
// „Originalname / DE- bzw. EN-Name", siehe langLabelFor).
export const LANGUAGES = [
  { code: 'de',    label: 'Deutsch',         de: 'Deutsch',          en: 'German' },
  { code: 'en',    label: 'English',         de: 'Englisch',         en: 'English' },
  { code: 'es',    label: 'Español',         de: 'Spanisch',         en: 'Spanish' },
  { code: 'eu',    label: 'Euskara',         de: 'Baskisch',         en: 'Basque' },
  { code: 'fr',    label: 'Français',        de: 'Französisch',      en: 'French' },
  { code: 'it',    label: 'Italiano',        de: 'Italienisch',      en: 'Italian' },
  { code: 'pl',    label: 'Polski',          de: 'Polnisch',         en: 'Polish' },
  { code: 'ro',    label: 'Română',          de: 'Rumänisch',        en: 'Romanian' },
  { code: 'de-CH', label: 'Schwiizerdütsch', de: 'Schweizerdeutsch', en: 'Swiss German' },
  { code: 'tr',    label: 'Türkçe',          de: 'Türkisch',         en: 'Turkish' },
  { code: 'ru',    label: 'Русский',         de: 'Russisch',         en: 'Russian' },
  { code: 'uk',    label: 'Українська',      de: 'Ukrainisch',       en: 'Ukrainian' },
  { code: 'he',    label: 'עברית',           de: 'Hebräisch',        en: 'Hebrew', rtl: true },
  { code: 'ar',    label: 'العربية',         de: 'Arabisch',         en: 'Arabic', rtl: true },
]

// Dashboard-Label einer Sprache: Originalname + „/ DE- bzw. EN-Name" je nach
// Dashboard-Sprache des Admins. Ist der übersetzte Name identisch mit dem
// Originalnamen (z. B. „Deutsch"/„Deutsch", EN „English"/„English"), entfällt der
// Zusatz. Nur fürs Dashboard gedacht — Beitragende sehen weiterhin nur den Originalnamen.
export function langLabelFor(code, adminLang = 'de') {
  const l = LANGUAGES.find(x => x.code === code)
  if (!l) return code
  const tr = adminLang === 'en' ? l.en : l.de
  if (!tr || tr.toLowerCase() === l.label.toLowerCase()) return l.label
  return `${l.label} / ${tr}`
}
// Reihenfolge-Index je Code — zum Sortieren beliebiger Sprach-Teilmengen
// (z. B. der pro Buch angebotenen Sprachen) in genau dieser Reihenfolge.
const LANG_ORDER = Object.fromEntries(LANGUAGES.map((l, i) => [l.code, i]))
export function sortLangs(codes) {
  return [...(codes || [])].sort((a, b) => (LANG_ORDER[a] ?? 999) - (LANG_ORDER[b] ?? 999))
}
export const LANGUAGE_CODES = LANGUAGES.map(l => l.code)
export const DEFAULT_LANGUAGE = 'de'

export const isRTL = lang => Boolean(LANGUAGES.find(l => l.code === lang)?.rtl)
// Sprachen ohne Druck-PDF: siehe oben (fehlende Ligaturen-Formung in jsPDF).
export const canPrintPdf = lang => !isRTL(lang)

// Wird ans ENDE des Systemprompts gehängt (letzte Instruktion gewinnt), damit
// die Zielsprache die im Prompt enthaltene Regel „Schreibe auf Deutsch"
// zuverlässig überschreibt. Für Deutsch leer (keine Änderung).
const OVERRIDE = {
  pl: 'NADRZĘDNA ZASADA JĘZYKA (ma pierwszeństwo przed KAŻDĄ wcześniejszą instrukcją, w tym „Schreibe auf Deutsch"): Cały tekst, wszystkie pytania i odpowiedzi pisz WYŁĄCZNIE po polsku. Używaj poprawnej pisowni ze wszystkimi polskimi znakami diakrytycznymi (ą, ć, ę, ł, ń, ó, ś, ź, ż) — nigdy ich nie pomijaj ani nie zastępuj literami bez znaków.',
  en: 'OVERRIDING LANGUAGE RULE (takes precedence over EVERY earlier instruction, including "Schreibe auf Deutsch"): Write all text, every question and reply EXCLUSIVELY in English.',
  es: 'REGLA DE IDIOMA PRIORITARIA (prevalece sobre CUALQUIER instrucción anterior, incluida «Schreibe auf Deutsch»): Escribe todo el texto, todas las preguntas y respuestas EXCLUSIVAMENTE en español. Usa la ortografía correcta con todos los acentos y signos (á, é, í, ó, ú, ü, ñ, ¿, ¡); no los omitas nunca.',
  it: 'REGOLA LINGUISTICA PRIORITARIA (prevale su OGNI istruzione precedente, inclusa «Schreibe auf Deutsch»): Scrivi tutto il testo, ogni domanda e ogni risposta ESCLUSIVAMENTE in italiano. Usa sempre le lettere accentate corrette (à, è, é, ì, ò, ù) e non ometterle mai.',
  eu: 'HIZKUNTZA ARAU NAGUSIA (aurreko EDOZEIN jarraibideren gainetik dago, «Schreibe auf Deutsch» barne): Idatzi testu guztia, galdera eta erantzun guztiak EUSKARAZ soilik. Erabili ortografia zuzena euskarazko karaktere guztiekin (adib. ñ, ç); ez ezabatu inoiz.',
  he: 'כלל שפה עליון (גובר על כל הוראה קודמת, לרבות „Schreibe auf Deutsch"): כתוב את כל הטקסט, כל השאלות וכל התשובות בעברית בלבד.',
  ar: 'قاعدة اللغة العليا (تَعلو على أي تعليمات سابقة، بما فيها „Schreibe auf Deutsch"): اكتب كل النص وكل الأسئلة والأجوبة باللغة العربية فقط.',
  fr: 'RÈGLE LINGUISTIQUE PRIORITAIRE (prévaut sur TOUTE instruction précédente, y compris « Schreibe auf Deutsch ») : rédige tout le texte, chaque question et chaque réponse EXCLUSIVEMENT en français. Utilise une orthographe correcte avec tous les accents et signes (à, â, ç, é, è, ê, ë, î, ï, ô, ù, û, œ) ; ne les omets jamais.',
  ro: 'REGULĂ LINGVISTICĂ PRIORITARĂ (prevalează asupra ORICĂREI instrucțiuni anterioare, inclusiv „Schreibe auf Deutsch"): scrie tot textul, fiecare întrebare și fiecare răspuns EXCLUSIV în limba română. Folosește ortografia corectă cu toate diacriticele (ă, â, î, ș, ț); nu le omite niciodată.',
  tr: 'ÖNCELİKLİ DİL KURALI (önceki HER talimatın, „Schreibe auf Deutsch" dâhil, önüne geçer): tüm metni, her soruyu ve her yanıtı YALNIZCA Türkçe yaz. Tüm Türkçe harfleri (ç, ğ, ı, İ, ö, ş, ü) doğru kullan; asla atlama.',
  ru: 'ПРИОРИТЕТНОЕ ЯЗЫКОВОЕ ПРАВИЛО (имеет преимущество над ЛЮБОЙ предыдущей инструкцией, включая „Schreibe auf Deutsch"): пиши весь текст, каждый вопрос и каждый ответ ИСКЛЮЧИТЕЛЬНО на русском языке. Используй букву «ё» там, где это уместно.',
  uk: 'ПРІОРИТЕТНЕ МОВНЕ ПРАВИЛО (має перевагу над БУДЬ-ЯКОЮ попередньою інструкцією, зокрема „Schreibe auf Deutsch"): пиши весь текст, кожне запитання й кожну відповідь ВИКЛЮЧНО українською мовою. Використовуй правильний правопис з усіма літерами (ґ, є, і, ї, й).',
  // Schweiz: Der Mensch spricht Mundart — die KI versteht sie, schreibt aber
  // Schweizer Hochdeutsch. Dialekt-Schreibweise hat keine verbindliche
  // Rechtschreibung; ein Buch in Mundart-Verschriftlichung wirkt unfreiwillig
  // komisch. Deshalb: hören ja, schreiben nein.
  'de-CH': 'ÜBERGEORDNETE SPRACHREGEL: Die Person spricht Schweizerdeutsch (Mundart). Verstehe die Mundart, aber SCHREIBE ausschliesslich in SCHWEIZER HOCHDEUTSCH: normale deutsche Schriftsprache, jedoch OHNE „ß" (immer „ss"), mit Schweizer Wortwahl, wo sie natürlich ist (z. B. Velo, Znüni, Spital, parkieren, Trottoir). Schreibe NIEMALS in Dialekt-Verschriftlichung.',
}
export function langDirective(lang) {
  const rule = OVERRIDE[lang]
  if (!rule) return ''
  const imgNote = ' (Ausnahme: das Feld „image_prompt" bleibt immer Englisch.)'
  return `\n\n────────────────\n${rule}${imgNote}`
}

// ── Feste UI-Texte ────────────────────────────────────────────────
const DE = {
  locale: 'de-DE',
  genders: { 'männlich': 'Männlich', 'weiblich': 'Weiblich', 'divers': 'Divers', 'keine Angabe': 'Keine Angabe' },
  notFound: (noun) => `${noun} nicht gefunden`,
  yourName: 'Ihr Name *',
  fullName: 'Vollständiger Name',
  yourGender: 'Ihr Geschlecht *',
  relationshipFallback: 'Ihre Beziehung *',
  relationshipHint: (name, gender) => {
    const n = name || 'die Person'
    const role = gender === 'männlich' ? 'Ihr Vater' : gender === 'weiblich' ? 'Ihre Mutter' : 'ein Elternteil von Ihnen'
    return `Aus Ihrer Sicht: Wer sind Sie für ${name || 'diese Person'}? Beispiel: Wenn ${n} ${role} ist, schreiben Sie „Tochter" oder „Sohn" (im Sinne von „Ich bin die Tochter / der Sohn von ${n}").`
  },
  addressQ: 'Wie möchten Sie angesprochen werden? *',
  addrInformalTitle: 'Du', addrInformalSub: 'Informell, vertraut',
  addrFormalTitle: 'Sie', addrFormalSub: 'Förmlich, respektvoll',
  consentSpecialMemorial: 'Gesundheit, Todesumständen oder Religion',
  consentSpecialOther: 'Gesundheit oder Religion',
  consentText: (noun, special) =>
    `Ich willige ausdrücklich ein, dass meine Angaben und mein Interview – einschließlich möglicher Angaben zu ${special} (besondere Kategorien personenbezogener Daten nach Art. 9 DSGVO) – zur Erstellung des ${noun} verarbeitet werden. Die Verarbeitung erfolgt durch KI-Dienste, die ausschließlich in der EU laufen (Microsoft Azure); eine Übermittlung in ein Drittland findet nicht statt. Die Einwilligung ist freiwillig und jederzeit mit Wirkung für die Zukunft widerrufbar. Einzelheiten in der `,
  // Variante 1 macht aus jedem Beitrag ein eigenes Kapitel MIT NAMEN. Wer das
  // nicht weiß, erzählt womöglich anders, als er es gedruckt sehen möchte.
  nameNoticeSure: 'Wichtig: Ihr Beitrag erscheint im fertigen Buch als eigenes Kapitel — mit Ihrem Namen darüber. Alle, die das Buch lesen, können ihn also lesen.',
  nameNoticeMaybe: 'Bitte beachten Sie: Ihr Beitrag könnte im fertigen Buch als eigenes Kapitel mit Ihrem Namen erscheinen. Wie das Buch aufgebaut wird, entscheidet sich später.',
  consentLink: 'Datenschutzerklärung',
  imprintLink: 'Impressum',
  consentAlready: 'Ihre Datenschutz-Einwilligung liegt bereits vor.',
  introSkip: 'Überspringen →',
  doneTitle: 'Herzlichen Dank',
  doneBody: (noun) => `Ihr Beitrag ist jetzt Teil des gemeinsamen ${noun}s und wird bewahrt.`,
  resumeTitle: 'Sie haben einen begonnenen Beitrag',
  resumeLast: (d) => `Letzte Aktivität: ${d}.`,
  resumeQ: 'Möchten Sie dort fortfahren, wo Sie aufgehört haben?',
  resumeContinue: '↻ Fortsetzen', resumeFresh: 'Ich bin jemand anderes',
  resumeKeep: 'Ihr bisheriger Beitrag bleibt in jedem Fall gespeichert.',
  resumeRestart: "Neu beginnen", resumeRestartHint: "Das Interview startet von vorn. Ihre bisherigen Antworten bleiben gespeichert.",
  resumeRestartCancel: "Abbrechen",
  pauseTitle: 'Später fortsetzen oder jetzt beenden?',
  pauseIntro: 'Ihre bisherigen Antworten sind bereits gespeichert. Sie können später jederzeit zurückkommen — auf zwei Wegen:',
  pauseWay1Strong: '1. Einfach denselben Einladungslink wieder öffnen.',
  pauseWay1Body: 'Ihr Browser merkt sich Ihre Session automatisch und bietet beim nächsten Aufruf an, dort weiterzumachen.',
  pauseWay2Strong: '2. Optional:',
  pauseWay2Body: 'Sichern Sie sich zusätzlich diesen persönlichen Wiederaufnahme-Link — falls Sie das Gerät wechseln oder Browser-Daten gelöscht werden:',
  copyLink: '📋 Link kopieren', copied: '✓ Kopiert', mailBtn: '✉ Per Mail schicken',
  mailAskLabel: 'Ihre E-Mail-Adresse', mailSend: 'Senden', mailSent: '✓ E-Mail gesendet.', mailInvalid: 'Bitte eine gültige E-Mail-Adresse angeben.',
  continueTalk: '← Weiter sprechen', finishNow: '✓ Beitrag jetzt beenden',
  mailSubject: (noun, name) => `Mein Beitrag zum ${noun}${name ? ' für ' + name : ''}`,
  mailBody: (noun, name, url) =>
`Mit diesem persönlichen Link kann ich meinen Beitrag zum ${noun}${name ? ' für ' + name : ''} später fortsetzen:

${url}

(Bitte nicht weitergeben — der Link führt direkt zu meinem persönlichen Beitrag.)`,
  // VoiceInterview
  modeVoice: '🎙 Sprach-Modus',
  pauseEnd: 'Später fortsetzen oder beenden',
  saveLabel: 'Speichern',
  cutoffNote: (d) => `Eingaben bis zum ${d} werden berücksichtigt.`,
  questionLabel: 'Frage',
  // Fortschrittsanzeige im Katalog-Modus (nur bei vordefiniertem Fragenkatalog)
  progChapter: (n, total) => `Kapitel ${n} von ${total}`,
  progQuestion: (n, total) => `Frage ${n} von ${total}`,
  progDone: '✓ Alle Fragen beantwortet',
  progAria: 'Fortschritt im Fragenkatalog',
  loadingShort: 'Lädt …', stop: '⏹ Stoppen', readAgain: '🔊 Nochmal vorlesen', listen: '🔊 Anhören',
  micRecording: 'Aufnahme läuft – erneut klicken zum Beenden',
  micProcessing: 'Wird transkribiert …',
  micIdle: 'Mikrofon klicken, um zu antworten',
  autosaveNote: 'Ihre Antworten werden automatisch gespeichert. Sie können beliebig lange erzählen oder oben „Später fortsetzen oder beenden" klicken.',
  errTranscribe: 'Transkription', errMic: 'Mikrofon',
  // Sprachauswahl
  nextQuestion: 'Nächste Frage →', nextQuestionMsg: 'Weiter zur nächsten Frage, bitte.',
  langPickTitle: 'In welcher Sprache möchten Sie fortfahren?',
  // Buch-Überschriften
  chapterLabel: 'Kapitel',
  contributorsHeading: 'An diesem Buch haben mitgewirkt:',
  voicesHeading: 'Was andere erzählen',
  aiDisclaimerTitle: 'Hinweis zur Entstehung dieses Buches',
  aiDisclaimer: 'Dieses Buch wurde auf Grundlage von Interviews mit nahestehenden Personen mithilfe von künstlicher Intelligenz erstellt. Es gibt persönliche Erinnerungen und Schilderungen der Beitragenden wieder. Ihre inhaltliche Richtigkeit, Vollständigkeit und Aktualität können wir nicht überprüfen; eine Haftung hierfür ist – soweit gesetzlich zulässig – ausgeschlossen.',
  // Foto-Upload (am Ende des Interviews)
  uploadStepTitle: 'Möchten Sie Fotos beitragen?',
  uploadStepIntro: 'Sie können persönliche Fotos hochladen, die bei der Gestaltung des Buches berücksichtigt werden. Zu jedem Bild können Sie optional eine Bildunterschrift und eine kurze Beschreibung angeben.',
  uploadPick: '＋ Foto auswählen',
  uploadCaption: 'Bildunterschrift (optional)',
  uploadCaptionHint: 'Wird – wenn angegeben – genau so ins Buch übernommen.',
  uploadDesc: 'Bildbeschreibung (optional)',
  uploadDescHint: 'Nur zur Einordnung durch die KI; erscheint nicht im Buch.',
  uploadConsent: 'Ich versichere, dass ich berechtigt bin, diese Fotos hochzuladen, und dass alle abgebildeten Personen (bzw. deren Angehörige) damit einverstanden sind, dass die Bilder zur Gestaltung des Buches verwendet sowie durch KI verarbeitet und künstlerisch verändert werden – auch, um abgebildete Personen stilistisch in die jeweilige Zeit eines Kapitels zu versetzen. Die Verarbeitung erfolgt durch KI-Dienste, die ausschließlich in der EU laufen.',
  uploadConsentRequired: 'Bitte bestätigen Sie die Einverständniserklärung, um Fotos hochzuladen.',
  uploadSubmit: 'Fotos hochladen',
  uploadSkip: 'Ohne Fotos abschließen',
  uploadUploading: 'Wird hochgeladen …',
  uploadAdded: (n) => `${n} Foto${n === 1 ? '' : 's'} hinzugefügt`,
  uploadError: 'Upload fehlgeschlagen',
  uploadNoVideo: "Videos können nicht hochgeladen werden – bitte ein Foto auswählen.",
  micPrimeTitle: "Gleich fragt Ihr Browser nach dem Mikrofon",
  micPrimeBody: "Das Interview wird gesprochen — dafür braucht die App Zugriff auf Ihr Mikrofon. Bitte tippen Sie im nächsten Fenster auf „Zulassen“. Wählen Sie „Blockieren“, merkt sich der Browser das dauerhaft, und Sie können erst wieder erzählen, nachdem Sie es in den Einstellungen Ihres Geräts geändert haben.",
  micPrimeOk: "Verstanden – weiter",
  micPrimeLater: "Später entscheiden",
  uploadRemove: 'Entfernen',
  uploadDoneBtn: 'Fertig',
  fbQuestion: 'Wie war das Interview für Sie?',
  fbHint: 'Ihre kurze Rückmeldung hilft uns, den Ablauf zu verbessern (freiwillig).',
  fbLabels: ['Sehr unzufrieden', 'Unzufrieden', 'Neutral', 'Zufrieden', 'Sehr zufrieden'],
  fbTextPlaceholder: 'Möchten Sie uns noch etwas mitteilen? (optional)',
  fbSubmit: 'Feedback senden',
  fbThanks: 'Vielen Dank für Ihre Rückmeldung!',
  fbSaveErr: 'Das Feedback konnte nicht gespeichert werden.',
  closeBtn: 'Interview beenden',
  logout: 'Abmelden',
  closeHint: 'Sie können dieses Fenster nun schließen.',
  txSentLabel: '✓ Antwort gesendet',
  txDelete: '🗑 Löschen',
  txRedo: '↻ Neu einsprechen',
  txShowEarlier: '↑ Vorherige anzeigen', txHideEarlier: '↓ Vorherige ausblenden',
  txToggleLabel: 'Transkript & Korrekturmöglichkeiten anzeigen',
  txTab: 'Transkript & Korrektur',
  companionTab: 'Begleitet',
  menuTitle: 'Menü',
  companionOnMsg: 'Alles klar — ich halte mich jetzt zurück und höre zu.',
  companionOffMsg: 'Ich bin wieder da.',
  micSelf: 'Erzähler',
  micCompanion: 'Begleitung',
  timerRemaining: 'Verbleibende Testzeit',
  timerExpiredShort: '⏳ Testzeit abgelaufen',
  timerExpired: 'Die Testzeit ist abgelaufen. Sie können das Interview weiter ansehen, aber keine Antworten mehr aufnehmen. Für ein unbegrenztes Interview wenden Sie sich bitte an den Anbieter.',
  unlockButton: 'Freischaltcode eingeben',
  unlockTitle: 'Freischaltcode eingeben',
  unlockHint: 'Geben Sie Ihren Code ein, um das Zeitlimit dauerhaft aufzuheben.',
  unlockSubmit: 'Einlösen',
  unlockCancel: 'Abbrechen',
  unlockSuccess: '✓ Zeitlimit aufgehoben – Sie können jetzt unbegrenzt weitererzählen.',
  unlockInvalid: 'Dieser Freischaltcode ist ungültig oder wurde bereits eingelöst.',
  micNoSound: 'Kein Ton erkannt – das Mikrofon wurde automatisch gestoppt. Zum Sprechen erneut tippen.',
  micAutoStopped: 'Aufnahme automatisch beendet (Höchstdauer erreicht). Zum Weitererzählen erneut aufs Mikrofon tippen.',
  supportButton: 'Support kontaktieren',
  tabInterview: 'Interview',
  tabPhoto: 'Foto-Upload',
  // Lebenswerk / Endnutzer
  tabSettings: 'Einstellungen',
  tabProof: 'Probedruck',
  settingsTitle: 'Einstellungen für Ihr Buch',
  settingsIntro: 'Sie können jederzeit ändern, wie Ihr Buch aussehen soll. Die Einstellungen wirken auf das fertige Buch, nicht auf das Gespräch.',
  settingsImageStyle: 'Grafikstil der Bilder',
  settingsBookLayout: 'Textstil (Schrift & Design)',
  settingsWritingStyle: 'Schreibstil (Ton der Erzählung)',
  settingsSaved: '✓ Gespeichert',
  settingsSaveErr: 'Die Einstellung konnte nicht gespeichert werden.',
  yourNameSelf: 'Ihr Name *',
  euDoneBody: 'Ihre Lebensgeschichte ist gespeichert. Sie können jederzeit zurückkommen und weitererzählen.',
  // Stammbaum & Lebensposter: standen fest auf Deutsch im PDF-Zeichner
  // (lifeworkExtras.js) und wurden in jedes fremdsprachige Produkt gedruckt.
  treeTitle: 'Stammbaum',
  treeBasis: 'Auf Grundlage der erzählten Beziehungen.',
  treeMissingNote: 'Fehlende Namen sind als „Name nicht genannt" markiert.',
  treeNoName: 'Name nicht genannt',
  posterValues: 'WERTE',
  posterPlaces: 'ORTE',
}

const PL = {
  locale: 'pl-PL',
  genders: { 'männlich': 'Mężczyzna', 'weiblich': 'Kobieta', 'divers': 'Inne', 'keine Angabe': 'Bez podania' },
  notFound: (noun) => `Nie znaleziono: ${noun}`,
  yourName: 'Twoje imię i nazwisko *',
  fullName: 'Imię i nazwisko',
  yourGender: 'Twoja płeć *',
  relationshipFallback: 'Twoja relacja *',
  relationshipHint: (name, gender) => {
    const n = name || 'tej osoby'
    const role = gender === 'männlich' ? 'Twoim tatą' : gender === 'weiblich' ? 'Twoją mamą' : 'Twoim rodzicem'
    return `Z Twojej perspektywy: kim jesteś dla osoby ${n}? Np. jeśli ${name || 'ta osoba'} jest ${role}, wpisz „córka" lub „syn" (w sensie „jestem córką / synem osoby ${n}").`
  },
  addressQ: 'Jak mamy się do Ciebie zwracać? *',
  addrInformalTitle: 'Ty', addrInformalSub: 'Nieformalnie, na „ty"',
  addrFormalTitle: 'Pan/Pani', addrFormalSub: 'Formalnie, z szacunkiem',
  consentSpecialMemorial: 'zdrowia, okoliczności śmierci lub religii',
  consentSpecialOther: 'zdrowia lub religii',
  consentText: (noun, special) =>
    `Wyrażam wyraźną zgodę na to, by moje dane i mój wywiad – w tym możliwe informacje dotyczące ${special} (szczególne kategorie danych osobowych zgodnie z art. 9 RODO) – były przetwarzane w celu stworzenia: ${noun}. Przetwarzanie odbywa się za pomocą usług AI działających wyłącznie w UE (Microsoft Azure); nie następuje przekazanie danych do państwa trzeciego. Zgoda jest dobrowolna i można ją w każdej chwili odwołać ze skutkiem na przyszłość. Szczegóły w `,
  consentLink: 'polityce prywatności',
  imprintLink: 'Nota prawna',
  consentAlready: 'Twoja zgoda na przetwarzanie danych została już udzielona.',
  introSkip: 'Pomiń →',
  doneTitle: 'Serdecznie dziękujemy',
  doneBody: (noun) => `Twój wkład jest teraz częścią wspólnej księgi (${noun}) i zostanie zachowany.`,
  resumeTitle: 'Masz rozpoczęty wkład',
  resumeLast: (d) => `Ostatnia aktywność: ${d}.`,
  resumeQ: 'Czy chcesz kontynuować od miejsca, w którym przerwałeś/aś?',
  resumeContinue: '↻ Kontynuuj', resumeFresh: 'Jestem kimś innym',
  resumeKeep: 'Twój dotychczasowy wkład w każdym razie pozostaje zapisany.',
  resumeRestart: "Zacznij od nowa", resumeRestartHint: "Wywiad zacznie się od początku. Dotychczasowe odpowiedzi pozostaną zapisane.",
  resumeRestartCancel: "Anuluj",
  pauseTitle: 'Kontynuować później czy zakończyć teraz?',
  pauseIntro: 'Twoje dotychczasowe odpowiedzi zostały już zapisane. Możesz wrócić w każdej chwili — na dwa sposoby:',
  pauseWay1Strong: '1. Po prostu otwórz ponownie ten sam link z zaproszeniem.',
  pauseWay1Body: 'Twoja przeglądarka automatycznie zapamiętuje sesję i przy kolejnym otwarciu zaproponuje kontynuację.',
  pauseWay2Strong: '2. Opcjonalnie:',
  pauseWay2Body: 'Zapisz dodatkowo ten osobisty link do wznowienia — na wypadek zmiany urządzenia lub usunięcia danych przeglądarki:',
  copyLink: '📋 Kopiuj link', copied: '✓ Skopiowano', mailBtn: '✉ Wyślij e-mailem',
  continueTalk: '← Mów dalej', finishNow: '✓ Zakończ wkład teraz',
  mailSubject: (noun, name) => `Mój wkład do: ${noun}${name ? ' dla ' + name : ''}`,
  mailBody: (noun, name, url) =>
`Za pomocą tego osobistego linku mogę później kontynuować mój wkład do: ${noun}${name ? ' dla ' + name : ''}:

${url}

(Proszę nie udostępniać — link prowadzi bezpośrednio do mojego osobistego wkładu.)`,
  modeVoice: '🎙 Tryb głosowy',
  pauseEnd: 'Kontynuuj później lub zakończ',
  saveLabel: 'Zapis',
  cutoffNote: (d) => `Wpisy do dnia ${d} zostaną uwzględnione.`,
  questionLabel: 'Pytanie',
  progChapter: (n, total) => `Rozdział ${n} z ${total}`,
  progQuestion: (n, total) => `Pytanie ${n} z ${total}`,
  progDone: '✓ Wszystkie pytania zostały omówione',
  progAria: 'Postęp w katalogu pytań',
  loadingShort: 'Ładowanie …', stop: '⏹ Zatrzymaj', readAgain: '🔊 Przeczytaj ponownie', listen: '🔊 Posłuchaj',
  micRecording: 'Trwa nagrywanie – kliknij ponownie, aby zakończyć',
  micProcessing: 'Transkrypcja …',
  micIdle: 'Kliknij mikrofon, aby odpowiedzieć',
  autosaveNote: 'Twoje odpowiedzi są zapisywane automatycznie. Możesz mówić dowolnie długo lub kliknąć u góry „Kontynuuj później lub zakończ".',
  errTranscribe: 'Transkrypcja', errMic: 'Mikrofon',
  legalGermanNote: 'Uwaga: polityka prywatności i nota prawna są dostępne w języku niemieckim i to one są wiążące prawnie.',
  nextQuestion: 'Następne pytanie →', nextQuestionMsg: 'Przejdźmy do następnego pytania.',
  langPickTitle: 'W jakim języku chcesz kontynuować?',
  chapterLabel: 'Rozdział',
  contributorsHeading: 'W tej księdze wzięli udział:',
  voicesHeading: 'Co mówią inni',
  aiDisclaimerTitle: 'Informacja o powstaniu tej księgi',
  aiDisclaimer: 'Ta księga powstała z pomocą sztucznej inteligencji, na podstawie rozmów z osobami bliskimi. Oddaje osobiste wspomnienia i relacje osób, które wzięły udział. Nie możemy zweryfikować ich poprawności, kompletności ani aktualności; odpowiedzialność za nie jest – w zakresie dozwolonym przez prawo – wyłączona.',
  // Przesyłanie zdjęć (na końcu wywiadu)
  uploadStepTitle: 'Czy chcesz dodać zdjęcia?',
  uploadStepIntro: 'Możesz przesłać osobiste zdjęcia, które zostaną uwzględnione przy tworzeniu księgi. Do każdego zdjęcia możesz opcjonalnie dodać podpis i krótki opis.',
  uploadPick: '＋ Wybierz zdjęcie',
  uploadCaption: 'Podpis zdjęcia (opcjonalnie)',
  uploadCaptionHint: 'Jeśli podany, zostanie przeniesiony do księgi dokładnie w tej formie.',
  uploadDesc: 'Opis zdjęcia (opcjonalnie)',
  uploadDescHint: 'Tylko dla AI, aby właściwie umieścić zdjęcie; nie pojawia się w księdze.',
  uploadConsent: 'Zapewniam, że jestem uprawniony/a do przesłania tych zdjęć oraz że wszystkie przedstawione na nich osoby (lub ich bliscy) wyrażają zgodę na wykorzystanie zdjęć do stworzenia księgi, a także na ich przetwarzanie i artystyczną modyfikację przez AI – również w celu stylistycznego przeniesienia osób w czas danego rozdziału. Przetwarzanie odbywa się za pomocą usług AI działających wyłącznie w UE.',
  uploadConsentRequired: 'Potwierdź zgodę, aby przesłać zdjęcia.',
  uploadSubmit: 'Prześlij zdjęcia',
  uploadSkip: 'Zakończ bez zdjęć',
  uploadUploading: 'Przesyłanie …',
  uploadAdded: (n) => `Dodano ${n} zdjęć`,
  uploadError: 'Przesyłanie nie powiodło się',
  uploadNoVideo: "Nie można przesyłać filmów – proszę wybrać zdjęcie.",
  micPrimeTitle: "Za chwilę przeglądarka zapyta o mikrofon",
  micPrimeBody: "Wywiad prowadzony jest głosem — aplikacja potrzebuje dostępu do mikrofonu. W następnym oknie proszę wybrać „Zezwól”. Wybór „Zablokuj” przeglądarka zapamięta na stałe i opowiadanie będzie możliwe dopiero po zmianie ustawień urządzenia.",
  micPrimeOk: "Rozumiem – dalej",
  micPrimeLater: "Zdecyduję później",
  uploadRemove: 'Usuń',
  uploadDoneBtn: 'Gotowe',
  fbQuestion: 'Jak wyglądała rozmowa z Twojej perspektywy?',
  fbHint: 'Twoja krótka opinia pomoże nam ulepszyć proces (dobrowolnie).',
  fbLabels: ['Bardzo niezadowolony(a)', 'Niezadowolony(a)', 'Neutralnie', 'Zadowolony(a)', 'Bardzo zadowolony(a)'],
  fbTextPlaceholder: 'Czy chcesz nam coś jeszcze przekazać? (opcjonalnie)',
  fbSubmit: 'Wyślij opinię',
  fbThanks: 'Dziękujemy za Twoją opinię!',
  fbSaveErr: 'Nie udało się zapisać opinii.',
  closeBtn: 'Zakończ rozmowę',
  logout: 'Wyloguj się',
  closeHint: 'Możesz teraz zamknąć to okno.',
  txSentLabel: '✓ Odpowiedź wysłana',
  txDelete: '🗑 Usuń',
  txRedo: '↻ Nagraj ponownie',
  txShowEarlier: '↑ Pokaż wcześniejsze', txHideEarlier: '↓ Ukryj wcześniejsze',
  txToggleLabel: 'Pokaż transkrypcję i możliwość korekty',
  txTab: 'Transkrypcja i korekta',
  companionTab: 'Ze wsparciem',
  menuTitle: 'Menu',
  companionOnMsg: 'Dobrze — teraz się wycofuję i słucham.',
  companionOffMsg: 'Znów tu jestem.',
  micSelf: 'Narrator',
  micCompanion: 'Osoba tow.',
  timerRemaining: 'Pozostały czas testowy',
  timerExpiredShort: '⏳ Czas testowy minął',
  timerExpired: 'Czas testowy dobiegł końca. Możesz nadal przeglądać wywiad, ale nie możesz już nagrywać odpowiedzi. Aby uzyskać nieograniczony wywiad, skontaktuj się z dostawcą.',
  unlockButton: 'Wpisz kod aktywacyjny',
  unlockTitle: 'Wpisz kod aktywacyjny',
  unlockHint: 'Wpisz swój kod, aby trwale znieść limit czasu.',
  unlockSubmit: 'Aktywuj',
  unlockCancel: 'Anuluj',
  unlockSuccess: '✓ Limit czasu zniesiony – możesz teraz opowiadać bez ograniczeń.',
  unlockInvalid: 'Ten kod aktywacyjny jest nieprawidłowy lub został już wykorzystany.',
  micNoSound: 'Nie wykryto dźwięku – mikrofon został automatycznie wyłączony. Dotknij ponownie, aby mówić.',
  micAutoStopped: 'Nagrywanie zakończone automatycznie (osiągnięto maksymalny czas). Dotknij mikrofonu ponownie, aby mówić dalej.',
  supportButton: 'Kontakt z pomocą',
  tabInterview: 'Wywiad',
  tabPhoto: 'Zdjęcia',
  // Dzieło życia / użytkownik końcowy
  tabSettings: 'Ustawienia',
  tabProof: 'Podgląd książki',
  settingsTitle: 'Ustawienia Twojej książki',
  settingsIntro: 'W każdej chwili możesz zmienić wygląd swojej książki. Ustawienia dotyczą gotowej książki, nie rozmowy.',
  settingsImageStyle: 'Styl graficzny ilustracji',
  settingsBookLayout: 'Styl tekstu (krój pisma i układ)',
  settingsWritingStyle: 'Styl narracji (ton opowieści)',
  settingsSaved: '✓ Zapisano',
  settingsSaveErr: 'Nie udało się zapisać ustawienia.',
  yourNameSelf: 'Twoje imię i nazwisko *',
  euDoneBody: 'Twoja historia życia została zapisana. Możesz wrócić w każdej chwili i opowiadać dalej.',
  // 2026-08-23 ergänzt: fiel vorher stillschweigend auf Deutsch zurück.
  nameNoticeSure: 'Ważne: Twoja wypowiedź pojawi się w gotowej księdze jako osobny rozdział — z Twoim imieniem w nagłówku. Zobaczy je każdy, kto przeczyta księgę.',
  nameNoticeMaybe: 'Uwaga: Twoja wypowiedź może pojawić się w gotowej księdze jako osobny rozdział z Twoim imieniem. O tym, jak zostanie zbudowana księga, zdecydujemy później.',
  mailAskLabel: 'Twój adres e-mail',
  mailSend: 'Wyślij',
  mailSent: '✓ E-mail wysłany.',
  mailInvalid: 'Podaj prawidłowy adres e-mail.',
  errMic: 'Mikrofon',
  // Stammbaum & Lebensposter: standen fest auf Deutsch im PDF-Zeichner
  // (lifeworkExtras.js) und wurden in jedes fremdsprachige Produkt gedruckt.
  treeTitle: 'Drzewo genealogiczne',
  treeBasis: 'Na podstawie opowiedzianych relacji rodzinnych.',
  treeMissingNote: 'Brakujące imiona oznaczono jako „Imię nieznane".',
  treeNoName: 'Imię nieznane',
  posterValues: 'WARTOŚCI',
  posterPlaces: 'MIEJSCA',
}

const EN = {
  locale: 'en-GB',
  genders: { 'männlich': 'Male', 'weiblich': 'Female', 'divers': 'Diverse', 'keine Angabe': 'Prefer not to say' },
  notFound: (noun) => `${noun} not found`,
  yourName: 'Your name *',
  fullName: 'Full name',
  yourGender: 'Your gender *',
  relationshipFallback: 'Your relationship *',
  relationshipHint: (name, gender) => {
    const n = name || 'the person'
    const role = gender === 'männlich' ? 'your father' : gender === 'weiblich' ? 'your mother' : 'your parent'
    return `From your perspective: who are you to ${name || 'this person'}? E.g. if ${n} is ${role}, enter “daughter” or “son” (meaning “I am ${n}’s daughter / son”).`
  },
  addressQ: 'How would you like to be addressed? *',
  addrInformalTitle: 'Casual', addrInformalSub: 'Informal, on first-name terms',
  addrFormalTitle: 'Formal', addrFormalSub: 'Polite, respectful',
  consentSpecialMemorial: 'health, circumstances of death or religion',
  consentSpecialOther: 'health or religion',
  consentText: (noun, special) =>
    `I expressly consent to my information and my interview – including possible details about ${special} (special categories of personal data under Art. 9 GDPR) – being processed to create the ${noun}. Processing is carried out using AI services that run exclusively in the EU (Microsoft Azure); no transfer to a third country takes place. Consent is voluntary and can be withdrawn at any time with future effect. Details in the `,
  nameNoticeSure: 'Important: your contribution will appear in the finished book as its own chapter — with your name above it. Everyone who reads the book can see it.',
  nameNoticeMaybe: 'Please note: your contribution may appear in the finished book as its own chapter with your name. How the book is composed is decided later.',
  consentLink: 'privacy policy',
  imprintLink: 'Imprint',
  consentAlready: 'Your data-protection consent is already on record.',
  introSkip: 'Skip →',
  doneTitle: 'Thank you very much',
  doneBody: (noun) => `Your contribution is now part of the shared ${noun} and will be preserved.`,
  resumeTitle: 'You have a contribution in progress',
  resumeLast: (d) => `Last activity: ${d}.`,
  resumeQ: 'Would you like to continue where you left off?',
  resumeContinue: '↻ Continue', resumeFresh: 'I am someone else',
  resumeKeep: 'Your previous contribution stays saved either way.',
  resumeRestart: "Start over", resumeRestartHint: "The interview starts from the beginning. Your previous answers stay saved.",
  resumeRestartCancel: "Cancel",
  pauseTitle: 'Continue later or finish now?',
  pauseIntro: 'Your answers so far have already been saved. You can come back at any time — in two ways:',
  pauseWay1Strong: '1. Simply open the same invitation link again.',
  pauseWay1Body: 'Your browser remembers your session automatically and will offer to continue next time.',
  pauseWay2Strong: '2. Optional:',
  pauseWay2Body: 'Additionally save this personal resume link — in case you switch devices or your browser data is cleared:',
  copyLink: '📋 Copy link', copied: '✓ Copied', mailBtn: '✉ Send by email',
  mailAskLabel: 'Your email address', mailSend: 'Send', mailSent: '✓ Email sent.', mailInvalid: 'Please enter a valid email address.',
  continueTalk: '← Keep talking', finishNow: '✓ Finish contribution now',
  mailSubject: (noun, name) => `My contribution to the ${noun}${name ? ' for ' + name : ''}`,
  mailBody: (noun, name, url) =>
`With this personal link I can continue my contribution to the ${noun}${name ? ' for ' + name : ''} later:

${url}

(Please do not share — the link leads directly to my personal contribution.)`,
  modeVoice: '🎙 Voice mode',
  pauseEnd: 'Continue later or finish',
  saveLabel: 'Save',
  cutoffNote: (d) => `Entries up to ${d} will be included.`,
  questionLabel: 'Question',
  progChapter: (n, total) => `Chapter ${n} of ${total}`,
  progQuestion: (n, total) => `Question ${n} of ${total}`,
  progDone: '✓ All questions answered',
  progAria: 'Progress through the question catalogue',
  loadingShort: 'Loading …', stop: '⏹ Stop', readAgain: '🔊 Read again', listen: '🔊 Listen',
  micRecording: 'Recording – click again to stop',
  micProcessing: 'Transcribing …',
  micIdle: 'Click the microphone to answer',
  autosaveNote: 'Your answers are saved automatically. You can talk for as long as you like, or click “Continue later or finish” above.',
  errTranscribe: 'Transcription', errMic: 'Microphone',
  legalGermanNote: 'Note: the privacy policy and legal notice are provided in German and are the legally authoritative version.',
  nextQuestion: 'Next question →', nextQuestionMsg: 'Please move on to the next question.',
  langPickTitle: 'Which language would you like to continue in?',
  chapterLabel: 'Chapter',
  contributorsHeading: 'Contributors to this book:',
  voicesHeading: 'What others remember',
  aiDisclaimerTitle: 'About the creation of this book',
  aiDisclaimer: 'This book was created with the help of artificial intelligence, based on interviews with people close to the person. It reflects the personal memories and accounts of the contributors. We cannot verify their accuracy, completeness or timeliness; liability for these is excluded to the extent permitted by law.',
  // Photo upload (at the end of the interview)
  uploadStepTitle: 'Would you like to add photos?',
  uploadStepIntro: 'You can upload personal photos to be considered when the book is designed. For each image you can optionally add a caption and a short description.',
  uploadPick: '＋ Choose photo',
  uploadCaption: 'Caption (optional)',
  uploadCaptionHint: 'If provided, it will be used in the book exactly as written.',
  uploadDesc: 'Image description (optional)',
  uploadDescHint: 'Only helps the AI place the image; it does not appear in the book.',
  uploadConsent: 'I confirm that I am entitled to upload these photos and that all persons shown (or their relatives) agree to the images being used to create the book and being processed and artistically altered by AI – including to stylistically place depicted persons into the period of a chapter. Processing is carried out using AI services that run exclusively in the EU.',
  uploadConsentRequired: 'Please confirm the declaration of consent to upload photos.',
  uploadSubmit: 'Upload photos',
  uploadSkip: 'Finish without photos',
  uploadUploading: 'Uploading …',
  uploadAdded: (n) => `${n} photo${n === 1 ? '' : 's'} added`,
  uploadError: 'Upload failed',
  uploadNoVideo: "Videos cannot be uploaded – please choose a photo.",
  micPrimeTitle: "Your browser is about to ask for the microphone",
  micPrimeBody: "The interview is spoken — the app needs access to your microphone. Please choose “Allow” in the next dialog. If you choose “Block”, the browser remembers that permanently, and you will not be able to speak until you change it in your device settings.",
  micPrimeOk: "Understood – continue",
  micPrimeLater: "Decide later",
  uploadRemove: 'Remove',
  uploadDoneBtn: 'Done',
  fbQuestion: 'How was the interview for you?',
  fbHint: 'Your brief feedback helps us improve the process (optional).',
  fbLabels: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
  fbTextPlaceholder: 'Would you like to tell us anything else? (optional)',
  fbSubmit: 'Send feedback',
  fbThanks: 'Thank you for your feedback!',
  fbSaveErr: 'The feedback could not be saved.',
  closeBtn: 'Finish',
  logout: 'Log out',
  closeHint: 'You can now close this window.',
  txSentLabel: '✓ Answer sent',
  txDelete: '🗑 Delete',
  txRedo: '↻ Record again',
  txShowEarlier: '↑ Show earlier', txHideEarlier: '↓ Hide earlier',
  txToggleLabel: 'Show transcript & correction options',
  txTab: 'Transcript & correction',
  companionTab: 'Assisted',
  menuTitle: 'Menu',
  companionOnMsg: "All right — I'll step back now and listen.",
  companionOffMsg: "I'm back.",
  micSelf: 'Narrator',
  micCompanion: 'Companion',
  timerRemaining: 'Remaining trial time',
  timerExpiredShort: '⏳ Trial time expired',
  timerExpired: 'The trial time has expired. You can still view the interview, but can no longer record answers. For an unlimited interview, please contact the provider.',
  unlockButton: 'Enter unlock code',
  unlockTitle: 'Enter unlock code',
  unlockHint: 'Enter your code to lift the time limit for good.',
  unlockSubmit: 'Redeem',
  unlockCancel: 'Cancel',
  unlockSuccess: '✓ Time limit lifted – you can now continue without any limit.',
  unlockInvalid: 'This unlock code is invalid or has already been redeemed.',
  micNoSound: 'No sound detected – the microphone stopped automatically. Tap again to speak.',
  micAutoStopped: 'Recording ended automatically (maximum length reached). Tap the microphone again to keep talking.',
  supportButton: 'Contact support',
  tabInterview: 'Interview',
  tabPhoto: 'Photos',
  // Life’s work / end user
  tabSettings: 'Settings',
  tabProof: 'Book preview',
  settingsTitle: 'Settings for your book',
  settingsIntro: 'You can change how your book will look at any time. These settings affect the finished book, not the conversation.',
  settingsImageStyle: 'Graphic style of the images',
  settingsBookLayout: 'Text style (typography & design)',
  settingsWritingStyle: 'Writing style (tone of the narrative)',
  settingsSaved: '✓ Saved',
  settingsSaveErr: 'The setting could not be saved.',
  yourNameSelf: 'Your name *',
  euDoneBody: 'Your life story has been saved. You can come back and continue at any time.',
  // Stammbaum & Lebensposter: standen fest auf Deutsch im PDF-Zeichner
  // (lifeworkExtras.js) und wurden in jedes fremdsprachige Produkt gedruckt.
  treeTitle: 'Family tree',
  treeBasis: 'Based on the relationships described in the interview.',
  treeMissingNote: 'Missing names are marked as “Name not given”.',
  treeNoName: 'Name not given',
  posterValues: 'VALUES',
  posterPlaces: 'PLACES',
}

// Schweizer Hochdeutsch = Deutsch ohne ß (kein eigenes Wörterbuch nötig).
const UI = { de: DE, 'de-CH': swissify(DE), pl: PL, en: EN, es: ES, it: IT, eu: EU, he: HE, ar: AR, fr: FR, ro: RO, tr: TR, ru: RU, uk: UK }
// Fehlt in einem Wörterbuch ein Schlüssel, fällt er auf Deutsch zurück (statt
// `undefined` → möglicher Absturz beim Rendern). So sind auch (noch) unvollständige
// Übersetzungen gefahrlos — der jeweilige Text erscheint dann eben auf Deutsch.
const UI_CACHE = {}
export function uiText(lang) {
  if (!lang || lang === DEFAULT_LANGUAGE) return DE
  if (UI_CACHE[lang]) return UI_CACHE[lang]
  const dict = UI[lang]
  const merged = dict ? { ...DE, ...dict } : DE
  UI_CACHE[lang] = merged
  return merged
}

// ── Hinweis zur Entstehung des Buches ─────────────────────────────
// Der Hinweis muss die TATSÄCHLICHE Entstehung beschreiben — sonst ist er
// Fassade. Zwei Dinge wechseln von Buch zu Buch:
//   1. Die Quelle des Textes: Beim Lebenswerk erzählt die Person ihr eigenes
//      Leben; bei allen anderen Kategorien erzählen Angehörige über sie.
//   2. Die Herkunft der Bilder: rein KI-erzeugt, KI-erzeugt MIT einem echten
//      Foto als Vorlage (Personen-Ähnlichkeit), eingebundene Originalfotos —
//      oder gar keine Bilder.
// `facts` wird beim Export aus dem Buch selbst ermittelt (siehe bookExport.js),
// nicht geraten.
const DISCLAIMER = {
  de: {
    textSelf: 'Dieses Buch wurde auf Grundlage eines Interviews mit der Person selbst mithilfe von künstlicher Intelligenz erstellt. Es gibt ihre eigenen Erinnerungen und Schilderungen wieder.',
    textOthers: 'Dieses Buch wurde auf Grundlage von Interviews mit nahestehenden Personen mithilfe von künstlicher Intelligenz erstellt. Es gibt persönliche Erinnerungen und Schilderungen der Beitragenden wieder.',
    liability: 'Die inhaltliche Richtigkeit, Vollständigkeit und Aktualität können wir nicht überprüfen; eine Haftung hierfür ist – soweit gesetzlich zulässig – ausgeschlossen.',
    imgAi: 'Die Bilder im Buch wurden vollständig von künstlicher Intelligenz erzeugt. Sie sind freie künstlerische Interpretationen der erzählten Szenen: Sie zeigen keine realen Aufnahmen und keine tatsächlichen Personen; Ähnlichkeiten sind nicht beabsichtigt.',
    imgAiRef: 'Die Bilder im Buch wurden von künstlicher Intelligenz erzeugt. Für die Darstellung von Personen wurden hochgeladene Originalfotos als Vorlage verwendet, damit die abgebildeten Menschen der Wirklichkeit ähneln (Bild-zu-Bild-Verfahren) und in die jeweilige Zeit des Kapitels versetzt werden. Es handelt sich dennoch nicht um echte Aufnahmen, sondern um künstlich erzeugte, künstlerisch veränderte Darstellungen.',
    imgPhotos: 'Außerdem enthält das Buch echte, von den Beitragenden hochgeladenen Fotografien. Sie wurden für die Buchseiten lediglich beschnitten, skaliert und angeordnet — ihr Inhalt wurde nicht verändert.',
    imgNone: 'Das Buch enthält keine Bilder.',
    poster: 'Die Illustrationen sind vollständig KI-erzeugt; alle Angaben, Jahreszahlen und Texte stammen aus dem Interview.',
  },
  pl: {
    textSelf: 'Ta księga powstała z pomocą sztucznej inteligencji na podstawie wywiadu z samą osobą. Oddaje jej własne wspomnienia i relacje.',
    textOthers: 'Ta księga powstała z pomocą sztucznej inteligencji, na podstawie rozmów z osobami bliskimi. Oddaje osobiste wspomnienia i relacje osób, które wzięły udział.',
    liability: 'Nie możemy zweryfikować ich poprawności, kompletności ani aktualności; odpowiedzialność za nie jest – w zakresie dozwolonym przez prawo – wyłączona.',
    imgAi: 'Ilustracje w księdze zostały w całości wygenerowane przez sztuczną inteligencję. Są swobodną interpretacją opowiedzianych scen: nie są prawdziwymi zdjęciami i nie przedstawiają rzeczywistych osób; podobieństwa są niezamierzone.',
    imgAiRef: 'Ilustracje wygenerowała sztuczna inteligencja. Do przedstawienia osób wykorzystano przesłane oryginalne zdjęcia jako wzór, aby postacie przypominały rzeczywistość (metoda obraz-do-obrazu) i zostały osadzone w czasie danego rozdziału. Mimo to nie są to prawdziwe fotografie, lecz obrazy wygenerowane i artystycznie zmienione.',
    imgPhotos: 'Księga zawiera ponadto prawdziwe zdjęcia przesłane przez uczestników. Zostały one jedynie wykadrowane, przeskalowane i rozmieszczone — ich treści nie zmieniono.',
    imgNone: 'Księga nie zawiera ilustracji.',
    poster: 'Ilustracje są w całości wygenerowane przez AI; wszystkie dane, daty i teksty pochodzą z wywiadu.',
  },
  en: {
    textSelf: 'This book was created with the help of artificial intelligence, based on an interview with the person themselves. It reflects their own memories and accounts.',
    textOthers: 'This book was created with the help of artificial intelligence, based on interviews with people close to the person. It reflects the personal memories and accounts of the contributors.',
    liability: 'We cannot verify their accuracy, completeness or timeliness; liability for these is excluded to the extent permitted by law.',
    imgAi: 'The images in this book were generated entirely by artificial intelligence. They are free artistic interpretations of the scenes described: they are not real photographs and do not depict actual people; any resemblance is unintended.',
    imgAiRef: 'The images in this book were generated by artificial intelligence. For the depiction of people, uploaded original photographs were used as a reference so that the persons shown resemble reality (image-to-image) and are placed in the period of the respective chapter. They are nevertheless not real photographs, but artificially generated and artistically altered depictions.',
    imgPhotos: 'The book also contains real photographs uploaded by the contributors. For the book pages they were only cropped, scaled and arranged — their content was not altered.',
    imgNone: 'The book contains no images.',
    poster: 'The illustrations are entirely AI-generated; all facts, years and texts come from the interview.',
  },
}

// Die neuen Sprachen (2026-07-15). Schweizer Hochdeutsch wird abgeleitet.
const DISCLAIMER_ES = {
  textSelf: 'Este libro se ha creado con ayuda de inteligencia artificial a partir de una entrevista con la propia persona. Recoge sus propios recuerdos y relatos.',
  textOthers: 'Este libro se ha creado con ayuda de inteligencia artificial a partir de entrevistas con personas cercanas. Recoge los recuerdos y relatos personales de quienes participaron.',
  liability: 'No podemos verificar su exactitud, integridad ni actualidad; se excluye toda responsabilidad en la medida permitida por la ley.',
  imgAi: 'Las imágenes del libro han sido generadas íntegramente por inteligencia artificial. Son interpretaciones artísticas libres de las escenas narradas: no son fotografías reales ni muestran a personas reales; cualquier parecido es involuntario.',
  imgAiRef: 'Las imágenes han sido generadas por inteligencia artificial. Para representar a las personas se han usado como referencia fotografías originales subidas, de modo que se parezcan a la realidad (procedimiento imagen a imagen) y aparezcan situadas en la época del capítulo. Aun así no son fotografías reales, sino representaciones generadas artificialmente y modificadas de forma artística.',
  imgPhotos: 'El libro contiene además fotografías reales subidas por los participantes. Para las páginas solo se han recortado, escalado y dispuesto; su contenido no se ha modificado.',
  imgNone: 'El libro no contiene imágenes.',
  poster: 'Las ilustraciones han sido generadas íntegramente por IA; todos los datos, años y textos proceden de la entrevista.',
}
const DISCLAIMER_IT = {
  textSelf: 'Questo libro è stato realizzato con l\'aiuto dell\'intelligenza artificiale, sulla base di un\'intervista con la persona stessa. Riporta i suoi ricordi e i suoi racconti.',
  textOthers: 'Questo libro è stato realizzato con l\'aiuto dell\'intelligenza artificiale, sulla base di interviste con persone vicine. Riporta ricordi e racconti personali di chi ha partecipato.',
  liability: 'Non possiamo verificarne l\'esattezza, la completezza e l\'attualità; ogni responsabilità è esclusa nei limiti consentiti dalla legge.',
  imgAi: 'Le immagini del libro sono state generate interamente dall\'intelligenza artificiale. Sono libere interpretazioni artistiche delle scene raccontate: non sono fotografie reali e non ritraggono persone reali; ogni somiglianza è involontaria.',
  imgAiRef: 'Le immagini sono state generate dall\'intelligenza artificiale. Per raffigurare le persone sono state usate come riferimento fotografie originali caricate, affinché le figure somiglino alla realtà (metodo immagine-a-immagine) e siano collocate nell\'epoca del capitolo. Non sono comunque fotografie reali, ma raffigurazioni generate artificialmente e modificate artisticamente.',
  imgPhotos: 'Il libro contiene inoltre vere fotografie caricate dai partecipanti. Per le pagine sono state solo ritagliate, ridimensionate e disposte; il loro contenuto non è stato alterato.',
  imgNone: 'Il libro non contiene immagini.',
  poster: 'Le illustrazioni sono interamente generate dall\'IA; tutti i dati, gli anni e i testi provengono dall\'intervista.',
}
const DISCLAIMER_EU = {
  textSelf: 'Liburu hau adimen artifizialaren laguntzarekin sortu da, pertsonari berari egindako elkarrizketan oinarrituta. Bere oroitzapenak eta kontakizunak jasotzen ditu.',
  textOthers: 'Liburu hau adimen artifizialaren laguntzarekin sortu da, hurbilekoei egindako elkarrizketetan oinarrituta. Parte hartu dutenen oroitzapen eta kontakizun pertsonalak jasotzen ditu.',
  liability: 'Ezin dugu haien zehaztasuna, osotasuna eta gaurkotasuna egiaztatu; erantzukizuna baztertuta dago legeak onartzen duen neurrian.',
  imgAi: 'Liburuko irudiak osorik adimen artifizialak sortu ditu. Kontatutako eszenen interpretazio artistiko libreak dira: ez dira benetako argazkiak, ez dituzte benetako pertsonak erakusten; antzekotasunak ez dira nahita eginak.',
  imgAiRef: 'Irudiak adimen artifizialak sortu ditu. Pertsonak irudikatzeko, igotako jatorrizko argazkiak erabili dira erreferentzia gisa, agertzen direnak errealitatearen antza izan dezaten (irudi-irudira metodoa) eta kapituluaren garaian koka daitezen. Hala ere, ez dira benetako argazkiak, artifizialki sortutako eta artistikoki aldatutako irudikapenak baizik.',
  imgPhotos: 'Liburuak, gainera, parte-hartzaileek igotako benetako argazkiak ditu. Orrialdeetarako mozketa, eskalatze eta kokapena baino ez zaie egin; edukia ez da aldatu.',
  imgNone: 'Liburuak ez du irudirik.',
  poster: 'Ilustrazioak osorik IAk sortuak dira; datu, urte eta testu guztiak elkarrizketatik datoz.',
}
const DISCLAIMER_FR = {
  textSelf: 'Ce livre a été créé à l’aide de l’intelligence artificielle, à partir d’un entretien avec la personne elle-même. Il restitue ses propres souvenirs et récits.',
  textOthers: 'Ce livre a été créé à l’aide de l’intelligence artificielle, à partir d’entretiens avec des proches. Il restitue les souvenirs et les récits personnels des participants.',
  liability: 'Nous ne pouvons vérifier ni leur exactitude, ni leur exhaustivité, ni leur actualité ; toute responsabilité à cet égard est exclue dans les limites autorisées par la loi.',
  imgAi: 'Les images de ce livre ont été entièrement générées par l’intelligence artificielle. Ce sont des interprétations artistiques libres des scènes racontées : ce ne sont pas de véritables photographies et elles ne représentent pas de personnes réelles ; toute ressemblance est involontaire.',
  imgAiRef: 'Les images ont été générées par l’intelligence artificielle. Pour représenter les personnes, des photographies originales téléversées ont servi de modèle afin que les personnes figurées ressemblent à la réalité (procédé image-à-image) et soient replacées à l’époque du chapitre concerné. Il ne s’agit néanmoins pas de véritables photographies, mais de représentations générées artificiellement et modifiées sur le plan artistique.',
  imgPhotos: 'Le livre contient en outre de véritables photographies téléversées par les participants. Elles ont uniquement été recadrées, redimensionnées et disposées pour les pages du livre — leur contenu n’a pas été modifié.',
  imgNone: 'Le livre ne contient aucune image.',
  poster: 'Les illustrations sont entièrement générées par l’IA ; toutes les informations, les dates et les textes proviennent de l’entretien.',
}
const DISCLAIMER_RO = {
  textSelf: 'Această carte a fost realizată cu ajutorul inteligenței artificiale, pe baza unui interviu cu persoana însăși. Ea redă amintirile și relatările sale.',
  textOthers: 'Această carte a fost realizată cu ajutorul inteligenței artificiale, pe baza unor interviuri cu persoane apropiate. Ea redă amintirile și relatările personale ale celor care au contribuit.',
  liability: 'Nu putem verifica corectitudinea, caracterul complet și actualitatea acestora; răspunderea pentru acestea este exclusă în măsura permisă de lege.',
  imgAi: 'Imaginile din carte au fost generate integral de inteligența artificială. Sunt interpretări artistice libere ale scenelor povestite: nu sunt fotografii reale și nu înfățișează persoane reale; orice asemănare este neintenționată.',
  imgAiRef: 'Imaginile au fost generate de inteligența artificială. Pentru reprezentarea persoanelor au fost folosite ca model fotografii originale încărcate, astfel încât oamenii înfățișați să semene cu realitatea (procedeu imagine-la-imagine) și să fie plasați în epoca capitolului respectiv. Cu toate acestea, nu sunt fotografii reale, ci reprezentări generate artificial și modificate artistic.',
  imgPhotos: 'Cartea conține, în plus, fotografii reale încărcate de participanți. Pentru paginile cărții ele au fost doar decupate, redimensionate și așezate — conținutul lor nu a fost modificat.',
  imgNone: 'Cartea nu conține imagini.',
  poster: 'Ilustrațiile sunt generate integral de IA; toate datele, anii și textele provin din interviu.',
}
const DISCLAIMER_TR = {
  textSelf: 'Bu kitap, kişinin kendisiyle yapılan bir görüşmeye dayanarak yapay zekâ yardımıyla oluşturulmuştur. Kişinin kendi anılarını ve anlatılarını yansıtır.',
  textOthers: 'Bu kitap, yakınlarıyla yapılan görüşmelere dayanarak yapay zekâ yardımıyla oluşturulmuştur. Katkıda bulunanların kişisel anılarını ve anlatılarını yansıtır.',
  liability: 'İçeriğin doğruluğunu, eksiksizliğini ve güncelliğini denetleyemeyiz; buna ilişkin sorumluluk, yasaların izin verdiği ölçüde kabul edilmemektedir.',
  imgAi: 'Kitaptaki görseller tümüyle yapay zekâ tarafından üretilmiştir. Anlatılan sahnelerin özgür sanatsal yorumlarıdır: gerçek fotoğraf değildir ve gerçek kişileri göstermez; benzerlikler amaçlanmamıştır.',
  imgAiRef: 'Görseller yapay zekâ tarafından üretilmiştir. Kişilerin gösterilmesinde, yüklenen özgün fotoğraflar örnek alınmıştır; böylece görülen insanlar gerçeğe benzer (görselden görsele yöntemi) ve ilgili bölümün dönemine yerleştirilir. Yine de bunlar gerçek fotoğraflar değil, yapay olarak üretilmiş ve sanatsal biçimde değiştirilmiş betimlemelerdir.',
  imgPhotos: 'Kitap ayrıca katkıda bulunanların yüklediği gerçek fotoğrafları içerir. Kitap sayfaları için yalnızca kırpılmış, ölçeklenmiş ve yerleştirilmişlerdir — içerikleri değiştirilmemiştir.',
  imgNone: 'Kitapta görsel bulunmamaktadır.',
  poster: 'Çizimler tümüyle yapay zekâ tarafından üretilmiştir; tüm bilgiler, yıllar ve metinler görüşmeden alınmıştır.',
}
const DISCLAIMER_RU = {
  textSelf: 'Эта книга создана с помощью искусственного интеллекта на основе интервью с самим человеком. Она передаёт его собственные воспоминания и рассказы.',
  textOthers: 'Эта книга создана с помощью искусственного интеллекта на основе интервью с близкими людьми. Она передаёт личные воспоминания и рассказы участников.',
  liability: 'Мы не можем проверить их достоверность, полноту и актуальность; ответственность за это исключается в пределах, допускаемых законом.',
  imgAi: 'Изображения в книге полностью созданы искусственным интеллектом. Это свободные художественные интерпретации рассказанных сцен: это не настоящие фотографии, и на них не изображены реальные люди; любое сходство непреднамеренно.',
  imgAiRef: 'Изображения созданы искусственным интеллектом. Для изображения людей в качестве образца использовались загруженные оригинальные фотографии, чтобы изображённые люди были похожи на настоящих (метод «изображение в изображение») и были перенесены во время соответствующей главы. Тем не менее это не настоящие фотографии, а искусственно созданные и художественно изменённые изображения.',
  imgPhotos: 'Кроме того, книга содержит настоящие фотографии, загруженные участниками. Для книжных страниц их только обрезали, масштабировали и разместили — их содержание не изменялось.',
  imgNone: 'Книга не содержит изображений.',
  poster: 'Иллюстрации полностью созданы ИИ; все сведения, годы и тексты взяты из интервью.',
}
const DISCLAIMER_UK = {
  textSelf: 'Ця книга створена за допомогою штучного інтелекту на основі інтерв’ю із самою людиною. Вона передає її власні спогади та розповіді.',
  textOthers: 'Ця книга створена за допомогою штучного інтелекту на основі інтерв’ю з близькими людьми. Вона передає особисті спогади та розповіді учасників.',
  liability: 'Ми не можемо перевірити їхню правильність, повноту та актуальність; відповідальність за це виключається в межах, дозволених законом.',
  imgAi: 'Зображення в книзі повністю створені штучним інтелектом. Це вільні художні інтерпретації розказаних сцен: це не справжні фотографії, і на них не зображено реальних людей; будь-яка схожість є ненавмисною.',
  imgAiRef: 'Зображення створені штучним інтелектом. Для зображення людей як зразок використано завантажені оригінальні світлини, щоб зображені люди були схожі на справжніх (метод «зображення в зображення») і були перенесені в час відповідного розділу. Втім, це не справжні фотографії, а штучно створені та художньо змінені зображення.',
  imgPhotos: 'Крім того, книга містить справжні фотографії, завантажені учасниками. Для книжкових сторінок їх лише обрізали, масштабували та розмістили — їхній зміст не змінювався.',
  imgNone: 'Книга не містить зображень.',
  poster: 'Ілюстрації повністю створені ШІ; усі відомості, роки та тексти взяті з інтерв’ю.',
}
const DISCLAIMER_HE = {
  textSelf: 'הספר נוצר בעזרת בינה מלאכותית, על בסיס ראיון עם האדם עצמו. הוא משקף את זיכרונותיו ותיאוריו.',
  textOthers: 'הספר נוצר בעזרת בינה מלאכותית, על בסיס ראיונות עם אנשים קרובים. הוא משקף זיכרונות ותיאורים אישיים של המשתתפים.',
  liability: 'איננו יכולים לאמת את נכונותם, שלמותם ועדכניותם; האחריות לכך מוחרגת ככל שהחוק מתיר.',
  imgAi: 'האיורים בספר נוצרו כולם בידי בינה מלאכותית. הם פרשנות אמנותית חופשית של הסצנות המסופרות: אינם צילומים אמיתיים ואינם מציגים אנשים ממשיים; כל דמיון אינו מכוון.',
  imgAiRef: 'האיורים נוצרו בידי בינה מלאכותית. לצורך הצגת אנשים שימשו צילומים מקוריים שהועלו כהשראה, כדי שהדמויות ידמו למציאות (שיטת תמונה-לתמונה) וימוקמו בתקופת הפרק. עם זאת אין אלה צילומים אמיתיים, אלא ייצוגים שנוצרו באופן מלאכותי ושונו אמנותית.',
  imgPhotos: 'הספר כולל גם צילומים אמיתיים שהעלו המשתתפים. לצורך עמודי הספר הם רק נחתכו, הוקטנו וסודרו — תוכנם לא שונה.',
  imgNone: 'הספר אינו כולל תמונות.',
  poster: 'האיורים נוצרו כולם בידי בינה מלאכותית; כל הנתונים, השנים והטקסטים לקוחים מהראיון.',
}
const DISCLAIMER_AR = {
  textSelf: 'أُعدّ هذا الكتاب بمساعدة الذكاء الاصطناعي، استناداً إلى مقابلة مع الشخص نفسه. وهو يعكس ذكرياته ورواياته.',
  textOthers: 'أُعدّ هذا الكتاب بمساعدة الذكاء الاصطناعي، استناداً إلى مقابلات مع أشخاص مقرّبين. وهو يعكس ذكريات المشاركين ورواياتهم الشخصية.',
  liability: 'لا يمكننا التحقق من صحتها أو اكتمالها أو حداثتها؛ وتُستبعد المسؤولية عن ذلك بالقدر الذي يسمح به القانون.',
  imgAi: 'وُلِّدت جميع صور الكتاب بواسطة الذكاء الاصطناعي. وهي تفسيرات فنية حرة للمشاهد المروية: ليست صوراً حقيقية ولا تُظهر أشخاصاً حقيقيين؛ وأي تشابه غير مقصود.',
  imgAiRef: 'وُلِّدت الصور بواسطة الذكاء الاصطناعي. ولتصوير الأشخاص استُخدمت صور أصلية مرفوعة كمرجع، كي تشبه الشخصيات الواقع (أسلوب صورة إلى صورة) وتُوضع في زمن الفصل المعني. ومع ذلك فهي ليست صوراً حقيقية، بل تمثيلات مولَّدة اصطناعياً ومعدَّلة فنياً.',
  imgPhotos: 'يحتوي الكتاب أيضاً على صور حقيقية رفعها المشاركون. ولم يجرِ عليها سوى القص وتغيير الحجم والترتيب لأغراض الصفحات؛ ولم يُغيَّر محتواها.',
  imgNone: 'لا يحتوي الكتاب على صور.',
  poster: 'الرسوم مولَّدة بالكامل بالذكاء الاصطناعي؛ وجميع المعلومات والسنوات والنصوص مأخوذة من المقابلة.',
}
Object.assign(DISCLAIMER, {
  'de-CH': swissify(DISCLAIMER.de),
  es: DISCLAIMER_ES, it: DISCLAIMER_IT, eu: DISCLAIMER_EU, fr: DISCLAIMER_FR, ro: DISCLAIMER_RO,
  tr: DISCLAIMER_TR, ru: DISCLAIMER_RU, uk: DISCLAIMER_UK, he: DISCLAIMER_HE, ar: DISCLAIMER_AR,
})

// `facts` = { selfNarrated, hasAiImages, hasReferenceImages, hasRealPhotos }
// `facts.noImages` laesst jeden Bildhinweis weg — fuer das Hoerbuch, in dem die
// Bilder des Buchs gar nicht vorkommen; dort waere jeder Satz darueber (auch
// „Das Buch enthaelt keine Bilder.") nur verwirrend. Der uebrige Hinweis auf
// die KI-Erstellung und der Haftungssatz werden weiterhin vorgelesen.
export function bookDisclaimer(lang, facts = {}) {
  const t = DISCLAIMER[lang] || DISCLAIMER.de
  const parts = [facts.selfNarrated ? t.textSelf : t.textOthers, t.liability]
  if (facts.noImages) return parts.join(' ')
  if (facts.hasAiImages) parts.push(facts.hasReferenceImages ? t.imgAiRef : t.imgAi)
  if (facts.hasRealPhotos) parts.push(t.imgPhotos)
  if (!facts.hasAiImages && !facts.hasRealPhotos) parts.push(t.imgNone)
  return parts.join(' ')
}

// Welche Bildquellen stecken TATSÄCHLICH in diesem Buch? Wird aus den Kapiteln
// gelesen (from_upload = komponierte Originalfotos, image_ref = KI-Bild mit echtem
// Foto als Vorlage), nicht aus Einstellungen abgeleitet.
export function imageFacts(book) {
  const chapters = Array.isArray(book?.chapters) ? book.chapters : []
  return {
    hasAiImages: chapters.some(c => c?.image_path && !c?.from_upload),
    hasReferenceImages: chapters.some(c => c?.image_path && !c?.from_upload && c?.image_ref),
    hasRealPhotos: chapters.some(c => c?.image_path && c?.from_upload),
  }
}

// ── Kategorie-spezifische, beitragendenseitige Texte ──────────────
// Deutsch stammt aus src/categories.js; pl/en als Overlay (sonst Fallback DE).
const CONTRIB = {
  pl: {
    memorial:      { nounBook: 'księga pamiątkowa', heading: 'Twoje wspomnienie', introNoun: 'Księga pamiątkowa dla', relationshipLabel: 'Twoja relacja z {name} *', relationshipPlaceholder: 'np. córka, przyjaciel, kolega, sąsiad …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla osoby {name}? Wpisz swoją rolę – np. „córka" lub „syn" (w sensie „jestem córką / synem osoby {name}").', consentNoun: 'księgi pamiątkowej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    birthday:      { nounBook: 'księga urodzinowa', heading: 'Twój wkład', introNoun: 'Księga urodzinowa dla', relationshipLabel: 'Twoja relacja z {name} *', relationshipPlaceholder: 'np. córka, przyjaciel, koleżanka …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla osoby {name}? Wpisz swoją rolę – np. „córka", „przyjaciel" lub „koleżanka".', consentNoun: 'księgi urodzinowej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    anniversary:   { nounBook: 'księga jubileuszowa', heading: 'Twój wkład', introNoun: 'Księga jubileuszowa dla', relationshipLabel: 'Twoja relacja z parą *', relationshipPlaceholder: 'np. dziecko, przyjaciółka, świadek …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla tej pary? Wpisz swoją rolę – np. „dziecko", „świadek" lub „wieloletnia przyjaciółka".', consentNoun: 'księgi jubileuszowej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    farewell:      { nounBook: 'księga pożegnalna', heading: 'Twój wkład', introNoun: 'Księga pożegnalna dla', relationshipLabel: 'Twoja relacja z {name} *', relationshipPlaceholder: 'np. kolega, członek klubu, współpracowniczka …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla osoby {name}? Wpisz swoją rolę – np. „kolega", „członek klubu" lub „towarzyszka".', consentNoun: 'księgi pożegnalnej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    service:       { nounBook: 'księga jubileuszowa', heading: 'Twój wkład', introNoun: 'Księga jubileuszowa dla', relationshipLabel: 'Twoja relacja z {name} *', relationshipPlaceholder: 'np. kolega, przełożona, członek zespołu …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla osoby {name}? Wpisz swoją rolę – np. „kolega", „przełożona" lub „członek zespołu".', consentNoun: 'księgi jubileuszowej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    company:       { nounBook: 'księga jubileuszowa', heading: 'Twój wkład', introNoun: 'Księga jubileuszowa dla', relationshipLabel: 'Twój związek z {name} *', relationshipPlaceholder: 'np. pracowniczka, założyciel, członek, klientka …', relationshipHint: 'Z Twojej perspektywy: jak jesteś związany z {name}? Wpisz swoją rolę – np. „pracowniczka", „założyciel", „członek" lub „klientka".', consentNoun: 'księgi jubileuszowej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    newborn:       { nounBook: 'księga powitalna', heading: 'Twoje życzenia', introNoun: 'Księga powitalna dla', relationshipLabel: 'Twoja relacja z rodziną *', relationshipPlaceholder: 'np. babcia, wujek, przyjaciółka rodziców …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla dziecka i jego rodziny? Wpisz swoją rolę – np. „babcia", „wujek" lub „przyjaciółka rodziców".', consentNoun: 'księgi powitalnej', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    encouragement: { nounBook: 'księga otuchy', heading: 'Twoja wiadomość', introNoun: 'Księga otuchy dla', relationshipLabel: 'Twoja relacja z {name} *', relationshipPlaceholder: 'np. siostra, przyjaciel, koleżanka …', relationshipHint: 'Z Twojej perspektywy: kim jesteś dla osoby {name}? Wpisz swoją rolę – np. „siostra", „przyjaciel" lub „koleżanka".', consentNoun: 'księgi otuchy', interviewButton: '🎙 Rozpocznij wywiad głosowy →' },
    lifework:      { nounBook: 'dzieło życia', heading: 'Twoja historia życia', introNoun: 'Dzieło życia:', consentNoun: 'mojego dzieła życia (autobiografii)', interviewButton: '🎙 Rozpocznij rozmowę →' },
    anamnesis:     { nounBook: 'kwestionariusz wywiadu medycznego', heading: 'Twój wywiad medyczny', introNoun: 'Wywiad medyczny dla', consentNoun: 'kwestionariusza wywiadu medycznego', interviewButton: '🎙 Rozpocznij rozmowę →' },
    anamnesis_kvsw:{ nounBook: 'kwestionariusz wywiadu medycznego', heading: 'Twój wywiad medyczny', introNoun: 'Wywiad medyczny dla', consentNoun: 'kwestionariusza wywiadu medycznego', interviewButton: '🎙 Rozpocznij rozmowę →' },
  },
  en: {
    memorial:      { nounBook: 'memorial book', heading: 'Your memory', introNoun: 'Memorial book for', relationshipLabel: 'Your relationship to {name} *', relationshipPlaceholder: 'e.g. daughter, friend, colleague, neighbour …', relationshipHint: 'From your perspective: who are you to {name}? Enter your own role – e.g. “daughter” or “son” (meaning “I am {name}’s daughter / son”).', consentNoun: 'memorial book', interviewButton: '🎙 Start voice interview →' },
    birthday:      { nounBook: 'birthday book', heading: 'Your contribution', introNoun: 'Birthday book for', relationshipLabel: 'Your relationship to {name} *', relationshipPlaceholder: 'e.g. daughter, friend, colleague …', relationshipHint: 'From your perspective: who are you to {name}? Enter your own role – e.g. “daughter”, “friend” or “colleague”.', consentNoun: 'birthday book', interviewButton: '🎙 Start voice interview →' },
    anniversary:   { nounBook: 'anniversary book', heading: 'Your contribution', introNoun: 'Anniversary book for', relationshipLabel: 'Your relationship to the couple *', relationshipPlaceholder: 'e.g. child, friend, witness …', relationshipHint: 'From your perspective: who are you to the couple? Enter your own role – e.g. “child”, “witness” or “long-time friend”.', consentNoun: 'anniversary book', interviewButton: '🎙 Start voice interview →' },
    farewell:      { nounBook: 'farewell book', heading: 'Your contribution', introNoun: 'Farewell book for', relationshipLabel: 'Your relationship to {name} *', relationshipPlaceholder: 'e.g. colleague, club member, companion …', relationshipHint: 'From your perspective: who are you to {name}? Enter your own role – e.g. “colleague”, “club member” or “companion”.', consentNoun: 'farewell book', interviewButton: '🎙 Start voice interview →' },
    service:       { nounBook: 'anniversary book', heading: 'Your contribution', introNoun: 'Work anniversary book for', relationshipLabel: 'Your relationship to {name} *', relationshipPlaceholder: 'e.g. colleague, manager, team member …', relationshipHint: 'From your perspective: who are you to {name}? Enter your own role – e.g. “colleague”, “manager” or “team member”.', consentNoun: 'work anniversary book', interviewButton: '🎙 Start voice interview →' },
    company:       { nounBook: 'anniversary book', heading: 'Your contribution', introNoun: 'Anniversary book for', relationshipLabel: 'Your connection to {name} *', relationshipPlaceholder: 'e.g. employee, founder, member, customer …', relationshipHint: 'From your perspective: how are you connected to {name}? Enter your role – e.g. “employee”, “founder”, “member” or “customer”.', consentNoun: 'anniversary book', interviewButton: '🎙 Start voice interview →' },
    newborn:       { nounBook: 'welcome book', heading: 'Your wishes', introNoun: 'Welcome book for', relationshipLabel: 'Your relationship to the family *', relationshipPlaceholder: 'e.g. grandma, uncle, friend of the parents …', relationshipHint: 'From your perspective: who are you to the child and its family? Enter your role – e.g. “grandma”, “uncle” or “friend of the parents”.', consentNoun: 'welcome book', interviewButton: '🎙 Start voice interview →' },
    encouragement: { nounBook: 'book of encouragement', heading: 'Your message', introNoun: 'Book of encouragement for', relationshipLabel: 'Your relationship to {name} *', relationshipPlaceholder: 'e.g. sister, friend, colleague …', relationshipHint: 'From your perspective: who are you to {name}? Enter your own role – e.g. “sister”, “friend” or “colleague”.', consentNoun: 'book of encouragement', interviewButton: '🎙 Start voice interview →' },
    lifework:      { nounBook: 'life’s work', heading: 'Your life story', introNoun: 'Life’s work of', consentNoun: 'life’s work (autobiography)', interviewButton: '🎙 Start the conversation →' },
    anamnesis:     { nounBook: 'medical intake form', heading: 'Your medical intake', introNoun: 'Medical intake for', consentNoun: 'medical intake form', interviewButton: '🎙 Start the interview →' },
    anamnesis_kvsw:{ nounBook: 'medical intake form', heading: 'Your medical intake', introNoun: 'Medical intake for', consentNoun: 'medical intake form', interviewButton: '🎙 Start the interview →' },
  },
  es: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'libro conmemorativo', heading: 'Su recuerdo', introNoun: 'Libro conmemorativo para', relationshipLabel: 'Su relación con {name} *', relationshipPlaceholder: 'p. ej. hija, amigo, compañero de trabajo, vecino …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para {name}? Indique su propio papel, por ejemplo «hija» o «hijo».', consentNoun: 'el libro conmemorativo', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    birthday:     { nounBook: 'libro de cumpleaños', heading: 'Su aportación', introNoun: 'Libro de cumpleaños para', relationshipLabel: 'Su relación con {name} *', relationshipPlaceholder: 'p. ej. hija, amigo, compañera de trabajo …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para {name}? Indique su propio papel, por ejemplo «hija», «amigo» o «compañera».', consentNoun: 'el libro de cumpleaños', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    anniversary:  { nounBook: 'libro de aniversario', heading: 'Su aportación', introNoun: 'Libro de aniversario para', relationshipLabel: 'Su relación con la pareja *', relationshipPlaceholder: 'p. ej. hijo, amiga, testigo de boda …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para la pareja? Indique su propio papel, por ejemplo «hijo», «testigo de boda» o «amiga de toda la vida».', consentNoun: 'el libro de aniversario', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    farewell:     { nounBook: 'libro de despedida', heading: 'Su aportación', introNoun: 'Libro de despedida para', relationshipLabel: 'Su relación con {name} *', relationshipPlaceholder: 'p. ej. compañero, socio del club, compañera de camino …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para {name}? Indique su propio papel, por ejemplo «compañero», «socio del club» o «compañera de camino».', consentNoun: 'el libro de despedida', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    service:      { nounBook: 'libro de aniversario laboral', heading: 'Su aportación', introNoun: 'Libro de aniversario laboral para', relationshipLabel: 'Su relación con {name} *', relationshipPlaceholder: 'p. ej. compañero, jefa, miembro del equipo …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para {name}? Indique su propio papel, por ejemplo «compañero», «jefa» o «miembro del equipo».', consentNoun: 'el libro de aniversario laboral', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    company:      { nounBook: 'libro de aniversario', heading: 'Su aportación', introNoun: 'Libro de aniversario para', relationshipLabel: 'Su vínculo con {name} *', relationshipPlaceholder: 'p. ej. empleada, fundador, socio, clienta …', relationshipHint: 'Desde su punto de vista: ¿cómo está vinculado con {name}? Indique su papel, por ejemplo «empleada», «fundador», «socio» o «clienta».', consentNoun: 'el libro de aniversario', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    newborn:      { nounBook: 'libro de bienvenida', heading: 'Sus deseos', introNoun: 'Libro de bienvenida para', relationshipLabel: 'Su relación con la familia *', relationshipPlaceholder: 'p. ej. abuela, tío, amiga de los padres …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para el bebé y su familia? Indique su papel, por ejemplo «abuela», «tío» o «amiga de los padres».', consentNoun: 'el libro de bienvenida', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    encouragement:{ nounBook: 'libro de ánimo', heading: 'Su mensaje', introNoun: 'Libro de ánimo para', relationshipLabel: 'Su relación con {name} *', relationshipPlaceholder: 'p. ej. hermana, amigo, compañera …', relationshipHint: 'Desde su punto de vista: ¿quién es usted para {name}? Indique su propio papel, por ejemplo «hermana», «amigo» o «compañera».', consentNoun: 'el libro de ánimo', interviewButton: '🎙 Comenzar la entrevista de voz →' },
    lifework: { nounBook: 'obra de vida', heading: 'La historia de su vida', introNoun: 'Obra de vida de', consentNoun: 'mi obra de vida (autobiografía)', interviewButton: '🎙 Comenzar la conversación →' },
    anamnesis: { nounBook: 'cuestionario de anamnesis', heading: 'Su anamnesis médica', introNoun: 'Anamnesis para', consentNoun: 'cuestionario de anamnesis', interviewButton: '🎙 Comenzar la entrevista →' },
    anamnesis_kvsw: { nounBook: 'cuestionario de anamnesis', heading: 'Su anamnesis médica', introNoun: 'Anamnesis para', consentNoun: 'cuestionario de anamnesis', interviewButton: '🎙 Comenzar la entrevista →' },
  },
  it: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'libro della memoria', heading: 'Il suo ricordo', introNoun: 'Libro della memoria per', relationshipLabel: 'Il suo rapporto con {name} *', relationshipPlaceholder: 'p. es. figlia, amico, collega, vicino …', relationshipHint: 'Dal suo punto di vista: chi è lei per {name}? Indichi il suo ruolo, per esempio «figlia» o «figlio».', consentNoun: 'del libro della memoria', interviewButton: '🎙 Inizia l’intervista vocale →' },
    birthday:     { nounBook: 'libro di compleanno', heading: 'Il suo contributo', introNoun: 'Libro di compleanno per', relationshipLabel: 'Il suo rapporto con {name} *', relationshipPlaceholder: 'p. es. figlia, amico, collega …', relationshipHint: 'Dal suo punto di vista: chi è lei per {name}? Indichi il suo ruolo, per esempio «figlia», «amico» o «collega».', consentNoun: 'del libro di compleanno', interviewButton: '🎙 Inizia l’intervista vocale →' },
    anniversary:  { nounBook: 'libro dell’anniversario', heading: 'Il suo contributo', introNoun: 'Libro dell’anniversario per', relationshipLabel: 'Il suo rapporto con la coppia *', relationshipPlaceholder: 'p. es. figlio, amica, testimone di nozze …', relationshipHint: 'Dal suo punto di vista: chi è lei per la coppia? Indichi il suo ruolo, per esempio «figlio», «testimone di nozze» o «amica di lunga data».', consentNoun: 'del libro dell’anniversario', interviewButton: '🎙 Inizia l’intervista vocale →' },
    farewell:     { nounBook: 'libro del commiato', heading: 'Il suo contributo', introNoun: 'Libro del commiato per', relationshipLabel: 'Il suo rapporto con {name} *', relationshipPlaceholder: 'p. es. collega, compagno di associazione, compagna di strada …', relationshipHint: 'Dal suo punto di vista: chi è lei per {name}? Indichi il suo ruolo, per esempio «collega», «compagno di associazione» o «compagna di strada».', consentNoun: 'del libro del commiato', interviewButton: '🎙 Inizia l’intervista vocale →' },
    service:      { nounBook: 'libro dell’anniversario di servizio', heading: 'Il suo contributo', introNoun: 'Libro dell’anniversario di servizio per', relationshipLabel: 'Il suo rapporto con {name} *', relationshipPlaceholder: 'p. es. collega, responsabile, membro del team …', relationshipHint: 'Dal suo punto di vista: chi è lei per {name}? Indichi il suo ruolo, per esempio «collega», «responsabile» o «membro del team».', consentNoun: 'del libro dell’anniversario di servizio', interviewButton: '🎙 Inizia l’intervista vocale →' },
    company:      { nounBook: 'libro dell’anniversario', heading: 'Il suo contributo', introNoun: 'Libro dell’anniversario per', relationshipLabel: 'Il suo legame con {name} *', relationshipPlaceholder: 'p. es. dipendente, fondatore, socio, cliente …', relationshipHint: 'Dal suo punto di vista: che legame ha con {name}? Indichi il suo ruolo, per esempio «dipendente», «fondatore», «socio» o «cliente».', consentNoun: 'del libro dell’anniversario', interviewButton: '🎙 Inizia l’intervista vocale →' },
    newborn:      { nounBook: 'libro di benvenuto', heading: 'I suoi auguri', introNoun: 'Libro di benvenuto per', relationshipLabel: 'Il suo rapporto con la famiglia *', relationshipPlaceholder: 'p. es. nonna, zio, amica dei genitori …', relationshipHint: 'Dal suo punto di vista: chi è lei per il bambino e la sua famiglia? Indichi il suo ruolo, per esempio «nonna», «zio» o «amica dei genitori».', consentNoun: 'del libro di benvenuto', interviewButton: '🎙 Inizia l’intervista vocale →' },
    encouragement:{ nounBook: 'libro di incoraggiamento', heading: 'Il suo messaggio', introNoun: 'Libro di incoraggiamento per', relationshipLabel: 'Il suo rapporto con {name} *', relationshipPlaceholder: 'p. es. sorella, amico, collega …', relationshipHint: 'Dal suo punto di vista: chi è lei per {name}? Indichi il suo ruolo, per esempio «sorella», «amico» o «collega».', consentNoun: 'del libro di incoraggiamento', interviewButton: '🎙 Inizia l’intervista vocale →' },
    lifework: { nounBook: 'opera di una vita', heading: 'La storia della sua vita', introNoun: 'Opera di una vita di', consentNoun: 'la mia opera di una vita (autobiografia)', interviewButton: '🎙 Iniziare la conversazione →' },
    anamnesis: { nounBook: 'questionario anamnestico', heading: 'La sua anamnesi', introNoun: 'Anamnesi per', consentNoun: 'questionario anamnestico', interviewButton: '🎙 Iniziare l’intervista →' },
    anamnesis_kvsw: { nounBook: 'questionario anamnestico', heading: 'La sua anamnesi', introNoun: 'Anamnesi per', consentNoun: 'questionario anamnestico', interviewButton: '🎙 Iniziare l’intervista →' },
  },
  eu: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'oroitzapen-liburua', heading: 'Zure oroitzapena', introNoun: 'Oroitzapen-liburua:', relationshipLabel: 'Zure harremana {name}(r)ekin *', relationshipPlaceholder: 'adib. alaba, laguna, lankidea, auzokidea …', relationshipHint: 'Zure ikuspegitik: nor zara {name}(r)entzat? Idatzi zure rola, adibidez «alaba» edo «semea».', consentNoun: 'oroitzapen-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    birthday:     { nounBook: 'urtebetetze-liburua', heading: 'Zure ekarpena', introNoun: 'Urtebetetze-liburua:', relationshipLabel: 'Zure harremana {name}(r)ekin *', relationshipPlaceholder: 'adib. alaba, laguna, lankidea …', relationshipHint: 'Zure ikuspegitik: nor zara {name}(r)entzat? Idatzi zure rola, adibidez «alaba», «laguna» edo «lankidea».', consentNoun: 'urtebetetze-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    anniversary:  { nounBook: 'urteurren-liburua', heading: 'Zure ekarpena', introNoun: 'Urteurren-liburua:', relationshipLabel: 'Zure harremana bikotearekin *', relationshipPlaceholder: 'adib. seme-alaba, laguna, ezkontza-lekukoa …', relationshipHint: 'Zure ikuspegitik: nor zara bikotearentzat? Idatzi zure rola, adibidez «seme-alaba», «ezkontza-lekukoa» edo «aspaldiko laguna».', consentNoun: 'urteurren-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    farewell:     { nounBook: 'agur-liburua', heading: 'Zure ekarpena', introNoun: 'Agur-liburua:', relationshipLabel: 'Zure harremana {name}(r)ekin *', relationshipPlaceholder: 'adib. lankidea, elkarteko kidea, bidelaguna …', relationshipHint: 'Zure ikuspegitik: nor zara {name}(r)entzat? Idatzi zure rola, adibidez «lankidea», «elkarteko kidea» edo «bidelaguna».', consentNoun: 'agur-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    service:      { nounBook: 'zerbitzu-urteurreneko liburua', heading: 'Zure ekarpena', introNoun: 'Zerbitzu-urteurreneko liburua:', relationshipLabel: 'Zure harremana {name}(r)ekin *', relationshipPlaceholder: 'adib. lankidea, nagusia, taldekidea …', relationshipHint: 'Zure ikuspegitik: nor zara {name}(r)entzat? Idatzi zure rola, adibidez «lankidea», «nagusia» edo «taldekidea».', consentNoun: 'zerbitzu-urteurreneko liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    company:      { nounBook: 'urteurren-liburua', heading: 'Zure ekarpena', introNoun: 'Urteurren-liburua:', relationshipLabel: 'Zure lotura {name}(r)ekin *', relationshipPlaceholder: 'adib. langilea, sortzailea, kidea, bezeroa …', relationshipHint: 'Zure ikuspegitik: nola zaude {name}(r)ekin lotuta? Idatzi zure rola, adibidez «langilea», «sortzailea», «kidea» edo «bezeroa».', consentNoun: 'urteurren-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    newborn:      { nounBook: 'ongietorri-liburua', heading: 'Zure zorion-hitzak', introNoun: 'Ongietorri-liburua:', relationshipLabel: 'Zure harremana familiarekin *', relationshipPlaceholder: 'adib. amona, osaba, gurasoen laguna …', relationshipHint: 'Zure ikuspegitik: nor zara haurrarentzat eta bere familiarentzat? Idatzi zure rola, adibidez «amona», «osaba» edo «gurasoen laguna».', consentNoun: 'ongietorri-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    encouragement:{ nounBook: 'adore-liburua', heading: 'Zure mezua', introNoun: 'Adore-liburua:', relationshipLabel: 'Zure harremana {name}(r)ekin *', relationshipPlaceholder: 'adib. ahizpa, laguna, lankidea …', relationshipHint: 'Zure ikuspegitik: nor zara {name}(r)entzat? Idatzi zure rola, adibidez «ahizpa», «laguna» edo «lankidea».', consentNoun: 'adore-liburua', interviewButton: '🎙 Hasi ahozko elkarrizketa →' },
    lifework: { nounBook: 'bizitza-lana', heading: 'Zure bizitzaren istorioa', introNoun: 'Bizitza-lana:', consentNoun: 'nire bizitza-lana (autobiografia)', interviewButton: '🎙 Hasi elkarrizketa →' },
    anamnesis: { nounBook: 'anamnesi-galdetegia', heading: 'Zure anamnesi medikoa', introNoun: 'Anamnesia honentzat:', consentNoun: 'anamnesi-galdetegia', interviewButton: '🎙 Hasi elkarrizketa →' },
    anamnesis_kvsw: { nounBook: 'anamnesi-galdetegia', heading: 'Zure anamnesi medikoa', introNoun: 'Anamnesia honentzat:', consentNoun: 'anamnesi-galdetegia', interviewButton: '🎙 Hasi elkarrizketa →' },
  },
  he: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'ספר זיכרון', heading: 'הזיכרון שלך', introNoun: 'ספר זיכרון עבור', relationshipLabel: 'הקשר שלך אל {name} *', relationshipPlaceholder: 'למשל בת, חבר, עמית, שכן …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור {name}? ציין את תפקידך – למשל "בת" או "בן".', consentNoun: 'ספר הזיכרון', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    birthday:     { nounBook: 'ספר יום הולדת', heading: 'התרומה שלך', introNoun: 'ספר יום הולדת עבור', relationshipLabel: 'הקשר שלך אל {name} *', relationshipPlaceholder: 'למשל בת, חבר, עמיתה …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור {name}? ציין את תפקידך – למשל "בת", "חבר" או "עמיתה".', consentNoun: 'ספר יום ההולדת', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    anniversary:  { nounBook: 'ספר יום נישואין', heading: 'התרומה שלך', introNoun: 'ספר יום נישואין עבור', relationshipLabel: 'הקשר שלך אל בני הזוג *', relationshipPlaceholder: 'למשל ילד, חברה, עד לחתונה …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור בני הזוג? ציין את תפקידך – למשל "ילד", "עד לחתונה" או "חברה ותיקה".', consentNoun: 'ספר יום הנישואין', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    farewell:     { nounBook: 'ספר פרידה', heading: 'התרומה שלך', introNoun: 'ספר פרידה עבור', relationshipLabel: 'הקשר שלך אל {name} *', relationshipPlaceholder: 'למשל עמית, חבר מועדון, שותפה לדרך …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור {name}? ציין את תפקידך – למשל "עמית", "חבר מועדון" או "שותפה לדרך".', consentNoun: 'ספר הפרידה', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    service:      { nounBook: 'ספר ותק', heading: 'התרומה שלך', introNoun: 'ספר ותק עבור', relationshipLabel: 'הקשר שלך אל {name} *', relationshipPlaceholder: 'למשל עמית, מנהלת, חבר צוות …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור {name}? ציין את תפקידך – למשל "עמית", "מנהלת" או "חבר צוות".', consentNoun: 'ספר הוותק', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    company:      { nounBook: 'ספר יובל', heading: 'התרומה שלך', introNoun: 'ספר יובל עבור', relationshipLabel: 'הקשר שלך אל {name} *', relationshipPlaceholder: 'למשל עובדת, מייסד, חבר, לקוחה …', relationshipHint: 'מנקודת המבט שלך: מה הקשר שלך אל {name}? ציין את תפקידך – למשל "עובדת", "מייסד", "חבר" או "לקוחה".', consentNoun: 'ספר היובל', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    newborn:      { nounBook: 'ספר ברוך הבא', heading: 'האיחולים שלך', introNoun: 'ספר ברוך הבא עבור', relationshipLabel: 'הקשר שלך אל המשפחה *', relationshipPlaceholder: 'למשל סבתא, דוד, חברה של ההורים …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור התינוק ומשפחתו? ציין את תפקידך – למשל "סבתא", "דוד" או "חברה של ההורים".', consentNoun: 'ספר ברוך הבא', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    encouragement:{ nounBook: 'ספר עידוד', heading: 'המסר שלך', introNoun: 'ספר עידוד עבור', relationshipLabel: 'הקשר שלך אל {name} *', relationshipPlaceholder: 'למשל אחות, חבר, עמיתה …', relationshipHint: 'מנקודת המבט שלך: מי אתה עבור {name}? ציין את תפקידך – למשל "אחות", "חבר" או "עמיתה".', consentNoun: 'ספר העידוד', interviewButton: '🎙 להתחיל ריאיון קולי →' },
    lifework: { nounBook: 'מפעל חיים', heading: 'סיפור חייך', introNoun: 'מפעל חייו של', consentNoun: 'מפעל חיי (אוטוביוגרפיה)', interviewButton: '🎙 להתחיל את השיחה →' },
    anamnesis: { nounBook: 'שאלון אנמנזה', heading: 'האנמנזה הרפואית שלך', introNoun: 'אנמנזה עבור', consentNoun: 'שאלון האנמנזה', interviewButton: '🎙 להתחיל את הריאיון →' },
    anamnesis_kvsw: { nounBook: 'שאלון אנמנזה', heading: 'האנמנזה הרפואית שלך', introNoun: 'אנמנזה עבור', consentNoun: 'שאלון האנמנזה', interviewButton: '🎙 להתחיל את הריאיון →' },
  },
  ar: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'كتاب الذكرى', heading: 'ذكراك', introNoun: 'كتاب الذكرى لـ', relationshipLabel: 'صلتك بـ {name} *', relationshipPlaceholder: 'مثل: ابنة، صديق، زميل، جار …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى {name}؟ اذكر دورك، مثل "ابنة" أو "ابن".', consentNoun: 'كتاب الذكرى', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    birthday:     { nounBook: 'كتاب عيد الميلاد', heading: 'مساهمتك', introNoun: 'كتاب عيد الميلاد لـ', relationshipLabel: 'صلتك بـ {name} *', relationshipPlaceholder: 'مثل: ابنة، صديق، زميلة …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى {name}؟ اذكر دورك، مثل "ابنة" أو "صديق" أو "زميلة".', consentNoun: 'كتاب عيد الميلاد', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    anniversary:  { nounBook: 'كتاب ذكرى الزواج', heading: 'مساهمتك', introNoun: 'كتاب ذكرى الزواج لـ', relationshipLabel: 'صلتك بالزوجين *', relationshipPlaceholder: 'مثل: ابن، صديقة، شاهد الزواج …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى الزوجين؟ اذكر دورك، مثل "ابن" أو "شاهد الزواج" أو "صديقة قديمة".', consentNoun: 'كتاب ذكرى الزواج', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    farewell:     { nounBook: 'كتاب الوداع', heading: 'مساهمتك', introNoun: 'كتاب الوداع لـ', relationshipLabel: 'صلتك بـ {name} *', relationshipPlaceholder: 'مثل: زميل، رفيق في النادي، رفيقة درب …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى {name}؟ اذكر دورك، مثل "زميل" أو "رفيق في النادي" أو "رفيقة درب".', consentNoun: 'كتاب الوداع', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    service:      { nounBook: 'كتاب ذكرى الخدمة', heading: 'مساهمتك', introNoun: 'كتاب ذكرى الخدمة لـ', relationshipLabel: 'صلتك بـ {name} *', relationshipPlaceholder: 'مثل: زميل، مديرة، عضو في الفريق …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى {name}؟ اذكر دورك، مثل "زميل" أو "مديرة" أو "عضو في الفريق".', consentNoun: 'كتاب ذكرى الخدمة', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    company:      { nounBook: 'كتاب اليوبيل', heading: 'مساهمتك', introNoun: 'كتاب اليوبيل لـ', relationshipLabel: 'ارتباطك بـ {name} *', relationshipPlaceholder: 'مثل: موظفة، مؤسس، عضو، زبونة …', relationshipHint: 'من وجهة نظرك: ما ارتباطك بـ {name}؟ اذكر دورك، مثل "موظفة" أو "مؤسس" أو "عضو" أو "زبونة".', consentNoun: 'كتاب اليوبيل', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    newborn:      { nounBook: 'كتاب الترحيب', heading: 'تمنياتك', introNoun: 'كتاب الترحيب لـ', relationshipLabel: 'صلتك بالعائلة *', relationshipPlaceholder: 'مثل: جدة، عم، صديقة الوالدين …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى الطفل وعائلته؟ اذكر دورك، مثل "جدة" أو "عم" أو "صديقة الوالدين".', consentNoun: 'كتاب الترحيب', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    encouragement:{ nounBook: 'كتاب التشجيع', heading: 'رسالتك', introNoun: 'كتاب التشجيع لـ', relationshipLabel: 'صلتك بـ {name} *', relationshipPlaceholder: 'مثل: أخت، صديق، زميلة …', relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى {name}؟ اذكر دورك، مثل "أخت" أو "صديق" أو "زميلة".', consentNoun: 'كتاب التشجيع', interviewButton: '🎙 ابدأ المقابلة الصوتية →' },
    lifework: { nounBook: 'عمل حياة', heading: 'قصة حياتك', introNoun: 'عمل حياة', consentNoun: 'عمل حياتي (سيرة ذاتية)', interviewButton: '🎙 بدء المحادثة →' },
    anamnesis: { nounBook: 'استبيان التاريخ المرضي', heading: 'تاريخك المرضي', introNoun: 'التاريخ المرضي لـ', consentNoun: 'استبيان التاريخ المرضي', interviewButton: '🎙 بدء المقابلة →' },
    anamnesis_kvsw: { nounBook: 'استبيان التاريخ المرضي', heading: 'تاريخك المرضي', introNoun: 'التاريخ المرضي لـ', consentNoun: 'استبيان التاريخ المرضي', interviewButton: '🎙 بدء المقابلة →' },
  },
  fr: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'livre du souvenir', heading: 'Votre souvenir', introNoun: 'Livre du souvenir pour', relationshipLabel: 'Votre lien avec {name} *', relationshipPlaceholder: 'p. ex. fille, ami, collègue, voisin …', relationshipHint: 'De votre point de vue : qui êtes-vous pour {name} ? Indiquez votre propre rôle — par exemple « fille » ou « fils ».', consentNoun: 'le livre du souvenir', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    birthday:     { nounBook: 'livre d’anniversaire', heading: 'Votre contribution', introNoun: 'Livre d’anniversaire pour', relationshipLabel: 'Votre lien avec {name} *', relationshipPlaceholder: 'p. ex. fille, ami, collègue …', relationshipHint: 'De votre point de vue : qui êtes-vous pour {name} ? Indiquez votre propre rôle — par exemple « fille », « ami » ou « collègue ».', consentNoun: 'le livre d’anniversaire', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    anniversary:  { nounBook: 'livre des noces', heading: 'Votre contribution', introNoun: 'Livre des noces pour', relationshipLabel: 'Votre lien avec le couple *', relationshipPlaceholder: 'p. ex. enfant, amie, témoin de mariage …', relationshipHint: 'De votre point de vue : qui êtes-vous pour le couple ? Indiquez votre propre rôle — par exemple « enfant », « témoin de mariage » ou « amie de longue date ».', consentNoun: 'le livre des noces', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    farewell:     { nounBook: 'livre d’adieu', heading: 'Votre contribution', introNoun: 'Livre d’adieu pour', relationshipLabel: 'Votre lien avec {name} *', relationshipPlaceholder: 'p. ex. collègue, camarade de club, compagne de route …', relationshipHint: 'De votre point de vue : qui êtes-vous pour {name} ? Indiquez votre propre rôle — par exemple « collègue », « camarade de club » ou « compagne de route ».', consentNoun: 'le livre d’adieu', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    service:      { nounBook: 'livre du jubilé professionnel', heading: 'Votre contribution', introNoun: 'Livre du jubilé professionnel pour', relationshipLabel: 'Votre lien avec {name} *', relationshipPlaceholder: 'p. ex. collègue, supérieure, membre de l’équipe …', relationshipHint: 'De votre point de vue : qui êtes-vous pour {name} ? Indiquez votre propre rôle — par exemple « collègue », « supérieure » ou « membre de l’équipe ».', consentNoun: 'le livre du jubilé professionnel', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    company:      { nounBook: 'livre du jubilé', heading: 'Votre contribution', introNoun: 'Livre du jubilé pour', relationshipLabel: 'Votre lien avec {name} *', relationshipPlaceholder: 'p. ex. salariée, fondateur, membre, cliente …', relationshipHint: 'De votre point de vue : quel est votre lien avec {name} ? Indiquez votre rôle — par exemple « salariée », « fondateur », « membre » ou « cliente ».', consentNoun: 'le livre du jubilé', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    newborn:      { nounBook: 'livre de bienvenue', heading: 'Vos vœux', introNoun: 'Livre de bienvenue pour', relationshipLabel: 'Votre lien avec la famille *', relationshipPlaceholder: 'p. ex. grand-mère, oncle, amie des parents …', relationshipHint: 'De votre point de vue : qui êtes-vous pour l’enfant et sa famille ? Indiquez votre rôle — par exemple « grand-mère », « oncle » ou « amie des parents ».', consentNoun: 'le livre de bienvenue', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    encouragement:{ nounBook: 'livre de réconfort', heading: 'Votre message', introNoun: 'Livre de réconfort pour', relationshipLabel: 'Votre lien avec {name} *', relationshipPlaceholder: 'p. ex. sœur, ami, collègue …', relationshipHint: 'De votre point de vue : qui êtes-vous pour {name} ? Indiquez votre propre rôle — par exemple « sœur », « ami » ou « collègue ».', consentNoun: 'le livre de réconfort', interviewButton: '🎙 Démarrer l’entretien vocal →' },
    lifework: { nounBook: 'œuvre de vie', heading: 'L’histoire de votre vie', introNoun: 'Œuvre de vie de', consentNoun: 'mon œuvre de vie (autobiographie)', interviewButton: '🎙 Commencer la conversation →' },
    anamnesis: { nounBook: 'questionnaire d’anamnèse', heading: 'Votre anamnèse médicale', introNoun: 'Anamnèse pour', consentNoun: 'questionnaire d’anamnèse', interviewButton: '🎙 Commencer l’entretien →' },
    anamnesis_kvsw: { nounBook: 'questionnaire d’anamnèse', heading: 'Votre anamnèse médicale', introNoun: 'Anamnèse pour', consentNoun: 'questionnaire d’anamnèse', interviewButton: '🎙 Commencer l’entretien →' },
  },
  ro: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'carte de amintire', heading: 'Amintirea dumneavoastră', introNoun: 'Carte de amintire pentru', relationshipLabel: 'Relația dumneavoastră cu {name} *', relationshipPlaceholder: 'de ex. fiică, prieten, coleg, vecin …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru {name}? Indicați propriul rol – de exemplu „fiică" sau „fiu".', consentNoun: 'cartea de amintire', interviewButton: '🎙 Începeți interviul vocal →' },
    birthday:     { nounBook: 'carte aniversară', heading: 'Contribuția dumneavoastră', introNoun: 'Carte aniversară pentru', relationshipLabel: 'Relația dumneavoastră cu {name} *', relationshipPlaceholder: 'de ex. fiică, prieten, colegă …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru {name}? Indicați propriul rol – de exemplu „fiică", „prieten" sau „colegă".', consentNoun: 'cartea aniversară', interviewButton: '🎙 Începeți interviul vocal →' },
    anniversary:  { nounBook: 'carte pentru aniversarea căsătoriei', heading: 'Contribuția dumneavoastră', introNoun: 'Carte pentru aniversarea căsătoriei pentru', relationshipLabel: 'Relația dumneavoastră cu cuplul *', relationshipPlaceholder: 'de ex. copil, prietenă, naș …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru cuplu? Indicați propriul rol – de exemplu „copil", „naș" sau „prietenă de-o viață".', consentNoun: 'cartea pentru aniversarea căsătoriei', interviewButton: '🎙 Începeți interviul vocal →' },
    farewell:     { nounBook: 'carte de rămas-bun', heading: 'Contribuția dumneavoastră', introNoun: 'Carte de rămas-bun pentru', relationshipLabel: 'Relația dumneavoastră cu {name} *', relationshipPlaceholder: 'de ex. coleg, membru al clubului, tovarășă de drum …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru {name}? Indicați propriul rol – de exemplu „coleg", „membru al clubului" sau „tovarășă de drum".', consentNoun: 'cartea de rămas-bun', interviewButton: '🎙 Începeți interviul vocal →' },
    service:      { nounBook: 'carte pentru aniversarea profesională', heading: 'Contribuția dumneavoastră', introNoun: 'Carte pentru aniversarea profesională pentru', relationshipLabel: 'Relația dumneavoastră cu {name} *', relationshipPlaceholder: 'de ex. coleg, șefă, membru al echipei …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru {name}? Indicați propriul rol – de exemplu „coleg", „șefă" sau „membru al echipei".', consentNoun: 'cartea pentru aniversarea profesională', interviewButton: '🎙 Începeți interviul vocal →' },
    company:      { nounBook: 'carte aniversară', heading: 'Contribuția dumneavoastră', introNoun: 'Carte aniversară pentru', relationshipLabel: 'Legătura dumneavoastră cu {name} *', relationshipPlaceholder: 'de ex. angajată, fondator, membru, clientă …', relationshipHint: 'Din punctul dumneavoastră de vedere: ce legătură aveți cu {name}? Indicați rolul – de exemplu „angajată", „fondator", „membru" sau „clientă".', consentNoun: 'cartea aniversară', interviewButton: '🎙 Începeți interviul vocal →' },
    newborn:      { nounBook: 'carte de bun venit', heading: 'Urările dumneavoastră', introNoun: 'Carte de bun venit pentru', relationshipLabel: 'Relația dumneavoastră cu familia *', relationshipPlaceholder: 'de ex. bunică, unchi, prietenă a părinților …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru copil și familia sa? Indicați rolul – de exemplu „bunică", „unchi" sau „prietenă a părinților".', consentNoun: 'cartea de bun venit', interviewButton: '🎙 Începeți interviul vocal →' },
    encouragement:{ nounBook: 'carte de încurajare', heading: 'Mesajul dumneavoastră', introNoun: 'Carte de încurajare pentru', relationshipLabel: 'Relația dumneavoastră cu {name} *', relationshipPlaceholder: 'de ex. soră, prieten, colegă …', relationshipHint: 'Din punctul dumneavoastră de vedere: cine sunteți pentru {name}? Indicați propriul rol – de exemplu „soră", „prieten" sau „colegă".', consentNoun: 'cartea de încurajare', interviewButton: '🎙 Începeți interviul vocal →' },
    lifework: { nounBook: 'opera vieții', heading: 'Povestea vieții dumneavoastră', introNoun: 'Opera vieții lui', consentNoun: 'opera vieții mele (autobiografie)', interviewButton: '🎙 Începeți conversația →' },
    anamnesis: { nounBook: 'chestionar de anamneză', heading: 'Anamneza dumneavoastră medicală', introNoun: 'Anamneză pentru', consentNoun: 'chestionarul de anamneză', interviewButton: '🎙 Începeți interviul →' },
    anamnesis_kvsw: { nounBook: 'chestionar de anamneză', heading: 'Anamneza dumneavoastră medicală', introNoun: 'Anamneză pentru', consentNoun: 'chestionarul de anamneză', interviewButton: '🎙 Începeți interviul →' },
  },
  tr: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'anma kitabı', heading: 'Anınız', introNoun: 'Anma kitabı:', relationshipLabel: '{name} ile ilişkiniz *', relationshipPlaceholder: 'ör. kızı, arkadaşı, iş arkadaşı, komşusu …', relationshipHint: 'Sizin bakış açınızdan: {name} için kimsiniz? Kendi rolünüzü yazın – ör. „kızı" ya da „oğlu".', consentNoun: 'anma kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    birthday:     { nounBook: 'doğum günü kitabı', heading: 'Katkınız', introNoun: 'Doğum günü kitabı:', relationshipLabel: '{name} ile ilişkiniz *', relationshipPlaceholder: 'ör. kızı, arkadaşı, iş arkadaşı …', relationshipHint: 'Sizin bakış açınızdan: {name} için kimsiniz? Kendi rolünüzü yazın – ör. „kızı", „arkadaşı" ya da „iş arkadaşı".', consentNoun: 'doğum günü kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    anniversary:  { nounBook: 'evlilik yıldönümü kitabı', heading: 'Katkınız', introNoun: 'Evlilik yıldönümü kitabı:', relationshipLabel: 'Çiftle ilişkiniz *', relationshipPlaceholder: 'ör. çocuğu, arkadaşı, nikâh şahidi …', relationshipHint: 'Sizin bakış açınızdan: çift için kimsiniz? Kendi rolünüzü yazın – ör. „çocuğu", „nikâh şahidi" ya da „eski dostu".', consentNoun: 'evlilik yıldönümü kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    farewell:     { nounBook: 'veda kitabı', heading: 'Katkınız', introNoun: 'Veda kitabı:', relationshipLabel: '{name} ile ilişkiniz *', relationshipPlaceholder: 'ör. iş arkadaşı, dernek arkadaşı, yol arkadaşı …', relationshipHint: 'Sizin bakış açınızdan: {name} için kimsiniz? Kendi rolünüzü yazın – ör. „iş arkadaşı", „dernek arkadaşı" ya da „yol arkadaşı".', consentNoun: 'veda kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    service:      { nounBook: 'hizmet yıldönümü kitabı', heading: 'Katkınız', introNoun: 'Hizmet yıldönümü kitabı:', relationshipLabel: '{name} ile ilişkiniz *', relationshipPlaceholder: 'ör. iş arkadaşı, yöneticisi, ekip üyesi …', relationshipHint: 'Sizin bakış açınızdan: {name} için kimsiniz? Kendi rolünüzü yazın – ör. „iş arkadaşı", „yöneticisi" ya da „ekip üyesi".', consentNoun: 'hizmet yıldönümü kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    company:      { nounBook: 'yıldönümü kitabı', heading: 'Katkınız', introNoun: 'Yıldönümü kitabı:', relationshipLabel: '{name} ile bağınız *', relationshipPlaceholder: 'ör. çalışanı, kurucusu, üyesi, müşterisi …', relationshipHint: 'Sizin bakış açınızdan: {name} ile bağınız nedir? Rolünüzü yazın – ör. „çalışanı", „kurucusu", „üyesi" ya da „müşterisi".', consentNoun: 'yıldönümü kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    newborn:      { nounBook: 'hoş geldin kitabı', heading: 'Dilekleriniz', introNoun: 'Hoş geldin kitabı:', relationshipLabel: 'Aileyle ilişkiniz *', relationshipPlaceholder: 'ör. babaannesi, amcası, ailenin arkadaşı …', relationshipHint: 'Sizin bakış açınızdan: çocuk ve ailesi için kimsiniz? Rolünüzü yazın – ör. „babaannesi", „amcası" ya da „ailenin arkadaşı".', consentNoun: 'hoş geldin kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    encouragement:{ nounBook: 'moral kitabı', heading: 'Mesajınız', introNoun: 'Moral kitabı:', relationshipLabel: '{name} ile ilişkiniz *', relationshipPlaceholder: 'ör. kız kardeşi, arkadaşı, iş arkadaşı …', relationshipHint: 'Sizin bakış açınızdan: {name} için kimsiniz? Kendi rolünüzü yazın – ör. „kız kardeşi", „arkadaşı" ya da „iş arkadaşı".', consentNoun: 'moral kitabını', interviewButton: '🎙 Sesli görüşmeyi başlat →' },
    lifework: { nounBook: 'yaşam eseri', heading: 'Yaşam öykünüz', introNoun: 'Yaşam eseri:', consentNoun: 'yaşam eserim (otobiyografi)', interviewButton: '🎙 Sohbete başla →' },
    anamnesis: { nounBook: 'anamnez formu', heading: 'Tıbbi anamneziniz', introNoun: 'Anamnez:', consentNoun: 'anamnez formu', interviewButton: '🎙 Görüşmeye başla →' },
    anamnesis_kvsw: { nounBook: 'anamnez formu', heading: 'Tıbbi anamneziniz', introNoun: 'Anamnez:', consentNoun: 'anamnez formu', interviewButton: '🎙 Görüşmeye başla →' },
  },
  ru: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'книга памяти', heading: 'Ваше воспоминание', introNoun: 'Книга памяти:', relationshipLabel: 'Ваше отношение к {name} *', relationshipPlaceholder: 'напр. дочь, друг, коллега, сосед …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь {name}? Укажите свою роль – напр. «дочь» или «сын».', consentNoun: 'книги памяти', interviewButton: '🎙 Начать голосовое интервью →' },
    birthday:     { nounBook: 'книга ко дню рождения', heading: 'Ваш рассказ', introNoun: 'Книга ко дню рождения:', relationshipLabel: 'Ваше отношение к {name} *', relationshipPlaceholder: 'напр. дочь, друг, коллега …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь {name}? Укажите свою роль – напр. «дочь», «друг» или «коллега».', consentNoun: 'книги ко дню рождения', interviewButton: '🎙 Начать голосовое интервью →' },
    anniversary:  { nounBook: 'юбилейная книга', heading: 'Ваш рассказ', introNoun: 'Юбилейная книга:', relationshipLabel: 'Ваше отношение к паре *', relationshipPlaceholder: 'напр. ребёнок, подруга, свидетель на свадьбе …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь этой паре? Укажите свою роль – напр. «ребёнок», «свидетель на свадьбе» или «давняя подруга».', consentNoun: 'юбилейной книги', interviewButton: '🎙 Начать голосовое интервью →' },
    farewell:     { nounBook: 'книга прощания', heading: 'Ваш рассказ', introNoun: 'Книга прощания:', relationshipLabel: 'Ваше отношение к {name} *', relationshipPlaceholder: 'напр. коллега, товарищ по клубу, спутница …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь {name}? Укажите свою роль – напр. «коллега», «товарищ по клубу» или «спутница».', consentNoun: 'книги прощания', interviewButton: '🎙 Начать голосовое интервью →' },
    service:      { nounBook: 'книга к юбилею службы', heading: 'Ваш рассказ', introNoun: 'Книга к юбилею службы:', relationshipLabel: 'Ваше отношение к {name} *', relationshipPlaceholder: 'напр. коллега, руководительница, участник команды …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь {name}? Укажите свою роль – напр. «коллега», «руководительница» или «участник команды».', consentNoun: 'книги к юбилею службы', interviewButton: '🎙 Начать голосовое интервью →' },
    company:      { nounBook: 'юбилейная книга', heading: 'Ваш рассказ', introNoun: 'Юбилейная книга:', relationshipLabel: 'Ваша связь с {name} *', relationshipPlaceholder: 'напр. сотрудница, основатель, участник, клиентка …', relationshipHint: 'С вашей точки зрения: как вы связаны с {name}? Укажите свою роль – напр. «сотрудница», «основатель», «участник» или «клиентка».', consentNoun: 'юбилейной книги', interviewButton: '🎙 Начать голосовое интервью →' },
    newborn:      { nounBook: 'книга приветствия', heading: 'Ваши пожелания', introNoun: 'Книга приветствия:', relationshipLabel: 'Ваше отношение к семье *', relationshipPlaceholder: 'напр. бабушка, дядя, подруга родителей …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь ребёнку и его семье? Укажите свою роль – напр. «бабушка», «дядя» или «подруга родителей».', consentNoun: 'книги приветствия', interviewButton: '🎙 Начать голосовое интервью →' },
    encouragement:{ nounBook: 'книга поддержки', heading: 'Ваше послание', introNoun: 'Книга поддержки:', relationshipLabel: 'Ваше отношение к {name} *', relationshipPlaceholder: 'напр. сестра, друг, коллега …', relationshipHint: 'С вашей точки зрения: кем вы приходитесь {name}? Укажите свою роль – напр. «сестра», «друг» или «коллега».', consentNoun: 'книги поддержки', interviewButton: '🎙 Начать голосовое интервью →' },
    lifework: { nounBook: 'дело жизни', heading: 'История вашей жизни', introNoun: 'Дело жизни:', consentNoun: 'моего дела жизни (автобиографии)', interviewButton: '🎙 Начать разговор →' },
    anamnesis: { nounBook: 'анкета анамнеза', heading: 'Ваш медицинский анамнез', introNoun: 'Анамнез для', consentNoun: 'анкеты анамнеза', interviewButton: '🎙 Начать интервью →' },
    anamnesis_kvsw: { nounBook: 'анкета анамнеза', heading: 'Ваш медицинский анамнез', introNoun: 'Анамнез для', consentNoun: 'анкеты анамнеза', interviewButton: '🎙 Начать интервью →' },
  },
  uk: {
    // 2026-08-23 ergänzt: Beitragenden-Kategorien; vorher fielen sie auf Deutsch zurück.
    memorial:     { nounBook: 'книга пам’яті', heading: 'Ваш спогад', introNoun: 'Книга пам’яті:', relationshipLabel: 'Ваше ставлення до {name} *', relationshipPlaceholder: 'напр. донька, друг, колега, сусід …', relationshipHint: 'З вашої точки зору: ким ви є для {name}? Вкажіть свою роль – напр. «донька» або «син».', consentNoun: 'книги пам’яті', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    birthday:     { nounBook: 'книга до дня народження', heading: 'Ваша розповідь', introNoun: 'Книга до дня народження:', relationshipLabel: 'Ваше ставлення до {name} *', relationshipPlaceholder: 'напр. донька, друг, колега …', relationshipHint: 'З вашої точки зору: ким ви є для {name}? Вкажіть свою роль – напр. «донька», «друг» або «колега».', consentNoun: 'книги до дня народження', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    anniversary:  { nounBook: 'ювілейна книга', heading: 'Ваша розповідь', introNoun: 'Ювілейна книга:', relationshipLabel: 'Ваше ставлення до пари *', relationshipPlaceholder: 'напр. дитина, подруга, свідок на весіллі …', relationshipHint: 'З вашої точки зору: ким ви є для цієї пари? Вкажіть свою роль – напр. «дитина», «свідок на весіллі» або «давня подруга».', consentNoun: 'ювілейної книги', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    farewell:     { nounBook: 'книга прощання', heading: 'Ваша розповідь', introNoun: 'Книга прощання:', relationshipLabel: 'Ваше ставлення до {name} *', relationshipPlaceholder: 'напр. колега, товариш із клубу, супутниця …', relationshipHint: 'З вашої точки зору: ким ви є для {name}? Вкажіть свою роль – напр. «колега», «товариш із клубу» або «супутниця».', consentNoun: 'книги прощання', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    service:      { nounBook: 'книга до ювілею служби', heading: 'Ваша розповідь', introNoun: 'Книга до ювілею служби:', relationshipLabel: 'Ваше ставлення до {name} *', relationshipPlaceholder: 'напр. колега, керівниця, учасник команди …', relationshipHint: 'З вашої точки зору: ким ви є для {name}? Вкажіть свою роль – напр. «колега», «керівниця» або «учасник команди».', consentNoun: 'книги до ювілею служби', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    company:      { nounBook: 'ювілейна книга', heading: 'Ваша розповідь', introNoun: 'Ювілейна книга:', relationshipLabel: 'Ваш зв’язок із {name} *', relationshipPlaceholder: 'напр. працівниця, засновник, учасник, клієнтка …', relationshipHint: 'З вашої точки зору: як ви пов’язані з {name}? Вкажіть свою роль – напр. «працівниця», «засновник», «учасник» або «клієнтка».', consentNoun: 'ювілейної книги', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    newborn:      { nounBook: 'книга привітання', heading: 'Ваші побажання', introNoun: 'Книга привітання:', relationshipLabel: 'Ваше ставлення до родини *', relationshipPlaceholder: 'напр. бабуся, дядько, подруга батьків …', relationshipHint: 'З вашої точки зору: ким ви є для дитини та її родини? Вкажіть свою роль – напр. «бабуся», «дядько» або «подруга батьків».', consentNoun: 'книги привітання', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    encouragement:{ nounBook: 'книга підтримки', heading: 'Ваше послання', introNoun: 'Книга підтримки:', relationshipLabel: 'Ваше ставлення до {name} *', relationshipPlaceholder: 'напр. сестра, друг, колега …', relationshipHint: 'З вашої точки зору: ким ви є для {name}? Вкажіть свою роль – напр. «сестра», «друг» або «колега».', consentNoun: 'книги підтримки', interviewButton: '🎙 Почати голосове інтерв’ю →' },
    lifework: { nounBook: 'справа життя', heading: 'Історія вашого життя', introNoun: 'Справа життя:', consentNoun: 'моєї справи життя (автобіографії)', interviewButton: '🎙 Почати розмову →' },
    anamnesis: { nounBook: 'анкета анамнезу', heading: 'Ваш медичний анамнез', introNoun: 'Анамнез для', consentNoun: 'анкети анамнезу', interviewButton: '🎙 Почати інтерв’ю →' },
    anamnesis_kvsw: { nounBook: 'анкета анамнезу', heading: 'Ваш медичний анамнез', introNoun: 'Анамнез для', consentNoun: 'анкети анамнезу', interviewButton: '🎙 Почати інтерв’ю →' },
  },
}


// Gastbeiträge zum Lebenswerk: Der Gast erzählt ÜBER die Person, nicht als sie.
// Deutsch steht (wie bei allen Kategorien) in src/categories.js unter
// `guestContributor`; hier liegen die Übersetzungen. Fehlt eine Sprache, greift
// Deutsch — wie überall im Beitragenden-Flow.
const GUEST_CONTRIB = {
  en: {
    heading: 'Your contribution', introNoun: 'Life’s work of',
    relationshipLabel: 'Your relationship to {name} *',
    relationshipPlaceholder: 'e.g. daughter, friend, colleague, neighbour …',
    relationshipHint: 'From your perspective: who are you to {name}? Enter your own role – e.g. “daughter” or “friend” (meaning “I am {name}’s daughter / friend”).',
    consentNoun: 'life’s work (autobiography)', interviewButton: '🎙 Start voice interview →',
  },
  pl: {
    heading: 'Twój wkład', introNoun: 'Dzieło życia:',
    relationshipLabel: 'Twoja relacja z {name} *',
    relationshipPlaceholder: 'np. córka, przyjaciel, koleżanka, sąsiad …',
    relationshipHint: 'Z Twojej perspektywy: kim jesteś dla osoby {name}? Wpisz swoją rolę – np. „córka" lub „przyjaciel".',
    consentNoun: 'dzieła życia (autobiografii)', interviewButton: '🎙 Rozpocznij wywiad głosowy →',
  },
  es: {
    heading: 'Su aportación', introNoun: 'Obra de vida de',
    relationshipLabel: 'Su relación con {name} *',
    relationshipPlaceholder: 'p. ej. hija, amigo, compañera, vecino …',
    relationshipHint: 'Desde su perspectiva: ¿quién es usted para {name}? Indique su propio papel: p. ej. «hija» o «amigo».',
    consentNoun: 'la obra de vida (autobiografía)', interviewButton: '🎙 Comenzar la entrevista →',
  },
  it: {
    heading: 'Il suo contributo', introNoun: 'Opera di una vita di',
    relationshipLabel: 'Il suo rapporto con {name} *',
    relationshipPlaceholder: 'p. es. figlia, amico, collega, vicino …',
    relationshipHint: 'Dal suo punto di vista: chi è lei per {name}? Indichi il suo ruolo, p. es. «figlia» o «amico».',
    consentNoun: 'dell’opera di una vita (autobiografia)', interviewButton: '🎙 Iniziare l’intervista →',
  },
  eu: {
    heading: 'Zure ekarpena', introNoun: 'Bizitza-lana:',
    relationshipLabel: '{name}(r)ekin duzun harremana *',
    relationshipPlaceholder: 'adib. alaba, laguna, lankidea, auzokoa …',
    relationshipHint: 'Zure ikuspegitik: nor zara {name}(r)entzat? Idatzi zure rola – adib. «alaba» edo «laguna».',
    consentNoun: 'bizitza-lanaren (autobiografia)', interviewButton: '🎙 Hasi elkarrizketa →',
  },
  he: {
    heading: 'התרומה שלך', introNoun: 'מפעל חייו של',
    relationshipLabel: 'הקשר שלך אל {name} *',
    relationshipPlaceholder: 'למשל בת, חבר, עמיתה, שכן …',
    relationshipHint: 'מנקודת מבטך: מי אתה עבור {name}? כתוב את תפקידך – למשל „בת" או „חבר".',
    consentNoun: 'מפעל החיים (אוטוביוגרפיה)', interviewButton: '🎙 להתחיל את הראיון →',
  },
  ar: {
    heading: 'مساهمتك', introNoun: 'عمل حياة',
    relationshipLabel: 'علاقتك بـ {name} *',
    relationshipPlaceholder: 'مثلاً ابنة، صديق، زميلة، جار …',
    relationshipHint: 'من وجهة نظرك: من أنت بالنسبة إلى {name}؟ اكتب دورك – مثلاً «ابنة» أو «صديق».',
    consentNoun: 'عمل الحياة (سيرة ذاتية)', interviewButton: '🎙 بدء المقابلة →',
  },
  fr: {
    heading: 'Votre contribution', introNoun: 'Œuvre de vie de',
    relationshipLabel: 'Votre lien avec {name} *',
    relationshipPlaceholder: 'p. ex. fille, ami, collègue, voisin …',
    relationshipHint: 'De votre point de vue : qui êtes-vous pour {name} ? Indiquez votre rôle – p. ex. « fille » ou « ami ».',
    consentNoun: 'de l’œuvre de vie (autobiographie)', interviewButton: '🎙 Commencer l’entretien →',
  },
  ro: {
    heading: 'Contribuția dumneavoastră', introNoun: 'Opera vieții lui',
    relationshipLabel: 'Relația dumneavoastră cu {name} *',
    relationshipPlaceholder: 'de ex. fiică, prieten, colegă, vecin …',
    relationshipHint: 'Din perspectiva dumneavoastră: cine sunteți pentru {name}? Indicați rolul – de ex. „fiică" sau „prieten".',
    consentNoun: 'operei vieții (autobiografie)', interviewButton: '🎙 Începeți interviul →',
  },
  tr: {
    heading: 'Katkınız', introNoun: 'Yaşam eseri:',
    relationshipLabel: '{name} ile ilişkiniz *',
    relationshipPlaceholder: 'ör. kızı, arkadaşı, iş arkadaşı, komşusu …',
    relationshipHint: 'Sizin bakış açınızdan: {name} için kimsiniz? Kendi rolünüzü yazın – ör. „kızı" ya da „arkadaşı".',
    consentNoun: 'yaşam eserinin (otobiyografi)', interviewButton: '🎙 Görüşmeye başla →',
  },
  ru: {
    heading: 'Ваш вклад', introNoun: 'Дело жизни:',
    relationshipLabel: 'Ваше отношение к {name} *',
    relationshipPlaceholder: 'напр. дочь, друг, коллега, сосед …',
    relationshipHint: 'С вашей точки зрения: кем вы приходитесь {name}? Укажите свою роль – напр. «дочь» или «друг».',
    consentNoun: 'дела жизни (автобиографии)', interviewButton: '🎙 Начать интервью →',
  },
  uk: {
    heading: 'Ваш внесок', introNoun: 'Справа життя:',
    relationshipLabel: 'Ваше ставлення до {name} *',
    relationshipPlaceholder: 'напр. донька, друг, колега, сусід …',
    relationshipHint: 'З вашої точки зору: ким ви є для {name}? Вкажіть свою роль – напр. «донька» або «друг».',
    consentNoun: 'справи життя (автобіографії)', interviewButton: '🎙 Почати інтерв’ю →',
  },
}

// `guest` = über den Gast-Link gekommen (Gastbeiträge zum Lebenswerk). Dann
// gilt der Gast-Wortlaut der Kategorie statt des Endnutzer-Wortlauts.
export function contributorL10n(slug, lang, guest = false) {
  const cat = CATEGORIES[slug] || CATEGORIES.memorial
  const useGuest = guest && cat.guestContributor
  const base = { nounBook: cat.nounBook, ...(useGuest ? cat.guestContributor : cat.contributor) }
  const overlay = useGuest ? GUEST_CONTRIB[lang] : (CONTRIB[lang] || {})[slug]
  return overlay ? { ...base, ...overlay } : base
}
