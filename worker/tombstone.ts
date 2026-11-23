import { Option, Schema } from 'effect'

import type { Env } from './env'

// NOTE: A deleted game leaves code -> { reason, deletedAt } in KV, so an old
// invite link or menu entry can explain what happened to it.

export const Tombstone = Schema.Struct({
  reason: Schema.String,
  deletedAt: Schema.Number,
})
export type Tombstone = typeof Tombstone.Type

const TombstoneJson = Schema.fromJsonString(Tombstone)

const key = (code: string): string => `tombstone:${code}`

export const readTombstone = async (
  env: Env,
  code: string,
): Promise<Option.Option<Tombstone>> => {
  const raw = await env.TOMBSTONES.get(key(code))
  return raw === null
    ? Option.none()
    : Schema.decodeUnknownOption(TombstoneJson)(raw)
}

export const writeTombstone = async (
  env: Env,
  code: string,
  tombstone: Tombstone,
): Promise<void> => {
  await env.TOMBSTONES.put(
    key(code),
    Schema.encodeSync(TombstoneJson)(tombstone),
  )
}
