import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// PWA-konfig: appen kan installeras på hemskärmen.
// Service workern cachar skalet. OBS: någon offline-kö för inlägg finns INTE
// ännu — inlägg som skrivs utan nät går förlorade. Se Fas 1.5 i roadmapen.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Rapportapp',
        short_name: 'Rapport',
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
