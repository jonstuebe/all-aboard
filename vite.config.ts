import { defineConfig, type Plugin } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

// NOTE: Link previews need absolute URLs. A build uses the production address
// unless SITE_URL (no trailing slash) says otherwise; the dev server uses
// root-relative paths.
const PRODUCTION_URL = 'https://all-aboard.jonstuebe.com'

const siteUrl = (): Plugin => {
  let base = ''
  return {
    name: 'site-url',
    configResolved: config => {
      base = (
        process.env.SITE_URL ??
        (config.command === 'build' ? PRODUCTION_URL : '')
      ).replace(/\/$/, '')
    },
    transformIndexHtml: html => html.replaceAll('%SITE_URL%', base),
  }
}

// NOTE: Each build gets an id, baked into the bundle as __BUILD_ID__ and
// written to /version.json; an open app compares the two to offer a reload
// (src/appUpdate.ts).
const BUILD_ID = `${Date.now().toString(36)}`

const buildVersion = (): Plugin => ({
  name: 'build-version',
  apply: 'build',
  config: () => ({ define: { __BUILD_ID__: JSON.stringify(BUILD_ID) } }),
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ id: BUILD_ID }),
    })
  },
})

export default defineConfig({
  plugins: [tailwindcss(), foldkit(), siteUrl(), buildVersion()],
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
