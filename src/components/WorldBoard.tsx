import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Compass, Eye, Maximize2, Minimize2, Minus, Play, Plus, RotateCcw } from 'lucide-react';
import { boardHexes, PLAYER_COLORS, type Action, type GameState, type Unit } from '../sim/engine';
import { hexKey, hexToOffset, PATTERN_BY_ID, type Hex } from '../sim/patterns';

export const HEX_RADIUS = 22;
export const COL_STEP = HEX_RADIUS * Math.sqrt(3);
const ROW_STEP = HEX_RADIUS * 1.5;
export const CHANNEL_COLORS = { green: '#72a88c', red: '#d9826c', brown: '#e8c56a', blue: '#5e96a8', wait: '#72a88c', special: '#f4cb74' };
export type Point = { x: number; y: number };
export type Glide = { unit: Unit; from: Point; to: Point };
export type VisualAttack = { from: Point; to: Point; channel: Action['channel'] };
export const mapCenter = (hex: Hex): Point => {
  const { col, row } = hexToOffset(hex);
  return { x: 34 + (col + (row % 2) / 2) * COL_STEP, y: 34 + row * ROW_STEP };
};

/** Choose the neighboring visual image, not a line across the entire world. */
export function visualTarget(from: Hex, to: Hex, width: number, wrap: boolean): Point {
  const start = mapCenter(from), end = mapCenter(to), period = width * COL_STEP;
  return { x: wrap ? end.x + Math.round((start.x - end.x) / period) * period : end.x, y: end.y };
}

const polygon = (x: number, y: number, radius = HEX_RADIUS - 0.4) => Array.from({ length: 6 }, (_, i) => {
  const angle = (60 * i - 90) * Math.PI / 180;
  return `${x + radius * Math.cos(angle)},${y + radius * Math.sin(angle)}`;
}).join(' ');

function Tween({ from, to, children, uid }: { from: Point; to: Point; children: ReactNode; uid?: number }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900), eased = t * t * (3 - 2 * t);
      ref.current?.setAttribute('transform', `translate(${from.x + (to.x - from.x) * eased} ${from.y + (to.y - from.y) * eased})`);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to]);
  return <g ref={ref} transform={`translate(${from.x} ${from.y})`} pointerEvents="none" data-gliding-unit={uid}>{children}</g>;
}

function UnitGlyph({ unit, selected = false, order }: { unit: Unit; selected?: boolean; order?: Action }) {
  const color = PLAYER_COLORS[unit.team];
  return <><circle r={selected ? 16 : 14.2} fill="#172721" stroke={color} strokeWidth={selected ? 2.8 : 1.7} />
    <text y="3.5" textAnchor="middle" className="unit-letter" fill={color}>{PATTERN_BY_ID[unit.type].short}</text>
    {order && <circle cx="11" cy="-10" r="4" fill={CHANNEL_COLORS[order.channel]} />}</>;
}

export function WorldBoard({ game, selected, orders, actions, enemyReach, showReach, toggleReach, onHex, onCity,
  glides, attacks, animationKey, endTurn, endLabel, disabled, message, overlay, holderSide, dialog }: {
  game: GameState; selected?: Unit; orders: Record<number, Action>; actions: Action[];
  enemyReach: Map<string, Action['channel']>; showReach: boolean; toggleReach: () => void;
  onHex: (hex: Hex) => void; onCity: (id: number) => void; glides: Glide[]; attacks: VisualAttack[];
  animationKey: number; endTurn: () => void; endLabel: string; disabled: boolean; message: string;
  overlay: ReactNode; holderSide: number; dialog?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 660 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullError, setFullError] = useState('');
  const drag = useRef<{ x: number; y: number; pan: Point; moved: boolean; hit: Element | null } | null>(null);
  const mapWidth = 68 + (game.width - 0.5) * COL_STEP, mapHeight = 68 + (game.height - 1) * ROW_STEP;
  const fit = Math.min(size.width / mapWidth, size.height / mapHeight), scale = fit * zoom;
  const period = game.width * COL_STEP;
  const tiles = useMemo(() => boardHexes(game.width, game.height), [game.width, game.height]);
  const terrain = game.terrain;
  const territory = useMemo(() => {
    const map = new Map<string, number>();
    game.cityEntities.forEach((city) => city.territory.forEach((hex) => map.set(hexKey(hex), city.owner)));
    return map;
  }, [game.cityEntities]);
  const targets = new Map(actions.filter((a) => a.kind !== 'special').map((a) => [hexKey(a.target), a]));
  const ordered = new Map(Object.values(orders).filter((a) => a.kind === 'move' || a.kind === 'attack').map((a) => [hexKey(a.target), a]));
  const moving = new Set(glides.map((g) => g.unit.uid));

  const reset = () => { setZoom(1); setPan({ x: (size.width - mapWidth * fit) / 2, y: (size.height - mapHeight * fit) / 2 }); };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(reset, [game.width, game.height, size.width, size.height]);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const normalizedPan = (next: Point, nextScale = scale): Point => ({
    x: game.wrap ? next.x - Math.round(next.x / (period * nextScale)) * period * nextScale : next.x,
    y: Math.max(-mapHeight * nextScale + 60, Math.min(size.height - 60, next.y)),
  });
  const zoomAt = (factor: number, anchor: Point = { x: size.width / 2, y: size.height / 2 }) => {
    const next = Math.max(0.65, Math.min(5, zoom * factor)), ratio = next / zoom;
    setPan(normalizedPan({ x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio }, fit * next));
    setZoom(next);
  };
  useEffect(() => {
    const node = viewport.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node!.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    node?.addEventListener('wheel', wheel, { passive: false });
    return () => node?.removeEventListener('wheel', wheel);
  });

  const copies = game.wrap ? Array.from({ length: Math.ceil(size.width / (scale * period)) + 3 }, (_, index) =>
    Math.floor((-pan.x / scale - 34) / period) - 1 + index) : [0];

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === panel.current) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
      setFullError('');
    } catch { setFullError('Fullscreen is blocked by this browser or embed. Open the game in its own tab.'); }
  };
  const centerHome = () => {
    const target = game.cityEntities.find((c) => c.owner === holderSide)?.pos ?? game.units.find((u) => u.alive && u.team === holderSide)?.pos;
    if (target) { const point = mapCenter(target); setPan(normalizedPan({ x: size.width / 2 - point.x * scale, y: size.height / 2 - point.y * scale })); }
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
        <small>{Math.round(zoom * 100)}%</small>
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
        if (Math.hypot(dx, dy) > 5) start.moved = true;
        if (start.moved) { setDragging(true); setPan(normalizedPan({ x: start.pan.x + dx, y: start.pan.y + dy })); }
      }}
      onPointerUp={(event) => {
        const start = drag.current; drag.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!start || start.moved || !start.hit) return;
        const city = start.hit.getAttribute('data-city-id'), uid = start.hit.getAttribute('data-unit-id');
        if (city !== null) onCity(Number(city));
        else if (uid !== null) { const unit = game.units.find((u) => u.uid === Number(uid)); if (unit) onHex(unit.pos); }
        else { const [q, r] = (start.hit.getAttribute('data-hex') || '').split(',').map(Number); if (Number.isFinite(q) && Number.isFinite(r)) onHex({ q, r }); }
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}>
      <svg ref={svg} viewBox={`0 0 ${size.width} ${size.height}`} className="play-board world-svg" aria-label="Wrapping hex game map">
        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`} data-camera="true">
          {copies.map((copy) => <g key={copy} transform={`translate(${copy * period} 0)`} className="world-copy" data-copy={copy}>
            {tiles.map((hex) => {
              const { x, y } = mapCenter(hex), key = hexKey(hex), owner = territory.get(key), mountain = terrain.has(key);
              const action = targets.get(key), reach = enemyReach.get(key), order = ordered.get(key);
              return <g key={key} className="battle-cell" data-hex={key}>
                <polygon points={polygon(x, y)} fill={mountain ? '#344641' : (hex.q + hex.r) % 3 ? '#253530' : '#283936'}
                  stroke={owner !== undefined ? PLAYER_COLORS[owner] : '#405149'} strokeWidth={owner !== undefined ? 1.5 : 0.8} />
                {owner !== undefined && <polygon points={polygon(x, y, HEX_RADIUS - 1.5)} fill={PLAYER_COLORS[owner]} fillOpacity="0.12" />}
                {reach && <polygon points={polygon(x, y, HEX_RADIUS - 4)} fill={CHANNEL_COLORS[reach]} fillOpacity="0.18" stroke={CHANNEL_COLORS[reach]} strokeWidth="0.8" strokeDasharray="3 3" />}
                {action && <polygon points={polygon(x, y, HEX_RADIUS - 3)} fill={CHANNEL_COLORS[action.channel]} fillOpacity="0.62" stroke={CHANNEL_COLORS[action.channel]} />}
                {order && <polygon points={polygon(x, y, HEX_RADIUS - 5)} fill="none" stroke="#f4efe2" strokeWidth="2" strokeDasharray="5 3" />}
                {mountain && <path d={`M${x - 10} ${y + 7} l7 -13 4 7 4 -5 7 11Z`} fill="#809991" opacity=".68" />}
              </g>;
            })}
            {Object.values(orders).filter((order) => order.kind === 'move' || order.kind === 'attack').map((order) => {
              const unit = game.units[order.uid]; if (!unit?.alive) return null;
              const from = mapCenter(unit.pos), to = visualTarget(unit.pos, order.target, game.width, game.wrap);
              return <line key={unit.uid} x1={from.x} y1={from.y} x2={to.x} y2={to.y} pointerEvents="none" data-order-line={unit.uid}
                stroke={order.kind === 'move' ? '#72a88c' : order.channel === 'brown' ? '#e8c56a' : '#d9826c'} strokeWidth="1.5" />;
            })}
            {game.cityEntities.map((city) => {
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
            {game.units.filter((unit) => unit.alive && !moving.has(unit.uid)).map((unit) => {
              const { x, y } = mapCenter(unit.pos);
              return <g key={unit.uid} transform={`translate(${x} ${y})`} className="battle-unit" data-unit-id={unit.uid} data-uid={unit.uid} data-team={unit.team}
                role="button" tabIndex={0} aria-label={`${game.players[unit.team]?.name} ${PATTERN_BY_ID[unit.type].name}`}
                onKeyDown={(event) => { if (event.key === 'Enter') onHex(unit.pos); }}>
                <UnitGlyph unit={unit} selected={selected?.uid === unit.uid} order={orders[unit.uid]} />
              </g>;
            })}
            {glides.map((glide) => <Tween key={`${animationKey}-${glide.unit.uid}`} from={glide.from} to={glide.to} uid={glide.unit.uid}><UnitGlyph unit={glide.unit} /></Tween>)}
            {attacks.map((effect, i) => effect.channel === 'brown'
              ? <Tween key={`shot-${animationKey}-${i}`} from={effect.from} to={effect.to}><circle r="5" fill="#e8c56a" /></Tween>
              : <circle key={`impact-${animationKey}-${i}`} className="impact-ring" cx={effect.to.x} cy={effect.to.y} r="17" fill="none" stroke="#f2c98f" strokeWidth="2.5" pointerEvents="none" />)}
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