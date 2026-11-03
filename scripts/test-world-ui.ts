// Start the Vite dev server first. Install Playwright's Chromium, or set
// CHROMIUM_PATH to a compatible executable; HEXFIELD_TEST_URL overrides 5173.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Locator, type Page } from 'playwright';
import { COL_STEP, mapCenter } from '../src/components/worldGeometry';
import { STUDY_RULES_VERSION } from '../src/sim/batch';
import { patternFingerprint } from '../src/sim/config';
import { offsetToHex } from '../src/sim/patterns';

const baseURL = process.env.HEXFIELD_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const errors: string[] = [];

async function newPage(mobile = false): Promise<Page> {
  const page = await browser.newPage(mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  // Seed 1 puts the first Clash settler next to the east/west seam.
  await page.addInitScript({ content: `(() => {
    const original = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, 'getRandomValues', { value: (values) => {
      if (values instanceof Uint32Array && values.length === 1) { values[0] = 0; return values; }
      return original(values);
    } });
  })();` });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.getByTitle('Play a match').click();
  await page.locator('.world-viewport').waitFor();
  return page;
}

async function visibleInstances(locator: Locator, page: Page): Promise<{ index: number; x: number }[]> {
  const viewport = await page.locator('.world-viewport').boundingBox();
  assert.ok(viewport);
  const visible: { index: number; x: number }[] = [];
  for (let index = 0; index < await locator.count(); index++) {
    const box = await locator.nth(index).boundingBox();
    if (!box) continue;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (x > viewport.x + 3 && x < viewport.x + viewport.width - 3 && y > viewport.y + 3 && y < viewport.y + viewport.height - 3)
      visible.push({ index, x });
  }
  return visible.sort((a, b) => a.x - b.x);
}

async function hotseatRound(page: Page) {
  const end = page.getByRole('button', { name: 'End turn (resolve)' });
  await end.click(); await end.click();
  await end.waitFor({ state: 'visible', timeout: 10000 });
}

try {
  const page = await newPage();
  for (const map of ['duel', 'clash', 'battle', 'war']) {
    await page.getByLabel('Map size').selectOption(map);
    await page.waitForFunction(() => document.querySelectorAll('.battle-cell').length > 0);
    if (map === 'war') assert.ok(await page.locator('.battle-cell').count() < 5000, 'War should not render five full maps');
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement !== null);
    await page.waitForFunction(() => document.querySelectorAll('.battle-cell').length > 0);
    assert.ok(await page.locator('.world-copy').count() <= (map === 'duel' ? 1 : 6));
    if (map === 'war') {
      assert.ok(await page.locator('.battle-cell').count() < 5000, 'fullscreen War stays viewport-limited');
      // Simulate the transient zero-sized layout that used to unmount the app.
      const viewport = page.locator('.world-viewport');
      const style = await viewport.getAttribute('style');
      for (const dimension of ['height', 'width']) {
        await viewport.evaluate((element, dim) => {
          const node = element as HTMLElement;
          if (dim === 'height') node.style.setProperty('flex', '0 0 0px', 'important');
          node.style.setProperty(dim, '0px', 'important');
          node.style.setProperty(`min-${dim}`, '0px', 'important');
        }, dimension);
        await page.waitForFunction((dim) => {
          const node = document.querySelector('.world-viewport') as HTMLElement | null;
          return !!node && (dim === 'height' ? node.clientHeight === 0 : node.clientWidth === 0)
            && document.querySelectorAll('.battle-cell').length === 0;
        }, dimension);
        assert.equal(await page.getByRole('button', { name: 'Exit fullscreen' }).count(), 1, 'app survives a zero viewport');
        await viewport.evaluate((element, previous) => {
          if (previous === null) element.removeAttribute('style'); else element.setAttribute('style', previous);
        }, style);
        await page.waitForFunction(() => document.querySelectorAll('.battle-cell').length > 0);
      }
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement === null);
      await page.setViewportSize({ width: 3200, height: 300 });
      await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('.world-viewport') as HTMLElement)?.clientWidth === 3200);
      assert.ok(await page.locator('.world-copy').count() <= 6, 'extreme aspect ratios remain bounded');
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement === null);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('.world-viewport') as HTMLElement)?.clientWidth === 1920);
      for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
      assert.ok(await page.locator('.battle-cell').count() < 500, 'zooming in renders only nearby tiles');
    }
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement === null);
  }
  await page.close();

  const seam = await newPage();
  await seam.getByRole('button', { name: 'Hotseat' }).click();
  await seam.getByLabel('Map size').selectOption('clash');
  await seam.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await seam.waitForFunction(() => {
    const viewport = document.querySelector('.world-viewport') as HTMLElement | null;
    const svg = document.querySelector('.world-svg') as SVGSVGElement | null;
    return document.fullscreenElement !== null && !!viewport && !!svg
      && Math.abs(svg.viewBox.baseVal.width - viewport.clientWidth) < 1 && Math.abs(svg.viewBox.baseVal.height - viewport.clientHeight) < 1
      && document.querySelectorAll('.battle-unit[data-team="0"]').length >= 2;
  });
  const settler = seam.locator('.battle-unit[data-team="0"]');
  const copies = await visibleInstances(settler, seam);
  assert.ok(copies.length >= 2, `the seam exposes two clickable images of the same unit: ${JSON.stringify(copies)}`);
  await settler.nth(copies[0].index).click();
  assert.equal(await seam.getByRole('button', { name: 'Found a City Here' }).count(), 1);
  await seam.getByRole('button', { name: 'Close special actions' }).click();
  const rightmost = copies[copies.length - 1];
  await settler.nth(rightmost.index).click();
  assert.equal(await seam.getByRole('button', { name: 'Found a City Here' }).count(), 1, 'either seam image selects the same unit');
  const target = seam.locator('.battle-cell[data-hex="-6,12"]'); // column 0, row 12
  const targetCopies = await visibleInstances(target, seam);
  const neighbor = targetCopies.filter((copy) => copy.x > rightmost.x).sort((a, b) => a.x - b.x)[0];
  assert.ok(neighbor, `the neighboring wrapped target is visible: units ${JSON.stringify(copies)}, targets ${JSON.stringify(targetCopies)}`);
  await target.nth(neighbor.index).click();
  const line = seam.locator('[data-order-line="0"]').first();
  await line.waitFor({ state: 'attached' });
  assert.ok(Math.abs(Number(await line.getAttribute('x2')) - Number(await line.getAttribute('x1')) - COL_STEP) < 0.001,
    'an order across the seam takes the short route');
  const end = seam.getByRole('button', { name: 'End turn (resolve)' });
  await end.click(); await end.click();
  await seam.locator('[data-gliding-unit="0"]').first().waitFor({ state: 'attached' });
  // Remove and restore a seam image while the unit is gliding. The restored
  // image must join the existing animation rather than restart from the source.
  await seam.mouse.move(900, 600); await seam.mouse.down(); await seam.mouse.move(1600, 600); await seam.mouse.up();
  await seam.waitForFunction(() => !document.querySelector('[data-copy-objects="-1"]'));
  await seam.mouse.move(1400, 600); await seam.mouse.down(); await seam.mouse.move(700, 600); await seam.mouse.up();
  await seam.waitForFunction(() => !!document.querySelector('[data-copy-objects="-1"] [data-gliding-unit="0"]'));
  await seam.waitForTimeout(40);
  const animationPositions = await seam.locator('[data-gliding-unit="0"]').evaluateAll((nodes) => nodes.map((node) =>
    Number(node.getAttribute('transform')?.match(/translate\(([-\d.]+)/)?.[1])));
  assert.ok(animationPositions.length >= 2 && animationPositions.every((x) => Math.abs(x - animationPositions[0]) < 0.5),
    'seam images share one animation timeline while panning');
  await end.waitFor({ state: 'visible', timeout: 10000 });
  const moved = seam.locator('.battle-unit[data-team="0"]').first();
  const transform = await moved.getAttribute('transform');
  assert.equal(transform, `translate(${mapCenter(offsetToHex(0, 12)).x} ${mapCenter(offsetToHex(0, 12)).y})`,
    'the settler actually moves to the wrapped canonical hex');
  await seam.getByRole('button', { name: 'Center on capital' }).click();
  const centered = await visibleInstances(seam.locator('.battle-unit[data-team="0"]'), seam);
  assert.ok(centered.some(({ x }) => Math.abs(x - 960) < 3), 'centering finds the nearest wrapped image');
  await seam.getByTitle('Show enemy reach').click();
  assert.ok(await seam.locator('.battle-cell polygon[stroke-dasharray="3 3"]').count() > 0, 'reach overlays remain visible');
  const seamViewport = await seam.locator('.world-viewport').boundingBox();
  assert.ok(seamViewport);
  for (let i = 0; i < 4; i++) {
    await seam.mouse.move(seamViewport.x + seamViewport.width / 2, seamViewport.y + seamViewport.height / 2);
    await seam.mouse.down();
    await seam.mouse.move(seamViewport.x + seamViewport.width / 2 + 700, seamViewport.y + seamViewport.height / 2, { steps: 20 });
    await seam.mouse.up();
  }
  assert.ok(await seam.locator('.world-copy').count() <= 6, 'repeated drags do not grow the world');
  await seam.close();

  const cityPage = await newPage();
  await cityPage.getByRole('button', { name: 'Hotseat' }).click();
  await cityPage.locator('.battle-unit[data-team="0"]').first().click();
  await cityPage.getByRole('button', { name: 'Found a City Here' }).click();
  await cityPage.getByRole('button', { name: 'End turn (resolve)' }).click();
  await cityPage.locator('.battle-unit[data-team="1"]').first().click();
  await cityPage.getByRole('button', { name: 'Found a City Here' }).click();
  await cityPage.getByRole('button', { name: 'End turn (resolve)' }).click();
  await cityPage.getByRole('button', { name: 'End turn (resolve)' }).waitFor({ state: 'visible', timeout: 10000 });
  const city = cityPage.locator('.city-marker[aria-label^="Manage Rome"]');
  await city.click();
  assert.equal(await cityPage.locator('[data-production-progress]').innerText(), '0 / 5', 'new city begins empty');
  await cityPage.getByLabel('City production').selectOption('sniper');
  assert.equal(await cityPage.locator('.city-prod-select option[value="melee1"]').innerText(), 'Melee I', 'default project has no saved production');
  assert.equal(await cityPage.getByText('PAUSED PROJECTS').count(), 0);
  await cityPage.getByRole('button', { name: 'Close city menu' }).click();
  await hotseatRound(cityPage);
  await city.click();
  assert.equal(await cityPage.locator('[data-production-progress]').innerText(), '2 / 5', 'production starts next turn');
  await cityPage.getByRole('button', { name: 'Close city menu' }).click();
  await hotseatRound(cityPage); await hotseatRound(cityPage);
  const unit = cityPage.locator('.battle-unit[data-team="0"]');
  await unit.waitFor();
  assert.equal(await unit.locator('circle').first().getAttribute('r'), '11.5');
  await unit.click();
  assert.equal(await unit.locator('circle').first().getAttribute('r'), '12.5');
  const point = await city.evaluate((element) => {
    const matrix = (element as SVGGraphicsElement).getScreenCTM()!;
    const p = new DOMPoint(0, -16).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  });
  await cityPage.mouse.click(point.x, point.y);
  assert.equal(await cityPage.getByRole('region', { name: 'City management' }).count(), 1,
    'the city ring remains clickable beneath a selected unit');
  await cityPage.getByRole('button', { name: 'Close city menu' }).click();
  await unit.click();
  await cityPage.getByRole('button', { name: 'Hold selected' }).click();
  assert.equal(await unit.locator('circle').last().getAttribute('pointer-events'), 'none');
  const dotEdge = await city.evaluate((element) => {
    const matrix = (element as SVGGraphicsElement).getScreenCTM()!;
    const p = new DOMPoint(10.5, -9.3).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  });
  await cityPage.mouse.click(dotEdge.x, dotEdge.y);
  assert.equal(await cityPage.getByRole('region', { name: 'City management' }).count(), 1,
    'the order indicator does not steal city clicks');
  await cityPage.close();

  const mobile = await newPage(true);
  for (const map of ['duel', 'clash', 'battle', 'war']) {
    await mobile.getByLabel('Map size').selectOption(map);
    await mobile.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await mobile.waitForFunction(() => document.fullscreenElement !== null && document.querySelectorAll('.battle-cell').length > 0);
    assert.ok(await mobile.locator('.world-copy').count() <= (map === 'duel' ? 1 : 6), 'mobile fullscreen stays bounded');
    if (map !== 'war') {
      await mobile.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await mobile.waitForFunction(() => document.fullscreenElement === null);
    }
  }
  const mobileViewport = await mobile.locator('.world-viewport').boundingBox();
  assert.ok(mobileViewport);
  const camera = mobile.locator('[data-camera]'), beforeTouch = await camera.getAttribute('transform');
  const cdp = await mobile.context().newCDPSession(mobile);
  const x = mobileViewport.x + mobileViewport.width * 0.25, y = mobileViewport.y + mobileViewport.height * 0.5;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 160, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForFunction((previous) => document.querySelector('[data-camera]')?.getAttribute('transform') !== previous, beforeTouch);
  await mobile.getByRole('button', { name: 'Center on capital' }).click();
  const mobileSettler = mobile.locator('.battle-unit[data-team="0"]');
  const mobileCopies = await visibleInstances(mobileSettler, mobile);
  assert.ok(mobileCopies.length > 0);
  const mobileUnitBox = await mobileSettler.nth(mobileCopies[0].index).boundingBox();
  assert.ok(mobileUnitBox);
  await mobile.touchscreen.tap(mobileUnitBox.x + mobileUnitBox.width / 2, mobileUnitBox.y + mobileUnitBox.height / 2);
  assert.equal(await mobile.getByRole('button', { name: 'Found a City Here' }).count(), 1, 'touch still selects units after panning');
  await mobile.close();

  // A rules change must mark old results as historical without resetting the
  // separately stored AI weights. New results under the same geometry remain current.
  const oldStudy = JSON.parse(await readFile(new URL('../src/data/baseline.json', import.meta.url), 'utf8'));
  oldStudy.learning.patternFingerprint = patternFingerprint();
  oldStudy.learning.profileDeltas = { sniper: { caution: 0.2 } };
  const currentStudy = structuredClone(oldStudy);
  currentStudy.studyRulesVersion = STUDY_RULES_VERSION;
  currentStudy.settings.seed++;
  const studies = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  studies.on('pageerror', (error) => errors.push(error.stack || error.message));
  await studies.addInitScript({ content: `
    localStorage.setItem('hexfield-runs-v2', ${JSON.stringify(JSON.stringify([currentStudy, oldStudy]))});
    localStorage.setItem('hexfield-learning-v2', ${JSON.stringify(JSON.stringify(oldStudy.learning))});
  ` });
  await studies.goto(baseURL, { waitUntil: 'domcontentloaded' });
  const history = studies.getByRole('button', { name: 'Run history' });
  await history.click();
  await studies.getByRole('button', { name: /Run 02/ }).click();
  assert.match(await studies.locator('.study-id .micro-label').innerText(), /SELECTED STUDY/);
  await history.click();
  await studies.getByRole('button', { name: /Run 01/ }).click();
  assert.match(await studies.locator('.study-id .micro-label').innerText(), /HISTORICAL RULES/);
  const savedWeights = await studies.evaluate(() => JSON.parse(localStorage.getItem('hexfield-learning-v2') || '{}').profileDeltas);
  assert.deepEqual(savedWeights, { sniper: { caution: 0.2 } }, 'learned weights remain saved');
  await studies.close();

  assert.deepEqual(errors, [], `unexpected browser errors: ${errors.join('\n')}`);
  console.log('World UI checks passed: desktop/mobile fullscreen, zero sizes, culling, seams, production, city hit targets and study history.');
} finally {
  await browser.close();
}
