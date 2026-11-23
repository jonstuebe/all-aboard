import { defineConfig } from 'vitest/config'

import { cloudflareTest } from '@cloudflare/vitest-plugin'

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
              bindings: { TEST_HOOKS: '1', BOT_DELAY_MS: '5' },
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
