export type Hex = { q: number; r: number };
export type PatternId =
  | 'settler'
  | 'melee1' | 'light1' | 'ranged1' | 'melee2' | 'anti' | 'heavy1'
  | 'melee3' | 'ranged2' | 'sniper' | 'light2' | 'melee4' | 'heavy2' | 'harrier';

export type UnitFamily = 'Settler' | 'Melee' | 'Light cavalry' | 'Heavy cavalry' | 'Ranged' | 'Hunter' | 'Sniper' | 'Harrier';

export type Pattern = {
  id: PatternId;
  name: string;
  short: string;
  family: UnitFamily;
  unlock: number;
  generation: number;
  green: Hex[];
  red: Hex[];
  brown: Hex[];
  blue: Hex[];
  description: string;
};

export const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];

export const diagonalSteps = [DIRECTIONS[1], DIRECTIONS[2], DIRECTIONS[4], DIRECTIONS[5]];
export const straight = (length: number): Hex[] => DIRECTIONS.map(({ q, r }) => ({ q: q * length, r: r * length }));
export const rays = (length: number): Hex[] => Array.from({ length }, (_, i) => straight(i + 1)).flat();
export const ring = (radius: number): Hex[] => {
  const result: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === radius) result.push({ q, r });
    }
  }
  return result;
};

// The six hexes between the six straight rays on the second ring.
export const angledTwo: Hex[] = [
  { q: 1, r: -2 }, { q: 2, r: -1 }, { q: 1, r: 1 },
  { q: -1, r: 2 }, { q: -2, r: 1 }, { q: -1, r: -1 },
];

// These non-standard outer rings are copied as axial offsets from the supplied diagram.
const heavyShots: Hex[] = [
  { q: 1, r: -4 }, { q: 3, r: -4 }, { q: -1, r: -3 }, { q: 4, r: -3 },
  { q: -3, r: -1 }, { q: 4, r: -1 }, { q: -4, r: 1 }, { q: 3, r: 1 },
  { q: -4, r: 3 }, { q: 1, r: 3 }, { q: -3, r: 4 }, { q: -1, r: 4 },
];

// The Hunter diagram has six straight ring-two pounces plus six long angled
// pounces. Its green squares are the six adjacent and six angled ring-two hexes.
const hunterPounces: Hex[] = [
  ...straight(2),
  ...angledTwo.map(({ q, r }) => ({ q: q * 2, r: r * 2 })),
];

const sniperShots: Hex[] = [
  { q: 0, r: -4 }, { q: 2, r: -4 }, { q: 4, r: -4 },
  { q: -2, r: -2 }, { q: 4, r: -2 }, { q: -4, r: 0 }, { q: 4, r: 0 },
  { q: -4, r: 2 }, { q: 2, r: 2 },
  { q: -4, r: 4 }, { q: -2, r: 4 }, { q: 0, r: 4 },
];

const harrierOuter: Hex[] = [
  { q: 1, r: -3 }, { q: 2, r: -3 },
  { q: -1, r: -2 }, { q: 3, r: -2 },
  { q: -2, r: -1 }, { q: 3, r: -1 },
  { q: -3, r: 0 }, { q: 3, r: 0 },
  { q: -3, r: 1 }, { q: 2, r: 1 },
  { q: -3, r: 2 }, { q: 1, r: 2 },
  { q: -2, r: 3 }, { q: -1, r: 3 },
];

export const PATTERNS: Pattern[] = [
  { id: 'settler', name: 'Settler', short: 'ST', family: 'Settler', unlock: 0, generation: 1,
    green: [...ring(1), ...ring(2)], red: [], brown: [], blue: [], description: 'Full radius-2 hex (18 move-only hexes). Cannot attack. Special action: Found a City.' },
  { id: 'melee1', name: 'Melee I', short: 'M1', family: 'Melee', unlock: 1, generation: 1,
    green: [], red: diagonalSteps, brown: [], blue: [], description: 'Four adjacent diagonal strikes. No horizontal attack.' },
  { id: 'light1', name: 'Light Cavalry I', short: 'L1', family: 'Light cavalry', unlock: 2, generation: 1,
    green: diagonalSteps, red: angledTwo, brown: [], blue: [], description: 'Four diagonal steps; six angled charges on ring two.' },
  { id: 'ranged1', name: 'Ranged I', short: 'R1', family: 'Ranged', unlock: 3, generation: 1,
    green: diagonalSteps, red: [], brown: straight(2), blue: [], description: 'Four diagonal steps; six straight shots exactly two hexes away.' },
  { id: 'melee2', name: 'Melee II', short: 'M2', family: 'Melee', unlock: 4, generation: 2,
    green: [], red: straight(1), brown: [], blue: [], description: 'All six adjacent hexes become move-and-capture squares.' },
  { id: 'anti', name: 'Hunter', short: 'HU', family: 'Hunter', unlock: 5, generation: 1,
    green: [...straight(1), ...angledTwo], red: [], brown: [], blue: hunterPounces, description: '12 move-only hexes; 12 enemy-only pounce destinations. In simultaneous rounds pounces, like all attacks, resolve before movement.' },
  { id: 'heavy1', name: 'Heavy Cavalry I', short: 'H1', family: 'Heavy cavalry', unlock: 6, generation: 1,
    green: [], red: [...straight(1), ...angledTwo], brown: [], blue: [], description: 'Six adjacent captures and six angled ring-two charges.' },
  { id: 'melee3', name: 'Melee III', short: 'M3', family: 'Melee', unlock: 7, generation: 3,
    green: [], red: rays(2), brown: [], blue: [], description: 'Move and capture along all six straight rays, up to two hexes.' },
  { id: 'ranged2', name: 'Ranged II', short: 'R2', family: 'Ranged', unlock: 8, generation: 2,
    green: straight(1), red: [], brown: ring(2), blue: [], description: 'Six adjacent steps; ranged fire to all 12 hexes on ring two.' },
  { id: 'sniper', name: 'Sniper', short: 'SN', family: 'Sniper', unlock: 9, generation: 1,
    green: straight(1), red: [], brown: sniperShots, blue: [], description: 'Six adjacent steps; 12 fixed firing lanes exactly four hexes away.' },
  { id: 'light2', name: 'Light Cavalry II', short: 'L2', family: 'Light cavalry', unlock: 10, generation: 2,
    green: straight(1), red: [...angledTwo, ...straight(3)], brown: [], blue: [], description: 'Six adjacent moves, six angled charges, and six straight three-hex charges.' },
  { id: 'melee4', name: 'Melee IV', short: 'M4', family: 'Melee', unlock: 11, generation: 4,
    green: [], red: rays(3), brown: [], blue: [], description: 'Move and capture along all six straight rays, up to three hexes.' },
  { id: 'heavy2', name: 'Heavy Cavalry II', short: 'H2', family: 'Heavy cavalry', unlock: 12, generation: 2,
    green: [], red: [...straight(1), ...angledTwo], brown: heavyShots, blue: [], description: 'Heavy Cavalry I charges plus 12 offset ring-four ranged attacks.' },
  { id: 'harrier', name: 'Harrier', short: 'HR', family: 'Harrier', unlock: 13, generation: 1,
    green: [...ring(2), ...harrierOuter], red: straight(1), brown: [], blue: [], description: 'Six adjacent captures; 26 long relocation squares on rings two and three.' },
];

export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map((pattern) => [pattern.id, pattern])) as Record<PatternId, Pattern>;
export const PATTERN_IDS = PATTERNS.map((pattern) => pattern.id);
export const FAMILIES: UnitFamily[] = ['Settler', 'Melee', 'Light cavalry', 'Heavy cavalry', 'Ranged', 'Hunter', 'Sniper', 'Harrier'];

export function distance(a: Hex, b: Hex): number {
  const q = a.q - b.q;
  const r = a.r - b.r;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

export function hexKey(hex: Hex): string { return `${hex.q},${hex.r}`; }
export function add(a: Hex, b: Hex): Hex { return { q: a.q + b.q, r: a.r + b.r }; }

export type MapSizeKey = 'duel' | 'clash' | 'battle' | 'war';

export type MapConfig = {
  key: MapSizeKey;
  name: string;
  width: number;
  height: number;
  wrap: boolean;
  recommendedPlayers: number;
};

export const MAP_CONFIGS: Record<MapSizeKey, MapConfig> = {
  duel: { key: 'duel', name: 'Duel', width: 22, height: 16, wrap: false, recommendedPlayers: 2 },
  clash: { key: 'clash', name: 'Clash', width: 32, height: 24, wrap: true, recommendedPlayers: 4 },
  battle: { key: 'battle', name: 'Battle', width: 40, height: 30, wrap: true, recommendedPlayers: 6 },
  war: { key: 'war', name: 'War', width: 50, height: 38, wrap: true, recommendedPlayers: 10 },
};

export function offsetToHex(col: number, row: number): Hex {
  return { q: col - Math.floor(row / 2), r: row };
}

export function hexToOffset(hex: Hex): { col: number; row: number } {
  return { col: hex.q + Math.floor(hex.r / 2), row: hex.r };
}

export function wrapHex(hex: Hex, width: number, height: number, wrap: boolean): Hex | null {
  const { col, row } = hexToOffset(hex);
  if (row < 0 || row >= height) return null;
  if (!wrap) {
    if (col < 0 || col >= width) return null;
    return hex;
  }
  const wrappedCol = ((col % width) + width) % width;
  return offsetToHex(wrappedCol, row);
}

export function onBoard(hex: Hex, width: number, height: number, wrap: boolean): boolean {
  const { col, row } = hexToOffset(hex);
  if (row < 0 || row >= height) return false;
  if (!wrap && (col < 0 || col >= width)) return false;
  return true;
}

export function wrapDistance(a: Hex, b: Hex, width: number, wrap: boolean): number {
  if (!wrap) return distance(a, b);
  const { col: colB, row: rowB } = hexToOffset(b);
  let minD = Infinity;
  for (const dx of [-width, 0, width]) {
    const wrappedB = offsetToHex(colB + dx, rowB);
    const d = distance(a, wrappedB);
    if (d < minD) minD = d;
  }
  return minD;
}