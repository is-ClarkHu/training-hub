import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Installable, offline-first PWA (SPEC §12.13, §14). Service worker precaches the
// app shell; the data layer is already offline via Dexie.
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'training-hub',
        short_name: 'training-hub',
        description: 'Offline-first strength & sport training log',
        theme_color: '#0c151c',
        background_color: '#0c151c',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
})
