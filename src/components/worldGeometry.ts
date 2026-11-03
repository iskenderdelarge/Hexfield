import { hexToOffset, type Hex } from '../sim/patterns';

export const HEX_RADIUS = 22;
export const COL_STEP = HEX_RADIUS * Math.sqrt(3);
export const ROW_STEP = HEX_RADIUS * 1.5;
export const MAP_ORIGIN = 34;
export const MIN_ZOOM = 0.65;
export const MAX_ZOOM = 5;
// A very wide or temporarily short viewport must not request unlimited worlds.
export const MAX_VISIBLE_WORLDS = 3;
export const MAX_WRAP_COPIES = MAX_VISIBLE_WORLDS + 3;
const EFFECT_MARGIN = 5 * COL_STEP; // Markers and the longest order/animation can extend past a seam.

export type Point = { x: number; y: number };
export type ViewportSize = { width: number; height: number };
export type VisibleSection = {
  copy: number;
  firstCol: number;
  lastCol: number;
  firstRow: number;
  lastRow: number;
};

export function mapCenter(hex: Hex): Point {
  const { col, row } = hexToOffset(hex);
  return { x: MAP_ORIGIN + (col + (row % 2) / 2) * COL_STEP, y: MAP_ORIGIN + row * ROW_STEP };
}

/** Choose the neighboring visual image, not a line across the entire world. */
export function visualTarget(from: Hex, to: Hex, width: number, wrap: boolean): Point {
  const start = mapCenter(from), end = mapCenter(to), period = width * COL_STEP;
  return { x: wrap ? end.x + Math.round((start.x - end.x) / period) * period : end.x, y: end.y };
}

export function cameraMetrics(size: ViewportSize, width: number, height: number, wrap: boolean, zoom: number) {
  const mapWidth = 2 * MAP_ORIGIN + (width - 0.5) * COL_STEP;
  const mapHeight = 2 * MAP_ORIGIN + (height - 1) * ROW_STEP;
  const period = width * COL_STEP;
  const empty = { mapWidth, mapHeight, period, fit: 0, minZoom: MIN_ZOOM, scale: 0 };
  if (![size.width, size.height, width, height, zoom, mapWidth, mapHeight, period].every(Number.isFinite)
    || size.width <= 0 || size.height <= 0 || width <= 0 || height <= 0 || zoom <= 0) return empty;

  const fit = Math.min(size.width / mapWidth, size.height / mapHeight);
  const minZoom = wrap ? Math.max(MIN_ZOOM, size.width / (MAX_VISIBLE_WORLDS * period) / fit) : MIN_ZOOM;
  const scale = fit * Math.max(zoom, minZoom);
  if (!Number.isFinite(fit) || fit <= 0 || !Number.isFinite(minZoom) || !Number.isFinite(scale) || scale <= 0) return empty;
  return { mapWidth, mapHeight, period, fit, minZoom, scale };
}

/** Visible tile ranges for a finite set of seam images, including effect padding. */
export function visibleWorldSections(size: ViewportSize, pan: Point, scale: number, width: number, height: number, wrap: boolean): VisibleSection[] {
  if (![size.width, size.height, pan.x, pan.y, scale, width, height].every(Number.isFinite)
    || size.width <= 0 || size.height <= 0 || scale <= 0 || width <= 0 || height <= 0) return [];
  const period = width * COL_STEP;
  const left = -pan.x / scale, right = (size.width - pan.x) / scale;
  const top = -pan.y / scale, bottom = (size.height - pan.y) / scale;
  if (![period, left, right, top, bottom].every(Number.isFinite)) return [];

  // Copies are translations for the visible seam and nearby effects. Each
  // renders only its visible tile range, and their number is always bounded.
  let firstCopy = wrap ? Math.ceil((left - EFFECT_MARGIN - MAP_ORIGIN - period) / period) : 0;
  let lastCopy = wrap ? Math.floor((right + EFFECT_MARGIN - MAP_ORIGIN + COL_STEP / 2) / period) : 0;
  if (!Number.isSafeInteger(firstCopy) || !Number.isSafeInteger(lastCopy)) return [];
  if (lastCopy - firstCopy + 1 > MAX_WRAP_COPIES) {
    const middle = Math.floor((left + (right - left) / 2 - MAP_ORIGIN) / period);
    if (!Number.isSafeInteger(middle)) return [];
    firstCopy = middle - Math.floor(MAX_WRAP_COPIES / 2);
    lastCopy = firstCopy + MAX_WRAP_COPIES - 1;
  }

  const firstRow = Math.max(0, Math.floor((top - MAP_ORIGIN - HEX_RADIUS) / ROW_STEP));
  const lastRow = Math.min(height - 1, Math.ceil((bottom - MAP_ORIGIN + HEX_RADIUS) / ROW_STEP));
  const sections: VisibleSection[] = [];
  for (let copy = firstCopy; copy <= lastCopy; copy++) {
    const firstCol = Math.max(0, Math.floor((left - MAP_ORIGIN - copy * period) / COL_STEP - 1));
    const lastCol = Math.min(width - 1, Math.ceil((right - MAP_ORIGIN - copy * period) / COL_STEP + 1));
    sections.push({ copy, firstCol, lastCol, firstRow, lastRow });
  }
  return sections;
}
