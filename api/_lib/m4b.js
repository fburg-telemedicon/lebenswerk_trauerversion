// api/_lib/m4b.js
// Aus den fertigen MP3-Kapitelspuren eine M4B-Datei mit KAPITELMARKEN bauen.
//
// Warum überhaupt eine zweite Datei? Die Gesamtdatei (api/_lib/audiobook.js) ist
// eine schlichte MP3 ohne jede Struktur: Ein Hörbuch-Player kann darin weder
// springen noch anzeigen, wo man ist. M4B ist das Hörbuch-Format — ein MP4 mit
// AAC-Ton und eingebetteten Kapiteln; Apple Books, BookPlayer, Smart AudioBook
// Player u. a. zeigen damit ein Kapitelverzeichnis und merken sich die Stelle.
//
// Warum in ZWEI Schritten (erst je Kapitel wandeln, dann zusammenfügen)?
// AAC lässt sich nicht aus MP3 kopieren, es muss neu kodiert werden. Ein ganzes
// Buch (leicht 140 Minuten) am Stück zu kodieren sprengt das Zeitbudget einer
// Worker-Runde (GENERATE_BUDGET_MS, Vorgabe 240 s). Deshalb wandert JEDES Kapitel
// einzeln nach `<CODE>/audio/m4b/<variant>-NN.m4a` in den Blob-Storage — das ist
// der einzige Ort, der eine Worker-Runde überlebt (das Temp-Verzeichnis nicht,
// die nächste Runde kann in einem anderen Container laufen). Der Zusammenbau am
// Ende kopiert nur noch (`-c copy`) und dauert Sekunden.
//
// Die Zwischendateien werden nach dem Zusammenbau gelöscht.

const crypto = require('crypto')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { IMAGE_BUCKET } = require('./delete-memorial')

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

// Sprachaufnahme, 24 kHz mono — genau das, was Azure liefert (NARRATION_FORMAT in
// api/_lib/tts.js ist 24-kHz-96-kbit-Mono-MP3). AAC bei 64 kbit ist für Sprache
// klanglich gleichwertig und macht die Datei rund ein Drittel kleiner.
const AAC_BITRATE = process.env.M4B_BITRATE || '64k'
const SAMPLE_RATE = '24000'

const ENCODE_TIMEOUT_MS = 10 * 60 * 1000
const JOIN_TIMEOUT_MS = 15 * 60 * 1000

function run(bin, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        // ffmpeg schreibt alles nach stderr; die letzten Zeilen sind die aussagekräftigen.
        const tail = String(stderr || err.message).trim().split('\n').slice(-3).join(' · ')
        return reject(new Error(tail.slice(0, 400) || err.message))
      }
      resolve(String(stdout || ''))
    })
  })
}

// Ist ffmpeg im Image? Ohne das Werkzeug soll die Oberfläche eine klare Meldung
// zeigen, statt einen Job mit „spawn ENOENT" scheitern zu lassen.
async function ffmpegAvailable() {
  try { await run(FFMPEG, ['-hide_banner', '-version'], 15000); return true }
  catch { return false }
}

async function durationMs(file) {
  const out = await run(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], 60000)
  const sec = parseFloat(String(out).trim())
  if (!isFinite(sec) || sec <= 0) throw new Error(`Spieldauer nicht lesbar: ${path.basename(file)}`)
  return Math.round(sec * 1000)
}

async function downloadTo(supabase, blobPath, file) {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(blobPath)
  if (error || !data) throw new Error(`Datei nicht ladbar (${blobPath}): ${error?.message || 'unbekannt'}`)
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer())
  await fs.writeFile(file, buf)
  return buf.length
}

function aacPath(code, variant, index) {
  return `${code}/audio/m4b/${variant}-${String(index).padStart(2, '0')}.m4a`
}

// EINE Kapitelspur von MP3 nach AAC wandeln und im Storage ablegen. Liefert den
// Eintrag, den der Worker in seinem Zwischenstand sammelt (Spieldauer inklusive —
// aus ihr entstehen später die Kapitelgrenzen).
async function encodeChapter(supabase, code, variant, track) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lwm4b-'))
  try {
    const src = path.join(dir, 'in.mp3')
    const dst = path.join(dir, 'out.m4a')
    await downloadTo(supabase, track.path, src)
    await run(FFMPEG, [
      '-hide_banner', '-nostdin', '-y', '-i', src,
      '-vn', '-c:a', 'aac', '-b:a', AAC_BITRATE, '-ar', SAMPLE_RATE, '-ac', '1',
      dst,
    ], ENCODE_TIMEOUT_MS)
    const ms = await durationMs(dst)
    const buf = await fs.readFile(dst)
    const blobPath = aacPath(code, variant, track.index)
    const { error } = await supabase.storage.from(IMAGE_BUCKET)
      .upload(blobPath, buf, { contentType: 'audio/mp4', upsert: true })
    if (error) throw new Error(`Ablage fehlgeschlagen (${blobPath}): ${error.message}`)
    return { index: track.index, title: track.title || `Kapitel ${track.index}`, path: blobPath, ms, bytes: buf.length }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// In einer FFMETADATA-Datei sind `=`, `;`, `#`, `\` und Zeilenumbrüche Sonderzeichen.
function esc(s) {
  return String(s == null ? '' : s).replace(/([=;#\\])/g, '\\$1').replace(/\r?\n/g, ' ')
}

function ffmetadata(parts, meta) {
  const lines = [';FFMETADATA1']
  if (meta.title) lines.push(`title=${esc(meta.title)}`, `album=${esc(meta.title)}`)
  if (meta.artist) lines.push(`artist=${esc(meta.artist)}`, `album_artist=${esc(meta.artist)}`)
  lines.push('genre=Audiobook')
  if (meta.year) lines.push(`date=${esc(meta.year)}`)
  let at = 0
  for (const p of parts) {
    const end = at + p.ms
    lines.push('', '[CHAPTER]', 'TIMEBASE=1/1000', `START=${at}`, `END=${end}`, `title=${esc(p.title)}`)
    at = end
  }
  return lines.join('\n') + '\n'
}

// Die gewandelten Kapitel zu EINER M4B zusammensetzen. Hier wird nur kopiert, nicht
// neu kodiert — das dauert Sekunden, nicht Minuten.
async function assembleM4b(supabase, code, variant, parts, meta = {}, opts = {}) {
  const list = (parts || []).filter(p => p?.path).slice().sort((a, b) => a.index - b.index)
  if (!list.length) throw new Error('Es liegen keine gewandelten Kapitel vor.')

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lwm4b-join-'))
  try {
    const files = []
    for (const p of list) {
      const f = path.join(dir, `${String(p.index).padStart(3, '0')}.m4a`)
      await downloadTo(supabase, p.path, f)
      files.push(f)
    }
    const listFile = path.join(dir, 'list.txt')
    // Die Dateinamen stammen aus dem Index, enthalten also nur Ziffern — trotzdem
    // wird nach der Regel des concat-Demuxers maskiert.
    const quoted = files.map(f => "file '" + f.split("'").join("'\\''") + "'").join('\n')
    await fs.writeFile(listFile, quoted + '\n')
    const metaFile = path.join(dir, 'meta.txt')
    await fs.writeFile(metaFile, ffmetadata(list, meta), 'utf8')

    // Titelbild: die Vorderseite des Druck-Covers, im Browser gezeichnet und als
    // JPEG mitgeschickt (siehe renderFrontCoverJpeg in src/coverExport.js). Sie
    // wird als „attached_pic" in den MP4-Behälter gelegt — genau das zeigt ein
    // Hörbuch-Player als Umschlag.
    let coverFile = null
    if (opts.coverJpeg) {
      const b64 = String(opts.coverJpeg).replace(/^data:[^,]*,/, '')
      coverFile = path.join(dir, 'cover.jpg')
      await fs.writeFile(coverFile, Buffer.from(b64, 'base64'))
    }

    const out = path.join(dir, 'out.m4b')
    const args = (withCover) => {
      const a = [
        '-hide_banner', '-nostdin', '-y',
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-i', metaFile,
      ]
      if (withCover) a.push('-i', coverFile)
      a.push('-map', '0:a', '-map_metadata', '1', '-map_chapters', '1')
      if (withCover) a.push('-map', '2:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')
      a.push('-c:a', 'copy', '-movflags', '+faststart', out)
      return a
    }
    let cover = !!coverFile
    try {
      await run(FFMPEG, args(cover), JOIN_TIMEOUT_MS)
    } catch (e) {
      // Ohne Umschlag ist die Datei immer noch das, was zählt — mit dem zweiten
      // Versuch geht ein Hörbuch nicht an einem Bild verloren.
      if (!cover) throw e
      console.warn('[m4b] Titelbild konnte nicht eingebettet werden, zweiter Versuch ohne:', e.message)
      cover = false
      await run(FFMPEG, args(false), JOIN_TIMEOUT_MS)
    }

    const buf = await fs.readFile(out)
    const blobPath = `${code}/audio/full-${variant}.m4b`
    const { error } = await supabase.storage.from(IMAGE_BUCKET)
      .upload(blobPath, buf, { contentType: 'audio/mp4', upsert: true })
    if (error) throw new Error(`Ablage im Storage fehlgeschlagen: ${error.message}`)

    return {
      path: blobPath,
      // Nicht erratbare Berechtigung für die kurze Domain-URL (/api/audio&f=m4b).
      // Ist die MP3-Gesamtdatei schon geteilt, gilt DERSELBE Schlüssel — dann
      // genügt am bestehenden Link ein angehängtes `&f=m4b`.
      slug: opts.prevSlug || crypto.randomBytes(12).toString('base64url'),
      filename: String(opts.filename || `Hoerbuch_${variant}.m4b`).slice(0, 160),
      size: buf.length,
      cover,
      ms: list.reduce((n, p) => n + p.ms, 0),
      chapters: list.map(p => ({ index: p.index, title: p.title, ms: p.ms })),
      at: new Date().toISOString(),
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Zwischendateien wegräumen. Scheitert das, ist es kein Fehler — die M4B steht.
async function cleanupChapters(supabase, parts) {
  const paths = (parts || []).map(p => p?.path).filter(Boolean)
  if (!paths.length) return
  try { await supabase.storage.from(IMAGE_BUCKET).remove(paths) } catch { /* egal */ }
}

module.exports = { ffmpegAvailable, encodeChapter, assembleM4b, cleanupChapters, aacPath }
