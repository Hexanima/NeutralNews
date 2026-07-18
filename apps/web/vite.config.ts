import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      'app-domain': fileURLToPath(new URL('../../domain/src/index.ts', import.meta.url)),
    },
  },
  plugins: [react()],
})
