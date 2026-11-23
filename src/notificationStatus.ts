import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

// NOTE: Whether this device gets pushes. Lives apart from push.ts so Message
// can name it without an import cycle.
export const NotificationStatus = defineTaggedUnion({
  Checking: {},
  Unsupported: {},
  NeedsInstall: {},
  Off: {},
  Working: {},
  On: {},
  Blocked: {},
  Failed: { reason: Schema.String },
})
export type NotificationStatus = typeof NotificationStatus.Type
