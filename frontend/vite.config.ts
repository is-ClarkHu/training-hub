import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Installable, offline-first PWA (SPEC §12.13, §14). Service worker precaches the
// app shell; the data layer is already offline via Dexie.
//
// `BASE_PATH` is injected by CI for GitHub Pages project sites (served from a
// subpath, e.g. /training-hub/); defaults to '/' for local dev and root hosting.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'vendor-charts'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('dexie')) return 'vendor-db'
          if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n'
          if (id.includes('react')) return 'vendor-react'
          return 'vendor'
        },
      },
    },
  },
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
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
})
