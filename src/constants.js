// src/constants.js — kleine, geteilte Konstanten (kein Zyklus zwischen App/Views).
export const CONSENT_VERSION = '1.4 (2026-06-22)'

export const GENDERS = [
  { value: 'männlich', label: 'Männlich' },
  { value: 'weiblich', label: 'Weiblich' },
  { value: 'divers',   label: 'Divers'   },
]

export const BOOK_VARIANTS = [
  { value: 1, title: 'Variante 1', sub: 'Alle Beiträge werden als separate Buchkapitel veröffentlicht.' },
  { value: 2, title: 'Variante 2', sub: 'Die Biographie wird aus allen Inhalten neu erstellt; einzelne Beiträge sind nicht mehr erkennbar.' },
]
export const EMPTY_PICKUP = { name: '', addon: '', street: '', zip: '', city: '', country: 'Deutschland' }
