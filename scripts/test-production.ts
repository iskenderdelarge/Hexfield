import assert from 'node:assert/strict';
import {
  createScenario, executeFoundCity, legalActions, processCityCaptures, processCityProduction,
  productionFor, resolveSimultaneous, setCityProduction, type Unit, MAX_ROUNDS, TRAINING_ROUNDS,
} from '../src/sim/engine';
import { UNIT_PRODUCTION_COST } from '../src/sim/config';
import { offsetToHex } from '../src/sim/patterns';
import { cloneGame, fromWire, isRoomSnapshot, simultaneousTransition, toWire } from '../src/online/match';
import { captureRuleset } from '../src/sim/config';
import { adaptLearningToPatterns, initialLearning, isHistoricalStudy, STUDY_RULES_VERSION } from '../src/sim/batch';
import { visualTarget, mapCenter, COL_STEP } from '../src/components/WorldBoard';

const learned = initialLearning();
learned.profileDeltas = { sniper: { caution: 0.2 } };
assert.equal(isHistoricalStudy({ learning: learned, studyRulesVersion: STUDY_RULES_VERSION }), false);
assert.equal(isHistoricalStudy({ learning: learned }), true, 'pre-change studies are historical');
assert.equal(isHistoricalStudy({ learning: learned, studyRulesVersion: STUDY_RULES_VERSION - 1 }), true);
assert.equal(isHistoricalStudy({ learning: { ...learned, patternFingerprint: 'old-geometry' }, studyRulesVersion: STUDY_RULES_VERSION }), true);
assert.deepEqual(adaptLearningToPatterns(learned).profileDeltas, learned.profileDeltas, 'versioning studies does not discard learned weights');

// Founding resolves before production, but a new city must start empty. Older
// cities still produce during that same round, and the first choice is free.
const foundingWorld = createScenario(4001, { playerCount: 2, mapSize: 'duel' });
foundingWorld.terrain.clear(); foundingWorld.mountains = [];
foundingWorld.players.forEach((player) => { player.isAi = false; });
foundingWorld.units[0].pos = offsetToHex(4, 6); foundingWorld.units[1].pos = offsetToHex(17, 8);
const olderCity = executeFoundCity(foundingWorld, foundingWorld.units[0])!;
const foundingOrder = { uid: 1, kind: 'special', channel: 'special', specialAction: 'found_city', target: foundingWorld.units[1].pos } as const;
const founded = simultaneousTransition(foundingWorld, [foundingOrder]).game;
const established = founded.cityEntities.find((candidate) => candidate.id === olderCity.id)!;
const newCity = founded.cityEntities.find((candidate) => candidate.owner === 1)!;
assert.equal(established.productionProgress, 2, 'existing cities still produce when another city is founded');
assert.equal(newCity.productionProgress, 0, 'a newly founded city starts with no progress');
assert.equal(productionFor(newCity, 'melee1'), 0, 'the default project does not get a free turn');
assert.equal(newCity.productionOverflow, 0);
const foundedWire = toWire(founded);
assert.ok(isRoomSnapshot({ game: foundedWire, ready: [false, false], revision: 1, matchId: 'founded-city', seed: 4001, rules: captureRuleset() }),
  'a newly founded city is valid in an online snapshot');
const receivedNewCity = fromWire(foundedWire).cityEntities.find((candidate) => candidate.id === newCity.id)!;
assert.equal(productionFor(receivedNewCity, 'melee1'), 0, 'online snapshots preserve the empty new city');
setCityProduction(newCity, 'sniper');
assert.equal(productionFor(newCity, 'melee1'), 0, 'switching immediately does not leave phantom saved production');
const nextRound = simultaneousTransition(founded, []).game;
assert.equal(productionFor(nextRound.cityEntities.find((candidate) => candidate.id === newCity.id)!, 'sniper'), 2,
  'the chosen project earns production on the following turn');
assert.equal(nextRound.cityEntities.find((candidate) => candidate.id === olderCity.id)!.productionProgress, 4);

const twoFounders = createScenario(4002, { playerCount: 2, mapSize: 'duel' });
twoFounders.terrain.clear(); twoFounders.mountains = [];
twoFounders.players.forEach((player) => { player.isAi = false; });
twoFounders.players[1].isAi = true;
twoFounders.units[0].pos = offsetToHex(4, 6); twoFounders.units[1].pos = offsetToHex(17, 8);
const bothFounded = simultaneousTransition(twoFounders, twoFounders.units.map((unit) => ({
  uid: unit.uid, kind: 'special' as const, channel: 'special' as const,
  specialAction: 'found_city' as const, target: unit.pos,
}))).game;
assert.equal(bothFounded.cityEntities.length, 2);
assert.ok(bothFounded.cityEntities.every((candidate) => candidate.productionProgress === 0),
  'all cities founded together start empty, including AI cities');
const aiCityNextTurn = simultaneousTransition(bothFounded, []).game.cityEntities.find((candidate) => candidate.owner === 1)!;
assert.equal(productionFor(aiCityNextTurn), 2, 'AI cities also begin producing on the following turn');
assert.equal(productionFor(aiCityNextTurn, 'melee1'), 0, 'AI project choice does not save phantom Melee I progress');

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
const blockedWorld = createScenario(4020, { playerCount: 2, mapSize: 'duel' });
blockedWorld.terrain.clear(); blockedWorld.mountains = [];
blockedWorld.players.forEach((player) => { player.isAi = false; });
blockedWorld.units[0].pos = offsetToHex(4, 6); blockedWorld.units[1].pos = offsetToHex(17, 8);
const blockedCity = executeFoundCity(blockedWorld, blockedWorld.units[0])!;
blockedCity.productionProgress = 4; blockedCity.productionStored = { melee1: 4 };
const garrisons = blockedCity.territory.map((tile, index) => mkUnit(blockedWorld.units.length + index, 0, tile.q, tile.r));
blockedWorld.units.push(...garrisons);
assert.equal(processCityProduction(blockedWorld).length, 0, 'blocked cities cannot spawn');
assert.equal(blockedCity.productionProgress, 6, 'blocked production is retained');
garrisons[0].alive = false;
const unblocked = processCityProduction(blockedWorld);
assert.equal(unblocked.length, 1);
assert.deepEqual(unblocked[0].unit.pos, blockedCity.pos, 'production spawns once a tile becomes available');
assert.equal(blockedCity.productionOverflow, 3, 'blocked progress and subsequent income still carry over');

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
console.log('Production timing, blocked spawns, overflow, study versions, siege, snapshots and visual wrapping passed.');