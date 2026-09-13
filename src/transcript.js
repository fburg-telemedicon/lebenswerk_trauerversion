// src/transcript.js  (Frontend, ESM)
// Undo/Redo-Helfer für den Transkript-Bericht. Die eigentliche Prüfung läuft
// serverseitig (api/cron/transcript-check.js).
//
// Die Logik selbst steht EINMAL in api/_lib/transcript-core.js und wird von dort
// auch vom Backend benutzt. Dass die SPA eine CommonJS-Datei importieren kann,
// liegt an `build.commonjsOptions.include` in vite.config.js — siehe den
// Kommentar dort. Früher war das hier eine Handkopie, die mit dem Original
// auseinanderlaufen konnte.
export { applyCorrectionToMessages, revertCorrectionInMessages } from '../api/_lib/transcript-core.js'
