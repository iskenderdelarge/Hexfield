import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, Building2, Copy, Crosshair, Crown, Play, Shuffle, Trash2, Users, Wifi, X } from 'lucide-react';
import {
  canFoundCity, chooseSimultaneousOrders, createScenario, legalActions, setCityProduction, setProfileOverlays,
  type Action, type GameState, type Unit,
} from '../sim/engine';
import { adaptLearningToPatterns, type LearningState } from '../sim/batch';
import { applyRuleset, captureRuleset } from '../sim/config';
import { MAP_CONFIGS, PATTERN_BY_ID, PATTERN_IDS, hexKey, hexToOffset, type Hex, type MapSizeKey, type PatternId } from '../sim/patterns';
import {
  cloneGame, fromWire, fromWireFrames, isRoomSnapshot, simultaneousTransition, toWire, toWireFrames, validateOrders,
  type PlayFrame, type RoomMessage, type RoomSnapshot,
} from '../online/match';
import { usePeerRoom } from '../online/usePeerRoom';
import { CityPanel } from '../components/CityPanel';
import { WorldBoard, mapCenter, visualTarget, type Glide, type VisualAttack } from '../components/WorldBoard';

type Opponent = 'ai' | 'hotseat' | 'online';
type LogRow = { id: number; round: number; who: string; action: string; target: string };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2_000_000_000 + 1;
const coord = (hex: Hex) => { const { col, row } = hexToOffset(hex); return `${col},${row}`; };
const orderVerb = (order: Action) => order.kind === 'special' ? 'FOUND' : order.kind === 'wait' ? 'HOLD'
  : order.kind === 'move' ? 'MOVE' : order.channel === 'brown' ? 'SHOOT' : order.channel === 'blue' ? 'POUNCE' : 'STRIKE';

function configurePlayers(game: GameState, mode: Opponent): GameState {
  game.players.forEach((player) => { player.isAi = mode === 'ai' && player.id !== 0; });
  return game;
}

function describeRound(before: GameState, after: GameState, orders: Action[], id: () => number): LogRow[] {
  const round = before.round + 1, rows: LogRow[] = [];
  const unitName = (unit: Unit) => `${PATTERN_BY_ID[unit.type].short} / ${before.players[unit.team]?.name}`;
  const founded = new Set(after.cityEntities.filter((city) => !before.cityEntities.some((old) => old.id === city.id)).map((city) => hexKey(city.pos)));
  for (const order of orders) {
    const unit = before.units[order.uid]; if (!unit?.alive || order.kind === 'wait') continue;
    const final = after.units[order.uid];
    const blocked = order.kind === 'move' && final?.alive && hexKey(final.pos) !== hexKey(order.target);
    rows.push({ id: id(), round, who: unitName(unit), action: orderVerb(order), target: blocked ? 'blocked' : coord(order.target) });
  }
  for (const unit of before.units.filter((u) => u.alive)) {
    if (!after.units[unit.uid]?.alive && !(unit.type === 'settler' && founded.has(hexKey(unit.pos))))
      rows.push({ id: id(), round, who: unitName(unit), action: 'KILLED', target: coord(unit.pos) });
  }
  for (const unit of after.units.filter((u) => u.alive && !before.units.some((old) => old.uid === u.uid)))
    rows.push({ id: id(), round, who: unitName(unit), action: 'BUILT', target: coord(unit.pos) });
  return rows;
}

export function PlayLab({ learning, onBack, initialRoom, legacyInvite }: {
  learning: LearningState; onBack: () => void; initialRoom?: string | null; legacyInvite?: boolean;
}) {
  const initialMode: Opponent = initialRoom || legacyInvite ? 'online' : 'ai';
  const [seed, setSeed] = useState(randomSeed);
  const [mode, setMode] = useState<Opponent>(initialMode);
  const [game, setGame] = useState(() => configurePlayers(createScenario(seed, { mapSize: 'duel', playerCount: 2 }), initialMode));
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);
  const [activePlayer, setActivePlayer] = useState(0);
  const [orders, setOrders] = useState<Record<number, Action>>({});
  const [ready, setReady] = useState<boolean[]>([false, false]);
  const [thinking, setThinking] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [glides, setGlides] = useState<Glide[]>([]);
  const [attacks, setAttacks] = useState<VisualAttack[]>([]);
  const [animationKey, setAnimationKey] = useState(0);
  const [showReach, setShowReach] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [message, setMessage] = useState('Select your Settler, then use Special Actions to found your capital.');
  const [linkInput, setLinkInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [received, setReceived] = useState(false);
  const room = usePeerRoom();
  const authoritative = useRef(game), visible = useRef(game);
  const revision = useRef(0), lastReceived = useRef(-1), logId = useRef(0);
  const matchId = useRef(crypto.randomUUID() as string);
  const locked = useRef(new Map<number, Action[]>());
  const busy = useRef(false), animationToken = useRef(0);
  const readyRef = useRef(ready), historyRef = useRef(log);
  const ownRules = useRef(captureRuleset()), wasGuest = useRef(false);
  const learningRef = useRef(learning); learningRef.current = learning;
  readyRef.current = ready; historyRef.current = log;

  const holderSide = mode === 'online' ? room.localSeat ?? -1 : mode === 'ai' ? 0 : activePlayer;
  const ownPlayer = game.players[holderSide];
  const selected = game.units.find((unit) => unit.uid === selectedUid && unit.alive);
  const selectedCity = game.cityEntities.find((city) => city.id === selectedCityId);
  const participants = game.players.filter((player) => !player.eliminated);
  const everyoneConnected = mode !== 'online' || participants.every((player) => room.members.some((member) => member.seat === player.id && member.connected));
  const onlineReady = mode !== 'online' || room.status === 'connected' && holderSide >= 0 && (room.role === 'host' || received);
  const canOrder = !game.finished && !thinking && !animating && !pending && onlineReady && everyoneConnected
    && !!ownPlayer && !ownPlayer.eliminated && !ready[holderSide];
  const actions = canOrder && selected?.team === holderSide ? legalActions(game, selected).filter((action) => action.kind !== 'special') : [];
  const enemyReach = useMemo(() => {
    const result = new Map<string, Action['channel']>();
    if (!showReach && (!selected || selected.team === holderSide)) return result;
    const units = showReach ? game.units.filter((u) => u.alive && u.team !== holderSide) : selected ? [selected] : [];
    for (const unit of units) for (const action of legalActions(game, unit))
      if (action.kind === 'move' || action.kind === 'attack') result.set(hexKey(action.target), action.channel);
    return result;
  }, [game, holderSide, selected, showReach]);

  const showGame = useCallback((next: GameState) => { visible.current = next; setGame(next); }, []);
  const setReadiness = (next: boolean[]) => { readyRef.current = next; setReady(next); };
  const appendLog = (rows: LogRow[]) => { const next = [...rows, ...historyRef.current].slice(0, 100); historyRef.current = next; setLog(next); };

  const animate = useCallback(async (frames: PlayFrame[], final: GameState) => {
    const token = ++animationToken.current;
    busy.current = true; setAnimating(true);
    let previous = visible.current;
    for (const frame of frames) {
      if (token !== animationToken.current) return;
      setAnimationKey((key) => key + 1);
      setGlides(previous.units.flatMap((unit) => {
        const next = frame.game.units[unit.uid];
        return unit.alive && next?.alive && hexKey(unit.pos) !== hexKey(next.pos)
          ? [{ unit, from: mapCenter(unit.pos), to: visualTarget(unit.pos, next.pos, final.width, final.wrap) }] : [];
      }));
      setAttacks(frame.attacks.map((attack) => ({ from: mapCenter(attack.from),
        to: visualTarget(attack.from, attack.to, final.width, final.wrap), channel: attack.channel })));
      await sleep(950);
      if (token !== animationToken.current) return;
      showGame(frame.game); setGlides([]); setAttacks([]); previous = frame.game;
      await sleep(30);
    }
    if (token !== animationToken.current) return;
    showGame(final); setAnimating(false); busy.current = false;
  }, [showGame]);

  const publish = useCallback((next: GameState, frames: PlayFrame[] = [], targetSeat?: number) => {
    const snapshot: RoomSnapshot = { game: toWire(next), ready: readyRef.current,
      revision: revision.current, matchId: matchId.current, seed, rules: captureRuleset(),
      frames: frames.length ? toWireFrames(frames) : undefined, log: historyRef.current };
    room.send({ type: 'snapshot', snapshot }, targetSeat);
  }, [room.send, seed]);

  const resolve = useCallback((allOrders: Action[], broadcast = false) => {
    if (busy.current) return;
    const previous = authoritative.current;
    busy.current = true;
    const transition = simultaneousTransition(previous, allOrders);
    authoritative.current = transition.game;
    appendLog(describeRound(previous, transition.game, allOrders, () => ++logId.current));
    locked.current.clear(); setReadiness(Array(transition.game.playerCount).fill(false));
    setOrders({}); setSelectedUid(null); setPending(false);
    const nextHuman = transition.game.players.find((p) => !p.eliminated)?.id ?? 0;
    setActivePlayer(nextHuman);
    setMessage(`Turn ${transition.game.round} resolved. Plan your next orders.`);
    revision.current++;
    if (broadcast) publish(transition.game, transition.frames);
    void animate(transition.frames, transition.game);
  }, [animate, publish]);

  const lockOrders = useCallback((actor: number, requested: Action[]) => {
    const current = authoritative.current;
    const reject = (text: string) => { room.send({ type: 'rejected', message: text }, actor); setPending(false); setMessage(text); };
    if (busy.current || current.finished || !current.players[actor] || current.players[actor].eliminated) { reject('The round is resolving or your civilization cannot act.'); return; }
    if (locked.current.has(actor)) { reject('Your orders are already locked.'); return; }
    const valid = validateOrders(current, actor, requested);
    if (!valid) { reject('An order is no longer legal. Review it before locking.'); return; }
    locked.current.set(actor, valid);
    setReadiness(current.players.map((p) => p.eliminated || locked.current.has(p.id)));
    setPending(false);
    if (current.players.every((p) => p.eliminated || locked.current.has(p.id))) {
      resolve([...locked.current.values()].flat(), true);
    } else {
      revision.current++;
      publish(current);
      setMessage(`${current.players[actor].name} is ready. Waiting for the other civilizations.`);
    }
  }, [publish, resolve, room.send]);

  const updateProduction = useCallback((actor: number, cityId: number, producing: PatternId) => {
    const current = authoritative.current;
    const city = current.cityEntities.find((candidate) => candidate.id === cityId);
    if (!city || city.owner !== actor || !PATTERN_IDS.includes(producing) || busy.current || locked.current.has(actor)) {
      room.send({ type: 'rejected', message: 'You cannot change this city while orders are locked or during resolution.' }, actor);
      setPending(false); return;
    }
    const next = cloneGame(current), changed = next.cityEntities.find((c) => c.id === cityId)!;
    setCityProduction(changed, producing);
    authoritative.current = next; showGame(next); revision.current++; setPending(false);
    setMessage(`${changed.name}: producing ${PATTERN_BY_ID[producing].name}. Previous progress is saved.`);
    if (mode === 'online' && room.role === 'host') publish(next);
  }, [mode, publish, room.role, room.send, showGame]);

  useEffect(() => {
    room.setHandler((payload: RoomMessage, fromSeat: number) => {
      if (payload.type === 'snapshot' && room.role === 'guest') {
        if (!isRoomSnapshot(payload.snapshot)) return;
        const incoming = payload.snapshot, newMatch = incoming.matchId !== matchId.current;
        if (!newMatch && incoming.revision < lastReceived.current) return;
        const freshRound = newMatch || incoming.game.round !== authoritative.current.round;
        const updated = newMatch || incoming.revision !== lastReceived.current;
        const next = fromWire(incoming.game);
        applyRuleset(incoming.rules);
        matchId.current = incoming.matchId; revision.current = incoming.revision; lastReceived.current = incoming.revision;
        authoritative.current = next; setSeed(incoming.seed); setReadiness(incoming.ready);
        setPending(false); setReceived(true);
        if (incoming.log) { historyRef.current = incoming.log; setLog(incoming.log); }
        if (freshRound) { setOrders({}); setSelectedUid(null); }
        if (freshRound) setMessage(newMatch ? 'Connected world synchronized. You control your assigned civilization.'
          : `Turn ${next.round} resolved. Plan your next orders.`);
        if (newMatch) { ++animationToken.current; busy.current = false; setAnimating(false); setGlides([]); setAttacks([]); setSelectedCityId(null); }
        if (updated && incoming.frames?.length && !newMatch) void animate(fromWireFrames(incoming.frames), next);
        else if (updated && !animatingRef.current) showGame(next);
      } else if (room.role === 'host' && (payload.type === 'orders' || payload.type === 'production')) {
        if (payload.matchId !== matchId.current || payload.round !== authoritative.current.round) {
          room.send({ type: 'rejected', message: 'The round changed. Wait for the latest board and submit again.' }, fromSeat); return;
        }
        if (payload.type === 'orders') lockOrders(fromSeat, payload.orders);
        else updateProduction(fromSeat, payload.cityId, payload.producing);
      } else if (payload.type === 'rejected') { setPending(false); setMessage(payload.message); }
    });
  }, [animate, lockOrders, room.role, room.send, room.setHandler, showGame, updateProduction]);
  const animatingRef = useRef(animating); animatingRef.current = animating;

  useEffect(() => { if (initialRoom) room.join(initialRoom); }, [initialRoom, room.join]);
  useEffect(() => { if (room.role === 'guest') wasGuest.current = true; }, [room.role]);
  const publishRef = useRef(publish); publishRef.current = publish;
  useEffect(() => {
    if (room.role !== 'host' || !room.members.some((member) => member.seat > 0 && member.connected)) return;
    revision.current++;
    publishRef.current(authoritative.current);
  }, [room.members, room.role]);
  useEffect(() => () => {
    animationToken.current++;
    if (wasGuest.current) {
      applyRuleset(ownRules.current);
      setProfileOverlays(adaptLearningToPatterns(learningRef.current).profileDeltas);
    }
  }, []);

  const assignOrder = (action: Action) => {
    if (!canOrder || game.units[action.uid]?.team !== holderSide) return;
    setOrders((previous) => ({ ...previous, [action.uid]: action }));
    setSelectedUid(null);
  };
  const clickHex = (hex: Hex) => {
    const targetAction = actions.find((action) => hexKey(action.target) === hexKey(hex));
    if (targetAction && canOrder) { assignOrder(targetAction); return; }
    const occupant = game.units.find((unit) => unit.alive && hexKey(unit.pos) === hexKey(hex));
    setSelectedUid(occupant?.uid ?? null);
    setSelectedCityId(null);
  };
  const selectCity = (id: number) => { setSelectedCityId(id); setSelectedUid(null); };
  const changeProduction = (type: PatternId) => {
    if (!selectedCity || !canOrder || selectedCity.owner !== holderSide) return;
    if (mode === 'online' && room.role === 'guest') {
      if (room.send({ type: 'production', matchId: matchId.current, round: game.round, cityId: selectedCity.id, producing: type })) setPending(true);
    } else updateProduction(holderSide, selectedCity.id, type);
  };

  const endTurn = () => {
    if (!canOrder || busy.current) return;
    const current = authoritative.current;
    const requested = Object.values(orders).filter((action) => current.units[action.uid]?.team === holderSide);
    if (mode === 'online') {
      if (room.role === 'guest') {
        if (room.send({ type: 'orders', matchId: matchId.current, round: current.round, orders: requested })) setPending(true);
      } else lockOrders(0, requested);
      return;
    }
    if (mode === 'ai') {
      setThinking(true); busy.current = true;
      const token = animationToken.current;
      setTimeout(() => {
        if (token !== animationToken.current) return;
        try {
          const all = [...requested];
          for (const player of current.players) if (player.id !== 0 && !player.eliminated)
            all.push(...chooseSimultaneousOrders(current, player.id, learning.champion, learning.champion));
          busy.current = false; setThinking(false); resolve(all);
        } catch (error) { busy.current = false; setThinking(false); setMessage(error instanceof Error ? error.message : String(error)); }
      }, 30);
      return;
    }
    const next = participants.find((player) => player.id > holderSide);
    if (next) { setActivePlayer(next.id); setSelectedUid(null); setSelectedCityId(null); setMessage(`${next.name}: plan your orders.`); }
    else resolve(Object.values(orders));
  };

  const newGame = (size: MapSizeKey, count: number, nextMode = mode) => {
    if (room.role === 'guest' || busy.current) return;
    const nextSeed = randomSeed(), next = configurePlayers(createScenario(nextSeed, { mapSize: size, playerCount: count }), nextMode);
    authoritative.current = next; showGame(next); setSeed(nextSeed); setOrders({}); setSelectedUid(null); setSelectedCityId(null);
    setReadiness(Array(count).fill(false)); setActivePlayer(0); locked.current.clear(); historyRef.current = []; setLog([]);
    matchId.current = crypto.randomUUID(); revision.current++; setMessage('New world. Select your Settler to found your capital.');
    if (nextMode === 'online' && room.role === 'host') room.send({ type: 'snapshot', snapshot: {
      game: toWire(next), ready: Array(count).fill(false), revision: revision.current, matchId: matchId.current,
      seed: nextSeed, rules: captureRuleset(), log: [],
    } });
  };
  const switchMode = (nextMode: Opponent) => {
    if (busy.current) return;
    room.close(); setReceived(false); lastReceived.current = -1;
    if (wasGuest.current) {
      applyRuleset(ownRules.current);
      setProfileOverlays(adaptLearningToPatterns(learningRef.current).profileDeltas);
      wasGuest.current = false;
    }
    setMode(nextMode); setOrders({}); setReadiness(Array(game.playerCount).fill(false)); locked.current.clear();
    const next = configurePlayers(cloneGame(authoritative.current), nextMode);
    authoritative.current = next; showGame(next); setActivePlayer(next.players.find((p) => !p.eliminated)?.id ?? 0);
  };
  const createRoom = () => {
    room.create(game.playerCount);
    const next = configurePlayers(cloneGame(authoritative.current), 'online'); authoritative.current = next; showGame(next);
    setReadiness(Array(game.playerCount).fill(false)); locked.current.clear();
  };
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(room.invite); setCopied(true); setTimeout(() => setCopied(false), 1300); }
    catch { setMessage('Select the invitation text to copy it.'); }
  };

  const special = selected && selected.type === 'settler' && selected.team === holderSide;
  const founding = special ? canFoundCity(game, selected.pos) : null;
  const editable = room.role !== 'guest' && !busy.current;
  const required = Math.ceil(game.playerCount * 2 / 3);
  const endLabel = animating ? 'Resolving...' : thinking ? 'AI planning...' : mode === 'online'
    ? ready[holderSide] ? 'Orders locked' : 'End turn / lock' : 'End turn (resolve)';
  const overlay = selectedCity ? <CityPanel city={selectedCity} ownerName={game.players[selectedCity.owner]?.name || 'Unknown'}
    owned={selectedCity.owner === holderSide} disabled={!canOrder} onChange={changeProduction} onClose={() => setSelectedCityId(null)} />
    : special ? <section className="play-box special-box" aria-label="Special actions">
      <div className="city-box-head"><span className="micro-label">SPECIAL ACTIONS / SETTLER</span><button className="city-close-btn" aria-label="Close special actions" onClick={() => setSelectedUid(null)}><X size={16} /></button></div>
      <div className="special-action-content"><strong><Building2 size={15} /> Found a City</strong>
        <p>Consume this Settler to claim the center and its adjacent tiles. Your first city becomes your capital.</p>
        <button className="primary special-btn" disabled={!canOrder || !founding?.valid} onClick={() => assignOrder({ uid: selected.uid,
          kind: 'special', channel: 'special', target: { ...selected.pos }, specialAction: 'found_city' })}>{founding?.valid ? 'Found a City Here' : founding?.reason}</button></div>
    </section> : null;
  const victoryDialog = game.finished && !animating ? <div className="battle-overlay"><div className="battle-result">
    <Crown size={28} /><span className="micro-label">MATCH CONCLUDED</span>
    <h2>{game.winner === null ? 'No surviving civilization.' : `${game.players[game.winner]?.name} wins.`}</h2>
    <p>{game.reason === 'capture' ? `${required} capitals required for domination.` : `Result: ${game.reason}.`}</p>
    <button className="primary" disabled={!editable} onClick={() => newGame(game.mapSizeKey, game.playerCount)}><Play size={14} /> New game</button>
  </div></div> : null;

  return <div className="play-page">
    <div className="subpage-head"><div><button className="back-link" onClick={onBack}><ArrowLeft size={14} /> Back to lab</button>
      <span className="micro-label">CIVILIZATION / TACTICAL WARFARE</span><h1>Empire &amp; <em>Conquest.</em></h1>
      <p>Found cities. Build your armies. Control two-thirds of the world's capitals to win.</p></div>
      <div className="champion-badge"><Crosshair size={16} /><span>TACTICAL AI<strong>Policy v{String(learning.version).padStart(2, '0')}</strong></span><small>3-round lookahead</small></div></div>
    <div className="domination-banner"><div className="domination-head"><span><Crown size={12} /> DOMINATION / {required} OF {game.playerCount} CAPITALS</span><span>{game.wrap ? 'CONTINUOUS EAST-WEST WORLD' : 'BOUNDED DUEL MAP'}</span></div>
      <div className="domination-players">{game.players.map((player) => <div key={player.id} className={`dom-player-card ${player.eliminated ? 'eliminated' : ''}`} style={{ borderColor: player.color }}>
        <i className="dom-dot" style={{ background: player.color }} /><div className="dom-info"><strong>{player.name} {player.id === holderSide ? '(You)' : player.isAi ? '(AI)' : ''}</strong>
          <small>{game.cityEntities.filter((city) => city.isCapital && city.owner === player.id).length} capitals / {game.cityEntities.filter((city) => city.owner === player.id).length} cities / {game.units.filter((unit) => unit.alive && unit.team === player.id).length} units</small></div></div>)}</div>
    </div>
    <div className="play-toolbar"><div className="play-mode">
      <button className={mode === 'ai' ? 'is-active' : ''} disabled={animating || thinking} onClick={() => switchMode('ai')}><Bot size={14} /> vs AI</button>
      <button className={mode === 'hotseat' ? 'is-active' : ''} disabled={animating || thinking} onClick={() => switchMode('hotseat')}><Users size={14} /> Hotseat</button>
      <button className={mode === 'online' ? 'is-active' : ''} disabled={animating || thinking} onClick={() => switchMode('online')}><Wifi size={14} /> Online P2P</button>
    </div><div className="play-mode second">
      <label className="play-stage">MAP<select aria-label="Map size" value={game.mapSizeKey} disabled={!editable} onChange={(event) => newGame(event.target.value as MapSizeKey, game.playerCount)}>
        {Object.values(MAP_CONFIGS).map((map) => <option value={map.key} key={map.key}>{map.name} {map.width} x {map.height}{map.wrap ? ' / Wrap' : ''}</option>)}</select></label>
      <label className="play-stage">PLAYERS<select aria-label="Player count" value={game.playerCount} disabled={!editable || room.role !== null} onChange={(event) => newGame(game.mapSizeKey, Number(event.target.value))}>
        {Array.from({ length: 9 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
    </div><div className="battle-turn"><span className="turn-dot" style={{ background: ownPlayer?.color || '#90a48f' }} />
      {ownPlayer ? `${ownPlayer.name}${mode === 'online' ? ` / player ${holderSide + 1}` : ''}` : 'Joining...'}<b>TURN {game.round + 1}</b></div>
      <div className="play-actions"><button onClick={() => {
        if (game.round === 0 || window.confirm('Start a new world? Current progress will be discarded for every player.')) newGame(game.mapSizeKey, game.playerCount);
      }} disabled={!editable}><Shuffle size={14} /> New 4X Game</button></div>
    </div>

    {mode === 'online' && <section className="play-box link-box online-lobby">
      <div><span className="micro-label"><Wifi size={13} /> ONLINE / {room.status.toUpperCase()}</span>
        <p className="play-help">{room.message || (legacyInvite ? 'Old snapshot links are not multiplayer rooms. Create a new invitation.' : 'Choose the player count, create a room, and invite one player per civilization.')}</p>
        {room.invite && <div className="invite-row"><div className="link-field">{room.invite}</div><button className="link-copy" onClick={copyInvite}><Copy size={13} /> {copied ? 'Copied' : 'Copy invitation'}</button></div>}
        {room.role === null || room.status === 'error' || room.status === 'disconnected' ? <div className="lobby-entry">
          <div className="link-open"><input aria-label="Paste invitation link" value={linkInput} placeholder="Paste an invitation or room code" onChange={(event) => setLinkInput(event.target.value)} /><button onClick={() => { setReceived(false); lastReceived.current = -1; room.join(linkInput); }}>Join</button></div>
          <button className="link-copy" onClick={createRoom}>Create {game.playerCount}-player room</button></div> : null}
      </div>
      <div className="room-roster"><span className="micro-label">CIVILIZATION SEATS</span>{Array.from({ length: room.role ? room.capacity : game.playerCount }, (_, seat) => {
        const member = room.members.find((item) => item.seat === seat);
        return <div key={seat} data-seat={seat} className={member?.connected ? 'seat-connected' : ''}><span>{game.players[seat]?.name || `Player ${seat + 1}`}{seat === room.localSeat ? ' (You)' : ''}</span><b>{ready[seat] ? 'Ready' : member?.connected ? 'Connected' : member?.reserved ? 'Disconnected' : 'Waiting'}</b></div>;
      })}<small>All active seats must connect and lock orders. A disconnected player's seat is reserved for rejoining.</small></div>
    </section>}

    <WorldBoard key={matchId.current} game={game} holderSide={holderSide} selected={selected} orders={orders} actions={actions}
      enemyReach={enemyReach} showReach={showReach} toggleReach={() => setShowReach((value) => !value)}
      onHex={clickHex} onCity={selectCity} glides={glides} attacks={attacks} animationKey={animationKey}
      endTurn={endTurn} endLabel={endLabel} disabled={!canOrder} message={message} overlay={overlay} dialog={victoryDialog} />

    <div className="match-bottom">
      <section className="play-box"><span className="micro-label">ORDERS / {ownPlayer?.name.toUpperCase() || 'WAITING FOR SEAT'}</span>
        <p className="play-help">{mode === 'online' && !everyoneConnected ? 'Waiting for every active civilization to connect.' : 'Assign an order, then select another unit. Unordered units hold. All attacks resolve before movement.'}</p>
        <div className="order-chips">{game.units.filter((unit) => unit.alive && unit.team === holderSide).map((unit) => <button key={unit.uid} className={orders[unit.uid] ? 'is-ordered' : ''} onClick={() => { setSelectedUid(unit.uid); setSelectedCityId(null); }}><span>{PATTERN_BY_ID[unit.type].short}</span><small>{orders[unit.uid] ? orderVerb(orders[unit.uid]) : 'SELECT'}</small></button>)}</div>
        <div className="order-actions"><button disabled={!canOrder} onClick={() => setOrders((previous) => Object.fromEntries(Object.entries(previous).filter(([uid]) => game.units[Number(uid)]?.team !== holderSide)))}><Trash2 size={12} /> Clear my orders</button>
          <button disabled={!canOrder || !selected || selected.team !== holderSide} onClick={() => selected && assignOrder({ uid: selected.uid, kind: 'wait', channel: 'wait', target: selected.pos })}>Hold selected</button></div>
        {selectedCityId === null && selected && <p className="play-help selected-unit-note">{PATTERN_BY_ID[selected.type].name} / {game.players[selected.team]?.name} / {coord(selected.pos)}</p>}
      </section>
      <section className="play-box score-sheet"><span className="micro-label">SCORE SHEET / MOST RECENT FIRST</span>
        {log.length ? <div className="sheet-table"><div className="sheet-head"><span>TURN</span><span>UNIT</span><span>ACTION</span><span>TARGET</span></div>
          {log.map((row) => <div key={row.id} className={`sheet-row ${row.action === 'KILLED' ? 'is-killed' : ''}`}><span>{row.round}</span><span>{row.who}</span><span>{row.action}</span><span>{row.target}</span></div>)}</div>
          : <p className="play-help">Moves, city founding, production and kills will appear here.</p>}
      </section>
    </div>
  </div>;
}
