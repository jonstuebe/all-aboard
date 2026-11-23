import { Array, Order, pipe } from 'effect'

// NOTE: A seeded PRNG (mulberry32) keeps update pure. The seed itself comes
// from a Command, and every shuffle threads the next state through the Model.

export const nextRandom = (state: number): readonly [number, number] => {
  const nextState = (state + 0x6d2b79f5) | 0
  const mixed = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState)
  const remixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
  const value = ((remixed ^ (remixed >>> 14)) >>> 0) / 4294967296
  return [value, nextState]
}

type Keyed<A> = Readonly<{ item: A; key: number }>

export const shuffle = <A>(
  items: ReadonlyArray<A>,
  state: number,
): readonly [Array<A>, number] => {
  const keyed = Array.reduce(
    items,
    { entries: Array.empty<Keyed<A>>(), state },
    (accumulator, item) => {
      const [key, nextState] = nextRandom(accumulator.state)
      return {
        entries: Array.append(accumulator.entries, { item, key }),
        state: nextState,
      }
    },
  )
  const shuffled = pipe(
    keyed.entries,
    Array.sort(Order.mapInput(Order.Number, (entry: Keyed<A>) => entry.key)),
    Array.map(entry => entry.item),
  )
  return [shuffled, keyed.state]
}
