import { defineConfig } from 'vitest/config'

import { cloudflareTest } from '@cloudflare/vitest-plugin'

// @ts-expect-error -- a plain .mjs helper shared with the dev-vars script
import { generateVapidKeys } from './scripts/vapid.mjs'

// NOTE: Tests get a throwaway VAPID key pair on every run, never one on disk.
const vapid: { publicKey: string; privateKey: string } = await generateVapidKeys()

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'client',
          include: ['src/**/*.{test,spec}.ts'],
          environment: 'happy-dom',
          setupFiles: ['./src/vitest-setup.ts'],
          server: {
            deps: {
              inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
            },
          },
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                TEST_HOOKS: '1',
                BOT_DELAY_MS: '5',
                VAPID_PUBLIC_KEY: vapid.publicKey,
                VAPID_PRIVATE_KEY: vapid.privateKey,
                VAPID_SUBJECT: 'mailto:test@example.invalid',
              },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['worker/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
})
