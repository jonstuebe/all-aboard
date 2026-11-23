import type { GameDO } from './gameDO'
import type { PlayerDO } from './playerDO'

export interface Env {
  readonly GAMES: DurableObjectNamespace<GameDO>
  readonly PLAYERS: DurableObjectNamespace<PlayerDO>
  readonly TOMBSTONES: KVNamespace
  readonly ASSETS?: Fetcher
  readonly BOT_DELAY_MS?: string
  readonly TEST_HOOKS?: string
  readonly VAPID_PUBLIC_KEY?: string
  readonly VAPID_PRIVATE_KEY?: string
  readonly VAPID_SUBJECT?: string
}
