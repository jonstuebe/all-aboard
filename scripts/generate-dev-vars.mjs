import { existsSync, writeFileSync } from 'node:fs'

import { generateVapidKeys } from './vapid.mjs'

// NOTE: Writes .dev.vars (gitignored) with fresh VAPID keys for wrangler dev.
// Never commit the output. Pass --force to replace an existing file.
const path = new URL('../.dev.vars', import.meta.url)
if (existsSync(path) && !process.argv.includes('--force')) {
  console.log('.dev.vars already exists; pass --force to replace it.')
  process.exit(0)
}
const { publicKey, privateKey } = await generateVapidKeys()
writeFileSync(
  path,
  [
    `VAPID_PUBLIC_KEY="${publicKey}"`,
    `VAPID_PRIVATE_KEY="${privateKey}"`,
    'VAPID_SUBJECT="mailto:all-aboard@example.invalid"',
    '',
  ].join('\n'),
  { mode: 0o600 },
)
console.log('Wrote .dev.vars with new VAPID keys.')
