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
  { id: 'ironport', name: 'Ironport', x: 120, y: 150 },
  { id: 'harlow', name: 'Harlow', x: 350, y: 80 },
  { id: 'dunmore', name: 'Dunmore', x: 620, y: 110 },
  { id: 'fairhaven', name: 'Fairhaven', x: 880, y: 180 },
  { id: 'ashford', name: 'Ashford', x: 340, y: 300 },
  { id: 'elkridge', name: 'Elk Ridge', x: 620, y: 330 },
  { id: 'briarbay', name: 'Briar Bay', x: 120, y: 450 },
  { id: 'coldwater', name: 'Coldwater', x: 370, y: 530 },
  { id: 'granitefalls', name: 'Granite Falls', x: 870, y: 480 },
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
  { id: 'r1', from: 'ironport', to: 'harlow', length: 2, color: 'Red' },
  { id: 'r2', from: 'ironport', to: 'ashford', length: 3, color: 'Blue' },
  { id: 'r3', from: 'ironport', to: 'briarbay', length: 3, color: 'Gray' },
  { id: 'r4', from: 'harlow', to: 'dunmore', length: 3, color: 'Gray' },
  { id: 'r5', from: 'harlow', to: 'ashford', length: 2, color: 'Black' },
  { id: 'r6', from: 'dunmore', to: 'fairhaven', length: 3, color: 'Green' },
  { id: 'r7', from: 'dunmore', to: 'elkridge', length: 2, color: 'Yellow' },
  { id: 'r8', from: 'ashford', to: 'elkridge', length: 3, color: 'Red' },
  { id: 'r9', from: 'ashford', to: 'briarbay', length: 3, color: 'Yellow' },
  { id: 'r10', from: 'ashford', to: 'coldwater', length: 2, color: 'Green' },
  { id: 'r11', from: 'briarbay', to: 'coldwater', length: 3, color: 'Black' },
  { id: 'r12', from: 'elkridge', to: 'fairhaven', length: 3, color: 'Black' },
  { id: 'r13', from: 'elkridge', to: 'granitefalls', length: 3, color: 'Blue' },
  { id: 'r14', from: 'elkridge', to: 'coldwater', length: 3, color: 'Gray' },
  { id: 'r15', from: 'coldwater', to: 'granitefalls', length: 4, color: 'Red' },
  {
    id: 'r16',
    from: 'fairhaven',
    to: 'granitefalls',
    length: 4,
    color: 'Green',
  },
  { id: 'r17', from: 'ashford', to: 'dunmore', length: 3, color: 'Blue' },
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
  { id: 't1', from: 'ironport', to: 'granitefalls', points: 10 },
  { id: 't2', from: 'harlow', to: 'coldwater', points: 5 },
  { id: 't3', from: 'briarbay', to: 'fairhaven', points: 11 },
  { id: 't4', from: 'dunmore', to: 'coldwater', points: 6 },
  { id: 't5', from: 'ashford', to: 'granitefalls', points: 6 },
  { id: 't6', from: 'ironport', to: 'elkridge', points: 6 },
  { id: 't7', from: 'harlow', to: 'fairhaven', points: 6 },
  { id: 't8', from: 'briarbay', to: 'dunmore', points: 7 },
  { id: 't9', from: 'coldwater', to: 'fairhaven', points: 7 },
  { id: 't10', from: 'ironport', to: 'dunmore', points: 5 },
  { id: 't11', from: 'briarbay', to: 'elkridge', points: 6 },
]

export const ticketById = (ticketId: string): Ticket =>
  pipe(
    TICKETS,
    Array.findFirst(ticket => ticket.id === ticketId),
    Option.getOrThrowWith(() => new Error(`Unknown ticket ${ticketId}`)),
  )
