import { Array, Effect, Equal, Number, Option, Schema, pipe } from 'effect'
import { Command, ManagedResource } from 'foldkit'

import { routeById } from './domain/board'
import type { ClientView } from './domain/clientView'
import { Message } from './message'
import type { Standing } from './model'
import {
  type Recap,
  maybeSpotlitPlayer,
  playerRecap,
} from './recap'

// NOTE: Sound for the table screen. Every effect is synthesised with Web
// Audio, so there are no audio files. What to play is worked out purely, by
// comparing the screen before and after each update (see soundCommands in
// main.ts); the PlaySounds Command only renders the cues. Browsers keep audio
// locked until someone taps, so sound starts Off and the person turns it on.

// MODEL

export const SoundName = Schema.Literals([
  'Turn',
  'Card',
  'Ticket',
  'Claim',
  'FinalRound',
  'GameOver',
  'Reveal',
  'RouteTick',
  'TicketDone',
  'TicketMissed',
  'Total',
  'WinnerTotal',
  'Scoreboard',
  'RowTick',
])
export type SoundName = typeof SoundName.Type

export const Cue = Schema.Struct({
  sound: SoundName,
  at: Schema.Number,
  size: Schema.Number,
})
export type Cue = typeof Cue.Type

// NOTE: Game cues play over each other; a new Recap cue list replaces the
// last one, so tapping another player cuts the previous reveal short.
export const SoundChannel = Schema.Literals(['Game', 'Recap'])
export type SoundChannel = typeof SoundChannel.Type

const cue = (sound: SoundName, at = 0, size = 0): Cue => ({ sound, at, size })

// CUES: GAME

const sum = (values: ReadonlyArray<number>): number =>
  Array.reduce(values, 0, (total, value) => total + value)

const TURN_CHIME_DELAY = 0.7

export const gameCues = (
  before: ClientView,
  after: ClientView,
): ReadonlyArray<Cue> => {
  if (after.phase._tag === 'GameOver') {
    return before.phase._tag === 'GameOver' ? [] : [cue('GameOver')]
  }
  const newClaims = Array.drop(after.claims, before.claims.length)
  const action: ReadonlyArray<Cue> = Array.match(newClaims, {
    onNonEmpty: claims => [
      cue(
        'Claim',
        0,
        pipe(
          claims,
          Array.map(claim => routeById(claim.routeId).length),
          Array.reduce(1, Number.max),
        ),
      ),
    ],
    onEmpty: () =>
      sum(Array.map(after.players, player => player.ticketCount)) >
      sum(Array.map(before.players, player => player.ticketCount))
        ? [cue('Ticket')]
        : sum(Array.map(after.players, player => player.handCount)) >
            sum(Array.map(before.players, player => player.handCount))
          ? [cue('Card')]
          : [],
  })
  const finalRound =
    Option.isNone(before.maybeFinalTurnsLeft) &&
    Option.isSome(after.maybeFinalTurnsLeft)
      ? [cue('FinalRound', 0.4)]
      : []
  const turn =
    after.phase._tag === 'Playing' &&
    (before.phase._tag !== 'Playing' ||
      before.currentPlayerIndex !== after.currentPlayerIndex)
      ? [cue('Turn', Array.isReadonlyArrayNonEmpty(action) ? TURN_CHIME_DELAY : 0)]
      : []
  return [...action, ...finalRound, ...turn]
}

// CUES: RECAP

// NOTE: These offsets follow the reveal animations in watch.css: routes
// light up 160ms apart from 200ms, tickets land 450ms apart from about 1s,
// the total pops after the last ticket, and score rows slide in 250ms apart.
const ROUTE_START = 0.25
const ROUTE_GAP = 0.16
const TICKET_START = 1.05
const TICKET_GAP = 0.45
const TOTAL_AFTER_TICKETS = 1.75
const ROW_START = 0.35
const ROW_GAP = 0.25

export const recapCues = (
  before: Recap,
  after: Recap,
  view: ClientView,
  revealedTickets: ReadonlyArray<ReadonlyArray<string>>,
  standings: ReadonlyArray<Standing>,
): ReadonlyArray<Cue> => {
  const isNewStop =
    before.run !== after.run ||
    before.stage._tag !== after.stage._tag ||
    !Option.makeEquivalence(Equal.asEquivalence<number>())(
      maybeSpotlitPlayer(before, standings),
      maybeSpotlitPlayer(after, standings),
    )
  if (!isNewStop || after.stage._tag === 'Idle') {
    return []
  }
  if (after.stage._tag === 'Scoreboard') {
    return [
      cue('Scoreboard', 0.1),
      ...Array.map(standings, (_, index) =>
        cue('RowTick', ROW_START + index * ROW_GAP),
      ),
    ]
  }
  return Option.match(
    Option.flatMap(maybeSpotlitPlayer(after, standings), playerIndex =>
      playerRecap(view, revealedTickets, standings, playerIndex),
    ),
    {
      onNone: () => [],
      onSome: recap => [
        cue('Reveal'),
        ...Array.map(recap.routes, (route, index) =>
          cue('RouteTick', ROUTE_START + index * ROUTE_GAP, route.length),
        ),
        ...Array.map(recap.tickets, (outcome, index) =>
          cue(
            outcome.isComplete ? 'TicketDone' : 'TicketMissed',
            TICKET_START + index * TICKET_GAP,
          ),
        ),
        cue(
          recap.place === 1 ? 'WinnerTotal' : 'Total',
          TICKET_START +
            recap.tickets.length * TICKET_GAP +
            TOTAL_AFTER_TICKETS -
            TICKET_GAP,
        ),
      ],
    },
  )
}

// RESOURCE

export type AudioOut = Readonly<{
  context: AudioContext
  master: GainNode
  channels: Map<SoundChannel, GainNode>
}>

export const AudioOutput = ManagedResource.tag<AudioOut>()('AudioOutput')
export type AudioOutputService = ManagedResource.ServiceOf<typeof AudioOutput>

export const AudioRequirements = Schema.Option(
  Schema.Struct({ code: Schema.String }),
)

const MASTER_VOLUME = 0.55

// NOTE: iPad Safari can suspend the context again after the screen locks, so
// any later tap on the page resumes it.
const resumeOnTap = (context: AudioContext) => () => {
  if (context.state !== 'running') {
    void context.resume()
  }
}

const tapResumers = new WeakMap<AudioContext, () => void>()

export const acquireAudio = () =>
  Effect.try({
    try: (): AudioOut => {
      const context = new AudioContext()
      const master = context.createGain()
      master.gain.value = MASTER_VOLUME
      master.connect(context.destination)
      void context.resume()
      const resume = resumeOnTap(context)
      tapResumers.set(context, resume)
      document.addEventListener('pointerdown', resume)
      return { context, master, channels: new Map() }
    },
    catch: () => new Error('This browser can’t play sound.'),
  })

export const releaseAudio = (audio: AudioOut) =>
  Effect.promise(() => {
    const resume = tapResumers.get(audio.context)
    if (resume !== undefined) {
      document.removeEventListener('pointerdown', resume)
    }
    return audio.context.close()
  }).pipe(Effect.catchCause(() => Effect.void))

// SYNTHESIS

type Voice = Readonly<{
  context: AudioContext
  out: AudioNode
  start: number
}>

const envelope = (
  voice: Voice,
  at: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode => {
  const gain = voice.context.createGain()
  const begin = voice.start + at
  gain.gain.setValueAtTime(0.0001, begin)
  gain.gain.exponentialRampToValueAtTime(peak, begin + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, begin + attack + decay)
  gain.connect(voice.out)
  return gain
}

const tone = (
  voice: Voice,
  options: Readonly<{
    at: number
    frequency: number
    endFrequency?: number
    type?: OscillatorType
    peak?: number
    attack?: number
    decay: number
  }>,
): void => {
  const attack = options.attack ?? 0.008
  const gain = envelope(
    voice,
    options.at,
    options.peak ?? 0.3,
    attack,
    options.decay,
  )
  const oscillator = voice.context.createOscillator()
  oscillator.type = options.type ?? 'sine'
  const begin = voice.start + options.at
  oscillator.frequency.setValueAtTime(options.frequency, begin)
  if (options.endFrequency !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(
      options.endFrequency,
      begin + attack + options.decay,
    )
  }
  oscillator.connect(gain)
  oscillator.start(begin)
  oscillator.stop(begin + attack + options.decay + 0.05)
}

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>()

const noiseBuffer = (context: AudioContext): AudioBuffer =>
  Option.getOrElse(Option.fromNullishOr(noiseBuffers.get(context)), () => {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = buffer.getChannelData(0)
    // NOTE: A fixed hash stands in for random noise, so rendering stays
    // deterministic and lint-clean; the ear can't tell the difference.
    data.forEach((_, index) => {
      const hashed = Math.sin(index * 12.9898) * 43758.5453
      data[index] = (hashed - Math.floor(hashed)) * 2 - 1
    })
    noiseBuffers.set(context, buffer)
    return buffer
  })

const noise = (
  voice: Voice,
  options: Readonly<{
    at: number
    filter: BiquadFilterType
    frequency: number
    endFrequency?: number
    q?: number
    peak?: number
    attack?: number
    decay: number
  }>,
): void => {
  const attack = options.attack ?? 0.004
  const gain = envelope(
    voice,
    options.at,
    options.peak ?? 0.3,
    attack,
    options.decay,
  )
  const filter = voice.context.createBiquadFilter()
  filter.type = options.filter
  filter.Q.value = options.q ?? 1
  const begin = voice.start + options.at
  filter.frequency.setValueAtTime(options.frequency, begin)
  if (options.endFrequency !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      options.endFrequency,
      begin + attack + options.decay,
    )
  }
  filter.connect(gain)
  const source = voice.context.createBufferSource()
  source.buffer = noiseBuffer(voice.context)
  source.connect(filter)
  source.start(begin, (options.frequency % 997) / 1994)
  source.stop(begin + attack + options.decay + 0.05)
}

const whistle = (voice: Voice, at: number, length: number): void => {
  Array.forEach([587, 740, 880], frequency =>
    tone(voice, {
      at,
      frequency: frequency * 0.97,
      endFrequency: frequency,
      type: 'triangle',
      peak: 0.09,
      attack: 0.06,
      decay: length,
    }),
  )
  noise(voice, {
    at,
    filter: 'bandpass',
    frequency: 2400,
    q: 2,
    peak: 0.05,
    attack: 0.05,
    decay: length,
  })
}

const chug = (voice: Voice, at: number, count: number): void =>
  Array.forEach(Array.range(0, count - 1), index =>
    noise(voice, {
      at: at + index * 0.13,
      filter: 'lowpass',
      frequency: 900,
      endFrequency: 300,
      peak: index % 2 === 0 ? 0.35 : 0.2,
      decay: 0.1,
    }),
  )

const notes = (
  voice: Voice,
  at: number,
  frequencies: ReadonlyArray<number>,
  gap: number,
  decay: number,
  peak = 0.16,
): void =>
  Array.forEach(frequencies, (frequency, index) =>
    tone(voice, { at: at + index * gap, frequency, peak, decay }),
  )

const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const A5 = 880
const C6 = 1046.5
const E6 = 1318.5

const SOUNDS: Record<
  SoundName,
  (voice: Voice, at: number, size: number) => void
> = {
  Turn: (voice, at) => {
    notes(voice, at, [E5, A5], 0.16, 0.6, 0.12)
  },
  Card: (voice, at) => {
    noise(voice, {
      at,
      filter: 'highpass',
      frequency: 2500,
      endFrequency: 5000,
      peak: 0.22,
      decay: 0.07,
    })
  },
  Ticket: (voice, at) => {
    noise(voice, { at, filter: 'bandpass', frequency: 3200, q: 0.8, peak: 0.16, decay: 0.12 })
    noise(voice, { at: at + 0.09, filter: 'bandpass', frequency: 2600, q: 0.8, peak: 0.14, decay: 0.14 })
    tone(voice, { at: at + 0.22, frequency: 140, endFrequency: 70, peak: 0.3, decay: 0.12 })
  },
  Claim: (voice, at, size) => {
    chug(voice, at, Math.min(2 + size, 7))
    whistle(voice, at + Math.min(2 + size, 7) * 0.13, 0.35 + size * 0.06)
  },
  FinalRound: (voice, at) => {
    Array.forEach([0, 0.55], strike =>
      Array.forEach([A5, A5 * 2.76, A5 * 5.4], (frequency, partial) =>
        tone(voice, {
          at: at + strike,
          frequency,
          peak: 0.14 / (partial + 1),
          decay: 1.4,
        }),
      ),
    )
  },
  GameOver: (voice, at) => {
    whistle(voice, at, 0.9)
    whistle(voice, at + 1.05, 1.3)
  },
  Reveal: (voice, at) => {
    noise(voice, {
      at,
      filter: 'bandpass',
      frequency: 400,
      endFrequency: 3000,
      q: 1.5,
      peak: 0.12,
      attack: 0.12,
      decay: 0.3,
    })
  },
  RouteTick: (voice, at, size) => {
    tone(voice, {
      at,
      frequency: 300 + size * 40,
      type: 'triangle',
      peak: 0.08,
      decay: 0.09,
    })
  },
  TicketDone: (voice, at) => {
    notes(voice, at, [C6, E6], 0.07, 0.35, 0.13)
  },
  TicketMissed: (voice, at) => {
    tone(voice, {
      at,
      frequency: 160,
      endFrequency: 90,
      type: 'sawtooth',
      peak: 0.1,
      decay: 0.25,
    })
  },
  Total: (voice, at) => {
    notes(voice, at, [C5, E5, G5], 0, 0.6, 0.1)
  },
  WinnerTotal: (voice, at) => {
    notes(voice, at, [C5, E5, G5, C6], 0.09, 0.9, 0.12)
    whistle(voice, at + 0.45, 0.8)
  },
  Scoreboard: (voice, at) => {
    notes(voice, at, [G5 / 2, C5, E5, G5], 0.12, 0.5, 0.12)
  },
  RowTick: (voice, at) => {
    tone(voice, { at, frequency: 900, type: 'triangle', peak: 0.06, decay: 0.06 })
  },
}

const render = (voice: Voice, { sound, at, size }: Cue): void =>
  SOUNDS[sound](voice, at, size)

const channelBus = (audio: AudioOut, channel: SoundChannel): GainNode => {
  const fresh = (): GainNode => {
    const bus = audio.context.createGain()
    bus.connect(audio.master)
    audio.channels.set(channel, bus)
    return bus
  }
  if (channel === 'Game') {
    return audio.channels.get(channel) ?? fresh()
  }
  audio.channels.get(channel)?.disconnect()
  return fresh()
}

// COMMAND

export const PlaySounds = Command.define('PlaySounds', {
  args: { channel: SoundChannel, cues: Schema.Array(Cue) },
  messages: [Message.CompletedPlaySounds],
  execute: ({ channel, cues }) =>
    AudioOutput.get.pipe(
      Effect.flatMap(audio =>
        Effect.sync(() => {
          const voice: Voice = {
            context: audio.context,
            out: channelBus(audio, channel),
            start: audio.context.currentTime + 0.03,
          }
          Array.forEach(cues, cueToPlay => render(voice, cueToPlay))
        }),
      ),
      Effect.catchCause(() => Effect.void),
      Effect.as(Message.CompletedPlaySounds()),
    ),
})
