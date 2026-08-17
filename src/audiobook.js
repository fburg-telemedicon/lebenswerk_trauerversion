// src/audiobook.js
// Hörbuch: aus dem Buch-JSON die VORLESE-BLÖCKE bauen (Text, keine Audiodaten).
//
// Warum im Browser? Genau wie bei den Prompts liegen die Bausteine hier: die
// i18n-Texte (`uiText`, `bookDisclaimer`) und die Beitragendenliste. Der Worker
// bekommt die fertigen Blöcke in `params` und muss nichts davon nachbauen.
// Vorbild für Aufbau und Reihenfolge ist `downloadStructuredDocx` in
// `src/bookExport.js` — was dort gedruckt wird, wird hier gelesen. Nur die
// Bilder fallen weg.
//
// Ein Block ist { kind, track, speaker, text }:
//   • kind    – 'title' (Buchtitel), 'chapter' (Kapitelüberschrift), 'para' (Absatz)
//   • track   – gruppiert die Blöcke zu MP3-Dateien: 0 = Titelspur, 1..N = Kapitel,
//               N+1 = Anhang (Mitwirkende + Entstehungshinweis)
//   • speaker – 'f' | 'm'; welche der beiden Stimmen diesen Block liest
//
// Jeder Block wird im Worker zu einem eigenen <p> im SSML — das ist die einzige
// Absatzpause, die auch die MAI-Stimmen einhalten (die ignorieren <break>,
// gemessen am 2026-08-17).

import { chapterVoices, chapterBoxes } from './categories.js'
import { uiText, bookDisclaimer, imageFacts } from './i18n.js'
import { dedupeContributors, safeName } from './bookExport.js'

// Zeichen je Sekunde Spieldauer — am fertigen Lutherhof-Hörbuch gemessen
// (22 Kapitel lagen zwischen 14,6 und 17,3). Nur für die Vorab-Schätzung.
const CHARS_PER_SECOND = 16

// Preis je 1 Mio. Zeichen, muss zu PRICING in api/_lib/cost.js passen.
const USD_PER_M_CHARS = { hd: 22.0, neural: 15.0 }
const isHdVoice = v => /:(?:DragonHD|MAI-Voice)/i.test(String(v || ''))

// Die beiden Stimmen des Hörbuchs. Werte identisch zu den MAI-Defaults in
// api/_lib/ttsvoices.js — dieselbe Generation, die für das Lutherhof-Hörbuch
// nach echten Hörproben gewählt wurde.
export const AUDIOBOOK_VOICE_F = 'de-DE-Mia:MAI-Voice-2'
export const AUDIOBOOK_VOICE_M = 'de-DE-Klaus:MAI-Voice-2'

// Auswahl im Erzeugen-Fenster. „gemischt" liest den Buchtext kapitelweise
// abwechselnd und setzt fremde Stimmen (die Stimmen-Kästen) jeweils in die
// andere Stimme — beim Trauerbuch V1, wo ein Kapitel EINER Person gehört, folgt
// die Stimme statt des Wechsels dem Geschlecht dieser Person.
export const AUDIOBOOK_VOICE_MODES = [
  { key: 'f',     label: 'Weibliche Stimme (Mia)',   description: 'Das ganze Buch von einer Stimme gelesen.' },
  { key: 'm',     label: 'Männliche Stimme (Klaus)', description: 'Das ganze Buch von einer Stimme gelesen.' },
  { key: 'mixed', label: 'Gemischt (Mia & Klaus)',   description: 'Kapitel abwechselnd; fremde Stimmen jeweils in der anderen Stimme. Beim Trauerbuch mit Einzelkapiteln: die Stimme passend zum Geschlecht des Beitragenden.' },
]

// Konkrete Stimme je Sprecherrolle. Hat das Buch eine eigene Interview-Stimme
// (memorials.tts_voice), tritt sie an die Stelle der Standardstimme ihres
// Geschlechts — wer dem Buch beim Erzählen zugehört hat, soll es vorlesen.
export function audiobookVoices(bookVoice) {
  const v = String(bookVoice || '')
  const male = /Klaus|Florian|Conrad|Bernd|Christoph/i.test(v)
  return {
    f: (v && !male) ? v : AUDIOBOOK_VOICE_F,
    m: (v && male)  ? v : AUDIOBOOK_VOICE_M,
  }
}

// Absätze eines Kapitel-Bodys, so wie sie auch gedruckt werden.
const paras = s => String(s || '').split('\n\n').map(r => r.trim()).filter(Boolean)
const other = sp => (sp === 'm' ? 'f' : 'm')
// 'männlich' ist der im Beitragenden-Formular gespeicherte Wert (siehe
// interviewTtsVoice in contributor.jsx); alles andere gilt als weiblich.
const genderSpeaker = g => (String(g || '').trim().toLowerCase() === 'männlich' ? 'm' : 'f')

// Baut die Vorlese-Blöcke. `contributors` wird für drei Dinge gebraucht: den Namen
// unter der Kapitelüberschrift (Buch V1), das Geschlecht dieser Person (gemischte
// Lesung) und die Mitwirkendenliste.
// opts.voiceMode: 'f' | 'm' | 'mixed' (Default 'f').
// opts.showContributors und opts.selfNarrated wie im DOCX-Export.
export function audiobookBlocks(book, contributors = [], opts = {}) {
  const bt = uiText(book?.language)
  const mode = ['f', 'm', 'mixed'].includes(opts.voiceMode) ? opts.voiceMode : 'f'
  const showContributors = opts.showContributors !== false
  // Rahmen (Titel, Mitwirkende, Entstehungshinweis) bekommt bei gemischter Lesung
  // die weibliche Stimme — sie ist auch die des ersten Kapitels.
  const frame = mode === 'mixed' ? 'f' : mode
  const blocks = []
  const tracks = []
  const push = (kind, track, speaker, text) => {
    const t = String(text || '').trim()
    if (t) blocks.push({ kind, track, speaker, text: t })
  }

  // ── Spur 0: Titel ──────────────────────────────────────────────
  tracks.push({ index: 0, title: book?.title || 'Titel' })
  push('title', 0, frame, book?.title)
  if (book?.subtitle) push('para', 0, frame, book.subtitle)

  // ── Spur 1..N: Kapitel ─────────────────────────────────────────
  const chapters = Array.isArray(book?.chapters) ? book.chapters : []
  chapters.forEach((ch, i) => {
    const track = i + 1
    const heading = `${bt.chapterLabel} ${ch.number}. ${String(ch.heading || '').trim()}`
    tracks.push({ index: track, title: heading })

    // V1: Name + Beziehung des Beitragenden (Fallback über contribution_id).
    const chSrc = ch.contributor_name ? ch : (contributors || []).find(c => c.id === ch.contribution_id)
    const chName = ch.contributor_name || chSrc?.contributor_name
    const chRel  = ch.relationship    || chSrc?.relationship
    const chGender = ch.contributor_gender || chSrc?.contributor_gender

    // Wer liest dieses Kapitel? Bei einer Person je Kapitel (V1) deren Geschlecht,
    // sonst im Wechsel — so hört man den Kapitelwechsel auch ohne Ansage.
    const speaker = mode !== 'mixed' ? mode
      : chGender ? genderSpeaker(chGender)
      : (i % 2 === 0 ? 'f' : 'm')
    // Fremde Stimmen wechseln gegen die Erzählstimme des Kapitels.
    const guest = mode === 'mixed' ? other(speaker) : mode

    push('chapter', track, speaker, heading)
    // Beim Vorlesen ohne den Gedankenstrich des Drucks, der nichts beiträgt.
    if (chName) push('para', track, speaker, chRel ? `${chName}, ${chRel}` : chName)

    for (const p of paras(ch.body)) push('para', track, speaker, p)

    // Stimmen-Kästen: was andere über diesen Lebensabschnitt erzählen. Beim
    // Vorlesen fehlt der Rahmen des Drucks, deshalb nennt die Zuschreibung die
    // Person NACH dem Zitat — so wie man es im Radio hören würde.
    chapterVoices(ch).forEach((v, vi) => {
      if (vi === 0) push('para', track, speaker, bt.voicesHeading)
      push('para', track, guest, String(v.text).trim())
      const who = [v.name, v.relationship].filter(Boolean).join(', ')
      if (who) push('para', track, guest, who)
    })

    // Zusatzfragen-Kästen (Musik, Lieblingsessen, „wo warst du, als …"). Hier
    // spricht der Erzähler selbst — also die Kapitelstimme, kein Wechsel.
    for (const b of chapterBoxes(ch)) {
      push('para', track, speaker, String(b.title || '').trim())
      push('para', track, speaker, String(b.text).trim())
    }
  })

  // ── Letzte Spur: Mitwirkende + Entstehungshinweis ──────────────
  const last = chapters.length + 1
  const endBlocks = []
  if (showContributors && contributors && contributors.length) {
    endBlocks.push(bt.contributorsHeading)
    for (const c of dedupeContributors(contributors)) {
      const name = (c.contributor_name || '').trim()
      if (!name) continue
      endBlocks.push(c.relationship ? `${name}, ${c.relationship}` : name)
    }
  }
  endBlocks.push(bt.aiDisclaimerTitle)
  endBlocks.push(bookDisclaimer(book?.language || 'de', { ...imageFacts(book), selfNarrated: opts.selfNarrated === true }))
  tracks.push({ index: last, title: bt.contributorsHeading })
  for (const t of endBlocks) push('para', last, frame, t)

  return { blocks, tracks }
}

// Zeichen, geschätzte Spieldauer und Kosten — für die Anzeige VOR dem Start.
// Gerechnet wird auf dem, was tatsächlich gesendet wird (SSML-Auszeichnung
// zählt bei Azure nicht mit) und je Stimme mit ihrer eigenen Preisklasse.
export function audiobookEstimate(blocks, voices) {
  const v = voices && voices.f ? voices : audiobookVoices(null)
  let chars = 0
  let usd = 0
  for (const b of (blocks || [])) {
    const n = String(b.text || '').length
    chars += n
    const voice = b.speaker === 'm' ? v.m : v.f
    usd += n / 1e6 * (isHdVoice(voice) ? USD_PER_M_CHARS.hd : USD_PER_M_CHARS.neural)
  }
  return {
    chars,
    tracks: new Set((blocks || []).map(b => b.track)).size,
    seconds: Math.round(chars / CHARS_PER_SECOND),
    minutes: Math.round(chars / CHARS_PER_SECOND / 60),
    // wie die Bildschätzung in App.jsx; genau gebucht wird serverseitig
    costEur: usd * 0.92,
  }
}

// Dateiname einer Spur: „03_Kapitel_3_Mut_zum_Bleiben.mp3" — zweistellig
// nummeriert, damit jeder Player sie in der richtigen Reihenfolge abspielt.
export function trackFileName(track) {
  const nr = String(track.index).padStart(2, '0')
  const name = safeName(String(track.title || '').slice(0, 60)) || 'Spur'
  return `${nr}_${name}.mp3`
}
