import assert from 'node:assert/strict';
import {
  cameraMetrics, COL_STEP, HEX_RADIUS, MAX_VISIBLE_WORLDS, MAX_WRAP_COPIES, mapCenter, visibleWorldSections, visualTarget,
} from '../src/components/worldGeometry';
import { MAP_CONFIGS, offsetToHex } from '../src/sim/patterns';

// Fullscreen can transiently produce a zero-sized viewport. It must neither
// create an infinite copy count nor prevent rendering when dimensions return.
for (const size of [{ width: 0, height: 800 }, { width: 1600, height: 0 }, { width: 0, height: 0 }]) {
  const camera = cameraMetrics(size, 50, 38, true, 1);
  assert.equal(camera.scale, 0);
  assert.deepEqual(visibleWorldSections(size, { x: 0, y: 0 }, camera.scale, 50, 38, true), []);
}
assert.deepEqual(visibleWorldSections({ width: 1600, height: 900 }, { x: 0, y: 0 }, Infinity, 50, 38, true), []);
assert.deepEqual(visibleWorldSections({ width: 1600, height: 900 }, { x: 0, y: 0 }, 0, 50, 38, true), []);
assert.ok(visibleWorldSections({ width: 1600, height: 900 }, { x: 0, y: 0 }, 1e-8, 50, 38, true).length <= MAX_WRAP_COPIES,
  'even an invalidly tiny positive scale cannot allocate unlimited copies');

const viewports = [
  { width: 1630, height: 734 }, { width: 1920, height: 988 },
  { width: 390, height: 365 }, { width: 4800, height: 160 },
];
for (const map of Object.values(MAP_CONFIGS)) {
  for (const size of viewports) for (const zoom of [0.65, 1, 2, 5]) {
    const camera = cameraMetrics(size, map.width, map.height, map.wrap, zoom);
    assert.ok(camera.scale > 0 && Number.isFinite(camera.scale));
    if (map.wrap) assert.ok(size.width / (camera.scale * camera.period) <= MAX_VISIBLE_WORLDS + 1e-9);
    for (const panFactor of [-10.45, -0.51, -0.01, 0.49, 10.45]) {
      for (const vertical of [0, -camera.mapHeight * camera.scale / 2, size.height - 30]) {
        const pan = { x: panFactor * camera.period * camera.scale, y: vertical };
        const sections = visibleWorldSections(size, pan, camera.scale, map.width, map.height, map.wrap);
        assert.ok(sections.length <= (map.wrap ? MAX_WRAP_COPIES : 1), 'copy count stays bounded');
        if (!map.wrap) assert.ok(sections.every((section) => section.copy === 0), 'Duel never repeats');
        for (let row = 0; row < map.height; row++) for (let col = 0; col < map.width; col++) {
          const center = mapCenter(offsetToHex(col, row));
          const y = pan.y + center.y * camera.scale;
          if (y + HEX_RADIUS * camera.scale < 0 || y - HEX_RADIUS * camera.scale > size.height) continue;
          const first = map.wrap ? Math.ceil((-pan.x / camera.scale - COL_STEP / 2 - center.x) / camera.period) : 0;
          const last = map.wrap ? Math.floor(((size.width - pan.x) / camera.scale + COL_STEP / 2 - center.x) / camera.period) : 0;
          for (let copy = first; copy <= last; copy++) {
            const x = pan.x + (center.x + copy * camera.period) * camera.scale;
            if (x + COL_STEP / 2 * camera.scale < 0 || x - COL_STEP / 2 * camera.scale > size.width) continue;
            assert.ok(sections.some((section) => section.copy === copy && col >= section.firstCol && col <= section.lastCol
              && row >= section.firstRow && row <= section.lastRow),
            `${map.key}: visible tile ${col},${row} in copy ${copy} is missing at zoom ${zoom}, pan ${panFactor}`);
          }
        }
      }
    }
  }
}

for (const row of [6, 7]) {
  const west = offsetToHex(0, row), east = offsetToHex(31, row);
  assert.ok(Math.abs(visualTarget(east, west, 32, true).x - mapCenter(east).x - COL_STEP) < 0.001);
  assert.ok(Math.abs(visualTarget(west, east, 32, true).x - mapCenter(west).x + COL_STEP) < 0.001);
  assert.ok(Math.abs(visualTarget(east, west, 32, false).x - mapCenter(east).x) > COL_STEP * 20);
}
console.log('World geometry checks passed: bounded copies, zero sizes, visible tiles, and both seam directions.');
