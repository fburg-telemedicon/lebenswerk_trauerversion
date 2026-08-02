// src/constants.js — kleine, geteilte Konstanten (kein Zyklus zwischen App/Views).
export const CONSENT_VERSION = '1.7 (2026-08-02)'

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
