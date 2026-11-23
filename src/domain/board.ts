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
export const STARTING_TICKETS = 2

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
}>

export const ROUTES: ReadonlyArray<Route> = [
  { id: 'r1', from: 'seattle', to: 'helena', length: 2, color: 'Red' },
  { id: 'r2', from: 'seattle', to: 'denver', length: 3, color: 'Blue' },
  { id: 'r3', from: 'seattle', to: 'losangeles', length: 3, color: 'Gray' },
  { id: 'r4', from: 'helena', to: 'chicago', length: 3, color: 'Gray' },
  { id: 'r5', from: 'helena', to: 'denver', length: 2, color: 'Black' },
  { id: 'r6', from: 'chicago', to: 'newyork', length: 3, color: 'Green' },
  { id: 'r7', from: 'chicago', to: 'atlanta', length: 2, color: 'Yellow' },
  { id: 'r8', from: 'denver', to: 'atlanta', length: 3, color: 'Red' },
  { id: 'r9', from: 'denver', to: 'losangeles', length: 3, color: 'Yellow' },
  { id: 'r10', from: 'denver', to: 'dallas', length: 2, color: 'Green' },
  { id: 'r11', from: 'losangeles', to: 'dallas', length: 3, color: 'Black' },
  { id: 'r12', from: 'atlanta', to: 'newyork', length: 3, color: 'Black' },
  { id: 'r13', from: 'atlanta', to: 'miami', length: 3, color: 'Blue' },
  { id: 'r14', from: 'atlanta', to: 'dallas', length: 3, color: 'Gray' },
  { id: 'r15', from: 'dallas', to: 'miami', length: 4, color: 'Red' },
  {
    id: 'r16',
    from: 'newyork',
    to: 'miami',
    length: 4,
    color: 'Green',
  },
  { id: 'r17', from: 'denver', to: 'chicago', length: 3, color: 'Blue' },
]

export const routeById = (routeId: string): Route =>
  pipe(
    ROUTES,
    Array.findFirst(route => route.id === routeId),
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
  { id: 't1', from: 'seattle', to: 'miami', points: 10 },
  { id: 't2', from: 'helena', to: 'dallas', points: 5 },
  { id: 't3', from: 'losangeles', to: 'newyork', points: 11 },
  { id: 't4', from: 'chicago', to: 'dallas', points: 6 },
  { id: 't5', from: 'denver', to: 'miami', points: 6 },
  { id: 't6', from: 'seattle', to: 'atlanta', points: 6 },
  { id: 't7', from: 'helena', to: 'newyork', points: 6 },
  { id: 't8', from: 'losangeles', to: 'chicago', points: 7 },
  { id: 't9', from: 'dallas', to: 'newyork', points: 7 },
  { id: 't10', from: 'seattle', to: 'chicago', points: 5 },
  { id: 't11', from: 'losangeles', to: 'atlanta', points: 6 },
]

export const ticketById = (ticketId: string): Ticket =>
  pipe(
    TICKETS,
    Array.findFirst(ticket => ticket.id === ticketId),
    Option.getOrThrowWith(() => new Error(`Unknown ticket ${ticketId}`)),
  )
