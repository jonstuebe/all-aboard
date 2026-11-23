import { Array } from 'effect'

import type { Card } from './domain/board'

// NOTE: every export here is static SVG markup, set through `h.InnerHTML` on
// an svg or g element. All styling lives in styles.css under the class names
// used below, so the markup carries geometry only.

const fixed = (value: number): string => value.toFixed(1)

const joinMarkup = (parts: ReadonlyArray<string>): string => parts.join('')

// ROLLING STOCK (side view, for cards)

export const CAR_VIEW_BOX = '0 0 120 66'

const WHEEL_CENTERS: ReadonlyArray<number> = [24, 40, 80, 96]

const wheel = (cx: number, cy: number, radius: number): string =>
  `<circle class="car-wheel" cx="${cx}" cy="${cy}" r="${radius}"/>` +
  `<circle class="car-hub" cx="${cx}" cy="${cy}" r="${fixed(radius * 0.32)}"/>`

const RAIL =
  '<line class="car-ties" x1="3" y1="63" x2="117" y2="63"/>' +
  '<rect class="car-rail" x="0" y="59.6" width="120" height="2.4" rx="1"/>'

const UNDERCARRIAGE = joinMarkup([
  RAIL,
  '<rect class="car-iron" x="1" y="42.5" width="118" height="3" rx="1.5"/>',
  '<rect class="car-iron" x="8" y="41" width="104" height="5.5"/>',
  '<rect class="car-iron" x="15" y="47" width="34" height="4.5" rx="2"/>',
  '<rect class="car-iron" x="71" y="47" width="34" height="4.5" rx="2"/>',
  ...Array.map(WHEEL_CENTERS, cx => wheel(cx, 53, 6.5)),
])

const verticalLines = (
  className: string,
  xs: ReadonlyArray<number>,
  top: number,
  bottom: number,
): string =>
  joinMarkup(
    Array.map(
      xs,
      x =>
        `<line class="${className}" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`,
    ),
  )

const BOXCAR = joinMarkup([
  UNDERCARRIAGE,
  '<rect class="car-body" x="10" y="12" width="100" height="30" rx="1.5"/>',
  verticalLines('car-seam', [18, 26, 34, 42, 78, 86, 94, 102], 14, 41),
  '<rect class="car-shade" x="10" y="36" width="100" height="6"/>',
  '<rect class="car-roof" x="7" y="8" width="106" height="6" rx="3"/>',
  '<rect class="car-lite" x="11" y="9.2" width="98" height="1.6" rx="0.8"/>',
  '<rect class="car-iron" x="38" y="14" width="44" height="1.8"/>',
  '<rect class="car-door" x="48" y="15.5" width="24" height="26.5"/>',
  '<path class="car-seam" d="M48,28.5 H72 M60,15.5 V42"/>',
  '<rect class="car-iron" x="57" y="26" width="6" height="2.6" rx="1"/>',
  '<path class="car-ladder" d="M103,16 V40 M107,16 V40 M103,20 H107 M103,25 H107 M103,30 H107 M103,35 H107"/>',
])

const TANKER = joinMarkup([
  UNDERCARRIAGE,
  '<rect class="car-iron" x="20" y="36" width="12" height="6" rx="1"/>',
  '<rect class="car-iron" x="88" y="36" width="12" height="6" rx="1"/>',
  '<rect class="car-body" x="52" y="7" width="16" height="12" rx="4"/>',
  '<rect class="car-lite" x="55" y="8.6" width="10" height="1.6" rx="0.8"/>',
  '<rect class="car-body" x="8" y="15" width="104" height="25" rx="12.5"/>',
  '<rect class="car-shade" x="8" y="30" width="104" height="10" rx="5"/>',
  '<rect class="car-lite" x="17" y="18.5" width="86" height="3.4" rx="1.7"/>',
  verticalLines('car-band', [30, 60, 90], 15.5, 39.5),
  '<path class="car-ladder" d="M57,19 V41 M63,19 V41 M57,24 H63 M57,29 H63 M57,34 H63"/>',
  '<circle class="car-iron" cx="60" cy="42" r="2.6"/>',
])

const hopperBay = (x: number): string =>
  `<path class="car-body" d="M${x},29 h30 l-8,13 h-14 Z"/>` +
  `<path class="car-shade" d="M${x},29 h30 l-8,13 h-14 Z"/>` +
  `<rect class="car-iron" x="${x + 10}" y="40.5" width="10" height="3" rx="1"/>`

const HOPPER = joinMarkup([
  UNDERCARRIAGE,
  ...Array.map([13, 45, 77], hopperBay),
  '<rect class="car-body" x="10" y="13" width="100" height="18" rx="1.5"/>',
  verticalLines('car-rib', [20, 32, 44, 56, 68, 80, 92, 104], 14, 30),
  '<rect class="car-roof" x="7" y="9.5" width="106" height="5" rx="1.5"/>',
  '<rect class="car-roof" x="20" y="6" width="18" height="4.5" rx="2"/>',
  '<rect class="car-roof" x="51" y="6" width="18" height="4.5" rx="2"/>',
  '<rect class="car-roof" x="82" y="6" width="18" height="4.5" rx="2"/>',
  '<rect class="car-lite" x="11" y="10.4" width="98" height="1.4" rx="0.7"/>',
])

const COACH_WINDOWS: ReadonlyArray<number> = [17, 30, 43, 56, 69, 82, 95]

const COACH = joinMarkup([
  UNDERCARRIAGE,
  '<rect class="car-roof" x="16" y="5" width="88" height="6" rx="2.5"/>',
  '<rect class="car-body" x="6" y="14" width="108" height="28" rx="2"/>',
  '<rect class="car-roof" x="3" y="9.5" width="114" height="6.5" rx="3.2"/>',
  '<rect class="car-lite" x="8" y="10.8" width="104" height="1.6" rx="0.8"/>',
  ...Array.map(
    COACH_WINDOWS,
    x =>
      `<rect class="car-glass" x="${x}" y="19.5" width="9" height="11" rx="1.4"/>` +
      `<rect class="car-glint" x="${x + 1}" y="20.5" width="3" height="5" rx="0.8"/>`,
  ),
  '<rect class="car-shade" x="6" y="33.5" width="108" height="2"/>',
  '<rect class="car-shade" x="6" y="38" width="108" height="4"/>',
  '<path class="car-seam" d="M12,16 V42 M108,16 V42"/>',
])

const GONDOLA = joinMarkup([
  UNDERCARRIAGE,
  '<path class="car-coal" d="M12,26 Q16,17 24,18 Q30,10 40,14 Q48,8 58,13 Q68,7 78,13 Q88,9 96,16 Q104,16 108,26 Z"/>',
  '<path class="car-coal-glint" d="M26,18 l5,-3 M43,13 l6,-2 M62,12 l6,-2 M82,13 l6,1 M36,21 l5,-2 M72,19 l6,-2 M94,20 l5,1"/>',
  '<rect class="car-body" x="10" y="24" width="100" height="18" rx="1.5"/>',
  verticalLines('car-rib', [20, 32, 44, 56, 68, 80, 92, 104], 25, 41),
  '<rect class="car-lite" x="10" y="24" width="100" height="2.2" rx="1"/>',
  '<rect class="car-shade" x="10" y="37" width="100" height="5"/>',
])

const WILD_PIPS = joinMarkup(
  Array.map(
    ['red', 'blue', 'green', 'yellow', 'black'],
    (color, index) =>
      `<rect class="car-pip pip-${color}" x="${46 + index * 9.4}" y="36.6" width="7.4" height="4.8" rx="1"/>`,
  ),
)

const LOCOMOTIVE = joinMarkup([
  RAIL,
  '<rect class="car-iron" x="2" y="43" width="104" height="4" rx="1.5"/>',
  '<path class="car-iron" d="M103,43 L119,58 H103 Z"/>',
  '<path class="car-seam" d="M107,47 L107,58 M111,51 L111,58 M115,55 L115,58"/>',
  '<path class="car-iron" d="M87,18 L85,4 H101 L99,18 Z"/>',
  '<rect class="car-brass" x="83.5" y="2.5" width="19" height="3.4" rx="1.6"/>',
  '<rect class="car-brass" x="59" y="9" width="13" height="10" rx="6"/>',
  '<rect class="car-iron" x="45" y="12" width="7" height="7" rx="2"/>',
  '<rect class="car-boiler" x="38" y="17" width="66" height="21" rx="7"/>',
  '<rect class="car-lite" x="44" y="19.6" width="52" height="2.6" rx="1.3"/>',
  verticalLines('car-brass-band', [56, 75, 92], 17.4, 37.6),
  '<rect class="car-brass" x="102" y="20" width="7" height="8" rx="1.5"/>',
  '<circle class="car-lamp" cx="107" cy="24" r="2.4"/>',
  WILD_PIPS,
  '<rect class="car-body" x="8" y="9" width="32" height="34" rx="1.5"/>',
  '<rect class="car-roof" x="4" y="5" width="40" height="5.5" rx="2.5"/>',
  '<rect class="car-glass" x="14" y="14" width="13" height="12" rx="1.5"/>',
  '<rect class="car-glint" x="15.2" y="15.2" width="4" height="6" rx="0.8"/>',
  '<rect class="car-shade" x="8" y="31" width="32" height="2"/>',
  '<rect class="car-iron" x="78" y="38" width="18" height="9" rx="2"/>',
  wheel(24, 50, 9.5),
  wheel(48, 50, 9.5),
  wheel(72, 54, 5.5),
  wheel(92, 54, 5.5),
  '<rect class="car-rod" x="22" y="48.4" width="62" height="3" rx="1.5"/>',
  '<circle class="car-brass" cx="24" cy="50" r="1.8"/>',
  '<circle class="car-brass" cx="48" cy="50" r="1.8"/>',
])

export const CAR_ART: Record<Card, string> = {
  Red: BOXCAR,
  Blue: TANKER,
  Green: HOPPER,
  Yellow: COACH,
  Black: GONDOLA,
  Wild: LOCOMOTIVE,
}

export const CAR_KIND: Record<Card, string> = {
  Red: 'Boxcar',
  Blue: 'Tanker',
  Green: 'Hopper',
  Yellow: 'Coach',
  Black: 'Coal car',
  Wild: 'Locomotive',
}

export const CARD_BACK_ART = joinMarkup([
  '<rect class="back-field" x="0" y="0" width="120" height="66"/>',
  '<rect class="back-rule" x="5" y="5" width="110" height="56" rx="3"/>',
  '<rect class="back-rule thin" x="8.5" y="8.5" width="103" height="49" rx="2"/>',
  '<circle class="back-roundel" cx="60" cy="33" r="17"/>',
  '<circle class="back-rule thin" cx="60" cy="33" r="13.5"/>',
  '<path class="back-spokes" d="M60,21 V45 M48,33 H72 M51.5,24.5 L68.5,41.5 M68.5,24.5 L51.5,41.5"/>',
  '<circle class="back-hub" cx="60" cy="33" r="4"/>',
  '<path class="back-rule thin" d="M14,33 H38 M82,33 H106 M20,27 H34 M86,27 H100 M20,39 H34 M86,39 H100"/>',
])

// TRACK AND PIECES (top view, for the board)

export const TRACK_HALF_WIDTH = 12

const TIE_WIDTH = 4.5
const TIE_SPACING = 11
const RAIL_OFFSET = 6.5
const PIECE_HALF_WIDTH = 10.5
const PIECE_SHADOW: Readonly<{ x: number; y: number }> = { x: 2.5, y: 3.5 }

export type RouteArtInput = Readonly<{
  slotCenters: ReadonlyArray<number>
  slotLength: number
  angle: number
  mark: string
  isOwned: boolean
}>

const uprightMark = (
  angle: number,
  plateClass: string,
  radius: number,
  mark: string,
): string =>
  mark === ''
    ? ''
    : `<g class="mark" transform="rotate(${fixed(-angle)})">` +
      `<circle class="${plateClass}" r="${radius}"/>` +
      `<text class="route-mark" text-anchor="middle" dominant-baseline="central">${mark}</text>` +
      '</g>'

const trackSection = (slotLength: number): string => {
  const half = slotLength / 2
  const span = slotLength - 10
  const tieCount = Math.max(3, Math.round(span / TIE_SPACING))
  const tieGap = (span - tieCount * TIE_WIDTH) / (tieCount - 1)
  return joinMarkup([
    `<rect class="track-bed" x="${fixed(-half)}" y="${-TRACK_HALF_WIDTH}" width="${fixed(slotLength)}" height="${TRACK_HALF_WIDTH * 2}" rx="5"/>`,
    `<line class="track-ties" x1="${fixed(-span / 2)}" y1="0" x2="${fixed(span / 2)}" y2="0" stroke-dasharray="${TIE_WIDTH} ${fixed(tieGap)}"/>`,
    ...Array.map(
      [-RAIL_OFFSET, RAIL_OFFSET],
      y =>
        `<line class="track-rail" x1="${fixed(-half + 2)}" y1="${y}" x2="${fixed(half - 2)}" y2="${y}"/>` +
        `<line class="track-rail-glint" x1="${fixed(-half + 2)}" y1="${y - 0.7}" x2="${fixed(half - 2)}" y2="${y - 0.7}"/>`,
    ),
  ])
}

const pieceShadow = (angle: number, length: number): string => {
  const radians = (angle * Math.PI) / 180
  const localX =
    PIECE_SHADOW.x * Math.cos(radians) + PIECE_SHADOW.y * Math.sin(radians)
  const localY =
    -PIECE_SHADOW.x * Math.sin(radians) + PIECE_SHADOW.y * Math.cos(radians)
  return `<rect class="piece-shadow" x="${fixed(-length / 2 + localX)}" y="${fixed(-PIECE_HALF_WIDTH + localY)}" width="${fixed(length)}" height="${PIECE_HALF_WIDTH * 2}" rx="4.5"/>`
}

const wagonPiece = (angle: number, length: number, mark: string): string => {
  const half = length / 2
  return joinMarkup([
    pieceShadow(angle, length),
    `<rect class="piece-body" x="${fixed(-half)}" y="${-PIECE_HALF_WIDTH}" width="${fixed(length)}" height="${PIECE_HALF_WIDTH * 2}" rx="4"/>`,
    `<line class="piece-ribs" x1="${fixed(-half + 7)}" y1="0" x2="${fixed(half - 5)}" y2="0"/>`,
    `<rect class="piece-walk" x="${fixed(-half + 4)}" y="-2.6" width="${fixed(length - 8)}" height="5.2" rx="2"/>`,
    `<rect class="piece-edge" x="${fixed(-half)}" y="${-PIECE_HALF_WIDTH}" width="${fixed(length)}" height="${PIECE_HALF_WIDTH * 2}" rx="4"/>`,
    uprightMark(angle, 'piece-badge', 8, mark),
  ])
}

const enginePiece = (angle: number, length: number, mark: string): string => {
  const half = length / 2
  const cabLength = Math.max(22, length * 0.34)
  const boilerStart = -half + cabLength - 3
  const boilerLength = half - boilerStart
  return joinMarkup([
    pieceShadow(angle, length),
    `<rect class="piece-body" x="${fixed(boilerStart)}" y="-7.5" width="${fixed(boilerLength)}" height="15" rx="7.5"/>`,
    `<rect class="piece-walk" x="${fixed(boilerStart + 4)}" y="-4.6" width="${fixed(boilerLength - 12)}" height="2.6" rx="1.3"/>`,
    `<rect class="piece-edge" x="${fixed(boilerStart)}" y="-7.5" width="${fixed(boilerLength)}" height="15" rx="7.5"/>`,
    `<line class="piece-band" x1="${fixed(boilerStart + boilerLength * 0.42)}" y1="-7.5" x2="${fixed(boilerStart + boilerLength * 0.42)}" y2="7.5"/>`,
    `<circle class="piece-brass" cx="${fixed(half - 26)}" cy="0" r="3.2"/>`,
    `<circle class="piece-stack" cx="${fixed(half - 13)}" cy="0" r="5"/>`,
    `<circle class="piece-stack-bore" cx="${fixed(half - 13)}" cy="0" r="2.4"/>`,
    `<circle class="piece-lamp" cx="${fixed(half - 2.5)}" cy="0" r="2.2"/>`,
    `<rect class="piece-body" x="${fixed(-half)}" y="${-PIECE_HALF_WIDTH}" width="${fixed(cabLength)}" height="${PIECE_HALF_WIDTH * 2}" rx="3.5"/>`,
    `<rect class="piece-edge" x="${fixed(-half)}" y="${-PIECE_HALF_WIDTH}" width="${fixed(cabLength)}" height="${PIECE_HALF_WIDTH * 2}" rx="3.5"/>`,
    `<g transform="translate(${fixed(-half + cabLength / 2)} 0)">${uprightMark(angle, 'piece-badge', 7.5, mark)}</g>`,
  ])
}

export const routeArt = ({
  slotCenters,
  slotLength,
  angle,
  mark,
  isOwned,
}: RouteArtInput): string => {
  const section = trackSection(slotLength)
  const pieceLength = slotLength - 3
  const lastIndex = slotCenters.length - 1
  const track = joinMarkup(
    Array.map(
      slotCenters,
      center =>
        `<g transform="translate(${fixed(center)} 0)">${section}${isOwned ? '' : uprightMark(angle, 'track-plate', 9.5, mark)}</g>`,
    ),
  )
  if (!isOwned) {
    return track
  }
  const firstCenter = slotCenters[0] ?? 0
  const lastCenter = slotCenters[lastIndex] ?? firstCenter
  const coupling = `<line class="piece-coupling" x1="${fixed(firstCenter)}" y1="0" x2="${fixed(lastCenter)}" y2="0"/>`
  const pieces = joinMarkup(
    Array.map(
      slotCenters,
      (center, index) =>
        `<g transform="translate(${fixed(center)} 0)">${
          index === lastIndex
            ? enginePiece(angle, pieceLength, mark)
            : wagonPiece(angle, pieceLength, mark)
        }</g>`,
    ),
  )
  return track + coupling + pieces
}

// STATION

export const DEPOT_ART = joinMarkup([
  '<circle class="depot-shadow" cx="1.5" cy="2.5" r="19"/>',
  '<circle class="depot-plaza" r="19"/>',
  '<circle class="depot-rim" r="15.6"/>',
  '<rect class="depot-platform" x="-13.5" y="7" width="27" height="3" rx="1"/>',
  '<rect class="depot-wall" x="-10.5" y="-3.5" width="21" height="11"/>',
  '<rect class="depot-door" x="-2.6" y="0.5" width="5.2" height="7"/>',
  '<rect class="depot-window" x="-8.4" y="-0.8" width="3.8" height="4.2"/>',
  '<rect class="depot-window" x="4.6" y="-0.8" width="3.8" height="4.2"/>',
  '<path class="depot-roof" d="M-14.5,-3 L0,-12.5 L14.5,-3 Z"/>',
  '<circle class="depot-clock" cx="0" cy="-6.6" r="2.1"/>',
])

// MAP

// NOTE: the backdrop is drawn from real longitude/latitude pairs through the
// same plate carrée projection that places the cities in domain/board.ts.

type LonLat = readonly [lon: number, lat: number]

const projectX = (lon: number): number => 75 + (lon + 125) * 14.655
const projectY = (lat: number): number => 60 + (49.5 - lat) * 18.6

const projected = ([lon, lat]: LonLat): string =>
  `${fixed(projectX(lon))},${fixed(projectY(lat))}`

const outline = (points: ReadonlyArray<LonLat>): string =>
  `M${Array.map(points, projected).join(' L')} Z`

const course = (points: ReadonlyArray<LonLat>): string =>
  `M${Array.map(points, projected).join(' L')}`

const placed = (
  points: ReadonlyArray<LonLat>,
  glyph: string,
  scaleOf: (index: number) => number = () => 1,
): string =>
  joinMarkup(
    Array.map(
      points,
      ([lon, lat], index) =>
        `<g transform="translate(${fixed(projectX(lon))} ${fixed(projectY(lat))}) scale(${fixed(scaleOf(index))})">${glyph}</g>`,
    ),
  )

const NORTHERN_BORDER: ReadonlyArray<LonLat> = [
  [-122.8, 49],
  [-95.2, 49],
  [-95.2, 49.4],
  [-94.8, 49.3],
  [-94.6, 48.7],
  [-92, 48.3],
  [-89.6, 48],
]

const MAINE_BORDER: ReadonlyArray<LonLat> = [
  [-75, 45],
  [-71.5, 45],
  [-70.3, 46.3],
  [-69.2, 47.4],
  [-68.3, 47.3],
  [-67.8, 47],
  [-67.8, 45.7],
  [-67, 44.9],
]

const SOUTHERN_BORDER: ReadonlyArray<LonLat> = [
  [-97.2, 25.95],
  [-99.1, 26.4],
  [-99.5, 27.5],
  [-100.6, 28.9],
  [-101.4, 29.8],
  [-102.4, 29.8],
  [-103.2, 29],
  [-104.5, 29.6],
  [-104.9, 30.6],
  [-106.5, 31.75],
  [-108.2, 31.75],
  [-108.2, 31.33],
  [-111.1, 31.33],
  [-114.8, 32.5],
  [-117.1, 32.5],
]

const UNITED_STATES: ReadonlyArray<LonLat> = [
  [-124.7, 48.4],
  [-123.2, 48.15],
  [-122.8, 49],
  ...NORTHERN_BORDER,
  [-90.8, 46.9],
  [-92.1, 46.75],
  [-90.5, 46.6],
  [-88.4, 47.4],
  [-87.8, 47.4],
  [-87, 46.5],
  [-85, 46.7],
  [-84.4, 46.5],
  [-84.7, 46],
  [-86, 45.9],
  [-87, 45.7],
  [-87.9, 44.6],
  [-87.4, 44.9],
  [-87.8, 43],
  [-87.6, 41.8],
  [-87.1, 41.6],
  [-86.5, 42.2],
  [-86.3, 43.6],
  [-86, 44.9],
  [-85.3, 45.3],
  [-84.8, 45.75],
  [-83.4, 45.2],
  [-83.3, 44.3],
  [-83.9, 43.9],
  [-82.9, 44],
  [-82.5, 43],
  [-83.1, 42.2],
  [-83.4, 41.7],
  [-81.7, 41.5],
  [-79.8, 42.3],
  [-78.9, 42.9],
  [-79, 43.3],
  [-77.5, 43.3],
  [-76.4, 43.6],
  [-76.3, 44.2],
  ...MAINE_BORDER,
  [-68.5, 44.3],
  [-70.2, 43.6],
  [-70.7, 42.7],
  [-70.9, 42.3],
  [-70, 42.05],
  [-69.95, 41.7],
  [-70.7, 41.6],
  [-71.4, 41.5],
  [-72.9, 41.25],
  [-73.9, 40.75],
  [-72, 41.05],
  [-73.9, 40.6],
  [-74.1, 39.8],
  [-74.9, 38.95],
  [-75.5, 39.5],
  [-75.1, 38.5],
  [-75.9, 37.2],
  [-76.3, 38.6],
  [-76.4, 37],
  [-75.9, 36.2],
  [-75.5, 35.25],
  [-76.6, 34.7],
  [-77.9, 33.9],
  [-79.2, 33.2],
  [-80.9, 32],
  [-81.4, 30.7],
  [-81.3, 29.7],
  [-80.5, 28.4],
  [-80, 26.8],
  [-80.2, 25.4],
  [-80.9, 25.15],
  [-81.8, 26.1],
  [-82.7, 27.6],
  [-82.7, 28.9],
  [-83.9, 30.05],
  [-85.3, 29.7],
  [-86.5, 30.4],
  [-88, 30.3],
  [-89.4, 30.2],
  [-89.4, 29.2],
  [-90.4, 29.1],
  [-91.8, 29.6],
  [-93.8, 29.7],
  [-94.8, 29.3],
  [-96.4, 28.3],
  [-97.3, 27.5],
  ...SOUTHERN_BORDER,
  [-118.4, 33.75],
  [-118.5, 34],
  [-120.5, 34.5],
  [-121.9, 36.6],
  [-122.5, 37.8],
  [-123.8, 39.4],
  [-124.4, 40.4],
  [-124.2, 41.8],
  [-124.5, 42.8],
  [-124, 44.8],
  [-124, 46.3],
]

const CANADA: ReadonlyArray<LonLat> = [
  [-123.2, 49],
  ...NORTHERN_BORDER,
  [-88.2, 48.9],
  [-86.5, 48.7],
  [-84.9, 47.9],
  [-84.5, 46.6],
  [-83, 46.2],
  [-81, 46],
  [-80, 45.3],
  [-80.9, 44.6],
  [-81.6, 45.2],
  [-81.7, 43.4],
  [-82.4, 43],
  [-83, 42.3],
  [-82.5, 42],
  [-81, 42.65],
  [-79.1, 42.85],
  [-79.1, 43.25],
  [-79.4, 43.65],
  [-77, 43.95],
  [-76.4, 44.25],
  ...MAINE_BORDER,
  [-66, 45.2],
  [-64.8, 45.6],
  [-64.3, 45.1],
  [-66, 44.4],
  [-65.6, 43.6],
  [-63, 44.6],
  [-62, 45.3],
  [-62, 53],
  [-130, 53],
  [-127.5, 50.6],
  [-125.2, 50],
]

const MEXICO: ReadonlyArray<LonLat> = [
  ...SOUTHERN_BORDER,
  [-116.7, 31.6],
  [-115.7, 30.2],
  [-114.2, 28.8],
  [-115, 27.8],
  [-114.1, 27.2],
  [-112.3, 26.2],
  [-112.1, 24.8],
  [-110.2, 23],
  [-109.5, 23.1],
  [-110.3, 24.2],
  [-111.3, 26],
  [-112.8, 27.9],
  [-114.6, 30],
  [-114.7, 31],
  [-114.8, 31.8],
  [-113.1, 31.2],
  [-112.2, 29],
  [-110.6, 27.3],
  [-109.4, 25.6],
  [-106.4, 23.2],
  [-105.3, 21.5],
  [-105.5, 19],
  [-97, 19],
  [-97.8, 22.3],
  [-97.7, 24],
]

const RIVER_COURSES: ReadonlyArray<ReadonlyArray<LonLat>> = [
  [
    [-95.2, 47.2],
    [-93.2, 45],
    [-91.2, 43.5],
    [-90.4, 41.5],
    [-91.1, 40.6],
    [-90.2, 38.7],
    [-89.2, 37],
    [-89.9, 35.2],
    [-91.1, 33],
    [-91.4, 31],
    [-90.1, 29.95],
    [-89.4, 29.2],
  ],
  [
    [-112, 46],
    [-108, 47.8],
    [-104, 48],
    [-101, 47.3],
    [-100.4, 44.4],
    [-96.5, 42.5],
    [-95.9, 41.2],
    [-94.6, 39.1],
    [-92, 38.6],
    [-90.2, 38.7],
  ],
  [
    [-80, 40.4],
    [-82.5, 38.5],
    [-84.5, 39.1],
    [-86, 38],
    [-87.6, 37.9],
    [-89.2, 37],
  ],
  [
    [-105.8, 40.2],
    [-109.5, 38.5],
    [-111.5, 36.9],
    [-113.5, 36.2],
    [-114.6, 35],
    [-114.7, 32.6],
  ],
  [
    [-117.6, 49],
    [-119.3, 46.2],
    [-121, 45.7],
    [-124, 46.3],
  ],
  [
    [-106.6, 37.7],
    [-106.1, 36],
    [-106.7, 34],
    [-106.5, 31.75],
  ],
]

const RIVERS = Array.map(RIVER_COURSES, course).join(' ')

const MOUNTAIN =
  '<path class="mt-face" d="M-13,8 L0,-13 L13,8 Z"/>' +
  '<path class="mt-shade" d="M0,-13 L13,8 L4,8 L-1,-3 Z"/>' +
  '<path class="mt-line" d="M-13,8 L0,-13 L13,8 M0,-13 L-1,-3 L3,3"/>'

const BROADLEAF =
  '<line class="tree-trunk" x1="0" y1="2" x2="0" y2="8"/>' +
  '<circle class="tree-top" cx="0" cy="-2" r="5.4"/>' +
  '<path class="tree-shade" d="M0,-7.4 A5.4,5.4 0 0 1 0,3.4 A8,8 0 0 0 0,-7.4 Z"/>'

const PINE =
  '<line class="tree-trunk" x1="0" y1="3" x2="0" y2="8"/>' +
  '<path class="tree-top is-pine" d="M0,-10 L5.5,4 L-5.5,4 Z"/>' +
  '<path class="tree-shade" d="M0,-10 L5.5,4 L1,4 Z"/>'

const HILL = '<path class="hill" d="M-11,4 Q0,-9 11,4 M-4,-1 Q0,-3 3,1"/>'

const TUFT = '<path class="tuft" d="M-4,0 L-5.5,-5 M0,0 L0,-6.5 M4,0 L5.5,-5"/>'

const FIELD =
  '<path class="field" d="M-12,-6 H12 M-12,-2 H12 M-12,2 H12 M-12,6 H12"/>' +
  '<rect class="field-edge" x="-14" y="-9" width="28" height="18"/>'

const WAVE = '<path class="wave" d="M-9,0 q4.5,-4 9,0 t9,0"/>'

const MOUNTAINS: ReadonlyArray<LonLat> = [
  [-115.5, 46.6],
  [-114, 44.6],
  [-110.5, 44.8],
  [-109.3, 43.3],
  [-107.5, 44.4],
  [-111.4, 41],
  [-111.8, 39.2],
  [-106.9, 40.9],
  [-107.9, 39.3],
  [-107.6, 37.6],
  [-105.6, 37],
  [-105.9, 35.2],
  [-105.4, 33.3],
  [-121.6, 46.2],
  [-121.8, 44.3],
  [-122, 42.6],
  [-121.4, 40.7],
  [-119.8, 38.5],
  [-118.6, 36.9],
]

const HILLS: ReadonlyArray<LonLat> = [
  [-84.6, 34.9],
  [-83.4, 35.7],
  [-82.1, 36.6],
  [-80.9, 37.6],
  [-79.7, 38.6],
  [-78.5, 39.7],
  [-77.4, 40.8],
  [-75.4, 41.7],
  [-74.3, 43.9],
  [-71.4, 44.3],
  [-93.2, 36.1],
  [-92, 37.1],
  [-115, 36.6],
  [-112.6, 34],
  [-110.6, 33],
  [-109, 35.6],
  [-116, 39.6],
  [-114.4, 41.2],
  [-117.6, 41.6],
  [-103.2, 30.8],
  [-103.6, 44],
]

const BROADLEAVES: ReadonlyArray<LonLat> = [
  [-88, 33.1],
  [-86.5, 32.1],
  [-83, 32.3],
  [-81.8, 33.9],
  [-90, 32.4],
  [-79.4, 35.6],
  [-78, 37.4],
  [-86.2, 36.2],
  [-85, 37.6],
  [-88.6, 36],
  [-80.2, 41],
  [-76.6, 42.4],
  [-72.6, 43.1],
  [-69.4, 45.5],
  [-91, 45.9],
  [-89.4, 45.1],
  [-93.6, 47.6],
  [-85, 44],
  [-92.6, 34.2],
  [-94.6, 31.7],
  [-82, 29.6],
]

const PINES: ReadonlyArray<LonLat> = [
  [-123.1, 46.9],
  [-123.2, 45.1],
  [-123.3, 43.5],
  [-123, 41.4],
  [-117.2, 48.1],
  [-116, 47.7],
  [-120.4, 48.3],
  [-113.8, 48.3],
]

const TUFTS: ReadonlyArray<LonLat> = [
  [-101, 46],
  [-99, 44.6],
  [-100.6, 42.6],
  [-98.4, 40.8],
  [-101.2, 39.4],
  [-99, 38],
  [-97.6, 36.4],
  [-100, 35],
  [-96, 43.8],
  [-102, 33],
  [-99.6, 31.4],
  [-104.6, 45.8],
  [-97.6, 47.6],
  [-98.4, 29.2],
]

const FIELDS: ReadonlyArray<LonLat> = [
  [-93.2, 42.1],
  [-90.2, 40.2],
  [-88.4, 40.2],
  [-85.4, 40.4],
  [-94.6, 40.6],
  [-120.6, 37],
]

const WAVES: ReadonlyArray<LonLat> = [
  [-126.2, 45],
  [-126, 40],
  [-124.2, 36.2],
  [-121.6, 31.6],
  [-118, 28.4],
  [-123.4, 26.6],
  [-94, 27],
  [-90.6, 26.4],
  [-86, 27.6],
  [-93, 23.2],
  [-76.4, 32],
  [-73.4, 36.4],
  [-70.6, 39.6],
  [-77, 28.4],
  [-72, 31],
  [-67.4, 42.6],
  [-69.2, 34.8],
  [-87, 47.9],
  [-86.9, 43.6],
]

const WASH_COLORS: ReadonlyArray<readonly [name: string, color: string]> = [
  ['wood', '#7f9a52'],
  ['pine', '#5f8660'],
  ['rock', '#9a8468'],
  ['moor', '#c2a85e'],
  ['sand', '#cf9f66'],
]

const WASH_GRADIENTS = joinMarkup(
  Array.map(
    WASH_COLORS,
    ([name, color]) =>
      `<radialGradient id="wash-${name}">` +
      `<stop offset="0" stop-color="${color}" stop-opacity="0.5"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
      '</radialGradient>',
  ),
)

type Wash = readonly [
  name: string,
  lon: number,
  lat: number,
  radiusX: number,
  radiusY: number,
]

const WASH_AREAS: ReadonlyArray<Wash> = [
  ['rock', -109.4, 42, 100, 150],
  ['rock', -120.8, 41.5, 44, 130],
  ['pine', -122.6, 45.5, 44, 80],
  ['moor', -99.5, 40, 80, 160],
  ['sand', -112.5, 35, 90, 70],
  ['wood', -83.5, 35.2, 130, 100],
  ['wood', -75, 42.6, 90, 60],
  ['wood', -90.4, 45.6, 80, 44],
]

const WASHES = joinMarkup(
  Array.map(
    WASH_AREAS,
    ([name, lon, lat, radiusX, radiusY]) =>
      `<ellipse fill="url(#wash-${name})" cx="${fixed(projectX(lon))}" cy="${fixed(projectY(lat))}" rx="${radiusX}" ry="${radiusY}"/>`,
  ),
)

const COMPASS = joinMarkup([
  '<g transform="translate(884 486) scale(1.25)">',
  '<circle class="compass-ring" r="22"/>',
  '<circle class="compass-ring thin" r="18.5"/>',
  '<path class="compass-minor" transform="rotate(45)" d="M0,-14 L3,-3 L14,0 L3,3 L0,14 L-3,3 L-14,0 L-3,-3 Z"/>',
  '<path class="compass-light" d="M0,-21 L4.5,-4.5 L21,0 L4.5,4.5 L0,21 L-4.5,4.5 L-21,0 L-4.5,-4.5 Z"/>',
  '<path class="compass-dark" d="M0,-21 L4.5,-4.5 L0,0 Z M21,0 L4.5,4.5 L0,0 Z M0,21 L-4.5,4.5 L0,0 Z M-21,0 L-4.5,-4.5 L0,0 Z"/>',
  '<text class="compass-north" y="-25.5" text-anchor="middle">N</text>',
  '</g>',
])

const CARTOUCHE = joinMarkup([
  '<g transform="translate(606 548) scale(0.8)">',
  '<path class="cartouche-ribbon" d="M-128,-14 L-112,-20 V20 L-128,14 L-121,0 Z M128,-14 L112,-20 V20 L128,14 L121,0 Z"/>',
  '<rect class="cartouche-plate" x="-114" y="-31" width="228" height="62" rx="4"/>',
  '<rect class="cartouche-rule" x="-110" y="-27" width="220" height="54" rx="2.5"/>',
  '<text class="cartouche-title" y="0" text-anchor="middle">ALL ABOARD</text>',
  '<path class="cartouche-flourish" d="M-70,8 H-12 M12,8 H70 M-6,8 L0,5 L6,8 L0,11 Z"/>',
  '<text class="cartouche-sub" y="21" text-anchor="middle">A Railway Map of the United States · Anno 1887</text>',
  '</g>',
])

const SCALE_BAR = joinMarkup([
  '<g transform="translate(70 556)">',
  '<rect class="scale-frame" x="0" y="0" width="120" height="6"/>',
  '<path class="scale-fill" d="M0,0 h30 v6 h-30 Z M60,0 h30 v6 h-30 Z"/>',
  '<text class="scale-label" x="0" y="-4" text-anchor="middle">0</text>',
  '<text class="scale-label" x="60" y="-4" text-anchor="middle">250</text>',
  '<text class="scale-label" x="120" y="-4" text-anchor="middle">500</text>',
  '<text class="scale-label" x="60" y="18" text-anchor="middle">Miles</text>',
  '</g>',
])

const PLACE_NAMES = joinMarkup([
  '<text class="place-name is-water" x="124" y="470" text-anchor="middle">Pacific Ocean</text>',
  '<text class="place-name is-water" transform="translate(880 384) rotate(-62)" text-anchor="middle">Atlantic Ocean</text>',
  '<text class="place-name is-water is-small" x="592" y="498" text-anchor="middle">Gulf of Mexico</text>',
  '<text class="place-name is-small" x="470" y="57" text-anchor="middle">Dominion of Canada</text>',
  '<text class="place-name is-small" x="372" y="486" text-anchor="middle">Mexico</text>',
  '<text class="place-name is-small" transform="translate(300 300) rotate(-28)" text-anchor="middle">Rocky Mountains</text>',
  '<text class="place-name is-small" x="524" y="200" text-anchor="middle">Great Plains</text>',
])

const landmass = (className: string, points: ReadonlyArray<LonLat>): string =>
  `<path class="${className}" d="${outline(points)}"/>`

const LANDS: ReadonlyArray<ReadonlyArray<LonLat>> = [
  CANADA,
  MEXICO,
  UNITED_STATES,
]

export const MAP_ART = joinMarkup([
  `<defs>${WASH_GRADIENTS}</defs>`,
  '<rect class="map-water" x="40" y="30" width="920" height="566"/>',
  ...Array.map(LANDS, points => landmass('map-shoal is-wide', points)),
  ...Array.map(LANDS, points => landmass('map-shoal', points)),
  ...Array.map(LANDS, points => landmass('map-surf', points)),
  landmass('map-abroad', CANADA),
  landmass('map-abroad', MEXICO),
  landmass('map-land', UNITED_STATES),
  '<clipPath id="map-land-clip">',
  `<path d="${outline(UNITED_STATES)}"/>`,
  '</clipPath>',
  '<g clip-path="url(#map-land-clip)">',
  WASHES,
  `<path class="map-river-bank" d="${RIVERS}"/>`,
  `<path class="map-river" d="${RIVERS}"/>`,
  placed(FIELDS, FIELD),
  placed(HILLS, HILL),
  placed(TUFTS, TUFT),
  placed(MOUNTAINS, MOUNTAIN, index => 0.85 + ((index * 7) % 5) * 0.09),
  placed(BROADLEAVES, BROADLEAF, index => 0.9 + ((index * 3) % 4) * 0.08),
  placed(PINES, PINE, index => 0.9 + ((index * 5) % 4) * 0.08),
  '</g>',
  landmass('map-coast', UNITED_STATES),
  placed(WAVES, WAVE),
  PLACE_NAMES,
  COMPASS,
  CARTOUCHE,
  SCALE_BAR,
  '<rect class="neatline" x="46" y="36" width="908" height="554"/>',
  '<rect class="neatline thin" x="51" y="41" width="898" height="544"/>',
])

/** A small rubbish bin for delete buttons. Drawn in currentColor. */
export const BIN_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'
