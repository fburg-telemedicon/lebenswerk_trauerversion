// src/uiExtra.js — Oberflächentexte des Beitragenden-Flows, die früher hart als
// „Deutsch oder Englisch" im Code standen (String(lang).startsWith('en') ? … : …).
// Deutsch ist die Quelle; die übrigen Sprachen liegen als reine Daten in
// uiExtraLangs.js (mit dem eigenen Modell erzeugt). Fehlt ein Schlüssel, greift
// der deutsche Text — eine unvollständige Sprache kann also nichts kaputt machen.
import { EXTRA_LANGS } from './uiExtraLangs.js'

const DE = {
  firstQuestion: 'Die erste Frage wird vorbereitet — das kann einen kurzen Moment dauern …',
  soundBlocked: '🔇 Ihr Browser blockiert den Ton noch. Tippen Sie einmal hier, um das Gespräch zu starten.',
  liveThinkHint: 'Live-Gespräch: Denken Sie in Ruhe nach — es wird nichts abgeschnitten.',
  micPausedHint: 'Aufnahme nach einer Pause gestoppt. Tippen Sie das Mikrofon an, um weiterzusprechen.',
  soundTest: 'Ton- und Mikrofontest',
  micModeMenu: 'Mikrofon-Modus',
  detailMenu: 'Wie ausführlich nachfragen?',
  bookDoneTitle: 'Das Buch ist schon fertig',
  bookDoneText: 'Vielen Dank für Ihr Interesse! Dieses Buch ist bereits abgeschlossen, weitere Beiträge sind deshalb nicht mehr möglich. Bitte wenden Sie sich an die Person, die Ihnen den Link geschickt hat.',
  // Steht vor dem ersten Wort, nicht im Impressum: Ein Lebensrückblick berührt
  // auch Verlust, Krankheit, Krieg. Der Hinweis nützt nur dort, wo er gelesen wird.
  gentleNote: 'Sie bestimmen, worüber Sie sprechen. Jede Frage dürfen Sie übergehen, und Sie können jederzeit aufhören und später weitererzählen. Geht Ihnen ein Thema zu nahe, brechen Sie ruhig ab.',
}

const EN = {
  firstQuestion: 'Preparing the first question — this can take a moment …',
  soundBlocked: '🔇 Your browser is still blocking sound. Tap here once to start the conversation.',
  liveThinkHint: 'Live conversation: take as much time to think as you like — nothing is cut off.',
  micPausedHint: 'Recording paused after a break. Tap the microphone to keep talking.',
  soundTest: 'Sound & microphone test',
  micModeMenu: 'Microphone mode',
  detailMenu: 'Depth of questions',
  bookDoneTitle: 'This book is already finished',
  bookDoneText: 'Thank you for your interest! This book has already been completed, so no further contributions are possible. Please contact the person who sent you the link.',
  gentleNote: 'You decide what you talk about. You may skip any question, and you can stop at any time and continue later. If a subject feels too close, it is fine to stop.',
}

// xt('fr').soundTest → französisch, sonst deutsch. Schlüsselweiser Rückfall.
export function xt(lang) {
  const code = String(lang || 'de')
  if (code.startsWith('en')) return { ...DE, ...EN }
  const uebersetzt = EXTRA_LANGS[code] || EXTRA_LANGS[code.slice(0, 2)]
  return uebersetzt ? { ...DE, ...uebersetzt } : DE
}
