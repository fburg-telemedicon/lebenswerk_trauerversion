// src/precautionExport.js
// Die VORSORGEN-MAPPE der Produktkategorie „Vorsorgevollmacht" (`precaution`).
//
// Deterministischer Renderer: Er zeichnet ausschließlich, was in der Spalte
// `precaution` steht (erzeugt von precautionSystem in src/precaution.js). Kein
// KI-Aufruf, keine Interpretation — ein erneuter Download kostet nichts und
// liefert Zeichen für Zeichen dasselbe Dokument.
//
// AUFBAU — acht Urkunden nach der „VORSORGEN! Mappe" der Deutschen
// PalliativStiftung (13. Auflage, Rechtslage 2026):
//
//   Prüfliste  ZUERST. Jede übernommene Angabe mit dem Zitat, aus dem sie
//              stammt. Nicht Bestandteil der Urkunden.
//   Teil 1     Vorsorgevollmacht
//   Teil 2     Betreuungsverfügung
//   Teil 3     Patientenverfügung
//   Teil 4     Meine Wertvorstellungen
//   Teil 5     Bestattungsverfügung
//   Teil 6     Palliativ-Ampel (ein Blatt fürs Patientenzimmer)
//   Teil 7     Untervollmacht (Vordruck)
//   Teil 8     Vertreterverfügung (Vordruck)
//   Beiblatt   Belehrungen, offene Punkte, Checkliste. Zum Abtrennen.
//
// EINE ABWEICHUNG VON DER VORLAGE, BEWUSST: Dort steht die Betreuungsverfügung
// an siebter Stelle. Hier folgt sie unmittelbar auf die Vollmacht, weil sie
// deren Rückfallebene ist — sie greift genau dann, wenn die Vollmacht nicht
// greift. Wer die Mappe durchblättert, soll das in dieser Reihenfolge lesen.
//
// WARUM JEDER TEIL AUF EINER EIGENEN SEITE BEGINNT und seine Seiten selbst
// zählt („Teil 1 · Seite 2 von 4", footerSections in legalForms.js): Die Teile
// werden verschiedenen Leuten vorgelegt — die Vollmacht der Bank, die
// Patientenverfügung der Klinik, die Ampel hängt am Bett. Ein durchlaufendes
// Dokument würde erzwingen, immer alles herauszugeben.
//
// ZWEI DINGE, DIE DIESER RENDERER ANDERS MACHT ALS src/powerOfAttorney.js:
//
//  1. ER FÜLLT AUS. Namen, Geburtsdaten, Anschriften und Kreuze stehen im
//     Dokument, weil der Mensch sie im Gespräch ausdrücklich für dieses
//     Dokument diktiert hat. In der Vorsorgemappe des Lebenswerks bleiben
//     dieselben Felder leer — dort werden sie aus einer Lebensgeschichte
//     erschlossen, und eine Schlussfolgerung darf keine Vollmacht erteilen.
//
//  2. ER KENNT DREI ZUSTÄNDE. `true` kreuzt „Ja" an, `false` kreuzt „Nein" an,
//     `null` lässt BEIDE leer. Nicht festgelegt ist nicht dasselbe wie
//     abgelehnt, und ein falsches Kreuz bei „Nein" würde im Ernstfall befolgt.

import { loadPdfFonts } from './pdfFonts.js'
import { newForm, strList, wishList, INK, SOFT, AMBER, BLUE, RED, PAGE } from './legalForms.js'
import {
  VORSORGE_AREAS, VORSORGE_SPECIAL, VORSORGE_EXTRAS,
  PV_SITUATIONS, PV_MEASURES, AMPEL_STUFEN, AMPEL_MEASURES,
} from './precaution.js'

// ── kleine Helfer ─────────────────────────────────────────────────

const str = v => String(v ?? '').trim()

// Tri-State normalisieren. Alles außer echtem true/false ist „nicht festgelegt".
// Insbesondere: '', 'ja', 0, 'unbekannt' → null. Die KI ist angewiesen, echte
// Booleans zu liefern; dieses Netz fängt den Tag ab, an dem sie es nicht tut.
const tri = v => (v === true ? true : v === false ? false : null)

// Die Bereiche der Vollmacht kommen als Liste ODER als Objekt — beides annehmen.
function areaOf(data, key) {
  const src = data?.poa?.areas
  if (Array.isArray(src)) return src.find(a => a?.key === key) || {}
  if (src && typeof src === 'object') return src[key] || {}
  return {}
}

// Eine Person aus dem JSON in die Form bringen, in der das Formular sie braucht.
function personOf(p) {
  return {
    name: str(p?.name), birthdate: str(p?.birthdate), address: str(p?.address),
    phone: str(p?.phone), email: str(p?.email), relation: str(p?.relation),
    spoken_to: tri(p?.spoken_to),
  }
}
const personList = (v, limit = 4) => (Array.isArray(v) ? v : []).map(personOf).slice(0, limit)
const hasPerson = p => !!(p && (p.name || p.address || p.phone || p.email))

// Kontaktzeile aus Telefon und E-Mail — die Formulare führen beide in EINER
// Zeile, und zwei halbleere Zeilen sehen nach fehlenden Angaben aus.
const contactLine = p => [p.phone, p.email].filter(Boolean).join(' · ')

// Ein Personenblock, wie ihn die PalliativStiftung-Formulare überall zeigen.
function drawPerson(t, p, { withRelation = true, withBirth = true } = {}) {
  t.field('Name, Vorname', p.name)
  if (withBirth) t.field('Geburtsdatum', p.birthdate)
  t.field('Anschrift', p.address)
  t.field('Telefon / E-Mail', contactLine(p))
  if (withRelation) t.field('Verhältnis zu mir', p.relation)
}

// Überschrift eines Mappenteils. Immer als erstes auf einer frischen Seite.
function partHead(t, no, title, sub) {
  t.text(`TEIL ${no} · ${title}`, { size: 18, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  if (sub) t.text(sub, { size: 10.5, color: SOFT, gapAfter: 3 })
  t.rule([120, 120, 120], 0.6)
}

// Der Entwurfshinweis, der in JEDER Urkunde steht. Ohne ihn könnte ein
// unfertiger Ausdruck für eine fertige Urkunde gehalten werden — und er ist
// der einzige erklärende Satz, der in den Urkunden bleiben darf.
function draftNote(t) {
  t.text('Entwurf zur eigenen Prüfung. Wirksam erst mit eigenhändiger Unterschrift. Alle Angaben stammen aus einem Vorsorgegespräch und sind vor der Unterschrift anhand der Prüfliste am Anfang dieser Mappe zu kontrollieren.', { size: 9, color: AMBER, gapAfter: 4 })
}

// Freie Zeilen für Ergänzungen von Hand — aber nur, wenn nichts dasteht.
// Sonst schiebt sich unter jede ausgefüllte Angabe eine leere Linie, und das
// Dokument sieht aus, als wäre es nicht fertig.
function linesOrText(t, items, n = 3) {
  const list = strList(items)
  if (list.length) { for (const x of list) t.bullet(x) }
  else t.blankLines(n)
}

// ════════════════════════════════════════════════════════════════
// Deckblatt
// ════════════════════════════════════════════════════════════════

function drawCover(t, d, memorial) {
  const name = str(d?.person?.name) || str(memorial?.name)

  t.gap(14)
  t.text('VORSORGEN-MAPPE', { size: 24, style: 'bold', color: [15, 15, 15], gapAfter: 2, align: 'center' })
  t.text(name || ' ', { size: 13, color: SOFT, gapAfter: 4, align: 'center' })
  t.rule([120, 120, 120], 0.6)
  t.gap(4)

  t.text('Diese Mappe enthält acht Vorsorgedokumente. Jedes wirkt für sich, jedes wird für sich unterschrieben, und jedes kann einzeln vorgelegt werden.', { gapAfter: 5 })

  for (const [no, title, sub] of [
    ['1', 'Vorsorgevollmacht', 'Wer für mich handeln darf, wenn ich es nicht mehr selbst kann — gegenüber Bank, Klinik und Behörde. Wirkt sofort ab Unterschrift.'],
    ['2', 'Betreuungsverfügung', 'Wen das Gericht bestellen soll, falls es trotz der Vollmacht eine rechtliche Betreuung einrichtet — und wen auf keinen Fall.'],
    ['3', 'Patientenverfügung', 'Welche ärztlichen Behandlungen in welchen Situationen vorgenommen oder unterlassen werden sollen.'],
    ['4', 'Meine Wertvorstellungen', 'Woran sich Entscheidungen ausrichten sollen, die ich nicht ausdrücklich geregelt habe. Nicht bindend, aber die wichtigste Auslegungshilfe.'],
    ['5', 'Bestattungsverfügung', 'Wie ich bestattet werden möchte und wie mein Abschied aussehen soll.'],
    ['6', 'Palliativ-Ampel', 'Ein Blatt für das Patientenzimmer: was im Notfall auf einen Blick gelten soll.'],
    ['7', 'Untervollmacht', 'Vordruck für den Fall, dass die bevollmächtigte Person ihrerseits jemanden einsetzen muss.'],
    ['8', 'Vertreterverfügung', 'Vordruck für meine Vertretung, falls sie stellvertretend für mich festlegen muss, was ich selbst nicht mehr festlegen kann.'],
  ]) {
    t.h2(`Teil ${no} · ${title}`)
    t.text(sub, { size: 10, color: SOFT, gapAfter: 3 })
  }

  t.callout('Entwurf — bitte vor der Unterschrift prüfen', [
    'Die Angaben in dieser Mappe stammen aus einem Vorsorgegespräch. Sie wurden aufgenommen, nicht erfunden — aber sie wurden per Spracherkennung aufgenommen, und die verhört Namen, Zahlen und Straßennamen.',
    'Deshalb steht am Anfang die PRÜFLISTE: Sie führt jede übernommene Angabe mit dem Satz auf, aus dem sie stammt. Gehen Sie sie Zeile für Zeile durch, bevor Sie irgendetwas unterschreiben.',
    'Diese Mappe ist keine Rechtsberatung und keine medizinische Beratung. Was die einzelnen Festlegungen der Patientenverfügung bedeuten, besprechen Sie am besten mit Ihrer Ärztin oder Ihrem Arzt.',
    'Ein leeres Kästchen heißt „nicht festgelegt" — nicht „abgelehnt". Wo Sie sich im Gespräch nicht festlegen wollten, ist beides frei geblieben; das können Sie jederzeit von Hand nachtragen.',
    'Die Vorlagen richten sich nach deutschem Recht.',
  ], AMBER)
}

// ════════════════════════════════════════════════════════════════
// Prüfliste — das Herzstück der Sicherheit dieses Produkts
// ════════════════════════════════════════════════════════════════

function drawVerify(t, d) {
  t.text('PRÜFLISTE', { size: 18, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  t.text('Nicht Bestandteil der Urkunden', { size: 10.5, color: SOFT, gapAfter: 3 })
  t.rule([120, 120, 120], 0.6)

  t.callout('Warum diese Liste vor allem anderen steht', [
    'Jede Angabe unten wurde aus dem gesprochenen Wort übernommen. Ein verhörter Nachname macht eine Vollmacht wertlos; eine verhörte Hausnummer macht sie angreifbar.',
    'Links steht, was im Dokument steht. Rechts steht der Satz aus dem Gespräch, aus dem es stammt. Haken Sie jede Zeile ab — und korrigieren Sie im Zweifel von Hand direkt in der Urkunde.',
  ], RED)

  const rows = (Array.isArray(d?.verify) ? d.verify : [])
    .map(r => ({ label: str(r?.label), value: str(r?.value), quote: str(r?.quote) }))
    .filter(r => r.label || r.value)

  if (!rows.length) {
    t.text('Das Gespräch enthält keine übernommenen Personen- oder Kontaktangaben. Alle Felder in den Urkunden sind von Hand auszufüllen.', { size: 10.5, color: SOFT })
  } else {
    for (const r of rows) {
      t.bullet(`${r.label}: ${r.value || '—'}`, { box: true, size: 10.5 })
      if (r.quote) t.text(`„${r.quote}"`, { size: 9, style: 'italic', color: SOFT, x: PAGE.M + 6.5, w: t.maxW - 6.5, gapAfter: 2.5 })
    }
  }

  t.h2('Noch von Hand zu ergänzen')
  const open = strList(d?.open_points)
  if (open.length) for (const o of open) t.bullet(o, { box: true, size: 10 })
  else t.text('Aus dem Gespräch ergibt sich kein offener Punkt. Prüfen Sie trotzdem jede Urkunde auf leer gebliebene Felder.', { size: 10, color: SOFT })
}

// ════════════════════════════════════════════════════════════════
// Teil 1 — Vorsorgevollmacht
// ════════════════════════════════════════════════════════════════

function drawPoa(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const attorneys = personList(d?.attorneys)
  const poa = d?.poa || {}

  partHead(t, 1, 'VORSORGEVOLLMACHT')
  draftNote(t)

  // ── 1. Vollmachtgeber ───────────────────────────────────────
  t.h1('1. Ich, die vollmachtgebende Person')
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Geburtsort', str(d?.person?.birthplace))
  t.field('Anschrift', p.address)
  t.field('Telefon / E-Mail', contactLine(p))

  // ── 2. Bevollmächtigte ──────────────────────────────────────
  t.h1('2. Ich bevollmächtige')
  t.text('Hiermit bevollmächtige ich die nachstehende Person, mich in allen unter Ziffer 3 angekreuzten Angelegenheiten gerichtlich und außergerichtlich zu vertreten, soweit dies gesetzlich zulässig ist. Sie soll meinem in einer Patientenverfügung festgelegten Willen Geltung verschaffen.', { gapAfter: 3 })

  if (attorneys.length) {
    attorneys.forEach((a, i) => {
      if (i === 1) {
        t.gap(1)
        t.text('Ist diese Person verhindert, verstorben oder will oder kann sie die Aufgabe nicht übernehmen, bevollmächtige ich an ihrer Stelle:', { gapAfter: 3 })
      } else if (i > 1) {
        t.gap(1)
        t.text('Und an deren Stelle:', { gapAfter: 3 })
      }
      drawPerson(t, a)
      t.gap(1)
    })
  } else {
    drawPerson(t, personOf(null))
    t.gap(2)
    t.text('Ist diese Person verhindert, verstorben oder will oder kann sie die Aufgabe nicht übernehmen, bevollmächtige ich an ihrer Stelle:', { gapAfter: 3 })
    drawPerson(t, personOf(null))
  }

  const mode = str(d?.attorney_mode)
  t.gap(1)
  t.h2('Wenn ich mehrere Personen bevollmächtige')
  t.bullet('Jede von ihnen darf mich allein vertreten (Einzelvertretung).', { box: true, checked: mode === 'einzeln' })
  t.bullet('Sie dürfen mich nur gemeinsam vertreten (Gesamtvertretung).', { box: true, checked: mode === 'gemeinsam' })

  t.gap(1)
  t.text('Diese Vollmacht bleibt in Kraft, wenn ich nach ihrer Errichtung vorübergehend oder dauerhaft geschäftsunfähig werde. Sie ist nur wirksam, solange die bevollmächtigte Person das Original dieser Urkunde besitzt und es bei Vornahme eines Rechtsgeschäfts vorlegen kann.', { size: 10, gapAfter: 2 })

  // ── 3. Umfang ───────────────────────────────────────────────
  t.h1('3. Wofür die Vollmacht gilt')
  t.text('Ich kreuze für jeden Bereich an, ob die Vollmacht ihn umfassen soll. Nicht angekreuzte Bereiche sind von der Vollmacht nicht gedeckt.', { gapAfter: 4 })

  for (const area of VORSORGE_AREAS) {
    const a = areaOf(d, area.key)
    t.h2(area.title)
    t.text(area.scope, { size: 9.5, color: SOFT, gapAfter: 3 })
    t.yesNo('Dieser Bereich ist umfasst.', 'Ausdrücklich nicht.', { value: tri(a?.granted) })

    // Sonderbefugnisse dieses Bereichs: Sie wirken NUR mit eigenem Kreuz.
    const specials = VORSORGE_SPECIAL.filter(s => s.area === area.key)
    if (specials.length) {
      t.text(`Zusätzlich, nur wenn eigens angekreuzt (${specials.map(s => s.ref).join(', ')}):`, { size: 10, style: 'bold', color: RED, gapAfter: 2 })
      for (const s of specials) {
        t.bullet(s.text, { box: true, checked: tri(poa?.special?.[s.key]) === true, size: 10 })
      }
    }

    const wishes = wishList(a)
    t.text('Meine Wünsche für diesen Bereich:', { size: 10, style: 'bold', gapAfter: 2.5 })
    if (wishes.length) for (const w of wishes) t.bullet(w.text, { box: true, checked: true })
    else t.blankLines(2)
    t.gap(2)
  }

  // ── 4. Ausgenommen ──────────────────────────────────────────
  t.h1('4. Was die bevollmächtigte Person nicht können soll')
  const excl = strList(poa?.excluded)
  if (excl.length) for (const x of excl) t.bullet(x, { box: true, checked: true })
  else t.blankLines(3)

  // ── 5. Gebrauch ─────────────────────────────────────────────
  t.h1('5. Wie von dieser Vollmacht Gebrauch gemacht werden soll')
  t.text('Die bevollmächtigte Person ist mir gegenüber verpflichtet, sich an das Folgende zu halten. Nach außen bleibt die Vollmacht davon unberührt und uneingeschränkt gültig:', { gapAfter: 3 })
  const usage = wishList(poa, 'usage_wishes')
  if (usage.length) for (const u of usage) t.bullet(u.text, { box: true, checked: true })
  else t.blankLines(4)

  t.gap(1)
  t.h2('Woran sich Entscheidungen ausrichten sollen')
  t.text('Wo Entscheidungen zu treffen sind, die ich hier nicht ausdrücklich geregelt habe, soll sich die bevollmächtigte Person an meinen Wertvorstellungen ausrichten (Teil 4 dieser Mappe) und meiner Patientenverfügung (Teil 3) Geltung verschaffen.', { gapAfter: 2 })

  // ── 6. Wirksamkeit ──────────────────────────────────────────
  t.h1('6. Ab wann und wie lange die Vollmacht gilt')
  t.text('Diese Vollmacht ist im Außenverhältnis sofort und unbedingt wirksam. Sie gilt gegenüber Dritten von der Unterschrift an.', { gapAfter: 2.5 })
  t.text('Im Innenverhältnis gilt die Weisung: Von dieser Vollmacht darf erst Gebrauch gemacht werden, wenn ich meine Angelegenheiten ganz oder in dem betroffenen Bereich nicht mehr selbst besorgen kann. Solange ich dazu in der Lage bin, entscheide ich selbst.', { gapAfter: 3 })

  t.h2('Weitere Festlegungen')
  for (const e of VORSORGE_EXTRAS) {
    t.bullet(e.text, { box: true, checked: tri(poa?.extras?.[e.key]) === true })
  }
  t.gap(1)
  t.text('Soweit Zweifel über den Umfang dieser Vollmacht bestehen, soll sie so ausgelegt werden, dass die Anordnung einer Betreuung nicht erforderlich wird. Ich kann diese Vollmacht jederzeit ohne Angabe von Gründen widerrufen.', { gapAfter: 2 })

  // ── 7. Verhältnis zu anderen Dokumenten ─────────────────────
  t.h1('7. Verhältnis zu meinen anderen Vorsorgedokumenten')
  t.text('Diese Vollmacht ersetzt keine Patientenverfügung (§ 1827 BGB): Welche ärztlichen Behandlungen an mir vorgenommen oder unterlassen werden sollen, ist dort geregelt — in Teil 3 dieser Mappe. Falls trotz dieser Vollmacht eine rechtliche Betreuung erforderlich sein sollte, gilt meine Betreuungsverfügung in Teil 2.', { gapAfter: 3 })
  const docs = d?.documents || {}
  t.h2('Diese Dokumente habe ich außerdem errichtet')
  t.bullet(`Patientenverfügung${str(docs?.patientenverfuegung?.datum) ? `, errichtet am ${str(docs.patientenverfuegung.datum)}` : ', errichtet am:'}`, { box: true, checked: tri(docs?.patientenverfuegung?.vorhanden) === true })
  t.bullet(`Testament${str(docs?.testament?.ort) ? `, hinterlegt bei ${str(docs.testament.ort)}` : ', hinterlegt bei:'}`, { box: true, checked: tri(docs?.testament?.vorhanden) === true })
  t.bullet(`Frühere Vorsorgevollmacht${str(docs?.vorsorgevollmacht_alt?.datum) ? ` vom ${str(docs.vorsorgevollmacht_alt.datum)}` : ''} — sie wird hiermit widerrufen.`, { box: true, checked: tri(docs?.vorsorgevollmacht_alt?.vorhanden) === true })
  t.bullet('Eintragung im Zentralen Vorsorgeregister der Bundesnotarkammer ist gewünscht.', { box: true, checked: tri(docs?.vorsorgeregister) === true })

  // ── 8. Unterschriften ───────────────────────────────────────
  t.h1('8. Ort, Datum und eigenhändige Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift der vollmachtgebenden Person')

  t.h2('Annahme durch die bevollmächtigte Person')
  t.text('Ich nehme die Vollmacht an und werde von ihr nur im Sinne der oben festgehaltenen Weisungen Gebrauch machen. (Nicht erforderlich, aber sinnvoll.)', { size: 9.5, color: SOFT, gapAfter: 5 })
  t.signatureRow('Ort, Datum', 'Unterschrift der bevollmächtigten Person')

  t.h2('Bestätigung der Entscheidungs- und Geschäftsfähigkeit')
  t.text('(Nicht erforderlich, aber sinnvoll — z. B. durch die Betreuungsbehörde, eine Notarin oder einen Arzt.)', { size: 9.5, color: SOFT, gapAfter: 5 })
  t.signatureRow('Ort, Datum', 'Unterschrift, Dienstsiegel')

  t.h2('Spätere Bestätigung')
  t.text('Eine Vollmacht wirkt umso überzeugender, je aktueller sie ist.', { size: 9.5, color: SOFT, gapAfter: 3 })
  for (let i = 0; i < 3; i++) t.signatureRow(null, null, { gapBefore: 5, gapAfter: 13, lw: 0.25, color: 150 })

  // ── 9. Aufbewahrung ─────────────────────────────────────────
  t.h1('9. Aufbewahrung und Auffindbarkeit')
  t.field('Das Original liegt bei', str(d?.storage?.original))
  const copies = strList(d?.storage?.copies)
  t.h2('Eine Ausfertigung oder Kopie haben erhalten')
  if (copies.length) for (const c of copies) t.bullet(c)
  else t.blankLines(2)
}

// ════════════════════════════════════════════════════════════════
// Teil 2 — Betreuungsverfügung
// ════════════════════════════════════════════════════════════════

function drawGuardianship(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const g = d?.guardianship || {}
  const proposed = personList(g?.proposed, 3)
  const excluded = personList(g?.excluded, 3)

  partHead(t, 2, 'BETREUUNGSVERFÜGUNG', 'Gilt nur, wenn trotz meiner Vollmacht ein Gericht eine rechtliche Betreuung einrichtet')
  draftNote(t)

  t.h1('1. Ich')
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Anschrift', p.address)
  t.field('Telefon / E-Mail', contactLine(p))
  t.gap(1)
  t.text('lege hiermit für den Fall, dass ich infolge von Krankheit, Behinderung oder Unfall meine Angelegenheiten teilweise oder ganz nicht mehr selbst regeln kann und deshalb vom Betreuungsgericht ein Betreuer als gesetzlicher Vertreter für mich bestellt werden muss, Folgendes fest:', { gapAfter: 2 })

  t.h1('2. Als Betreuerin oder Betreuer schlage ich vor')
  if (proposed.length) {
    proposed.forEach((x, i) => {
      if (i === 1) { t.gap(1); t.h2('Falls die vorstehende Person nicht bestellt werden kann') }
      else if (i > 1) { t.gap(1); t.h2('Und an deren Stelle') }
      drawPerson(t, x)
      t.gap(1)
    })
  } else {
    drawPerson(t, personOf(null))
    t.gap(1)
    t.h2('Falls die vorstehende Person nicht bestellt werden kann')
    drawPerson(t, personOf(null))
  }
  t.text('Das Betreuungsgericht ist an diesen Vorschlag gebunden, soweit er meinem Wohl nicht zuwiderläuft (§ 1816 Abs. 2 BGB).', { size: 10, color: SOFT, gapAfter: 2 })

  t.h1('3. Auf keinen Fall bestellt werden soll')
  if (excluded.length) {
    for (const x of excluded) {
      t.field('Name, Vorname', x.name)
      t.field('Verhältnis zu mir', x.relation)
      t.gap(1)
    }
  } else {
    t.field('Name, Vorname')
    t.field('Verhältnis zu mir')
  }

  t.h1('4. Meine Wünsche zur Führung der Betreuung')
  const wishes = wishList(g, 'wishes')
  if (wishes.length) for (const w of wishes) t.bullet(w.text, { box: true, checked: true })
  else t.blankLines(4)
  t.gap(1)
  t.text('Im Übrigen gelten meine Festlegungen aus der Vollmacht (Teil 1) und meine Wertvorstellungen (Teil 4) entsprechend.', { size: 10, gapAfter: 2 })

  t.h1('5. Meine Patientenverfügung')
  t.decision('Ich habe meine Einstellung zu Krankheit und Sterben in der beigefügten Patientenverfügung niedergelegt (Teil 3 dieser Mappe); sie ist vom Betreuer zu beachten.',
    tri(d?.documents?.patientenverfuegung?.vorhanden) === true ? true : null)

  t.h1('6. Ort, Datum und eigenhändige Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift')
}

// ════════════════════════════════════════════════════════════════
// Teil 3 — Patientenverfügung
// ════════════════════════════════════════════════════════════════

function drawPatientDecree(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const pv = d?.patient_decree || {}
  const first = personList(d?.attorneys, 1)[0]

  partHead(t, 3, 'PATIENTENVERFÜGUNG', 'Nach § 1827 BGB')
  draftNote(t)

  t.h1('1. Willenserklärung')
  t.text('Ich bestimme hiermit für den Fall, dass ich meinen Willen nicht mehr bilden oder verständlich äußern kann, Folgendes:', { gapAfter: 3 })
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Anschrift', p.address)
  t.field('Telefon / E-Mail', contactLine(p))

  // ── 1.2 Situationen ─────────────────────────────────────────
  t.h1('2. Situationen, in denen diese Patientenverfügung gelten soll')
  t.text('Diese Patientenverfügung soll gelten, wenn ich …', { gapAfter: 3 })
  for (const s of PV_SITUATIONS) {
    if (s.key === 'hirn_bewusst') {
      t.gap(1)
      t.decision(s.text, tri(pv?.situations?.[s.key]), { size: 9.5 })
      continue
    }
    t.decision(`${s.label}. … ${s.text.replace(/^wenn ich /, '')}`, tri(pv?.situations?.[s.key]))
  }
  const own = str(pv?.situation_own)
  t.gap(1)
  t.h2('F. Weitere Lebenslage, in der diese Verfügung gelten soll')
  if (own) t.text(own, { size: 10.5, gapAfter: 2 })
  else t.blankLines(2)

  t.gap(1)
  t.decision('Diese Verfügung soll bereits jetzt gelten — insbesondere bei einer schweren Erkrankung wie Schlaganfall, Herzinfarkt oder schwerer Lungenentzündung, gerade wenn eine hohe Sterbewahrscheinlichkeit oder ein hohes Risiko einer nachfolgenden schweren, dauerhaften Gesundheitseinschränkung besteht. In diesem Fall lehne ich selbst medizinisch indizierte Krankenhauseinweisungen ab.',
    tri(pv?.gilt_schon_jetzt), { size: 9.5 })

  // ── 1.3 Bevollmächtigte Person ──────────────────────────────
  t.h1('3. Mit wem ich den Inhalt besprochen habe')
  t.text('Ich habe zusätzlich zu dieser Patientenverfügung eine Vorsorgevollmacht und eine Betreuungsverfügung erteilt (Teile 1 und 2 dieser Mappe) und den Inhalt mit folgender Person besprochen:', { gapAfter: 3 })
  drawPerson(t, first || personOf(null))

  // ── 2. Krankenhauseinweisung ────────────────────────────────
  t.h1('4. Krankenhauseinweisung')
  t.decision('A. Wenn ich in den unter Ziffer 2 genannten Situationen ohne Krankenhausbehandlung vielleicht sterben würde, möchte ich ins Krankenhaus eingewiesen werden.', tri(pv?.hospital?.einweisung))
  t.decision('B. Ich will auf keinen Fall mehr ins Krankenhaus; diese Verweigerung soll schon jetzt gelten, unabhängig von den Situationen unter Ziffer 2.', tri(pv?.hospital?.niemals))

  // ── 3. Festlegungen ─────────────────────────────────────────
  t.h1('5. Festlegungen zu medizinischen Maßnahmen')
  t.text('Für die unter Ziffer 2 genannten Situationen wünsche ich …', { gapAfter: 3 })

  t.h2('5.1 Umfang lebenserhaltender und -verlängernder Maßnahmen')
  t.decision('Es sollen alle medizinisch möglichen und angezeigten Behandlungen vorgenommen werden, um mein Leben zu erhalten.', tri(pv?.max_therapie))

  t.h2('5.2 Fachgerechte Symptombehandlung (z. B. Schmerzen, Atemnot, Unruhe)')
  t.decision('A. Wenn es möglich ist, möchte ich mein Lebensende bewusst erleben.', tri(pv?.symptom?.bewusst_erleben))
  t.decision('B. Wenn es nötig ist, wünsche ich Mittel mit bewusstseinsdämpfender Wirkung.', tri(pv?.symptom?.bewusstseinsdaempfend))
  t.decision('C. Eine ungewollte Lebensverkürzung hierdurch ist sehr unwahrscheinlich. Ich würde sie aber hinnehmen.', tri(pv?.symptom?.lebensverkuerzung_hinnehmen))

  t.h2('5.3 Künstliche Ernährung und Flüssigkeitszufuhr')
  t.decision('A. Hunger und Durst sollen nur mit Hilfe beim Essen und Trinken auf natürliche Weise gestillt werden; es soll eine fachgerechte Mundpflege erfolgen.', tri(pv?.nutrition?.natuerlich))
  t.decision('B. Ich wünsche zur Lebenserhaltung eine künstliche Ernährung und/oder Flüssigkeitsgabe, z. B. über eine Magensonde oder einen Zugang in die Vene oder unter die Haut.', tri(pv?.nutrition?.kuenstlich))

  t.h2('5.4 Herz-Lungen-Wiederbelebung')
  t.decision('A. Bei einem Herz-Kreislauf-Stillstand in Situationen wie unter Ziffer 2 wünsche ich Notruf und sofortige Wiederbelebung.', tri(pv?.resuscitation?.wiederbelebung))
  t.decision('B. Sollte der Rettungsdienst da sein, ist er über meine Ablehnung einer Wiederbelebung zu informieren.', tri(pv?.resuscitation?.rettungsdienst_informieren))

  t.h2('5.5 Einzelne Maßnahmen — jeweils für den Fall, dass sie mein Leben verlängern können')
  for (const m of PV_MEASURES) t.decision(m.text, tri(pv?.measures?.[m.key]))
  t.decision('Sollte ich einen Herzschrittmacher und/oder Defibrillator besitzen, soll dieser rechtzeitig deaktiviert werden.', tri(pv?.measures?.schrittmacher_deaktivieren), { indent: 6 })

  t.h2('5.6 Reine Palliation statt möglicher Lebensverlängerung')
  t.decision('Ich möchte, dass die unter 5.5 genannten und alle ähnlichen Maßnahmen nicht zur Lebensverlängerung eingesetzt werden. Ich verlange, dass zur Leidenslinderung andere, rein palliative Maßnahmen eingesetzt werden — bis hin zu einer palliativen Sedierung.', tri(pv?.nur_palliativ), { size: 9.5 })

  const wanted = strList(pv?.gewuenschte_behandlungen)
  t.h2('5.7 Behandlungen, deren Beginn oder Fortführung ich ausdrücklich wünsche')
  if (wanted.length) for (const w of wanted) t.bullet(w, { box: true, checked: true })
  else t.blankLines(2)

  // ── 4. Aufklärungsverzicht ──────────────────────────────────
  t.h1('6. Aufklärungsverzicht')
  t.decision('Soweit ich bestimmte Behandlungen wünsche oder ablehne, verzichte ich ausdrücklich auf eine weitere ärztliche Aufklärung — auch der bevollmächtigten Person.', tri(pv?.aufklaerungsverzicht))

  // ── 5. Weitere Unterlagen ───────────────────────────────────
  t.h1('7. Weitere geltende Unterlagen')
  t.decision('Als Auslegungshilfe zu dieser Patientenverfügung gilt die Darstellung meiner Wertvorstellungen in Teil 4 dieser Mappe.', true)

  // ── 6. Organspende ──────────────────────────────────────────
  t.h1('8. Organ- und Gewebespende')
  t.decision('A. Ich stimme einer Entnahme meiner Organe und Gewebe zur Transplantation nach ärztlicher Feststellung meines Todes zu.', tri(pv?.organ?.zustimmung))
  t.field('mit Ausnahme folgender Organe/Gewebe', str(pv?.organ?.ausnahmen))
  t.field('nur für folgende Organe/Gewebe', str(pv?.organ?.nur_fuer))
  t.gap(1)
  t.text('Komme ich bei einem sich abzeichnenden unumkehrbaren Ausfall wesentlicher Hirnfunktionen als Organspender in Betracht und sind dafür ärztliche Maßnahmen nötig, die ich in dieser Patientenverfügung ausgeschlossen habe, dann gilt …', { size: 10, gapAfter: 2.5 })
  const vorrang = str(pv?.organ?.vorrang)
  t.bullet('B. … meine erklärte Bereitschaft zur Organspende.', { box: true, checked: vorrang === 'organspende' })
  t.bullet('C. … die Bestimmung in meiner Patientenverfügung.', { box: true, checked: vorrang === 'patientenverfuegung' })
  t.gap(1)
  t.decision('Ich besitze einen Organspendeausweis.', tri(pv?.organ?.ausweis))

  // ── 7. Verbindlichkeit ──────────────────────────────────────
  t.h1('9. Verbindlichkeit, Auslegung und Durchsetzung')
  t.text('Ich will, dass mein in dieser Patientenverfügung dokumentierter Wille zu bestimmten pflegerischen und ärztlichen Maßnahmen von allen Beteiligten befolgt wird. Meine Vertretung soll dafür sorgen, dass mein Wille durchgesetzt wird.', { gapAfter: 2.5 })
  t.text('Eine Patientenverfügung kann nicht jeden möglichen Fall in allen Einzelheiten beschreiben. In Lebens- und Behandlungssituationen, die hier nicht ausreichend konkret beschrieben sind, ist mein mutmaßlicher Wille möglichst in Übereinstimmung mit allen Beteiligten zu ermitteln; maßgeblich sind dafür diese Verfügung zusammen mit meinen Wertvorstellungen (Teil 4).', { gapAfter: 2.5 })
  t.text('Wenn die behandelnden Personen aufgrund meiner Gesten, Blicke oder anderer Äußerungen zu der Auffassung gelangen, dass ich entgegen diesen Festlegungen doch noch behandelt oder nicht behandelt werden möchte, ist möglichst in Übereinstimmung mit allen Beteiligten zu ermitteln, ob diese Festlegungen noch meinem aktuellen Willen entsprechen.', { gapAfter: 3 })

  t.decision('Sollten Beteiligte nicht bereit sein, meinen Willen zu befolgen, erwarte ich, dass für eine anderweitige Behandlung und/oder Unterbringung gesorgt wird.', tri(pv?.andere_behandlung_erwarten))

  t.h2('Bei dauerhaft unterschiedlichen Meinungen soll besonders zählen')
  const konflikt = str(pv?.konflikt?.wer)
  t.bullet('A. die Auffassung meiner bevollmächtigten Person', { box: true, checked: konflikt === 'bevollmaechtigter' })
  t.bullet('B. die Auffassung meiner behandelnden Ärztin oder meines behandelnden Arztes', { box: true, checked: konflikt === 'arzt' })
  t.bullet('C. die Auffassung folgender Person, in deren Entscheidung ich besonderes Vertrauen habe:', { box: true, checked: konflikt === 'andere' })
  t.field('Name, Vorname', str(pv?.konflikt?.name))
  t.field('Kontaktmöglichkeit', str(pv?.konflikt?.kontakt))

  // ── 8./9. Geltungsdauer und Widerruf ────────────────────────
  t.h1('10. Geltungsdauer und Widerruf')
  t.bullet('Diese Patientenverfügung gilt, bis ich sie widerrufe. Künftige Änderungen oder Widerrufe werde ich möglichst schriftlich dokumentieren.', { box: true, checked: true })
  t.bullet('Mir ist die jederzeitige Möglichkeit der Änderung und des Widerrufs bekannt. Ich bin mir des Inhalts und der Konsequenzen meiner Entscheidungen bewusst. Ich habe diese Verfügung in eigener Verantwortung und ohne äußeren Druck erstellt und bin im Vollbesitz meiner geistigen Kräfte.', { box: true, checked: true })

  // ── 10. Beratung ────────────────────────────────────────────
  t.h1('11. Information und Beratung')
  t.field('Ich habe mich beraten lassen von', str(pv?.beratung))

  // ── 11./12. Unterschriften ──────────────────────────────────
  t.h1('12. Ort, Datum und eigenhändige Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift der verfügenden Person')

  t.h2('Ärztliche Aufklärung und Bestätigung der Entscheidungsfähigkeit')
  t.text(`${p.name || 'Die verfügende Person'} wurde von mir heute bezüglich der möglichen Folgen dieser Patientenverfügung aufgeklärt und war in vollem Umfang einwilligungsfähig. (Nicht erforderlich, aber sinnvoll.)`, { size: 9.5, color: SOFT, gapAfter: 5 })
  t.signatureRow('Ort, Datum', 'Unterschrift, Dienstsiegel')
}

// ════════════════════════════════════════════════════════════════
// Teil 4 — Meine Wertvorstellungen
// ════════════════════════════════════════════════════════════════

const STERBEORTE = [
  { key: 'zuhause', text: 'zu Hause bzw. in vertrauter Umgebung' },
  { key: 'hospiz', text: 'in einem Hospiz' },
  { key: 'palliativstation', text: 'auf einer Palliativstation' },
  { key: 'krankenhaus', text: 'im Krankenhaus' },
]

function drawValues(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const v = d?.values || {}

  partHead(t, 4, 'MEINE WERTVORSTELLUNGEN', 'Ergänzende Erläuterungen zu meiner Patientenverfügung und meiner Vollmacht')

  t.text('Dieses Dokument ist NICHT bindend. Es bindet niemanden zu einer bestimmten Behandlung — es hilft denen, die für mich entscheiden müssen, mich zu verstehen. Bindend sind die Patientenverfügung (Teil 3) und die Vollmacht (Teil 1).', { size: 9.5, color: BLUE, gapAfter: 4 })

  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Anschrift', p.address)

  const summary = str(v?.summary)
  if (summary) { t.h1('Wer ich bin'); t.text(summary) }

  t.h1('Wo ich sterben möchte, wenn es sich einrichten lässt')
  t.choice(STERBEORTE, str(v?.sterbeort) || null)

  t.h1('Beistand, den ich mir wünsche')
  t.decision('seelsorglicher Beistand', tri(v?.beistand?.seelsorglich))
  t.decision('hospizliche Begleitung', tri(v?.beistand?.hospizlich))
  t.field('durch folgende Personen', str(v?.beistand?.personen))
  t.field('Glaubensgemeinschaft', str(v?.beistand?.glaubensgemeinschaft))
  const kb = str(v?.kirchliche_bestattung)
  t.gap(1)
  t.h2('Ich wünsche eine kirchliche Bestattung')
  t.choice([{ key: 'ja', text: 'Ja' }, { key: 'nein', text: 'Nein' }, { key: 'egal', text: 'Das ist mir gleich' }], kb || null, { size: 10 })

  const daily = strList(v?.daily_life)
  t.h1('Was in meinem Alltag geachtet werden soll')
  if (daily.length) for (const x of daily) t.bullet(x)
  else t.blankLines(4)

  const attitudes = (Array.isArray(v?.attitudes) ? v.attitudes : [])
    .map(a => (typeof a === 'string'
      ? { topic: '', text: str(a), evidence: '' }
      : { topic: str(a?.topic), text: str(a?.text), evidence: str(a?.evidence) }))
    .filter(a => a.text)
  t.h1('Meine Haltung')
  if (attitudes.length) {
    for (const a of attitudes) {
      if (a.topic) t.h2(a.topic)
      t.text(a.text, { size: 10.5, gapAfter: 2.5 })
    }
  } else t.blankLines(5)

  const msg = str(v?.message)
  if (msg) {
    t.h1('An die Menschen, die für mich entscheiden müssen')
    t.text(msg)
  }

  t.h1('Raum für eigene Ergänzungen')
  t.blankLines(6)

  t.h1('Ort, Datum und Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift')
}

// ════════════════════════════════════════════════════════════════
// Teil 5 — Bestattungsverfügung
// ════════════════════════════════════════════════════════════════

const BEST_ART = [
  { key: 'erde', text: 'Erdbestattung im Sarg', sub: 'Mein Körper wird im Sarg in der Erde beigesetzt.' },
  { key: 'feuer', text: 'Feuerbestattung mit Urne', sub: 'Mein Leib wird im Sarg bei hohen Temperaturen verbrannt; Asche und unverbrennbare Teile bleiben zurück.' },
  { key: 'reerdigung', text: 'Reerdigung', sub: 'Mein Leib wird in einem Kokon auf pflanzlichem Material gebettet und verwandelt sich binnen einiger Wochen zu Erde.' },
  { key: 'andere_entscheiden', text: 'Das sollen andere entscheiden', sub: 'Diese Entscheidung kann meine Familie bzw. meine bevollmächtigte Person treffen.' },
]
const BEST_ORT = [
  { key: 'friedhof', text: 'Friedhof — Urne oder Sarg werden auf einem Friedhof beigesetzt' },
  { key: 'see', text: 'See — meine Urne soll im Meer beigesetzt werden' },
  { key: 'wald', text: 'Wald — meine Urne soll in einem Begräbniswald beigesetzt werden' },
  { key: 'anderer', text: 'Eine andere Art der Beisetzung meiner Asche' },
  { key: 'andere_entscheiden', text: 'Das sollen andere entscheiden' },
]
const BEST_GRAB = [
  { key: 'wahlgrab', text: 'Wahlgrab mit Urne oder Sarg' },
  { key: 'reihengrab', text: 'Reihengrab mit Urne oder Sarg' },
  { key: 'wiese', text: 'Grüne Wiese mit Urne oder Sarg' },
  { key: 'urnenwand', text: 'Urnenwand mit Urne' },
  { key: 'baumgrab', text: 'Baumgrab mit Urne' },
  { key: 'andere_entscheiden', text: 'Das sollen andere entscheiden' },
]
const BEST_FEIER = [
  { key: 'weltlich', text: 'Weltliche Abschiedsfeier', sub: 'Ein weltlicher Redner soll ein paar Worte über mich sprechen.' },
  { key: 'religioes', text: 'Religiöse Abschiedsfeier', sub: 'Die Bestattung wird entsprechend religiöser Bräuche gestaltet.' },
  { key: 'party', text: 'Abschiedsparty', sub: 'Ich stelle mir meinen Abschied eher als Lebensfeier vor.' },
  { key: 'keine', text: 'Keine Abschiedsfeier' },
  { key: 'andere_entscheiden', text: 'Das sollen andere entscheiden' },
]
const BEST_RAHMEN = [
  { key: 'engster', text: 'Engster Familienkreis' },
  { key: 'erweitert', text: 'Erweiterter Familien- und Freundeskreis' },
  { key: 'oeffentlich', text: 'Öffentlicher Rahmen — alle, die möchten, können teilnehmen' },
  { key: 'andere_entscheiden', text: 'Das sollen andere entscheiden' },
]

function drawFuneral(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const f = d?.funeral || {}
  const resp = personOf(f?.verantwortlich)

  partHead(t, 5, 'BESTATTUNGSVERFÜGUNG')
  draftNote(t)

  t.h1('1. Hiermit bestimme ich')
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Anschrift', p.address)
  t.gap(1)
  t.text('für den Fall, dass ich gestorben bin, folgende Person für die Regelung meiner Trauerfeierlichkeiten, Beisetzung und Grabpflege:', { gapAfter: 3 })
  drawPerson(t, hasPerson(resp) ? resp : personOf(null), { withBirth: false })

  t.h1('2. Erdbestattung oder Feuerbestattung')
  t.choice(BEST_ART, str(f?.art) || null)
  if (str(f?.art_text)) t.text(str(f.art_text), { size: 10, x: PAGE.M + 6.5, w: t.maxW - 6.5 })

  t.h1('3. Ort meiner letzten Ruhe')
  t.choice(BEST_ORT, str(f?.ort) || null)
  t.field('nämlich', str(f?.ort_text))

  t.h1('4. Grabart')
  t.choice(BEST_GRAB, str(f?.grabart) || null)

  t.h1('5. Konkreter Ort bzw. Friedhof')
  if (str(f?.ort_konkret)) t.text(str(f.ort_konkret), { gapAfter: 2 })
  else t.blankLines(2)

  t.h1('6. Abschiedsfeier')
  t.choice(BEST_FEIER, str(f?.feier) || null)
  t.field('Glaubensgemeinschaft', str(f?.glaubensgemeinschaft))

  t.h1('7. Rahmen der Abschiedsfeier')
  t.choice(BEST_RAHMEN, str(f?.rahmen) || null)

  t.h1('8. Abschiedsrede')
  t.decision('Ich möchte eine Rede. Geistliche, Freundinnen, Freunde oder Familienangehörige dürfen gern etwas sagen.', tri(f?.rede?.gewuenscht))
  t.field('Von folgender Person', str(f?.rede?.von))

  t.h1('9. Musik')
  t.decision('Ich möchte Musik für meinen Abschied.', tri(f?.musik?.gewuenscht))
  t.field('Und zwar', str(f?.musik?.welche))

  t.h1('10. Weitere Wünsche')
  t.text('Z. B. zu Trauerkarten, Anzeigen, Aufbahrung, Essen nach der Beisetzung, Grabmal, Grabpflege, Blumenschmuck.', { size: 9.5, color: SOFT, gapAfter: 2.5 })
  linesOrText(t, f?.weitere_wuensche, 4)

  const nope = strList(f?.nicht_erwuenscht)
  if (nope.length) {
    t.h2('Was auf keinen Fall vorkommen soll')
    for (const x of nope) t.bullet(x, { box: true, checked: true })
  }

  t.h1('11. Bereits Geregeltes')
  t.field('Bestattungsinstitut', str(f?.institut))

  t.h1('12. Ort, Datum und eigenhändige Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift der verfügenden Person')
}

// ════════════════════════════════════════════════════════════════
// Teil 6 — Palliativ-Ampel
// ════════════════════════════════════════════════════════════════
//
// EIN Blatt, das im Notfall aus zwei Metern Entfernung lesbar sein muss. Es
// hängt am Bett oder klebt an der Schranktür; ein Ersthelfer, der die Person
// nicht kennt, soll auf einen Blick sehen, was gilt. Deshalb hier ausnahmsweise
// farbige Balken statt der nüchternen Formularsprache der übrigen Teile.

function drawAmpel(t, d, memorial) {
  const doc = t.doc
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const a = d?.ampel || {}
  const first = personList(d?.attorneys, 1)[0]
  const stufe = str(a?.stufe) || null

  partHead(t, 6, 'PALLIATIV-AMPEL', 'Schnelle Übersicht für das Patientenzimmer')

  // Kopf: wer, und welche Dokumente es gibt.
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Zimmernummer', '')
  t.field('Bevollmächtigte Person', first ? [first.name, first.phone].filter(Boolean).join(' · ') : '')
  t.gap(1)

  const docs = d?.documents || {}
  t.h2('Vorhandene Vorsorgedokumente')
  t.decision('Patientenverfügung', tri(docs?.patientenverfuegung?.vorhanden))
  t.decision('Vorsorgevollmacht', hasPerson(first) ? true : null)
  t.decision('Gerichtliche Betreuung', tri(docs?.betreuung_bestehend))
  t.gap(2)

  // Die drei Stufen als farbige Balken.
  for (const s of AMPEL_STUFEN) {
    const on = stufe === s.key
    t.ensure(26)
    const top = t.y - 4
    // Balken links in der Ampelfarbe; die gewählte Stufe zusätzlich hinterlegt.
    doc.setFillColor(...s.color)
    doc.rect(PAGE.M, top, 6, 20, 'F')
    if (on) {
      doc.setFillColor(248, 248, 246)
      doc.rect(PAGE.M + 6, top, t.maxW - 6, 20, 'F')
    }
    doc.setDrawColor(...(on ? s.color : [215, 215, 215])); doc.setLineWidth(on ? 0.7 : 0.3)
    doc.rect(PAGE.M, top, t.maxW, 20)

    // Ankreuzkästchen rechts oben im Balken.
    t.checkbox(PAGE.PW - PAGE.M - 8, top + 3.5, 5, on)

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...s.color)
    doc.text(s.title, PAGE.M + 11, top + 7.5)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...SOFT)
    doc.text(`„${s.motto}"`, PAGE.M + 11 + doc.getTextWidth(s.title) + 4, top + 7.5)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK)
    let yy = top + 13
    for (const ln of doc.splitTextToSize(s.text, t.maxW - 26)) { doc.text(ln, PAGE.M + 11, yy); yy += 4 }
    t.y = top + 24
  }

  t.gap(2)
  t.h2('Bei GELB gilt im Einzelnen')
  for (const m of AMPEL_MEASURES) t.decision(m.text, tri(a?.gelb?.[m.key]), { size: 9.5 })
  t.gap(1)
  t.decision('Bei Bedarf ist auch eine Krankenhauseinweisung gewünscht.', tri(a?.krankenhauseinweisung), { size: 9.5 })

  t.gap(2)
  t.text('Diese Ampel ersetzt keine Patientenverfügung. Sie ist die Kurzfassung für den Notfall; maßgeblich ist Teil 3 dieser Mappe.', { size: 9, color: SOFT, gapAfter: 3 })
  t.signatureRow('Ort, Datum', 'Unterschrift (Patient, Bevollmächtigter, Arzt …)')
}

// ════════════════════════════════════════════════════════════════
// Teil 7 — Untervollmacht (Vordruck)
// ════════════════════════════════════════════════════════════════
//
// Dieses Formular unterschreibt NICHT die vorsorgende Person, sondern ihre
// bevollmächtigte Person, wenn sie ihrerseits jemanden einsetzen muss. Deshalb
// werden hier nur die Angaben vorbelegt, die feststehen — alles Übrige bleibt
// leer und trägt einen deutlichen Hinweis, wer es ausfüllt.

function drawSubPoa(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const first = personList(d?.attorneys, 1)[0]
  const untervollmacht = tri(d?.poa?.extras?.untervollmacht)

  partHead(t, 7, 'UNTERVOLLMACHT', 'Vordruck — auszufüllen von der bevollmächtigten Person, nicht von mir')

  t.callout('Wofür dieses Blatt da ist', [
    'Eine Untervollmacht erteilt nicht die vorsorgende Person, sondern die BEVOLLMÄCHTIGTE Person — etwa wenn sie selbst erkrankt, verreist oder eine Aufgabe nicht allein bewältigen kann.',
    untervollmacht === true
      ? 'Ziffer 6 der Vollmacht (Teil 1) erlaubt das ausdrücklich: Die bevollmächtigte Person darf Untervollmacht erteilen.'
      : untervollmacht === false
        ? 'ACHTUNG: In Teil 1 ist die Erteilung von Untervollmacht NICHT gestattet. Dieses Blatt liegt nur bei, falls die Vollmacht später geändert wird — solange sie gilt, darf es nicht verwendet werden.'
        : 'In Teil 1 ist noch nicht festgelegt, ob Untervollmacht erteilt werden darf. Ohne diese Erlaubnis darf dieses Blatt nicht verwendet werden.',
    'Es bleibt deshalb weitgehend leer. Vorbelegt ist nur, was schon feststeht.',
  ], untervollmacht === false ? RED : AMBER)

  t.h1('1. Ursprüngliche Vollmachtgeberin / ursprünglicher Vollmachtgeber')
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum', p.birthdate)
  t.field('Anschrift', p.address)

  t.h1('2. Ich als Untervollmachtgeber (die bevollmächtigte Person)')
  drawPerson(t, first || personOf(null), { withRelation: false })

  t.h1('3. Untervollmacht an')
  t.text('Die unterbevollmächtigte Person wird hiermit bevollmächtigt, die vorstehend genannte Vollmachtgeberin bzw. den Vollmachtgeber in allen Angelegenheiten — im gesetzlich zulässigen Rahmen und im nachstehend beschriebenen Umfang — gerichtlich und außergerichtlich zu vertreten.', { gapAfter: 3 })
  drawPerson(t, personOf(null), { withRelation: false })
  t.gap(1)
  t.text('Diese Untervollmacht bleibt in Kraft, wenn der Untervollmachtgeber nach ihrer Errichtung vorübergehend oder dauerhaft geschäftsunfähig wird. Sie ist nur wirksam, solange die unterbevollmächtigte Person das Original dieser Urkunde besitzt und vorlegen kann.', { size: 10, gapAfter: 2 })

  t.h1('4. Umfang der Untervollmacht')
  t.text('Anzukreuzen sind nur Bereiche, die auch die ursprüngliche Vollmacht umfasst — weiter als diese kann eine Untervollmacht nicht reichen.', { size: 9.5, color: SOFT, gapAfter: 3 })
  for (const area of VORSORGE_AREAS) {
    const granted = tri(areaOf(d, area.key)?.granted)
    t.bullet(`${area.title}${granted === false ? '  (in Teil 1 ausgeschlossen)' : ''}`, { box: true, color: granted === false ? SOFT : INK })
  }
  t.gap(1)
  t.h2('Einschränkungen')
  t.blankLines(3)

  t.h1('5. Ort, Datum und eigenhändige Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift des Untervollmachtgebers')
  t.signatureRow('Ort, Datum', 'Unterschrift der unterbevollmächtigten Person')
}

// ════════════════════════════════════════════════════════════════
// Teil 8 — Vertreterverfügung (Vordruck)
// ════════════════════════════════════════════════════════════════
//
// Auch dieses Formular unterschreibt eine ANDERE Person: die Vertretung, wenn
// sie nach § 1827 BGB stellvertretend festlegen muss, was die betroffene Person
// selbst nicht mehr festlegen kann. Vorbelegt sind nur die Angaben zur
// betroffenen Person und der Hinweis, wo ihr Wille bereits dokumentiert ist —
// gerade darin liegt der Wert dieses Blattes in DIESER Mappe.

function drawRepDecree(t, d, memorial) {
  const p = personOf({ ...(d?.person || {}), name: str(d?.person?.name) || str(memorial?.name) })
  const first = personList(d?.attorneys, 1)[0]

  partHead(t, 8, 'VERTRETERVERFÜGUNG', 'Vordruck — auszufüllen von meiner Vertretung, nicht von mir')

  t.callout('Wofür dieses Blatt da ist', [
    'Eine Vertreterverfügung trifft die VERTRETUNG — die bevollmächtigte Person oder ein bestellter Betreuer — stellvertretend für einen Menschen, der selbst nicht mehr einwilligungsfähig ist (§ 1827 BGB).',
    'Solange die Patientenverfügung in Teil 3 die eingetretene Situation abdeckt, wird dieses Blatt NICHT gebraucht: Dann gilt der eigene Wille. Gebraucht wird es für Situationen, die dort nicht geregelt sind.',
    'Es bleibt deshalb weitgehend leer. Vorbelegt sind nur die Angaben zur betroffenen Person und der Hinweis, wo ihr Wille bereits dokumentiert ist.',
  ], BLUE)

  t.h1('1. Die betroffene Person')
  t.field('Name, Vorname', p.name)
  t.field('Geburtsdatum, Geburtsort', [p.birthdate, str(d?.person?.birthplace)].filter(Boolean).join(', '))
  t.field('Anschrift', p.address)
  t.field('Telefon / E-Mail', contactLine(p))

  t.h1('2. Ich als vertretungsberechtigte Person')
  drawPerson(t, first || personOf(null), { withRelation: false })
  t.gap(1)
  t.h2('in meiner Funktion als')
  t.bullet('Vorsorgebevollmächtigte oder Vorsorgebevollmächtigter', { box: true })
  t.bullet('Gesetzlich bestellte Betreuerin oder bestellter Betreuer für Gesundheitsangelegenheiten, bestellt am:', { box: true })
  t.blankLines(1)

  t.h1('3. Feststellung der Einwilligungsunfähigkeit')
  t.text('Die von mir vertretene Person ist dauerhaft nicht einwilligungsfähig aufgrund von:', { gapAfter: 2.5 })
  t.blankLines(2)

  t.h1('4. Wie ich den Willen ermittelt habe')
  t.bullet('Feststellung der konkret, mündlich oder schriftlich geäußerten Festlegungen der betroffenen Person.', { box: true })
  t.bullet('Ableitung des mutmaßlichen Willens durch Auslegung früherer mündlicher oder schriftlicher Äußerungen.', { box: true })
  t.gap(1)
  t.callout('In dieser Mappe liegt beides vor', [
    'Teil 3 (Patientenverfügung) enthält die schriftlichen Festlegungen der betroffenen Person.',
    'Teil 4 (Meine Wertvorstellungen) ist die von ihr selbst verfasste Auslegungshilfe für alles, was dort nicht geregelt ist. Beides ist vor jeder stellvertretenden Festlegung heranzuziehen.',
  ], BLUE)

  t.h1('5. Situationen, in denen diese Vertreterverfügung gelten soll')
  t.text('Anzukreuzen sind nur Situationen, die Teil 3 nicht bereits regelt.', { size: 9.5, color: SOFT, gapAfter: 2.5 })
  for (const s of PV_SITUATIONS) {
    if (s.key === 'hirn_bewusst') continue
    t.bullet(`${s.label}. … ${s.text.replace(/^wenn ich /, 'wenn die betroffene Person ')}`, { box: true, size: 9.5 })
  }
  t.gap(1)
  t.h2('Andere Lebenslage')
  t.blankLines(2)
  t.text('Kurzfristige Bewusstseinsstörungen — etwa eine Gehirnerschütterung, eine kurzfristige Medikamentenwirkung, eine Narkose oder ein künstliches Koma nach einer Operation — werden von einer Vertreterverfügung ausdrücklich nicht erfasst.', { size: 9, color: SOFT, gapAfter: 2 })

  t.h1('6. Festlegungen zum Umfang lebenserhaltender Maßnahmen')
  t.bullet('Es sollen alle medizinisch möglichen und angezeigten Behandlungen vorgenommen werden mit dem Ziel, das Leben der betroffenen Person zu erhalten.', { box: true })
  t.gap(1)
  for (const m of PV_MEASURES) t.bullet(m.text, { box: true, size: 10 })
  t.gap(1)
  t.h2('Ergänzende Festlegungen')
  t.blankLines(3)

  t.h1('7. Ort, Datum und eigenhändige Unterschrift')
  t.signatureRow('Ort, Datum', 'Unterschrift der vertretungsberechtigten Person')
}

// ════════════════════════════════════════════════════════════════
// Beiblatt — alles, was nicht Erklärung ist
// ════════════════════════════════════════════════════════════════
//
// Warum getrennt: Eine Urkunde, die der Bank vorgelegt wird, soll nichts
// enthalten als die Erklärung selbst. Jeder erklärende Satz darin ist eine
// Angriffsfläche und lädt zu Auslegung ein. Die Belehrungen sind trotzdem
// unverzichtbar — ohne sie unterschreibt jemand eine Immobilienvollmacht, die
// ohne Notar nichts wert ist. Also: vollständig, aber zum Abtrennen.

function drawWorksheet(t, d, _memorial) {
  const anlass = str(d?.anlass)

  t.text('BEIBLATT', { size: 18, style: 'bold', color: [15, 15, 15], gapAfter: 1.5 })
  t.text('Erläuterungen — nicht Bestandteil der Urkunden, vor der Unterschrift abzutrennen', { size: 10.5, color: SOFT, gapAfter: 3 })
  t.rule([120, 120, 120], 0.6)

  if (anlass) { t.h2('Warum diese Mappe entstanden ist'); t.text(anlass, { size: 10 }) }

  t.h1('Zur Vorsorgevollmacht (Teil 1)')
  t.callout('Was eine Vorsorgevollmacht bedeutet', [
    'Sie wirkt SOFORT, sobald sie unterschrieben und aus der Hand gegeben ist — nicht erst, wenn Ihnen etwas zustößt. Die bevollmächtigte Person kann damit über Ihre Konten verfügen und über Ihren Aufenthalt entscheiden, ohne dass ein Gericht das kontrolliert. Genau darin liegt ihr Vorteil gegenüber einer Betreuung, und genau darin ihr Risiko.',
    'Erteilen Sie sie deshalb nur einem Menschen, dem Sie ohne jeden Vorbehalt vertrauen.',
    'Sprechen Sie vorher mit dieser Person. Eine Vollmacht ist auch für sie eine Last, und niemand kann dazu verpflichtet werden.',
    'Die Vollmacht ist im Außenverhältnis bewusst unbedingt gestellt. Eine Vollmacht, die schon nach außen an eine Bedingung geknüpft ist („gilt erst, wenn zwei Ärzte bescheinigen …"), wird von Banken und Grundbuchämtern regelmäßig zurückgewiesen — sie versagt dann genau in dem Moment, für den sie gedacht war. Der Preis dafür: Alles hängt am Vertrauen zur bevollmächtigten Person.',
  ], AMBER)

  t.h2('Die Kästchen, die ohne Kreuz nicht gelten')
  t.bullet('§ 1829 BGB — ärztliche Maßnahmen mit Lebensgefahr: Ohne dieses Kreuz ist die Vollmacht in genau den Situationen unwirksam, in denen es am meisten darauf ankommt. Umgekehrt gilt: Ist sich die bevollmächtigte Person mit den Ärzten nicht einig, muss sie zusätzlich das Betreuungsgericht einschalten.')
  t.bullet('§§ 1831, 1832 BGB — freiheitsentziehende Maßnahmen und ärztliche Zwangsmaßnahmen: Sie bedürfen zusätzlich der Genehmigung des Betreuungsgerichts. Viele Menschen schließen diesen Punkt bewusst aus — das ist eine legitime Entscheidung und kein Versäumnis.')
  t.bullet('Immobilien: Für Grundstücksgeschäfte und für die Eintragung im Grundbuch verlangt das Gesetz eine NOTARIELL BEURKUNDETE Vollmacht. Ein selbst unterschriebenes Formular reicht dafür nicht aus, auch nicht mit beglaubigter Unterschrift. Dasselbe gilt für Verbraucherdarlehen und für Erklärungen gegenüber dem Handelsregister.')
  t.bullet('Schenkungen: Auch eine bevollmächtigte Person darf nur in dem Rahmen schenken, der einem Betreuer erlaubt ist (§ 1798 Abs. 3 BGB) — im Wesentlichen die üblichen Gelegenheitsgeschenke.')

  t.h2('Unterschrift, Beglaubigung, Aufbewahrung')
  t.bullet('Die Vollmacht muss eigenhändig unterschrieben sein. Lassen Sie die Unterschrift bei der Betreuungsbehörde Ihrer Stadt oder Ihres Landkreises beglaubigen (kostet wenige Euro) — viele Banken und Behörden verlangen das.')
  t.bullet('Viele Banken bestehen zusätzlich auf ihren eigenen Formularen. Klären Sie das mit Ihrer Bank, solange Sie es selbst können — ein Nachholen ist später nicht mehr möglich.')
  t.bullet('Eine Vollmacht nützt nur, wenn sie im Ernstfall zur Hand ist: Die bevollmächtigte Person muss das Original vorlegen können. Bewahren Sie es NICHT im Bankschließfach auf — ohne die Vollmacht kommt niemand daran.')
  t.bullet('Eintragung im Zentralen Vorsorgeregister der Bundesnotarkammer (www.vorsorgeregister.de) empfohlen; die Betreuungsgerichte fragen dort vor jeder Betreuerbestellung an.')
  t.bullet('Bestätigen Sie die Vollmacht alle ein bis zwei Jahre mit Datum und Unterschrift (Ziffer 8 in Teil 1).')
  t.bullet('Widerruf: Es genügt eine Erklärung gegenüber der bevollmächtigten Person; zusätzlich sollte die Urkunde zurückgefordert werden, weil sie sonst weiterhin verwendet werden kann.')

  t.h1('Zur Betreuungsverfügung (Teil 2)')
  t.text('Teil 2 greift nur, wenn die Vollmacht NICHT greift — etwa weil sie angefochten wird, eine Stelle sie nicht anerkennt oder die bevollmächtigte Person ausfällt. Ihr Vorschlag bindet das Betreuungsgericht, soweit er Ihrem Wohl nicht zuwiderläuft (§ 1816 Abs. 2 BGB). Das ist eine starke Wirkung — prüfen Sie den eingetragenen Namen besonders sorgfältig.', { size: 10 })

  t.h1('Zur Patientenverfügung (Teil 3)')
  t.callout('Was diese Mappe hier NICHT leisten kann', [
    'Eine Patientenverfügung wirkt nur, wenn sie hinreichend KONKRET ist: Die Rechtsprechung verlangt Festlegungen für benannte Behandlungssituationen. Eine allgemeine Formel wie „keine lebenserhaltenden Maßnahmen" genügt nicht. Deshalb sind die Situationen und die einzelnen Maßnahmen hier einzeln aufgeführt und einzeln angekreuzt.',
    'Was die einzelnen Festlegungen medizinisch bedeuten, kann Ihnen niemand außer einer Ärztin oder einem Arzt sagen. Diese Mappe hat das nicht erklärt und durfte es nicht erklären. Besprechen Sie Teil 3 vor der Unterschrift — der Gesprächsleitfaden, den diese Kategorie zusätzlich erzeugt, ist genau dafür gemacht.',
    'Ein leeres Kästchen heißt „nicht festgelegt". Es heißt NICHT „abgelehnt". Wo Sie sich nicht festlegen wollten, entscheidet im Ernstfall Ihre Vertretung nach Ihrem mutmaßlichen Willen — und stützt sich dabei auf Teil 4.',
  ], AMBER)

  t.h1('Zu den Wertvorstellungen (Teil 4)')
  t.text('Teil 4 ist absichtlich nicht bindend formuliert. Er ist trotzdem der Teil, der im Ernstfall am häufigsten gelesen wird: Keine Verfügung kann jede Situation vorwegnehmen, und dann zählt, was ein Mensch über sich selbst gesagt hat. Prüfen Sie die Sätze Wort für Wort — sie werden gelesen, wenn Sie selbst nichts mehr sagen können.', { size: 10 })

  t.h1('Zu den Vordrucken (Teile 7 und 8)')
  t.text('Diese beiden Blätter unterschreiben nicht Sie, sondern Ihre bevollmächtigte Person bzw. Ihre Vertretung. Sie liegen bei, damit im Ernstfall niemand suchen muss. Lassen Sie sie leer.', { size: 10 })

  const open = strList(d?.open_points)
  if (open.length) {
    t.h1('Vor der Unterschrift zu klären')
    for (const o of open) t.bullet(o, { box: true })
  }

  t.h1('Was Sie jetzt tun sollten')
  for (const step of [
    'Die Prüfliste am Anfang dieser Mappe Zeile für Zeile durchgehen. Jeder Name, jedes Datum, jede Anschrift wurde aus dem gesprochenen Wort übernommen.',
    'Mit den benannten Personen sprechen und fragen, ob sie die Aufgabe übernehmen würden. Niemand kann dazu verpflichtet werden.',
    'Die Sonderbefugnisse in Teil 1 noch einmal in Ruhe durchgehen — § 1829, §§ 1831/1832, Immobilien und Schenkungen. Sie sind die einzigen Punkte, die ohne ausdrückliches Kreuz nicht gelten.',
    'Teil 3 mit der Hausärztin oder dem Hausarzt besprechen, bevor Sie unterschreiben.',
    'Jeden Teil einzeln unterschreiben. Die Unterschrift unter Teil 1 bei der Betreuungsbehörde beglaubigen lassen; bei Immobilien, Darlehen oder Handelsregistereintrag zum Notar.',
    'Mit der Bank klären, ob sie zusätzlich ein eigenes Formular verlangt.',
    'Die Vollmacht im Zentralen Vorsorgeregister eintragen lassen und dafür sorgen, dass die bevollmächtigte Person im Ernstfall an das Original kommt.',
    'Teil 6 (Palliativ-Ampel) kopieren und dort hinterlegen, wo im Notfall gesucht wird — beim Pflegedienst, in der Einrichtung, zu Hause an der Kühlschranktür.',
    'Dieses Beiblatt abtrennen und getrennt aufbewahren.',
    'Alles alle ein bis zwei Jahre erneut lesen, bestätigen und bei Bedarf ändern oder widerrufen.',
  ]) t.bullet(step, { box: true })
}

// ════════════════════════════════════════════════════════════════
// Die Mappe
// ════════════════════════════════════════════════════════════════

export function buildPrecautionDoc(data, memorial) {
  const t = newForm()
  const d = data || {}
  const name = str(d?.person?.name) || str(memorial?.name)

  drawCover(t, d, memorial)

  const pV = t.newPage(); drawVerify(t, d)
  const p1 = t.newPage(); drawPoa(t, d, memorial)
  const p2 = t.newPage(); drawGuardianship(t, d, memorial)
  const p3 = t.newPage(); drawPatientDecree(t, d, memorial)
  const p4 = t.newPage(); drawValues(t, d, memorial)
  const p5 = t.newPage(); drawFuneral(t, d, memorial)
  const p6 = t.newPage(); drawAmpel(t, d, memorial)
  const p7 = t.newPage(); drawSubPoa(t, d, memorial)
  const p8 = t.newPage(); drawRepDecree(t, d, memorial)
  const pB = t.newPage(); drawWorksheet(t, d, memorial)

  const created = new Date().toLocaleDateString('de-DE')
  t.footerSections([
    { from: pV, label: 'Prüfliste' },
    { from: p1, label: 'Teil 1 · Vorsorgevollmacht' },
    { from: p2, label: 'Teil 2 · Betreuungsverfügung' },
    { from: p3, label: 'Teil 3 · Patientenverfügung' },
    { from: p4, label: 'Teil 4 · Wertvorstellungen' },
    { from: p5, label: 'Teil 5 · Bestattungsverfügung' },
    { from: p6, label: 'Teil 6 · Palliativ-Ampel' },
    { from: p7, label: 'Teil 7 · Untervollmacht (Vordruck)' },
    { from: p8, label: 'Teil 8 · Vertreterverfügung (Vordruck)' },
    { from: pB, label: 'Beiblatt · nicht Bestandteil der Urkunden' },
  ], `${name ? `${name} · ` : ''}Entwurf vom ${created}`)

  return t.doc
}

// Async allein wegen der Schriften: buildPrecautionDoc() zeichnet synchron, die
// eingebetteten Schriften müssen davor geladen sein (siehe pdfFonts.js).
export async function downloadPrecautionPdf(filename, data, memorial) {
  await loadPdfFonts()
  buildPrecautionDoc(data, memorial).save(filename)
}
