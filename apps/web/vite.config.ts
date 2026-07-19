import { fileURLToPath } from 'node:url'

import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

const resolvePort = (
  value: string | undefined,
  defaultPort: number,
): number => Number(value ?? defaultPort)

export const createViteConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): UserConfig => {
  const apiPort = resolvePort(environment.API_PORT ?? environment.PORT, 3000)

  return {
    resolve: {
      alias: {
        'app-domain': fileURLToPath(new URL('../../domain/src/index.ts', import.meta.url)),
      },
    },
    server: {
      port: resolvePort(environment.WEB_PORT, 5173),
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    plugins: [react()],
  }
}

// https://vite.dev/config/
export default defineConfig(createViteConfig())
