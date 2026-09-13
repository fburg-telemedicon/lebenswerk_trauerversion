import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Erlaubt der SPA, laufzeit-neutrale CommonJS-Module aus api/_lib direkt zu
    // importieren (api/_lib/transcript-core.js, api/_lib/repetition.js), statt
    // sie nach src/ zu kopieren. Ohne diese Zeile wendet Vite den CJS-Transform
    // nur auf node_modules an und der Build bricht mit "... is not exported by"
    // ab. /node_modules/ ist der Vite-Standard und muss hier mit aufgezaehlt
    // werden, weil diese Angabe ihn ersetzt statt ihn zu ergaenzen.
    // Die Zeichenklasse deckt beide Pfadtrenner ab (Vite normalisiert zwar auf
    // "/", der Build lief aber schon unter Windows mit Backslashes).
    commonjsOptions: { include: [/api[\\/]_lib[\\/]/, /node_modules/] },
  },
})
