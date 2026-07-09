import { useState, useEffect, useRef, Fragment } from 'react'
import { Document, Packer, Paragraph, HeadingLevel, AlignmentType, ImageRun, TextRun, Footer, PageNumber, SectionType } from 'docx'
import jsPDF from 'jspdf'
import JSZip from 'jszip'
import {
  createMemorial, getMemorial, getContribution, addContribution,
  askLLM, speakText, stopSpeaking, primeAudio, adminDeleteMemorial, adminSaveMemorialText, adminUpdateMemorialMeta, adminGenerateImage,
  uploadContributorImage, adminUploadImage, adminDeleteUpload, adminUpdateUpload, adminComposeImage,
  adminDeleteContribution, adminUpdateContributionMessages,
  getMemorialCosts,
  adminListUsers, adminCreateUser, adminUpdateUser, adminDeleteUser, adminListAudit,
  adminListCatalogs, adminCreateCatalog, adminUpdateCatalog, adminDeleteCatalog,
  getSettings, saveSettings, changeOwnPassword,
  getInvite, redeemInvite,
} from './api.js'
import { CATEGORIES, CATEGORY_ORDER, DEFAULT_CATEGORY, getCategory, categoryColor } from './categories.js'
import { LANGUAGES, LANGUAGE_CODES, DEFAULT_LANGUAGE, langDirective, uiText, contributorL10n } from './i18n.js'
import CategoryIcon from './CategoryIcon.jsx'
import { reviewSystemPrompt, extractReviewText, contributionsContext } from './review.js'

// ── URL params ────────────────────────────────────────────────────
const urlParams     = new URLSearchParams(window.location.search)
const codeFromURL   = (urlParams.get('code') || '').toUpperCase().trim()
const sessionFromURL = (urlParams.get('session') || '').trim()
const inviteFromURL = (urlParams.get('invite') || '').trim() // Self-Onboarding eines neuen Benutzers

// Versions-Tag des Einwilligungstextes. Bei JEDER inhaltlichen Änderung des
// Consent-/Datenschutztextes hochzählen, damit protokolliert ist, welcher
// Fassung zugestimmt wurde.
const CONSENT_VERSION = '1.4 (2026-06-22)'

// Disclaimer zur Entstehung & Haftung – wird ans Ende jedes Buchs/jeder Rede
// gesetzt (HTML-Ansicht + DOCX) und im Impressum/Datenschutz referenziert.
const BOOK_DISCLAIMER_TITLE = 'Hinweis zur Entstehung dieses Buches'
const BOOK_DISCLAIMER =
  'Dieses Buch wurde auf Grundlage von Interviews mit nahestehenden Personen mithilfe von künstlicher Intelligenz erstellt. Es gibt persönliche Erinnerungen und Schilderungen der Beitragenden wieder. Ihre inhaltliche Richtigkeit, Vollständigkeit und Aktualität können wir nicht überprüfen; eine Haftung hierfür ist – soweit gesetzlich zulässig – ausgeschlossen.'

// Liest eine Bilddatei und gibt eine herunterskalierte JPEG-Data-URL zurück
// (längste Kante ≤ maxEdge). Hält die Upload-Nutzlast unter dem Vercel-Body-
// Limit und beschleunigt den Upload. Bei nicht darstellbaren Formaten (z. B.
// HEIC) fällt sie auf die Original-Data-URL zurück (sharp kann sie serverseitig).
function fileToDownscaledDataURL(file, maxEdge = 2400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          let { width, height } = img
          const scale = Math.min(1, maxEdge / Math.max(width, height))
          width = Math.round(width * scale); height = Math.round(height * scale)
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch { resolve(reader.result) }
      }
      img.onerror = () => resolve(reader.result)
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// ── Passwortrichtlinie (identisch zu api/_lib/auth.js) ────────────
// Moderat: mind. 8 Zeichen, mind. 1 Ziffer, mind. 1 Sonderzeichen.
const PASSWORD_RULES_TEXT = 'Mindestens 8 Zeichen, davon mindestens eine Ziffer und ein Sonderzeichen.'
function passwordError(p) {
  const s = String(p ?? '')
  if (s.length < 8) return 'Passwort muss mindestens 8 Zeichen haben.'
  if (!/[0-9]/.test(s)) return 'Passwort muss mindestens eine Ziffer enthalten.'
  if (!/[^A-Za-z0-9]/.test(s)) return 'Passwort muss mindestens ein Sonderzeichen enthalten.'
  return null
}

// Übersetzt eine (oft englische, technische) Bildgenerierungs-Fehlermeldung in
// einen verständlichen deutschen Hinweis und ergänzt die Aufforderung, sich an
// den Administrator zu wenden. Wird an allen Anzeigestellen verwendet; die
// rohe Meldung bleibt für die Diagnose in den Daten erhalten.
function imageErrorDe(raw) {
  const core = String(raw || '').replace(/^Bildgenerierung fehlgeschlagen(?: \([^)]*\))?:\s*/i, '')
  const admin = ' Bitte wenden Sie sich an den Administrator.'
  let de
  if (/RAI policy|BingBlockList|responsible ai|content (policy|filter|management)|blocklist|block list|moderat|flagged/i.test(core))
    de = 'Das KI-Bildmotiv wurde vom Inhaltsfilter abgelehnt.'
  else if (/rate.?limit|too many requests|exceeded|\b429\b/i.test(core))
    de = 'Das Bildlimit wurde kurzzeitig erreicht (zu viele Anfragen in kurzer Zeit).'
  else if (/image_prompt|Bild-Prompt|kein image_prompt/i.test(core))
    de = 'Für dieses Kapitel wurde kein Bildmotiv erzeugt.'
  else if (/timeout|timed out|nicht rechtzeitig|keine bilddaten|HTTP 5\d\d|\b50[234]\b|bad gateway|FUNCTION_INVOCATION_TIMEOUT|fetch failed/i.test(core))
    de = 'Die Bilderzeugung hat zu lange gedauert oder der Bilddienst war nicht erreichbar.'
  else if (/Storage|Upload/i.test(core))
    de = 'Das erzeugte Bild konnte nicht gespeichert werden.'
  else if (/nicht konfiguriert|AZURE_FLUX/i.test(core))
    de = 'Der Bilddienst ist nicht korrekt konfiguriert.'
  else
    de = 'Die Bilderzeugung ist fehlgeschlagen.'
  return de + admin
}

// ── Lokale Session-Persistenz (Option 1: localStorage) ────────────
const SESSION_TTL_DAYS = 60
function sessionKey(code) { return `lw_session_${code}` }
function saveLocalSession(code, data) {
  try { localStorage.setItem(sessionKey(code), JSON.stringify({ ...data, savedAt: Date.now() })) } catch {}
}
function loadLocalSession(code) {
  try {
    const raw = localStorage.getItem(sessionKey(code))
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s?.contribId || !s?.savedAt) return null
    const ageDays = (Date.now() - s.savedAt) / 86400000
    if (ageDays > SESSION_TTL_DAYS) { localStorage.removeItem(sessionKey(code)); return null }
    return s
  } catch { return null }
}
function clearLocalSession(code) {
  try { localStorage.removeItem(sessionKey(code)) } catch {}
}

// ── Hilfsfunktionen Download ──────────────────────────────────────
function formatContribution(memorial, c) {
  const noun = getCategory(memorial?.product_category).nounBook
  const lines = [
    `${noun.toUpperCase()}: ${memorial.name}`,
    `Organisator: ${memorial.organizer}`,
    '',
    `Beitrag von: ${c.contributor_name}`,
    `Beziehung:   ${c.relationship}`,
    `Datum:       ${new Date(c.created_at).toLocaleDateString('de-DE')}`,
    '',
    '─'.repeat(50),
    '',
  ]
  for (let i = 0; i < c.messages.length; i++) {
    const m = c.messages[i]
    if (m.role === 'assistant') {
      lines.push(`Frage:   ${m.content}`)
    } else {
      lines.push(`Antwort: ${m.content}`, '')
    }
  }
  return lines.join('\n')
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadFile(filename, content) {
  downloadBlob(filename, new Blob([content], { type: 'text/plain;charset=utf-8' }))
}

function safeName(s) { return s.replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim().replace(/\s+/g, '_') }

// Wandelt den messages-Array eines Beitrags in Frage/Antwort-Paare um.
function contributionQAPairs(messages = []) {
  const pairs = []
  for (let j = 0; j < messages.length; j++) {
    if (messages[j].role === 'assistant') {
      const hasAnswer = messages[j + 1]?.role === 'user'
      pairs.push({ q: messages[j].content, a: hasAnswer ? messages[j + 1].content : null })
      if (hasAnswer) j++
    } else {
      pairs.push({ q: null, a: messages[j].content })
    }
  }
  return pairs
}

// Baut ein gut lesbares PDF mit den Daten EINES Beitragenden (DSGVO Art. 15).
// Gibt einen Blob zurück.
function buildContributionPdf(c, memorial) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 20
  const maxW = pageW - margin * 2
  let y = margin

  const lineHeight = size => size * 0.3528 * 1.32 // pt → mm, mit Zeilenabstand

  const ensure = h => { if (y + h > pageH - margin) { doc.addPage(); y = margin } }

  function write(text, { size = 11, style = 'normal', color = [40, 40, 40], indent = 0, gapAfter = 2 } = {}) {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
    const lh = lineHeight(size)
    const lines = doc.splitTextToSize(String(text ?? ''), maxW - indent)
    for (const line of lines) { ensure(lh); doc.text(line, margin + indent, y); y += lh }
    y += gapAfter
  }
  function rule() { ensure(4); doc.setDrawColor(210); doc.line(margin, y, pageW - margin, y); y += 5 }

  write('Datenauskunft', { size: 20, style: 'bold', color: [30, 30, 30], gapAfter: 1 })
  write('gemäß DSGVO Art. 15 (Auskunft) und Art. 20 (Datenübertragbarkeit)', { size: 10, color: [120, 120, 120], gapAfter: 3 })
  write(`${getCategory(memorial?.product_category).nounBook}: ${memorial.name}  (Code ${memorial.id})`, { size: 10, color: [90, 90, 90], gapAfter: 1 })
  write(`Erstellt am: ${new Date().toLocaleString('de-DE')}`, { size: 10, color: [90, 90, 90], gapAfter: 3 })
  rule()

  write('Angaben zur Person', { size: 14, style: 'bold', gapAfter: 2.5 })
  const fields = [
    ['Name', c.contributor_name],
    ['Beziehung zur Person', c.relationship],
    ['Geschlecht', c.contributor_gender],
    ['Anrede', c.contributor_address],
    ['Beitrag erstellt am', c.created_at ? new Date(c.created_at).toLocaleString('de-DE') : null],
  ]
  for (const [label, value] of fields) {
    if (!value) continue
    write(`${label}:`, { size: 10, style: 'bold', color: [110, 110, 110], gapAfter: 0.5 })
    write(String(value), { size: 11, indent: 2, gapAfter: 2 })
  }
  y += 2
  rule()

  write('Interview-Verlauf', { size: 14, style: 'bold', gapAfter: 3 })
  const pairs = contributionQAPairs(c.messages)
  if (pairs.length === 0) {
    write('Dieser Beitrag enthält keine Inhalte.', { size: 11, color: [120, 120, 120] })
  } else {
    pairs.forEach((p, i) => {
      if (p.q) write(`Frage ${i + 1}: ${p.q}`, { size: 11, style: 'bold', color: [60, 60, 60], gapAfter: 1 })
      write(p.a || '(keine Antwort)', { size: 11, indent: 3, gapAfter: 4 })
    })
  }

  return doc.output('blob')
}

function renderRichText(text) {
  if (!text) return null
  return text.split('\n\n').map((chunk, i) => {
    const c = chunk.trim()
    if (!c) return null
    if (c.startsWith('## ')) return <h2 key={i} style={{ fontSize:22, fontWeight:700, fontFamily:'Georgia,serif', marginTop: i === 0 ? 0 : '2rem', marginBottom:'.75rem' }}>{c.slice(3)}</h2>
    if (c.startsWith('# '))  return <h1 key={i} style={{ fontSize:28, fontWeight:700, fontFamily:'Georgia,serif' }}>{c.slice(2)}</h1>
    return <p key={i} style={{ marginBottom:'1.4rem' }}>{c}</p>
  }).filter(Boolean)
}

function tryParseJSON(raw) {
  if (!raw) return null
  let s = String(raw).trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  // Falls die KI doch noch Text drumherum schreibt: ersten { bis letzten } isolieren
  const first = s.indexOf('{')
  const last  = s.lastIndexOf('}')
  if (first > 0 || (first === 0 && last > 0 && last < s.length - 1)) s = s.slice(first, last + 1)
  try { return JSON.parse(s) } catch {}
  // Zweiter Versuch: häufigen LLM-Ausrutscher „trailing comma" (Komma vor } oder ]) entfernen.
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1')) } catch { return null }
}

// Prompt für die KI-Bildzuordnung: welche hochgeladenen Fotos passen in welches
// Kapitel? Liefert JSON { assignments: [{ chapter, image_ids:[…] }] }.
function imageAssignSystem(chapters, uploads) {
  const chapLines = chapters.map(c => `${c.number}. ${c.heading || ''}`).join('\n')
  const upLines = uploads.map(u =>
    `- id ${u.id}: ${u.caption ? '„' + u.caption + '" – ' : ''}${u.description || '(keine Beschreibung)'} [${u.orientation}${u.quality_flag === 'low' ? ', geringe Qualität' : ''}]`
  ).join('\n')
  return `Du ordnest hochgeladene Fotos den Kapiteln eines Buches zu.

Kapitel:
${chapLines}

Fotos:
${upLines}

Ordne jedes Foto dem inhaltlich und zeitlich am besten passenden Kapitel zu (nutze Bildunterschrift und Beschreibung). Ein Kapitel darf mehrere Fotos bekommen; nicht jedes Kapitel braucht eines. Lässt sich ein Foto nicht sinnvoll zuordnen, lass es weg.

Gib REINES, GÜLTIGES JSON aus (kein Markdown-Codeblock, keine Erklärungen):
{
  "assignments": [
    { "chapter": <Kapitelnummer als Zahl>, "image_ids": ["id1", "id2"] }
  ]
}`
}

async function fetchImageBuffer(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.arrayBuffer()
  } catch { return null }
}

// Beitragende mit exakt gleichem Namen UND gleicher Beziehung nur einmal listen.
function dedupeContributors(list) {
  const seen = new Set()
  const out = []
  for (const c of (list || [])) {
    const key = `${(c.contributor_name || '').trim()} ${(c.relationship || '').trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

// Druckfertiges DOCX: DIN A5 hochkant inkl. 3 mm Beschnitt (Datenformat
// 15,4 × 21,6 cm), Serifenschrift 12 pt, Seitenzahl unten mittig. Jedes
// Kapitel ist eine eigene Sektion: zuerst eine Bildseite, dann beginnt der
// Kapiteltext per „gerade Seite" links (Word fügt ggf. eine Leerseite ein).
const DOCX_FONT = 'Georgia'
const tw = cm => Math.round(cm * 567) // cm → twips (1 cm = 567 twips)
const DOCX_PAGE = {
  size: { width: tw(15.4), height: tw(21.6) },
  margin: { top: tw(1.6), bottom: tw(1.6), left: tw(1.6), right: tw(1.6) },
}
function docxFooter() {
  return new Footer({ children: [ new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [ new TextRun({ children: [PageNumber.CURRENT], font: DOCX_FONT, size: 20 }) ],
  }) ] })
}
const docxSection = (children, type) => ({
  properties: { page: DOCX_PAGE, ...(type ? { type } : {}) },
  footers: { default: docxFooter() },
  children,
})

// Wandelt eine Data-URL (data:image/…;base64,…) in rohe Bytes (für docx ImageRun).
function dataUrlToUint8(dataUrl) {
  const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1))
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}
// Bildtyp aus einer Data-URL (png, jpeg, gif, webp, svg+xml …).
function imageKindOf(dataUrl) {
  const m = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl || '')
  return (m ? m[1] : '').toLowerCase()
}
// Lädt eine Logo-Data-URL und liefert Typ + natürliche Maße (für Export-Skalierung).
// null, wenn keine (gültige) Bild-Data-URL.
async function prepareLogoForExport(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const dim = await new Promise(res => {
    const im = new Image()
    im.onload = () => res({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 })
    im.onerror = () => res(null)
    im.src = dataUrl
  })
  if (!dim || !dim.w || !dim.h) return null
  return { dataUrl, kind: imageKindOf(dataUrl), w: dim.w, h: dim.h }
}

async function downloadStructuredDocx(filename, book, contributors = [], logoDataUrl = null) {
  const bt = uiText(book.language)
  const sections = []

  // Titelseite
  sections.push(docxSection([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(4), after: 240 },
      children: [new TextRun({ text: book.title || '', font: DOCX_FONT, size: 48, bold: true })] }),
    ...(book.subtitle ? [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: book.subtitle, font: DOCX_FONT, size: 28, italics: true, color: '78716c' })] })] : []),
  ]))

  for (const ch of (book.chapters || [])) {
    // Bildseite vor dem Kapitel (eigene Seite). Hinweis: ein echtes
    // Doppelseiten-Motiv (über zwei Seiten) ist im Druck-Layout zu setzen.
    let imgPara = null
    if (ch.image_url) {
      const buf = await fetchImageBuffer(ch.image_url)
      if (buf) imgPara = new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: tw(4) },
        children: [new ImageRun({ data: buf, transformation: { width: 460, height: 307 } })], // 3:2, volle Satzbreite A5
      })
    }
    if (imgPara) sections.push(docxSection([imgPara], SectionType.NEXT_PAGE))

    // V1: Name + Beziehung des Beitragenden (Fallback über contribution_id).
    const chSrc = ch.contributor_name ? ch : (contributors || []).find(c => c.id === ch.contribution_id)
    const chName = ch.contributor_name || chSrc?.contributor_name
    const chRel  = ch.relationship    || chSrc?.relationship

    // Kapiteltext beginnt auf der linken (geraden) Seite.
    const content = [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: tw(2), after: 100 },
        children: [new TextRun({ text: `${bt.chapterLabel} ${ch.number}`, font: DOCX_FONT, size: 20, color: 'a8a29e' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: chName ? 100 : 300 },
        children: [new TextRun({ text: ch.heading || '', font: DOCX_FONT, size: 36, bold: true })] }),
      ...(chName ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
        children: [new TextRun({ text: chRel ? `${chName} – ${chRel}` : chName, font: DOCX_FONT, size: 24, italics: true, color: '78716c' })] })] : []),
      ...String(ch.body || '').split('\n\n').map(r => r.trim()).filter(Boolean).map(chunk =>
        new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: chunk, font: DOCX_FONT, size: 24 })] })),
    ]
    sections.push(docxSection(content, SectionType.EVEN_PAGE))
  }

  // Mitwirkende + Disclaimer (eigene Seite am Ende)
  const endChildren = []
  if (contributors && contributors.length) {
    endChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
      children: [new TextRun({ text: bt.contributorsHeading, font: DOCX_FONT, size: 36, bold: true })] }))
    for (const c of dedupeContributors(contributors)) {
      const rel = c.relationship ? ` — ${c.relationship}` : ''
      endChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [
        new TextRun({ text: c.contributor_name || '', font: DOCX_FONT, bold: true, size: 24 }),
        new TextRun({ text: rel, font: DOCX_FONT, color: '78716c', size: 24 }),
      ] }))
    }
  }
  endChildren.push(new Paragraph({ spacing: { before: tw(2), after: 120 },
    children: [new TextRun({ text: BOOK_DISCLAIMER_TITLE, font: DOCX_FONT, size: 20, bold: true, color: '78716c' })] }))
  // Logo des Buch-Inhabers zwischen Hinweis-Titel und Hinweis-Text. Nur Raster-
  // formate (docx ImageRun kann kein SVG/WebP) – sonst still überspringen.
  const docxLogo = await prepareLogoForExport(logoDataUrl)
  if (docxLogo && /^(png|jpe?g|gif)$/.test(docxLogo.kind)) {
    const w = Math.min(150, docxLogo.w)
    const h = Math.round(w * docxLogo.h / docxLogo.w)
    try {
      endChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 140 },
        children: [new ImageRun({ data: dataUrlToUint8(docxLogo.dataUrl), transformation: { width: w, height: h } })] }))
    } catch { /* defektes Logo darf den Export nicht abbrechen */ }
  }
  endChildren.push(new Paragraph({ spacing: { after: 200 },
    children: [new TextRun({ text: BOOK_DISCLAIMER, font: DOCX_FONT, size: 18, italics: true, color: '78716c' })] }))
  sections.push(docxSection(endChildren, SectionType.NEXT_PAGE))

  const doc = new Document({
    creator: 'Lebenswerk', title: book.title || '',
    styles: { default: { document: { run: { font: DOCX_FONT, size: 24 } } } },
    sections,
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}

// Lädt ein Bild als Data-URL inkl. natürlicher Pixelmaße (für die randlose
// „Cover"-Platzierung im Druck-PDF). Gibt null zurück, wenn nicht ladbar.
async function fetchImageForPdf(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const blob = await r.blob()
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = rej
      fr.readAsDataURL(blob)
    })
    const dim = await new Promise((res) => {
      const im = new Image()
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
      im.onerror = () => res(null)
      im.src = dataUrl
    })
    return { dataUrl, w: dim?.w || 3, h: dim?.h || 2 }
  } catch { return null }
}

// Druckfertiges PDF (einseitige Seiten, exakte Platzierung). Endformat je
// Einzelseite 15,4 × 21,6 cm = DIN A5 (14,8 × 21,0) + 3 mm Beschnitt ringsum.
// Layout-Regeln:
//  • Titelseite auf der ersten RECHTEN Seite (recto).
//  • Pro Kapitel: doppelseitiges Bild (linke Hälfte auf der LINKEN Seite,
//    rechte Hälfte auf der RECHTEN Seite), danach eine LEERE Seite, danach
//    beginnt die Kapitelüberschrift auf der nächsten RECHTEN Seite.
//  • Das Bild wird auf die Doppelseite 30,8 × 21,6 cm „gecovert" (randlos
//    füllend, mittiger Beschnitt, ohne Verzerrung) und exakt in der Mitte
//    vertikal geteilt.
const PDF_PAGE_W = 154   // mm – Einzelseite inkl. Beschnitt
const PDF_PAGE_H = 216   // mm
const PDF_SPREAD_W = PDF_PAGE_W * 2 // 308 mm – Doppelseite

async function downloadPrintPdf(filename, book, contributors = [], logoDataUrl = null) {
  const bt = uiText(book.language)
  const doc = new jsPDF({ unit: 'mm', format: [PDF_PAGE_W, PDF_PAGE_H] })
  let page = 1 // jsPDF hat Seite 1 bereits angelegt; recto = ungerade
  // Seitenklassifizierung für die Seitenzahlen: Bild- und Leerseiten bekommen
  // KEINE Nummer; alle übrigen (Text-)Seiten schon. Nummern werden am Ende gesetzt.
  const pageImage = new Set()
  const pageEmpty = new Set()

  const newPage = () => { doc.addPage([PDF_PAGE_W, PDF_PAGE_H]); page++ }
  const isRecto = p => p % 2 === 1
  // Auf die nächste rechte Seite springen (ggf. eine leere linke Seite davor).
  const startRecto = () => { newPage(); if (!isRecto(page)) { pageEmpty.add(page); newPage() } }
  // Auf die nächste linke Seite springen (für die linke Bildhälfte).
  const startVerso = () => { newPage(); if (isRecto(page)) { pageEmpty.add(page); newPage() } }

  // Eine Hälfte des Cover-skalierten Doppelseiten-Bildes randlos setzen.
  // side: 'left' zeigt Doppelseiten-Bereich 0…154, 'right' zeigt 154…308.
  const drawHalf = (img, side) => {
    const r = img.w / img.h
    let dw, dh
    if (r > PDF_SPREAD_W / PDF_PAGE_H) { dh = PDF_PAGE_H; dw = PDF_PAGE_H * r } // breiter → Höhe füllen
    else                              { dw = PDF_SPREAD_W; dh = PDF_SPREAD_W / r } // höher → Breite füllen
    const offX = (PDF_SPREAD_W - dw) / 2
    const offY = (PDF_PAGE_H - dh) / 2
    const baseX = side === 'left' ? offX : offX - PDF_PAGE_W
    doc.addImage(img.dataUrl, 'PNG', baseX, offY, dw, dh)
    pageImage.add(page)
  }

  // Textsatz mit y-Cursor und automatischem Seitenumbruch (Fortsetzungsseiten
  // brauchen keine Paritätskorrektur).
  const ML = 18, MR = 18, MT = 22, MB = 20
  const maxW = PDF_PAGE_W - ML - MR
  const lh = pt => pt * 0.3528 * 1.5
  let y = MT
  const flow = (chunk, { size = 12, style = 'normal', color = [40, 40, 40], gapAfter = 1, indent = 0 } = {}) => {
    doc.setFont('times', style); doc.setFontSize(size); doc.setTextColor(...color)
    const lineH = lh(size)
    for (const line of doc.splitTextToSize(String(chunk ?? ''), maxW - indent)) {
      if (y > PDF_PAGE_H - MB) { newPage(); y = MT }
      doc.text(line, ML + indent, y); y += lineH
    }
    y += gapAfter * lineH
  }

  // ── Titelseite (recto) ──
  doc.setFont('times', 'bold'); doc.setFontSize(28); doc.setTextColor(30, 30, 30)
  let ty = 90
  for (const line of doc.splitTextToSize(book.title || '', PDF_PAGE_W - 40)) { doc.text(line, PDF_PAGE_W / 2, ty, { align: 'center' }); ty += 12 }
  if (book.subtitle) {
    doc.setFont('times', 'italic'); doc.setFontSize(15); doc.setTextColor(120, 113, 108); ty += 4
    for (const line of doc.splitTextToSize(book.subtitle, PDF_PAGE_W - 50)) { doc.text(line, PDF_PAGE_W / 2, ty, { align: 'center' }); ty += 8 }
  }

  // ── Kapitel ──
  for (const ch of (book.chapters || [])) {
    const img = ch.image_url ? await fetchImageForPdf(ch.image_url) : null
    if (img) {
      startVerso(); drawHalf(img, 'left')   // linke Seite: linke Bildhälfte
      newPage();    drawHalf(img, 'right')  // rechte Seite: rechte Bildhälfte
      newPage(); pageEmpty.add(page)        // leere linke Seite
      newPage()                             // rechte Seite: Kapitelbeginn
    } else {
      startRecto()                          // ohne Bild trotzdem rechts beginnen
    }
    // Kapitellabel + Überschrift (zentriert), dann Fließtext
    doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(150, 150, 150)
    doc.text(`${bt.chapterLabel} ${ch.number || ''}`.trim(), PDF_PAGE_W / 2, 34, { align: 'center' })
    doc.setFont('times', 'bold'); doc.setFontSize(20); doc.setTextColor(30, 30, 30)
    let hy = 46
    for (const line of doc.splitTextToSize(ch.heading || '', maxW)) { doc.text(line, PDF_PAGE_W / 2, hy, { align: 'center' }); hy += 9 }
    // V1: Name + Beziehung des Beitragenden unter die Überschrift (Fallback über contribution_id).
    {
      const src = ch.contributor_name ? ch : (contributors || []).find(c => c.id === ch.contribution_id)
      const nm = ch.contributor_name || src?.contributor_name
      const rel = ch.relationship || src?.relationship
      if (nm) {
        doc.setFont('times', 'italic'); doc.setFontSize(12); doc.setTextColor(120, 113, 108)
        doc.text(rel ? `${nm} – ${rel}` : nm, PDF_PAGE_W / 2, hy + 2, { align: 'center' })
      }
    }
    // Seitenumbruch nach der Kapitelüberschrift: der Fließtext beginnt auf
    // einer neuen Seite (Überschriftenseite bleibt für sich).
    newPage(); y = MT
    for (const para of String(ch.body || '').split('\n\n').map(s => s.trim()).filter(Boolean)) {
      flow(para, { size: 12, gapAfter: 0.6 })
    }
  }

  // ── Mitwirkende + Disclaimer (neue Seite) ──
  newPage(); y = MT
  if (contributors && contributors.length) {
    doc.setFont('times', 'bold'); doc.setFontSize(20); doc.setTextColor(30, 30, 30)
    doc.text(bt.contributorsHeading, PDF_PAGE_W / 2, y, { align: 'center' }); y += 14
    doc.setFontSize(12)
    for (const c of dedupeContributors(contributors)) {
      if (y > PDF_PAGE_H - MB) { newPage(); y = MT }
      const rel = c.relationship ? `  —  ${c.relationship}` : ''
      doc.setFont('times', 'bold'); doc.setTextColor(40, 40, 40)
      const nameW = doc.getTextWidth(c.contributor_name || '')
      const relW = doc.getTextWidth(rel)
      const startX = (PDF_PAGE_W - nameW - relW) / 2
      doc.text(c.contributor_name || '', startX, y)
      doc.setFont('times', 'normal'); doc.setTextColor(120, 113, 108)
      doc.text(rel, startX + nameW, y)
      y += 7
    }
    y += 8
  }
  flow(BOOK_DISCLAIMER_TITLE, { size: 11, style: 'bold', color: [120, 113, 108], gapAfter: 0.5 })
  // Logo des Buch-Inhabers zwischen Hinweis-Titel und Hinweis-Text (zentriert).
  // jsPDF kann nur PNG/JPEG – andere Formate still überspringen.
  const pdfLogo = await prepareLogoForExport(logoDataUrl)
  if (pdfLogo && /^(png|jpe?g)$/.test(pdfLogo.kind)) {
    const wmm = 40
    const hmm = wmm * pdfLogo.h / pdfLogo.w
    if (y + hmm > PDF_PAGE_H - MB) { newPage(); y = MT }
    try {
      doc.addImage(pdfLogo.dataUrl, pdfLogo.kind === 'png' ? 'PNG' : 'JPEG', (PDF_PAGE_W - wmm) / 2, y, wmm, hmm)
      y += hmm + 4
    } catch { /* defektes Logo darf den Export nicht abbrechen */ }
  }
  flow(BOOK_DISCLAIMER, { size: 10, style: 'italic', color: [120, 113, 108], gapAfter: 0 })

  // ── Seitenzahlen unten mittig – ohne Titel-, Bild- und Leerseiten ──
  // Seite 1 ist immer die (innere) Titelseite und bleibt klassisch ohne Nummer.
  const totalPages = doc.getNumberOfPages()
  for (let i = 2; i <= totalPages; i++) {
    if (pageImage.has(i) || pageEmpty.has(i)) continue
    doc.setPage(i)
    doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 113, 108)
    doc.text(String(i), PDF_PAGE_W / 2, PDF_PAGE_H - 10, { align: 'center' })
  }

  downloadBlob(filename, doc.output('blob'))
}

async function downloadAsDocx(filename, title, text) {
  const children = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ]
  for (const raw of text.split('\n\n')) {
    const chunk = raw.trim()
    if (!chunk) continue
    if (chunk.startsWith('## ')) {
      children.push(new Paragraph({ text: chunk.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 } }))
    } else if (chunk.startsWith('# ')) {
      children.push(new Paragraph({ text: chunk.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }))
    } else {
      children.push(new Paragraph({ text: chunk, spacing: { after: 200 } }))
    }
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: BOOK_DISCLAIMER_TITLE, size: 20, bold: true, color: '78716c' })],
    spacing: { before: 500, after: 120 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: BOOK_DISCLAIMER, size: 18, italics: true, color: '78716c' })],
    spacing: { after: 200 },
  }))
  const doc = new Document({
    creator: 'Lebenswerk', title,
    styles: { default: { document: { run: { font: DOCX_FONT, size: 24 } } } },
    sections: [docxSection(children)],
  })
  downloadBlob(filename, await Packer.toBlob(doc))
}

function genContribId() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 14 }, () => a[Math.floor(Math.random() * a.length)]).join('')
}

const GENDERS = [
  { value: 'männlich', label: 'Männlich' },
  { value: 'weiblich', label: 'Weiblich' },
  { value: 'divers',   label: 'Divers'   },
]

const BOOK_VARIANTS = [
  { value: 1, title: 'Variante 1', sub: 'Alle Beiträge werden als separate Buchkapitel veröffentlicht.' },
  { value: 2, title: 'Variante 2', sub: 'Die Biographie wird aus allen Inhalten neu erstellt; einzelne Beiträge sind nicht mehr erkennbar.' },
]

// Leeres Anlage-Formular (inkl. Produktkategorie + kategorieabhängige Felder).
const EMPTY_PICKUP = { name: '', addon: '', street: '', zip: '', city: '', country: 'Deutschland' }
const EMPTY_CREATE = {
  name: '', organizer: '', gender: '', bookVariant: 1,
  funeralDate: '', cutoffDays: 7, showIntroVideo: true,
  productCategory: DEFAULT_CATEGORY, intake: {},
  languages: [DEFAULT_LANGUAGE], note: '',
  pickupAddress: { ...EMPTY_PICKUP },
  catalogId: '', followups: 7,
}

function qrCodeUrl(text, size = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(text)}`
}

// Farbe einer im Prüfbericht markierten Stelle nach Schweregrad.
function reviewMarkStyle(severity) {
  const base = { padding:'0 2px', borderRadius:3 }
  if (severity === 'hoch')   return { ...base, background:'#fecaca' }
  if (severity === 'mittel') return { ...base, background:'#fde68a' }
  return { ...base, background:'#fef08a' }
}

// Hebt im Prüfbericht gemeldete Zitate (marks = [{quote, severity}]) in einem
// Textabschnitt farbig hervor. Best effort: nur exakte Treffer werden markiert,
// der Bericht listet ohnehin alle Befunde.
function highlightParagraph(text, marks) {
  if (!marks || marks.length === 0) return text
  const ranges = []
  for (const m of marks) {
    const q = m.quote
    if (!q) continue
    let idx = text.indexOf(q)
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + q.length, severity: m.severity })
      idx = text.indexOf(q, idx + q.length)
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a.start - b.start)
  const nodes = []
  let pos = 0, k = 0
  for (const r of ranges) {
    if (r.start < pos) continue // Überlappung -> überspringen
    if (r.start > pos) nodes.push(text.slice(pos, r.start))
    nodes.push(<mark key={k++} style={reviewMarkStyle(r.severity)}>{text.slice(r.start, r.end)}</mark>)
    pos = r.end
  }
  if (pos < text.length) nodes.push(text.slice(pos))
  return nodes
}

function cutoffDays(memorial) {
  const n = parseInt(memorial?.cutoff_days, 10)
  return Number.isFinite(n) && n >= 0 ? n : 7
}

function cutoffDate(funeralDate, days) {
  if (!funeralDate) return null
  const d = new Date(funeralDate)
  d.setDate(d.getDate() - (Number.isFinite(days) ? days : 7))
  return d
}

function cutoffString(funeralDate, days = 7) {
  const d = cutoffDate(funeralDate, days)
  return d ? d.toLocaleDateString('de-DE') : '—'
}

function formatEur(n) {
  const v = Number(n || 0)
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

const COST_KIND_LABEL = {
  interview:  'Interview-Fragen (KI)',
  reasoning:  'Sonstiges KI-Reasoning',
  book_v1:    'Buch V1 – Generierung',
  book_v2:    'Buch V2 – Generierung',
  eulogy:     'Endtext (Rede) – Generierung',
  tts:        'Sprachausgabe (TTS)',
  stt:        'Spracherkennung (STT)',
  image:      'Bildgenerierung (FLUX)',
}
function costKindLabel(k) { return COST_KIND_LABEL[k] || k || 'Sonstiges' }

// ── Stile ─────────────────────────────────────────────────────────
const S = {
  page:    { maxWidth: 600, margin: '0 auto', padding: '1.5rem' },
  card:    { background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.25rem' },
  muted:   { color: '#78716c', fontSize: 14, lineHeight: 1.65 },
  label:   { fontSize: 12, color: '#78716c', letterSpacing: '.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 },
  divider: { borderTop: '1px solid #e7e5e4', margin: '1.25rem 0' },
  err:     { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 },
}
const Lbl = ({ children }) => <span style={S.label}>{children}</span>
const Err = ({ msg }) => msg ? <div style={S.err}>⚠ {msg}</div> : null
function Back({ onClick }) {
  return <button className="ghost" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '1.25rem', color: '#78716c', fontSize: 14 }}>← Zurück</button>
}
function Dots() {
  return <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>{[0,1,2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#a8a29e', animation: 'lw-dot 1.2s ease-in-out infinite', animationDelay: `${i*.2}s` }} />)}</div>
}

// Standard-Banner oben auf den Beitragenden-Seiten. Wird durch das eigene
// Firmenlogo des Benutzers ersetzt, sobald hinterlegt (logoUrl). Der Fallback
// ist bewusst produktneutral (keine Trauer-/Branchenbindung).
const PARTNER_NAME      = 'Lebensgeschichten.AI'
const PARTNER_MONOGRAM  = 'L'
function PartnerBanner({ logoUrl }) {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'10px 1.25rem', display:'flex', alignItems:'center', gap:12 }}>
        {logoUrl ? (
          // Vom Benutzer hinterlegtes Firmenlogo.
          <img
            src={logoUrl}
            alt="Logo"
            style={{ maxHeight:40, maxWidth:200, width:'auto', objectFit:'contain', flexShrink:0 }}
          />
        ) : (
          // Standard-/Demo-Logo (z. B. für Bücher des Administrators).
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{
              width:32, height:32, borderRadius:'50%',
              background:'#1c1917', color:'#fafaf9',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'Georgia, serif', fontWeight:700, fontSize:15,
              flexShrink:0,
            }}>{PARTNER_MONOGRAM}</div>
            <div style={{ minWidth:0, lineHeight:1.3 }}>
              <div style={{ fontWeight:600, fontSize:14, color:'#1c1917', fontFamily:'Georgia, serif' }}>{PARTNER_NAME}</div>
              <div style={{ fontSize:10.5, color:'#78716c', textTransform:'uppercase', letterSpacing:'.09em', marginTop:2 }}>Persönliche Bücher &amp; Reden</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── KI-Prompts ────────────────────────────────────────────────────
// Die kategoriespezifischen Prompt-Builder liegen in src/categories.js.
// Sie werden über GENERATORS (Admin) bzw. getCategory(...).interviewSystem
// (Contributor-Flow) angesprochen.

function unlockAudio() {
  // Bereitet das Audio-Element vor, das speakText() später wiederverwendet
  primeAudio()
}

// ── Schallwellen-Animation ────────────────────────────────────────
// Liest den Live-Pegel des Aufnahme-Streams (Web Audio AnalyserNode) und
// zeichnet symmetrische, animierte Balken auf ein Canvas. Reagiert in Echtzeit
// auf die Lautstärke der Stimme; bei Stille bleiben nur kleine Grundbalken.
function Waveform({ stream, color = '#dc2626' }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    if (!stream) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    let audioCtx, analyser, src, raf
    try {
      audioCtx = new AC()
      src = audioCtx.createMediaStreamSource(stream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.75
      src.connect(analyser)
    } catch { return }
    const data   = new Uint8Array(analyser.frequencyBinCount)
    const canvas = canvasRef.current
    const dpr    = window.devicePixelRatio || 1
    const resize = () => { if (canvas) { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr } }
    resize()
    window.addEventListener('resize', resize)
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!canvas) return
      analyser.getByteFrequencyData(data)
      const cx = canvas.getContext('2d')
      const W = canvas.width, H = canvas.height
      cx.clearRect(0, 0, W, H)
      const n = data.length, slot = W / n, barW = Math.max(2 * dpr, slot * 0.55)
      for (let i = 0; i < n; i++) {
        const v = data[i] / 255
        const h = Math.max(barW, v * H * 0.95)
        const x = i * slot + (slot - barW) / 2
        const y = (H - h) / 2
        cx.fillStyle = color
        cx.beginPath()
        cx.roundRect(x, y, barW, h, barW / 2)
        cx.fill()
      }
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      try { src.disconnect() } catch {}
      audioCtx.close().catch(() => {})
    }
  }, [stream, color])
  return <canvas ref={canvasRef} style={{ width:'100%', height:56, display:'block' }} />
}

// ── Sprach-Interview ──────────────────────────────────────────────
function VoiceInterview({ memorial, contribForm, lang = 'de', onSave, onPause, saveErr, initialMessages = [] }) {
  const t = uiText(lang)
  const [messages,   setMessages]   = useState(initialMessages)
  const [round,      setRound]      = useState(initialMessages.filter(m => m.role === 'user').length)
  const [aiLoading,  setAiLoading]  = useState(false)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [isPlaying,  setIsPlaying]  = useState(false)
  // micState: idle | recording | processing
  const [micState,   setMicState]   = useState('idle')
  const [micStream,  setMicStream]  = useState(null) // aktiver Aufnahme-Stream → Schallwellen-Animation
  const [transcript, setTranscript] = useState('')
  const [err,        setErr]        = useState('')
  const [hasPlayed,  setHasPlayed]  = useState(false)
  const mediaRecRef  = useRef(null)
  const chunksRef    = useRef([])
  const endRef       = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, aiLoading])
  useEffect(() => { if (messages.length === 0) loadFirst() }, [])

  // Auto-Start: neue Frage sofort vorlesen
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && !aiLoading) playText(last.content)
  }, [messages, aiLoading])

  function playText(text) {
    stopSpeaking()
    setIsPlaying(true); setTtsLoading(true); setErr('')
    speakText(text, {
      memorialCode: memorial?.id,
      onEnd:   () => { setIsPlaying(false); setTtsLoading(false); setHasPlayed(true) },
      onError: (msg, name) => {
        setIsPlaying(false); setTtsLoading(false)
        // iOS Safari blockiert Audio ohne direkte User-Geste — kein Fehler zeigen,
        // Nutzer kann den „Anhören"-Button tippen.
        if (name === 'NotAllowedError' || /not allowed|denied permission|user gesture/i.test(msg || '')) return
        setErr(`TTS: ${msg}`)
      },
    })
  }

  function handleSpeak() {
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return
    if (isPlaying) { stopSpeaking(); setIsPlaying(false); setTtsLoading(false); return }
    playText(last.content)
  }

  async function loadFirst() {
    setAiLoading(true)
    try {
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const q = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }], { memorialCode: memorial?.id, kind: 'interview' })
      setMessages([{ role: 'assistant', content: q }])
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  async function handleMic() {
    if (micState === 'processing') return

    if (micState === 'recording') {
      mediaRecRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec    = new MediaRecorder(stream)
      mediaRecRef.current = rec
      chunksRef.current   = []
      let recStartedAt = 0

      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setMicStream(null)
        const audioSeconds = recStartedAt ? (Date.now() - recStartedAt) / 1000 : 0
        setMicState('processing')
        try {
          const mimeType = rec.mimeType || 'audio/webm'
          const blob     = new Blob(chunksRef.current, { type: mimeType })
          const base64   = await new Promise((res, rej) => {
            const reader = new FileReader()
            reader.onloadend = () => res(reader.result.split(',')[1])
            reader.onerror   = rej
            reader.readAsDataURL(blob)
          })
          const resp = await fetch('/api/transcribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ audio: base64, mimeType, audioSeconds, memorialCode: memorial?.id, language: lang }),
          })
          const data = await resp.json()
          if (!resp.ok) throw new Error(data.error)
          const text = data.text || ''
          setTranscript(text)
          setMicState('idle')
          if (text.trim()) sendAnswer(text)
          return
        } catch (e) {
          setErr(`${t.errTranscribe}: ${e.message}`)
        } finally {
          setMicState('idle')
        }
      }

      recStartedAt = Date.now()
      rec.start()
      setMicStream(stream)
      setMicState('recording')
      setTranscript('')
      setErr('')
    } catch (e) {
      setErr(`${t.errMic}: ${e.message}`)
    }
  }

  async function sendAnswer(explicitText) {
    const text = (explicitText ?? transcript).trim(); if (!text) return
    setTranscript(''); stopSpeaking(); setIsPlaying(false)
    const newMsgs = [...messages, { role: 'user', content: text }]
    setMessages(newMsgs); setRound(r => r + 1); setAiLoading(true)
    // Antwort sofort persistieren (inkrementell), Fehler in saveErr-Prop
    onSave?.(newMsgs)
    try {
      const sys   = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship, contribForm.address, contribForm.gender) + langDirective(lang)
      const reply = await askLLM(sys, [{ role: 'user', content: '[Interview beginnt]' }, ...newMsgs], { memorialCode: memorial?.id, kind: 'interview' })
      const finalMsgs = [...newMsgs, { role: 'assistant', content: reply }]
      setMessages(finalMsgs)
      onSave?.(finalMsgs)
    } catch (e) { setErr(e.message) }
    finally { setAiLoading(false) }
  }

  function pause() {
    stopSpeaking()
    if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop()
    onPause?.()
  }

  const latestQ = [...messages].reverse().find(m => m.role === 'assistant')?.content

  const micBg     = micState === 'recording' ? '#fee2e2' : '#f5f5f4'
  const micBorder = micState === 'recording' ? '2px solid #ef4444' : '1px solid #d6d3d1'
  const micAnim   = micState === 'recording' ? 'lw-mic 1.5s ease-in-out infinite' : 'none'
  const micIcon   = micState === 'processing' ? '⏳' : '🎙'
  const micLabel  = micState === 'recording'  ? t.micRecording
                  : micState === 'processing' ? t.micProcessing
                  : t.micIdle

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <PartnerBanner logoUrl={memorial?.owner_logo} />
      <div style={{ borderBottom: '1px solid #e7e5e4', padding: '12px 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{memorial.name}</div>
          <div style={{ fontSize: 12, color: '#78716c' }}>{contribForm.name} · {contribForm.relationship} · {t.modeVoice}</div>
        </div>
        <button onClick={pause} disabled={micState !== 'idle'} className="secondary" style={{ fontSize: 13, padding: '8px 16px' }}>{t.pauseEnd}</button>
      </div>
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <Err msg={err} />
        {saveErr && <div style={{ ...S.err }}>⚠ {t.saveLabel}: {saveErr}</div>}
        {memorial.funeral_date && (() => {
          const d = cutoffDate(memorial.funeral_date, cutoffDays(memorial))
          return d ? (
            <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#78350f', marginBottom:14, lineHeight:1.55 }}>
              ℹ {t.cutoffNote(d.toLocaleDateString(t.locale))}
            </div>
          ) : null
        })()}
        {messages.slice(0, -1).map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, opacity: .6, background: m.role === 'user' ? '#e0f2fe' : '#f5f5f4' }}>{m.content}</div>
          </div>
        ))}
        {aiLoading && messages.length === 0 && <div style={{ margin: '1.5rem 0' }}><Dots /></div>}
        {latestQ && (
          <div style={{ ...S.card, marginBottom: '1rem', background: '#fafaf9', borderColor: '#d6d3d1' }}>
            <Lbl>{t.questionLabel}</Lbl>
            <p style={{ fontSize: 17, lineHeight: 1.75, fontStyle: 'italic', margin: '0 0 1rem', color: '#292524' }}>{latestQ}</p>
            <button onClick={handleSpeak} disabled={ttsLoading || aiLoading} style={{ fontSize: 13, padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {ttsLoading
                ? <><span style={{ width:14,height:14,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'lw-spin .8s linear infinite' }} /> {t.loadingShort}</>
                : isPlaying ? t.stop : hasPlayed ? t.readAgain : t.listen}
            </button>
          </div>
        )}
        {aiLoading && messages.length > 0 && <div style={{ margin: '.75rem 0' }}><Dots /></div>}
        {!aiLoading && latestQ && (
          <div style={{ ...S.card, textAlign: 'center', padding: '1.5rem 1rem' }}>
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={handleMic}
                disabled={micState === 'processing'}
                style={{ width:72, height:72, borderRadius:'50%', fontSize:28, display:'inline-flex', alignItems:'center', justifyContent:'center', background:micBg, border:micBorder, color:'#1c1917', animation:micAnim, transition:'all .2s' }}
                aria-label={micLabel}
              >{micIcon}</button>
            </div>
            {micState === 'recording' && micStream && (
              <div style={{ maxWidth:320, margin:'0 auto 10px' }}>
                <Waveform stream={micStream} color="#dc2626" />
              </div>
            )}
            <div style={{ fontSize:13, fontWeight:500, color: micState==='recording' ? '#dc2626' : '#78716c', marginBottom:4 }}>
              {micLabel}
            </div>
            {transcript && (
              <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 14px', marginTop:12, fontSize:14, lineHeight:1.6, textAlign:'left' }}>
                {transcript}
              </div>
            )}
            {memorial.catalog && micState === 'idle' && (
              <button
                onClick={() => sendAnswer(({ de:'Weiter zur nächsten Frage, bitte.', en:'Please move on to the next question.', pl:'Przejdźmy do następnego pytania.' })[lang] || 'Weiter zur nächsten Frage, bitte.')}
                disabled={aiLoading}
                className="secondary"
                style={{ marginTop:16, fontSize:13, padding:'8px 16px' }}
              >
                {({ de:'Nächste Frage →', en:'Next question →', pl:'Następne pytanie →' })[lang] || 'Nächste Frage →'}
              </button>
            )}
          </div>
        )}
        {round >= 1 && !aiLoading && <p style={{ fontSize:12, color:'#78716c', textAlign:'center', marginTop:12 }}>{t.autosaveNote}</p>}
        <div ref={endRef} /><div style={{ height:'2rem' }} />
      </div>
    </div>
  )
}

// ── Text-Interview ────────────────────────────────────────────────
function TextInterview({ memorial, contribForm, onDone }) {
  const [messages, setMessages] = useState([])
  const [input, setInput]   = useState('')
  const [round, setRound]   = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, loading])
  useEffect(() => { loadFirst() }, [])

  async function loadFirst() {
    setLoading(true)
    try {
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const q = await askLLM(sys, [{ role:'user', content:'[Interview beginnt]' }])
      setMessages([{ role:'assistant', content:q }])
    } catch(e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim(); setInput('')
    const newMsgs = [...messages, { role:'user', content:text }]
    setMessages(newMsgs); setRound(r=>r+1); setLoading(true)
    try {
      const sys = getCategory(memorial?.product_category).interviewSystem(memorial, contribForm.name, contribForm.relationship)
      const reply = await askLLM(sys, [{ role:'user', content:'[Interview beginnt]' }, ...newMsgs])
      setMessages([...newMsgs, { role:'assistant', content:reply }])
    } catch(e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function finish() {
    setSaving(true)
    try { await onDone(messages) } catch(e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh' }}>
      <div style={{ flexShrink:0, borderBottom:'1px solid #e7e5e4', padding:'12px 1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#fff' }}>
        <div>
          <div style={{ fontWeight:600, fontSize:15 }}>{memorial.name}</div>
          <div style={{ fontSize:12, color:'#78716c' }}>{contribForm.name} · {contribForm.relationship}</div>
        </div>
        {round >= 5 && <button onClick={finish} disabled={saving} style={{ fontSize:13, padding:'8px 16px' }}>{saving?'Wird gespeichert …':'✓ Abschließen'}</button>}
      </div>
      {err && <div style={{ ...S.err, margin:'8px 1.5rem 0' }}>{err}</div>}
      <div style={{ flex:1, overflowY:'auto', padding:'1rem 1.5rem', display:'flex', flexDirection:'column', gap:12 }}>
        {messages.length===0 && loading && <Dots />}
        {messages.map((m,i) => (
          <div key={i} style={{ display:'flex', flexDirection:m.role==='user'?'row-reverse':'row' }}>
            <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:12, fontSize:15, lineHeight:1.65, background:m.role==='user'?'#dbeafe':'#f5f5f4', fontStyle:m.role==='assistant'?'italic':'normal' }}>{m.content}</div>
          </div>
        ))}
        {messages.length>0 && loading && <Dots />}
        <div ref={endRef} />
      </div>
      <div style={{ flexShrink:0, borderTop:'1px solid #e7e5e4', padding:'12px 1.5rem', background:'#fff' }}>
        <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Schreiben Sie Ihre Erinnerung … (Enter zum Senden)" disabled={loading} rows={3} style={{ flex:1, fontSize:15 }} />
          <button onClick={send} disabled={loading||!input.trim()} style={{ padding:'10px 16px', flexShrink:0 }}>➤</button>
        </div>
        {round>=5 && <p style={{ fontSize:12, color:'#78716c', marginTop:8 }}>Sie können noch mehr erzählen oder das Interview oben abschließen.</p>}
      </div>
    </div>
  )
}

// ── Beitragenden-Flow (Aufruf per ?code=XXX[&session=…]) ──────────
// Foto-Upload für Beitragende (am Ende des Interviews, auf dem Danke-Bildschirm).
// Der Beitrag ist zu diesem Zeitpunkt bereits gespeichert; die Fotos werden
// einzeln direkt hochgeladen. Die Einverständniserklärung (Rechte + KI-
// Verarbeitung aller abgebildeten Personen) ist Pflicht vor dem ersten Upload.
function ContributorPhotoUpload({ code, contribId, t }) {
  const [consent, setConsent] = useState(false)
  const [staged, setStaged]   = useState(null) // { dataUrl, caption, description }
  const [uploaded, setUploaded] = useState([])
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')
  const inStyle = { width:'100%', padding:'9px 11px', border:'1px solid #d6d3d1', borderRadius:8, fontSize:14, boxSizing:'border-box' }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\//.test(file.type) && !/\.(hei[cf]|jpe?g|png|webp)$/i.test(file.name)) { setErr(t.uploadError); return }
    setErr('')
    try { setStaged({ dataUrl: await fileToDownscaledDataURL(file), caption:'', description:'' }) }
    catch (e2) { setErr(e2.message) }
  }

  async function addStaged() {
    if (!staged) return
    if (!consent) { setErr(t.uploadConsentRequired); return }
    setBusy(true); setErr('')
    try {
      await uploadContributorImage(code, {
        image: staged.dataUrl, caption: staged.caption, description: staged.description,
        consent: true, contributionId: contribId,
      })
      setUploaded(u => [...u, { caption: staged.caption, thumb: staged.dataUrl }])
      setStaged(null)
    } catch (e2) { setErr(e2.message || t.uploadError) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ ...S.card, maxWidth:460, margin:'0 auto', textAlign:'left' }}>
      <h3 style={{ fontSize:17, fontWeight:700, marginBottom:6 }}>{t.uploadStepTitle}</h3>
      <p style={{ ...S.muted, marginBottom:14 }}>{t.uploadStepIntro}</p>

      {uploaded.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
          {uploaded.map((u, i) => (
            <div key={i} style={{ width:72 }}>
              <img src={u.thumb} alt="" style={{ width:72, height:72, objectFit:'cover', borderRadius:8, border:'1px solid #e7e5e4' }} />
            </div>
          ))}
        </div>
      )}

      <Err msg={err} />

      {!staged ? (
        <label className="secondary" style={{ display:'inline-block', cursor:'pointer', padding:'10px 16px', borderRadius:8, fontSize:14 }}>
          {t.uploadPick}
          <input type="file" accept="image/*,.heic,.heif" onChange={onPick} style={{ display:'none' }} />
        </label>
      ) : (
        <div>
          <img src={staged.dataUrl} alt="" style={{ width:'100%', maxHeight:240, objectFit:'contain', borderRadius:8, border:'1px solid #e7e5e4', marginBottom:12, background:'#faf9f7' }} />
          <div style={{ marginBottom:10 }}>
            <Lbl>{t.uploadCaption}</Lbl>
            <input value={staged.caption} onChange={e => setStaged(s => ({ ...s, caption:e.target.value }))} style={inStyle} maxLength={300} />
            <div style={{ ...S.muted, fontSize:12, marginTop:4 }}>{t.uploadCaptionHint}</div>
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl>{t.uploadDesc}</Lbl>
            <textarea value={staged.description} onChange={e => setStaged(s => ({ ...s, description:e.target.value }))} style={{ ...inStyle, minHeight:64, resize:'vertical' }} maxLength={1000} />
            <div style={{ ...S.muted, fontSize:12, marginTop:4 }}>{t.uploadDescHint}</div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addStaged} disabled={busy} style={{ fontSize:14, padding:'10px 16px' }}>{busy ? t.uploadUploading : t.uploadSubmit}</button>
            <button className="secondary" onClick={() => setStaged(null)} disabled={busy} style={{ fontSize:14, padding:'10px 16px' }}>{t.uploadRemove}</button>
          </div>
        </div>
      )}

      <label style={{ display:'flex', gap:10, alignItems:'flex-start', marginTop:16, cursor:'pointer' }}>
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop:3, flexShrink:0 }} />
        <span style={{ ...S.muted, fontSize:12.5 }}>{t.uploadConsent}</span>
      </label>
    </div>
  )
}

// Foto-Verwaltung im Admin/Manager-Bereich (Detailansicht eines Gedenkbuchs):
// hochgeladene Fotos ansehen, Bildunterschrift/Beschreibung bearbeiten, löschen
// und eigene Fotos hinzufügen. `uploads` = selected.uploaded_images (mit
// signierten image_url/image_thumb_url); `onChange` aktualisiert selected.
function ManagerPhotos({ code, token, uploads, onChange }) {
  const list = Array.isArray(uploads) ? uploads : []
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [editId, setEditId] = useState(null)
  const [editVals, setEditVals] = useState({ caption: '', description: '' })
  const inStyle = { width:'100%', padding:'8px 10px', border:'1px solid #d6d3d1', borderRadius:8, fontSize:13, boxSizing:'border-box' }

  async function onPick(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try {
      const image = await fileToDownscaledDataURL(file)
      const { image: entry } = await adminUploadImage(token, code, { image, caption: '', description: '' })
      onChange([...list, entry])
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  async function remove(id) {
    if (!window.confirm('Dieses Foto entfernen?')) return
    setBusy(true); setErr('')
    try { await adminDeleteUpload(token, code, id); onChange(list.filter(u => u.id !== id)) }
    catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  function startEdit(u) { setEditId(u.id); setEditVals({ caption: u.caption || '', description: u.description || '' }) }
  async function saveEdit() {
    setBusy(true); setErr('')
    try {
      await adminUpdateUpload(token, code, { id: editId, caption: editVals.caption, description: editVals.description })
      onChange(list.map(u => u.id === editId ? { ...u, ...editVals } : u))
      setEditId(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginBottom:'1.5rem' }}>
      <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Fotos ({list.length})</h3>
      <div style={{ ...S.card }}>
        <p style={{ ...S.muted, fontSize:13, marginTop:0, marginBottom:12 }}>
          Hochgeladene Fotos werden bei der Bucherstellung berücksichtigt: die KI schlägt passende Kapitel vor, Hochkant-/mehrere Bilder werden auf der Doppelseite gruppiert. Die Bildunterschrift wird – wenn angegeben – ins Buch übernommen; die Beschreibung dient nur der Einordnung.
        </p>
        <Err msg={err} />
        {list.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:12, marginBottom:14 }}>
            {list.map(u => (
              <div key={u.id} style={{ border:'1px solid #e7e5e4', borderRadius:10, overflow:'hidden', background:'#faf9f7' }}>
                <img src={u.image_thumb_url || u.image_url} alt="" style={{ width:'100%', height:100, objectFit:'cover', display:'block' }} />
                <div style={{ padding:'8px 9px' }}>
                  <div style={{ fontSize:11, color:'#a8a29e', marginBottom:4 }}>
                    {u.orientation === 'portrait' ? '↕ Hochkant' : u.orientation === 'landscape' ? '↔ Quer' : '□ Quadrat'}
                    {u.quality_flag === 'low' ? ' · geringe Qualität' : ''}
                    {u.source === 'contributor' ? ' · Beitragende:r' : ' · Manager'}
                  </div>
                  {editId === u.id ? (
                    <div>
                      <input value={editVals.caption} onChange={e => setEditVals(v => ({ ...v, caption:e.target.value }))} placeholder="Bildunterschrift" style={{ ...inStyle, marginBottom:6 }} maxLength={300} />
                      <textarea value={editVals.description} onChange={e => setEditVals(v => ({ ...v, description:e.target.value }))} placeholder="Beschreibung (für die KI)" style={{ ...inStyle, minHeight:48, resize:'vertical', marginBottom:6 }} maxLength={1000} />
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={saveEdit} disabled={busy} style={{ fontSize:12, padding:'6px 10px' }}>Speichern</button>
                        <button className="secondary" onClick={() => setEditId(null)} disabled={busy} style={{ fontSize:12, padding:'6px 10px' }}>Abbrechen</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize:12.5, fontWeight:600, minHeight:16 }}>{u.caption || <span style={{ color:'#a8a29e', fontWeight:400 }}>ohne Bildunterschrift</span>}</div>
                      {u.description && <div style={{ fontSize:11.5, color:'#78716c', marginTop:2, lineHeight:1.4 }}>{u.description}</div>}
                      <div style={{ display:'flex', gap:6, marginTop:8 }}>
                        <button className="secondary" onClick={() => startEdit(u)} style={{ fontSize:12, padding:'5px 9px' }}>Bearbeiten</button>
                        <button className="secondary" onClick={() => remove(u.id)} disabled={busy} style={{ fontSize:12, padding:'5px 9px', color:'#dc2626' }}>Entfernen</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <label className="secondary" style={{ display:'inline-block', cursor: busy ? 'default' : 'pointer', padding:'9px 16px', borderRadius:8, fontSize:14, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Wird hochgeladen …' : '＋ Foto hochladen'}
          <input type="file" accept="image/*,.heic,.heif" onChange={onPick} disabled={busy} style={{ display:'none' }} />
        </label>
      </div>
    </div>
  )
}

function ContributorFlow({ code }) {
  const [view, setView]                       = useState('loading') // loading | info | interview | done | error
  const [memorial, setMemorial]               = useState(null)
  const [contribForm, setContribForm]         = useState({ name:'', gender:'', relationship:'', address:'Sie' })
  const [err, setErr]                         = useState('')
  const [contribId, setContribId]             = useState(() => genContribId())
  const [consentChecked, setConsentChecked]   = useState(false)
  const [consentAt, setConsentAt]             = useState(null)
  const [initialMessages, setInitialMessages] = useState([])
  const [resumePrompt, setResumePrompt]       = useState(null)
  const [paused, setPaused]                   = useState(false)
  const [copied, setCopied]                   = useState('')
  const [saveErr, setSaveErr]                 = useState('')
  const [lang, setLang]                       = useState(null) // vom Beitragenden gewählte Sprache
  const saveQueueRef                          = useRef(Promise.resolve())

  useEffect(() => {
    getMemorial(code)
      .then(m => setMemorial(m))
      .catch(e => { setErr(e.message); setView('error') })
  }, [code])

  useEffect(() => {
    if (!memorial) return
    if (sessionFromURL) {
      fetchContribution(code, sessionFromURL).then(contrib => {
        if (contrib) { restoreFrom(contrib); setView('interview') }
        else setView('info')
      })
      return
    }
    const local = loadLocalSession(code)
    if (local) setResumePrompt(local)
    else setView('info')
  }, [memorial])

  async function fetchContribution(memCode, id) {
    try {
      return await getContribution(id, memCode)
    } catch { return null }
  }

  function restoreFrom(contrib) {
    const form = {
      name: contrib.contributor_name || '',
      gender: contrib.contributor_gender || '',
      relationship: contrib.relationship || '',
      address: contrib.contributor_address || 'Sie',
    }
    setContribId(contrib.id)
    setContribForm(form)
    setInitialMessages(Array.isArray(contrib.messages) ? contrib.messages : [])
    if (contrib.consent_at) { setConsentAt(contrib.consent_at); setConsentChecked(true) }
    saveLocalSession(code, { contribId: contrib.id, contribForm: form, consentAt: contrib.consent_at || null })
  }

  async function resumeLocal() {
    if (!resumePrompt) return
    const local = resumePrompt
    setResumePrompt(null); setView('loading')
    const contrib = await fetchContribution(code, local.contribId)
    if (contrib) {
      restoreFrom(contrib)
      setView('interview')
      return
    }
    // Kein DB-Eintrag (noch keine Antwort gespeichert). Wenn das Formular in
    // localStorage komplett ist, direkt ins Interview springen — sonst Info-Form.
    const form = local.contribForm
    if (local.consentAt) { setConsentAt(local.consentAt); setConsentChecked(true) }
    // Nur direkt ins Interview, wenn Formular vollständig UND bereits eingewilligt
    // wurde – sonst zurück zur Info-Maske inkl. Einwilligungsschritt.
    const complete = form && form.name && form.gender && form.relationship && form.address && local.consentAt
    setContribId(local.contribId)
    if (form) setContribForm({ ...contribForm, ...form })
    setInitialMessages([])
    setView(complete ? 'interview' : 'info')
  }

  function startFresh() {
    clearLocalSession(code)
    setResumePrompt(null)
    setContribId(genContribId())
    setInitialMessages([])
    setContribForm({ name:'', gender:'', relationship:'', address:'Sie' })
    setConsentChecked(false)
    setConsentAt(null)
    setView('info')
  }

  function startInterview() {
    unlockAudio()
    // Zeitpunkt der Einwilligung festhalten (einmalig, beim Start).
    const ts = consentAt || new Date().toISOString()
    if (!consentAt) setConsentAt(ts)
    saveLocalSession(code, { contribId, contribForm, consentAt: ts })
    // Einführungsvideo nur fürs Trauerbuch (memorial); andere Kategorien starten
    // direkt mit dem Interview.
    const showVideo = memorial?.product_category === 'memorial' && memorial?.show_intro_video !== false
    setView(showVideo ? 'intro-video' : 'interview')
  }

  function saveProgress(messages) {
    if (!messages || messages.length === 0) return
    saveLocalSession(code, { contribId, contribForm, consentAt })
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        await addContribution({
          contributionId: contribId,
          memorialCode: code,
          contributorName: contribForm.name,
          relationship: contribForm.relationship,
          messages,
          contributorGender: contribForm.gender || null,
          contributorAddress: contribForm.address || null,
          consentAt: consentAt || null,
          consentVersion: consentAt ? CONSENT_VERSION : null,
        })
        setSaveErr('')
      } catch (e) { setSaveErr(e.message) }
    })
  }

  function handlePause() { setPaused(true) }
  function handleResume() { setPaused(false) }
  function handleDone() {
    clearLocalSession(code)
    setPaused(false); setView('done')
  }

  // Angebotene Sprachen + aktuell wirksame Sprache des Beitragenden.
  const langs   = (memorial?.languages && memorial.languages.length) ? memorial.languages : [DEFAULT_LANGUAGE]
  const L       = lang || (langs.length === 1 ? langs[0] : DEFAULT_LANGUAGE)
  const needLang = !!memorial && langs.length > 1 && !lang
  const t  = uiText(L)
  const ct = contributorL10n(memorial?.product_category, L)
  const resumeUrl = `${window.location.origin}/?code=${code}&session=${contribId}`

  function copyResumeUrl() {
    navigator.clipboard.writeText(resumeUrl)
    setCopied('link'); setTimeout(() => setCopied(''), 2000)
  }
  function mailResumeUrl() {
    const subject = encodeURIComponent(t.mailSubject(ct.nounBook, memorial ? memorial.name : ''))
    const body = encodeURIComponent(t.mailBody(ct.nounBook, memorial ? memorial.name : '', resumeUrl))
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <>
      {view === 'loading' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}><Dots /></div>
      )}

      {view === 'error' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <h2 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>{t.notFound(ct.nounBook)}</h2>
          <p style={S.muted}>{err}</p>
        </div>
      )}

      {/* Sprachauswahl — bei mehreren angebotenen Sprachen ganz am Anfang */}
      {needLang && view !== 'error' && (
        <>
          <PartnerBanner logoUrl={memorial?.owner_logo} />
          <div style={{ ...S.page, paddingTop:'2.5rem', textAlign:'center' }}>
            <div style={{ marginBottom:20 }}>
              {langs.map(code => (
                <p key={code} style={{ ...S.muted, margin:'2px 0', fontSize:15 }}>{uiText(code).langPickTitle}</p>
              ))}
            </div>
            <div style={{ display:'grid', gap:10, maxWidth:320, margin:'0 auto' }}>
              {langs.map(code => {
                const meta = LANGUAGES.find(x => x.code === code) || { code, label: code }
                return (
                  <button key={code} onClick={() => setLang(code)} style={{ padding:'14px', fontSize:16 }}>{meta.label}</button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {!needLang && view === 'info' && (
        <>
          <PartnerBanner logoUrl={memorial?.owner_logo} />
          <div style={{ ...S.page, paddingTop:'2rem' }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{ct.heading}</h2>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>
            {ct.introNoun} <strong>{memorial?.name}</strong>
          </p>
          <div style={{ marginBottom:14 }}><Lbl>{t.yourName}</Lbl><input value={contribForm.name} onChange={e=>setContribForm({...contribForm,name:e.target.value})} placeholder={t.fullName} /></div>
          <div style={{ marginBottom:14 }}>
            <Lbl>{t.yourGender}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {GENDERS.map(g => (
                <div
                  key={g.value}
                  onClick={() => setContribForm({ ...contribForm, gender: g.value })}
                  style={{
                    ...S.card,
                    cursor:'pointer',
                    textAlign:'center',
                    padding:'12px 8px',
                    borderColor: contribForm.gender === g.value ? '#1c1917' : '#e7e5e4',
                    borderWidth: contribForm.gender === g.value ? 2 : 1,
                    fontSize: 14,
                    fontWeight: contribForm.gender === g.value ? 600 : 400,
                  }}
                >
                  {t.genders[g.value] || g.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:14 }}>
            <Lbl>{ct.relationshipLabel.replace('{name}', memorial?.name || '')}</Lbl>
            <input value={contribForm.relationship} onChange={e=>setContribForm({...contribForm,relationship:e.target.value})} placeholder={ct.relationshipPlaceholder} />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6, lineHeight:1.5 }}>{ct.relationshipHint ? ct.relationshipHint.replace(/\{name\}/g, memorial?.name || 'die Person') : t.relationshipHint(memorial?.name, memorial?.gender)}</p>
          </div>
          <div style={{ marginBottom:24 }}>
            <Lbl>{t.addressQ}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {[
                { v:'Du',  title:t.addrInformalTitle, sub:t.addrInformalSub },
                { v:'Sie', title:t.addrFormalTitle,   sub:t.addrFormalSub },
              ].map(o => (
                <div
                  key={o.v}
                  onClick={() => setContribForm({ ...contribForm, address: o.v })}
                  style={{
                    ...S.card,
                    cursor:'pointer',
                    textAlign:'center',
                    padding:'14px 10px',
                    borderColor: contribForm.address === o.v ? '#1c1917' : '#e7e5e4',
                    borderWidth: contribForm.address === o.v ? 2 : 1,
                  }}
                >
                  <div style={{ fontWeight:600, fontSize:15 }}>{o.title}</div>
                  <div style={{ fontSize:12, color:'#78716c', marginTop:4 }}>{o.sub}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...S.card, background:'#fffbeb', borderColor:'#fde68a', marginBottom:18 }}>
            <label style={{ display:'flex', gap:11, alignItems:'flex-start', cursor:'pointer', fontSize:13.5, lineHeight:1.6, color:'#57534e' }}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                style={{ marginTop:3, width:18, height:18, flexShrink:0, cursor:'pointer' }}
              />
              <span>
                {t.consentText(
                  ct.consentNoun,
                  memorial?.product_category === 'memorial' ? t.consentSpecialMemorial : t.consentSpecialOther
                )}
                <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={{ color:'#1d4ed8' }}>{t.consentLink}</a>.
              </span>
            </label>
          </div>
          <button disabled={!contribForm.name||!contribForm.gender||!contribForm.relationship||!contribForm.address||!consentChecked} onClick={startInterview} style={{ width:'100%', padding:13, fontSize:15 }}>
            {ct.interviewButton}
          </button>
          </div>
        </>
      )}

      {!needLang && view === 'intro-video' && (
        <div style={{ position:'fixed', inset:0, background:'#000', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <video
            src="https://bniwrvfjqewjlzruslnd.supabase.co/storage/v1/object/public/memorial-videos/Intro_LD.mp4"
            autoPlay
            playsInline
            style={{ width:'100%', height:'100%', objectFit:'contain', maxHeight:'100vh' }}
            onEnded={() => setView('interview')}
          />
          <button
            onClick={() => { unlockAudio(); setView('interview') }}
            style={{
              position:'absolute', top:20, right:20,
              background:'rgba(0,0,0,0.5)', color:'#fff',
              border:'1px solid rgba(255,255,255,0.5)', borderRadius:8,
              padding:'10px 20px', fontSize:14, cursor:'pointer',
              backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)',
            }}
          >
            {t.introSkip}
          </button>
        </div>
      )}

      {!needLang && view === 'interview' && memorial && (
        <VoiceInterview
          memorial={memorial}
          contribForm={contribForm}
          lang={L}
          onSave={saveProgress}
          onPause={handlePause}
          saveErr={saveErr}
          initialMessages={initialMessages}
        />
      )}

      {!needLang && view === 'done' && (
        <div style={{ ...S.page, paddingTop:'3rem', textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>🤍</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>{t.doneTitle}</h2>
          <p style={{ ...S.muted, maxWidth:360, margin:'0 auto 2rem' }}>{t.doneBody(ct.nounBook)}</p>
          <ContributorPhotoUpload code={code} contribId={contribId} t={t} />
        </div>
      )}

      {/* Overlay: localStorage-Fortsetzung anbieten */}
      {resumePrompt && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem' }}>
          <div style={{ ...S.card, maxWidth: 460, width:'100%' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>{t.resumeTitle}</h2>
            <p style={{ ...S.muted, marginBottom:18 }}>
              {t.resumeLast(new Date(resumePrompt.savedAt).toLocaleString(t.locale))}<br />
              {t.resumeQ}
            </p>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <button onClick={resumeLocal} style={{ fontSize:14, padding:'10px 16px' }}>{t.resumeContinue}</button>
              <button className="secondary" onClick={startFresh} style={{ fontSize:14, padding:'10px 16px' }}>{t.resumeFresh}</button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: Später fortsetzen oder beenden */}
      {paused && (
        <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
          <div style={{ ...S.card, maxWidth: 520, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
            <h2 style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>{t.pauseTitle}</h2>
            <p style={{ ...S.muted, marginBottom:14 }}>
              {t.pauseIntro}
            </p>
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', marginBottom:12, fontSize:13, lineHeight:1.6 }}>
              <strong>{t.pauseWay1Strong}</strong><br />
              {t.pauseWay1Body}
            </div>
            <div style={{ background:'#fafaf9', border:'1px solid #e7e5e4', borderRadius:10, padding:'12px 14px', marginBottom:14, fontSize:13, lineHeight:1.6 }}>
              <strong>{t.pauseWay2Strong}</strong> {t.pauseWay2Body}
              <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:8, padding:'8px 10px', marginTop:10, fontFamily:'monospace', fontSize:12, wordBreak:'break-all', color:'#44403c' }}>{resumeUrl}</div>
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                <button className="secondary" onClick={copyResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>{copied === 'link' ? t.copied : t.copyLink}</button>
                <button className="secondary" onClick={mailResumeUrl} style={{ fontSize:12, padding:'6px 12px' }}>{t.mailBtn}</button>
              </div>
            </div>
            <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:14, display:'flex', gap:10, flexWrap:'wrap', justifyContent:'space-between' }}>
              <button className="ghost" onClick={handleResume} style={{ fontSize:14 }}>{t.continueTalk}</button>
              <button onClick={handleDone} style={{ fontSize:14, padding:'10px 18px' }}>{t.finishNow}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Liest die Claims (uid/admin/cats) direkt aus dem Session-Token. So ist die
// uid auch dann verfügbar, wenn die gespeicherte Session noch von vor einem
// Deploy stammt (in der sie nicht enthalten war).
function decodeToken(token) {
  try {
    const payload = String(token || '').split('.')[0]
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    return JSON.parse(atob(b64 + pad))
  } catch { return null }
}

// ── Admin-Dashboard (Standard-Eingang der Seite) ──────────────────
function Dashboard() {
  const [view, setView]               = useState('login') // login|list|create-category|create|created|detail|book-v1|book-v2|users
  const [token, setToken]             = useState(() => sessionStorage.getItem('lw_admin_token') || '')
  const [auth, setAuth]               = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('lw_admin_auth') || '') || { admin: false, cats: [], uid: null } }
    catch { return { admin: false, cats: [], uid: null } }
  })
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [memorials, setMemorials]     = useState([])
  const [selected, setSelected]       = useState(null)
  const [contributions, setContribs]  = useState([])
  const [selectedContrib, setSelectedContrib] = useState(null)
  const [createForm, setCreateForm]   = useState({ ...EMPTY_CREATE })
  const [usersData, setUsersData]     = useState({ users: [] })
  const [userForm, setUserForm]       = useState({ username: '', cats: [], demo: true })
  const [createdInvite, setCreatedInvite] = useState(null) // { username, url } – nach Neuanlage angezeigt
  const [auditData, setAuditData]     = useState({ entries: [] })
  const [auditLoading, setAuditLoading] = useState(false)
  const [logo, setLogo]               = useState(null)   // eigenes Firmenlogo (Data-URL)
  const [logoLoading, setLogoLoading] = useState(false)
  const [logoSaved, setLogoSaved]     = useState(false)
  const [pwForm, setPwForm]           = useState({ current: '', next: '', next2: '' })
  const [pwErr, setPwErr]             = useState('')
  const [pwSaved, setPwSaved]         = useState(false)
  const [createdCode, setCreatedCode] = useState('')
  const [catalogs, setCatalogs]       = useState([])    // Fragenkataloge (Auswahl beim Anlegen + Admin-Verwaltung)
  const [catalogForm, setCatalogForm] = useState(null)  // Editor-State (null = kein Editor offen)
  const [generating, setGenerating]   = useState({}) // { book_v1: true, ... }
  const [genProgress, setGenProgress] = useState({}) // { book_v1: 'Bild 3/7 …' }
  const [genPct, setGenPct]           = useState({}) // { book_v1: 42 } – Fortschritt in %
  const [genErr, setGenErr]           = useState({}) // { book_v1: 'Fehler …' } – Fehler PRO Variante (nicht global)
  const [genOwner, setGenOwner]       = useState({}) // { book_v1: <memorialId> } – welches Buchprojekt diese Variante generiert; Fortschritt/Fehler NUR dort anzeigen
  const [skipImages, setSkipImages]   = useState(false) // Debug: Bildgenerierung überspringen
  const [reviewingKey, setReviewingKey] = useState(null) // Feld, dessen Prüfung gerade läuft
  const [reviewPct, setReviewPct]       = useState(0)     // simulierter %-Fortschritt der Prüfung
  const [applyingFinding, setApplyingFinding] = useState(null) // "field:index" während Maßnahme läuft
  const [editingFinding, setEditingFinding]   = useState(null) // "field:index" beim manuellen Editieren
  const [editText, setEditText]               = useState('')
  const [editMode, setEditMode]               = useState(false) // Buch/Rede direkt bearbeiten
  const [editDraft, setEditDraft]             = useState(null)  // Arbeitskopie im Edit-Modus
  const [savingEdit, setSavingEdit]           = useState(false)
  const [orderEdit, setOrderEdit]             = useState(false) // Auftragsdaten bearbeiten
  const [orderDraft, setOrderDraft]           = useState(null)  // Arbeitskopie der Auftragsdaten
  const [orderSaving, setOrderSaving]         = useState(false)
  const [eulogyStyleModal, setEulogyStyleModal] = useState(false)
  const [genLangModal, setGenLangModal] = useState(null) // { key, extraArg } | null
  const [imgEditModal, setImgEditModal] = useState(null) // { key } | null – Bilder überarbeiten
  const [imgEditSel, setImgEditSel]     = useState(new Set()) // ausgewählte Kapitelindizes
  const [imgEditBusy, setImgEditBusy]   = useState(false)
  const [imgEditProgress, setImgEditProgress] = useState('')
  const [imgEditMsg, setImgEditMsg]     = useState('') // Erfolgsmeldung im Bilder-Modal (bleibt offen)
  const [imgZoom, setImgZoom]           = useState(null) // { url, heading } | null – Bild groß ansehen (Lightbox)
  const [reportModal, setReportModal] = useState(null)   // { title, field, report } | null
  const [costData, setCostData]       = useState(null)
  const [costsLoading, setCostsLoading] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [busy, setBusy]               = useState(false)
  const [deletingId, setDeletingId]   = useState('')
  const [copied, setCopied]           = useState('')
  const [err, setErr]                 = useState('')
  const [hoveredRow, setHoveredRow]   = useState(null) // { id, zone: 'main' | 'cost' }
  const [sort, setSort]               = useState({ key: 'cutoff', dir: 'asc' }) // Sortierung der Buchliste
  const [filters, setFilters]         = useState({}) // { colKey: [erlaubte Werte] } – fehlt = keine Filterung
  const [filterCol, setFilterCol]     = useState(null) // welches Spalten-Filtermenü offen ist

  useEffect(() => { if (token) loadMemorials(token) }, [])

  // Fehlt der Anzeigename (z. B. Session von vor dem Deploy), serverseitig
  // nachladen – damit oben der echte Benutzername statt eines Platzhalters steht.
  useEffect(() => {
    if (!token || auth.username) return
    const uid = auth.uid ?? decodeToken(token)?.uid
    if (!uid) return
    getSettings(token)
      .then(d => {
        if (!d?.username) return
        setAuth(a => {
          const next = { ...a, username: d.username, uid: a.uid ?? uid }
          sessionStorage.setItem('lw_admin_auth', JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
  }, [token])

  async function login(e) {
    e.preventDefault()
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      sessionStorage.setItem('lw_admin_token', d.token)
      const authInfo = { admin: Boolean(d.admin), cats: d.cats ?? [], uid: d.uid ?? null, username: d.username || username }
      sessionStorage.setItem('lw_admin_auth', JSON.stringify(authInfo))
      setToken(d.token); setAuth(authInfo)
      await loadMemorials(d.token)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function loadMemorials(t) {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401) { logout(); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMemorials(d); setView('list')
      loadCatalogs(t)   // Kataloge im Hintergrund laden (für Auswahl beim Anlegen)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // Fragenkataloge laden (für die Auswahl beim Buch-Anlegen und die Verwaltung).
  // Fehler bewusst still – die Liste ist optional, ohne sie überlegt die KI selbst.
  async function loadCatalogs(t = token) {
    try {
      const d = await adminListCatalogs(t)
      setCatalogs(d.catalogs || [])
    } catch { /* still */ }
  }

  // ── Fragenkatalog-Editor (nur Admin) ──
  function newCatalog() { setErr(''); setCatalogForm({ id: null, name: '', cats: [], chapters: [{ title: '', questions: [''] }] }) }
  function editCatalog(c) {
    setErr('')
    setCatalogForm({
      id: c.id, name: c.name || '', cats: [...(c.product_categories || [])],
      chapters: (c.chapters && c.chapters.length)
        ? c.chapters.map(ch => ({ title: ch.title || '', questions: (ch.questions && ch.questions.length) ? [...ch.questions] : [''] }))
        : [{ title: '', questions: [''] }],
    })
  }
  async function saveCatalog() {
    const cf = catalogForm; if (!cf) return
    const payload = {
      name: cf.name.trim(),
      product_categories: cf.cats,
      chapters: cf.chapters
        .map(ch => ({ title: ch.title.trim(), questions: ch.questions.map(q => q.trim()).filter(Boolean) }))
        .filter(ch => ch.title || ch.questions.length),
    }
    if (!payload.name) { setErr('Bitte einen Namen für den Katalog vergeben.'); return }
    setBusy(true); setErr('')
    try {
      if (cf.id) await adminUpdateCatalog(token, cf.id, payload)
      else await adminCreateCatalog(token, payload)
      setCatalogForm(null)
      await loadCatalogs()
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  async function removeCatalog(c) {
    if (!window.confirm(`Fragenkatalog „${c.name}" löschen? Bücher, die ihn nutzen, fallen auf den KI-Standardmodus zurück.`)) return
    setBusy(true); setErr('')
    try { await adminDeleteCatalog(token, c.id); await loadCatalogs() }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  async function openMemorial(memorial) {
    setSelected(memorial); setLoading(true); setErr('')
    setOrderEdit(false); setOrderDraft(null)
    try {
      const contribsRes = await fetch(`/api/admin/contributions?code=${memorial.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (contribsRes.status === 401) { logout(); return }
      const d = await contribsRes.json()
      if (!contribsRes.ok) throw new Error(d.error)
      setContribs(d)
      setView('detail')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function reloadContributions() {
    if (!selected) return
    setLoading(true); setErr('')
    try {
      const cRes = await fetch(`/api/admin/contributions?code=${selected.id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (cRes.status === 401) { logout(); return }
      const d = await cRes.json()
      if (!cRes.ok) throw new Error(d.error)
      setContribs(d)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  // ── Auftragsdaten (Stammdaten) bearbeiten ──
  function startOrderEdit() {
    const m = selected
    if (!m) return
    setErr('')
    setOrderDraft({
      name: m.name || '',
      organizer: m.organizer || '',
      gender: m.gender || '',
      bookVariant: m.book_variant === 2 ? 2 : 1,
      funeralDate: m.funeral_date ? String(m.funeral_date).slice(0, 10) : '',
      cutoffDays: Number.isFinite(parseInt(m.cutoff_days, 10)) ? parseInt(m.cutoff_days, 10) : 7,
      showIntroVideo: m.show_intro_video !== false,
      intake: m.intake ? { ...m.intake } : {},
      languages: Array.isArray(m.languages) && m.languages.length ? [...m.languages] : ['de'],
      note: m.note || '',
      pickupAddress: m.pickup_address ? { ...EMPTY_PICKUP, ...m.pickup_address } : { ...EMPTY_PICKUP },
    })
    setOrderEdit(true)
  }

  function cancelOrderEdit() { setOrderEdit(false); setOrderDraft(null); setErr('') }

  async function saveOrderData() {
    if (!orderDraft || !selected) return
    const d = orderDraft
    if (!d.name.trim() || !d.organizer.trim()) { setErr('Name und Organisator dürfen nicht leer sein.'); return }
    setOrderSaving(true); setErr('')
    try {
      await adminUpdateMemorialMeta(token, selected.id, {
        name: d.name, organizer: d.organizer, gender: d.gender || null,
        bookVariant: d.bookVariant, funeralDate: d.funeralDate || null,
        cutoffDays: d.cutoffDays, showIntroVideo: d.showIntroVideo,
        intake: d.intake, languages: d.languages, note: d.note,
        pickupAddress: d.pickupAddress,
      })
      // Lokal spiegeln (Backend-Normalisierung nachbilden), damit Detail- und
      // Listenansicht ohne Neuladen aktuell sind.
      const pa = d.pickupAddress || {}
      const hasAddr = ['name', 'addon', 'street', 'zip', 'city'].some(k => (pa[k] || '').trim())
      const local = {
        name: d.name.trim(),
        organizer: d.organizer.trim(),
        gender: d.gender || null,
        book_variant: d.bookVariant === 2 ? 2 : 1,
        funeral_date: d.funeralDate || null,
        cutoff_days: Number.isFinite(parseInt(d.cutoffDays, 10)) && parseInt(d.cutoffDays, 10) >= 0 ? parseInt(d.cutoffDays, 10) : 7,
        show_intro_video: d.showIntroVideo !== false,
        intake: d.intake && Object.keys(d.intake).length ? d.intake : (d.intake || null),
        languages: (d.languages && d.languages.length) ? d.languages : ['de'],
        note: d.note.trim() || null,
        pickup_address: hasAddr ? { ...pa, country: (pa.country || '').trim() || 'Deutschland' } : null,
      }
      setSelected(s => ({ ...s, ...local }))
      setMemorials(ms => ms.map(x => x.id === selected.id ? { ...x, ...local } : x))
      setOrderEdit(false); setOrderDraft(null)
    } catch (e) { setErr(e.message) }
    finally { setOrderSaving(false) }
  }

  function logout() {
    sessionStorage.removeItem('lw_admin_token')
    sessionStorage.removeItem('lw_admin_auth')
    setToken(''); setAuth({ admin: false, cats: [], uid: null }); setView('login'); setUsername(''); setPassword('')
    setMemorials([]); setContribs([]); setSelected(null)
  }

  // Für den eingeloggten Benutzer freigeschaltete Kategorie-Slugs.
  const allowedSlugs = (auth.admin || auth.cats === '*')
    ? CATEGORY_ORDER
    : CATEGORY_ORDER.filter(s => Array.isArray(auth.cats) && auth.cats.includes(s))
  const showCategoryColumn = allowedSlugs.length > 1

  // Eigene Benutzer-ID: bevorzugt aus der Session, sonst aus dem Token
  // (robust gegen alte Sessions ohne uid). null = Env-Superadmin.
  const myUid  = auth.uid ?? decodeToken(token)?.uid ?? null
  // Anzeigename des eingeloggten Benutzers.
  const myName = auth.username || (myUid ? 'Benutzer' : 'Administrator')

  // Startet die Neuanlage: bei mehreren erlaubten Kategorien erst Auswahl,
  // sonst direkt das Formular der einzigen Kategorie.
  function startCreate() {
    setErr('')
    if (allowedSlugs.length <= 1) {
      const slug = allowedSlugs[0] || DEFAULT_CATEGORY
      setCreateForm({ ...EMPTY_CREATE, productCategory: slug, intake: {}, pickupAddress: { ...EMPTY_PICKUP } })
      setView('create')
    } else {
      setView('create-category')
    }
  }

  function chooseCategory(slug) {
    setCreateForm({ ...EMPTY_CREATE, productCategory: slug, intake: {}, pickupAddress: { ...EMPTY_PICKUP } })
    setView('create')
  }

  async function handleCreate() {
    setErr(''); setBusy(true)
    try {
      const cat = getCategory(createForm.productCategory)
      const { code } = await createMemorial(token, {
        name: createForm.name.trim(),
        organizer: createForm.organizer.trim(),
        gender: cat.intake.useGender ? (createForm.gender || null) : null,
        bookVariant: createForm.bookVariant,
        funeralDate: cat.intake.useDate ? (createForm.funeralDate || null) : null,
        cutoffDays: createForm.cutoffDays,
        showIntroVideo: createForm.showIntroVideo,
        productCategory: createForm.productCategory,
        intake: createForm.intake || {},
        languages: createForm.languages?.length ? createForm.languages : [DEFAULT_LANGUAGE],
        note: createForm.note?.trim() || null,
        pickupAddress: createForm.pickupAddress,
        catalogId: createForm.catalogId || null,
        followups: createForm.followups,
      })
      setCreatedCode(code)
      setView('created')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  // ── Einstellungen (eigenes Firmenlogo) ──
  async function openSettings() {
    setErr(''); setLogoSaved(false); setLogoLoading(true); setView('settings')
    setPwForm({ current: '', next: '', next2: '' }); setPwErr(''); setPwSaved(false)
    try {
      const d = await getSettings(token)
      setLogo(d.logo || null)
    } catch (e) { setErr(e.message) }
    finally { setLogoLoading(false) }
  }

  function onLogoFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // erlaubt erneutes Wählen derselben Datei
    if (!file) return
    setErr(''); setLogoSaved(false)
    if (!/^image\//.test(file.type)) { setErr('Bitte eine Bilddatei auswählen.'); return }
    if (file.size > 1_000_000) { setErr('Das Logo ist zu groß (max. 1 MB).'); return }
    const reader = new FileReader()
    reader.onload = () => setLogo(reader.result)
    reader.onerror = () => setErr('Datei konnte nicht gelesen werden.')
    reader.readAsDataURL(file)
  }

  async function saveLogo(value) {
    setErr(''); setLogoSaved(false); setBusy(true)
    try {
      await saveSettings(token, { logo: value })
      setLogo(value)
      setLogoSaved(true)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  // Eigenes Passwort ändern (Einstellungen). Nur für Benutzerkonten.
  async function saveOwnPassword(e) {
    e?.preventDefault()
    setPwErr(''); setPwSaved(false)
    if (!pwForm.current) { setPwErr('Bitte das aktuelle Passwort eingeben.'); return }
    const policyErr = passwordError(pwForm.next)
    if (policyErr) { setPwErr(policyErr); return }
    if (pwForm.next !== pwForm.next2) { setPwErr('Die beiden neuen Passwörter stimmen nicht überein.'); return }
    setBusy(true)
    try {
      await changeOwnPassword(token, { currentPassword: pwForm.current, newPassword: pwForm.next })
      setPwForm({ current: '', next: '', next2: '' })
      setPwSaved(true)
    } catch (e) { setPwErr(e.message) }
    finally { setBusy(false) }
  }

  // ── Benutzer- & Gruppenverwaltung (nur Admin) ──
  async function loadUsers() {
    setErr('')
    try {
      const d = await adminListUsers(token)
      setUsersData(d)
    } catch (e) { setErr(e.message) }
  }
  async function loadAudit() {
    setErr(''); setAuditLoading(true)
    try {
      const d = await adminListAudit(token, { limit: 200 })
      setAuditData(d)
    } catch (e) { setErr(e.message) } finally { setAuditLoading(false) }
  }
  function toggleUserFormCat(slug) {
    setUserForm(f => ({
      ...f,
      cats: f.cats.includes(slug) ? f.cats.filter(s => s !== slug) : [...f.cats, slug],
    }))
  }
  function inviteLink(tok) { return `${window.location.origin}/?invite=${encodeURIComponent(tok)}` }
  async function submitUser() {
    if (!userForm.username.trim()) { setErr('Benutzername erforderlich.'); return }
    setErr(''); setBusy(true)
    try {
      const u = await adminCreateUser(token, {
        username: userForm.username.trim(),
        allowed_categories: userForm.cats,
        demo: userForm.demo,
      })
      setUserForm({ username: '', cats: [], demo: true })
      if (u.invite_token) setCreatedInvite({ username: u.username, url: inviteLink(u.invite_token), demo: u.demo, demoError: u.demo_error })
      await loadUsers()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  function copyInviteLink(user) {
    if (!user.invite_token) return
    navigator.clipboard?.writeText(inviteLink(user.invite_token))
    setCreatedInvite({ username: user.username, url: inviteLink(user.invite_token) })
  }
  async function regenerateInvite(user) {
    setErr('')
    try {
      const d = await adminUpdateUser(token, user.id, { regenerate_invite: true })
      if (d.invite_token) {
        navigator.clipboard?.writeText(inviteLink(d.invite_token))
        setCreatedInvite({ username: user.username, url: inviteLink(d.invite_token) })
      }
      await loadUsers()
    } catch (e) { setErr(e.message) }
  }
  async function saveUserCats(user, slug) {
    const next = (user.allowed_categories || []).includes(slug)
      ? user.allowed_categories.filter(s => s !== slug)
      : [...(user.allowed_categories || []), slug]
    setErr('')
    try { await adminUpdateUser(token, user.id, { allowed_categories: next }); await loadUsers() }
    catch (e) { setErr(e.message) }
  }
  async function resetUserPassword(user) {
    const pw = window.prompt(`Neues Passwort für „${user.username}".\n${PASSWORD_RULES_TEXT}`)
    if (!pw) return
    const pwErr = passwordError(pw)
    if (pwErr) { window.alert(pwErr); return }
    setErr('')
    try { await adminUpdateUser(token, user.id, { password: pw }); window.alert('Passwort geändert.') }
    catch (e) { setErr(e.message) }
  }
  async function removeUser(user) {
    if (!window.confirm(`Benutzer „${user.username}" löschen?`)) return
    setErr('')
    try { await adminDeleteUser(token, user.id); await loadUsers() }
    catch (e) { setErr(e.message) }
  }

  async function handleDelete(m) {
    if (!window.confirm(`„${m.name}" wirklich löschen? Alle Beiträge gehen unwiderruflich verloren.`)) return false
    setDeletingId(m.id); setErr('')
    try {
      await adminDeleteMemorial(token, m.id)
      setMemorials(ms => ms.filter(x => x.id !== m.id))
      return true
    } catch (e) { setErr(e.message); return false }
    finally { setDeletingId('') }
  }

  // DSGVO-Export der Daten EINES Beitragenden als .zip mit zwei Dateien:
  //  - daten.json  (maschinenlesbar, Art. 20 Datenübertragbarkeit)
  //  - auskunft.pdf (menschenlesbar, Art. 15 Auskunft)
  // Bewusst pro Beitrag (jeder Beitragende ist eigener Betroffener) – enthält
  // nur dessen eigene Daten, nicht die anderer Beitragender desselben Buchs.
  async function exportContribution(c) {
    setErr('')
    try {
      const bundle = {
        export_version: 1,
        generated_at: new Date().toISOString(),
        hinweis: 'Personenbezogene Daten dieses Beitrags gemäß DSGVO Art. 15 (Auskunft) / Art. 20 (Datenübertragbarkeit).',
        buch: { code: selected.id, name: selected.name, kategorie: selected.product_category },
        beitrag: {
          id: c.id,
          contributor_name: c.contributor_name,
          relationship: c.relationship,
          contributor_gender: c.contributor_gender ?? null,
          contributor_address: c.contributor_address ?? null,
          created_at: c.created_at,
          messages: c.messages,
        },
      }
      const base = safeName(c.contributor_name)
      const zip = new JSZip()
      zip.file(`${base}_daten.json`, JSON.stringify(bundle, null, 2))
      zip.file(`${base}_auskunft.pdf`, buildContributionPdf(c, selected))
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(`dsgvo-export_${base}.zip`, blob)
    } catch (e) { setErr(`Export fehlgeschlagen: ${e.message}`) }
  }

  async function deleteContribution(c) {
    if (!window.confirm(`Beitrag von „${c.contributor_name}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return
    setErr('')
    try {
      await adminDeleteContribution(token, c.id)
      setContribs(cs => cs.filter(x => x.id !== c.id))
      if (selectedContrib?.id === c.id) { setSelectedContrib(null); setView('detail') }
    } catch (e) { setErr(e.message) }
  }

  // Entfernt die Nachrichten an den angegebenen Indizes (Frage + Antwort) aus einem Beitrag.
  async function deleteMessages(c, indices) {
    if (!window.confirm('Diese Frage und Antwort wirklich aus dem Beitrag löschen?')) return
    setErr('')
    const drop = new Set(indices)
    const newMessages = c.messages.filter((_, idx) => !drop.has(idx))
    try {
      const updated = await adminUpdateContributionMessages(token, c.id, newMessages)
      setContribs(cs => cs.map(x => x.id === c.id ? updated : x))
      if (selectedContrib?.id === c.id) setSelectedContrib(updated)
    } catch (e) { setErr(e.message) }
  }

  function copyInvite(code) {
    const url = `${window.location.origin}/?code=${code}`
    navigator.clipboard.writeText(url)
    setCopied(code); setTimeout(() => setCopied(''), 2000)
  }

  async function copyQR(code) {
    const url = `${window.location.origin}/?code=${code}`
    setErr('')
    try {
      const resp = await fetch(qrCodeUrl(url, 320))
      const blob = await resp.blob()
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Bild-Kopieren wird in diesem Browser nicht unterstützt. Stattdessen Rechtsklick → Bild kopieren.')
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopied(`qr-${code}`); setTimeout(() => setCopied(''), 2000)
    } catch (e) {
      setErr(`QR kopieren: ${e.message}`)
    }
  }

  function dlOne(c) {
    downloadFile(`${safeName(c.contributor_name)}_${safeName(selected.name)}.txt`, formatContribution(selected, c))
  }
  function dlAll() {
    const sep = '\n\n' + '═'.repeat(60) + '\n\n'
    const text = contributions.map(c => formatContribution(selected, c)).join(sep)
    downloadFile(`${safeName(selected.name)}_alle-Beitraege.txt`, text)
  }

  // Generatoren werden aus der Kategorie-Konfiguration des aktuell gewählten
  // Buches abgeleitet (Fallback: memorial, solange keins gewählt ist).
  const activeCat = getCategory(selected?.product_category)
  const GENERATORS = {
    book_v1: {
      kind: 'book', field: 'book_v1', view: 'book-v1',
      label: activeCat.generators.book_v1.label,
      filename: activeCat.generators.book_v1.filename,
      outlineSystem: activeCat.generators.book_v1.outlineSystem,
      chapterSystem: activeCat.generators.book_v1.chapterSystem,
    },
    book_v2: {
      kind: 'book', field: 'book_v2', view: 'book-v2',
      label: activeCat.generators.book_v2.label,
      filename: activeCat.generators.book_v2.filename,
      outlineSystem: activeCat.generators.book_v2.outlineSystem,
      chapterSystem: activeCat.generators.book_v2.chapterSystem,
    },
    eulogy: {
      kind: 'eulogy', field: 'eulogy_text', view: 'eulogy',
      label: activeCat.finalText.label,
      filename: activeCat.finalText.filename,
      noun: activeCat.finalText.noun,
      sections: activeCat.finalText.sections,
      styles: activeCat.finalText.styles,
      sectionSystem: activeCat.finalText.sectionSystem,
    },
  }

  // Bildgenerierung mit Auto-Retry. Zwei Klassen transienter Fehler:
  //  - 5xx/Timeout (FLUX läuft am 60s-Limit) → kurze Pause genügt.
  //  - Rate-Limit (FLUX „exceeded rate limit", pro-Minute-Kontingent in
  //    westeurope) → deutlich LÄNGER warten, sonst läuft man sofort wieder
  //    ins Limit. Jeder Versuch ist ein eigener Serverless-Call, das 60s-
  //    Budget wird also pro Versuch frisch vergeben – wir dürfen client-
  //    seitig beliebig lange warten.
  // `onWait(seconds, rateLimited)` darf optional den Fortschritt anzeigen.
  async function generateImageWithRetry(memorialId, prompt, { maxAttempts = 4, onWait, meta } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await adminGenerateImage(token, memorialId, prompt, meta || {})
      } catch (e) {
        lastErr = e
        const msg = String(e?.message || '')
        const rateLimited = /rate.?limit|too many requests|exceeded|\b429\b/i.test(msg)
        // Auch ein 502 „Keine Bilddaten von FLUX erhalten" (FLUX wurde im
        // Zeitfenster nicht fertig) ist transient: ein erneuter Versuch mit
        // frischem 60-s-Budget gelingt fast immer.
        const transient = rateLimited || /HTTP 5\d\d|\b50[234]\b|bad gateway|timeout|timed out|FUNCTION_INVOCATION_TIMEOUT|fetch failed|keine bilddaten/i.test(msg)
        if (!transient || attempt === maxAttempts) throw e
        // Rate-Limit gilt pro Minute → 20s, 40s, 60s; sonst 3s, 6s, 9s.
        const waitMs = rateLimited ? 20000 * attempt : 3000 * attempt
        try { onWait?.(Math.round(waitMs / 1000), rateLimited) } catch {}
        await new Promise(r => setTimeout(r, waitMs))
      }
    }
    throw lastErr
  }

  // Kapitel-Generierung mit Auto-Retry: die KI liefert gelegentlich
  // ungültiges JSON oder läuft ins 60s-Timeout — beides ist transient,
  // ein zweiter/dritter Versuch klappt meistens.
  async function generateChapterWithRetry(sys, memorialCode, kind, { maxAttempts = 3 } = {}) {
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const chRaw = await askLLM(
          sys,
          [{ role: 'user', content: 'Erzeuge jetzt dieses eine Kapitel als JSON.' }],
          { memorialCode, kind, token }
        )
        const ch = tryParseJSON(chRaw)
        if (!ch || !ch.body) throw new Error('Kapitel-JSON ungültig oder leer.')
        return ch
      } catch (e) {
        lastErr = e
        if (attempt === maxAttempts) throw e
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }
    throw lastErr
  }

  // Inhalts-/Datenschutzprüfung des fertigen Textes (separater KI-Call),
  // gespeichert in content_reports[field]. Genutzt von generate() und vom
  // Button „Prüfung wiederholen". Immer eine FRISCHE Prüfung: alle Befunde
  // sind offen. Da Korrekturen fest im Buchtext gespeichert sind, findet die
  // Prüfung bereits behobene Stellen schlicht nicht mehr.
  async function runContentReview(field, value) {
    try {
      const reportRaw = await askLLM(
        reviewSystemPrompt(selected),
        [{ role: 'user', content: `BUCHTEXT:\n${extractReviewText(value)}\n\n${contributionsContext(contributions)}` }],
        { memorialCode: selected.id, kind: 'review', token }
      )
      const parsed = tryParseJSON(reportRaw) || {}
      const report = {
        checked_at: new Date().toISOString(),
        model: 'KI (serverseitig gewählt)',
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      }
      await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: report })
      return report
    } catch (e) {
      try {
        await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: { checked_at: new Date().toISOString(), error: e.message || String(e) } })
      } catch {}
      throw e
    }
  }

  // Prüfung erneut auf den bereits gespeicherten Text anwenden (ohne neu zu
  // generieren) – praktisch zum Testen.
  async function recheck(key) {
    const gen = GENERATORS[key]
    const value = selected?.[gen.field]
    if (!value) return
    setReviewingKey(key); setErr(''); setReviewPct(0)
    // Simulierter Fortschritt: ein einzelner KI-Call liefert keinen echten
    // Zwischenstand; wir lassen die Anzeige gleichmäßig bis 90 % hochlaufen.
    // Gleichmäßig und bewusst langsam bis 92 % (ein einzelner KI-Call hat
    // keinen echten Zwischenstand); springt bei Abschluss auf 100 %.
    const iv = setInterval(() => {
      setReviewPct(p => Math.min(92, p + 2))
    }, 800)
    try {
      await runContentReview(gen.field, value)
      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json()
        setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) setSelected(u)
      }
      setReviewPct(100)
    } catch (e) { setErr(`Prüfung fehlgeschlagen: ${e.message}`) }
    finally { clearInterval(iv); setReviewingKey(null) }
  }

  // Wendet die vorgeschlagene Maßnahme eines Befunds direkt im Text an
  // (mode = 'delete' | 'rephrase'), speichert und markiert den Befund als
  // erledigt. field = 'book_v1' | 'book_v2' | 'eulogy_text'.
  async function applyFinding(field, index, mode) {
    const report = selected?.content_reports?.[field]
    const value = selected?.[field]
    const finding = report?.findings?.[index]
    if (!finding || value == null) return

    // Als unkritisch markieren: keine Textänderung, kein KI-Call, kein
    // Historien-Eintrag (es wurde ja nichts überarbeitet).
    if (mode === 'accept') {
      setApplyingFinding(`${field}:${index}`); setErr('')
      try {
        const newFindings = report.findings.map((f, i) => i === index
          ? { ...f, status: 'resolved', resolution: 'accept', resolved_at: new Date().toISOString() }
          : f)
        const newReport = { ...report, findings: newFindings }
        await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: newReport })
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const fresh = await r.json(); setMemorials(fresh)
          const u = fresh.find(m => m.id === selected.id)
          if (u) { setSelected(u); setReportModal(mm => mm ? { ...mm, report: u.content_reports?.[field] } : mm) }
        } else {
          setSelected(s => ({ ...s, content_reports: { ...(s.content_reports || {}), [field]: newReport } }))
          setReportModal(mm => mm ? { ...mm, report: newReport } : mm)
        }
      } catch (e) { setErr(`Aktion fehlgeschlagen: ${e.message}`) }
      finally { setApplyingFinding(null) }
      return
    }

    const quote = String(finding.quote || '')
    if (!quote) { setErr('Dieser Befund hat kein Zitat, das automatisch geändert werden kann.'); return }
    setApplyingFinding(`${field}:${index}`); setErr('')
    try {
      const isBook = value && typeof value === 'object' && Array.isArray(value.chapters)
      let chapterIdx = -1, target
      if (isBook) {
        chapterIdx = value.chapters.findIndex(ch => String(ch.body || '').includes(quote))
        if (chapterIdx === -1) throw new Error('Textstelle im Buch nicht gefunden (evtl. bereits geändert).')
        target = value.chapters[chapterIdx].body
      } else {
        if (!String(value).includes(quote)) throw new Error('Textstelle nicht gefunden (evtl. bereits geändert).')
        target = String(value)
      }
      let corrected, newText
      if (mode === 'delete') {
        // Stelle entfernen und Tippfehler-Artefakte (doppelte Leerzeichen,
        // Leerzeichen vor Satzzeichen, leere Absätze) glätten.
        corrected = target.replace(quote, '')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\s+([.,;:!?])/g, '$1')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        newText = ''
      } else {
        // Gezielt nur die Stelle umformulieren -> KI liefert den Ersatztext.
        const ctxPara = String(target).split('\n\n').find(p => p.includes(quote)) || quote
        const sys = 'Du bist ein sorgfältiger Lektor. Formuliere NUR die markierte Stelle neutral um, sodass der beanstandete Inhalt entfällt, der Ton aber erhalten bleibt und sie sich nahtlos in den umgebenden Text einfügt. Gib AUSSCHLIESSLICH den Ersatztext zurück – ohne Anführungszeichen, ohne Erklärung, ohne Markdown.'
        const user = `UMGEBENDER ABSATZ:\n${ctxPara}\n\nZU ERSETZENDE STELLE:\n${quote}\n\nHINWEIS DER PRÜFUNG:\n${finding.note || ''}`
        newText = String(await askLLM(sys, [{ role: 'user', content: user }], { memorialCode: selected.id, kind: 'review_fix', token })).trim().replace(/^[„"»«\s]+|[„"»«\s]+$/g, '')
        if (!newText) throw new Error('Leere Antwort der KI.')
        corrected = target.replace(quote, newText)
      }

      const newValue = isBook
        ? { ...value, chapters: value.chapters.map((ch, i) => i === chapterIdx ? { ...ch, body: corrected } : ch) }
        : corrected
      await adminSaveMemorialText(token, selected.id, field, newValue)

      const newFindings = report.findings.map((f, i) => i === index
        ? { ...f, status: 'resolved', resolution: mode, resolved_at: new Date().toISOString(), new_text: newText }
        : f)
      const newReport = { ...report, findings: newFindings }
      await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: newReport })

      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json()
        setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) { setSelected(u); setReportModal(mm => mm ? { ...mm, report: u.content_reports?.[field] } : mm) }
      } else {
        setSelected(s => ({ ...s, [field]: newValue, content_reports: { ...(s.content_reports || {}), [field]: newReport } }))
        setReportModal(mm => mm ? { ...mm, report: newReport } : mm)
      }
    } catch (e) { setErr(`Maßnahme fehlgeschlagen: ${e.message}`) }
    finally { setApplyingFinding(null) }
  }

  // Abbruch-Wunsch je Generierung (Ref, damit der laufende async-Lauf den
  // aktuellen Wert sieht). Greift zwischen den Schritten: der gerade laufende
  // Einzel-Call (z. B. ein Kapitel) wird noch zu Ende geführt, danach Stopp.
  const cancelGenRef = useRef({})
  function cancelGenerate(key) {
    cancelGenRef.current[key] = true
    setGenProgress(p => ({ ...p, [key]: 'Wird abgebrochen …' }))
  }

  // Manuelles Bearbeiten des Korrekturtexts einer bereits umformulierten Stelle.
  // Ersetzt die aktuelle Formulierung im Buch durch die vom Nutzer editierte und
  // dokumentiert das als eigenen Historien-Eintrag ('edit').
  async function editFindingText(field, index, newText) {
    const report = selected?.content_reports?.[field]
    const value = selected?.[field]
    const finding = report?.findings?.[index]
    if (!finding || value == null) return
    const current = String(finding.new_text || '')
    const edited = String(newText || '').trim()
    if (!edited) { setErr('Der Korrekturtext darf nicht leer sein.'); return }
    if (edited === current) { setEditingFinding(null); return }
    setApplyingFinding(`${field}:${index}`); setErr('')
    try {
      const isBook = value && typeof value === 'object' && Array.isArray(value.chapters)
      let newValue
      if (isBook) {
        const ci = value.chapters.findIndex(ch => String(ch.body || '').includes(current))
        if (ci === -1) throw new Error('Aktuelle Formulierung im Buch nicht gefunden (evtl. zwischenzeitlich geändert).')
        newValue = { ...value, chapters: value.chapters.map((ch, i) => i === ci ? { ...ch, body: ch.body.replace(current, edited) } : ch) }
      } else {
        if (!String(value).includes(current)) throw new Error('Aktuelle Formulierung nicht gefunden.')
        newValue = String(value).replace(current, edited)
      }
      await adminSaveMemorialText(token, selected.id, field, newValue)
      const newFindings = report.findings.map((f, i) => i === index ? { ...f, new_text: edited, resolved_at: new Date().toISOString() } : f)
      const newReport = { ...report, findings: newFindings }
      await adminSaveMemorialText(token, selected.id, 'content_reports', { [field]: newReport })
      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json(); setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) { setSelected(u); setReportModal(mm => mm ? { ...mm, report: u.content_reports?.[field] } : mm) }
      } else {
        setSelected(s => ({ ...s, [field]: newValue, content_reports: { ...(s.content_reports || {}), [field]: newReport } }))
        setReportModal(mm => mm ? { ...mm, report: newReport } : mm)
      }
      setEditingFinding(null)
    } catch (e) { setErr(`Bearbeiten fehlgeschlagen: ${e.message}`) }
    finally { setApplyingFinding(null) }
  }

  // Direkt im „Ansehen/Bearbeiten"-Modus geänderten Buch-/Redetext speichern.
  async function saveEdit(field, draft) {
    setSavingEdit(true); setErr('')
    try {
      await adminSaveMemorialText(token, selected.id, field, draft)
      const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        const fresh = await r.json(); setMemorials(fresh)
        const u = fresh.find(m => m.id === selected.id)
        if (u) setSelected(u)
      } else {
        setSelected(s => ({ ...s, [field]: draft }))
      }
      setEditMode(false); setEditDraft(null)
    } catch (e) { setErr(`Speichern fehlgeschlagen: ${e.message}`) }
    finally { setSavingEdit(false) }
  }

  async function generate(key, extraArg, opts = {}) {
    const gen = GENERATORS[key]
    if (!gen || !selected) return
    if (selected[gen.field] && !opts.skipConfirm && !window.confirm(`„${gen.label}" wurde bereits generiert. Vorhandene Version überschreiben?`)) return
    // Sprache des Endprodukts: vom Admin gewählt (opts.lang) oder die einzige
    // angebotene Sprache, sonst Deutsch. Wird den Prompts vorangestellt.
    const genLang = opts.lang || ((selected.languages && selected.languages.length === 1) ? selected.languages[0] : DEFAULT_LANGUAGE)
    const dir = langDirective(genLang)
    setErr('')
    setGenErr(p => ({ ...p, [key]: '' })) // Fehler DIESER Variante zurücksetzen
    setGenOwner(o => ({ ...o, [key]: selected.id })) // Fortschritt an dieses Buchprojekt binden
    setGenerating(g => ({ ...g, [key]: true }))
    setGenProgress(p => ({ ...p, [key]: 'Text wird generiert …' }))
    setGenPct(p => ({ ...p, [key]: 0 }))
    cancelGenRef.current[key] = false
    // Bewusst KEIN View-Wechsel: der Fortschritt ist in der Buch-Übersicht
    // (Detail) direkt an der Karte sichtbar; der Nutzer bleibt im Kontext.
    // Fortschritt in % – Schritte: Gerüst + je Kapitel + je Bild + Prüfung.
    let stepsDone = 0
    let stepsTotal = 1
    const bumpPct = (inc = 1) => {
      stepsDone += inc
      setGenPct(p => ({ ...p, [key]: Math.min(99, Math.round((stepsDone / stepsTotal) * 100)) }))
    }
    const checkCancel = () => { if (cancelGenRef.current[key]) throw new Error('__CANCELLED__') }
    try {
      let value

      if (gen.kind === 'book') {
        // Phase 1: Buch-Gerüst (Titel/Untertitel und ggf. Kapitelliste) ─
        setGenProgress(p => ({ ...p, [key]: 'Buch-Gerüst wird geplant …' }))
        // Das Gerüst kann – wie einzelne Kapitel – gelegentlich als ungültiges
        // JSON zurückkommen (sporadischer Modell-Ausrutscher / Zeitüberschreitung).
        // Deshalb bis zu 3 Versuche mit Backoff, bevor wir aufgeben.
        const outlineSys = gen.outlineSystem(selected, contributions) + dir
        let outline = null, lastOutlineRaw = ''
        for (let attempt = 1; attempt <= 3; attempt++) {
          checkCancel()
          lastOutlineRaw = await askLLM(
            outlineSys,
            [{ role: 'user', content: 'Erzeuge jetzt das Gerüst als JSON.' }],
            { memorialCode: selected.id, kind: `${key}_outline`, token }
          )
          const parsed = tryParseJSON(lastOutlineRaw)
          if (parsed && parsed.title) { outline = parsed; break }
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt))
        }
        if (!outline) {
          const snip = String(lastOutlineRaw || '').replace(/\s+/g, ' ').trim().slice(0, 200)
          throw new Error('Buch-Gerüst konnte nicht als JSON gelesen werden (auch nach mehreren Versuchen).' +
            (snip ? ` Antwort des KI-Dienstes begann mit: „${snip}…"` : ' Der KI-Dienst lieferte eine leere Antwort (evtl. nicht erreichbar oder Zeitüberschreitung).'))
        }

        // Kapitel-Plan: V1 = aus Beiträgen abgeleitet, V2 = aus Outline
        const chapterPlans = key === 'book_v1'
          ? contributions.map((c, i) => ({ number: i + 1, contribution: c }))
          : (Array.isArray(outline.chapters) ? outline.chapters : [])
        if (chapterPlans.length === 0) throw new Error('Keine Kapitel im Buch-Gerüst gefunden.')

        // Gesamtschritte jetzt bekannt: Gerüst(1) + Kapitel + Bilder + Prüfung(1)
        stepsTotal = 1 + chapterPlans.length + (skipImages ? 0 : chapterPlans.length) + 1
        bumpPct() // Gerüst fertig
        checkCancel()

        // Phase 2: jedes Kapitel einzeln schreiben ──────────────────────
        const chapters = []
        const writeErrors = []
        for (let i = 0; i < chapterPlans.length; i++) {
          const plan = chapterPlans[i]
          setGenProgress(p => ({ ...p, [key]: `Kapitel ${i + 1}/${chapterPlans.length} wird geschrieben …` }))
          checkCancel()
          try {
            const sys = (key === 'book_v1'
              ? gen.chapterSystem(selected, plan.contribution, plan.number)
              : gen.chapterSystem(selected, contributions, plan)) + dir
            const ch = await generateChapterWithRetry(sys, selected.id, `${key}_chapter`)
            chapters.push({
              number: ch.number || plan.number,
              heading: ch.heading || plan.heading || `Kapitel ${plan.number}`,
              body: ch.body,
              image_prompt: ch.image_prompt || '',
              // Stabiler Schlüssel für die spätere Bild-Wiederverwendung (V1).
              ...(key === 'book_v1' && plan.contribution?.id ? {
                contribution_id: plan.contribution.id,
                contributor_name: plan.contribution.contributor_name,
                relationship: plan.contribution.relationship,
              } : {}),
            })
          } catch (e) {
            writeErrors.push(`Kapitel ${plan.number}: ${e.message}`)
            chapters.push({
              number: plan.number,
              heading: plan.heading || `Kapitel ${plan.number}`,
              body: '',
              image_prompt: '',
              generate_error: e.message || String(e),
              ...(key === 'book_v1' && plan.contribution?.id ? {
                contribution_id: plan.contribution.id,
                contributor_name: plan.contribution.contributor_name,
                relationship: plan.contribution.relationship,
              } : {}),
            })
          }
          bumpPct() // Kapitel fertig
        }

        value = {
          title: outline.title,
          subtitle: outline.subtitle || '',
          language: genLang,
          chapters,
        }

        // Phase 2b: hochgeladene Fotos den Kapiteln zuordnen ────────────
        // Erst deterministisch (Contributor-Fotos mit contribution_id → Kapitel
        // dieses Beitrags, nur V1), dann per KI für den Rest. Ergebnis:
        // chapterAssign[Kapitelnummer] = [uploadObj, …].
        const uploads = Array.isArray(selected.uploaded_images) ? selected.uploaded_images : []
        const chapterAssign = {}
        const assignById = {}
        for (const u of uploads) assignById[u.id] = u
        const assignedIds = new Set()
        const takeFor = (num, u) => { (chapterAssign[num] = chapterAssign[num] || []).push(u) }
        if (key === 'book_v1') {
          for (const ch of value.chapters) {
            if (!ch.contribution_id) continue
            for (const u of uploads) {
              if (u.contribution_id && u.contribution_id === ch.contribution_id && !assignedIds.has(u.id)) {
                takeFor(ch.number, u); assignedIds.add(u.id)
              }
            }
          }
        }
        const remainingUploads = uploads.filter(u => !assignedIds.has(u.id))
        if (remainingUploads.length > 0) {
          try {
            setGenProgress(p => ({ ...p, [key]: 'Fotos werden Kapiteln zugeordnet …' }))
            const sysAssign = imageAssignSystem(value.chapters, remainingUploads) + dir
            let parsed = null
            for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
              checkCancel()
              const raw = await askLLM(sysAssign, [{ role: 'user', content: 'Ordne die Fotos jetzt zu (JSON).' }],
                { memorialCode: selected.id, kind: `${key}_image_assign`, token })
              parsed = tryParseJSON(raw)
              if (!parsed && attempt < 2) await new Promise(r => setTimeout(r, 1500))
            }
            for (const a of (Array.isArray(parsed?.assignments) ? parsed.assignments : [])) {
              const num = Number(a.chapter)
              for (const id of (Array.isArray(a.image_ids) ? a.image_ids : [])) {
                const u = assignById[id]
                if (u && !assignedIds.has(u.id)) { takeFor(num, u); assignedIds.add(u.id) }
              }
            }
          } catch (e) { console.warn('Bildzuordnung fehlgeschlagen (nicht kritisch):', e.message) }
        }
        // Referenzfoto für die KI-Bilder (Personen-Ähnlichkeit): bevorzugt ein
        // Hochkant-Foto; wird allen FLUX-Kapiteln als Referenz mitgegeben.
        // Serverseitig nur aktiv, wenn AZURE_FLUX_IMG2IMG gesetzt ist.
        const faceRef = uploads.find(u => u.orientation === 'portrait') || uploads[0]
        const faceRefPaths = faceRef?.path ? [faceRef.path] : []

        // Phase 3: Bilder pro Kapitel (sequenziell, mit Auto-Retry) ─────
        // Per Checkbox überspringbar (Debug: spart die langsame Bildphase).
        const total = value.chapters.length
        const imageErrors = []
        // Bild-Wiederverwendung: vorhandene Bilder des alten Buchs den neuen
        // Kapiteln zuordnen (V1 über contribution_id/Überschrift, V2 über
        // Überschrift/Position). Neue/zusätzliche Kapitel ohne Treffer bekommen
        // ein frisches Bild. `selected[gen.field]` ist hier noch die alte Version.
        // Bilder bleiben bei der Neu-Generierung immer erhalten; gezielt einzelne
        // Bilder neu erzeugen geht über „Bilder überarbeiten".
        const oldChapters = Array.isArray(selected[gen.field]?.chapters) ? selected[gen.field].chapters : []
        const normH = s => String(s || '').trim().toLowerCase()
        const oldByContrib = new Map()
        const oldByHeading = new Map()
        for (const oc of oldChapters) {
          if (!oc?.image_path) continue
          if (oc.contribution_id) oldByContrib.set(oc.contribution_id, oc.image_path)
          if (oc.heading) oldByHeading.set(normH(oc.heading), oc.image_path)
        }
        let reusedCount = 0
        let freshCount = 0 // Zähler echter FLUX-Calls (für sanftes Pacing)
        if (skipImages) {
          setGenProgress(p => ({ ...p, [key]: 'Bilder werden übersprungen …' }))
        } else {
          for (let i = 0; i < total; i++) {
            const ch = value.chapters[i]
            setGenProgress(p => ({ ...p, [key]: `Bild ${i + 1}/${total} wird erstellt …` }))
            checkCancel()
            // Zugeordnete Uploads → EIN komponiertes Landscape-Doppelseiten-Bild
            // (Hochkant/mehrere/geringe Qualität werden serverseitig sinnvoll
            // gruppiert, Bildunterschriften eingebrannt). Hat Vorrang vor FLUX.
            const assigned = (chapterAssign[ch.number] || []).slice(0, 4)
            if (assigned.length > 0) {
              setGenProgress(p => ({ ...p, [key]: `Bild ${i + 1}/${total}: Fotos werden gesetzt …` }))
              try {
                const { storagePath } = await adminComposeImage(token, selected.id,
                  assigned.map(u => ({ path: u.path, caption: u.caption, orientation: u.orientation })),
                  { variant: key, chapterNumber: ch.number, chapterHeading: ch.heading })
                value.chapters[i] = { ...ch, image_path: storagePath, image_error: null, from_upload: true }
              } catch (e) {
                console.warn(`Kompositor für Kapitel ${ch.number}:`, e.message)
                value.chapters[i] = { ...ch, image_error: e.message || String(e) }
                imageErrors.push(`Kapitel ${ch.number}: ${imageErrorDe(e.message)}`)
              }
              bumpPct()
              continue
            }
            // Wenn möglich vorhandenes Bild wiederverwenden (kein neuer Call).
            {
              let reusedPath = null
              if (ch.contribution_id && oldByContrib.has(ch.contribution_id)) reusedPath = oldByContrib.get(ch.contribution_id)
              else if (oldByHeading.has(normH(ch.heading))) reusedPath = oldByHeading.get(normH(ch.heading))
              else if (oldChapters[i]?.image_path) reusedPath = oldChapters[i].image_path
              if (reusedPath) {
                value.chapters[i] = { ...ch, image_path: reusedPath, image_error: null }
                reusedCount++
                bumpPct() // wiederverwendet – Schritt erledigt
                continue
              }
            }
            if (!ch.image_prompt) {
              value.chapters[i] = { ...ch, image_error: 'kein image_prompt im Kapitel' }
              imageErrors.push(`Kapitel ${ch.number}: ${imageErrorDe('kein image_prompt')}`)
              bumpPct() // Bild-Schritt erledigt
              continue
            }
            // Sanftes Pacing: vor jedem weiteren FLUX-Call kurz warten, damit
            // das pro-Minute-Rate-Limit gar nicht erst gerissen wird.
            if (freshCount > 0) await new Promise(r => setTimeout(r, 1500))
            freshCount++
            try {
              const { storagePath } = await generateImageWithRetry(selected.id, ch.image_prompt, {
                meta: { variant: key, chapterNumber: ch.number, chapterHeading: ch.heading, ...(faceRefPaths.length ? { referencePaths: faceRefPaths } : {}) },
                onWait: (s, rl) => setGenProgress(p => ({ ...p, [key]: rl
                  ? `Bild ${i + 1}/${total}: Rate-Limit erreicht – warte ${s}s und versuche es erneut …`
                  : `Bild ${i + 1}/${total}: erneuter Versuch in ${s}s …` })),
              })
              value.chapters[i] = { ...ch, image_path: storagePath, image_error: null }
            } catch (e) {
              console.warn(`Bild für Kapitel ${ch.number}:`, e.message)
              value.chapters[i] = { ...ch, image_error: e.message || String(e) }
              imageErrors.push(`Kapitel ${ch.number}: ${imageErrorDe(e.message)}`)
            }
            bumpPct() // Bild fertig
          }
        }

        const errLines = []
        if (writeErrors.length > 0) errLines.push(`${writeErrors.length}/${chapterPlans.length} Kapitel-Fehler. Erster: ${writeErrors[0]}`)
        if (imageErrors.length > 0) errLines.push(`${imageErrors.length}/${total} Bildgenerierungen fehlgeschlagen. Erster Fehler: ${imageErrors[0]}`)
        if (errLines.length > 0) setGenErr(p => ({ ...p, [key]: errLines.join(' · ') }))

        const saveMsg = reusedCount > 0
          ? `${reusedCount} Bild${reusedCount > 1 ? 'er' : ''} übernommen · wird gespeichert …`
          : 'Wird gespeichert …'
        setGenProgress(p => ({ ...p, [key]: saveMsg }))
      } else if (gen.kind === 'eulogy') {
        // Endtext (z. B. Rede) in mehrere Abschnitte aufgeteilt — jeder ein
        // eigener KI-Call, damit niemand am 60s-Limit von api/ask.js stirbt.
        const sections = gen.sections || []
        const parts = []
        const sectionErrors = []
        stepsTotal = sections.length + 1 // Abschnitte + Prüfung
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i]
          setGenProgress(p => ({ ...p, [key]: `Abschnitt ${i + 1}/${sections.length}: ${section.label} …` }))
          checkCancel()
          try {
            const raw = await askLLM(
              gen.sectionSystem(selected, contributions, section, extraArg) + dir,
              [{ role: 'user', content: `Schreibe jetzt den Abschnitt „${section.label}" der ${gen.noun}.` }],
              { memorialCode: selected.id, kind: key, token }
            )
            const text = String(raw || '').trim()
            if (!text) throw new Error('leere Antwort')
            parts.push(text)
          } catch (e) {
            sectionErrors.push(`${section.label}: ${e.message}`)
          }
          bumpPct() // Abschnitt fertig
        }
        if (parts.length === 0) throw new Error(`Kein Abschnitt der ${gen.noun} konnte generiert werden.`)
        value = parts.join('\n\n')
        if (sectionErrors.length > 0) setGenErr(p => ({ ...p, [key]: `${sectionErrors.length}/${sections.length} Abschnitt-Fehler. Erster: ${sectionErrors[0]}` }))
        setGenProgress(p => ({ ...p, [key]: 'Wird gespeichert …' }))
      } else {
        // Sonstige Plain-Text-Generatoren (derzeit keiner)
        const raw = await askLLM(
          gen.system(selected, contributions, extraArg),
          [{ role: 'user', content: gen.userPrompt }],
          { memorialCode: selected.id, kind: key }
        )
        value = raw
      }

      await adminSaveMemorialText(token, selected.id, gen.field, value)

      // Inhalts-/Datenschutzprüfung des generierten Textes (separater KI-
      // Call). Fehler hier dürfen die Generierung NICHT scheitern lassen –
      // der Text ist bereits gespeichert.
      setGenProgress(p => ({ ...p, [key]: 'Inhaltsprüfung läuft …' }))
      try { await runContentReview(gen.field, value) }
      catch (e) { console.warn('Inhaltsprüfung fehlgeschlagen:', e.message) }
      bumpPct() // Prüfung fertig

      // Neu laden, damit die signierten Bild-URLs ins selected/memorials kommen
      setGenProgress(p => ({ ...p, [key]: 'Bilder werden geladen …' }))
      try {
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const fresh = await r.json()
          setMemorials(fresh)
          const updated = fresh.find(m => m.id === selected.id)
          if (updated) setSelected(updated)
        } else {
          setSelected(s => ({ ...s, [gen.field]: value }))
          setMemorials(ms => ms.map(m => m.id === selected.id ? { ...m, [gen.field]: value } : m))
        }
      } catch {
        setSelected(s => ({ ...s, [gen.field]: value }))
        setMemorials(ms => ms.map(m => m.id === selected.id ? { ...m, [gen.field]: value } : m))
      }
      setGenPct(p => ({ ...p, [key]: 100 }))
    } catch (e) {
      const m = e.message === '__CANCELLED__'
        ? 'Generierung abgebrochen. Bereits erzeugte Inhalte wurden nicht gespeichert.'
        : `Generieren fehlgeschlagen: ${e.message}`
      setGenErr(p => ({ ...p, [key]: m }))
    }
    finally {
      setGenerating(g => ({ ...g, [key]: false }))
      setGenProgress(p => ({ ...p, [key]: '' }))
      setGenPct(p => ({ ...p, [key]: undefined }))
      cancelGenRef.current[key] = false
    }
  }

  async function downloadGenerated(key) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data) return
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}.docx`
      if (gen.kind === 'book') await downloadStructuredDocx(filename, data, contributions, selected.owner_logo)
      else                     await downloadAsDocx(filename, `${gen.label} – ${selected.name}`, data)
    } catch (e) { setErr(`Download fehlgeschlagen: ${e.message}`) }
  }

  // Druckfertiges PDF (nur Bücher): doppelseitiges Bild, Kapitel beginnen rechts.
  async function downloadGeneratedPdf(key) {
    const gen = GENERATORS[key]
    const data = selected?.[gen.field]
    if (!data || gen.kind !== 'book') return
    setErr('')
    try {
      const filename = `${gen.filename}_${safeName(selected.name)}_Druck.pdf`
      await downloadPrintPdf(filename, data, contributions, selected.owner_logo)
    } catch (e) { setErr(`Druck-PDF fehlgeschlagen: ${e.message}`) }
  }

  function pickEulogyStyle(style) {
    setEulogyStyleModal(false)
    requestGenerate('eulogy', style.instruction)
  }

  // Hat ein Buch bereits generierte Bilder?
  function bookHasImages(book) {
    return Array.isArray(book?.chapters) && book.chapters.some(c => c?.image_path)
  }

  // Startet die Generierung; bei mehreren angebotenen Sprachen wird zuvor die
  // Zielsprache abgefragt. Vorhandene Bilder werden bei der Neu-Generierung
  // automatisch beibehalten (siehe generate()); gezielt einzelne Bilder neu
  // erzeugen geht über „Bilder überarbeiten".
  function requestGenerate(key, extraArg) {
    const langs = (selected?.languages && selected.languages.length) ? selected.languages : [DEFAULT_LANGUAGE]
    if (langs.length > 1) { setGenLangModal({ key, extraArg }); return }
    generate(key, extraArg, { lang: langs[0], skipConfirm: extraArg !== undefined })
  }
  function pickGenLang(code) {
    const m = genLangModal
    setGenLangModal(null)
    if (m) generate(m.key, m.extraArg, { lang: code, skipConfirm: m.extraArg !== undefined })
  }

  // ── Bilder überarbeiten: gezielt einzelne Kapitelbilder neu generieren ──
  function openImgEdit(key) {
    setImgEditSel(new Set())
    setImgEditProgress('')
    setImgEditMsg('')
    setImgEditModal({ key })
  }
  function toggleImgSel(i) {
    setImgEditSel(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  }
  async function regenerateSelectedImages() {
    const m = imgEditModal
    if (!m) return
    const gen = GENERATORS[m.key]
    const book = selected?.[gen.field]
    const indices = [...imgEditSel].sort((a, b) => a - b)
    if (!book?.chapters || indices.length === 0) return
    setImgEditBusy(true); setErr(''); setImgEditMsg('')
    try {
      const newChapters = book.chapters.map(c => ({ ...c }))
      // Referenzfoto für die Personen-Ähnlichkeit (nur serverseitig aktiv bei
      // AZURE_FLUX_IMG2IMG). Bevorzugt ein Hochkant-Upload.
      const ups = Array.isArray(selected.uploaded_images) ? selected.uploaded_images : []
      const fref = ups.find(u => u.orientation === 'portrait') || ups[0]
      const frefPaths = fref?.path ? [fref.path] : []
      const errs = []
      let done = 0
      for (const i of indices) {
        const ch = newChapters[i]
        setImgEditProgress(`Bild ${done + 1}/${indices.length} wird neu erstellt …`)
        if (!ch.image_prompt) { errs.push(`Kapitel ${ch.number}: ${imageErrorDe('kein Bild-Prompt')}`); done++; continue }
        // Sanftes Pacing gegen das pro-Minute-Rate-Limit (FLUX).
        if (done > 0) await new Promise(r => setTimeout(r, 1500))
        try {
          const { storagePath } = await generateImageWithRetry(selected.id, ch.image_prompt, {
            meta: { variant: m.key, chapterNumber: ch.number, chapterHeading: ch.heading, ...(frefPaths.length ? { referencePaths: frefPaths } : {}) },
            onWait: (s, rl) => setImgEditProgress(rl
              ? `Bild ${done + 1}/${indices.length}: Rate-Limit – warte ${s}s und versuche es erneut …`
              : `Bild ${done + 1}/${indices.length}: erneuter Versuch in ${s}s …`),
          })
          newChapters[i] = { ...ch, image_path: storagePath, image_url: undefined, image_error: null }
        } catch (e) {
          errs.push(`Kapitel ${ch.number}: ${imageErrorDe(e.message)}`)
          newChapters[i] = { ...ch, image_error: e.message || String(e) }
        }
        done++
      }
      setImgEditProgress('Wird gespeichert …')
      // Speichern; der Server räumt die nun verwaisten alten Bilddateien auf.
      await adminSaveMemorialText(token, selected.id, gen.field, { ...book, chapters: newChapters })
      // Neu laden, damit frische signierte Bild-URLs ankommen.
      try {
        const r = await fetch('/api/admin/memorials', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const fresh = await r.json()
          setMemorials(fresh)
          const updated = fresh.find(x => x.id === selected.id)
          if (updated) setSelected(updated)
        }
      } catch {}
      if (errs.length) setErr(`${errs.length} Bild(er) fehlgeschlagen. Erster: ${errs[0]}`)
      // Modal bewusst OFFEN lassen, damit die neu erzeugten Bilder direkt
      // sichtbar sind (Thumbnails haben sich durch den Reload aktualisiert).
      const ok = indices.length - errs.length
      setImgEditMsg(ok > 0 ? `✓ ${ok} Bild${ok > 1 ? 'er' : ''} neu erstellt.` : '')
      setImgEditSel(new Set())
    } catch (e) {
      setErr(e.message)
    } finally {
      setImgEditBusy(false); setImgEditProgress('')
    }
  }

  async function openCosts(memorial) {
    setSelected(memorial); setCostData(null); setCostsLoading(true); setErr('')
    setView('costs')
    try {
      const d = await getMemorialCosts(token, memorial.id)
      setCostData(d)
    } catch (e) { setErr(e.message) }
    finally { setCostsLoading(false) }
  }

  const eulogyStyleOverlay = eulogyStyleModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 520, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
        <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>Stil der {GENERATORS.eulogy.label} wählen</h2>
        <p style={{ ...S.muted, marginBottom:16 }}>In welchem Ton soll der Text verfasst werden?</p>
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:14 }}>
          {GENERATORS.eulogy.styles.map(s => (
            <div
              key={s.key}
              onClick={() => pickEulogyStyle(s)}
              style={{ ...S.card, cursor:'pointer', padding:'14px 16px', transition:'border-color .15s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#1c1917'; e.currentTarget.style.background = '#fafaf9' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e7e5e4'; e.currentTarget.style.background = '#fff' }}
            >
              <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>{s.title}</div>
              <p style={{ ...S.muted, fontSize:13, margin:0 }}>{s.sub}</p>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12 }}>
          <button className="ghost" onClick={() => setEulogyStyleModal(false)} style={{ fontSize:14 }}>Abbrechen</button>
        </div>
      </div>
    </div>
  ) : null

  const genLangOverlay = genLangModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 420, width:'100%' }}>
        <h2 style={{ fontSize:18, fontWeight:700, marginBottom:6 }}>In welcher Sprache soll das Buch erstellt werden?</h2>
        <p style={{ ...S.muted, marginBottom:16 }}>Für dieses Buch sind mehrere Sprachen freigeschaltet.</p>
        <div style={{ display:'grid', gap:10, marginBottom:14 }}>
          {((selected?.languages && selected.languages.length) ? selected.languages : [DEFAULT_LANGUAGE]).map(code => {
            const meta = LANGUAGES.find(x => x.code === code) || { code, label: code }
            return <button key={code} onClick={() => pickGenLang(code)} style={{ fontSize:15, padding:'12px 16px' }}>{meta.label}</button>
          })}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12 }}>
          <button className="ghost" onClick={() => setGenLangModal(null)} style={{ fontSize:14 }}>Abbrechen</button>
        </div>
      </div>
    </div>
  ) : null

  const imgEditOverlay = imgEditModal ? (() => {
    const gen = GENERATORS[imgEditModal.key]
    const book = selected?.[gen.field]
    const chapters = Array.isArray(book?.chapters) ? book.chapters : []
    const selCount = imgEditSel.size
    const allSel = chapters.length > 0 && selCount === chapters.length
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
        <div style={{ ...S.card, maxWidth: 720, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
            <div>
              <h2 style={{ fontSize:18, fontWeight:700, margin:'0 0 4px' }}>Bilder überarbeiten · {gen.label}</h2>
              <p style={{ ...S.muted, margin:0 }}>Wähle die Bilder aus, die neu generiert werden sollen. Die übrigen bleiben unverändert.</p>
            </div>
            <button
              className="ghost"
              disabled={imgEditBusy}
              onClick={() => setImgEditSel(allSel ? new Set() : new Set(chapters.map((_, i) => i)))}
              style={{ fontSize:13, whiteSpace:'nowrap' }}
            >
              {allSel ? 'Keine' : 'Alle'}
            </button>
          </div>

          <div style={{ overflowY:'auto', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', alignItems:'start', gap:12, padding:'4px 2px', flex:1 }}>
            {chapters.map((ch, i) => {
              const on = imgEditSel.has(i)
              return (
                <div
                  key={i}
                  onClick={() => !imgEditBusy && toggleImgSel(i)}
                  style={{
                    border:`2px solid ${on ? '#1c1917' : '#e7e5e4'}`, borderRadius:10,
                    // KEIN overflow:hidden auf der Kachel — das beschnitt die Beschriftung.
                    cursor: imgEditBusy ? 'default' : 'pointer', background:'#fff', position:'relative',
                  }}
                >
                  <div style={{ position:'relative', aspectRatio:'3 / 2', background:'#f5f5f4', borderTopLeftRadius:8, borderTopRightRadius:8, overflow:'hidden' }}>
                    {ch.image_url
                      ? <img
                          src={ch.image_thumb_url || ch.image_url}
                          alt={ch.heading || `Kapitel ${ch.number}`}
                          loading="lazy" decoding="async"
                          onError={(e) => { if (ch.image_thumb_url && e.currentTarget.src !== ch.image_url) e.currentTarget.src = ch.image_url }}
                          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
                        />
                      : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#a8a29e' }}>kein Bild</div>}
                    {ch.image_url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setImgZoom({ url: ch.image_url, heading: ch.heading || `Kapitel ${ch.number}` }) }}
                        title="Größer ansehen"
                        style={{
                          position:'absolute', top:6, left:6, width:24, height:24, borderRadius:6,
                          background:'rgba(255,255,255,.85)', border:'1px solid #d6d3d1', cursor:'zoom-in',
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, lineHeight:1, padding:0,
                        }}
                      >🔍</button>
                    )}
                    <div style={{
                      position:'absolute', top:6, right:6, width:22, height:22, borderRadius:6,
                      background: on ? '#1c1917' : 'rgba(255,255,255,.85)', border:`1px solid ${on ? '#1c1917' : '#d6d3d1'}`,
                      display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:14, fontWeight:700,
                    }}>{on ? '✓' : ''}</div>
                  </div>
                  <div style={{ padding:'7px 9px 11px' }}>
                    <div style={{ fontSize:11, color:'#a8a29e', marginBottom:2 }}>Kapitel {ch.number}</div>
                    {/* Volltext-Umbruch statt Zeilen-Clamp: die Überschrift wird nie abgeschnitten. */}
                    <div style={{ fontSize:13, fontWeight:600, lineHeight:1.35, wordBreak:'break-word' }}>{ch.heading || '—'}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {imgEditBusy && imgEditProgress && (
            <p style={{ fontSize:13, color:'#78716c', margin:'12px 0 0' }}>⏳ {imgEditProgress}</p>
          )}
          {!imgEditBusy && imgEditMsg && (
            <p style={{ fontSize:13, color:'#15803d', margin:'12px 0 0' }}>{imgEditMsg}</p>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:12 }}>
            <button className="ghost" onClick={() => setImgEditModal(null)} disabled={imgEditBusy} style={{ fontSize:14 }}>Schließen</button>
            <button onClick={regenerateSelectedImages} disabled={imgEditBusy || selCount === 0} style={{ fontSize:14, padding:'10px 18px' }}>
              {imgEditBusy ? 'Wird generiert …' : `✨ Auswahl neu generieren${selCount ? ` (${selCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    )
  })() : null

  // Lightbox: ein einzelnes Kapitelbild groß ansehen (über dem Rework-Dialog).
  const imgZoomOverlay = imgZoom ? (
    <div
      onClick={() => setImgZoom(null)}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.82)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:200, padding:'2rem', cursor:'zoom-out' }}
    >
      <button onClick={() => setImgZoom(null)} title="Schließen"
        style={{ position:'fixed', top:14, right:20, fontSize:28, lineHeight:1, color:'#fff', background:'none', border:'none', cursor:'pointer' }}>×</button>
      <img
        src={imgZoom.url}
        alt={imgZoom.heading || ''}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth:'95vw', maxHeight:'88vh', objectFit:'contain', borderRadius:8, boxShadow:'0 8px 40px rgba(0,0,0,.5)' }}
      />
      {imgZoom.heading && <div style={{ color:'#fff', marginTop:12, fontSize:14, textAlign:'center' }}>{imgZoom.heading}</div>}
    </div>
  ) : null

  const sevStyle = sev => sev === 'hoch' ? { color:'#b91c1c', background:'#fee2e2' }
    : sev === 'mittel' ? { color:'#b45309', background:'#fef3c7' }
    : { color:'#78716c', background:'#f5f5f4' }
  const reportOverlay = reportModal ? (
    <div style={{ position:'fixed', inset:0, background:'rgba(28,25,23,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100, padding:'1rem', overflowY:'auto' }}>
      <div style={{ ...S.card, maxWidth: 640, width:'100%', maxHeight:'85vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:8 }}>
          <h2 style={{ fontSize:18, fontWeight:700, margin:0 }}>🛡 Prüfbericht – {reportModal.title}</h2>
          <button className="ghost" onClick={() => setReportModal(null)} style={{ fontSize:20, lineHeight:1, padding:'0 6px' }}>×</button>
        </div>
        {reportModal.report?.checked_at && (
          <p style={{ ...S.muted, fontSize:12, marginTop:0, marginBottom:12 }}>
            Automatische Inhalts-/Datenschutzprüfung vom {new Date(reportModal.report.checked_at).toLocaleString('de-DE')}.
            Hinweis: KI-gestützt, ersetzt keine juristische Prüfung.
          </p>
        )}
        {reportModal.report?.error ? (
          <p style={{ fontSize:14, color:'#b91c1c' }}>Die Prüfung ist fehlgeschlagen: {reportModal.report.error}</p>
        ) : (reportModal.report?.findings?.length ? (
          <>
            {reportModal.report.summary && (
              <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', marginTop:0, marginBottom:14 }}>{reportModal.report.summary}</p>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {reportModal.report.findings.map((f, i) => {
                const resolved = f.status === 'resolved'
                const applying = applyingFinding === `${reportModal.field}:${i}`
                return (
                <div key={i} style={{ border:'1px solid', borderColor: resolved ? '#bbf7d0' : '#e7e5e4', background: resolved ? '#f0fdf4' : '#fff', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:600, fontSize:13 }}>{f.category || 'Befund'}</span>
                    <span style={{ ...sevStyle(f.severity), fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6, textTransform:'uppercase' }}>{f.severity || '—'}</span>
                  </div>
                  {f.location && <p style={{ fontSize:12, color:'#78716c', margin:'0 0 6px' }}>📍 {f.location}</p>}
                  {(() => { const struck = resolved && f.resolution !== 'accept'; return f.quote && <p style={{ fontSize:13, fontStyle:'italic', color: struck ? '#a8a29e' : '#44403c', textDecoration: struck ? 'line-through' : 'none', margin:'0 0 6px', borderLeft:'3px solid #e7e5e4', paddingLeft:10 }}>„{f.quote}"</p> })()}
                  {resolved && f.resolution === 'rephrase' && (() => {
                    const editKey = `${reportModal.field}:${i}`
                    if (editingFinding === editKey) return (
                      <div style={{ margin:'4px 0 6px', paddingLeft:10, borderLeft:'3px solid #bbf7d0' }}>
                        <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3} style={{ width:'100%', fontFamily:'inherit', fontSize:13, resize:'vertical' }} />
                        <div style={{ display:'flex', gap:8, marginTop:6 }}>
                          <button onClick={() => editFindingText(reportModal.field, i, editText)} disabled={!!applyingFinding} style={{ fontSize:12, padding:'5px 10px' }}>{applyingFinding === editKey ? 'Speichert …' : 'Speichern'}</button>
                          <button onClick={() => setEditingFinding(null)} className="ghost" style={{ fontSize:12 }}>Abbrechen</button>
                        </div>
                      </div>
                    )
                    return f.new_text ? (
                      <p style={{ fontSize:13, fontStyle:'italic', color:'#15803d', margin:'0 0 6px', borderLeft:'3px solid #bbf7d0', paddingLeft:10 }}>
                        → „{f.new_text}"{' '}
                        <button className="ghost" onClick={() => { setEditingFinding(editKey); setEditText(f.new_text) }} style={{ fontSize:12, padding:'0 4px', textDecoration:'underline', fontStyle:'normal' }}>✏ bearbeiten</button>
                      </p>
                    ) : null
                  })()}
                  {f.note && <p style={{ fontSize:13, color:'#57534e', margin:0 }}>{f.note}</p>}
                  {f.source_contributor && (
                    <p style={{ fontSize:12, color:'#78716c', margin:'6px 0 0' }}>
                      👤 Quelle: <strong style={{ color:'#57534e' }}>{f.source_contributor}</strong>
                      {f.source_quote ? <> – „{f.source_quote}"</> : null}
                    </p>
                  )}
                  {resolved ? (
                    <p style={{ fontSize:12, color:'#15803d', margin:'8px 0 0', fontWeight:600 }}>
                      ✓ {f.resolution === 'delete' ? 'Im Text gelöscht' : f.resolution === 'accept' ? 'Als in Ordnung markiert' : 'Im Text umformuliert'}{f.resolved_at ? ` · ${new Date(f.resolved_at).toLocaleString('de-DE')}` : ''}
                    </p>
                  ) : reportModal.field ? (
                    <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap', alignItems:'center' }}>
                      <button onClick={() => applyFinding(reportModal.field, i, 'rephrase')} disabled={!!applyingFinding} style={{ fontSize:12, padding:'6px 10px' }}>
                        {applying ? 'Wird angewendet …' : '✏ Umformulieren'}
                      </button>
                      <button onClick={() => applyFinding(reportModal.field, i, 'delete')} disabled={!!applyingFinding} className="secondary" style={{ fontSize:12, padding:'6px 10px', color:'#b91c1c', borderColor:'#fecaca' }}>
                        🗑 Löschen
                      </button>
                      <button onClick={() => applyFinding(reportModal.field, i, 'accept')} disabled={!!applyingFinding} className="secondary" style={{ fontSize:12, padding:'6px 10px', color:'#15803d', borderColor:'#bbf7d0' }}>
                        ✓ In Ordnung
                      </button>
                    </div>
                  ) : null}
                </div>
                )
              })}
            </div>
          </>
        ) : (
          <p style={{ fontSize:14, color:'#15803d' }}>✓ Keine kritischen Aussagen gefunden.</p>
        ))}
        <div style={{ display:'flex', justifyContent:'flex-end', borderTop:'1px solid #e7e5e4', paddingTop:12, marginTop:16 }}>
          <button className="ghost" onClick={() => setReportModal(null)} style={{ fontSize:14 }}>Schließen</button>
        </div>
      </div>
    </div>
  ) : null

  const col = { padding: '11px 14px', textAlign: 'left', borderBottom: '1px solid #e7e5e4', fontSize: 14 }
  const th  = { ...col, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#78716c', background: '#fafaf9' }

  // ── LOGIN ──
  if (view === 'login') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9' }}>
      <form onSubmit={login} style={{ width: '100%', maxWidth: 360, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Lebenswerk Admin</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Bitte melden Sie sich an.</p>
        <Err msg={err} />
        <div style={{ marginBottom: 12 }}>
          <Lbl>Benutzername</Lbl>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" autoFocus />
        </div>
        <div style={{ marginBottom: 20 }}>
          <Lbl>Passwort</Lbl>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••" />
        </div>
        <button type="submit" disabled={loading || !username || !password} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {loading ? 'Wird überprüft …' : 'Anmelden'}
        </button>
      </form>
    </div>
  )

  // ── LISTE ──
  if (view === 'list') {
    // Sortierbare + filterbare Spalten (Reihenfolge = Spaltenreihenfolge).
    //  val  = Sortierwert,  disp = angezeigter/filterbarer Wert (String)
    const sortCols = [
      { key: 'name',      label: 'Name',          val: m => (m.name || '').toLowerCase(), disp: m => m.name || '—' },
      ...(showCategoryColumn ? [{ key: 'category', label: 'Kategorie', val: m => getCategory(m.product_category).label.toLowerCase(), disp: m => getCategory(m.product_category).label }] : []),
      ...(auth.admin ? [{ key: 'owner', label: 'Inhaber', val: m => (m.owner_username || '').toLowerCase(), disp: m => m.owner_username || '—' }] : []),
      { key: 'organizer', label: 'Organisator',   val: m => (m.organizer || '').toLowerCase(), disp: m => m.organizer || '—' },
      { key: 'variant',   label: 'Variante',      val: m => m.book_variant || 0, disp: m => m.book_variant ? `Variante ${m.book_variant}` : '—' },
      { key: 'cutoff',    label: 'Erfassung bis', val: m => { const d = cutoffDate(m.funeral_date, cutoffDays(m)); return d ? d.getTime() : Infinity }, disp: m => cutoffString(m.funeral_date, cutoffDays(m)) },
      { key: 'answers',   label: 'Antworten',     val: m => m.answer_count || 0, disp: m => `${m.answer_count || 0} Antworten` },
      ...(auth.admin ? [{ key: 'cost', label: 'Kosten', val: m => m.cost_total_eur || 0, disp: m => formatEur(m.cost_total_eur) }] : []),
    ]
    const colByKey = k => sortCols.find(c => c.key === k) || sortCols[0]
    const distinctVals = col => [...new Set(memorials.map(col.disp))].sort((a, b) => String(a).localeCompare(String(b), 'de', { numeric: true }))
    // Sichtbarkeit: ein Buch passt, wenn es in JEDER aktiven Filterspalte einen
    // ausgewählten Wert hat. Fehlt der Filtereintrag, ist die Spalte ungefiltert.
    const visibleMemorials = memorials.filter(m => sortCols.every(c => {
      const sel = filters[c.key]
      return !sel || sel.includes(c.disp(m))
    }))
    const activeCol = colByKey(sort.key)
    const sortedMemorials = [...visibleMemorials].sort((a, b) => {
      const va = activeCol.val(a), vb = activeCol.val(b)
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), 'de')
      return sort.dir === 'asc' ? cmp : -cmp
    })
    const toggleSort = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

    // Filter-Helfer (filters[key] = Liste erlaubter disp-Werte; fehlt = alle).
    const filterActive = key => { const sel = filters[key]; return sel && sel.length < distinctVals(colByKey(key)).length }
    const valChecked = (key, v) => { const sel = filters[key]; return !sel || sel.includes(v) }
    const allChecked = key => { const sel = filters[key]; return !sel || sel.length === distinctVals(colByKey(key)).length }
    const toggleVal = (key, v) => setFilters(f => {
      const all = distinctVals(colByKey(key))
      const cur = f[key] ? [...f[key]] : [...all]
      const i = cur.indexOf(v)
      if (i >= 0) cur.splice(i, 1); else cur.push(v)
      if (cur.length === all.length) { const n = { ...f }; delete n[key]; return n } // alle = kein Filter
      return { ...f, [key]: cur }
    })
    const toggleAll = key => setFilters(f => {
      if (allChecked(key)) return { ...f, [key]: [] }        // alle abwählen
      const n = { ...f }; delete n[key]; return n             // alle anwählen = kein Filter
    })
    return (
    <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <span style={{ fontSize: 13, color: '#78716c', marginLeft: 12 }}>
            {visibleMemorials.length < memorials.length ? `${visibleMemorials.length} / ${memorials.length}` : memorials.length} {memorials.length === 1 ? 'Buch' : 'Bücher'}
          </span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize: 13, color: '#78716c', marginRight: 4 }}>
            Angemeldet als <strong style={{ color:'#1c1917', fontWeight:600 }}>{myName}</strong>
          </span>
          {auth.admin && (
            <button className="secondary" onClick={() => { loadUsers(); setErr(''); setView('users') }} style={{ fontSize: 13, padding: '7px 14px' }}>Benutzer</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadAudit(); setErr(''); setView('audit') }} style={{ fontSize: 13, padding: '7px 14px' }}>Audit-Log</button>
          )}
          {auth.admin && (
            <button className="secondary" onClick={() => { loadCatalogs(); setCatalogForm(null); setErr(''); setView('catalogs') }} style={{ fontSize: 13, padding: '7px 14px' }}>Fragenkataloge</button>
          )}
          {myUid && (
            <button className="secondary" onClick={openSettings} style={{ fontSize: 13, padding: '7px 14px' }}>Einstellungen</button>
          )}
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '2rem auto', padding: '0 1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem', gap:12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Alle Bücher</h2>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {Object.keys(filters).length > 0 && (
              <button className="secondary" onClick={() => setFilters({})} style={{ fontSize:13, padding:'8px 12px' }}>Filter zurücksetzen</button>
            )}
            <button onClick={startCreate} style={{ fontSize:14, padding:'9px 16px' }}>
              + Neues Buch
            </button>
          </div>
        </div>
        <Err msg={err} />
        {loading ? (
          <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
        ) : memorials.length === 0 ? (
          <div style={{ ...S.card, textAlign:'center', padding:'2rem' }}>
            <p style={S.muted}>Noch keine Bücher angelegt. Beginnen Sie mit „+ Neues Buch".</p>
          </div>
        ) : (
          <>
            {filterCol && <div onClick={() => setFilterCol(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
          <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'visible' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {sortCols.map(c => (
                    <th key={c.key} style={{ ...th, whiteSpace: 'nowrap', position: 'relative', zIndex: filterCol === c.key ? 40 : undefined }}>
                      <span onClick={() => toggleSort(c.key)} title="Spalte sortieren" style={{ cursor: 'pointer', userSelect: 'none' }}>
                        {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                      </span>
                      <span onClick={(e) => { e.stopPropagation(); setFilterCol(k => k === c.key ? null : c.key) }}
                            title="Spalte filtern"
                            style={{ marginLeft: 6, cursor: 'pointer', color: filterActive(c.key) ? '#1d4ed8' : '#a8a29e' }}>▼</span>
                      {filterCol === c.key && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, marginTop: 4, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,.14)', padding: 8, minWidth: 190, maxHeight: 300, overflowY: 'auto', textAlign: 'left', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 6px', fontSize: 13, fontWeight: 600, color: '#1c1917', cursor: 'pointer' }}>
                            <input type="checkbox" checked={allChecked(c.key)}
                                   ref={el => { if (el) el.indeterminate = !allChecked(c.key) && (filters[c.key]?.length > 0) }}
                                   onChange={() => toggleAll(c.key)} />
                            Alle
                          </label>
                          <div style={{ borderTop: '1px solid #f5f5f4', margin: '4px 0' }} />
                          {distinctVals(c).map(v => (
                            <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 6px', fontSize: 13, color: '#44403c', cursor: 'pointer' }}>
                              <input type="checkbox" checked={valChecked(c.key, v)} onChange={() => toggleVal(c.key, v)} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 230 }}>{v}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </th>
                  ))}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {sortedMemorials.map(m => {
                  const isHover    = hoveredRow?.id === m.id
                  const mainHover  = isHover && hoveredRow.zone === 'main'
                  const costHover  = isHover && hoveredRow.zone === 'cost'
                  const MAIN_BG    = '#fef3c7' // warm amber
                  const COST_BG    = '#dbeafe' // cool blue
                  const mainCellBg = mainHover ? MAIN_BG : ''
                  const mainCell   = { ...col, cursor:'pointer', background: mainCellBg, transition:'background .1s' }
                  const enterMain  = () => setHoveredRow({ id: m.id, zone: 'main' })
                  const leaveRow   = () => setHoveredRow(null)
                  return (
                    <tr key={m.id}>
                      <td style={{ ...mainCell, fontWeight: 600 }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.name}</td>
                      {showCategoryColumn && (
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:7 }}>
                          <span style={{ color:'#57534e', lineHeight:0 }}><CategoryIcon slug={m.product_category} size={18} /></span>
                          {getCategory(m.product_category).label}
                        </span>
                      </td>
                      )}
                      {auth.admin && (
                        <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }} onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.owner_username || '—'}</td>
                      )}
                      <td style={mainCell}                                                onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.organizer}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{m.book_variant ? `Variante ${m.book_variant}` : '—'}</td>
                      <td style={{ ...mainCell, color:'#78716c' }}                       onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>{cutoffString(m.funeral_date, cutoffDays(m))}</td>
                      <td style={{ ...mainCell, color:'#78716c', whiteSpace:'nowrap' }}     onMouseEnter={enterMain} onMouseLeave={leaveRow} onClick={() => openMemorial(m)}>
                        {(m.contribution_count || 0)} {(m.contribution_count === 1) ? 'Beitrag' : 'Beiträge'} · {(m.answer_count || 0)} {(m.answer_count === 1) ? 'Antwort' : 'Antworten'}
                      </td>
                      {auth.admin && (
                      <td
                        style={{ ...col, textAlign:'right', whiteSpace:'nowrap', padding:'6px 14px', background: costHover ? COST_BG : '', transition:'background .1s' }}
                        onMouseEnter={() => setHoveredRow({ id: m.id, zone: 'cost' })}
                        onMouseLeave={leaveRow}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); openCosts(m) }}
                          title="Aufschlüsselung anzeigen"
                          style={{
                            background: costHover ? '#bfdbfe' : '#fff',
                            border:'1px solid #93c5fd',
                            borderRadius:8,
                            padding:'6px 12px',
                            fontSize:13,
                            fontWeight:600,
                            color:'#1d4ed8',
                            cursor:'pointer',
                            display:'inline-flex',
                            alignItems:'center',
                            gap:6,
                            transition:'background .1s, border-color .1s',
                            whiteSpace:'nowrap',
                          }}
                        >
                          <span aria-hidden="true">💶</span>
                          <span style={{ textDecoration:'underline', textUnderlineOffset:2 }}>{formatEur(m.cost_total_eur)}</span>
                        </button>
                      </td>
                      )}
                      <td style={{ ...col, textAlign:'right' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(m) }}
                          disabled={deletingId === m.id}
                          className="secondary"
                          style={{ fontSize:12, padding:'6px 12px', color:'#dc2626', borderColor:'#fecaca' }}
                          title={`${getCategory(m.product_category).nounBook} löschen`}
                        >
                          {deletingId === m.id ? '…' : '🗑 Löschen'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
    )
  }

  // ── PRODUKTKATEGORIE WÄHLEN (vor der Anlage) ──
  if (view === 'create-category') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Produktkategorie wählen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Für welchen Anlass soll das Buch entstehen?</p>
        <Err msg={err} />
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10 }}>
          {allowedSlugs.map(slug => {
            const c = categoryColor(slug)
            return (
            <div
              key={slug}
              onClick={() => chooseCategory(slug)}
              style={{ ...S.card, cursor:'pointer', padding:'16px 16px', borderLeft:`4px solid ${c}`, transition:'border-color .15s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = c; e.currentTarget.style.background = `${c}0d` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e7e5e4'; e.currentTarget.style.borderLeftColor = c; e.currentTarget.style.background = '#fff' }}
            >
              <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ color:c, flexShrink:0, lineHeight:0, marginTop:1 }}><CategoryIcon slug={slug} size={28} /></span>
                <div>
                  <div style={{ fontWeight:600, fontSize:15, marginBottom:4, color:c }}>{CATEGORIES[slug].label}</div>
                  <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{CATEGORIES[slug].description}</div>
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  )

  // ── NEUES BUCH (kategorie-spezifisches Formular) ──
  if (view === 'create') {
    const cat = getCategory(createForm.productCategory)
    const ci  = cat.intake
    const canSubmit = createForm.name && createForm.organizer && (!ci.useGender || createForm.gender) && !busy
    const pa = createForm.pickupAddress || EMPTY_PICKUP
    const setPa = patch => setCreateForm(f => ({ ...f, pickupAddress: { ...f.pickupAddress, ...patch } }))
    return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView(allowedSlugs.length > 1 ? 'create-category' : 'list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{ci.createHeading}</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>{ci.createIntro}</p>
        <Err msg={err} />
        <div style={{ marginBottom: 14 }}>
          <Lbl>{ci.subjectLabel}</Lbl>
          <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder={ci.subjectPlaceholder} />
        </div>
        {ci.useGender && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.genderLabel}</Lbl>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {GENDERS.map(g => (
                <div
                  key={g.value}
                  onClick={() => setCreateForm({ ...createForm, gender: g.value })}
                  style={{
                    ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                    borderColor: createForm.gender === g.value ? '#1c1917' : '#e7e5e4',
                    borderWidth: createForm.gender === g.value ? 2 : 1,
                    fontSize: 14, fontWeight: createForm.gender === g.value ? 600 : 400,
                  }}
                >
                  {g.label}
                </div>
              ))}
            </div>
          </div>
        )}
        {(ci.extra || []).map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <Lbl>{f.label}</Lbl>
            <input
              value={createForm.intake?.[f.key] || ''}
              onChange={e => setCreateForm({ ...createForm, intake: { ...createForm.intake, [f.key]: e.target.value } })}
              placeholder={f.placeholder || ''}
            />
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <Lbl>Ihr Name (Organisator) *</Lbl>
          <input value={createForm.organizer} onChange={e => setCreateForm({ ...createForm, organizer: e.target.value })} placeholder="Ihr Name" />
        </div>
        {ci.useDate && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.dateLabel}</Lbl>
            <input type="date" value={createForm.funeralDate} onChange={e => setCreateForm({ ...createForm, funeralDate: e.target.value })} />
          </div>
        )}
        {ci.useCutoff && (
          <div style={{ marginBottom: 14 }}>
            <Lbl>{ci.cutoffLabel}</Lbl>
            <input
              type="number" min={0} max={90} step={1}
              value={createForm.cutoffDays}
              onChange={e => {
                const v = e.target.value
                setCreateForm({ ...createForm, cutoffDays: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) })
              }}
            />
            <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
              {createForm.funeralDate && Number.isFinite(parseInt(createForm.cutoffDays, 10))
                ? <>Beiträge fließen bis zum <strong>{cutoffString(createForm.funeralDate, parseInt(createForm.cutoffDays, 10))}</strong> ein.</>
                : <>Standard sind 7 Tage.</>}
            </p>
          </div>
        )}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Sprachen *</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px' }}>
            In welchen Sprachen sollen Beitragende den Prozess durchführen können? Bei mehreren Sprachen wählt der Beitragende zu Beginn seine Sprache.
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {LANGUAGES.map(l => {
              const on = createForm.languages.includes(l.code)
              return (
                <label key={l.code} style={{
                  display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                  ...S.card, padding:'10px 14px',
                  borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setCreateForm(f => {
                      const next = on ? f.languages.filter(c => c !== l.code) : [...f.languages, l.code]
                      return { ...f, languages: next.length ? next : f.languages }
                    })}
                    style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }}
                  />
                  <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                </label>
              )
            })}
          </div>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Buch-Variante *</Lbl>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
            {BOOK_VARIANTS.map(v => (
              <div
                key={v.value}
                onClick={() => setCreateForm({ ...createForm, bookVariant: v.value })}
                style={{
                  ...S.card, cursor:'pointer', padding:'14px 14px',
                  borderColor: createForm.bookVariant === v.value ? '#1c1917' : '#e7e5e4',
                  borderWidth: createForm.bookVariant === v.value ? 2 : 1,
                }}
              >
                <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
              </div>
            ))}
          </div>
        </div>
        {(() => {
          const avail = catalogs.filter(c => (c.product_categories || []).includes(createForm.productCategory))
          if (avail.length === 0) return null
          return (
            <div style={{ marginBottom: 24 }}>
              <Lbl>Fragenkatalog</Lbl>
              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 8px' }}>
                Standard: die KI überlegt sich die Interviewfragen selbst. Alternativ führt sie das Interview entlang eines vordefinierten Katalogs.
              </p>
              <select
                value={createForm.catalogId}
                onChange={e => setCreateForm({ ...createForm, catalogId: e.target.value })}
                style={{ width:'100%', padding:'10px 12px', fontSize:14, fontFamily:'inherit' }}
              >
                <option value="">KI überlegt selbst (Standard)</option>
                {avail.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {createForm.catalogId && (
                <div style={{ marginTop:12 }}>
                  <Lbl>Nachfragen pro Frage (max.)</Lbl>
                  <input
                    type="number" min={0} max={30} step={1}
                    value={createForm.followups}
                    onChange={e => { const v = e.target.value; setCreateForm({ ...createForm, followups: v === '' ? '' : Math.max(0, Math.min(30, parseInt(v, 10) || 0)) }) }}
                    style={{ width:120 }}
                  />
                  <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
                    Wie viele vertiefende Nachfragen die KI höchstens zu jeder Katalogfrage stellt. Der Beitragende kann jederzeit „weiter" sagen. Standard: 7.
                  </p>
                </div>
              )}
            </div>
          )
        })()}
        {createForm.productCategory === 'memorial' && (
        <div style={{ marginBottom: 24 }}>
          <Lbl>Einführungsvideo</Lbl>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
            <input
              type="checkbox"
              checked={createForm.showIntroVideo}
              onChange={e => setCreateForm({ ...createForm, showIntroVideo: e.target.checked })}
              style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }}
            />
            <span style={{ fontSize:14 }}>Einführungsvideo vor dem Sprach-Interview anzeigen</span>
          </label>
          <p style={{ fontSize:12, color:'#78716c', marginTop:6, marginLeft:28 }}>
            Standard: aktiv. Wenn deaktiviert, startet das Interview direkt ohne Video.
          </p>
        </div>
        )}
        <div style={{ marginBottom: 24 }}>
          <Lbl>Bemerkung</Lbl>
          <textarea
            value={createForm.note}
            onChange={e => setCreateForm({ ...createForm, note: e.target.value })}
            placeholder="Interne Notiz zu diesem Buch (optional) – wird bei der Bucherstellung angezeigt."
            rows={3}
            style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14 }}
          />
          <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
            Nur intern sichtbar. Wird bei der Bucherstellung angezeigt – z. B. Hinweise zur Gestaltung oder zum Inhalt.
          </p>
        </div>
        <div style={{ marginBottom: 24 }}>
          <Lbl>Sammelbestellungs-Adresse (optional)</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'2px 0 10px' }}>
            Adresse, an die die gedruckten Bücher gesammelt geliefert / wo sie abgeholt werden. Kann leer bleiben.
          </p>
          <input value={pa.name} onChange={e => setPa({ name: e.target.value })} placeholder="Name / Empfänger" style={{ marginBottom:8 }} />
          <input value={pa.addon} onChange={e => setPa({ addon: e.target.value })} placeholder="Adresszusatz (z. B. c/o, Firma)" style={{ marginBottom:8 }} />
          <input value={pa.street} onChange={e => setPa({ street: e.target.value })} placeholder="Straße und Hausnummer" style={{ marginBottom:8 }} />
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input value={pa.zip} onChange={e => setPa({ zip: e.target.value })} placeholder="PLZ" style={{ flex:'0 0 120px' }} />
            <input value={pa.city} onChange={e => setPa({ city: e.target.value })} placeholder="Ort" style={{ flex:1 }} />
          </div>
          <input value={pa.country} onChange={e => setPa({ country: e.target.value })} placeholder="Land" />
        </div>
        <button
          disabled={!canSubmit}
          onClick={handleCreate}
          style={{ width: '100%', padding: 13, fontSize: 15 }}
        >
          {busy ? 'Wird erstellt …' : ci.createButton}
        </button>
      </div>
    </div>
    )
  }

  // ── EINSTELLUNGEN (eigenes Firmenlogo) ──
  if (view === 'settings') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Einstellungen</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Hinterlegen Sie Ihr Firmenlogo. Es wird den Beitragenden Ihrer Bücher oben angezeigt –
          anstelle des Standard-Logos.
        </p>
        <Err msg={err} />

        <div style={{ ...S.card }}>
          <Lbl>Firmenlogo</Lbl>
          {logoLoading ? (
            <p style={S.muted}>Wird geladen …</p>
          ) : (
            <>
              <div style={{
                marginTop:8, marginBottom:14, padding:'18px',
                border:'1px dashed #d6d3d1', borderRadius:10, background:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center', minHeight:90,
              }}>
                {logo
                  ? <img src={logo} alt="Logo-Vorschau" style={{ maxHeight:80, maxWidth:'100%', objectFit:'contain' }} />
                  : <span style={{ fontSize:13, color:'#a8a29e' }}>Noch kein Logo hinterlegt</span>}
              </div>

              <div style={{ background:'#f5f5f4', border:'1px solid #e7e5e4', borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, color:'#78716c', marginBottom:6 }}>So sehen es die Beitragenden:</div>
                <PartnerBanner logoUrl={logo} />
              </div>

              <p style={{ fontSize:12, color:'#78716c', margin:'0 0 12px' }}>
                PNG, JPG, SVG, WebP oder GIF · max. 1 MB. Querformat mit transparentem Hintergrund wirkt am besten.
              </p>

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <label className="secondary" style={{ fontSize:13, padding:'9px 16px', cursor:'pointer', display:'inline-block', borderRadius:8, border:'1px solid #d6d3d1' }}>
                  📁 Logo auswählen
                  <input type="file" accept="image/*" onChange={onLogoFile} style={{ display:'none' }} />
                </label>
                <button onClick={() => saveLogo(logo)} disabled={busy || !logo} style={{ fontSize:13, padding:'9px 16px' }}>
                  {busy ? 'Wird gespeichert …' : 'Speichern'}
                </button>
                <button onClick={() => saveLogo(null)} disabled={busy || !logo} className="secondary" style={{ fontSize:13, padding:'9px 16px', color:'#dc2626', borderColor:'#fecaca' }}>
                  Logo entfernen
                </button>
              </div>
              {logoSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>✓ Gespeichert.</p>}
            </>
          )}
        </div>

        <form onSubmit={saveOwnPassword} style={{ ...S.card, marginTop:'1.25rem' }}>
          <Lbl>Passwort ändern</Lbl>
          <p style={{ fontSize:12, color:'#78716c', margin:'4px 0 14px' }}>{PASSWORD_RULES_TEXT}</p>
          <Err msg={pwErr} />
          <div style={{ marginBottom:12 }}>
            <Lbl>Aktuelles Passwort</Lbl>
            <input type="password" autoComplete="current-password" value={pwForm.current}
              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:12 }}>
            <Lbl>Neues Passwort</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next}
              onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} placeholder="••••" />
          </div>
          <div style={{ marginBottom:14 }}>
            <Lbl>Neues Passwort wiederholen</Lbl>
            <input type="password" autoComplete="new-password" value={pwForm.next2}
              onChange={e => setPwForm(f => ({ ...f, next2: e.target.value }))} placeholder="••••" />
          </div>
          <button type="submit" disabled={busy || !pwForm.current || !pwForm.next || !pwForm.next2} style={{ fontSize:13, padding:'9px 16px' }}>
            {busy ? 'Wird geändert …' : 'Passwort ändern'}
          </button>
          {pwSaved && <p style={{ fontSize:13, color:'#16a34a', marginTop:12, marginBottom:0 }}>✓ Passwort geändert.</p>}
        </form>
      </div>
    </div>
  )

  // ── BENUTZER (nur Admin) ──
  if (view === 'audit') {
    const fmtTime = ts => { try { return new Date(ts).toLocaleString('de-DE') } catch { return ts } }
    const th = { textAlign:'left', padding:'8px 10px', fontSize:12, color:'#78716c', fontWeight:600, borderBottom:'1px solid #e7e5e4', whiteSpace:'nowrap' }
    const td = { padding:'8px 10px', fontSize:12, borderBottom:'1px solid #f5f5f4', verticalAlign:'top' }
    const actionColor = a => a === 'login.failure' ? '#b91c1c'
      : a?.endsWith('.delete') ? '#c2410c'
      : a === 'login.success' ? '#15803d' : '#1c1917'
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight:700, fontSize:16 }}>Lebenswerk Admin</span>
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
        </div>
        <div style={{ maxWidth:1000, margin:'2rem auto', padding:'0 1.5rem' }}>
          <Back onClick={() => setView('list')} />
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Audit-Log</h2>
            <button className="secondary" onClick={loadAudit} disabled={auditLoading} style={{ fontSize:12, padding:'6px 12px' }}>{auditLoading ? 'Lädt…' : 'Aktualisieren'}</button>
          </div>
          <p style={{ ...S.muted, marginBottom:'1.5rem' }}>Sicherheitsrelevante Aktionen (neueste zuerst, max. 200). Aufbewahrung 365 Tage.</p>
          <Err msg={err} />
          <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Zeit</th><th style={th}>Aktion</th><th style={th}>Akteur</th>
                  <th style={th}>Ziel</th><th style={th}>IP</th><th style={th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {auditData.entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace:'nowrap', color:'#78716c' }}>{fmtTime(e.created_at)}</td>
                    <td style={{ ...td, fontWeight:600, color:actionColor(e.action) }}>{e.action}</td>
                    <td style={td}>{e.actor_name || (e.actor_uid ? e.actor_uid.slice(0,8) : '—')}{e.is_admin ? ' (Admin)' : ''}</td>
                    <td style={{ ...td, fontFamily:'monospace' }}>{e.target || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#78716c' }}>{e.ip || '—'}</td>
                    <td style={{ ...td, fontFamily:'monospace', color:'#78716c', maxWidth:220, wordBreak:'break-all' }}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditData.entries.length === 0 && <p style={{ ...S.muted, padding:'16px' }}>{auditLoading ? 'Lädt…' : 'Noch keine Einträge.'}</p>}
          </div>
        </div>
      </div>
    )
  }

  if (view === 'users') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => setView('list')} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Benutzer</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Pro Benutzer legen Sie fest, welche Produktkategorien er anlegen darf.</p>
        <Err msg={err} />

        {/* Bestehende Benutzer */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:24 }}>
          {usersData.users.map(u => (
            <div key={u.id} style={{ ...S.card }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:12, flexWrap:'wrap' }}>
                <div>
                  <strong style={{ fontSize:15 }}>{u.username}</strong>
                  {u.is_admin && <span style={{ fontSize:11, marginLeft:8, color:'#1d4ed8' }}>Admin</span>}
                  {!u.has_password && <span style={{ fontSize:11, marginLeft:8, color:'#b45309' }}>Einladung offen</span>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {u.has_password ? (
                    <button className="secondary" onClick={() => resetUserPassword(u)} style={{ fontSize:12, padding:'5px 10px' }}>Passwort</button>
                  ) : (
                    <>
                      <button className="secondary" onClick={() => copyInviteLink(u)} style={{ fontSize:12, padding:'5px 10px' }}>Link kopieren</button>
                      <button className="secondary" onClick={() => regenerateInvite(u)} style={{ fontSize:12, padding:'5px 10px' }}>Neuer Link</button>
                    </>
                  )}
                  <button className="secondary" onClick={() => removeUser(u)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
                </div>
              </div>
              {u.is_admin ? (
                <p style={{ ...S.muted, fontSize:12, margin:0 }}>Administrator – sieht alle Produktkategorien.</p>
              ) : (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {CATEGORY_ORDER.map(slug => {
                    const on = (u.allowed_categories || []).includes(slug)
                    return (
                      <span key={slug} onClick={() => saveUserCats(u, slug)}
                        style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                          borderColor: on ? '#1c1917' : '#e7e5e4', background: on ? '#1c1917' : '#fff', color: on ? '#fafaf9' : '#78716c' }}>
                        {CATEGORIES[slug].label}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {usersData.users.length === 0 && <p style={S.muted}>Noch keine Benutzer.</p>}
        </div>

        {/* Einladungslink des zuletzt angelegten / neu erzeugten Benutzers */}
        {createdInvite && (
          <div style={{ ...S.card, marginBottom:24, borderColor:'#bbf7d0', background:'#f0fdf4' }}>
            <Lbl>Einladungslink für „{createdInvite.username}"</Lbl>
            <p style={{ fontSize:13, color:'#3f6212', margin:'4px 0 10px' }}>
              Schicken Sie diesen Link an den Benutzer. Beim ersten Aufruf vergibt er sich selbst ein Passwort. (Der Link ist 14 Tage gültig und wurde in die Zwischenablage kopiert.)
            </p>
            {createdInvite.demo && (
              <p style={{ fontSize:12, color:'#3f6212', margin:'0 0 10px' }}>✓ {createdInvite.demo.memorials} Demo-Bücher mit {createdInvite.demo.contributions} Beiträgen angelegt.</p>
            )}
            {createdInvite.demoError && (
              <p style={{ fontSize:12, color:'#b45309', margin:'0 0 10px' }}>Hinweis: Demo-Daten konnten nicht angelegt werden ({createdInvite.demoError}).</p>
            )}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <a href={createdInvite.url} style={{ fontSize:13, wordBreak:'break-all', flex:'1 1 220px' }}>{createdInvite.url}</a>
              <button className="secondary" onClick={() => { navigator.clipboard?.writeText(createdInvite.url) }} style={{ fontSize:12, padding:'5px 10px' }}>Kopieren</button>
              <button className="secondary" onClick={() => setCreatedInvite(null)} style={{ fontSize:12, padding:'5px 10px' }}>Schließen</button>
            </div>
          </div>
        )}

        {/* Neuer Benutzer */}
        <div style={{ ...S.card }}>
          <Lbl>Neuer Benutzer</Lbl>
          <input value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="Benutzername" style={{ marginBottom:6 }} />
          <p style={{ ...S.muted, fontSize:12, margin:'0 0 12px' }}>
            Kein Passwort nötig: Nach dem Anlegen erhalten Sie einen Einladungslink, über den der Benutzer sich selbst ein Passwort vergibt.
          </p>
          <Lbl>Erlaubte Produktkategorien</Lbl>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'6px 0 14px' }}>
            {CATEGORY_ORDER.map(slug => {
              const on = userForm.cats.includes(slug)
              return (
                <span key={slug} onClick={() => toggleUserFormCat(slug)}
                  style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                    borderColor: on ? '#1c1917' : '#e7e5e4', background: on ? '#1c1917' : '#fff', color: on ? '#fafaf9' : '#78716c' }}>
                  {CATEGORIES[slug].label}
                </span>
              )
            })}
          </div>
          <label style={{ display:'flex', alignItems:'flex-start', gap:8, margin:'4px 0 16px', cursor:'pointer', fontSize:14 }}>
            <input type="checkbox" checked={userForm.demo} onChange={e => setUserForm({ ...userForm, demo: e.target.checked })} style={{ marginTop:3 }} />
            <span>
              <strong>Demo-Daten anreichern</strong>
              <span style={{ ...S.muted, display:'block', fontSize:12 }}>Legt dem Benutzer 3 Beispiel-Trauerbücher mit je 10 Beitragenden an; das erste Buch ist bereits in beiden Varianten produziert.</span>
            </span>
          </label>
          <button onClick={submitUser} disabled={busy || !userForm.username.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy ? 'Wird angelegt …' : 'Benutzer anlegen'}</button>
        </div>
      </div>
    </div>
  )

  // ── FRAGENKATALOGE (nur Admin) ──
  if (view === 'catalogs') return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
        <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
      </div>
      <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
        <Back onClick={() => { setCatalogForm(null); setView('list') }} />
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Fragenkataloge</h2>
        <p style={{ ...S.muted, marginBottom: '1.5rem' }}>
          Vordefinierte Kataloge aus Kapiteln und Fragen. Manager wählen sie beim Anlegen eines Buchs (nur für passende Produktkategorien); die KI führt das Interview dann daran entlang.
        </p>
        <Err msg={err} />

        {catalogForm ? (() => {
          const cf = catalogForm
          const setCf         = patch      => setCatalogForm(f => ({ ...f, ...patch }))
          const setChapter    = (ci, patch)=> setCatalogForm(f => { const chapters=[...f.chapters]; chapters[ci]={...chapters[ci],...patch}; return { ...f, chapters } })
          const setQuestion   = (ci,qi,val)=> setCatalogForm(f => { const chapters=[...f.chapters]; const questions=[...chapters[ci].questions]; questions[qi]=val; chapters[ci]={...chapters[ci],questions}; return { ...f, chapters } })
          const addQuestion   = ci         => setCatalogForm(f => { const chapters=[...f.chapters]; chapters[ci]={...chapters[ci],questions:[...chapters[ci].questions,'']}; return { ...f, chapters } })
          const removeQuestion= (ci,qi)    => setCatalogForm(f => { const chapters=[...f.chapters]; const questions=chapters[ci].questions.filter((_,i)=>i!==qi); chapters[ci]={...chapters[ci],questions:questions.length?questions:['']}; return { ...f, chapters } })
          const addChapter    = ()         => setCatalogForm(f => ({ ...f, chapters:[...f.chapters,{title:'',questions:['']}] }))
          const removeChapter = ci         => setCatalogForm(f => { const chapters=f.chapters.filter((_,i)=>i!==ci); return { ...f, chapters: chapters.length?chapters:[{title:'',questions:['']}] } })
          const toggleCat     = slug       => setCatalogForm(f => ({ ...f, cats: f.cats.includes(slug)?f.cats.filter(s=>s!==slug):[...f.cats,slug] }))
          return (
            <div style={{ ...S.card, marginBottom:24 }}>
              <Lbl>{cf.id ? 'Katalog bearbeiten' : 'Neuer Katalog'}</Lbl>
              <input value={cf.name} onChange={e=>setCf({ name:e.target.value })} placeholder="Name des Katalogs" style={{ marginBottom:14 }} />
              <Lbl>Produktkategorien</Lbl>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'6px 0 16px' }}>
                {CATEGORY_ORDER.map(slug => {
                  const on = cf.cats.includes(slug)
                  return (
                    <span key={slug} onClick={()=>toggleCat(slug)}
                      style={{ cursor:'pointer', fontSize:12, padding:'5px 10px', borderRadius:999, border:'1px solid',
                        borderColor: on?'#1c1917':'#e7e5e4', background: on?'#1c1917':'#fff', color: on?'#fafaf9':'#78716c' }}>
                      {CATEGORIES[slug].label}
                    </span>
                  )
                })}
              </div>
              {cf.chapters.map((ch, ci) => (
                <div key={ci} style={{ border:'1px solid #e7e5e4', borderRadius:8, padding:12, marginBottom:12 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontSize:12, color:'#78716c', fontWeight:600, whiteSpace:'nowrap' }}>Kapitel {ci+1}</span>
                    <input value={ch.title} onChange={e=>setChapter(ci,{ title:e.target.value })} placeholder="Kapitel-Titel" style={{ flex:1 }} />
                    <button className="secondary" onClick={()=>removeChapter(ci)} title="Kapitel entfernen" style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>✕</button>
                  </div>
                  {ch.questions.map((q, qi) => (
                    <div key={qi} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6, marginLeft:12 }}>
                      <span style={{ fontSize:12, color:'#a8a29e', whiteSpace:'nowrap' }}>{qi+1}.</span>
                      <input value={q} onChange={e=>setQuestion(ci,qi,e.target.value)} placeholder="Frage" style={{ flex:1 }} />
                      <button className="secondary" onClick={()=>removeQuestion(ci,qi)} title="Frage entfernen" style={{ fontSize:12, padding:'4px 9px' }}>✕</button>
                    </div>
                  ))}
                  <button className="secondary" onClick={()=>addQuestion(ci)} style={{ fontSize:12, padding:'5px 10px', marginLeft:12, marginTop:4 }}>+ Frage</button>
                </div>
              ))}
              <button className="secondary" onClick={addChapter} style={{ fontSize:13, padding:'7px 14px', marginBottom:16 }}>+ Kapitel</button>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={saveCatalog} disabled={busy || !cf.name.trim()} style={{ fontSize:14, padding:'9px 16px' }}>{busy?'Speichert …':'Speichern'}</button>
                <button className="secondary" onClick={()=>{ setCatalogForm(null); setErr('') }} style={{ fontSize:14, padding:'9px 16px' }}>Abbrechen</button>
              </div>
            </div>
          )
        })() : (
          <button onClick={newCatalog} style={{ fontSize:14, padding:'9px 16px', marginBottom:20 }}>+ Neuer Katalog</button>
        )}

        {!catalogForm && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {catalogs.map(c => (
              <div key={c.id} style={{ ...S.card }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <strong style={{ fontSize:15 }}>{c.name}</strong>
                    <span style={{ fontSize:12, color:'#78716c', marginLeft:8 }}>
                      {(c.chapters||[]).length} Kapitel · {(c.chapters||[]).reduce((n,ch)=>n+((ch.questions||[]).length),0)} Fragen
                    </span>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
                      {(c.product_categories||[]).map(slug => CATEGORIES[slug] && (
                        <span key={slug} style={{ fontSize:11, padding:'3px 8px', borderRadius:999, background:'#f5f5f4', color:'#57534e' }}>{CATEGORIES[slug].label}</span>
                      ))}
                      {(c.product_categories||[]).length===0 && <span style={{ fontSize:11, color:'#b45309' }}>keiner Kategorie zugeordnet – für Manager nicht wählbar</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="secondary" onClick={()=>editCatalog(c)} style={{ fontSize:12, padding:'5px 10px' }}>Bearbeiten</button>
                    <button className="secondary" onClick={()=>removeCatalog(c)} style={{ fontSize:12, padding:'5px 10px', color:'#dc2626', borderColor:'#fecaca' }}>Löschen</button>
                  </div>
                </div>
              </div>
            ))}
            {catalogs.length===0 && <p style={S.muted}>Noch keine Kataloge. Legen Sie einen an.</p>}
          </div>
        )}
      </div>
    </div>
  )

  // ── GERADE ERSTELLT ──
  if (view === 'created') {
    const inviteUrl = `${window.location.origin}/?code=${createdCode}`
    return (
      <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
        <div style={{ background:'#fff', borderBottom:'1px solid #e7e5e4', padding:'14px 24px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Lebenswerk Admin</span>
          <button className="secondary" onClick={logout} style={{ fontSize:13, padding:'7px 14px' }}>Abmelden</button>
        </div>
        <div style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1.5rem', textAlign:'center' }}>
          <div style={{ fontSize: 40, marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Buch erstellt</h2>
          <p style={{ ...S.muted, marginBottom: '1.5rem' }}>Teilen Sie diesen Link oder den QR-Code mit Familie und Freunden:</p>
          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <Lbl>Einladungslink</Lbl>
            <a
              href={inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', margin:'6px 0 10px', textDecoration:'underline' }}
            >{inviteUrl}</a>
            <button className="secondary" onClick={() => copyInvite(createdCode)} style={{ fontSize: 13 }}>
              {copied === createdCode ? '✓ Kopiert' : '📋 Link kopieren'}
            </button>
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <img
                src={qrCodeUrl(inviteUrl, 240)}
                alt={`QR-Code für ${inviteUrl}`}
                width={240}
                height={240}
                style={{ borderRadius:8, background:'#fff' }}
              />
              <button className="secondary" onClick={() => copyQR(createdCode)} style={{ fontSize: 13 }}>
                {copied === `qr-${createdCode}` ? '✓ QR kopiert' : '📋 QR-Code kopieren'}
              </button>
            </div>
          </div>
          <button onClick={() => loadMemorials(token)} style={{ padding: '11px 28px' }}>Zur Übersicht</button>
        </div>
      </div>
    )
  }

  // ── DETAIL ──
  if (view === 'detail') {
    const inviteUrl = `${window.location.origin}/?code=${selected.id}`
    // Auftragsdaten-Bearbeitung: Feldkonfiguration der Kategorie + Draft-Helfer.
    const oci = getCategory(selected.product_category).intake
    const od = orderDraft
    const setOd  = patch => setOrderDraft(o => ({ ...o, ...patch }))
    const setOdPa = patch => setOrderDraft(o => ({ ...o, pickupAddress: { ...o.pickupAddress, ...patch } }))
    const dash = '—'
    const orderVariant = BOOK_VARIANTS.find(v => v.value === selected.book_variant) || BOOK_VARIANTS[0]
    const orderLangLabels = (selected.languages || ['de']).map(c => (LANGUAGES.find(l => l.code === c) || { label: c }).label).join(', ')
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize: 14, color: '#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{selected.name}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="secondary" onClick={reloadContributions} disabled={loading} style={{ fontSize: 13, padding: '8px 14px' }}>
              {loading ? '…' : '↻ Aktualisieren'}
            </button>
            {contributions.length > 0 && (
              <button onClick={dlAll} style={{ fontSize: 13, padding: '8px 16px' }}>
                ⬇ Alle herunterladen ({contributions.length})
              </button>
            )}
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '2rem auto', padding: '0 1.5rem' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Beiträge</h2>
          <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1rem' }}>
            Organisator: {selected.organizer}
            {selected.gender ? ` · ${selected.gender}` : ''}
            {selected.book_variant ? ` · Buch-Variante ${selected.book_variant}` : ''}
            {selected.funeral_date ? ` · ${getCategory(selected.product_category).intake.dateLabel}: ${new Date(selected.funeral_date).toLocaleDateString('de-DE')}` : ''}
            {selected.funeral_date ? ` · Erfassung bis: ${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} Tage vorher)` : ''}
          </p>

          <div style={{ ...S.card, marginBottom: '1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <Lbl>Einladungslink (für Beitragende)</Lbl>
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display:'block', fontFamily:'monospace', fontSize:13, wordBreak:'break-all', color:'#1d4ed8', marginTop:6, textDecoration:'underline' }}
                >{inviteUrl}</a>
              </div>
              <button className="secondary" onClick={() => copyInvite(selected.id)} style={{ fontSize:13, flexShrink:0 }}>
                {copied === selected.id ? '✓ Kopiert' : '📋 Kopieren'}
              </button>
            </div>
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <img
                src={qrCodeUrl(inviteUrl, 220)}
                alt={`QR-Code für ${inviteUrl}`}
                width={220}
                height={220}
                style={{ borderRadius:8, background:'#fff' }}
              />
              <button className="secondary" onClick={() => copyQR(selected.id)} style={{ fontSize: 13 }}>
                {copied === `qr-${selected.id}` ? '✓ QR kopiert' : '📋 QR-Code kopieren'}
              </button>
            </div>
          </div>

          <Err msg={err} />
          {loading ? (
            <p style={{ color: '#78716c', fontSize: 14 }}>Wird geladen …</p>
          ) : (<>
            {selected.purge_info ? (
              <div style={{ ...S.card, marginBottom:'1.5rem', background:'#fffbeb', borderColor:'#fde68a' }}>
                <div style={{ fontWeight:600, marginBottom:6 }}>🗄 Beiträge gelöscht (Aufbewahrungsfrist)</div>
                <p style={{ ...S.muted, fontSize:13, margin:'0 0 10px' }}>
                  Am {new Date(selected.purge_info.purged_at).toLocaleString('de-DE')} wurden die einzelnen Beiträge gemäß Aufbewahrungsfrist gelöscht. Das Buch bleibt vollständig erhalten (Ansehen &amp; Download weiterhin möglich).
                </p>
                {(selected.purge_info.contributions || []).length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {selected.purge_info.contributions.map((t, ti) => (
                      <div key={ti} style={{ fontSize:13, color:'#57534e', borderTop:'1px solid #fde68a', paddingTop:6 }}>
                        Beitrag #{ti + 1} — gelöscht am {new Date(t.deleted_at).toLocaleString('de-DE')} · {t.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : contributions.length === 0 ? (
              <div style={{ ...S.card, textAlign:'center', padding:'1.5rem', marginBottom:'1.5rem' }}>
                <p style={S.muted}>Noch keine Beiträge für dieses Buch.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom:'1.5rem' }}>
              {contributions.map((c, i) => {
                const answerCount = c.messages.filter(m => m.role === 'user').length
                return (
                  <div
                    key={i}
                    onClick={() => { setSelectedContrib(c); setView('contribution') }}
                    style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor:'pointer', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: '#1d4ed8', flexShrink: 0 }}>
                        {c.contributor_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{c.contributor_name}</div>
                        <div style={{ fontSize: 13, color: '#78716c' }}>
                          {c.relationship} · {new Date(c.created_at).toLocaleDateString('de-DE')} · {answerCount} Antwort{answerCount !== 1 ? 'en' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); dlOne(c) }}
                        className="secondary"
                        style={{ fontSize: 13, padding: '8px 16px' }}
                      >
                        ⬇ Herunterladen
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteContribution(c) }}
                        className="secondary"
                        title="Beitrag löschen"
                        style={{ fontSize: 15, padding: '8px 12px', color: '#dc2626' }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )
              })}
              </div>
            )}

            <ManagerPhotos
              code={selected.id}
              token={token}
              uploads={selected.uploaded_images}
              onChange={next => setSelected(s => ({ ...s, uploaded_images: next }))}
            />

            <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Buch & {GENERATORS.eulogy.label}</h3>
            {(() => {
              const variant = BOOK_VARIANTS.find(v => v.value === selected.book_variant) || BOOK_VARIANTS[0]
              return (
                <div style={{ ...S.card, marginBottom:'1rem', background:'#f5f5f4', borderColor:'#e7e5e4' }}>
                  <Lbl>Gewählte Buch-Variante</Lbl>
                  <div style={{ fontWeight:600, fontSize:15, margin:'4px 0 2px' }}>{variant.title}</div>
                  <p style={{ ...S.muted, fontSize:13, margin:0 }}>{variant.sub}</p>
                  {selected.note && (
                    <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e7e5e4' }}>
                      <Lbl>Bemerkung</Lbl>
                      <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', margin:'4px 0 0', whiteSpace:'pre-wrap' }}>{selected.note}</p>
                    </div>
                  )}
                  {selected.pickup_address && (
                    <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e7e5e4' }}>
                      <Lbl>Sammelbestellungs-Adresse</Lbl>
                      <p style={{ fontSize:14, lineHeight:1.6, color:'#44403c', margin:'4px 0 0' }}>
                        {[
                          selected.pickup_address.name,
                          selected.pickup_address.addon,
                          selected.pickup_address.street,
                          [selected.pickup_address.zip, selected.pickup_address.city].filter(Boolean).join(' '),
                          selected.pickup_address.country,
                        ].filter(Boolean).map((line, i) => <span key={i}>{line}<br /></span>)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:'1.5rem' }}>
              {[
                { key:'book_v1', icon:'📄', title:GENERATORS.book_v1.label, sub:'Jede Person als eigenes Kapitel (Ich-Form, fließender Text).' },
                { key:'book_v2', icon:'✨', title:GENERATORS.book_v2.label, sub:'KI webt alle Beiträge zu einem stimmigen, literarischen Text.' },
                { key:'eulogy',  icon:'🕯', title:GENERATORS.eulogy.label,  sub:`KI verfasst einen persönlichen Text (${GENERATORS.eulogy.noun}) zum Vorlesen.` },
              ].map(({ key, icon, title, sub }) => {
                const gen   = GENERATORS[key]
                const has   = !!selected[gen.field]
                const busy  = !!generating[key] && genOwner[key] === selected.id
                const report = selected.content_reports?.[gen.field]
                const totalFindings = report?.findings?.length || 0
                const openFindings = report?.findings?.filter(f => f.status !== 'resolved').length || 0
                return (
                  <div key={key} style={{ ...S.card }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:600, marginBottom:4 }}>{icon} {title}</div>
                        <p style={{ ...S.muted, fontSize:13, margin:0 }}>{sub}</p>
                      </div>
                      {has && !busy && <span style={{ fontSize:11, color:'#16a34a', background:'#dcfce7', padding:'3px 8px', borderRadius:6, whiteSpace:'nowrap' }}>✓ Generiert</span>}
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} disabled={busy || contributions.length === 0} style={{ fontSize:13, padding:'8px 14px' }}>
                        {busy ? 'Wird generiert …' : has ? '↻ Neu generieren' : '✨ Generieren'}
                      </button>
                      <button onClick={() => { setEditMode(false); setEditDraft(null); setView(gen.view) }} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        👁 Ansehen/Bearbeiten
                      </button>
                      <button onClick={() => downloadGenerated(key)} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        ⬇ Download .docx
                      </button>
                      {gen.kind === 'book' && (
                        <button onClick={() => downloadGeneratedPdf(key)} disabled={!has || busy} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          🖨 Druck-PDF
                        </button>
                      )}
                      {gen.kind === 'book' && (
                        <button onClick={() => openImgEdit(key)} disabled={!has || busy || !bookHasImages(selected[gen.field])} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                          🖼 Bilder überarbeiten
                        </button>
                      )}
                      <button onClick={() => recheck(key)} disabled={!has || busy || reviewingKey === key} className="secondary" style={{ fontSize:13, padding:'8px 14px' }}>
                        {reviewingKey === key ? 'Prüft …' : '🛡 Prüfung wiederholen'}
                      </button>
                    </div>
                    {busy && (
                      <div style={{ marginTop:10 }}>
                        {genPct[key] != null && (
                          <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                            <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                          </div>
                        )}
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>
                          {genPct[key] != null ? `${genPct[key]} % · ` : ''}{genProgress[key] || 'Wird generiert …'}
                        </p>
                        <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:12, padding:'5px 10px', marginTop:8, color:'#b91c1c', borderColor:'#fecaca' }}>
                          ✕ Abbrechen
                        </button>
                      </div>
                    )}
                    {!busy && genErr[key] && genOwner[key] === selected.id && (
                      <div style={{ marginTop:10 }}><Err msg={genErr[key]} /></div>
                    )}
                    {reviewingKey === key && (
                      <div style={{ marginTop:10 }}>
                        <div style={{ height:6, background:'#e7e5e4', borderRadius:999, overflow:'hidden', marginBottom:6 }}>
                          <div style={{ width:`${reviewPct}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                        </div>
                        <p style={{ fontSize:12, color:'#78716c', margin:0 }}>🛡 Inhaltsprüfung läuft … {reviewPct} %</p>
                      </div>
                    )}
                    {gen.kind === 'book' && (
                      <label style={{ display:'inline-flex', alignItems:'center', gap:8, marginTop:10, fontSize:12, color:'#78716c', cursor:'pointer' }}>
                        <input type="checkbox" checked={skipImages} onChange={e => setSkipImages(e.target.checked)} style={{ width:16, height:16, flexShrink:0, margin:0, cursor:'pointer' }} />
                        🐞 Bilder überspringen (schneller – für Tests)
                      </label>
                    )}
                    {has && !busy && report && (
                      <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid #f5f5f4' }}>
                        {report.error ? (
                          <span style={{ fontSize:12, color:'#b45309' }}>⚠ Inhaltsprüfung fehlgeschlagen.{' '}
                            <button className="ghost" onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:12, padding:0, textDecoration:'underline' }}>Details</button>
                          </span>
                        ) : openFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} style={{ fontSize:13, padding:'7px 12px', background:'#b91c1c' }}>
                            🛡 Prüfbericht ansehen ({openFindings} offen{totalFindings > openFindings ? `, ${totalFindings - openFindings} erledigt` : ''})
                          </button>
                        ) : totalFindings > 0 ? (
                          <button onClick={() => setReportModal({ title, field: gen.field, report })} className="secondary" style={{ fontSize:13, padding:'7px 12px', color:'#15803d', borderColor:'#bbf7d0' }}>
                            ✓ Alle {totalFindings} Befunde bearbeitet – Bericht ansehen
                          </button>
                        ) : (
                          <span style={{ fontSize:12, color:'#15803d' }}>🛡 Inhaltsprüfung durchgeführt – keine kritischen Aussagen gefunden.</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>)}

          <div style={S.divider} />

          {/* ── Auftragsdaten (Stammdaten) — selten gebraucht, daher unten ── */}
          <div style={{ ...S.card, marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom: orderEdit ? 16 : 4 }}>
              <h3 style={{ fontSize:16, fontWeight:600, margin:0 }}>Auftragsdaten</h3>
              {!orderEdit && (
                <button className="secondary" onClick={startOrderEdit} style={{ fontSize:13, padding:'8px 14px' }}>✎ Bearbeiten</button>
              )}
            </div>

            {!orderEdit ? (
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', columnGap:18, rowGap:8, fontSize:14 }}>
                {[
                  [oci.subjectLabel || 'Name', selected.name || dash],
                  ['Organisator', selected.organizer || dash],
                  ...(oci.useGender ? [['Geschlecht', selected.gender || dash]] : []),
                  ...((oci.extra || []).map(f => [f.label, selected.intake?.[f.key] || dash])),
                  ...(oci.useDate ? [[oci.dateLabel, selected.funeral_date ? new Date(selected.funeral_date).toLocaleDateString('de-DE') : dash]] : []),
                  ...(oci.useCutoff ? [['Erfassung bis', selected.funeral_date ? `${cutoffString(selected.funeral_date, cutoffDays(selected))} (${cutoffDays(selected)} Tage vorher)` : `${cutoffDays(selected)} Tage vorher`]] : []),
                  ['Sprachen', orderLangLabels],
                  ['Buch-Variante', orderVariant.title],
                  ...(selected.product_category === 'memorial' ? [['Einführungsvideo', selected.show_intro_video !== false ? 'Ja' : 'Nein']] : []),
                  ['Bemerkung', selected.note || dash],
                  ['Sammelbestellungs-Adresse', selected.pickup_address
                    ? [selected.pickup_address.name, selected.pickup_address.addon, selected.pickup_address.street,
                       [selected.pickup_address.zip, selected.pickup_address.city].filter(Boolean).join(' '),
                       selected.pickup_address.country].filter(Boolean).join(', ')
                    : dash],
                ].map(([label, val], i) => (
                  <Fragment key={i}>
                    <div style={{ color:'#78716c', whiteSpace:'nowrap' }}>{label}</div>
                    <div style={{ color:'#44403c', whiteSpace:'pre-wrap' }}>{val}</div>
                  </Fragment>
                ))}
              </div>
            ) : od && (
              <div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>{oci.subjectLabel || 'Name'} *</Lbl>
                  <input value={od.name} onChange={e => setOd({ name: e.target.value })} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Organisator *</Lbl>
                  <input value={od.organizer} onChange={e => setOd({ organizer: e.target.value })} />
                </div>
                {oci.useGender && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.genderLabel}</Lbl>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                      {GENDERS.map(g => (
                        <div key={g.value} onClick={() => setOd({ gender: g.value })}
                          style={{ ...S.card, cursor:'pointer', textAlign:'center', padding:'12px 8px',
                            borderColor: od.gender === g.value ? '#1c1917' : '#e7e5e4', borderWidth: od.gender === g.value ? 2 : 1,
                            fontSize:14, fontWeight: od.gender === g.value ? 600 : 400 }}>
                          {g.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(oci.extra || []).map(f => (
                  <div key={f.key} style={{ marginBottom:14 }}>
                    <Lbl>{f.label}</Lbl>
                    <input value={od.intake?.[f.key] || ''} onChange={e => setOd({ intake: { ...od.intake, [f.key]: e.target.value } })} placeholder={f.placeholder || ''} />
                  </div>
                ))}
                {oci.useDate && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.dateLabel}</Lbl>
                    <input type="date" value={od.funeralDate} onChange={e => setOd({ funeralDate: e.target.value })} />
                  </div>
                )}
                {oci.useCutoff && (
                  <div style={{ marginBottom:14 }}>
                    <Lbl>{oci.cutoffLabel}</Lbl>
                    <input type="number" min={0} max={90} step={1} value={od.cutoffDays}
                      onChange={e => { const v = e.target.value; setOd({ cutoffDays: v === '' ? '' : Math.max(0, parseInt(v, 10) || 0) }) }} />
                    <p style={{ fontSize:12, color:'#78716c', marginTop:6 }}>
                      {od.funeralDate && Number.isFinite(parseInt(od.cutoffDays, 10))
                        ? <>Beiträge fließen bis zum <strong>{cutoffString(od.funeralDate, parseInt(od.cutoffDays, 10))}</strong> ein.</>
                        : <>Standard sind 7 Tage.</>}
                    </p>
                  </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Sprachen *</Lbl>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {LANGUAGES.map(l => {
                      const on = od.languages.includes(l.code)
                      return (
                        <label key={l.code} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', ...S.card, padding:'10px 14px',
                          borderColor: on ? '#1c1917' : '#e7e5e4', borderWidth: on ? 2 : 1 }}>
                          <input type="checkbox" checked={on}
                            onChange={() => setOrderDraft(o => {
                              const next = on ? o.languages.filter(c => c !== l.code) : [...o.languages, l.code]
                              return { ...o, languages: next.length ? next : o.languages }
                            })}
                            style={{ width:16, height:16, accentColor:'#1c1917', cursor:'pointer' }} />
                          <span style={{ fontSize:14, fontWeight: on ? 600 : 400 }}>{l.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <div style={{ marginBottom:14 }}>
                  <Lbl>Buch-Variante *</Lbl>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8 }}>
                    {BOOK_VARIANTS.map(v => (
                      <div key={v.value} onClick={() => setOd({ bookVariant: v.value })}
                        style={{ ...S.card, cursor:'pointer', padding:'14px 14px',
                          borderColor: od.bookVariant === v.value ? '#1c1917' : '#e7e5e4', borderWidth: od.bookVariant === v.value ? 2 : 1 }}>
                        <div style={{ fontWeight:600, fontSize:14, marginBottom:4 }}>{v.title}</div>
                        <div style={{ fontSize:13, color:'#78716c', lineHeight:1.5 }}>{v.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {selected.product_category === 'memorial' && (
                <div style={{ marginBottom:14 }}>
                  <Lbl>Einführungsvideo</Lbl>
                  <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', marginTop:8 }}>
                    <input type="checkbox" checked={od.showIntroVideo} onChange={e => setOd({ showIntroVideo: e.target.checked })}
                      style={{ width:18, height:18, cursor:'pointer', accentColor:'#1c1917', flexShrink:0 }} />
                    <span style={{ fontSize:14 }}>Einführungsvideo vor dem Sprach-Interview anzeigen</span>
                  </label>
                </div>
                )}
                <div style={{ marginBottom:14 }}>
                  <Lbl>Bemerkung</Lbl>
                  <textarea value={od.note} onChange={e => setOd({ note: e.target.value })} rows={3}
                    placeholder="Interne Notiz zu diesem Buch (optional)."
                    style={{ width:'100%', resize:'vertical', fontFamily:'inherit', fontSize:14 }} />
                </div>
                <div style={{ marginBottom:20 }}>
                  <Lbl>Sammelbestellungs-Adresse (optional)</Lbl>
                  <input value={od.pickupAddress.name} onChange={e => setOdPa({ name: e.target.value })} placeholder="Name / Empfänger" style={{ marginBottom:8 }} />
                  <input value={od.pickupAddress.addon} onChange={e => setOdPa({ addon: e.target.value })} placeholder="Adresszusatz (z. B. c/o, Firma)" style={{ marginBottom:8 }} />
                  <input value={od.pickupAddress.street} onChange={e => setOdPa({ street: e.target.value })} placeholder="Straße und Hausnummer" style={{ marginBottom:8 }} />
                  <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                    <input value={od.pickupAddress.zip} onChange={e => setOdPa({ zip: e.target.value })} placeholder="PLZ" style={{ flex:'0 0 120px' }} />
                    <input value={od.pickupAddress.city} onChange={e => setOdPa({ city: e.target.value })} placeholder="Ort" style={{ flex:1 }} />
                  </div>
                  <input value={od.pickupAddress.country} onChange={e => setOdPa({ country: e.target.value })} placeholder="Land" />
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={saveOrderData} disabled={orderSaving} style={{ fontSize:14, padding:'10px 20px' }}>
                    {orderSaving ? 'Wird gespeichert …' : 'Speichern'}
                  </button>
                  <button className="secondary" onClick={cancelOrderEdit} disabled={orderSaving} style={{ fontSize:14, padding:'10px 20px' }}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>

          <div style={S.divider} />
          <button
            onClick={async () => { if (await handleDelete(selected)) setView('list') }}
            disabled={deletingId === selected.id}
            className="secondary"
            style={{ fontSize:13, padding:'10px 18px', color:'#dc2626', borderColor:'#fecaca' }}
          >
            {deletingId === selected.id ? 'Wird gelöscht …' : '🗑 Dieses Buch löschen'}
          </button>
        </div>
        {eulogyStyleOverlay}
        {genLangOverlay}
        {imgEditOverlay}
        {imgZoomOverlay}
        {reportOverlay}
      </div>
    )
  }

  // ── KOSTEN-AUFSCHLÜSSELUNG ──
  if (view === 'costs' && selected) {
    const kinds = costData?.byKind ? Object.entries(costData.byKind).sort((a, b) => b[1].cost_eur - a[1].cost_eur) : []
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('list')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Kosten</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
        </div>

        <div style={{ maxWidth: 920, margin: '2rem auto', padding: '0 1.5rem' }}>
          <Err msg={err} />
          {costsLoading && <p style={S.muted}>Wird geladen …</p>}
          {!costsLoading && costData && (
            <>
              <div style={{ ...S.card, marginBottom:'1.5rem', textAlign:'center' }}>
                <Lbl>Gesamtkosten dieses Buchs</Lbl>
                <div style={{ fontSize:32, fontWeight:700, fontFamily:'Georgia,serif', marginTop:6 }}>{formatEur(costData.total_eur)}</div>
                <div style={{ fontSize:13, color:'#78716c', marginTop:4 }}>≈ {Number(costData.total_usd || 0).toFixed(4)} USD</div>
              </div>

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Aufschlüsselung nach Kategorie</h3>
              {kinds.length === 0 ? (
                <p style={S.muted}>Noch keine Kosten erfasst.</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden', marginBottom:'1.5rem' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['Kategorie', 'Calls', 'Mengen', 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {kinds.map(([k, agg]) => {
                        const units = []
                        if (agg.input_tokens || agg.output_tokens) units.push(`${agg.input_tokens.toLocaleString('de-DE')} in / ${agg.output_tokens.toLocaleString('de-DE')} out Tokens`)
                        if (agg.characters)    units.push(`${agg.characters.toLocaleString('de-DE')} Zeichen`)
                        if (agg.audio_seconds) units.push(`${Math.round(agg.audio_seconds)} Sek. Audio`)
                        if (agg.images)        units.push(`${agg.images} Bild${agg.images > 1 ? 'er' : ''}`)
                        return (
                          <tr key={k}>
                            <td style={{ ...col, fontWeight:500 }}>{costKindLabel(k)}</td>
                            <td style={{ ...col, color:'#78716c' }}>{agg.count}</td>
                            <td style={{ ...col, color:'#78716c', fontSize:13 }}>{units.join(' · ') || '—'}</td>
                            <td style={{ ...col, textAlign:'right', fontWeight:600, whiteSpace:'nowrap' }}>{formatEur(agg.cost_eur)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 style={{ fontSize:16, fontWeight:600, marginBottom:'.75rem' }}>Alle Vorgänge ({costData.events.length})</h3>
              {costData.events.length === 0 ? (
                <p style={S.muted}>Keine Einträge.</p>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e7e5e4', borderRadius:12, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        {['Zeit', 'Kategorie', 'Modell', 'Detail', 'EUR'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {costData.events.map(e => {
                        const parts = []
                        if (e.input_tokens || e.output_tokens) parts.push(`${e.input_tokens || 0} in / ${e.output_tokens || 0} out`)
                        if (e.characters)    parts.push(`${e.characters} Zeichen`)
                        if (e.audio_seconds) parts.push(`${Math.round(e.audio_seconds)} s`)
                        if (e.images) {
                          // Variante/Kapitel aus den Metadaten (sofern vorhanden)
                          const md = e.metadata || {}
                          const vlabel = md.variant === 'book_v1' ? 'V1' : md.variant === 'book_v2' ? 'V2' : null
                          const chPart = md.chapter != null
                            ? `Kapitel ${md.chapter}${md.chapter_heading ? ` – „${md.chapter_heading}"` : ''}`
                            : null
                          const seg = [vlabel, chPart].filter(Boolean).join(' · ')
                          parts.push(`${e.images} Bild${seg ? ` (${seg})` : ''}`)
                        }
                        return (
                          <tr key={e.id}>
                            <td style={{ ...col, fontSize:12, color:'#78716c', whiteSpace:'nowrap' }}>{new Date(e.created_at).toLocaleString('de-DE')}</td>
                            <td style={{ ...col }}>{costKindLabel(e.kind)}</td>
                            <td style={{ ...col, fontFamily:'monospace', fontSize:12, color:'#78716c' }}>{e.model || '—'}</td>
                            <td style={{ ...col, fontSize:12, color:'#78716c' }}>{parts.join(' · ') || '—'}</td>
                            <td style={{ ...col, textAlign:'right', fontWeight:500, whiteSpace:'nowrap' }}>{formatEur(e.cost_eur)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── EINZELNER BEITRAG ──
  if (view === 'contribution' && selectedContrib) {
    const c = selectedContrib
    const pairs = []
    for (let j = 0; j < c.messages.length; j++) {
      if (c.messages[j].role === 'assistant') {
        const hasAnswer = c.messages[j + 1]?.role === 'user'
        pairs.push({
          q: c.messages[j].content,
          a: hasAnswer ? c.messages[j + 1].content : undefined,
          indices: hasAnswer ? [j, j + 1] : [j],
        })
        if (hasAnswer) j++
      } else {
        pairs.push({ q: null, a: c.messages[j].content, indices: [j] })
      }
    }
    return (
      <div style={{ minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button className="ghost" onClick={() => setView('detail')} style={{ fontSize:14, color:'#78716c' }}>← Zurück</button>
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{c.contributor_name}</span>
              <span style={{ fontSize:13, color:'#78716c', marginLeft:10 }}>· {selected.name}</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={() => dlOne(c)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Herunterladen</button>
            <button className="secondary" onClick={() => exportContribution(c)} title="Daten dieses Beitragenden als .zip (lesbares PDF + JSON) exportieren – DSGVO Art. 15/20" style={{ fontSize:13, padding:'8px 16px' }}>⬇ DSGVO-Export</button>
            <button className="secondary" onClick={() => deleteContribution(c)} title="Beitrag löschen" style={{ fontSize:15, padding:'7px 12px', color:'#dc2626' }}>🗑</button>
            <button className="secondary" onClick={logout} style={{ fontSize: 13, padding: '7px 14px' }}>Abmelden</button>
          </div>
        </div>

        <div style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.5rem' }}>
          <div style={{ ...S.card, marginBottom:'1.5rem' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
              <div style={{ width:48, height:48, borderRadius:'50%', background:'#dbeafe', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:18, color:'#1d4ed8' }}>
                {c.contributor_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:18 }}>{c.contributor_name}</div>
                <div style={{ fontSize:13, color:'#78716c' }}>{c.relationship}</div>
              </div>
            </div>
            <div style={{ fontSize:13, color:'#57534e', lineHeight:1.8 }}>
              {c.contributor_gender && <div><span style={{ color:'#a8a29e' }}>Geschlecht:</span> {c.contributor_gender}</div>}
              {c.contributor_address && <div><span style={{ color:'#a8a29e' }}>Anrede:</span> {c.contributor_address}</div>}
              <div><span style={{ color:'#a8a29e' }}>Erstellt:</span> {new Date(c.created_at).toLocaleString('de-DE')}</div>
              <div><span style={{ color:'#a8a29e' }}>Antworten:</span> {c.messages.filter(m => m.role === 'user').length}</div>
            </div>
          </div>

          {pairs.length === 0 ? (
            <p style={S.muted}>Dieser Beitrag enthält noch keine Inhalte.</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              {pairs.map((p, j) => (
                <div key={j} style={{ ...S.card, position:'relative' }}>
                  <button
                    onClick={() => deleteMessages(c, p.indices)}
                    title="Frage & Antwort löschen"
                    className="ghost"
                    style={{ position:'absolute', top:10, right:10, fontSize:14, color:'#dc2626', padding:'4px 8px', lineHeight:1 }}
                  >
                    🗑
                  </button>
                  {p.q && (
                    <div style={{ marginBottom: p.a ? 12 : 0 }}>
                      <Lbl>Frage</Lbl>
                      <p style={{ fontSize:15, lineHeight:1.65, fontStyle:'italic', color:'#44403c', margin:'4px 0 0' }}>{p.q}</p>
                    </div>
                  )}
                  {p.a && (
                    <div>
                      <Lbl>Antwort</Lbl>
                      <p style={{ fontSize:15, lineHeight:1.7, color:'#1c1917', margin:'4px 0 0', whiteSpace:'pre-wrap' }}>{p.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── ANSEHEN (Bücher + Endtext/Rede) ──
  if (view === 'book-v1' || view === 'book-v2' || view === 'eulogy') {
    const key  = view === 'book-v1' ? 'book_v1' : view === 'book-v2' ? 'book_v2' : 'eulogy'
    const gen  = GENERATORS[key]
    const data = selected[gen.field]
    const busy = !!generating[key] && genOwner[key] === selected.id
    const bt = uiText(data?.language)
    const reviewReport = selected.content_reports?.[gen.field]
    const reviewMarks = (reviewReport?.findings || []).filter(f => f.quote && f.status !== 'resolved').map(f => ({ quote: String(f.quote), severity: f.severity }))
    const subtitle = view === 'book-v1' ? `${getCategory(selected?.product_category).nounBook} · Version 1`
                   : view === 'book-v2' ? `${getCategory(selected?.product_category).nounBook} · Version 2`
                   : GENERATORS.eulogy.label
    return (
      <div style={{ maxWidth:720, margin:'0 auto', padding:'1.5rem', paddingBottom:'4rem' }}>
        <Back onClick={() => { setEditMode(false); setEditDraft(null); setView('detail') }} />
        <div style={{ textAlign:'center', marginBottom:'2.5rem' }}>
          <p style={{ fontSize:11, letterSpacing:'.12em', textTransform:'uppercase', color:'#a8a29e', marginBottom:10 }}>{subtitle}{editMode ? ' · Bearbeiten' : ''}</p>
          <h1 style={{ fontSize:24, fontWeight:600, fontFamily:'Georgia,serif', color:'#78716c' }}>{selected.name}</h1>
        </div>

        {!busy && data && !editMode && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1.25rem' }}>
            <button onClick={() => { setEditDraft(structuredClone(data)); setEditMode(true) }} style={{ fontSize:13, padding:'8px 16px' }}>✏ Bearbeiten</button>
          </div>
        )}

        {genOwner[key] === selected.id && <Err msg={genErr[key]} />}
        <Err msg={err} />

        {busy ? (
          <div style={{ textAlign:'center', padding:'3rem 0' }}>
            <Dots />
            {genPct[key] != null && (
              <>
                <div style={{ fontSize:32, fontWeight:700, color:'#1c1917', marginTop:16 }}>{genPct[key]} %</div>
                <div style={{ maxWidth:320, height:8, background:'#e7e5e4', borderRadius:999, margin:'12px auto 0', overflow:'hidden' }}>
                  <div style={{ width:`${genPct[key]}%`, height:'100%', background:'#1c1917', transition:'width .3s' }} />
                </div>
              </>
            )}
            <p style={{ ...S.muted, marginTop:16 }}>{genProgress[key] || 'Die KI arbeitet …'}</p>
            <div style={{ marginTop:16 }}>
              <button onClick={() => cancelGenerate(key)} disabled={!!cancelGenRef.current[key]} className="secondary" style={{ fontSize:13, padding:'7px 14px', color:'#b91c1c', borderColor:'#fecaca' }}>✕ Abbrechen</button>
            </div>
          </div>
        ) : !data ? (
          <p style={{ ...S.muted, textAlign:'center', padding:'3rem 0' }}>Noch nichts generiert. Geh zurück und klicke „Generieren".</p>
        ) : editMode ? (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'1.5rem' }}>
            <p style={{ ...S.muted, fontSize:13, marginBottom:16 }}>
              Direkt im Text korrigieren (z. B. falsch verstandene Eigennamen). Änderungen werden beim Speichern übernommen. Bilder bleiben unverändert.
            </p>
            {gen.kind === 'book' && editDraft && typeof editDraft === 'object' ? (
              <>
                <Lbl>Titel</Lbl>
                <input value={editDraft.title || ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))} style={{ marginBottom:12 }} />
                <Lbl>Untertitel</Lbl>
                <input value={editDraft.subtitle || ''} onChange={e => setEditDraft(d => ({ ...d, subtitle: e.target.value }))} style={{ marginBottom:20 }} />
                {(editDraft.chapters || []).map((ch, i) => (
                  <div key={i} style={{ marginBottom:20, paddingTop:16, borderTop:'1px solid #f5f5f4' }}>
                    <Lbl>{bt.chapterLabel} {ch.number ?? i + 1} – Überschrift</Lbl>
                    <input value={ch.heading || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, heading: e.target.value } : c) }))} style={{ marginBottom:8 }} />
                    <Lbl>Text</Lbl>
                    <textarea value={ch.body || ''} onChange={e => setEditDraft(d => ({ ...d, chapters: d.chapters.map((c, idx) => idx === i ? { ...c, body: e.target.value } : c) }))} rows={Math.max(6, String(ch.body || '').split('\n').length + 2)} style={{ width:'100%', fontFamily:'inherit', fontSize:14, lineHeight:1.6, resize:'vertical' }} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <Lbl>Text</Lbl>
                <textarea value={typeof editDraft === 'string' ? editDraft : ''} onChange={e => setEditDraft(e.target.value)} rows={24} style={{ width:'100%', fontFamily:'inherit', fontSize:15, lineHeight:1.7, resize:'vertical' }} />
              </>
            )}
            <div style={{ display:'flex', gap:10, marginTop:16 }}>
              <button onClick={() => saveEdit(gen.field, editDraft)} disabled={savingEdit} style={{ fontSize:14, padding:'9px 18px' }}>{savingEdit ? 'Speichert …' : '✓ Speichern'}</button>
              <button onClick={() => { setEditMode(false); setEditDraft(null) }} disabled={savingEdit} className="ghost" style={{ fontSize:14 }}>Abbrechen</button>
            </div>
          </div>
        ) : gen.kind === 'book' ? (
          <>
            <div style={{ textAlign:'center', padding:'2rem 0 3rem', borderTop:'1px solid #e7e5e4' }}>
              <h2 style={{ fontSize:36, fontWeight:700, fontFamily:'Georgia,serif', marginBottom:12, color:'#1c1917' }}>{data.title || '—'}</h2>
              {data.subtitle && <p style={{ fontSize:18, fontStyle:'italic', color:'#78716c', fontFamily:'Georgia,serif' }}>{data.subtitle}</p>}
            </div>
            {reviewMarks.length > 0 && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginBottom:'2rem', fontSize:13, color:'#991b1b', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span>🛡 {reviewMarks.length} {reviewMarks.length === 1 ? 'Stelle' : 'Stellen'} aus der Inhaltsprüfung sind im Text farbig markiert.</span>
                <button className="secondary" onClick={() => setReportModal({ title: gen.label, field: gen.field, report: reviewReport })} style={{ fontSize:12, padding:'5px 10px' }}>Prüfbericht</button>
              </div>
            )}
            {(data.chapters || []).map((ch, i) => (
              <div key={i} style={{ marginBottom:'3rem' }}>
                <div style={{ textAlign:'center', marginBottom:'1.25rem' }}>
                  <p style={{ fontSize:11, letterSpacing:'.18em', textTransform:'uppercase', color:'#a8a29e', marginBottom:6 }}>{bt.chapterLabel} {ch.number ?? i + 1}</p>
                  <h3 style={{ fontSize:24, fontWeight:700, fontFamily:'Georgia,serif' }}>{ch.heading || ''}</h3>
                  {(() => {
                    // V1: Name + Beziehung des Beitragenden unter der Überschrift.
                    // Fallback über contribution_id für ältere Bücher ohne die Felder.
                    const src = ch.contributor_name ? ch : (contributions || []).find(x => x.id === ch.contribution_id)
                    const nm = ch.contributor_name || src?.contributor_name
                    const rel = ch.relationship || src?.relationship
                    return nm ? (
                      <p style={{ fontSize:15, fontStyle:'italic', color:'#78716c', fontFamily:'Georgia,serif', marginTop:8 }}>
                        {rel ? `${nm} – ${rel}` : nm}
                      </p>
                    ) : null
                  })()}
                </div>
                {ch.image_url ? (
                  <img
                    src={ch.image_url}
                    alt={ch.heading || ''}
                    loading="lazy"
                    onError={(e) => { console.warn('Bild-Load fehlgeschlagen:', ch.image_url); e.currentTarget.style.outline = '2px solid #ef4444' }}
                    style={{ width:'100%', height:'auto', borderRadius:8, marginBottom:'2rem', display:'block', boxShadow:'0 2px 12px rgba(0,0,0,.08)' }}
                  />
                ) : ch.image_path ? (
                  <div style={{ background:'#fef3c7', border:'1px dashed #fde68a', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78350f', fontSize:13, lineHeight:1.5 }}>
                    🖼 Bild wurde generiert und gespeichert, aber die Anzeige-URL fehlt.<br />
                    <code style={{ fontFamily:'monospace', fontSize:12 }}>{ch.image_path}</code><br />
                    <span style={{ fontSize:12, color:'#92400e' }}>(Signing schlägt fehl — Bucket-Name prüfen oder Liste neu laden)</span>
                  </div>
                ) : ch.image_prompt ? (
                  ch.image_error ? (
                    <div style={{ background:'#fef2f2', border:'1px dashed #fecaca', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#991b1b', fontSize:13, lineHeight:1.5 }}>
                      🖼 Bildgenerierung fehlgeschlagen.<br />
                      <span style={{ display:'inline-block', marginTop:6, padding:'4px 10px', background:'#fff', border:'1px solid #fecaca', borderRadius:6, fontSize:12, color:'#7f1d1d' }}>
                        {imageErrorDe(ch.image_error)}
                      </span>
                      <div style={{ fontSize:12, color:'#7f1d1d', marginTop:8 }}>Prompt war: „{ch.image_prompt}"</div>
                    </div>
                  ) : (
                    <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13, lineHeight:1.5 }}>
                      🖼 Noch kein Bild – über „🖼 Bilder überarbeiten" erzeugen.
                      <div style={{ fontSize:12, color:'#a8a29e', marginTop:8 }}>Prompt: „{ch.image_prompt}"</div>
                    </div>
                  )
                ) : (
                  <div style={{ background:'#f5f5f4', border:'1px dashed #d6d3d1', padding:'1.5rem', borderRadius:8, marginBottom:'2rem', textAlign:'center', color:'#78716c', fontSize:13 }}>
                    🖼 Kein image_prompt im Kapitel-JSON.
                  </div>
                )}
                <div style={{ fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
                  {String(ch.body || '').split('\n\n').filter(Boolean).map((p, j) => <p key={j} style={{ marginBottom:'1.4rem' }}>{highlightParagraph(p, reviewMarks)}</p>)}
                </div>
              </div>
            ))}
            {contributions.length > 0 && (
              <div style={{ marginTop:'2rem', paddingTop:'2rem', borderTop:'1px solid #e7e5e4', textAlign:'center' }}>
                <h3 style={{ fontSize:24, fontWeight:700, fontFamily:'Georgia,serif', marginBottom:'1.5rem' }}>{bt.contributorsHeading}</h3>
                {dedupeContributors(contributions).map(c => (
                  <p key={c.id} style={{ fontSize:16, lineHeight:1.7, fontFamily:'Georgia,serif', margin:'0 0 6px' }}>
                    <strong>{c.contributor_name}</strong>{c.relationship ? <span style={{ color:'#78716c' }}> — {c.relationship}</span> : null}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ borderTop:'1px solid #e7e5e4', paddingTop:'2rem', fontSize:17, lineHeight:1.9, fontFamily:'Georgia,serif' }}>
            {renderRichText(data)}
          </div>
        )}

        {!busy && data && !editMode && (
          <div style={{ marginTop:'2.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4' }}>
            <p style={{ fontSize:12, fontWeight:700, color:'#78716c', margin:'0 0 6px' }}>{BOOK_DISCLAIMER_TITLE}</p>
            {selected?.owner_logo && (
              <img src={selected.owner_logo} alt="Logo" style={{ maxHeight:64, maxWidth:'60%', objectFit:'contain', display:'block', margin:'8px 0 10px' }} />
            )}
            <p style={{ fontSize:12, color:'#a8a29e', fontStyle:'italic', lineHeight:1.6, margin:0 }}>{BOOK_DISCLAIMER}</p>
          </div>
        )}

        {!busy && data && !editMode && (
          <div style={{ marginTop:'1.5rem', paddingTop:'1.5rem', borderTop:'1px solid #e7e5e4', display:'flex', gap:10, flexWrap:'wrap' }}>
            <button onClick={() => downloadGenerated(key)} style={{ fontSize:13, padding:'8px 16px' }}>⬇ Download .docx</button>
            {gen.kind === 'book' && (
              <button className="secondary" onClick={() => downloadGeneratedPdf(key)} style={{ fontSize:13, padding:'8px 16px' }}>🖨 Druck-PDF</button>
            )}
            <button className="secondary" onClick={() => key === 'eulogy' ? setEulogyStyleModal(true) : requestGenerate(key)} style={{ fontSize:13, padding:'8px 16px' }}>↻ Neu generieren</button>
          </div>
        )}
        {eulogyStyleOverlay}
        {genLangOverlay}
        {imgEditOverlay}
        {imgZoomOverlay}
        {reportOverlay}
      </div>
    )
  }

  return null
}

// ── Rechtstexte (Impressum / Datenschutz) ─────────────────────────
// HINWEIS (intern): Der Datenschutztext ist ein fundierter Entwurf, der die
// tatsächliche Verarbeitung abbildet. Vor produktivem Verlass darauf bitte
// juristisch prüfen lassen. Verantwortliche: HealthCare Futurists GmbH.

function LegalLayout({ title, children }) {
  const back = () => { if (window.history.length > 1) window.history.back(); else window.location.href = '/' }
  return (
    <div style={{ minHeight:'100vh', background:'#fafaf9' }}>
      <div style={{ maxWidth:760, margin:'0 auto', padding:'2.5rem 1.5rem 4rem' }}>
        <button className="ghost" onClick={back} style={{ fontSize:14, color:'#78716c', marginBottom:'1rem' }}>← Zurück</button>
        <h1 style={{ fontSize:26, fontWeight:800, margin:'0 0 1.5rem' }}>{title}</h1>
        <div style={{ fontSize:15, lineHeight:1.7, color:'#44403c' }}>{children}</div>
      </div>
    </div>
  )
}

const LH = { fontSize:18, fontWeight:700, margin:'1.8rem 0 .6rem', color:'#1c1917' }

function Impressum() {
  return (
    <LegalLayout title="Impressum">
      <p><strong>Angaben gemäß § 5 DDG</strong></p>
      <p>HealthCare Futurists GmbH<br/>Stadtwaldgürtel 13<br/>50935 Köln<br/>Deutschland</p>
      <p>Zweigstelle:<br/>Walter-Schneider-Straße 11<br/>06317 Seegebiet Mansfelder Land<br/>Deutschland</p>
      <h2 style={LH}>Vertreten durch</h2>
      <p>Geschäftsführer Dr. Tobias D. Gantner</p>
      <h2 style={LH}>Kontakt</h2>
      <p>E-Mail: info@healthcarefuturists.com<br/>Telefon: +49 151 4129 6999</p>
      <h2 style={LH}>Registereintrag</h2>
      <p>Eintragung im Handelsregister.<br/>Registergericht: Amtsgericht Köln<br/>Registernummer: HRB 91294</p>
      <h2 style={LH}>Umsatzsteuer-Identifikationsnummer</h2>
      <p>USt-IdNr. gemäß § 27a UStG: DE291805257</p>
      <h2 style={LH}>Verantwortlich für den Inhalt</h2>
      <p>gemäß § 18 Abs. 2 MStV: Dr. Tobias D. Gantner, Anschrift wie oben.</p>
      <h2 style={LH}>Haftung für die erstellten Bücher und Inhalte</h2>
      <p>{BOOK_DISCLAIMER}</p>
      <p>
        Die mit dieser Anwendung erstellten Bücher und Reden beruhen ausschließlich auf den Angaben
        der Beitragenden. Für Aktualität, Vollständigkeit und Richtigkeit dieser Inhalte übernehmen
        wir keine Gewähr. Eine Haftung für Schäden, die aus der Nutzung oder Weitergabe der erstellten
        Inhalte entstehen, ist – soweit gesetzlich zulässig – ausgeschlossen.
      </p>
    </LegalLayout>
  )
}

function Datenschutz() {
  return (
    <LegalLayout title="Datenschutzerklärung">
      <p style={{ color:'#78716c' }}>Stand: 22. Juni 2026 · Fassung {CONSENT_VERSION}</p>

      <h2 style={LH}>1. Verantwortlicher</h2>
      <p>
        Verantwortlich für die Datenverarbeitung im Sinne der DSGVO ist:<br/>
        HealthCare Futurists GmbH, Stadtwaldgürtel 13, 50935 Köln, Deutschland<br/>
        Geschäftsführer: Dr. Tobias D. Gantner<br/>
        E-Mail: info@healthcarefuturists.com · Telefon: +49 151 4129 6999
      </p>

      <h2 style={LH}>2. Worum es geht</h2>
      <p>
        Mit dieser Anwendung erstellen wir ein persönliches Buch oder eine Rede zu einem besonderen
        Anlass – etwa zum Gedenken an eine verstorbene Person, zu einem Geburtstag, Jubiläum,
        Abschied oder zur Geburt eines Kindes. Dazu führen nahestehende Personen ein sprach- oder
        textbasiertes Interview, aus dessen Inhalten ein persönlicher Text entsteht. Die erstellten
        Bücher und Reden geben die persönlichen Schilderungen der Beitragenden wieder; ihre
        inhaltliche Richtigkeit können wir nicht überprüfen (siehe Haftungsausschluss im Impressum).
      </p>

      <h2 style={LH}>3. Welche Daten wir verarbeiten</h2>
      <p>
        Von Ihnen als beitragender Person: Name, Beziehung zu der Person, um die es geht, Geschlecht,
        gewünschte Anrede, Ihre Stimmaufnahmen während des Interviews sowie deren Verschriftlichung
        und sämtliche Interview-Inhalte. Diese Inhalte können <strong>besondere Kategorien
        personenbezogener Daten</strong> enthalten (Art. 9 DSGVO), insbesondere Angaben zu Gesundheit,
        ggf. religiöse oder weltanschauliche Angaben und – je nach Anlass – Angaben zu den Umständen
        (etwa eines Todesfalls). Technisch fallen zudem Zeitstempel und die Protokollierung Ihrer
        Einwilligung an.
      </p>

      <h2 style={LH}>4. Rechtsgrundlage</h2>
      <p>
        Wir verarbeiten diese Daten ausschließlich auf Grundlage Ihrer <strong>ausdrücklichen
        Einwilligung</strong> (Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2 lit. a DSGVO). Die Einwilligung
        ist freiwillig; ohne sie können wir das gewünschte Buch bzw. die Rede nicht erstellen. Sie können Ihre
        Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, ohne dass die Rechtmäßigkeit
        der bis dahin erfolgten Verarbeitung berührt wird (siehe Abschnitt 8).
      </p>

      <h2 style={LH}>5. KI-Verarbeitung und Empfänger</h2>
      <p>
        Zur Verarbeitung setzen wir Dienstleister als Auftragsverarbeiter ein:
      </p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li><strong>Microsoft Azure</strong> (Azure OpenAI, Azure AI Speech) – KI-gestützte Interviewführung, Texterstellung, Sprachausgabe (Text-to-Speech) und Spracherkennung (Transkription); Verarbeitung in der EU.</li>
        <li><strong>Black Forest Labs</strong> (FLUX) über Microsoft Azure – KI-gestützte Bilderzeugung; Verarbeitung in der EU.</li>
        <li><strong>Supabase</strong> – Speicherung von Datenbank- und Bildinhalten; EU (Frankfurt).</li>
        <li><strong>Vercel</strong> – Betrieb und Auslieferung der Anwendung; Funktionsregion Frankfurt (EU).</li>
      </ul>
      <p>
        Sämtliche KI-Verarbeitung (Interviewführung, Texterstellung, Sprachausgabe,
        Spracherkennung und Bilderzeugung) sowie die Datenspeicherung erfolgen
        <strong> ausschließlich in der EU</strong>. Eine Übermittlung in ein Drittland
        außerhalb der EU bzw. des EWR findet nicht statt. Mit den eingesetzten
        Auftragsverarbeitern bestehen Verträge zur Auftragsverarbeitung nach
        <strong> Art. 28 DSGVO</strong>; die übermittelten Inhalte werden nicht zum Training
        der KI-Modelle verwendet. Eine automatisierte Entscheidung mit rechtlicher Wirkung
        Ihnen gegenüber findet nicht statt.
      </p>

      <h2 style={LH}>6. Speicherdauer</h2>
      <p>
        Wir löschen die zu einem Buch gehörenden personenbezogenen Daten automatisch
        <strong> 90 Tage nach dem hinterlegten Anlass-Termin</strong> (z. B. Bestattung, Feier oder
        Verabschiedung; ist kein Termin hinterlegt, 90 Tage nach Anlage des Buchs). Auf Ihren Wunsch
        löschen wir Ihre Daten auch früher.
      </p>

      <h2 style={LH}>7. Ihre Rechte</h2>
      <p>Ihnen stehen gegenüber uns folgende Rechte zu:</p>
      <ul style={{ margin:'0 0 1rem', paddingLeft:'1.2rem' }}>
        <li>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),</li>
        <li>Datenübertragbarkeit (Art. 20) – wir stellen Ihre Daten auf Anfrage als maschinenlesbare Datei bereit,</li>
        <li>Widerspruch (Art. 21) sowie Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3).</li>
      </ul>
      <p>Zur Ausübung genügt eine Nachricht an info@healthcarefuturists.com.</p>

      <h2 style={LH}>8. Widerruf der Einwilligung</h2>
      <p>
        Sie können Ihre Einwilligung jederzeit widerrufen – formlos per E-Mail an
        info@healthcarefuturists.com. Nach einem Widerruf stellen wir die weitere Verarbeitung ein
        und löschen Ihre Daten, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.
      </p>

      <h2 style={LH}>9. Beschwerderecht</h2>
      <p>
        Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Für uns
        zuständig ist die Landesbeauftragte für Datenschutz und Informationsfreiheit
        Nordrhein-Westfalen (LDI NRW), Postfach 20 04 44, 40102 Düsseldorf.
      </p>
    </LegalLayout>
  )
}

function LegalFooter() {
  const a = { color:'#57534e', margin:'0 10px', textDecoration:'none' }
  return (
    <footer style={{ borderTop:'1px solid #e7e5e4', padding:'18px 1.5rem', textAlign:'center', fontSize:13, color:'#78716c', background:'#fafaf9' }}>
      <a href="/#datenschutz" target="_blank" rel="noopener noreferrer" style={a}>Datenschutzerklärung</a>
      <span style={{ color:'#d6d3d1' }}>·</span>
      <a href="/#impressum" target="_blank" rel="noopener noreferrer" style={a}>Impressum</a>
    </footer>
  )
}

// ── Haupt-App ─────────────────────────────────────────────────────
// ── Einladungs-Flow (Aufruf per ?invite=TOKEN) ────────────────────
// Ein neu angelegter Benutzer vergibt sich hier beim ersten Aufruf selbst ein
// Passwort. Bei Erfolg wird er direkt eingeloggt und ins Admin-Dashboard
// weitergeleitet.
function InviteFlow({ token }) {
  const [status, setStatus]     = useState('loading') // loading|ready|invalid
  const [username, setUsername] = useState('')
  const [pw, setPw]             = useState('')
  const [pw2, setPw2]           = useState('')
  const [err, setErr]           = useState('')
  const [busy, setBusy]         = useState(false)

  useEffect(() => {
    let alive = true
    getInvite(token)
      .then(d => { if (alive) { setUsername(d.username || ''); setStatus('ready') } })
      .catch(e => { if (alive) { setErr(e.message); setStatus('invalid') } })
    return () => { alive = false }
  }, [token])

  async function submit(e) {
    e.preventDefault()
    const pErr = passwordError(pw)
    if (pErr) { setErr(pErr); return }
    if (pw !== pw2) { setErr('Die beiden Passwörter stimmen nicht überein.'); return }
    setErr(''); setBusy(true)
    try {
      const d = await redeemInvite(token, pw)
      sessionStorage.setItem('lw_admin_token', d.token)
      sessionStorage.setItem('lw_admin_auth', JSON.stringify({
        admin: Boolean(d.admin), cats: d.cats ?? [], uid: d.uid ?? null, username: d.username || username,
      }))
      // Ohne ?invite neu laden – das Dashboard liest den Token aus sessionStorage.
      window.location.href = '/'
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  const card = { width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }
  const wrap = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', padding: '1rem' }

  if (status === 'loading') return <div style={wrap}><div style={card}><p style={{ ...S.muted, margin: 0 }}>Einladung wird geprüft …</p></div></div>

  if (status === 'invalid') return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Einladung ungültig</h1>
        <Err msg={err} />
        <p style={{ ...S.muted, marginTop: 12, marginBottom: 0 }}>Bitte fordern Sie bei Ihrem Administrator einen neuen Einladungslink an.</p>
      </div>
    </div>
  )

  const okPw = !passwordError(pw)
  return (
    <div style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Willkommen{username ? `, ${username}` : ''}</h1>
        <p style={{ fontSize: 14, color: '#78716c', marginBottom: '1.5rem' }}>Bitte vergeben Sie ein Passwort für Ihr Konto.</p>
        <Err msg={err} />
        <div style={{ marginBottom: 12 }}>
          <Lbl>Neues Passwort</Lbl>
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Lbl>Passwort wiederholen</Lbl>
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 16, color: !pw ? '#78716c' : (okPw ? '#15803d' : '#b91c1c') }}>
          {!pw ? '' : (okPw ? '✓ ' : '• ')}{PASSWORD_RULES_TEXT}
        </p>
        <button type="submit" disabled={busy || !okPw || pw !== pw2} style={{ width: '100%', padding: 12, fontSize: 15 }}>
          {busy ? 'Wird gespeichert …' : 'Passwort festlegen & anmelden'}
        </button>
      </form>
    </div>
  )
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const route = hash.replace(/^#/, '')
  if (route === 'impressum')  return <Impressum />
  if (route === 'datenschutz') return <Datenschutz />

  return (
    <>
      <style>{`
        @keyframes lw-dot { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes lw-spin { to{transform:rotate(360deg)} }
        @keyframes lw-mic  { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.3)} 50%{box-shadow:0 0 0 14px rgba(239,68,68,0)} }
      `}</style>
      {inviteFromURL ? <InviteFlow token={inviteFromURL} />
        : codeFromURL ? <ContributorFlow code={codeFromURL} />
        : <Dashboard />}
      <LegalFooter />
    </>
  )
}
