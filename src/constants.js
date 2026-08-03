// src/constants.js — kleine, geteilte Konstanten (kein Zyklus zwischen App/Views).

// Fassung des Einwilligungs-/Datenschutztextes. Bei JEDER inhaltlichen Änderung
// hochzählen — protokolliert wird sie an jedem Beitrag, damit belegbar ist, welchem
// Text zugestimmt wurde. Ein Wechsel löst nichts aus: Bestehende Beiträge behalten
// ihre Fassung, niemand muss erneut zustimmen.
export const CONSENT_VERSION = '1.8 (2026-08-03)'

// „Stand" der Datenschutzerklärung — ABGELEITET, nicht ein zweites Mal getippt.
// Genau das war der Widerspruch: Über einer Fassung vom 3. August stand „Stand:
// 2. August", weil das Datum an zwei Stellen gepflegt werden musste.
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export const CONSENT_DATE = (() => {
  const m = CONSENT_VERSION.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[3])}. ${MONATE[Number(m[2]) - 1]} ${m[1]}` : ''
})()

export const GENDERS = [
  { value: 'männlich', label: 'Männlich' },
  { value: 'weiblich', label: 'Weiblich' },
  { value: 'divers',   label: 'Divers'   },
  { value: 'keine Angabe', label: 'Keine Angabe' },
]

export const BOOK_VARIANTS = [
  { value: 1, title: 'Variante 1', sub: 'Alle Beiträge werden als separate Buchkapitel veröffentlicht.' },
  { value: 2, title: 'Variante 2', sub: 'Die Biographie wird aus allen Inhalten neu erstellt; einzelne Beiträge sind nicht mehr erkennbar.' },
  { value: null, title: 'Variante offen lassen', sub: 'Die Entscheidung fällt erst beim Erzeugen des Buchs; beide Fassungen bleiben möglich. Beitragende werden dann darauf hingewiesen, dass ihr Beitrag namentlich erscheinen KÖNNTE.' },
]
// ACHTUNG: memorials.book_variant ist in der Datenbank eine TEXT-Spalte — die
// Werte kommen als '1'/'2' zurück, nicht als Zahlen. Wer direkt mit === 1/2
// vergleicht, bekommt IMMER false. Genau daran scheiterte lange die Anzeige
// („Variante 1" bei jedem Buch) und später die Bindung der Generierung.
// Deshalb geht jeder Vergleich durch diese Funktion: '1'|1 → 1, '2'|2 → 2,
// alles andere (auch NULL) → null = „offen gelassen".
export function normVariant(v) {
  const n = parseInt(v, 10)
  return n === 1 ? 1 : n === 2 ? 2 : null
}

export const EMPTY_PICKUP = { name: '', addon: '', street: '', zip: '', city: '', country: 'Deutschland' }
