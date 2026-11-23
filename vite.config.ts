import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5188),
    strictPort: true,
    allowedHosts: ['.ts.net'],
    // NOTE: The game server is the local Worker (`bun run dev:worker`).
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.WORKER_PORT ?? 8790}`,
        ws: true,
      },
    },
  },
})
