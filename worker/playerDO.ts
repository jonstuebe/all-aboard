import { DurableObject } from 'cloudflare:workers'
import { Array, Option } from 'effect'

import { type Stats, addResult, emptyStats } from '../src/domain/results'
import {
  type MenuEntry,
  PAST_GAME_TTL_MS,
  decodeMenuEntry,
  decodeSeatResult,
  encodeMenu,
  encodeMenuEntry,
} from '../src/protocol'
import type { Env } from './env'

// NOTE: One PlayerDO per device. The first request from a device stores a
// hash of its secret (trust on first use); every later request must present
// the same secret. There is no sign-in, so losing the secret loses the games.
//
// It also keeps this device's menu (one row per game, written by the GameDO)
// and its stats. Stats live here so they outlast deleted games.

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const isPast = (entry: MenuEntry): boolean =>
  entry.status === 'Finished' || entry.status === 'Left' || entry.status === 'Gone'

type StatsRow = Readonly<{
  games_played: number
  wins: number
  total_score: number
  longest_route: number
  tickets_completed: number
}>

export class PlayerDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql
      sql.exec(
        'CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK (id = 1), secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL)',
      )
      sql.exec(
        'CREATE TABLE IF NOT EXISTS games (code TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)',
      )
      sql.exec(
        'CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY CHECK (id = 1), games_played INTEGER NOT NULL, wins INTEGER NOT NULL, total_score INTEGER NOT NULL, longest_route INTEGER NOT NULL, tickets_completed INTEGER NOT NULL)',
      )
      sql.exec(
        'CREATE TABLE IF NOT EXISTS recorded (result_key TEXT PRIMARY KEY, at INTEGER NOT NULL)',
      )
    })
  }

  // IDENTITY

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

  // MENU

  async upsertGame(entryJson: string): Promise<void> {
    Option.match(decodeMenuEntry(entryJson), {
      onNone: () => undefined,
      onSome: entry => this.writeEntry(entry),
    })
  }

  private writeEntry(entry: MenuEntry): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO games (code, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (code) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
      entry.code,
      encodeMenuEntry(entry),
      entry.updatedAt,
    )
  }

  async removeGame(code: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM games WHERE code = ?', code)
  }

  async markGone(code: string, reason: string, at: number): Promise<void> {
    Option.match(this.entry(code), {
      onNone: () => undefined,
      onSome: entry =>
        this.writeEntry({
            ...entry,
            status: entry.status === 'Left' ? 'Left' : 'Gone',
            maybeReason: Option.some(reason),
            updatedAt: entry.status === 'Finished' || entry.status === 'Left'
              ? entry.updatedAt
              : at,
            maybePingAvailableAt: Option.none(),
          }),
    })
  }

  private entry(code: string): Option.Option<MenuEntry> {
    const row = this.ctx.storage.sql
      .exec<{ json: string }>('SELECT json FROM games WHERE code = ?', code)
      .toArray()[0]
    return row === undefined ? Option.none() : decodeMenuEntry(row.json)
  }

  async menuJson(now: number): Promise<string> {
    const sql = this.ctx.storage.sql
    const entries = Array.getSomes(
      Array.map(
        sql
          .exec<{ json: string }>('SELECT json FROM games ORDER BY updated_at DESC')
          .toArray(),
        row => decodeMenuEntry(row.json),
      ),
    )
    const isExpired = (entry: MenuEntry): boolean =>
      isPast(entry) && now - entry.updatedAt > PAST_GAME_TTL_MS
    const expired = Array.filter(entries, isExpired)
    const kept = Array.filter(entries, entry => !isExpired(entry))
    Array.forEach(expired, entry =>
      sql.exec('DELETE FROM games WHERE code = ?', entry.code),
    )
    return encodeMenu({ games: kept, stats: this.stats() })
  }

  // STATS

  private stats(): Stats {
    const row = this.ctx.storage.sql
      .exec<StatsRow>('SELECT * FROM stats WHERE id = 1')
      .toArray()[0]
    return row === undefined
      ? emptyStats
      : {
          gamesPlayed: row.games_played,
          wins: row.wins,
          totalScore: row.total_score,
          longestRoute: row.longest_route,
          ticketsCompleted: row.tickets_completed,
        }
  }

  // NOTE: Each result has a key (a friend game's code and round, or the id a
  // device gave a local bot game), so a retried post counts once.
  async recordResult(resultKey: string, resultJson: string): Promise<boolean> {
    const sql = this.ctx.storage.sql
    const isRecorded =
      sql
        .exec('SELECT result_key FROM recorded WHERE result_key = ?', resultKey)
        .toArray().length > 0
    return Option.match(decodeSeatResult(resultJson), {
      onNone: () => false,
      onSome: result => {
        if (isRecorded) {
          return false
        }
        const next = addResult(this.stats(), result)
        sql.exec(
          'INSERT INTO stats (id, games_played, wins, total_score, longest_route, tickets_completed) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET games_played = excluded.games_played, wins = excluded.wins, total_score = excluded.total_score, longest_route = excluded.longest_route, tickets_completed = excluded.tickets_completed',
          next.gamesPlayed,
          next.wins,
          next.totalScore,
          next.longestRoute,
          next.ticketsCompleted,
        )
        sql.exec(
          'INSERT INTO recorded (result_key, at) VALUES (?, ?)',
          resultKey,
          Date.now(),
        )
        return true
      },
    })
  }
}
