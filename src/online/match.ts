import {
  applySingle, finishSequentialRound, legalActions, resolveSimultaneous,
  type Action, type GameState, type ResolutionPhase, type Team,
} from '../sim/engine';
import type { RulesetSnapshot } from '../sim/config';
import { MAP_CONFIGS, PATTERN_IDS, distance, type Hex, type PatternId } from '../sim/patterns';

export type WireGame = Omit<GameState, 'terrain'> & { terrain: string[] };
export type AttackEffect = { from: Hex; to: Hex; channel: Action['channel'] };
export type PlayFrame = { phase: ResolutionPhase; game: GameState; attacks: AttackEffect[] };
export type WireFrame = Omit<PlayFrame, 'game'> & { game: WireGame };
export type RoomMember = { seat: number; connected: boolean; reserved: boolean };
export type RoomSnapshot = {
  game: WireGame;
  ready: boolean[];
  revision: number;
  matchId: string;
  seed: number;
  rules: RulesetSnapshot;
  frames?: WireFrame[];
  log?: { id: number; round: number; who: string; action: string; target: string }[];
};
export type RoomMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'orders'; matchId: string; round: number; orders: Action[] }
  | { type: 'production'; matchId: string; round: number; cityId: number; producing: PatternId }
  | { type: 'rejected'; message: string };

function isHex(value: unknown): value is Hex {
  if (!value || typeof value !== 'object') return false;
  const hex = value as Partial<Hex>;
  return Number.isInteger(hex.q) && Number.isInteger(hex.r) && Math.abs(hex.q!) <= 128 && Math.abs(hex.r!) <= 128;
}

function isWireGame(value: unknown): value is WireGame {
  if (!value || typeof value !== 'object') return false;
  const game = value as Partial<WireGame>;
  if (!game.mapSizeKey || !MAP_CONFIGS[game.mapSizeKey] || !Number.isInteger(game.playerCount)
    || game.playerCount! < 2 || game.playerCount! > 10 || !Number.isInteger(game.round) || game.round! < 0) return false;
  const map = MAP_CONFIGS[game.mapSizeKey];
  if (game.width !== map.width || game.height !== map.height || game.wrap !== map.wrap
    || !Array.isArray(game.players) || game.players.length !== game.playerCount
    || !game.players.every((p, index) => p && p.id === index && typeof p.name === 'string' && typeof p.isAi === 'boolean')
    || !Array.isArray(game.units) || game.units.length > 20000
    || !game.units.every((u, index) => u && u.uid === index && PATTERN_IDS.includes(u.type)
      && Number.isInteger(u.team) && u.team >= 0 && u.team < game.playerCount! && isHex(u.pos)
      && typeof u.alive === 'boolean' && typeof u.acted === 'boolean')) return false;
  const validOwner = (id: number) => Number.isInteger(id) && id >= 0 && id < game.playerCount!;
  return Array.isArray(game.cities) && game.cities.every(isHex)
    && Array.isArray(game.cityEntities) && game.cityEntities.length <= map.width * map.height
    && game.cityEntities.every((c) => c && Number.isInteger(c.id) && isHex(c.pos) && validOwner(c.owner)
      && validOwner(c.originalOwner) && PATTERN_IDS.includes(c.producing) && Number.isFinite(c.productionProgress)
      && c.productionProgress >= 0 && Array.isArray(c.territory) && c.territory.every(isHex)
      && (c.productionOverflow === undefined || Number.isFinite(c.productionOverflow) && c.productionOverflow >= 0)
      && (!c.productionStored || Object.entries(c.productionStored).every(([id, n]) => PATTERN_IDS.includes(id as PatternId)
        && typeof n === 'number' && Number.isFinite(n) && n >= 0)))
    && Array.isArray(game.mountains) && game.mountains.every(isHex)
    && Array.isArray(game.terrain) && game.terrain.every((tile) => typeof tile === 'string')
    && typeof game.finished === 'boolean';
}

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<RoomSnapshot>;
  if (!isWireGame(snapshot.game) || typeof snapshot.matchId !== 'string' || !Number.isInteger(snapshot.revision)
    || !Number.isInteger(snapshot.seed) || !Array.isArray(snapshot.ready) || snapshot.ready.length !== snapshot.game.playerCount
    || !snapshot.ready.every((ready) => typeof ready === 'boolean')) return false;
  const rules = snapshot.rules;
  if (!rules || !Array.isArray(rules.patterns) || rules.patterns.length !== PATTERN_IDS.length || !rules.profiles || !rules.eras) return false;
  const seen = new Set<string>();
  for (const p of rules.patterns) {
    if (!p || !PATTERN_IDS.includes(p.id) || seen.has(p.id) || !Number.isInteger(p.unlock) || p.unlock < 0 || p.unlock > 40) return false;
    seen.add(p.id);
    for (const channel of ['green', 'red', 'brown', 'blue'] as const) {
      if (!Array.isArray(p[channel]) || p[channel].length > 60
        || !p[channel].every((hex) => isHex(hex) && distance({ q: 0, r: 0 }, hex) <= 4)) return false;
    }
    const profile = rules.profiles[p.id];
    if (!profile || typeof profile.siege !== 'boolean' || !Array.isArray(profile.preferredTargets)) return false;
    for (const key of ['aggression', 'caution', 'objective', 'spacing', 'focus', 'intercept', 'mobility', 'idealRange', 'defense', 'attackPriority'] as const) {
      if (!Number.isFinite(profile[key]) || profile[key] < 0 || profile[key] > 4) return false;
    }
  }
  for (const key of ['opening', 'middle', 'late'] as const) {
    const era = rules.eras[key];
    if (!era || !Number.isInteger(era.start) || !Number.isInteger(era.end) || era.start < 1 || era.end > 40 || era.start > era.end) return false;
  }
  return !snapshot.frames || Array.isArray(snapshot.frames) && snapshot.frames.length <= 6 && snapshot.frames.every((frame) =>
    isWireGame(frame.game) && Array.isArray(frame.attacks) && frame.attacks.length <= snapshot.game!.units.length
    && frame.attacks.every((effect) => isHex(effect.from) && isHex(effect.to) && ['red', 'blue', 'brown'].includes(effect.channel)));
}

export function cloneGame(state: GameState): GameState {
  return { ...state, cities: state.cities.map((hex) => ({ ...hex })),
    cityEntities: state.cityEntities.map((c) => ({ ...c, productionStored: c.productionStored ? { ...c.productionStored } : undefined,
      pos: { ...c.pos }, territory: c.territory.map((t) => ({ ...t })) })),
    mountains: state.mountains.map((hex) => ({ ...hex })), terrain: new Set(state.terrain),
    players: state.players.map((p) => ({ ...p })), units: state.units.map((unit) => ({ ...unit, pos: { ...unit.pos } })) };
}
export function toWire(state: GameState): WireGame { const copy = cloneGame(state); return { ...copy, terrain: [...copy.terrain] }; }
export function fromWire(state: WireGame): GameState { return cloneGame({ ...state, terrain: new Set(state.terrain) }); }

export function validAction(state: GameState, side: Team, action: Action): boolean {
  if (!action || !Number.isInteger(action.uid) || !isHex(action.target)) return false;
  const unit = state.units[action.uid];
  if (!unit?.alive || unit.team !== side || unit.acted) return false;
  if (action.kind === 'wait') return action.channel === 'wait';
  return legalActions(state, unit).some((candidate) => candidate.kind === action.kind && candidate.channel === action.channel
    && candidate.specialAction === action.specialAction && candidate.target.q === action.target.q && candidate.target.r === action.target.r);
}
export function validateOrders(state: GameState, side: Team, orders: Action[]): Action[] | null {
  if (!Array.isArray(orders) || orders.length > state.units.length) return null;
  const ids = new Set<number>();
  for (const order of orders) {
    if (!validAction(state, side, order) || ids.has(order.uid)) return null;
    ids.add(order.uid);
  }
  return state.units.filter((u) => u.alive && u.team === side).map((unit) => orders.find((o) => o.uid === unit.uid)
    ?? { uid: unit.uid, kind: 'wait', channel: 'wait', target: unit.pos });
}

// Retained only for engine regression fixtures; gameplay is simultaneous.
export function singleTransition(state: GameState, side: Team, action: Action) {
  if (!validAction(state, side, action)) return null;
  const game = cloneGame(state);
  const attacker = game.units[action.uid];
  const attacks = action.kind === 'attack' ? [{ from: { ...attacker.pos }, to: { ...action.target }, channel: action.channel }] : [];
  applySingle(game, action);
  let activeSide = side;
  if (!game.finished) {
    const other = (side + 1) % game.playerCount;
    if (game.units.some((u) => u.alive && u.team === other && !u.acted)) activeSide = other;
    else if (!game.units.some((u) => u.alive && u.team === side && !u.acted)) { finishSequentialRound(game); activeSide = 0; }
  }
  return { game, activeSide, frames: [{ phase: 'action' as const, game: cloneGame(game), attacks }] };
}

export function simultaneousTransition(state: GameState, a: Action[], b: Action[] = []) {
  const game = cloneGame(state), frames: PlayFrame[] = [];
  const starts = new Map(state.units.map((u) => [u.uid, { ...u.pos }]));
  resolveSimultaneous(game, [...a, ...b], (phase, current, attacks) => {
    frames.push({ phase, game: cloneGame(current), attacks: attacks.map((action) => ({
      from: starts.get(action.uid) ?? action.target, to: { ...action.target }, channel: action.channel,
    })) });
  });
  game.round++;
  for (const unit of game.units) unit.acted = false;
  if (!frames.length) frames.push({ phase: 'move', game: cloneGame(game), attacks: [] });
  return { game, frames };
}
export function toWireFrames(frames: PlayFrame[]): WireFrame[] { return frames.map((frame) => ({ ...frame, game: toWire(frame.game) })); }
export function fromWireFrames(frames: WireFrame[]): PlayFrame[] { return frames.map((frame) => ({ ...frame, game: fromWire(frame.game) })); }
