import { Schema } from 'effect'

// NOTE: Whether the table screen plays sound. Kept apart from sound.ts so the
// Message union can name it without importing the synthesiser.
export const SoundSetting = Schema.Literals(['Off', 'On'])
export type SoundSetting = typeof SoundSetting.Type
