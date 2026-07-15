// api/_lib/delete-memorial.js
// Gemeinsame vollständige Löschung eines Gedenkbuchs (Art. 17 DSGVO).
// Genutzt von api/admin/memorials.js (manuelles Löschen) und
// api/cron/purge.js (automatische 90-Tage-Löschung).

const IMAGE_BUCKET = 'memorial-images'

// Löscht ALLE Storage-Objekte unter <CODE>/ im Bilder-Bucket. Listet den
// ganzen Ordner, damit auch verwaiste/neu generierte Bilder erfasst werden.
// Wirft NICHT — gibt eine Liste von Warnungen zurück (leer = alles gelöscht),
// damit die DB-Löschung in jedem Fall durchläuft.
async function deleteMemorialImages(supabase, code) {
  const warnings = []
  try {
    const { data: files, error: listErr } =
      await supabase.storage.from(IMAGE_BUCKET).list(code, { limit: 1000 })
    if (listErr) { warnings.push(`Storage-Liste fehlgeschlagen: ${listErr.message}`); return warnings }
    const paths = (files || []).filter(f => f?.name).map(f => `${code}/${f.name}`)
    if (paths.length === 0) return warnings
    const { error: rmErr } = await supabase.storage.from(IMAGE_BUCKET).remove(paths)
    if (rmErr) warnings.push(`Storage-Löschung fehlgeschlagen: ${rmErr.message}`)
  } catch (e) {
    warnings.push(`Storage-Löschung Ausnahme: ${e.message}`)
  }
  return warnings
}

// Vollständige Löschung in dieser Reihenfolge:
// 1. Storage-Bilder (best effort), 2. cost_events, 3. contributions, 4. memorial,
// 5. Endnutzer-Zugang (Lebenswerk).
// Gibt die Storage-/Konto-Warnungen zurück. Wirft bei DB-Fehlern der Kern-Tabellen.
async function deleteMemorialCompletely(supabase, code) {
  const warnings = await deleteMemorialImages(supabase, code)
  const { error: costErr } = await supabase.from('cost_events').delete().eq('memorial_id', code)
  if (costErr) throw costErr
  const { error: cErr } = await supabase.from('contributions').delete().eq('memorial_id', code)
  if (cErr) throw cErr
  const { error: mErr } = await supabase.from('memorials').delete().eq('id', code)
  if (mErr) throw mErr
  // Endnutzer-Zugang: Beim Lebenswerk hängt das eigene Konto des Erzählers an
  // GENAU diesem Buch (app_users.enduser_memorial). Ohne das Buch ist es zwecklos
  // — löschen, damit die E-Mail-Adresse wieder für neue Einladungen frei wird.
  // Best effort: schlägt das fehl, bleibt das Buch trotzdem gelöscht.
  try {
    const { error: euErr } = await supabase
      .from('app_users').delete().eq('enduser_memorial', code).eq('is_enduser', true)
    if (euErr) warnings.push(`Endnutzer-Konto-Löschung fehlgeschlagen: ${euErr.message}`)
  } catch (e) {
    warnings.push(`Endnutzer-Konto-Löschung Ausnahme: ${e.message}`)
  }
  if (warnings.length) console.warn('Löschung memorial', code, 'Warnungen:', warnings)
  return warnings
}

// Aufbewahrungs-Löschung (90-Tage-Regel): löscht NUR die einzelnen Beiträge
// (personenbezogene Interview-Daten) und das Änderungs-/Prüfprotokoll. Das
// Gedenkbuch bleibt vollständig erhalten (Buch, Rede, Bilder, Dashboard-
// Eintrag, Ansehen/DOCX). Pro gelöschtem Beitrag wird in purge_info ein
// Eintrag (wann + warum) abgelegt. cost_events bleiben (keine PII, Buchhaltung).
async function purgeMemorialContributions(supabase, code, reason) {
  const now = new Date().toISOString()
  // Beitrags-IDs holen (id = Zufallstoken, keine PII) – für die Protokoll-Einträge.
  const { data: rows, error: selErr } = await supabase
    .from('contributions').select('id').eq('memorial_id', code)
  if (selErr) throw selErr
  const ids = (rows || []).map(r => r.id)

  // Beiträge löschen.
  const { error: delErr } = await supabase.from('contributions').delete().eq('memorial_id', code)
  if (delErr) throw delErr

  // Hochgeladene Roh-Fotos sind ebenfalls personenbezogene Rohdaten und werden
  // mit den Beiträgen aufbewahrungsgelöscht. Die ins Buch übernommenen
  // (komponierten/generierten) Bilder bleiben erhalten – sie sind Teil des
  // aufbewahrten Produkts und liegen als eigene <uuid>.png-Dateien (NICHT in
  // uploaded_images). Best effort: Storage-Fehler dürfen den Purge nicht stoppen.
  const { data: cur } = await supabase.from('memorials').select('uploaded_images').eq('id', code).single()
  const uploads = Array.isArray(cur?.uploaded_images) ? cur.uploaded_images : []
  const uploadPaths = uploads.flatMap(u => [u?.path, u?.thumb_path].filter(Boolean))
  if (uploadPaths.length) {
    try { await supabase.storage.from(IMAGE_BUCKET).remove(uploadPaths) }
    catch (e) { console.warn('Purge: Roh-Uploads Storage-Löschung:', e.message) }
  }

  // Protokoll je Beitrag + Gesamtmarker; Änderungs-/Prüfprotokoll mitlöschen;
  // uploaded_images leeren (Rohfotos sind nun weg).
  const purge_info = {
    purged_at: now,
    reason,
    contributions: ids.map(id => ({ ref: id, deleted_at: now, reason })),
    ...(uploadPaths.length ? { uploaded_images_purged: uploads.length } : {}),
  }
  const { error: updErr } = await supabase
    .from('memorials').update({ purge_info, content_reports: null, uploaded_images: [] }).eq('id', code)
  if (updErr) throw updErr

  return { count: ids.length, purge_info }
}

module.exports = { IMAGE_BUCKET, deleteMemorialImages, deleteMemorialCompletely, purgeMemorialContributions }
