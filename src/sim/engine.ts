import {
  DIRECTIONS, FAMILIES, MAP_CONFIGS, PATTERN_BY_ID, PATTERNS, add, distance, hexKey,
  hexToOffset, offsetToHex, wrapDistance, wrapHex,
  type Hex, type MapSizeKey, type PatternId, type UnitFamily,
} from './patterns';
import { CITY_INHERENT_PRODUCTION, UNIT_PRODUCTION_COST, UNIT_PROFILES, patternFingerprint, type UnitProfile } from './config';

export { hexToOffset, offsetToHex, MAP_CONFIGS };

type ProfileOverlays = Partial<Record<PatternId, Partial<UnitProfile>>>;
let profileOverlays: [ProfileOverlays, ProfileOverlays] = [{}, {}];

export function setProfileOverlays(overlays: ProfileOverlays = {}): void {
  profileOverlays = [overlays, overlays];
}

export function setTeamProfileOverlays(overlays: [ProfileOverlays, ProfileOverlays]): void {
  profileOverlays = overlays;
}

function autoIdealRange(unit: Unit): number {
  const pattern = PATTERN_BY_ID[unit.type];
  const offsets = pattern.brown.length ? pattern.brown : pattern.blue.length ? pattern.blue : pattern.red;
  if (!offsets.length) return 1;
  const cached = idealRanges.get(offsets);
  if (cached !== undefined) return cached;
  const radii = offsets.map((offset) => distance({ q: 0, r: 0 }, offset)).sort((a, b) => a - b);
  const middle = Math.floor(radii.length / 2);
  const ideal = radii.length % 2 ? radii[middle] : (radii[middle - 1] + radii[middle]) / 2;
  idealRanges.set(offsets, ideal);
  return ideal;
}

const idealRanges = new WeakMap<Hex[], number>();

export function effectiveProfile(unit: Unit): UnitProfile {
  const base = UNIT_PROFILES[unit.type] || UNIT_PROFILES.melee1;
  const delta = profileOverlays[unit.team % 2]?.[unit.type];
  const merged = delta ? { ...base, ...delta } : base;
  if (merged.idealRange > 0) return merged;
  return { ...merged, idealRange: autoIdealRange(unit) };
}

export type Team = number; // player index 0..9
export type TurnMode = 'simultaneous' | 'sequential'; // kept for reading legacy data
export type WinReason = 'capture' | 'elimination' | 'attrition' | 'mutual';

export type Player = {
  id: number;
  name: string;
  color: string;
  isAi: boolean;
  eliminated: boolean;
};

export const PLAYER_COLORS = [
  '#91d6bd', // Teal
  '#e8a488', // Coral
  '#f4cb74', // Gold
  '#9ab3f5', // Blue
  '#c89bf5', // Purple
  '#7fe5d9', // Cyan
  '#f28ba8', // Rose
  '#b4e578', // Lime
  '#f7a35c', // Orange
  '#66b2ff', // Sky Blue
];

export const CIV_NAMES = [
  'Rome', 'Greece', 'Egypt', 'Japan', 'Babylon',
  'Persia', 'Carthage', 'Maya', 'Mongolia', 'Byzantium',
];

export type City = {
  id: number;
  name: string;
  pos: Hex;
  owner: number;
  originalOwner: number;
  isCapital: boolean;
  productionProgress: number;
  productionStored?: Partial<Record<PatternId, number>>;
  productionOverflow?: number;
  producing: PatternId;
  territory: Hex[];
};

export type Policy = {
  kill: number;
  safety: number;
  city: number;
  advance: number;
  range: number;
  mobility: number;
  initiative: number;
};

export const DEFAULT_POLICY: Policy = {
  kill: 2.25, safety: 1.75, city: 1.45, advance: 1.0,
  range: 0.82, mobility: 0.42, initiative: 0.88,
};

export const BOARD_WIDTH = 22;
export const BOARD_HEIGHT = 16;
export const MAX_ROUNDS = 100;
export const TRAINING_ROUNDS = 50;

export type Unit = {
  uid: number;
  type: PatternId;
  team: Team;
  pos: Hex;
  alive: boolean;
  acted: boolean;
  kills: number;
  shots: number;
  moves: number;
};

export type GameState = {
  units: Unit[];
  cities: Hex[]; // backwards compatibility
  cityEntities: City[]; // full 4X city entities
  mountains: Hex[];
  terrain: Set<string>;
  round: number;
  stage: number;
  mode: TurnMode;
  width: number;
  height: number;
  wrap: boolean;
  mapSizeKey: MapSizeKey;
  playerCount: number;
  players: Player[];
  winner: Team | null;
  reason: WinReason | null;
  finished: boolean;
};

export type SpecialActionType = 'found_city';

export type Action = {
  uid: number;
  kind: 'move' | 'attack' | 'wait' | 'special';
  channel: 'green' | 'red' | 'brown' | 'blue' | 'wait' | 'special';
  target: Hex;
  specialAction?: SpecialActionType;
};

export type UnitResult = {
  type: PatternId;
  team: Team;
  kills: number;
  survived: boolean;
  shots: number;
  moves: number;
};

export type BoardSnapshot = {
  units: Pick<Unit, 'uid' | 'type' | 'team' | 'pos'>[];
  cities: Hex[];
  cityEntities?: City[];
  mountains: Hex[];
  round: number;
  stage: number;
  mode: TurnMode;
  width?: number;
  height?: number;
  wrap?: boolean;
};

export type GameResult = {
  winner: Team | null;
  reason: WinReason;
  rounds: number;
  stage: number;
  units: UnitResult[];
  snapshot: BoardSnapshot;
};

export type ScenarioOptions = {
  stage?: number;
  duel?: [PatternId, PatternId];
  mode?: TurnMode;
  maxRounds?: number;
  lookahead?: boolean;
  mapSize?: MapSizeKey;
  playerCount?: number;
  firstSide?: Team; // legacy option
};

export class Random {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 0x6d2b79f5; }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(items: T[]): T { return items[Math.floor(this.next() * items.length)]; }
  shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

export function onBoard(hex: Hex, width = BOARD_WIDTH, height = BOARD_HEIGHT, wrap = false): boolean {
  const col = hex.q + Math.floor(hex.r / 2);
  if (hex.r < 0 || hex.r >= height) return false;
  if (!wrap && (col < 0 || col >= width)) return false;
  return true;
}

export function boardHexes(width = BOARD_WIDTH, height = BOARD_HEIGHT): Hex[] {
  const hexes: Hex[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) hexes.push(offsetToHex(col, row));
  }
  return hexes;
}

function occupancy(state: GameState): Map<string, Unit> {
  const map = new Map<string, Unit>();
  for (const unit of state.units) if (unit.alive) map.set(hexKey(unit.pos), unit);
  return map;
}

function blocked(state: GameState, hex: Hex): boolean {
  return !onBoard(hex, state.width, state.height, state.wrap) || state.terrain.has(hexKey(hex));
}

function hostileCenter(state: GameState, hex: Hex, team: Team): boolean {
  return state.cityEntities.some((city) => city.owner !== team && hexKey(city.pos) === hexKey(hex));
}

// A long move can take any shortest path, but it may never pass through a unit or obstacle.
function clearMovePath(state: GameState, start: Hex, end: Hex, occupied: Map<string, Unit>): boolean {
  const team = occupied.get(hexKey(start))?.team;
  if (team !== undefined && hostileCenter(state, end, team)) return false;
  const remaining = wrapDistance(start, end, state.width, state.wrap);
  if (remaining <= 1) return true;
  const frontier: Hex[] = [start];
  const seen = new Set<string>([hexKey(start)]);
  for (let step = remaining; step > 1; step--) {
    const next: Hex[] = [];
    for (const from of frontier) {
      for (const direction of DIRECTIONS) {
        const rawHex = add(from, direction);
        const hex = wrapHex(rawHex, state.width, state.height, state.wrap);
        if (!hex) continue;
        const key = hexKey(hex);
        if (wrapDistance(hex, end, state.width, state.wrap) !== step - 1 || seen.has(key) || blocked(state, hex) || occupied.has(key)
          || team !== undefined && hostileCenter(state, hex, team)) continue;
        seen.add(key);
        next.push(hex);
      }
    }
    if (next.length === 0) return false;
    frontier.splice(0, frontier.length, ...next);
  }
  return frontier.some((from) => DIRECTIONS.some((dir) => {
    const hex = wrapHex(add(from, dir), state.width, state.height, state.wrap);
    return hex && hex.q === end.q && hex.r === end.r;
  }));
}

function cubeRound(q: number, r: number): Hex {
  let x = Math.round(q);
  let z = Math.round(r);
  const y = Math.round(-q - r);
  const dx = Math.abs(x - q);
  const dy = Math.abs(y + q + r);
  const dz = Math.abs(z - r);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dz > dy) z = -x - y;
  return { q: x, r: z };
}

function lineOfSight(state: GameState, from: Hex, to: Hex, team: Team, occupied: Map<string, Unit>): boolean {
  const { col: colTo, row: rowTo } = hexToOffset(to);
  let bestDx = 0;
  let minD = distance(from, to);
  if (state.wrap) {
    for (const dx of [-state.width, 0, state.width]) {
      const testHex = offsetToHex(colTo + dx, rowTo);
      const d = distance(from, testHex);
      if (d < minD) {
        minD = d;
        bestDx = dx;
      }
    }
  }
  const targetImage = offsetToHex(colTo + bestDx, rowTo);
  const length = minD;
  for (let i = 1; i < length; i++) {
    const t = i / length;
    const rawHex = cubeRound(from.q + (targetImage.q - from.q) * t + 0.000001, from.r + (targetImage.r - from.r) * t + 0.000001);
    const hex = wrapHex(rawHex, state.width, state.height, state.wrap);
    if (!hex || blocked(state, hex)) return false;
    const unit = occupied.get(hexKey(hex));
    if (unit && unit.team !== team) return false;
  }
  return true;
}

export function hasOffset(offsets: Hex[], from: Hex, to: Hex, state?: { width: number; height: number; wrap: boolean }): boolean {
  const w = state?.width || BOARD_WIDTH;
  const h = state?.height || BOARD_HEIGHT;
  const wrap = state?.wrap || false;
  for (const offset of offsets) {
    const target = wrapHex(add(from, offset), w, h, wrap);
    if (target && target.q === to.q && target.r === to.r) return true;
  }
  return false;
}

const offsetRadius = new WeakMap<Hex[], number>();

function maxOffsetRadius(offsets: Hex[]): number {
  let radius = offsetRadius.get(offsets);
  if (radius === undefined) {
    radius = offsets.reduce((max, hex) => Math.max(max, distance({ q: 0, r: 0 }, hex)), 0);
    offsetRadius.set(offsets, radius);
  }
  return radius;
}

export function legalActions(state: GameState, unit: Unit, occupied = occupancy(state)): Action[] {
  if (!unit.alive) return [];
  const pattern = PATTERN_BY_ID[unit.type];
  const actions: Action[] = [];

  // Special actions for Settler: Found a City
  if (unit.type === 'settler') {
    const check = canFoundCity(state, unit.pos);
    if (check.valid) {
      actions.push({ uid: unit.uid, kind: 'special', channel: 'special', target: { ...unit.pos }, specialAction: 'found_city' });
    }
  }

  const addMovement = (offsets: Hex[], channel: 'green' | 'red') => {
    for (const offset of offsets) {
      const rawTarget = add(unit.pos, offset);
      const target = wrapHex(rawTarget, state.width, state.height, state.wrap);
      if (!target || blocked(state, target) || hostileCenter(state, target, unit.team)) continue;
      const other = occupied.get(hexKey(target));
      // Enemy-occupied tiles are never valid green moves; friendly-occupied
      // tiles are valid in simultaneous mode because the ally may vacate this
      // turn. Resolution cancels the move if the tile was not freed.
      if (other && other.team !== unit.team && channel === 'green') continue;
      if (other && other.team === unit.team && state.mode !== 'simultaneous') continue;
      if (!clearMovePath(state, unit.pos, target, occupied)) continue;
      actions.push({ uid: unit.uid, kind: other && other.team !== unit.team ? 'attack' : 'move', channel, target });
    }
  };
  addMovement(pattern.green, 'green');
  addMovement(pattern.red, 'red');

  for (const offset of pattern.blue) {
    const rawTarget = add(unit.pos, offset);
    const target = wrapHex(rawTarget, state.width, state.height, state.wrap);
    if (!target || blocked(state, target) || hostileCenter(state, target, unit.team)) continue;
    const victim = occupied.get(hexKey(target));
    if (victim && victim.team !== unit.team && clearMovePath(state, unit.pos, target, occupied)) {
      actions.push({ uid: unit.uid, kind: 'attack', channel: 'blue', target });
    }
  }

  for (const offset of pattern.brown) {
    const rawTarget = add(unit.pos, offset);
    const target = wrapHex(rawTarget, state.width, state.height, state.wrap);
    if (!target || blocked(state, target)) continue;
    const victim = occupied.get(hexKey(target));
    if (victim && victim.team !== unit.team && lineOfSight(state, unit.pos, target, unit.team, occupied)) {
      actions.push({ uid: unit.uid, kind: 'attack', channel: 'brown', target });
    }
  }

  return actions;
}

function canAttack(state: GameState, attacker: Unit, target: Unit, occupied: Map<string, Unit>): boolean {
  const pattern = PATTERN_BY_ID[attacker.type];
  if (hasOffset(pattern.red, attacker.pos, target.pos, state) || hasOffset(pattern.blue, attacker.pos, target.pos, state)) {
    return clearMovePath(state, attacker.pos, target.pos, occupied);
  }
  return hasOffset(pattern.brown, attacker.pos, target.pos, state) && lineOfSight(state, attacker.pos, target.pos, attacker.team, occupied);
}

function attacksCityHex(state: GameState, unit: Unit, hex: Hex, occupied: Map<string, Unit>): boolean {
  const pattern = PATTERN_BY_ID[unit.type];
  if (hasOffset(pattern.red, unit.pos, hex, state) && clearMovePath(state, unit.pos, hex, occupied)) return true;
  const occupant = occupied.get(hexKey(hex));
  return !!occupant && occupant.team !== unit.team && hasOffset(pattern.blue, unit.pos, hex, state)
    && clearMovePath(state, unit.pos, hex, occupied);
}

export function cityCoverage(state: GameState, cityPos: Hex, team: Team, occupied = occupancy(state)): { covered: number; occupied: number } {
  let covered = 0;
  let physicallyOccupied = 0;
  const allies = state.units.filter((unit) => unit.alive && unit.team === team);
  for (const direction of DIRECTIONS) {
    const adj = wrapHex(add(cityPos, direction), state.width, state.height, state.wrap);
    if (!adj) {
      covered++;
      continue;
    }
    const occupant = occupied.get(hexKey(adj));
    if (occupant?.team === team) {
      physicallyOccupied++;
      covered++;
    } else if (allies.some((unit) => attacksCityHex(state, unit, adj, occupied))) {
      covered++;
    }
  }
  return { covered, occupied: physicallyOccupied };
}

export function canFoundCity(state: GameState, pos: Hex): { valid: boolean; reason?: string } {
  if (!onBoard(pos, state.width, state.height, false)) return { valid: false, reason: 'Outside the map' };
  if (state.terrain.has(hexKey(pos))) return { valid: false, reason: 'Cannot settle on mountains' };
  if (state.cityEntities.some((c) => hexKey(c.pos) === hexKey(pos))) return { valid: false, reason: 'Tile is already a city center' };
  if (state.cityEntities.some((c) => wrapDistance(c.pos, pos, state.width, state.wrap) < 3)) {
    return { valid: false, reason: 'Too close to another city (minimum 3 tiles spacing)' };
  }
  return { valid: true };
}

export function computeCityTerritory(pos: Hex, width: number, height: number, wrap: boolean, terrain: Set<string>): Hex[] {
  const result: Hex[] = [pos];
  for (const dir of DIRECTIONS) {
    const adj = wrapHex(add(pos, dir), width, height, wrap);
    if (adj && !terrain.has(hexKey(adj))) result.push(adj);
  }
  return result;
}

export function executeFoundCity(state: GameState, settler: Unit): City | null {
  if (!settler.alive || settler.type !== 'settler') return null;
  const check = canFoundCity(state, settler.pos);
  if (!check.valid) return null;

  settler.alive = false;

  const isCapital = !state.cityEntities.some((c) => c.originalOwner === settler.team);
  const cityCount = state.cityEntities.filter((c) => c.originalOwner === settler.team).length;
  const civName = CIV_NAMES[settler.team % CIV_NAMES.length] || `Civ ${settler.team + 1}`;
  const cityName = isCapital ? `${civName} Prime` : `${civName} ${cityCount + 1}`;

  const territory = computeCityTerritory(settler.pos, state.width, state.height, state.wrap, state.terrain);
  const newCity: City = {
    id: state.cityEntities.length,
    name: cityName,
    pos: { ...settler.pos },
    owner: settler.team,
    originalOwner: settler.team,
    isCapital,
    productionProgress: 0,
    productionStored: {},
    productionOverflow: 0,
    producing: 'melee1',
    territory,
  };

  state.cityEntities.push(newCity);
  state.cities.push(newCity.pos);
  return newCity;
}

export function processCityProduction(state: GameState, cities = state.cityEntities): { city: City; unit: Unit }[] {
  const spawned: { city: City; unit: Unit }[] = [];
  const occupied = occupancy(state);

  for (const city of cities) {
    normalizeProduction(city);
    if (city.productionProgress === 0 && state.players[city.owner]?.isAi) {
      const pool = PATTERNS.filter((pattern) => pattern.id !== 'settler');
      if (pool.length) setCityProduction(city, pool[(city.id + state.round) % pool.length].id);
    }
    city.productionProgress += CITY_INHERENT_PRODUCTION + (city.productionOverflow || 0);
    city.productionOverflow = 0;
    city.productionStored![city.producing] = city.productionProgress;
    if (city.productionProgress >= UNIT_PRODUCTION_COST) {
      let spawnTile: Hex | null = null;
      if (!occupied.has(hexKey(city.pos)) && !state.terrain.has(hexKey(city.pos))) {
        spawnTile = city.pos;
      } else {
        for (const tile of city.territory) {
          if (!occupied.has(hexKey(tile)) && !state.terrain.has(hexKey(tile))) {
            spawnTile = tile;
            break;
          }
        }
      }

      if (spawnTile) {
        city.productionOverflow = city.productionProgress - UNIT_PRODUCTION_COST;
        city.productionStored![city.producing] = 0;
        city.productionProgress = 0;
        const newUid = state.units.length;
        const newUnit: Unit = {
          uid: newUid,
          type: city.producing || 'melee1',
          team: city.owner,
          pos: { ...spawnTile },
          alive: true,
          acted: false,
          kills: 0,
          shots: 0,
          moves: 0,
        };
        state.units.push(newUnit);
        occupied.set(hexKey(newUnit.pos), newUnit);
        spawned.push({ city, unit: newUnit });
      }
    }
  }
  return spawned;
}

export function normalizeProduction(city: City): void {
  if (!city.productionStored) city.productionStored = { [city.producing]: city.productionProgress || 0 };
  if (city.productionOverflow === undefined) city.productionOverflow = 0;
}

export function productionFor(city: City, type = city.producing): number {
  return city.productionStored?.[type] ?? (type === city.producing ? city.productionProgress : 0);
}

export function setCityProduction(city: City, type: PatternId): void {
  if (!PATTERNS.some((pattern) => pattern.id === type)) return;
  normalizeProduction(city);
  city.productionStored![city.producing] = city.productionProgress;
  city.producing = type;
  city.productionProgress = city.productionStored![type] || 0;
}

export function processCityCaptures(state: GameState): { city: City; oldOwner: number; newOwner: number }[] {
  const captures: { city: City; oldOwner: number; newOwner: number }[] = [];
  const occupied = occupancy(state);

  for (const city of state.cityEntities) {
    let captor: number | null = null;
    const enemyTeams = state.players.filter((p) => p.id !== city.owner && !p.eliminated).map((p) => p.id);
    for (const enemyTeam of enemyTeams) {
      const coverage = cityCoverage(state, city.pos, enemyTeam, occupied);
      if (coverage.covered >= 6 && coverage.occupied >= 1) {
        captor = enemyTeam;
        break;
      }
    }

    if (captor !== null) {
      const oldOwner = city.owner;
      city.owner = captor;
      captures.push({ city, oldOwner, newOwner: captor });
    }
  }
  return captures;
}

export function checkVictory(state: GameState): void {
  if (state.finished) return;
  const totalPlayers = state.players.length || 2;
  const requiredCapitals = Math.ceil(totalPlayers * (2 / 3));

  // 1. Domination Victory: Control >= 2/3 of all original capitals
  for (const player of state.players) {
    if (player.eliminated) continue;
    const capitalsControlled = state.cityEntities.filter((c) => c.isCapital && c.owner === player.id).length;
    if (capitalsControlled >= requiredCapitals) {
      state.winner = player.id;
      state.reason = 'capture';
      state.finished = true;
      return;
    }
  }

  // 2. Elimination: player with no units and no cities is eliminated
  for (const player of state.players) {
    if (player.eliminated) continue;
    const hasUnits = state.units.some((u) => u.alive && u.team === player.id);
    const hasCities = state.cityEntities.some((c) => c.owner === player.id);
    if (!hasUnits && !hasCities) {
      player.eliminated = true;
    }
  }

  const active = state.players.filter((p) => !p.eliminated);
  if (active.length === 1 && totalPlayers > 1) {
    state.winner = active[0].id;
    state.reason = 'elimination';
    state.finished = true;
  } else if (active.length === 0) {
    state.winner = null;
    state.reason = 'mutual';
    state.finished = true;
  }
}

export function safeToDeploy(state: GameState, proposed: Unit): boolean {
  if (!onBoard(proposed.pos, state.width, state.height, state.wrap) || state.terrain.has(hexKey(proposed.pos))
    || state.units.some((unit) => unit.alive && hexKey(unit.pos) === hexKey(proposed.pos))) return false;
  if (state.units.every((unit) => !unit.alive || unit.team === proposed.team
    || wrapDistance(unit.pos, proposed.pos, state.width, state.wrap) > 4)) return true;
  const trial: GameState = { ...state, units: [...state.units, proposed] };
  return openingThreats(trial).length === 0;
}

export function openingThreats(state: GameState): { attacker: Unit; victim: Unit }[] {
  const occupied = occupancy(state);
  const threats: { attacker: Unit; victim: Unit }[] = [];
  for (const attacker of state.units) {
    if (!attacker.alive) continue;
    for (const action of legalActions(state, attacker, occupied)) {
      if (action.kind !== 'attack') continue;
      const victim = occupied.get(hexKey(action.target));
      if (victim && victim.team !== attacker.team) threats.push({ attacker, victim });
    }
  }
  return threats;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    cities: state.cities.map((c) => ({ ...c })),
    cityEntities: state.cityEntities.map((c) => ({ ...c, productionStored: c.productionStored ? { ...c.productionStored } : undefined,
      territory: c.territory.map((t) => ({ ...t })) })),
    mountains: state.mountains.map((m) => ({ ...m })),
    terrain: new Set(state.terrain),
    players: state.players.map((p) => ({ ...p })),
    units: state.units.map((unit) => ({ ...unit, pos: { ...unit.pos } })),
  };
}

export function applySingle(state: GameState, action: Action): void {
  const unit = state.units[action.uid];
  if (!unit?.alive || unit.acted) return;
  if ((action.kind === 'move' || action.kind === 'attack' && action.channel !== 'brown')
    && hostileCenter(state, action.target, unit.team)) return;
  unit.acted = true;
  if (action.kind === 'wait') return;
  if (action.kind === 'special' && action.specialAction === 'found_city') {
    executeFoundCity(state, unit);
    return;
  }
  if (action.kind === 'attack') {
    const victim = state.units.find((other) => other.alive && other.pos.q === action.target.q && other.pos.r === action.target.r);
    if (!victim || victim.team === unit.team) return;
    victim.alive = false;
    unit.kills++;
    unit.shots++;
    if (action.channel !== 'brown') unit.pos = { ...action.target };
  } else {
    const occupied = state.units.some((other) => other.alive && other.uid !== unit.uid && other.pos.q === action.target.q && other.pos.r === action.target.r);
    if (!occupied) {
      unit.pos = { ...action.target };
      unit.moves++;
    }
  }
  checkVictory(state);
}

export type ResolutionPhase = 'attack' | 'move' | 'action';
export type PhaseObserver = (phase: ResolutionPhase, state: GameState, attacks: Action[]) => void;

/**
 * Simultaneous rounds resolve in:
 * 1. ATTACKS — all attacks resolve immediately before any movement.
 *    A targeted unit cannot move away; mutual attacks kill both.
 * 2. SPECIAL ACTIONS — Settlers found cities.
 * 3. MOVEMENT — survivors move. Chains and vacated tiles resolve. Contested tiles cancel.
 * 4. CITY CAPTURES & PRODUCTION.
 */
export function resolveSimultaneous(state: GameState, orders: Action[], observe?: PhaseObserver): void {
  const before = occupancy(state);
  const attacks: { attacker: Unit; victim: Unit; action: Action }[] = [];

  for (const action of orders) {
    if (action.kind !== 'attack') continue;
    const attacker = state.units[action.uid];
    if (!attacker?.alive) continue;
    const victim = before.get(hexKey(action.target));
    if (!victim || victim.team === attacker.team) continue;
    if (action.channel !== 'brown' && hostileCenter(state, victim.pos, attacker.team)) continue;
    const pattern = PATTERN_BY_ID[attacker.type];
    if (action.channel === 'red' && !hasOffset(pattern.red, attacker.pos, victim.pos, state)
      || action.channel === 'blue' && !hasOffset(pattern.blue, attacker.pos, victim.pos, state)
      || action.channel === 'brown' && !hasOffset(pattern.brown, attacker.pos, victim.pos, state)
      || action.channel === 'green' || action.channel === 'wait') continue;
    if (!canAttack(state, attacker, victim, before)) continue;
    attacks.push({ attacker, victim, action });
  }

  const credited = new Set<number>();
  for (const { attacker, victim } of attacks) {
    attacker.shots++;
    if (!credited.has(victim.uid)) {
      attacker.kills++;
      credited.add(victim.uid);
    }
  }

  for (const { victim } of attacks) victim.alive = false;

  const advances = new Set<string>();
  for (const { attacker, victim, action } of attacks) {
    if (action.channel === 'brown' || !attacker.alive || advances.has(hexKey(victim.pos))) continue;
    attacker.pos = { ...victim.pos };
    advances.add(hexKey(victim.pos));
  }

  checkVictory(state);
  if (attacks.length) observe?.('attack', state, attacks.map(({ action }) => action));
  if (state.finished) return;

  // Only cities that existed before this round's founding phase earn production.
  const producingCities = state.cityEntities.slice();

  // SPECIAL ACTIONS (Found a City for Settlers)
  for (const action of orders) {
    if (action.kind === 'special' && action.specialAction === 'found_city') {
      const unit = state.units[action.uid];
      if (unit?.alive) executeFoundCity(state, unit);
    }
  }

  // MOVEMENT PHASE
  const board = occupancy(state);
  const moveOrders = new Map<number, Action>();
  for (const action of orders) {
    const mover = state.units[action.uid];
    if (action.kind !== 'move' || !mover?.alive) continue;
    const pattern = PATTERN_BY_ID[mover.type];
    if (blocked(state, action.target) || hostileCenter(state, action.target, mover.team)) continue;
    if (!hasOffset(pattern.green, mover.pos, action.target, state) && !hasOffset(pattern.red, mover.pos, action.target, state)) continue;
    if (!clearMovePath(state, mover.pos, action.target, board)) continue;
    moveOrders.set(action.uid, action);
  }

  const destCounts = new Map<string, number>();
  for (const action of moveOrders.values()) {
    const key = hexKey(action.target);
    destCounts.set(key, (destCounts.get(key) || 0) + 1);
  }

  const moveStatus = new Map<number, 'pending' | 'success' | 'blocked'>();
  for (const [uid, action] of moveOrders.entries()) {
    const key = hexKey(action.target);
    if ((destCounts.get(key) || 0) > 1) {
      moveStatus.set(uid, 'blocked');
    } else {
      const occupant = board.get(key);
      if (occupant && occupant.team !== state.units[uid].team) {
        moveStatus.set(uid, 'blocked');
      } else {
        moveStatus.set(uid, 'pending');
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [uid, action] of moveOrders.entries()) {
      if (moveStatus.get(uid) !== 'pending') continue;
      const key = hexKey(action.target);
      const occupant = board.get(key);
      if (!occupant) {
        moveStatus.set(uid, 'success');
        changed = true;
      } else {
        const occupantStatus = moveStatus.get(occupant.uid);
        if (occupantStatus === 'success') {
          moveStatus.set(uid, 'success');
          changed = true;
        } else if (occupantStatus === 'blocked' || !moveOrders.has(occupant.uid)) {
          moveStatus.set(uid, 'blocked');
          changed = true;
        }
      }
    }
  }

  for (const [uid, status] of moveStatus.entries()) {
    if (status === 'pending') {
      moveStatus.set(uid, 'success');
    }
  }

  let moved = false;
  for (const [uid, status] of moveStatus.entries()) {
    if (status === 'success') {
      const mover = state.units[uid];
      mover.pos = { ...moveOrders.get(uid)!.target };
      mover.moves++;
      moved = true;
    }
  }

  if (moved) checkVictory(state);
  if (moved) observe?.('move', state, []);

  // Post-move captures & city production
  processCityCaptures(state);
  processCityProduction(state, producingCities);
  checkVictory(state);
}

function valueOf(type: PatternId): number {
  const pattern = PATTERN_BY_ID[type];
  if (type === 'settler') return 2.5;
  return 0.85 + Math.min(pattern.red.length + pattern.blue.length * 0.55 + pattern.brown.length * 0.65, 20) * 0.035
    + Math.min(pattern.green.length, 18) * 0.012;
}

type ThreatCache = { immediate: Map<string, number[]>; predicted: Map<string, number[]> };
const makeThreatCache = (): ThreatCache => ({ immediate: new Map(), predicted: new Map() });

function dangerAt(state: GameState, unit: Unit, pos: Hex, killedUid = -1, occupied = occupancy(state), cache?: ThreatCache): number {
  const key = `${unit.team}:${hexKey(pos)}`;
  let threats = cache?.immediate.get(key);
  if (!threats) {
    threats = [];
    for (const enemy of state.units) {
      if (!enemy.alive || enemy.team === unit.team) continue;
      const pattern = PATTERN_BY_ID[enemy.type];
      const maxR = Math.max(maxOffsetRadius(pattern.red), maxOffsetRadius(pattern.blue), maxOffsetRadius(pattern.brown));
      if (wrapDistance(enemy.pos, pos, state.width, state.wrap) > maxR) continue;
      const melee = (hasOffset(pattern.red, enemy.pos, pos, state) || hasOffset(pattern.blue, enemy.pos, pos, state))
        && clearMovePath(state, enemy.pos, pos, occupied);
      const ranged = hasOffset(pattern.brown, enemy.pos, pos, state)
        && lineOfSight(state, enemy.pos, pos, enemy.team, occupied);
      if (melee || ranged) threats.push(enemy.uid);
    }
    cache?.immediate.set(key, threats);
  }
  return threats.reduce((count, uid) => count + Number(uid !== killedUid), 0);
}

function nearestEnemyDistance(state: GameState, unit: Unit, pos: Hex, killedUid = -1): number {
  let nearest = 40;
  for (const enemy of state.units) {
    if (enemy.alive && enemy.team !== unit.team && enemy.uid !== killedUid) {
      nearest = Math.min(nearest, wrapDistance(pos, enemy.pos, state.width, state.wrap));
    }
  }
  return nearest;
}

function canReachInOneTurn(state: GameState, enemy: Unit, destination: Hex, occupied: Map<string, Unit>): boolean {
  const pattern = PATTERN_BY_ID[enemy.type];
  if (!hasOffset(pattern.green, enemy.pos, destination, state) && !hasOffset(pattern.red, enemy.pos, destination, state)) return false;
  if (blocked(state, destination) || hostileCenter(state, destination, enemy.team)) return false;
  const blocker = occupied.get(hexKey(destination));
  if (blocker && (blocker.team === enemy.team || !hasOffset(pattern.red, enemy.pos, destination, state))) return false;
  return clearMovePath(state, enemy.pos, destination, occupied);
}

function predictedDangerAt(state: GameState, team: Team, pos: Hex, occupied: Map<string, Unit>, excludedUid = -1, cache?: ThreatCache): number {
  const key = `${team}:${hexKey(pos)}`;
  let threats = cache?.predicted.get(key);
  if (!threats) {
    threats = [];
    for (const enemy of state.units) {
      if (!enemy.alive || enemy.team === team) continue;
      const pattern = PATTERN_BY_ID[enemy.type];
      const moveRadius = Math.max(maxOffsetRadius(pattern.green), maxOffsetRadius(pattern.red));
      const attackRadius = Math.max(maxOffsetRadius(pattern.red), maxOffsetRadius(pattern.blue), maxOffsetRadius(pattern.brown));
      if (wrapDistance(enemy.pos, pos, state.width, state.wrap) > moveRadius + attackRadius) continue;
      const canThreaten = (offset: Hex, ranged: boolean) => {
        const origin = wrapHex({ q: pos.q - offset.q, r: pos.r - offset.r }, state.width, state.height, state.wrap);
        if (!origin || !canReachInOneTurn(state, enemy, origin, occupied)) return false;
        return ranged ? lineOfSight(state, origin, pos, enemy.team, occupied)
          : clearMovePath(state, origin, pos, occupied);
      };
      if (pattern.red.some((offset) => canThreaten(offset, false))
        || pattern.blue.some((offset) => canThreaten(offset, false))
        || pattern.brown.some((offset) => canThreaten(offset, true))) threats.push(enemy.uid);
    }
    cache?.predicted.set(key, threats);
  }
  return threats.reduce((count, uid) => count + Number(uid !== excludedUid), 0);
}

function friendlySupport(state: GameState, unit: Unit, pos: Hex): number {
  let support = 0;
  for (const ally of state.units) {
    if (!ally.alive || ally.uid === unit.uid || ally.team !== unit.team) continue;
    const d = wrapDistance(ally.pos, pos, state.width, state.wrap);
    if (d <= 1) support += 0.24;
    else if (d <= 2) support += 0.1;
  }
  return support;
}

function actionScore(state: GameState, action: Action, policy: Policy, occupied = occupancy(state), cache?: ThreatCache): number {
  const unit = state.units[action.uid];
  const profile = effectiveProfile(unit);

  if (action.kind === 'wait') return -4;

  // Settler special action: Found a city
  if (action.kind === 'special' && action.specialAction === 'found_city') {
    return 150; // top priority for settlers
  }

  const target = state.units.find((other) => other.alive && other.team !== unit.team
    && other.pos.q === action.target.q && other.pos.r === action.target.r);
  const finalPos = action.kind === 'move' || action.channel !== 'brown' ? action.target : unit.pos;
  const killedUid = action.kind === 'attack' ? target?.uid ?? -1 : -1;
  const beforeEnemy = nearestEnemyDistance(state, unit, unit.pos);
  const afterEnemy = nearestEnemyDistance(state, unit, finalPos, killedUid);
  const unitValue = valueOf(unit.type);
  let score = 0;

  if (target && action.kind === 'attack') {
    const preferred = profile.preferredTargets.includes(PATTERN_BY_ID[target.type].family);
    const targetThreat = dangerAt(state, unit, unit.pos, -1, occupied, cache) ? 1.4 : 1;
    score += policy.kill * valueOf(target.type) * (3.8 + profile.attackPriority * 0.55) * targetThreat;
    if (preferred) score += policy.kill * profile.intercept * 2.3;
    score += policy.kill * profile.focus * (target.alive ? 0.22 : 0);
  }

  score += policy.advance * Math.max(-3, Math.min(3, beforeEnemy - afterEnemy)) * profile.aggression
    * (beforeEnemy < 12 ? 1.5 : 0.6);

  // Proximity to enemy capitals & cities
  const enemyCapitals = state.cityEntities.filter((c) => c.isCapital && c.owner !== unit.team);
  const enemyCities = state.cityEntities.filter((c) => c.owner !== unit.team);
  const targetCity = (enemyCapitals.length ? enemyCapitals : enemyCities)
    .sort((a, b) => wrapDistance(unit.pos, a.pos, state.width, state.wrap) - wrapDistance(unit.pos, b.pos, state.width, state.wrap))[0];
  if (targetCity && profile.siege) {
    const beforeDist = wrapDistance(unit.pos, targetCity.pos, state.width, state.wrap);
    const afterDist = wrapDistance(finalPos, targetCity.pos, state.width, state.wrap);
    score += policy.city * profile.objective * (beforeDist - afterDist) * 1.5;
    if (afterDist === 1) score += policy.city * profile.objective * 3.0;
  }

  const immediateDanger = dangerAt(state, unit, finalPos, killedUid, occupied, cache);
  const anticipatedDanger = predictedDangerAt(state, unit.team, finalPos, occupied, killedUid, cache);
  const exposure = immediateDanger * 1.1 + anticipatedDanger * 0.9;
  if (exposure > 0) score -= policy.safety * profile.caution * unitValue * (0.3 + Math.min(exposure, 4) * 0.29);
  if (exposure === 0 && dangerAt(state, unit, unit.pos, -1, occupied, cache) > 0) score += policy.safety * profile.caution * 1.05;

  score += friendlySupport(state, unit, finalPos) * profile.spacing;

  const pattern = PATTERN_BY_ID[unit.type];
  const enemyInRange = state.units.some((enemy) => enemy.alive && enemy.team !== unit.team && enemy.uid !== killedUid
    && (hasOffset(pattern.red, finalPos, enemy.pos, state) || hasOffset(pattern.blue, finalPos, enemy.pos, state)
      || hasOffset(pattern.brown, finalPos, enemy.pos, state)));
  if (enemyInRange) score += policy.initiative * profile.aggression * (exposure ? 0.4 : 0.95);

  if (pattern.brown.length) {
    const ideal = profile.idealRange;
    score -= policy.range * profile.caution * Math.max(0, ideal - afterEnemy) * (exposure ? 1.05 : 0.7);
    if (afterEnemy === ideal && exposure === 0) score += policy.range * 0.75;
  }

  if (action.kind === 'move') score += policy.mobility * profile.mobility * 0.12;
  return score;
}

function rankedActions(state: GameState, team: Team, policy: Policy, reserved?: Set<string>): { action: Action; score: number }[] {
  const occupied = occupancy(state);
  const cache = makeThreatCache();
  const result: { action: Action; score: number }[] = [];
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== team || unit.acted) continue;
    for (const action of legalActions(state, unit, occupied)) {
      if (reserved?.has(hexKey(action.target)) && action.kind === 'move') continue;
      result.push({ action, score: actionScore(state, action, policy, occupied, cache) });
    }
  }
  result.sort((a, b) => b.score - a.score || a.action.uid - b.action.uid);
  return result;
}

function greedyAction(state: GameState, team: Team, policy: Policy): Action | null {
  const ranked = rankedActions(state, team, policy);
  if (ranked.length) return ranked[0].action;
  const unit = state.units.find((candidate) => candidate.alive && candidate.team === team && !candidate.acted);
  return unit ? { uid: unit.uid, kind: 'wait', channel: 'wait', target: unit.pos } : null;
}

function evaluateState(state: GameState, team: Team, policy: Policy): number {
  if (state.finished) return state.winner === null ? 0 : state.winner === team ? 1000 + 20 * (MAX_ROUNDS - state.round) : -1000 - 20 * (MAX_ROUNDS - state.round);
  const occupied = occupancy(state);
  const cache = makeThreatCache();
  let score = 0;

  for (const unit of state.units) {
    if (!unit.alive) continue;
    const side = unit.team === team ? 1 : -1;
    const value = valueOf(unit.type);
    const profile = effectiveProfile(unit);
    score += side * policy.kill * value * 3.5;

    const now = dangerAt(state, unit, unit.pos, -1, occupied, cache);
    const soon = predictedDangerAt(state, unit.team, unit.pos, occupied, -1, cache);
    if (now || soon) score -= side * policy.safety * profile.caution * value * (0.3 + Math.min(now + soon, 4) * 0.18);
  }

  // 4X Domination: Capital ownership
  for (const city of state.cityEntities) {
    const side = city.owner === team ? 1 : -1;
    if (city.isCapital) score += side * 300; // Capitals are prime objectives!
    else score += side * 50;
  }

  return score;
}

function quickOrders(state: GameState, team: Team, policy: Policy, forced?: Action): Action[] {
  const orders: Action[] = [];
  const used = new Set<number>();
  const occupied = occupancy(state);
  const cache = makeThreatCache();
  const localReserved = new Set([...occupied.keys()]);
  if (forced) {
    orders.push(forced);
    used.add(forced.uid);
    if (forced.kind === 'move') localReserved.add(hexKey(forced.target));
  }
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== team || used.has(unit.uid)) continue;
    const choices = legalActions(state, unit, occupied)
      .filter((action) => action.kind !== 'move' || !localReserved.has(hexKey(action.target)))
      .map((action) => ({ action, score: actionScore(state, action, policy, occupied, cache) }))
      .sort((a, b) => b.score - a.score);
    const action = choices[0]?.action || { uid: unit.uid, kind: 'wait' as const, channel: 'wait' as const, target: unit.pos };
    orders.push(action);
    if (action.kind === 'move') localReserved.add(hexKey(action.target));
  }
  return orders;
}

const SEARCH_PLYS = 3;
const rolloutMemo = new Map<string, number>();

function policyTag(policies: Policy[]): string {
  return JSON.stringify(policies) + JSON.stringify(profileOverlays) + `|${patternFingerprint()}`;
}

const terrainKeys = new WeakMap<Set<string>, string>();

function positionKey(state: GameState): string {
  let terrain = terrainKeys.get(state.terrain);
  if (!terrain) {
    terrain = [...state.terrain].sort().join(';');
    terrainKeys.set(state.terrain, terrain);
  }
  return state.units
    .filter((unit) => unit.alive)
    .map((unit) => `${unit.uid}:${unit.team}:${unit.type}@${unit.pos.q},${unit.pos.r}`)
    .join(';') + `|${state.width},${state.height},${state.wrap}|${state.round}|${state.cityEntities.map((c) =>
      `${c.id}:${c.owner}:${c.pos.q},${c.pos.r}:${c.producing}:${c.productionProgress}:${c.productionOverflow || 0}:${JSON.stringify(c.productionStored || {})}`).join(';')}|${terrain}`;
}

function rolloutValue(state: GameState, team: Team, policies: Policy[], plies: number, tag: string): number {
  if (state.finished || plies <= 0) return evaluateState(state, team, policies[team % policies.length]);
  const key = `${tag}|${team}|${plies}|${positionKey(state)}`;
  const cached = rolloutMemo.get(key);
  if (cached !== undefined) return cached;

  const next = cloneState(state);
  resolveSimultaneous(next, next.players.filter((p) => !p.eliminated)
    .flatMap((p) => quickOrders(next, p.id, policies[p.id % policies.length])));
  next.round++;
  for (const unit of next.units) unit.acted = false;
  const value = rolloutValue(next, team, policies, plies - 1, tag);

  if (rolloutMemo.size > 16000) rolloutMemo.clear();
  rolloutMemo.set(key, value);
  return value;
}

export function clearSearchMemo(): void {
  rolloutMemo.clear();
}

let diversityRng = new Random(0x5f356495);

export function setDiversitySeed(seed: number): void {
  diversityRng = new Random((seed ^ 0x5f356495) >>> 0);
}

function strategicAction(state: GameState, team: Team, policies: Policy[], diverse: boolean): Action | null {
  const ranked = rankedActions(state, team, policies[team % policies.length]);
  if (!ranked.length) return greedyAction(state, team, policies[team % policies.length]);
  if (ranked.length === 1) return ranked[0].action;

  const tag = policyTag(policies);
  const scored = ranked.slice(0, 3).map(({ action, score }) => {
    const next = cloneState(state);
    const orders = next.players.filter((p) => !p.eliminated)
      .flatMap((p) => quickOrders(next, p.id, policies[p.id % policies.length], p.id === team ? action : undefined));
    resolveSimultaneous(next, orders);
    next.round++;
    for (const unit of next.units) unit.acted = false;
    return { action, value: rolloutValue(next, team, policies, SEARCH_PLYS, tag) + score * 0.07 };
  });

  let best = scored[0];
  for (const candidate of scored) if (candidate.value > best.value) best = candidate;
  if (diverse) {
    const near = scored.filter((candidate) => best.value - candidate.value <= 0.15);
    if (near.length > 1) best = near[Math.floor(diversityRng.next() * near.length)];
  }
  return best.action;
}

export function chooseAIAction(state: GameState, team: Team, policy: Policy, opponent: Policy = policy): Action | null {
  return strategicAction(state, team, state.players.map((p) => p.id === team ? policy : opponent), false);
}

export function chooseSimultaneousOrders(state: GameState, team: Team, policy: Policy, opponent: Policy = policy): Action[] {
  const forced = strategicAction(state, team, state.players.map((p) => p.id === team ? policy : opponent), false);
  return quickOrders(state, team, policy, forced || undefined);
}

export function finishSequentialRound(state: GameState): void {
  state.round++;
  for (const unit of state.units) unit.acted = false;
}

export function pickRoster(stage: number, rng: Random, count: number): PatternId[] {
  const latest = new Map<UnitFamily, PatternId>();
  for (const family of FAMILIES) {
    if (family === 'Settler') continue;
    const available = PATTERNS.filter((pattern) => pattern.family === family && pattern.unlock <= stage)
      .sort((a, b) => a.unlock - b.unlock);
    if (available.length) latest.set(family, available[available.length - 1].id);
  }
  const weights: Partial<Record<UnitFamily, number>> = {
    Melee: 1.55, 'Light cavalry': 1.1, 'Heavy cavalry': 1.05,
    Ranged: 1, Hunter: 0.8, Sniper: 0.75, Harrier: 0.85,
  };
  const pool = [...latest.entries()].flatMap(([family, id]) => Array.from({ length: Math.round((weights[family] || 1) * 10) }, () => id));
  if (!pool.length) return Array.from({ length: count }, () => 'melee1');
  const roster: PatternId[] = [latest.get('Melee') ?? pool[0]];
  while (roster.length < count) roster.push(rng.pick(pool));
  return roster;
}

export function createScenario(seed: number, options: ScenarioOptions = {}): GameState {
  const rng = new Random(seed);
  const mapSizeKey: MapSizeKey = options.mapSize || 'duel';
  const mapCfg = MAP_CONFIGS[mapSizeKey] || MAP_CONFIGS.duel;
  const width = mapCfg.width;
  const height = mapCfg.height;
  const wrap = mapCfg.wrap;
  const playerCount = Math.max(2, Math.min(10, options.playerCount || (options.duel ? 2 : mapCfg.recommendedPlayers)));

  const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
    id: i,
    name: CIV_NAMES[i % CIV_NAMES.length] || `Civ ${i + 1}`,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    isAi: i > 0,
    eliminated: false,
  }));

  const allHexes = boardHexes(width, height);
  const mountainCount = Math.floor(allHexes.length * 0.1);
  const mountainCandidates = rng.shuffle(allHexes);
  const mountains = mountainCandidates.slice(0, mountainCount);
  const terrain = new Set(mountains.map(hexKey));

  const units: Unit[] = [];
  const cities: Hex[] = [];
  const cityEntities: City[] = [];

  const deployment: GameState = {
    units,
    cities,
    cityEntities,
    mountains,
    terrain,
    round: 0,
    stage: options.stage || 13,
    mode: 'simultaneous',
    width,
    height,
    wrap,
    mapSizeKey,
    playerCount,
    players,
    winner: null,
    reason: null,
    finished: false,
  };

  if (options.duel) {
    // 1v1 controlled duel on Duel map for unit comparison
    const open = allHexes.filter((hex) => !terrain.has(hexKey(hex)));
    for (const first of rng.shuffle(open)) {
      const unitA: Unit = { uid: 0, type: options.duel[0], team: 0, pos: first,
        alive: true, acted: false, kills: 0, shots: 0, moves: 0 };
      units.push(unitA);
      const second = rng.shuffle(open).find((hex) => {
        const span = distance(first, hex);
        if (span < 4 || span > 8) return false;
        return safeToDeploy(deployment, { ...unitA, uid: 1, type: options.duel![1], team: 1, pos: hex });
      });
      if (second) {
        units.push({ ...unitA, uid: 1, type: options.duel[1], team: 1, pos: second });
        break;
      }
      units.pop();
    }
  } else {
    // 4X mode: Each player spawns with 1 Settler unit and NO cities!
    const openHexes = allHexes.filter((h) => !terrain.has(hexKey(h)));
    const settlerPositions: Hex[] = [];

    for (let p = 0; p < playerCount; p++) {
      let bestHex = openHexes[0] || { q: 2, r: 2 };
      let bestMinDist = -1;
      const candidates = rng.shuffle(openHexes.filter((hex) => !settlerPositions.some((taken) => hexKey(taken) === hexKey(hex)))).slice(0, 400);
      for (const cand of candidates) {
        if (settlerPositions.length === 0) {
          bestHex = cand;
          break;
        }
        let minD = Infinity;
        for (const existing of settlerPositions) {
          const d = wrapDistance(cand, existing, width, wrap);
          if (d < minD) minD = d;
        }
        if (minD > bestMinDist) {
          bestMinDist = minD;
          bestHex = cand;
        }
      }
      settlerPositions.push(bestHex);
    }

    settlerPositions.forEach((pos, p) => {
      units.push({
        uid: p,
        type: 'settler',
        team: p,
        pos: { ...pos },
        alive: true,
        acted: false,
        kills: 0,
        shots: 0,
        moves: 0,
      });
    });
  }

  return deployment;
}

export function snapshot(state: GameState): BoardSnapshot {
  return {
    units: state.units.filter((unit) => unit.alive).map(({ uid, type, team, pos }) => ({ uid, type, team, pos })),
    cities: state.cityEntities.map((c) => ({ ...c.pos })),
    cityEntities: state.cityEntities.map((c) => ({ ...c, productionStored: c.productionStored ? { ...c.productionStored } : undefined,
      territory: c.territory.map((hex) => ({ ...hex })) })),
    mountains: state.mountains,
    round: state.round,
    stage: state.stage,
    mode: 'simultaneous',
    width: state.width,
    height: state.height,
    wrap: state.wrap,
  };
}

export function simulateGame(seed: number, options: ScenarioOptions = {}, policies: [Policy, Policy] = [DEFAULT_POLICY, DEFAULT_POLICY]): GameResult {
  const state = createScenario(seed, options);
  setDiversitySeed(seed ^ (state.stage << 16));
  const maximum = options.maxRounds ?? MAX_ROUNDS;
  let preview = snapshot(state);
  let lastPosition = '';
  let stalled = 0;

  while (!state.finished && state.round < maximum) {
    const orders: Action[] = [];
    for (let p = 0; p < state.playerCount; p++) {
      const pol = policies[p % policies.length];
      if (state.players[p]?.eliminated) continue;
      const forced = options.lookahead !== false ? strategicAction(state, p, policies, true) : null;
      orders.push(...quickOrders(state, p, pol, forced || undefined));
    }
    resolveSimultaneous(state, orders);
    state.round++;

    if (state.round === 3 || state.round === 6) preview = snapshot(state);

    // Include city production and ownership: a quiet board still changes while
    // cities are building, so settling must not be mistaken for a dead loop.
    const position = [
      state.units.filter((u) => u.alive).map((u) => `${u.uid}:${u.pos.q},${u.pos.r}`).join(';'),
      state.cityEntities.map((c) => `${c.id}:${c.owner}:${c.productionProgress}:${c.producing}`).join(';'),
    ].join('|');
    if (position === lastPosition) { stalled++; if (stalled >= 3) break; } else stalled = 0;
    lastPosition = position;
  }

  if (!state.finished) {
    let bestSide: number = 0;
    let bestScore = -Infinity;
    let tied = false;
    for (let p = 0; p < state.playerCount; p++) {
      const alive = state.units.filter((u) => u.alive && u.team === p);
      const material = alive.reduce((sum, u) => sum + valueOf(u.type), 0);
      const capitals = state.cityEntities.filter((c) => c.isCapital && c.owner === p).length;
      const citiesCount = state.cityEntities.filter((c) => c.owner === p).length;
      const score = capitals * 50 + citiesCount * 20 + material * 10 + alive.length;
      if (Math.abs(score - bestScore) < 0.0001) tied = true;
      if (score > bestScore) { bestScore = score; bestSide = p; tied = false; }
    }
    state.finished = true;
    state.reason = 'attrition';
    state.winner = tied ? null : bestSide;
  }

  return {
    winner: state.winner,
    reason: state.reason!,
    rounds: state.round,
    stage: state.stage,
    units: state.units.map(({ type, team, kills, alive, shots, moves }) => ({ type, team, kills, survived: alive, shots, moves })),
    snapshot: preview,
  };
}
