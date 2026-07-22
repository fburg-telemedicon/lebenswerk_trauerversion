// api/_lib/access.js
// Eigentums-/Zugriffsprüfung für Admin-Endpunkte (Mehrbenutzer-Isolation).
//
// checkAuth bestätigt nur, DASS jemand eingeloggt ist – nicht, dass ihm das
// per code/id adressierte Gedenkbuch gehört. Ohne diese zusätzliche Prüfung
// könnte ein Nicht-Admin-Benutzer über die Admin-Endpunkte fremde Bücher,
// Beiträge, Kosten usw. lesen/ändern/löschen (IDOR). Diese Helfer schließen
// die Lücke an einer zentralen Stelle.

const { canAccessCategory } = require('./auth')

// Liefert das Gedenkbuch nur, wenn der eingeloggte Benutzer darauf zugreifen darf.
//   Admin/Superadmin : immer.
//   Sonst            : nur eigene Bücher (owner_user == uid) in erlaubter Kategorie.
// Nicht zugängliche ODER fehlende Bücher -> 404 (ein Nicht-Eigentümer soll nicht
// unterscheiden können, ob ein Code existiert -> keine Enumeration).
// Rückgabe: { memorial } bei Erfolg, sonst { status, error }.
async function loadAccessibleMemorial(supabase, auth, code, columns = 'id, owner_user, product_category') {
  const c = (code || '').toUpperCase().trim()
  if (!c) return { status: 400, error: 'code fehlt.' }
  // owner_user/product_category für die Prüfung immer mitladen.
  const sel = /owner_user/.test(columns) && /product_category/.test(columns)
    ? columns
    : `${columns}, owner_user, product_category`
  const { data: m, error } = await supabase
    .from('memorials').select(sel).eq('id', c).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!m) return { status: 404, error: 'Gedenkbuch nicht gefunden.' }
  if (auth.admin) return { memorial: m }
  if (auth.uid && m.owner_user === auth.uid && canAccessCategory(auth, m.product_category)) {
    return { memorial: m }
  }
  return { status: 404, error: 'Gedenkbuch nicht gefunden.' }
}

// Wie oben, aber adressiert über eine Beitrags-ID: lädt den Beitrag, ermittelt
// sein Gedenkbuch und prüft den Zugriff darauf. Verschleiert fehlende Rechte
// ebenfalls als 404 ("Beitrag nicht gefunden").
// Rückgabe: { contribution, memorial } bei Erfolg, sonst { status, error }.
async function loadAccessibleContribution(supabase, auth, id) {
  const cid = (id || '').trim()
  if (!cid) return { status: 400, error: 'id fehlt.' }
  const { data: contrib, error } = await supabase
    .from('contributions').select('id, memorial_id').eq('id', cid).maybeSingle()
  if (error) return { status: 500, error: error.message }
  if (!contrib) return { status: 404, error: 'Beitrag nicht gefunden.' }
  const access = await loadAccessibleMemorial(supabase, auth, contrib.memorial_id)
  if (access.error) {
    return access.status === 404
      ? { status: 404, error: 'Beitrag nicht gefunden.' }
      : { status: access.status, error: access.error }
  }
  return { contribution: contrib, memorial: access.memorial }
}

// Existenzprüfung für die öffentlichen (unauthentifizierten) KI-Proxies.
// Diese Endpunkte müssen offen bleiben (Beitragenden-Flow ohne Login), sollen
// aber nicht als anonymer, beliebiger KI-Proxy auf fremde Rechnung
// missbraucht werden können. Indem ein gültiger, existierender memorialCode
// verlangt wird, sinkt die Hürde von "Zero-Knowledge" auf "braucht einen
// echten Code". Wirft bei DB-Fehler (→ 500 im Handler, wie bisher).
async function memorialExists(supabase, code) {
  const c = (code || '').toUpperCase().trim()
  if (!c) return false
  const { data, error } = await supabase
    .from('memorials').select('id').eq('id', c).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

// Öffentlichen Code auflösen: BUCH-Code oder GAST-Code (Gastbeiträge zum
// Lebenswerk). Der Gast-Code ist ein eigenes Geheimnis und NICHT der Buch-Code —
// beim Lebenswerk öffnet der Buch-Code den Endnutzer-Bereich (Einstellungen,
// Korrekturabzug, Buchbearbeitung), ein Gast darf davon nichts sehen.
//
// Deshalb dieser eine Resolver, den jeder öffentliche Endpunkt benutzt:
//   • intern wird IMMER mit `id` (dem echten Buch-Code) gearbeitet — sonst
//     scheitert jeder Beitrag am Fremdschlüssel contributions.memorial_id;
//   • nach außen bleibt `code` (der Code, den der Aufrufer geschickt hat), damit
//     der echte Buch-Code den Gast-Browser nie erreicht.
// Rückgabe: { id, guest, code } oder null (unbekannt/gesperrt).
async function resolvePublicCode(supabase, code) {
  const c = (code || '').toUpperCase().trim()
  if (!c) return null
  const { data, error } = await supabase
    .from('memorials').select('id').eq('id', c).maybeSingle()
  if (error) throw error
  if (data) return { id: data.id, guest: false, code: c }
  // Kein Buch-Code → Gast-Code? Ein ausgeschalteter Gastlink (guest_enabled =
  // false) gilt als unbekannt, damit das Abschalten sofort greift. Fehlen die
  // Spalten noch (Migration nicht gelaufen), gibt es eben keine Gastcodes.
  const { data: g, error: gErr } = await supabase
    .from('memorials').select('id, guest_enabled').eq('guest_code', c).maybeSingle()
  if (gErr) {
    if (/guest_code|guest_enabled|column/i.test(gErr.message || '')) return null
    throw gErr
  }
  if (!g || g.guest_enabled !== true) return null
  return { id: g.id, guest: true, code: c }
}

module.exports = { loadAccessibleMemorial, loadAccessibleContribution, memorialExists, resolvePublicCode }
