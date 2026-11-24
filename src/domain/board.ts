import { Array, Option, Schema, pipe } from 'effect'

// CARDS

export const CardColor = Schema.Literals([
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Black',
])
export type CardColor = typeof CardColor.Type

export const Card = Schema.Literals([
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Black',
  'Wild',
])
export type Card = typeof Card.Type

export const RouteColor = Schema.Literals([
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Black',
  'Gray',
])
export type RouteColor = typeof RouteColor.Type

export const CARD_COLORS: ReadonlyArray<CardColor> = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Black',
]

export const CARDS_PER_COLOR = 8
export const WILD_CARDS = 6
export const STARTING_HAND_SIZE = 4
export const MARKET_SIZE = 5
export const STARTING_TRAINS = 14
export const FINAL_ROUND_TRAIN_THRESHOLD = 2
// NOTE: At the start everyone is dealt 3 tickets and keeps at least 2. A
// ticket draw mid-game shows 3 and keeps at least 1. Whatever isn't kept goes
// to the bottom of the ticket pile.
export const TICKET_OFFER_SIZE = 3
export const START_TICKETS_TO_KEEP = 2
export const DRAWN_TICKETS_TO_KEEP = 1

// CITIES

export type City = Readonly<{ id: string; name: string; x: number; y: number }>

export const CITIES: ReadonlyArray<City> = [
  { id: 'seattle', name: 'Seattle', x: 115, y: 95 },
  { id: 'helena', name: 'Helena', x: 266, y: 114 },
  { id: 'chicago', name: 'Chicago', x: 623, y: 201 },
  { id: 'newyork', name: 'New York', x: 822, y: 224 },
  { id: 'denver', name: 'Denver', x: 368, y: 242 },
  { id: 'atlanta', name: 'Atlanta', x: 662, y: 345 },
  { id: 'losangeles', name: 'Los Angeles', x: 175, y: 347 },
  { id: 'dallas', name: 'Dallas', x: 488, y: 371 },
  { id: 'miami', name: 'Miami', x: 740, y: 508 },
  { id: 'saltlake', name: 'Salt Lake City', x: 267, y: 223 },
  { id: 'kansascity', name: 'Kansas City', x: 521, y: 253 },
  { id: 'neworleans', name: 'New Orleans', x: 587, y: 424 },
  { id: 'pittsburgh', name: 'Pittsburgh', x: 734, y: 229 },
]

export const cityById = (cityId: string): City =>
  pipe(
    CITIES,
    Array.findFirst(city => city.id === cityId),
    Option.getOrThrowWith(() => new Error(`Unknown city ${cityId}`)),
  )

// ROUTES

export type Route = Readonly<{
  id: string
  from: string
  to: string
  length: number
  color: RouteColor
  // NOTE: A double route is two Routes between the same cities. Each names
  // the other as its twin, and lane says which side of the line it is drawn on.
  twin?: string
  lane?: -1 | 1
}>

export const ROUTES: ReadonlyArray<Route> = [
  { id: 'r1', from: 'seattle', to: 'helena', length: 2, color: 'Red' },
  { id: 'r2', from: 'seattle', to: 'saltlake', length: 3, color: 'Blue' },
  { id: 'r3', from: 'seattle', to: 'losangeles', length: 3, color: 'Gray' },
  { id: 'r4', from: 'helena', to: 'saltlake', length: 2, color: 'Yellow' },
  { id: 'r5', from: 'helena', to: 'chicago', length: 4, color: 'Gray' },
  { id: 'r6', from: 'helena', to: 'denver', length: 2, color: 'Black' },
  { id: 'r7', from: 'losangeles', to: 'saltlake', length: 2, color: 'Green' },
  { id: 'r8', from: 'losangeles', to: 'dallas', length: 3, color: 'Black' },
  { id: 'r9', from: 'denver', to: 'losangeles', length: 3, color: 'Yellow' },
  {
    id: 'r10',
    from: 'saltlake',
    to: 'denver',
    length: 2,
    color: 'Red',
    twin: 'r11',
    lane: -1,
  },
  {
    id: 'r11',
    from: 'saltlake',
    to: 'denver',
    length: 2,
    color: 'Yellow',
    twin: 'r10',
    lane: 1,
  },
  {
    id: 'r12',
    from: 'denver',
    to: 'kansascity',
    length: 2,
    color: 'Green',
    twin: 'r13',
    lane: -1,
  },
  {
    id: 'r13',
    from: 'denver',
    to: 'kansascity',
    length: 2,
    color: 'Blue',
    twin: 'r12',
    lane: 1,
  },
  {
    id: 'r14',
    from: 'denver',
    to: 'dallas',
    length: 2,
    color: 'Green',
    twin: 'r15',
    lane: -1,
  },
  {
    id: 'r15',
    from: 'denver',
    to: 'dallas',
    length: 2,
    color: 'Red',
    twin: 'r14',
    lane: 1,
  },
  {
    id: 'r16',
    from: 'kansascity',
    to: 'chicago',
    length: 2,
    color: 'Yellow',
    twin: 'r17',
    lane: -1,
  },
  {
    id: 'r17',
    from: 'kansascity',
    to: 'chicago',
    length: 2,
    color: 'Black',
    twin: 'r16',
    lane: 1,
  },
  {
    id: 'r18',
    from: 'kansascity',
    to: 'dallas',
    length: 2,
    color: 'Gray',
    twin: 'r19',
    lane: -1,
  },
  {
    id: 'r19',
    from: 'kansascity',
    to: 'dallas',
    length: 2,
    color: 'Gray',
    twin: 'r18',
    lane: 1,
  },
  { id: 'r20', from: 'kansascity', to: 'atlanta', length: 2, color: 'Red' },
  { id: 'r21', from: 'dallas', to: 'neworleans', length: 2, color: 'Blue' },
  { id: 'r22', from: 'neworleans', to: 'atlanta', length: 2, color: 'Black' },
  { id: 'r23', from: 'neworleans', to: 'miami', length: 3, color: 'Green' },
  { id: 'r24', from: 'dallas', to: 'atlanta', length: 3, color: 'Gray' },
  {
    id: 'r25',
    from: 'chicago',
    to: 'newyork',
    length: 3,
    color: 'Green',
    twin: 'r26',
    lane: -1,
  },
  {
    id: 'r26',
    from: 'chicago',
    to: 'newyork',
    length: 3,
    color: 'Red',
    twin: 'r25',
    lane: 1,
  },
  { id: 'r27', from: 'chicago', to: 'pittsburgh', length: 2, color: 'Blue' },
  { id: 'r28', from: 'pittsburgh', to: 'newyork', length: 1, color: 'Gray' },
  {
    id: 'r29',
    from: 'chicago',
    to: 'atlanta',
    length: 2,
    color: 'Yellow',
    twin: 'r30',
    lane: -1,
  },
  {
    id: 'r30',
    from: 'chicago',
    to: 'atlanta',
    length: 2,
    color: 'Blue',
    twin: 'r29',
    lane: 1,
  },
  { id: 'r31', from: 'pittsburgh', to: 'atlanta', length: 2, color: 'Green' },
  { id: 'r32', from: 'atlanta', to: 'newyork', length: 3, color: 'Black' },
  {
    id: 'r33',
    from: 'atlanta',
    to: 'miami',
    length: 3,
    color: 'Blue',
    twin: 'r34',
    lane: -1,
  },
  {
    id: 'r34',
    from: 'atlanta',
    to: 'miami',
    length: 3,
    color: 'Red',
    twin: 'r33',
    lane: 1,
  },
  { id: 'r35', from: 'newyork', to: 'miami', length: 4, color: 'Yellow' },
]

export const maybeRouteById = (routeId: string): Option.Option<Route> =>
  Array.findFirst(ROUTES, route => route.id === routeId)

export const routeById = (routeId: string): Route =>
  pipe(
    maybeRouteById(routeId),
    Option.getOrThrowWith(() => new Error(`Unknown route ${routeId}`)),
  )

export const routePoints = (length: number): number =>
  pipe(
    [0, 1, 2, 4, 7, 10, 15],
    Array.get(length),
    Option.getOrElse(() => 0),
  )

// TICKETS

export type Ticket = Readonly<{
  id: string
  from: string
  to: string
  points: number
}>

export const TICKETS: ReadonlyArray<Ticket> = [
  { id: 't1', from: 'seattle', to: 'miami', points: 11 },
  { id: 't2', from: 'helena', to: 'dallas', points: 4 },
  { id: 't3', from: 'losangeles', to: 'newyork', points: 9 },
  { id: 't4', from: 'chicago', to: 'dallas', points: 4 },
  { id: 't5', from: 'denver', to: 'miami', points: 7 },
  { id: 't6', from: 'seattle', to: 'atlanta', points: 8 },
  { id: 't7', from: 'helena', to: 'newyork', points: 7 },
  { id: 't8', from: 'losangeles', to: 'chicago', points: 7 },
  { id: 't9', from: 'dallas', to: 'newyork', points: 6 },
  { id: 't10', from: 'seattle', to: 'chicago', points: 6 },
  { id: 't11', from: 'losangeles', to: 'atlanta', points: 6 },
  { id: 't12', from: 'seattle', to: 'newyork', points: 9 },
  { id: 't13', from: 'seattle', to: 'dallas', points: 6 },
  { id: 't14', from: 'helena', to: 'atlanta', points: 6 },
  { id: 't15', from: 'helena', to: 'losangeles', points: 4 },
  { id: 't16', from: 'helena', to: 'miami', points: 9 },
  { id: 't17', from: 'chicago', to: 'miami', points: 5 },
  { id: 't18', from: 'denver', to: 'newyork', points: 7 },
  { id: 't19', from: 'newyork', to: 'miami', points: 4 },
  { id: 't20', from: 'losangeles', to: 'miami', points: 8 },
  { id: 't21', from: 'dallas', to: 'miami', points: 5 },
  { id: 't22', from: 'denver', to: 'atlanta', points: 4 },
  { id: 't23', from: 'chicago', to: 'newyork', points: 4 },
  { id: 't24', from: 'losangeles', to: 'dallas', points: 4 },
  { id: 't25', from: 'saltlake', to: 'kansascity', points: 4 },
  { id: 't26', from: 'saltlake', to: 'newyork', points: 9 },
  { id: 't27', from: 'saltlake', to: 'neworleans', points: 6 },
  { id: 't28', from: 'saltlake', to: 'chicago', points: 6 },
  { id: 't29', from: 'kansascity', to: 'newyork', points: 5 },
  { id: 't30', from: 'kansascity', to: 'miami', points: 5 },
  { id: 't31', from: 'kansascity', to: 'pittsburgh', points: 4 },
  { id: 't32', from: 'neworleans', to: 'chicago', points: 4 },
  { id: 't33', from: 'neworleans', to: 'pittsburgh', points: 4 },
  { id: 't34', from: 'neworleans', to: 'losangeles', points: 5 },
  { id: 't35', from: 'pittsburgh', to: 'dallas', points: 5 },
  { id: 't36', from: 'pittsburgh', to: 'seattle', points: 8 },
  { id: 't37', from: 'denver', to: 'pittsburgh', points: 6 },
  { id: 't38', from: 'seattle', to: 'neworleans', points: 8 },
  { id: 't39', from: 'helena', to: 'kansascity', points: 4 },
  { id: 't40', from: 'losangeles', to: 'kansascity', points: 5 },
]

export const ticketById = (ticketId: string): Ticket =>
  pipe(
    TICKETS,
    Array.findFirst(ticket => ticket.id === ticketId),
    Option.getOrThrowWith(() => new Error(`Unknown ticket ${ticketId}`)),
  )
