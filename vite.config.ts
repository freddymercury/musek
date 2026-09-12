import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two apps, one repo: musek at /, the traffic game at /traffic.html.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        traffic: resolve(import.meta.dirname, 'traffic.html'),
      },
    },
  },
})
