import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  emitHostState, expectBalanced, expectMarkerAt, expectPose, flushTasks, geometry, installJuceMock,
  nativeCalls, nativeStore, openPlayground, waitForHost,
} from './support';
import type { NativeCall } from './support';

const ALL_ONCE = { surface_x: 1, surface_y: 1, surface_z: 1 };
const count = (calls: NativeCall[], name: string): number => calls.filter((c) => c.name === name).length;
/** setParameter calls per axis. The adapter only sends axes that changed, and coalesces queued values. */
const setsFor = (calls: NativeCall[], id: string): NativeCall[] =>
  calls.filter((c) => c.name === 'surfaceSetParameter' && c.params[0] === id);
/**
 * An axis the user did not touch never changes value on the host. By contract the first change
 * of each gesture sends all three axes (a snapshot), and later changes only the axes that moved,
 * so an untouched axis is written at most once per gesture, always with its unchanged value.
 */
const expectUntouched = (calls: NativeCall[], id: string, value: number, gestures = 1): void => {
  const sets = setsFor(calls, id);
  expect(sets.length, `${id} writes`).toBeLessThanOrEqual(gestures);
  for (const set of sets) expect(set.params[1], `${id} value`).toBeCloseTo(value, 9);
};

/**
 * Waits until every opened gesture is closed AND no native call has arrived for longer than the
 * 400 ms discrete-gesture idle window, then returns the calls. A gesture that never closes makes
 * this time out, so leaks still fail. Unlike settledCalls() it does not assume how many gestures a
 * burst of real input events produces: on a slow runner, events can legitimately be > 400 ms apart.
 */
async function quietCalls(page: Page): Promise<NativeCall[]> {
  let previous = -1;
  await expect.poll(async () => {
    const calls = await nativeCalls(page);
    const open = count(calls, 'surfaceBeginGesture') - count(calls, 'surfaceEndGesture');
    const quiet = calls.length === previous;
    previous = calls.length;
    return open === 0 && quiet;
  }, { message: 'all gestures closed and no new native calls', intervals: [600], timeout: 20_000 }).toBe(true);
  await flushTasks(page);
  return nativeCalls(page);
}

/** Gestures per axis; every gesture must cover all three axes, and the count is returned. */
function gesturesOf(calls: NativeCall[]): number {
  const g = expectBalanced(calls);
  expect(g.surface_y, 'y gestures').toBe(g.surface_x);
  expect(g.surface_z, 'z gestures').toBe(g.surface_x);
  return g.surface_x ?? 0;
}

/** Waits for every opened gesture to be closed by the host side of the bridge. */
async function settledCalls(page: Page, ends: number): Promise<NativeCall[]> {
  await expect.poll(async () => count(await nativeCalls(page), 'surfaceEndGesture'), { message: 'gesture ends' }).toBe(ends);
  await flushTasks(page);
  return nativeCalls(page);
}

test.describe('host gestures through a mocked JUCE backend', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installJuceMock);
    await openPlayground(page);
    await waitForHost(page);
  });

  test('pointer drag is one balanced gesture across all three parameters', async ({ page }) => {
    const ball = page.locator('.lq-trackball');
    const g = await geometry(ball);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.down();
    await page.mouse.move(g.cx + 30, g.cy - 12, { steps: 6 });
    await page.mouse.up();
    const calls = await settledCalls(page, 3);
    expect(expectBalanced(calls)).toEqual(ALL_ONCE);
    expect(calls.slice(0, 3).map((c) => c.name)).toEqual(Array(3).fill('surfaceBeginGesture'));
    expect(calls.slice(-3).map((c) => c.name)).toEqual(Array(3).fill('surfaceEndGesture'));
    // x and y moved, z did not: z never changes on the host.
    expect(setsFor(calls, 'surface_x').length).toBeGreaterThanOrEqual(1);
    expect(setsFor(calls, 'surface_y').length).toBeGreaterThanOrEqual(1);
    expectUntouched(calls, 'surface_z', 0.5);
    // At most one write per axis per pointer move.
    expect(setsFor(calls, 'surface_x').length).toBeLessThanOrEqual(6);
  });

  test('a synchronous key burst and a synchronous wheel burst are each exactly one gesture', async ({ page }) => {
    // Dispatched within one task, so the events are guaranteed to fall inside the 400 ms idle
    // window regardless of runner speed. This is the strict coalescing check.
    const ball = page.locator('.lq-trackball');
    await ball.focus();
    await ball.evaluate((el) => {
      for (let i = 0; i < 12; i += 1) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    let calls = await quietCalls(page);
    expect(expectBalanced(calls)).toEqual(ALL_ONCE);
    const lastX = setsFor(calls, 'surface_x').at(-1)!;
    expect(lastX.params[1]).toBeCloseTo((12 * 0.02 + 1) / 2, 6);

    await ball.evaluate((el) => {
      for (let i = 0; i < 6; i += 1) el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true }));
    });
    calls = await quietCalls(page);
    expect(expectBalanced(calls)).toEqual({ surface_x: 2, surface_y: 2, surface_z: 2 });
  });

  test('a held arrow key and a wheel burst (real input) stay balanced and coalesced', async ({ page }) => {
    // Real CDP input. Each burst normally forms one gesture, but a loaded runner can space events
    // more than 400 ms apart, which correctly yields more. Never more gestures than inputs.
    await page.locator('.lq-trackball').focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.down('ArrowRight'); // auto-repeat
    await page.keyboard.up('ArrowRight');
    let calls = await quietCalls(page);
    const keyGestures = gesturesOf(calls);
    expect(keyGestures).toBeGreaterThanOrEqual(1);
    expect(keyGestures).toBeLessThanOrEqual(12);
    // Only x changed; queued writes may coalesce, but never exceed one per key press.
    expect(setsFor(calls, 'surface_x').length).toBeGreaterThanOrEqual(1);
    expect(setsFor(calls, 'surface_x').length).toBeLessThanOrEqual(12);
    expectUntouched(calls, 'surface_y', 0.5, keyGestures);
    expectUntouched(calls, 'surface_z', 0.5, keyGestures);
    const lastX = calls.filter((c) => c.name === 'surfaceSetParameter' && c.params[0] === 'surface_x').at(-1)!;
    expect(lastX.params[1]).toBeCloseTo((12 * 0.02 + 1) / 2, 6);

    const g = await geometry(page.locator('.lq-trackball'));
    await page.mouse.move(g.cx, g.cy);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -40);
    calls = await quietCalls(page);
    const wheelGestures = gesturesOf(calls) - keyGestures;
    expect(wheelGestures).toBeGreaterThanOrEqual(1);
    expect(wheelGestures).toBeLessThanOrEqual(6);
  });

  test('a keyboard gesture interrupted by a drag never overlaps', async ({ page }) => {
    const ball = page.locator('.lq-trackball');
    await ball.focus();
    await page.keyboard.press('ArrowRight');
    const g = await geometry(ball);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.down(); // within the 400 ms idle window
    await page.mouse.move(g.cx + 10, g.cy, { steps: 2 });
    await page.mouse.up();
    const calls = await settledCalls(page, 6);
    expect(expectBalanced(calls)).toEqual({ surface_x: 2, surface_y: 2, surface_z: 2 });
  });

  test('range sliders: keyboard bursts coalesce, a pointer drag is one gesture', async ({ page }) => {
    await page.locator('#z').focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
    // Normally one gesture; a loaded runner may space the presses > 400 ms apart (see quietCalls).
    let calls = await quietCalls(page);
    const keyGestures = gesturesOf(calls);
    expect(keyGestures).toBeGreaterThanOrEqual(1);
    expect(keyGestures).toBeLessThanOrEqual(8);
    expect(setsFor(calls, 'surface_z').length).toBeGreaterThanOrEqual(1);
    expect(setsFor(calls, 'surface_z').length).toBeLessThanOrEqual(8);
    expectUntouched(calls, 'surface_x', 0.5, keyGestures);
    expectUntouched(calls, 'surface_y', 0.5, keyGestures);
    expect((await nativeStore(page)).z).toBeCloseTo(Number(await page.locator('#z').inputValue()), 6);

    await page.locator('#x').scrollIntoViewIfNeeded();
    const box = (await page.locator('#x').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    calls = await quietCalls(page);
    expect(gesturesOf(calls), 'a pointer drag is exactly one gesture').toBe(keyGestures + 1);

    await page.locator('#reset').click();
    calls = await quietCalls(page);
    expect(gesturesOf(calls), 'reset is exactly one gesture').toBe(keyGestures + 2);
  });

  test('host state updates the UI and is never echoed back', async ({ page }) => {
    await flushTasks(page);
    const before = (await nativeCalls(page)).length;
    await emitHostState(page, { x: 0.75, y: 0.25, z: 0.9 });
    await expectPose(page, { x: 0.5, y: -0.5, z: 0.9 });
    await expect(page.locator('#x')).toHaveValue('0.5');
    const ball = page.locator('.lq-trackball');
    await expectMarkerAt(page, ball, { x: 0.5, y: -0.5, z: 0.9 });
    await flushTasks(page);
    expect((await nativeCalls(page)).length, 'no echo calls').toBe(before);

    // The next user action starts from the host value, and its gesture comes first.
    await ball.focus();
    await page.keyboard.press('ArrowRight');
    const calls = await settledCalls(page, 3);
    const fresh = calls.slice(before);
    expect(fresh[0].name).toBe('surfaceBeginGesture');
    expectBalanced(fresh);
    const x = fresh.find((c) => c.name === 'surfaceSetParameter' && c.params[0] === 'surface_x')!;
    expect(x.params[1]).toBeCloseTo((0.5 + 0.02 + 1) / 2, 6);
  });

  test('host state is deferred during a drag, then the UI resyncs to the host', async ({ page }) => {
    const ball = page.locator('.lq-trackball');
    const g = await geometry(ball);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.down();
    await page.mouse.move(g.cx + 20, g.cy, { steps: 2 });
    await expectPose(page, { x: 20 / g.travel, y: 0 });
    await emitHostState(page, { x: 0.25, y: 0.75, z: 0.2 });
    await flushTasks(page);
    await expectPose(page, { x: 20 / g.travel, y: 0, z: 0.5 }); // not moved under the pointer
    await page.mouse.up();
    await expectPose(page, { x: -0.5, y: 0.5, z: 0.2 }); // applied after the gesture

    // Host writes mid-gesture: the user's later writes win for the axes they touch (y), and the
    // host's value stands for axes the user did not touch (x, z). After the gesture the UI pulls
    // surfaceGetState, so it shows exactly what the host holds (host state is authoritative).
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.down();
    await page.mouse.move(g.cx, g.cy - 10, { steps: 2 });
    await emitHostState(page, { x: 0.9, y: 0.9, z: 0.9 });
    await expectPose(page, { x: -0.5, y: 0.5 - 10 / g.travel, z: 0.2 }); // still not moved under the pointer
    await page.mouse.move(g.cx, g.cy - 20, { steps: 2 });
    await page.mouse.up();
    await expectPose(page, { x: 0.8, y: 0.5 - 20 / g.travel, z: 0.9 });
    const store = await nativeStore(page);
    expect(store.y).toBeCloseTo((0.5 - 20 / g.travel + 1) / 2, 6);
    expect(store.x).toBeCloseTo(0.9, 6);
    expect(store.z).toBeCloseTo(0.9, 6);
    await flushTasks(page);
    expectBalanced(await nativeCalls(page));
  });
});
