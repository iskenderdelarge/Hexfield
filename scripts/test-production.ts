import assert from 'node:assert/strict';
import {
  createScenario, executeFoundCity, legalActions, processCityCaptures, processCityProduction,
  productionFor, resolveSimultaneous, setCityProduction, type Unit, MAX_ROUNDS, TRAINING_ROUNDS,
} from '../src/sim/engine';
import { UNIT_PRODUCTION_COST } from '../src/sim/config';
import { offsetToHex } from '../src/sim/patterns';
import { cloneGame, fromWire, isRoomSnapshot, toWire } from '../src/online/match';
import { captureRuleset } from '../src/sim/config';
import { visualTarget, mapCenter, COL_STEP } from '../src/components/WorldBoard';

const world = createScenario(9914, { playerCount: 2, mapSize: 'duel' });
world.terrain.clear(); world.mountains = [];
world.players.forEach((p) => { p.isAi = false; });
world.units[0].pos = offsetToHex(4, 6); world.units[1].pos = offsetToHex(17, 8);
const city = executeFoundCity(world, world.units[0])!;
assert.equal(UNIT_PRODUCTION_COST, 5);
assert.equal(MAX_ROUNDS, 100); assert.equal(TRAINING_ROUNDS, 50);
setCityProduction(city, 'harrier');
processCityProduction(world); processCityProduction(world);
assert.equal(city.productionProgress, 4);
setCityProduction(city, 'sniper');
assert.equal(city.productionProgress, 0, 'new production starts empty');
processCityProduction(world);
assert.equal(city.productionProgress, 2);
setCityProduction(city, 'harrier');
assert.equal(city.productionProgress, 4, 'paused item retains its own production');
const first = processCityProduction(world);
assert.equal(first.length, 1); assert.equal(first[0].unit.type, 'harrier');
assert.equal(city.productionProgress, 0); assert.equal(city.productionOverflow, 1, '6 minus 5 leaves one overflow');
assert.equal(productionFor(city, 'sniper'), 2);
setCityProduction(city, 'sniper');
assert.equal(city.productionProgress, 2);
assert.equal(city.productionOverflow, 1, 'switching does not spend overflow');
const second = processCityProduction(world);
assert.equal(second.length, 1); assert.equal(second[0].unit.type, 'sniper');
assert.equal(city.productionOverflow, 0, '2 saved + 1 overflow + 2 income completes exactly');

const cloned = cloneGame(world), wire = fromWire(toWire(world));
setCityProduction(cloned.cityEntities[0], 'light2');
cloned.cityEntities[0].productionStored!.harrier = 4;
assert.equal(city.productionStored!.harrier, 0, 'search clones cannot mutate real progress');
assert.deepEqual(wire.cityEntities, world.cityEntities, 'network snapshots retain paused production and overflow');

const mkUnit = (uid: number, team: number, q: number, r: number): Unit => ({
  uid, team, type: 'melee2', pos: { q, r }, alive: true, acted: false, kills: 0, shots: 0, moves: 0,
});
const siegeWorld = createScenario(24, { playerCount: 2 });
siegeWorld.terrain.clear(); siegeWorld.mountains = []; siegeWorld.players.forEach((p) => { p.isAi = false; });
siegeWorld.units[0].pos = { q: 3, r: 5 }; siegeWorld.units[1].pos = { q: 12, r: 7 };
const capital = executeFoundCity(siegeWorld, siegeWorld.units[1])!;
const attacker = mkUnit(siegeWorld.units.length, 0, capital.pos.q - 1, capital.pos.r);
siegeWorld.units.push(attacker);
assert.ok(!legalActions(siegeWorld, attacker).some((a) => a.target.q === capital.pos.q && a.target.r === capital.pos.r),
  'enemy city center is never a movement or capture target');
resolveSimultaneous(siegeWorld, [{ uid: attacker.uid, kind: 'move', channel: 'red', target: capital.pos }]);
assert.notDeepEqual(attacker.pos, capital.pos, 'forged move cannot enter enemy center');
attacker.pos = { ...capital.pos };
assert.equal(processCityCaptures(siegeWorld).length, 0, 'center occupation alone never captures a city');
assert.equal(capital.owner, 1);

for (const count of [2, 3, 6, 10]) {
  const game = createScenario(count * 3001, { playerCount: count, mapSize: 'war' });
  const snapshot = { game: toWire(game), ready: Array(count).fill(false), revision: 0, matchId: 'new-room', seed: 1, rules: captureRuleset() };
  assert.ok(isRoomSnapshot(snapshot), `${count}-civilization snapshot is valid`);
  assert.ok(!isRoomSnapshot({ ...snapshot, ready: [false, false, true, ...snapshot.ready] }), 'wrong ready count rejected');
  const positions = new Set(game.units.map((u) => `${u.pos.q},${u.pos.r}`));
  assert.equal(positions.size, count, 'all settlers have distinct starts');
}

const edge = offsetToHex(31, 7), opposite = offsetToHex(0, 7);
const from = mapCenter(edge), wrapped = visualTarget(edge, opposite, 32, true);
assert.ok(Math.abs(wrapped.x - from.x - COL_STEP) < 0.001, 'wrapped animation crosses one tile, not the entire map');
assert.ok(Math.abs(visualTarget(edge, opposite, 32, false).x - from.x) > COL_STEP * 20, 'non-wrapped map is not repeated');
console.log('Production, overflow, siege-only centers, 10-player snapshots and visual wrapping passed.');