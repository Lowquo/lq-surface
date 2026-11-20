import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { geometry, openFixture } from './support';

/**
 * Component-level tests on a fixture page that loads the built
 * @lowquo/surface-controls package directly (see openFixture).
 */
type FixtureWindow = Window & {
  log: string[];
  create(options?: Record<string, unknown>): void;
  ball: { dispose(): void; isInteracting(): boolean; getPose(): { x: number; y: number; z: number }; setPose(p: object, notify?: boolean): void };
  lifecycle: { mqAdd: number; mqRemove: number; roDisconnect: number };
  gl?: WebGL2RenderingContext;
};

const surface = (page: Page) => page.locator('#root .lq-trackball');
const log = (page: Page): Promise<string[]> => page.evaluate(() => [...(window as unknown as FixtureWindow).log]);
const run = (page: Page, script: (w: FixtureWindow) => unknown): Promise<unknown> =>
  page.evaluate(`(${script.toString()})(window)`);

/** Balanced: starts and ends alternate, beginning with a start. */
function expectAlternating(entries: string[]): void {
  const boundaries = entries.filter((e) => e === 'start' || e === 'end');
  boundaries.forEach((entry, i) => expect(entry, `boundary #${i}`).toBe(i % 2 === 0 ? 'start' : 'end'));
  expect(boundaries.length % 2, 'every start has an end').toBe(0);
}

async function create(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate((o) => (window as unknown as FixtureWindow).create(o), options);
  await expect(surface(page)).toHaveAttribute('data-renderer', 'webgl');
}

async function startDrag(page: Page): Promise<{ cx: number; cy: number }> {
  const g = await geometry(surface(page));
  await page.mouse.move(g.cx, g.cy);
  await page.mouse.down();
  await page.mouse.move(g.cx + 12, g.cy + 6, { steps: 2 });
  await expect.poll(() => log(page)).toContain('start');
  return g;
}

test.describe('lifecycle and gesture balance', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const counts = { mqAdd: 0, mqRemove: 0, roDisconnect: 0 };
      (window as unknown as { lifecycle: typeof counts }).lifecycle = counts;
      const proto = MediaQueryList.prototype;
      const add = proto.addEventListener;
      const remove = proto.removeEventListener;
      proto.addEventListener = function (this: MediaQueryList, type: string, ...rest: unknown[]) {
        if (type === 'change') counts.mqAdd += 1;
        return (add as (...a: unknown[]) => void).call(this, type, ...rest);
      } as typeof add;
      proto.removeEventListener = function (this: MediaQueryList, type: string, ...rest: unknown[]) {
        if (type === 'change') counts.mqRemove += 1;
        return (remove as (...a: unknown[]) => void).call(this, type, ...rest);
      } as typeof remove;
      const disconnect = ResizeObserver.prototype.disconnect;
      ResizeObserver.prototype.disconnect = function (this: ResizeObserver) {
        counts.roDisconnect += 1;
        return disconnect.call(this);
      };
    });
    await openFixture(page);
  });

  test('dispose removes everything, restores nothing because nothing was mutated, and is idempotent', async ({ page }) => {
    const styleBefore = await page.locator('#root').getAttribute('style');
    await create(page);
    expect(await page.locator('#root').getAttribute('style'), 'root styles untouched').toBe(styleBefore);
    await expect(page.locator('#root > *')).toHaveCount(2);
    await run(page, (w) => { w.gl = document.querySelector<HTMLCanvasElement>('#root canvas')!.getContext('webgl2')!; });
    const listening = await run(page, (w) => w.lifecycle.mqAdd - w.lifecycle.mqRemove);
    expect(listening, 'resolution listener armed').toBe(1);

    await run(page, (w) => { w.ball.dispose(); w.ball.dispose(); });
    await expect(page.locator('#root > *')).toHaveCount(0);
    expect(await page.locator('#root').getAttribute('style')).toBe(styleBefore);
    expect(await run(page, (w) => w.lifecycle.mqAdd - w.lifecycle.mqRemove), 'resolution listener removed').toBe(0);
    expect(await run(page, (w) => w.lifecycle.roDisconnect)).toBe(1);
    expect(await run(page, (w) => w.gl!.isContextLost()), 'GPU context released').toBe(true);
    expect(await log(page)).toEqual([]);
    await run(page, (w) => w.ball.setPose({ x: 0.5, y: 0, z: 0.5 }, true)); // harmless after dispose
    expect(await log(page)).toEqual([]);
  });

  test('a new Trackball works in the same root after dispose', async ({ page }) => {
    await create(page);
    await run(page, (w) => w.ball.dispose());
    await create(page);
    await expect(page.locator('#root > *')).toHaveCount(2);
    await surface(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => log(page)).toEqual(['start', 'change:0.0200,0.0000,0.5000']);
  });

  test('dispose during a drag ends the gesture exactly once', async ({ page }) => {
    await create(page);
    const g = await startDrag(page);
    await run(page, (w) => w.ball.dispose());
    const atDispose = await log(page);
    expect(atDispose.at(-1)).toBe('end');
    await page.mouse.move(g.cx + 60, g.cy + 60, { steps: 2 });
    await page.mouse.up();
    expect(await log(page)).toEqual(atDispose);
    expectAlternating(atDispose);
  });

  test('dispose during a keyboard gesture ends it and cancels the idle timer', async ({ page }) => {
    await create(page);
    await surface(page).focus();
    await page.keyboard.press('ArrowRight');
    expect(await run(page, (w) => w.ball.isInteracting())).toBe(true);
    await run(page, (w) => w.ball.dispose());
    expect(await log(page)).toEqual(['start', 'change:0.0200,0.0000,0.5000', 'end']);
    await page.waitForTimeout(600); // longer than the 400 ms idle timeout
    expect(await log(page)).toEqual(['start', 'change:0.0200,0.0000,0.5000', 'end']);
  });

  test('lost pointer capture and window blur end a drag once', async ({ page }) => {
    await create(page);
    let g = await startDrag(page);
    await surface(page).evaluate((el) => el.releasePointerCapture((window as unknown as { lastPointerId: number }).lastPointerId));
    // lostpointercapture is dispatched before the pointer's next event.
    await page.mouse.move(g.cx + 13, g.cy + 6);
    await expect.poll(async () => (await log(page)).at(-1)).toBe('end');
    const afterLoss = await log(page);
    await page.mouse.move(g.cx + 40, g.cy + 6, { steps: 2 });
    await page.mouse.up();
    expect(await log(page)).toEqual(afterLoss);
    expectAlternating(afterLoss);

    g = await startDrag(page);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const afterBlur = await log(page);
    expect(afterBlur.at(-1)).toBe('end');
    await page.mouse.move(g.cx + 80, g.cy, { steps: 2 });
    await page.mouse.up();
    expect(await log(page)).toEqual(afterBlur);
    expectAlternating(afterBlur);
  });

  test('a keyboard gesture interrupted by a drag never overlaps', async ({ page }) => {
    await create(page);
    await surface(page).focus();
    await page.keyboard.press('ArrowRight');
    const g = await geometry(surface(page));
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.down();
    expect(await log(page)).toEqual(['start', 'change:0.0200,0.0000,0.5000', 'end', 'start']);
    await page.mouse.up();
    expect((await log(page)).at(-1)).toBe('end');
    expectAlternating(await log(page));
  });

  test('isInteracting covers drags and coalesced keyboard gestures', async ({ page }) => {
    await create(page);
    const interacting = (): Promise<unknown> => run(page, (w) => w.ball.isInteracting());
    expect(await interacting()).toBe(false);
    await startDrag(page);
    expect(await interacting()).toBe(true);
    await page.mouse.up();
    expect(await interacting()).toBe(false);
    await page.keyboard.press('PageUp');
    expect(await interacting()).toBe(true);
    await expect.poll(interacting).toBe(false); // ends after 400 ms idle
    expectAlternating(await log(page));
  });

  test('setPose from the host never notifies; notify = true does', async ({ page }) => {
    await create(page);
    await run(page, (w) => w.ball.setPose({ x: 0.3, y: -0.2, z: 0.7 }));
    expect(await log(page)).toEqual([]);
    expect(await run(page, (w) => w.ball.getPose())).toEqual({ x: 0.3, y: -0.2, z: 0.7 });
    await run(page, (w) => w.ball.setPose({ x: 0.1, y: 0, z: 0.5 }, true));
    expect(await log(page)).toEqual(['change:0.1000,0.0000,0.5000']);
    await expect(page.locator('[aria-live="polite"]')).toHaveText(''); // host changes are not announced
  });

  test('wheel: false leaves page scrolling alone; the default captures it', async ({ page }) => {
    await create(page, { wheel: false });
    const g = await geometry(surface(page));
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await log(page)).toEqual([]);

    await run(page, (w) => { w.ball.dispose(); window.scrollTo(0, 0); w.log.length = 0; });
    await create(page);
    const h = await geometry(surface(page));
    await page.mouse.move(h.cx, h.cy);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => log(page)).toEqual(['start', 'change:0.0000,0.0000,0.5250']);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('pointercancel ends a touch drag once', async ({ page }) => {
    await openFixture(page);
    await create(page);
    const g = await geometry(surface(page));
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchCancel' || type === 'touchEnd' ? [] : [{ x, y }],
    });
    await touch('touchStart', g.cx, g.cy);
    await touch('touchMove', g.cx + 10, g.cy + 5);
    await touch('touchMove', g.cx + 20, g.cy + 10);
    await expect.poll(() => log(page)).toContain('start');
    await touch('touchCancel', 0, 0);
    await expect.poll(async () => (await log(page)).at(-1)).toBe('end');
    const entries = await log(page);
    expect(entries.filter((e) => e.startsWith('change')).length).toBeGreaterThan(0);
    expectAlternating(entries);
  });
});
