// src/pdfFonts.js
// Echte Schriften in JEDES von uns erzeugte PDF einbetten — und zwar so benannt,
// wie der Preflight der Druckerei es erwartet.
//
// WARUM: jsPDF benutzt von Haus aus die 14 PostScript-Standardschriften
// (times/helvetica/courier). Die liegen laut PDF-Norm in jedem Reader vor,
// stehen aber NICHT in der Datei. Eine Druckerei prüft die Druckdaten und meldet
// dann „einige Schriften sind nicht eingebettet" (so geschehen am 2026-08-16 bei
// den Lutherhof-Druckdaten). Zusätzlich schreibt jsPDF ALLE 14 Standardschriften
// in die Ressourcen jeder Seite — auch nie benutzte wie Symbol und ZapfDingbats.
//
// WIE: Wir ersetzen die Standardschriften durch maßgleiche freie Schriften und
// betten sie als echte Schriftdateien ein:
//   times     → Liberation Serif  (maßgleich zu Times New Roman)
//   helvetica → Liberation Sans   (maßgleich zu Arial/Helvetica)
// „Maßgleich" heißt: identische Zeichenbreiten, der Umbruch verschiebt sich also
// höchstens minimal (gemessen 0,2–0,75 % gegenüber jsPDFs eingebauter Times, weil
// deren Breitentabelle leicht abweicht). Liberation steht unter der SIL Open Font
// License und darf deshalb bedenkenlos in Druckdaten weitergegeben werden; die
// Lizenz liegt bei den Dateien (public/fonts/LICENSE-Liberation.txt).
//
// Die Registrierung läuft über jsPDFs `addFonts`-Ereignis. Das feuert bei JEDER
// Dokumenterzeugung, und zwar NACH den Standardschriften. Es liefert im Nutzdaten-
// objekt das Schriftverzeichnis (`dictionary`) mit — genau das brauchen wir, siehe
// „Namensgebung" unten. Folge: Bestehende `setFont('times', …)`-Aufrufe im ganzen
// Projekt bekommen automatisch die eingebettete Schrift, ohne dass eine einzige
// Zeile Satzcode angefasst werden muss.
//
// NAMENSGEBUNG (2026-08-16, zweite Runde): Eingebettet allein reicht dem Preflight
// nicht. jsPDF schreibt als PostScript-Namen (/BaseFont, /FontName) stur den Namen,
// unter dem die Schrift registriert wurde. Registriert man sie unter 'times', steht
// in der Druckdatei viermal eine Schrift namens „times" — vier verschiedene Schrift-
// programme (Regular/Bold/Italic/BoldItalic) unter EINEM Namen, der obendrein wie
// die nicht eingebettete Standard-Times aussieht. RIPs und Preflight-Programme
// führen Schriften über diesen Namen; gleicher Name + unterschiedliches Programm ist
// ein klassischer Schriftkonflikt. Außerdem bettet jsPDF immer nur eine TEILMENGE
// ein (nur die benutzten Glyphen, ~53 kB statt ~384 kB) — und für Teilmengen
// verlangt PDF 32000-1, Abschnitt 9.6.4, ein Präfix aus sechs Großbuchstaben und
// einem „+". Das setzt jsPDF nicht.
//
// Deshalb registrieren wir jeden Schnitt unter seinem ECHTEN, eindeutigen Namen
// samt Teilmengen-Präfix (z. B. `NKPRQD+LiberationSerif-Bold`) und hängen 'times'
// bzw. 'helvetica' nur als VERWEIS ins Schriftverzeichnis. Der Satzcode spricht die
// Schrift weiter wie bisher an, in der Datei steht aber der korrekte Name.
//
// ZWEI DINGE MUSS ABER JEDE ERZEUGUNGSSTELLE TUN — dafür gibt es `newPdfDoc()`:
//   1. `putOnlyUsedFonts: true`, sonst landen die 13 ungenutzten Standard-
//      schriften trotzdem in der Datei.
//   2. Direkt nach dem Anlegen einmal `setFont()`. Die Vorgabeschrift eines
//      frischen Dokuments zeigt sonst noch auf die eingebaute Helvetica, und wer
//      Text ausgibt, bevor er selbst `setFont` ruft, schleppt sie mit ein.
// `newPdfDoc()` legt zusätzlich einen Wächter über `setFont`: Wer eine Schrift
// setzt, die wir NICHT eingebettet haben (z. B. 'courier'), bekommt eine deutliche
// Warnung, statt dass die Druckerei es Wochen später reklamiert.
//
// Vor der ersten Dokumenterzeugung muss `loadPdfFonts()` gelaufen sein — die
// Schriftdateien werden von `/fonts/` geladen (Vite kopiert `public/` nach
// `dist/`), nicht ins JS-Bündel gepackt. Das sind einmalig ~3 MB, die der Browser
// danach im Cache hat; das Bündel bleibt unverändert schlank.

import { jsPDF } from 'jspdf'

const DIR = '/fonts/'

// Standardname (so heißt er im Satzcode) → Schriftfamilie auf der Platte.
// Der Dateiname ist zugleich der PostScript-Familienname der Schrift.
const FAMILIES = {
  times: 'LiberationSerif',
  helvetica: 'LiberationSans',
  // courier ist in keinem Layout eingestellt und deshalb hier nicht hinterlegt.
  // Wer ihn einschaltet (bookLayouts.js), muss 'LiberationMono' ergänzen UND die
  // vier Dateien nach public/fonts/ legen. Vergisst er es, warnt der setFont-
  // Wächter in newPdfDoc() beim ersten Erzeugen — uneingebettet rutscht nichts durch.
}
const STYLES = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' }
// Namenszusatz je Schnitt, wie ihn die Schrift selbst trägt (LiberationSerif-Bold …).
const PS_SUFFIX = { normal: '', bold: '-Bold', italic: '-Italic', bolditalic: '-BoldItalic' }

const fileName = (family, style) => `${FAMILIES[family]}-${STYLES[style]}.ttf`

// Teilmengen-Präfix nach PDF 32000-1, 9.6.4: sechs Großbuchstaben und ein „+".
// Deterministisch aus dem Namen gebildet (FNV-1a), damit dieselbe Schrift in jedem
// erzeugten PDF dasselbe Präfix trägt und Ausgaben vergleichbar bleiben.
function subsetTag(name) {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h %= 308915776   // 26^6 – passt garantiert in sechs Buchstaben
  let tag = ''
  for (let i = 0; i < 6; i++) { tag = String.fromCharCode(65 + (h % 26)) + tag; h = Math.floor(h / 26) }
  return tag
}
const subsetName = base => `${subsetTag(base)}+${base}`

const loaded = new Map()      // Dateiname → base64
let installed = false
let inFlight = null

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  // In Blöcken, sonst sprengt der Aufrufstapel bei ~400 kB je Datei.
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

// Einen Namen im Schriftverzeichnis auf eine bereits registrierte Schrift zeigen
// lassen — ohne einen zweiten Eintrag mit falschem PostScript-Namen anzulegen.
// jsPDF sucht kleingeschrieben (getFont), deshalb kleingeschrieben ablegen.
// Gibt false zurück, wenn das Verzeichnis nicht erreichbar ist (andere jsPDF-
// Fassung); die Aufrufer fallen dann auf die frühere Registrierung zurück.
function aliasFont(dict, name, style, key) {
  if (!dict || !key) return false
  const k = String(name).toLowerCase()
  dict[k] = dict[k] || {}
  dict[k][style] = key
  return true
}

function install() {
  if (installed) return
  installed = true
  jsPDF.API.events.push(['addFonts', function (payload) {
    const dict = payload && payload.dictionary
    // Verzeichnis fürs spätere Nachregistrieren (registerUnicodeSerif) merken.
    this.__lwFontDict = dict || null
    this.__lwEmbedded = new Set()
    for (const family of Object.keys(FAMILIES)) {
      for (const style of Object.keys(STYLES)) {
        const file = fileName(family, style)
        const data = loaded.get(file)
        if (!data) continue
        this.addFileToVFS(file, data)
        const ps = subsetName(`${FAMILIES[family]}${PS_SUFFIX[style]}`)
        const key = this.addFont(file, ps, style)
        // 'times'/'helvetica' (Satzcode) und der schlichte Familienname zeigen auf
        // dieselbe Schrift. Klappt der Verweis nicht, wie bisher doppelt anmelden.
        if (!aliasFont(dict, family, style, key)) this.addFont(file, family, style)
        if (!aliasFont(dict, FAMILIES[family], style, key)) this.addFont(file, FAMILIES[family], style)
      }
      this.__lwEmbedded.add(family)
      this.__lwEmbedded.add(FAMILIES[family].toLowerCase())
    }
  }])
}

// Lädt die Schriftdateien einmalig und hängt sie in jsPDF ein. Mehrfachaufrufe
// sind billig; parallele Aufrufe teilen sich denselben Ladevorgang.
export async function loadPdfFonts() {
  if (loaded.size) return
  if (!inFlight) {
    inFlight = (async () => {
      const jobs = []
      for (const family of Object.keys(FAMILIES)) {
        for (const style of Object.keys(STYLES)) {
          const file = fileName(family, style)
          jobs.push(fetch(DIR + file).then(async res => {
            if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
            loaded.set(file, toBase64(await res.arrayBuffer()))
          }))
        }
      }
      try {
        await Promise.all(jobs)
      } catch (e) {
        loaded.clear()
        throw new Error(`Die Schriften für den PDF-Export konnten nicht geladen werden (${e.message}). `
          + 'Bitte die Seite neu laden und es noch einmal versuchen.')
      }
      install()
    })().finally(() => { inFlight = null })
  }
  await inFlight
}

// Den Unicode-Serif (DejaVu) auf DIESEM Dokument anmelden. Wird für Buchtexte und
// Umschlagtitel gebraucht, die Latin-Extended-A enthalten (polnisch ś/ż/ł/ć …) —
// Liberation deckt das zwar ab, der DejaVu-Zweig ist aber der erprobte Weg und
// bleibt deshalb bestehen (bookExport.js, coverExport.js).
//
// Es werden nur ZWEI Schriftprogramme eingebettet: DejaVu Serif hat bei uns keinen
// echten Kursivschnitt, „italic" lief immer schon über die Regular-Datei. Früher
// wurde dieselbe Datei dafür ein zweites Mal angemeldet — das ergab zwei getrennte
// Teilmengen unter demselben Namen „DejaVuSerif", also genau den Namenskonflikt,
// den die Druckerei nicht sehen soll. Jetzt verweist der Kursiv-Eintrag auf
// dieselbe Schrift (gleiche Darstellung wie bisher, eine Teilmenge weniger).
// `fonts`: { regular, bold } als base64 (src/fonts/dejavuSerif.js).
export function registerUnicodeSerif(doc, fonts) {
  if (!fonts || doc.__lwUnicodeSerif) return
  doc.__lwUnicodeSerif = true
  const dict = doc.__lwFontDict
  doc.addFileToVFS('DejaVuSerif.ttf', fonts.regular)
  doc.addFileToVFS('DejaVuSerif-Bold.ttf', fonts.bold)
  const reg  = doc.addFont('DejaVuSerif.ttf', subsetName('DejaVuSerif'), 'normal')
  const bold = doc.addFont('DejaVuSerif-Bold.ttf', subsetName('DejaVuSerif-Bold'), 'bold')
  const ok =
    aliasFont(dict, 'DejaVuSerif', 'normal', reg) &&
    aliasFont(dict, 'DejaVuSerif', 'italic', reg) &&
    aliasFont(dict, 'DejaVuSerif', 'bold', bold) &&
    aliasFont(dict, 'DejaVuSerif', 'bolditalic', bold)
  if (!ok) {
    // Kein Verzeichniszugriff → wie früher unter dem Klarnamen anmelden.
    doc.addFont('DejaVuSerif.ttf', 'DejaVuSerif', 'normal')
    doc.addFont('DejaVuSerif.ttf', 'DejaVuSerif', 'italic')
    doc.addFont('DejaVuSerif-Bold.ttf', 'DejaVuSerif', 'bold')
    doc.addFont('DejaVuSerif-Bold.ttf', 'DejaVuSerif', 'bolditalic')
  }
  doc.__lwEmbedded?.add('dejavuserif')
}

let warnedFonts = null

// Ein PDF-Dokument mit eingebetteten Schriften anlegen. Ersetzt `new jsPDF(…)`
// überall dort, wo wir PDFs erzeugen.
export function newPdfDoc(options = {}) {
  const doc = new jsPDF({ ...options, putOnlyUsedFonts: true })
  // Aktivschrift von der eingebauten Vorgabe auf die eingebettete umstellen.
  doc.setFont('helvetica', 'normal')
  if (!loaded.size && typeof console !== 'undefined') {
    console.warn('[pdfFonts] Schriften nicht geladen — dieses PDF bekommt nicht eingebettete Standardschriften. '
      + 'Vor dem Erzeugen `await loadPdfFonts()` aufrufen.')
  }
  // Wächter: schlägt an, sobald jemand eine Schrift setzt, die wir nicht
  // eingebettet haben. Die Druckerei würde sie sonst als fehlend reklamieren.
  const setFont = doc.setFont.bind(doc)
  doc.setFont = function (name, style, weight) {
    const k = String(name ?? '').toLowerCase()
    if (k && doc.__lwEmbedded && !doc.__lwEmbedded.has(k) && typeof console !== 'undefined') {
      warnedFonts = warnedFonts || new Set()
      if (!warnedFonts.has(k)) {
        warnedFonts.add(k)
        console.warn(`[pdfFonts] Schrift „${name}" ist nicht eingebettet — die Druckerei wird sie reklamieren. `
          + 'Schriftdateien nach public/fonts/ legen und in FAMILIES (src/pdfFonts.js) eintragen.')
      }
    }
    return setFont(name, style, weight)
  }
  return doc
}
