// src/adminI18n.jsx
// Zweisprachigkeit des Admin-/Manager-Dashboards (Deutsch + Englisch).
//
// Bewusst OHNE Schlüssel-Wörterbuch: Die Views geben den deutschen Text und die
// englische Fassung direkt am Aufrufort an — `t('Zurück', 'Back')`. Vorteile:
// - Der deutsche Originaltext bleibt im Code lesbar (Default ist Deutsch).
// - Fehlt eine Übersetzung (noch nicht umgestellter String), erscheint einfach
//   Deutsch — jeder Zwischenstand ist also gefahrlos deploybar.
// - Kein zweites File, das mit dem Code auseinanderläuft.
//
// Die Sprache ist eine Einstellung des Menschen vor dem Dashboard (Manager/Admin),
// nicht der Daten — deshalb localStorage pro Browser, nicht die Datenbank.
import { createContext, useContext, useState, useCallback } from 'react'

const KEY = 'lw_admin_lang'
const AdminLangContext = createContext({ lang: 'de', setLang: () => {}, t: (de) => de })

export function AdminLangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'de' } catch { return 'de' }
  })
  const setLang = useCallback((l) => {
    const v = l === 'en' ? 'en' : 'de'
    setLangState(v)
    try { localStorage.setItem(KEY, v) } catch { /* privater Modus */ }
  }, [])
  // t(de, en): Englisch nur, wenn umgestellt UND eine englische Fassung übergeben
  // wurde — sonst Deutsch.
  const t = useCallback((de, en) => (lang === 'en' && en != null ? en : de), [lang])
  return <AdminLangContext.Provider value={{ lang, setLang, t }}>{children}</AdminLangContext.Provider>
}

export function useAdminT() { return useContext(AdminLangContext).t }
export function useAdminLang() { const { lang, setLang } = useContext(AdminLangContext); return { lang, setLang } }

// Kompakter DE/EN-Umschalter für die Kopfleisten der Views (neben „Abmelden").
export function AdminLangToggle({ style }) {
  const { lang, setLang } = useAdminLang()
  const btn = (code, label) => (
    <button
      key={code}
      onClick={() => setLang(code)}
      aria-pressed={lang === code}
      style={{
        fontSize: 12, padding: '5px 9px', border: '1px solid #e7e5e4', cursor: 'pointer',
        background: lang === code ? '#1c1917' : '#fff',
        color: lang === code ? '#fff' : '#78716c',
        fontWeight: lang === code ? 600 : 400,
        borderRadius: code === 'de' ? '6px 0 0 6px' : '0 6px 6px 0',
        marginLeft: code === 'de' ? 0 : -1,
      }}
    >{label}</button>
  )
  return (
    <span style={{ display: 'inline-flex', ...style }} title="Dashboard-Sprache / Dashboard language">
      {btn('de', 'DE')}{btn('en', 'EN')}
    </span>
  )
}
