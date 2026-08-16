// src/pdfFonts.js
// Echte Schriften in JEDES von uns erzeugte PDF einbetten.
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
// Dokumenterzeugung, und zwar NACH den Standardschriften — unsere Einträge
// überschreiben also die Namen 'times' und 'helvetica' im Schriftverzeichnis.
// Folge: Bestehende `setFont('times', …)`-Aufrufe im ganzen Projekt bekommen
// automatisch die eingebettete Schrift, ohne dass eine einzige Zeile Satzcode
// angefasst werden muss.
//
// ZWEI DINGE MUSS ABER JEDE ERZEUGUNGSSTELLE TUN — dafür gibt es `newPdfDoc()`:
//   1. `putOnlyUsedFonts: true`, sonst landen die 13 ungenutzten Standard-
//      schriften trotzdem in der Datei.
//   2. Direkt nach dem Anlegen einmal `setFont()`. Die Vorgabeschrift eines
//      frischen Dokuments zeigt sonst noch auf die eingebaute Helvetica, und wer
//      Text ausgibt, bevor er selbst `setFont` ruft, schleppt sie mit ein.
//
// Vor der ersten Dokumenterzeugung muss `loadPdfFonts()` gelaufen sein — die
// Schriftdateien werden von `/fonts/` geladen (Vite kopiert `public/` nach
// `dist/`), nicht ins JS-Bündel gepackt. Das sind einmalig ~3 MB, die der Browser
// danach im Cache hat; das Bündel bleibt unverändert schlank.

import { jsPDF } from 'jspdf'

const DIR = '/fonts/'

// Standardname (so heißt er im Satzcode) → Dateiname je Schnitt.
const FAMILIES = {
  times: 'LiberationSerif',
  helvetica: 'LiberationSans',
  // courier ist derzeit in keinem Layout eingestellt. Wer ihn einschaltet
  // (bookLayouts.js), muss hier 'LiberationMono' ergänzen UND die vier Dateien
  // nach public/fonts/ legen — sonst bleibt er als Standardschrift uneingebettet.
}
const STYLES = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' }

const fileName = (family, style) => `${FAMILIES[family]}-${STYLES[style]}.ttf`

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

function install() {
  if (installed) return
  installed = true
  jsPDF.API.events.push(['addFonts', function () {
    for (const family of Object.keys(FAMILIES)) {
      for (const style of Object.keys(STYLES)) {
        const file = fileName(family, style)
        const data = loaded.get(file)
        if (!data) continue
        this.addFileToVFS(file, data)
        // Zweimal registrieren: unter dem Standardnamen (überschreibt ihn) und
        // unter dem echten Namen, falls jemand die Schrift gezielt ansprechen will.
        this.addFont(file, family, style)
        this.addFont(file, FAMILIES[family], style)
      }
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
  return doc
}
