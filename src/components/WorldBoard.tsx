import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Compass, Eye, Maximize2, Minimize2, Minus, Play, Plus, RotateCcw } from 'lucide-react';
import { PLAYER_COLORS, type Action, type GameState, type Unit } from '../sim/engine';
import { hexKey, hexToOffset, offsetToHex, PATTERN_BY_ID, type Hex } from '../sim/patterns';
import {
  cameraMetrics, COL_STEP, HEX_RADIUS, MAP_ORIGIN, MAX_ZOOM, ROW_STEP, mapCenter, visibleWorldSections, visualTarget,
  type Point, type VisibleSection,
} from './worldGeometry';

export { COL_STEP, HEX_RADIUS, mapCenter, visualTarget } from './worldGeometry';
export type { Point } from './worldGeometry';
export const CHANNEL_COLORS = { green: '#72a88c', red: '#d9826c', brown: '#e8c56a', blue: '#5e96a8', wait: '#72a88c', special: '#f4cb74' };
export type Glide = { unit: Unit; from: Point; to: Point };
export type VisualAttack = { from: Point; to: Point; channel: Action['channel'] };

type SectionRange = Omit<VisibleSection, 'copy'>;
const polygon = (radius: number) => Array.from({ length: 6 }, (_, i) => {
  const angle = (60 * i - 90) * Math.PI / 180;
  return `${radius * Math.cos(angle)},${radius * Math.sin(angle)}`;
}).join(' ');
// Hex shapes are identical across the board; only their positions change.
const HEX_SHAPES = {
  base: polygon(HEX_RADIUS - 0.4), territory: polygon(HEX_RADIUS - 1.5),
  reach: polygon(HEX_RADIUS - 4), target: polygon(HEX_RADIUS - 3), order: polygon(HEX_RADIUS - 5),
};

const WorldCell = memo(function WorldCell({ col, row, tileKey, owner, mountain, reach, action, ordered }: {
  col: number; row: number; tileKey: string; owner?: number; mountain: boolean;
  reach?: Action['channel']; action?: Action['channel']; ordered: boolean;
}) {
  const x = MAP_ORIGIN + (col + (row % 2) / 2) * COL_STEP, y = MAP_ORIGIN + row * ROW_STEP;
  return <g className="battle-cell" data-hex={tileKey} transform={`translate(${x} ${y})`}>
    <polygon points={HEX_SHAPES.base} fill={mountain ? '#344641' : (col - Math.floor(row / 2) + row) % 3 ? '#253530' : '#283936'}
      stroke={owner !== undefined ? PLAYER_COLORS[owner] : '#405149'} strokeWidth={owner !== undefined ? 1.5 : 0.8} />
    {owner !== undefined && <polygon points={HEX_SHAPES.territory} fill={PLAYER_COLORS[owner]} fillOpacity="0.12" />}
    {reach && <polygon points={HEX_SHAPES.reach} fill={CHANNEL_COLORS[reach]} fillOpacity="0.18" stroke={CHANNEL_COLORS[reach]} strokeWidth="0.8" strokeDasharray="3 3" />}
    {action && <polygon points={HEX_SHAPES.target} fill={CHANNEL_COLORS[action]} fillOpacity="0.62" stroke={CHANNEL_COLORS[action]} />}
    {ordered && <polygon points={HEX_SHAPES.order} fill="none" stroke="#f4efe2" strokeWidth="2" strokeDasharray="5 3" />}
    {mountain && <path d="M-10 7 l7 -13 4 7 4 -5 7 11Z" fill="#809991" opacity=".68" />}
  </g>;
});

const WorldCells = memo(function WorldCells({ firstCol, lastCol, firstRow, lastRow, terrain, territory, targets, enemyReach, ordered }: SectionRange & {
  terrain: Set<string>; territory: Map<string, number>; targets: Map<string, Action>;
  enemyReach: Map<string, Action['channel']>; ordered: Set<string>;
}) {
  const cells = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const key = hexKey(offsetToHex(col, row));
      cells.push(<WorldCell key={key} col={col} row={row} tileKey={key} owner={territory.get(key)}
        mountain={terrain.has(key)} reach={enemyReach.get(key)} action={targets.get(key)?.channel} ordered={ordered.has(key)} />);
    }
  }
  return cells;
});

function tweenPosition(from: Point, to: Point, startedAt: number, now: number) {
  const t = Math.max(0, Math.min(1, (now - startedAt) / 900)), eased = t * t * (3 - 2 * t);
  return { transform: `translate(${from.x + (to.x - from.x) * eased} ${from.y + (to.y - from.y) * eased})`, done: t === 1 };
}

function Tween({ from, to, startedAt, children, uid }: { from: Point; to: Point; startedAt: number; children: ReactNode; uid?: number }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      const position = tweenPosition(from, to, startedAt, now);
      ref.current?.setAttribute('transform', position.transform);
      if (!position.done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, startedAt]);
  return <g ref={ref} transform={tweenPosition(from, to, startedAt, performance.now()).transform} pointerEvents="none" data-gliding-unit={uid}>{children}</g>;
}

function UnitGlyph({ unit, selected = false, order }: { unit: Unit; selected?: boolean; order?: Action }) {
  const color = PLAYER_COLORS[unit.team];
  return <><circle r={selected ? 12.5 : 11.5} fill="#172721" stroke={color} strokeWidth={selected ? 2.8 : 1.7} />
    <text y="3.5" textAnchor="middle" className="unit-letter" fill={color}>{PATTERN_BY_ID[unit.type].short}</text>
    {order && <circle cx="9" cy="-8" r="3" fill={CHANNEL_COLORS[order.channel]} pointerEvents="none" />}</>;
}

const WorldOrderLines = memo(function WorldOrderLines({ game, orders }: { game: GameState; orders: Action[] }) {
  return orders.map((order) => {
    const unit = game.units[order.uid]; if (!unit?.alive) return null;
    const from = mapCenter(unit.pos), to = visualTarget(unit.pos, order.target, game.width, game.wrap);
    return <line key={unit.uid} x1={from.x} y1={from.y} x2={to.x} y2={to.y} pointerEvents="none" data-order-line={unit.uid}
      stroke={order.kind === 'move' ? '#72a88c' : order.channel === 'brown' ? '#e8c56a' : '#d9826c'} strokeWidth="1.5" />;
  });
});

function markerInRange(hex: Hex, { firstCol, lastCol, firstRow, lastRow }: SectionRange): boolean {
  const { col, row } = hexToOffset(hex);
  // City labels extend beyond a single tile, so keep a small off-screen margin.
  return col >= firstCol - 2 && col <= lastCol + 2 && row >= firstRow - 2 && row <= lastRow + 2;
}

const WorldMarkers = memo(function WorldMarkers({ game, selectedUid, orders, moving, onHex, onCity, firstCol, lastCol, firstRow, lastRow }: SectionRange & {
  game: GameState; selectedUid?: number; orders: Record<number, Action>; moving: Set<number>;
  onHex: (hex: Hex) => void; onCity: (id: number) => void;
}) {
  const range = { firstCol, lastCol, firstRow, lastRow };
  return <>
    {game.cityEntities.filter((city) => markerInRange(city.pos, range)).map((city) => {
      const { x, y } = mapCenter(city.pos), color = PLAYER_COLORS[city.owner];
      return <g key={city.id} transform={`translate(${x} ${y})`} data-city-id={city.id} className="city-marker" role="button" tabIndex={0}
        aria-label={`Manage ${city.name}`} onKeyDown={(event) => { if (event.key === 'Enter') onCity(city.id); }}>
        <circle r="17" fill="#172721" stroke={color} strokeWidth="2.5" />
        <path d="M-8 7V-3L0-8 8-3V7Z M-3 7V1H3V7" fill="none" stroke="#e5c997" strokeWidth="1.4" />
        {city.isCapital && <path d="M-7 -11l2 3 5-5 5 5 2-3" fill="none" stroke="#e5c997" strokeWidth="1.5" />}
        <rect x="-40" y="20" width="80" height="14" rx="2" fill="#172721" stroke={color} />
        <text x="0" y="30" textAnchor="middle" fill="#edf0e7" fontSize="8">{city.name.slice(0, 13)}</text>
      </g>;
    })}
    {game.units.filter((unit) => unit.alive && !moving.has(unit.uid) && markerInRange(unit.pos, range)).map((unit) => {
      const { x, y } = mapCenter(unit.pos);
      return <g key={unit.uid} transform={`translate(${x} ${y})`} className="battle-unit" data-unit-id={unit.uid} data-uid={unit.uid} data-team={unit.team}
        role="button" tabIndex={0} aria-label={`${game.players[unit.team]?.name} ${PATTERN_BY_ID[unit.type].name}`}
        onKeyDown={(event) => { if (event.key === 'Enter') onHex(unit.pos); }}>
        <UnitGlyph unit={unit} selected={selectedUid === unit.uid} order={orders[unit.uid]} />
      </g>;
    })}
  </>;
});

const WorldEffects = memo(function WorldEffects({ glides, attacks, animationKey, startedAt }: {
  glides: Glide[]; attacks: VisualAttack[]; animationKey: number; startedAt: number;
}) {
  return <>
    {glides.map((glide) => <Tween key={`${animationKey}-${glide.unit.uid}`} from={glide.from} to={glide.to} startedAt={startedAt} uid={glide.unit.uid}><UnitGlyph unit={glide.unit} /></Tween>)}
    {attacks.map((effect, i) => effect.channel === 'brown'
      ? <Tween key={`shot-${animationKey}-${i}`} from={effect.from} to={effect.to} startedAt={startedAt}><circle r="5" fill="#e8c56a" /></Tween>
      : <circle key={`impact-${animationKey}-${i}`} className="impact-ring" cx={effect.to.x} cy={effect.to.y} r="17" fill="none" stroke="#f2c98f" strokeWidth="2.5" pointerEvents="none"
        style={{ animationDelay: `${-Math.max(0, performance.now() - startedAt)}ms` }} />)}
  </>;
});

export function WorldBoard({ game, selected, orders, actions, enemyReach, showReach, toggleReach, onHex, onCity,
  glides, attacks, animationKey, endTurn, endLabel, disabled, message, overlay, holderSide, dialog }: {
  game: GameState; selected?: Unit; orders: Record<number, Action>; actions: Action[];
  enemyReach: Map<string, Action['channel']>; showReach: boolean; toggleReach: () => void;
  onHex: (hex: Hex) => void; onCity: (id: number) => void; glides: Glide[]; attacks: VisualAttack[];
  animationKey: number; endTurn: () => void; endLabel: string; disabled: boolean; message: string;
  overlay: ReactNode; holderSide: number; dialog?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 660 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullError, setFullError] = useState('');
  const drag = useRef<{ x: number; y: number; pan: Point; moved: boolean; hit: Element | null } | null>(null);
  const panFrame = useRef<number | null>(null), pendingPan = useRef<Point | null>(null);
  const { mapWidth, mapHeight, fit, minZoom, scale, period } = cameraMetrics(size, game.width, game.height, game.wrap, zoom);
  const territory = useMemo(() => {
    const map = new Map<string, number>();
    game.cityEntities.forEach((city) => city.territory.forEach((hex) => map.set(hexKey(hex), city.owner)));
    return map;
  }, [game.cityEntities]);
  const targets = useMemo(() => new Map(actions.filter((a) => a.kind !== 'special').map((a) => [hexKey(a.target), a])), [actions]);
  const orderList = useMemo(() => Object.values(orders).filter((a) => a.kind === 'move' || a.kind === 'attack'), [orders]);
  const ordered = useMemo(() => new Set(orderList.map((a) => hexKey(a.target))), [orderList]);
  const moving = useMemo(() => new Set(glides.map((g) => g.unit.uid)), [glides]);
  // A seam image that enters the viewport mid-animation must join the same timeline.
  const animationStartedAt = useMemo(() => performance.now(), [animationKey]);
  const sections = visibleWorldSections(size, pan, scale, game.width, game.height, game.wrap);

  const cancelQueuedPan = () => {
    if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
    panFrame.current = null; pendingPan.current = null;
  };
  const flushQueuedPan = () => {
    const next = pendingPan.current;
    cancelQueuedPan();
    if (next) setPan(next);
  };
  const reset = () => {
    cancelQueuedPan();
    if (!fit) return;
    const nextZoom = Math.max(1, minZoom), nextScale = fit * nextZoom;
    setZoom(nextZoom);
    setPan({ x: (size.width - mapWidth * nextScale) / 2, y: (size.height - mapHeight * nextScale) / 2 });
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((old) => old.width === width && old.height === height ? old : { width, height });
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(reset, [game.width, game.height, game.wrap, size.width, size.height]);
  useEffect(() => () => { if (panFrame.current !== null) cancelAnimationFrame(panFrame.current); }, []);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const normalizedPan = (next: Point, nextScale = scale): Point => {
    const scaledPeriod = period * nextScale;
    return {
      x: game.wrap && scaledPeriod > 0 ? next.x - Math.round(next.x / scaledPeriod) * scaledPeriod : next.x,
      y: nextScale > 0 ? Math.max(-mapHeight * nextScale + 60, Math.min(size.height - 60, next.y)) : next.y,
    };
  };
  const queuePan = (next: Point) => {
    pendingPan.current = normalizedPan(next);
    if (panFrame.current !== null) return;
    panFrame.current = requestAnimationFrame(() => {
      panFrame.current = null;
      const queued = pendingPan.current; pendingPan.current = null;
      if (queued) setPan(queued);
    });
  };
  const zoomAt = (factor: number, anchor: Point = { x: size.width / 2, y: size.height / 2 }) => {
    if (!fit || !scale) return;
    cancelQueuedPan();
    const current = scale / fit;
    const next = Math.max(minZoom, Math.min(Math.max(MAX_ZOOM, minZoom), current * factor));
    const nextScale = fit * next, ratio = nextScale / scale;
    setPan(normalizedPan({ x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio }, nextScale));
    setZoom(next);
  };
  const zoomAtRef = useRef(zoomAt); zoomAtRef.current = zoomAt;
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomAtRef.current(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === panel.current) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
      setFullError('');
    } catch { setFullError('Fullscreen is blocked by this browser or embed. Open the game in its own tab.'); }
  };
  const centerHome = () => {
    const target = game.cityEntities.find((c) => c.owner === holderSide)?.pos ?? game.units.find((u) => u.alive && u.team === holderSide)?.pos;
    if (target && scale > 0) {
      cancelQueuedPan();
      const point = mapCenter(target); setPan(normalizedPan({ x: size.width / 2 - point.x * scale, y: size.height / 2 - point.y * scale }));
    }
  };

  return <section className="play-board-panel world-panel" ref={panel}>
    <div className="play-board-top world-top">
      <span>{game.mapSizeKey.toUpperCase()} {game.width} x {game.height} {game.wrap ? '/ WRAPPING' : ''} / TURN {game.round + 1}</span>
      <div className="world-controls">
        <button className="end-turn" onClick={endTurn} disabled={disabled}><Play size={13} fill="currentColor" /> {endLabel}</button>
        <button className={showReach ? 'active' : ''} onClick={toggleReach} aria-pressed={showReach} title="Show enemy reach"><Eye size={15} /><span>Enemy reach</span></button>
        <button onClick={() => zoomAt(1.2)} title="Zoom in" aria-label="Zoom in"><Plus size={15} /></button>
        <button onClick={() => zoomAt(1 / 1.2)} title="Zoom out" aria-label="Zoom out"><Minus size={15} /></button>
        <button onClick={reset} title="Reset view" aria-label="Reset view"><RotateCcw size={14} /></button>
        <button onClick={centerHome} title="Center on capital" aria-label="Center on capital"><Compass size={15} /></button>
        <button onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <small>{Math.round((fit ? scale / fit : zoom) * 100)}%</small>
      </div>
    </div>
    <div className="world-viewport" ref={viewport} style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return;
        const hit = (event.target as Element).closest('[data-hex],[data-city-id],[data-unit-id]');
        drag.current = { x: event.clientX, y: event.clientY, pan, moved: false, hit };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current; if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) > 5) { start.moved = true; setDragging(true); }
        if (start.moved) queuePan({ x: start.pan.x + dx, y: start.pan.y + dy });
      }}
      onPointerUp={(event) => {
        const start = drag.current; drag.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (start?.moved) { flushQueuedPan(); return; }
        if (!start?.hit) return;
        const city = start.hit.getAttribute('data-city-id'), uid = start.hit.getAttribute('data-unit-id');
        if (city !== null) onCity(Number(city));
        else if (uid !== null) { const unit = game.units.find((u) => u.uid === Number(uid)); if (unit) onHex(unit.pos); }
        else { const [q, r] = (start.hit.getAttribute('data-hex') || '').split(',').map(Number); if (Number.isFinite(q) && Number.isFinite(r)) onHex({ q, r }); }
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); flushQueuedPan(); }}>
      <svg viewBox={`0 0 ${Math.max(size.width, 1)} ${Math.max(size.height, 1)}`} className="play-board world-svg" aria-label={game.wrap ? 'Wrapping hex game map' : 'Hex game map'}>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`} data-camera="true">
          {sections.map(({ copy, ...range }) => <g key={copy} transform={`translate(${copy * period} 0)`} className="world-copy" data-copy={copy}>
            <WorldCells {...range} terrain={game.terrain} territory={territory} targets={targets} enemyReach={enemyReach} ordered={ordered} />
          </g>)}
          {sections.map(({ copy, ...range }) => <g key={copy} transform={`translate(${copy * period} 0)`} data-copy-objects={copy}>
            <WorldOrderLines game={game} orders={orderList} />
            <WorldMarkers {...range} game={game} selectedUid={selected?.uid} orders={orders} moving={moving} onHex={onHex} onCity={onCity} />
            <WorldEffects glides={glides} attacks={attacks} animationKey={animationKey} startedAt={animationStartedAt} />
          </g>)}
        </g>
      </svg>
    </div>
    {overlay && <div className="world-overlay" onPointerDown={(event) => event.stopPropagation()}>{overlay}</div>}
    <div className="play-board-foot"><span className="shape-legend"><i className="legend-dot green" /> move <i className="legend-dot red" /> attack <i className="legend-dot brown" /> ranged</span>
      <strong aria-live="polite">{fullError || message}</strong></div>
    {dialog}
  </section>;
}
