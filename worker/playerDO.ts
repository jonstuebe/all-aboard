import { DurableObject } from 'cloudflare:workers'

import type { Env } from './env'

// NOTE: One PlayerDO per device. The first request from a device stores a
// hash of its secret (trust on first use); every later request must present
// the same secret. There is no sign-in, so losing the secret loses the games.

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export class PlayerDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK (id = 1), secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL)',
      )
    })
  }

  async authenticate(secret: string): Promise<boolean> {
    if (secret.length < 16 || secret.length > 128) {
      return false
    }
    const hash = await sha256Hex(secret)
    const rows = this.ctx.storage.sql
      .exec<{ secret_hash: string }>('SELECT secret_hash FROM identity WHERE id = 1')
      .toArray()
    const stored = rows[0]
    if (stored === undefined) {
      this.ctx.storage.sql.exec(
        'INSERT INTO identity (id, secret_hash, created_at) VALUES (1, ?, ?)',
        hash,
        Date.now(),
      )
      return true
    }
    return stored.secret_hash === hash
  }
}
