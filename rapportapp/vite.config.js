import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// PWA-konfig: appen kan installeras på hemskärmen.
// Service workern cachar skalet. OBS: någon offline-kö för inlägg finns INTE
// ännu — inlägg som skrivs utan nät går förlorade. Se Fas 1.5 i roadmapen.
// Versionen bakas in i bundlen. Utan den går det inte att svara på "vilken
// version kör din telefon?" när en värd ringer mitt i ett pass.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const byggd = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`${version} · ${byggd}`)
  },
  plugins: [
    react(),
    VitePWA({
      // autoUpdate hämtar hem den nya service workern, men bara när sidan
      // laddas. En installerad PWA som ligger kvar i app-växlaren mellan
      // passen laddas aldrig om — därför registrerar main.jsx sig själv och
      // frågar användaren i stället för att vänta på en kallstart.
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Raptr',
        short_name: 'Raptr',
        description: 'Passrapportering för hotellvärdar',
        theme_color: '#0d9488',
        background_color: '#f2f5f4',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    // Låst tidszon: appen är byggd för svenska nattpass, och testerna för
    // verksamhetsdygn är meningslösa om de körs i UTC på en CI-maskin.
    env: { TZ: 'Europe/Stockholm' },
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}']
  }
})
