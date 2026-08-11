/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '牌局',
        short_name: '牌局',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'] },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3100',
      '/ws': { target: 'ws://127.0.0.1:3100', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-tsc/**'],
  },
})
