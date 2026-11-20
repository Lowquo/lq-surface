import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export type Pose = { x: number; y: number; z: number };
export type NativeCall = { name: string; params: unknown[] };

/** Geometry constants mirrored from packages/controls/src/geometry.ts. */
export const EXTENT_RATIO = 1.3;
export const TRAVEL_RATIO = 0.8;
export const FOCUS_RING_RATIO = 1.22;
export const MARKER_RGB = [0xea, 0xc9, 0xad] as const;
export const FOCUS_RGB = [0xe1, 0xdd, 0xeb] as const;

export const GESTURE_FUNCTIONS = ['surfaceBeginGesture', 'surfaceSetParameter', 'surfaceEndGesture'];

declare global {
  interface Window {
    __nativeCalls?: NativeCall[];
    __renderStats?: { raf: number; rafDone: number; draws: number; clears: number };
  }
}

/**
 * Init script: a JUCE WebView backend double, faithful to the protocol used by
 * @juce-framework/webview 1.0 (check_native_interop + getNativeFunction):
 * - window.__JUCE__ = { postMessage, initialisationData, backend };
 * - native calls arrive as postMessage(JSON {eventId: '__juce__invoke', payload: {name, params, resultId}});
 * - the native side answers with backend.emitByBackend('__juce__complete', JSON {promiseId, result});
 * - native events (surfaceHostState) arrive through backend.emitByBackend(eventId, jsonString).
 * It also models the native parameter store like examples/juce-plugin's SurfaceNativeBridge:
 * surfaceSetParameter writes it, surfaceGetState reads it, and emitHostState() (host automation)
 * writes it before emitting the event. Every invocation is recorded in window.__nativeCalls.
 */
export function installJuceMock(): void {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Map<number, Listener>>();
  let nextId = 0;
  const calls: { name: string; params: unknown[] }[] = [];
  const functions = ['surfaceBeginGesture', 'surfaceSetParameter', 'surfaceEndGesture', 'surfaceGetState'];
  const ids = ['surface_x', 'surface_y', 'surface_z'];
  const store: Record<string, number> = { surface_x: 0.5, surface_y: 0.5, surface_z: 0.5 };
  const invoke = (name: string, params: unknown[]): unknown => {
    if (!functions.includes(name)) return null;
    if (name === 'surfaceGetState') return { x: store.surface_x, y: store.surface_y, z: store.surface_z };
    const id = params[0];
    if (typeof id !== 'string' || !ids.includes(id)) return false;
    if (name === 'surfaceSetParameter') {
      const value = params[1];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return false;
      store[id] = value;
    }
    return true;
  };
  const backend = {
    addEventListener(eventId: string, fn: Listener): [string, number] {
      let list = listeners.get(eventId);
      if (!list) { list = new Map(); listeners.set(eventId, list); }
      const id = nextId++;
      list.set(id, fn);
      return [eventId, id];
    },
    removeEventListener([eventId, id]: [string, number]): void {
      listeners.get(eventId)?.delete(id);
    },
    emitEvent(eventId: string, payload: unknown): void {
      juce.postMessage(JSON.stringify({ eventId, payload }));
    },
    emitByBackend(eventId: string, json: string): void {
      const payload: unknown = JSON.parse(json);
      for (const fn of [...(listeners.get(eventId)?.values() ?? [])]) fn(payload);
    },
  };
  const juce = {
    postMessage(message: string): void {
      const { eventId, payload } = JSON.parse(message) as { eventId: string; payload: { name: string; params: unknown[]; resultId: number } };
      if (eventId !== '__juce__invoke') return;
      calls.push({ name: payload.name, params: payload.params });
      const result = invoke(payload.name, payload.params);
      // Native completion is asynchronous.
      setTimeout(() => backend.emitByBackend('__juce__complete', JSON.stringify({ promiseId: payload.resultId, result })), 0);
    },
    initialisationData: {
      __juce__platform: ['linux'],
      __juce__functions: functions,
      __juce__registeredGlobalEventIds: [],
      __juce__sliders: [],
      __juce__toggles: [],
      __juce__comboBoxes: [],
    },
    backend,
  };
  Object.assign(window, {
    __JUCE__: juce,
    __nativeCalls: calls,
    // Test-only probe: the modelled native parameter store (normalised host values).
    __nativeStore: store,
    // Test-only probe (not part of the JUCE protocol): listeners registered per event.
    __juceListenerCount: (eventId: string) => listeners.get(eventId)?.size ?? 0,
  });
}

/** Init script: counts requestAnimationFrame requests/callbacks and actual draw calls. */
export function installRenderCounters(): void {
  const stats = { raf: 0, rafDone: 0, draws: 0, clears: 0 };
  window.__renderStats = stats;
  const raf = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    stats.raf += 1;
    return raf((time) => { stats.rafDone += 1; callback(time); });
  };
  window.cancelAnimationFrame = (handle: number): void => {
    stats.rafDone += 1; // a cancelled frame is no longer pending
    cancel(handle);
  };
  const wrap = (proto: object, name: string, counter: 'draws' | 'clears'): void => {
    const target = proto as Record<string, unknown>;
    const original = target[name] as (...args: unknown[]) => unknown;
    target[name] = function (this: unknown, ...args: unknown[]) {
      stats[counter] += 1;
      return original.apply(this, args);
    };
  };
  for (const ctor of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const proto = (window as unknown as Record<string, { prototype: object } | undefined>)[ctor]?.prototype;
    if (proto) { wrap(proto, 'drawElements', 'draws'); wrap(proto, 'drawArrays', 'draws'); }
  }
  wrap(CanvasRenderingContext2D.prototype, 'clearRect', 'clears');
}

export async function renderStats(page: Page): Promise<{ raf: number; rafDone: number; draws: number; clears: number }> {
  return page.evaluate(() => ({ ...window.__renderStats! }));
}

/** Waits until no requested animation frame is still pending. */
export async function framesSettled(page: Page): Promise<void> {
  await expect.poll(async () => {
    const s = await renderStats(page);
    return s.raf - s.rafDone;
  }, { message: 'pending animation frames' }).toBe(0);
}

/** Observes ~1 s of idle time (the inherent wait of a "nothing happens" assertion). */
export async function idleWindow(page: Page): Promise<{ raf: number; draws: number; clears: number }> {
  await framesSettled(page);
  const before = await renderStats(page);
  await page.waitForTimeout(1000);
  const after = await renderStats(page);
  return { raf: after.raf - before.raf, draws: after.draws - before.draws, clears: after.clears - before.clears };
}

export function trackball(page: Page): Locator {
  return page.locator('.lq-trackball');
}

export async function openPlayground(page: Page, renderer: 'webgl' | '2d' = 'webgl'): Promise<Locator> {
  await page.goto('/');
  const ball = trackball(page);
  await expect(ball).toHaveAttribute('data-renderer', renderer);
  return ball;
}

/** Pose shown by the playground's precision readouts (3 decimals). */
export async function readPose(page: Page): Promise<Pose> {
  const read = async (axis: string): Promise<number> => Number(await page.locator(`#${axis}-value`).textContent());
  return { x: await read('x'), y: await read('y'), z: await read('z') };
}

export async function expectPose(page: Page, expected: Partial<Pose>, tolerance = 0.0006): Promise<void> {
  await expect.poll(async () => {
    const pose = await readPose(page);
    return (Object.keys(expected) as (keyof Pose)[]).every((axis) => Math.abs(pose[axis] - expected[axis]!) <= tolerance)
      ? 'ok' : JSON.stringify(pose);
  }, { message: `pose ≈ ${JSON.stringify(expected)}` }).toBe('ok');
}

/** Screen geometry of a trackball element (page CSS pixels). */
export async function geometry(ball: Locator): Promise<{ left: number; top: number; width: number; height: number; cx: number; cy: number; radius: number; travel: number }> {
  const box = await ball.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left + el.clientLeft, top: r.top + el.clientTop, width: el.clientWidth, height: el.clientHeight };
  });
  const radius = Math.min(box.width, box.height) / (2 * EXTENT_RATIO);
  return { ...box, cx: box.left + box.width / 2, cy: box.top + box.height / 2, radius, travel: radius * TRAVEL_RATIO };
}

/** Waits until the playground has connected to the (mock) host. */
export async function waitForHost(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    (window as unknown as { __juceListenerCount(id: string): number }).__juceListenerCount('surfaceHostState') > 0);
}

export async function nativeCalls(page: Page): Promise<NativeCall[]> {
  const calls = await page.evaluate(() => window.__nativeCalls ?? []);
  return calls.filter((call) => GESTURE_FUNCTIONS.includes(call.name));
}

/** Host automation: writes the native store, then emits surfaceHostState (like the editor's change detection). */
export async function nativeStore(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __nativeStore: Record<string, number> }).__nativeStore;
    return { x: s.surface_x!, y: s.surface_y!, z: s.surface_z! };
  });
}

export async function emitHostState(page: Page, normalised: Pose): Promise<void> {
  await page.evaluate((state) => {
    const w = window as unknown as { __JUCE__: { backend: { emitByBackend(id: string, json: string): void } }; __nativeStore: Record<string, number> };
    Object.assign(w.__nativeStore, { surface_x: state.x, surface_y: state.y, surface_z: state.z });
    w.__JUCE__.backend.emitByBackend('surfaceHostState', JSON.stringify(state));
  }, normalised);
}

/** Let pending timers and promise chains (the serial native queue) run. */
export async function flushTasks(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));
}

/**
 * Asserts host gestures are balanced per parameter: no nested begin, no end
 * without begin, no set outside a gesture, nothing left open. Returns the
 * number of gestures per parameter.
 */
export function expectBalanced(calls: NativeCall[]): Record<string, number> {
  const open = new Map<string, boolean>();
  const gestures: Record<string, number> = {};
  for (const [index, call] of calls.entries()) {
    const id = String(call.params[0]);
    const where = `call #${index} ${call.name}(${id})`;
    if (call.name === 'surfaceBeginGesture') {
      expect(open.get(id) ?? false, `${where}: nested begin`).toBe(false);
      open.set(id, true);
      gestures[id] = (gestures[id] ?? 0) + 1;
    } else if (call.name === 'surfaceEndGesture') {
      expect(open.get(id) ?? false, `${where}: end without begin`).toBe(true);
      open.set(id, false);
    } else if (call.name === 'surfaceSetParameter') {
      expect(open.get(id) ?? false, `${where}: set outside a gesture`).toBe(true);
    }
  }
  for (const [id, isOpen] of open) expect(isOpen, `${id} left open`).toBe(false);
  return gestures;
}

/**
 * Counts pixels near `rgb` inside an annulus around the trackball centre, from
 * a real screenshot of the element (whatever renderer drew it).
 */
export async function colourStats(
  ball: Locator,
  area: { rMin: number; rMax: number },
  rgb: readonly [number, number, number],
  tolerance = 36,
): Promise<{ count: number; x: number; y: number }> {
  const png = await ball.screenshot({ animations: 'disabled' });
  const g = await geometry(ball);
  return ball.page().evaluate(async ({ base64, size, area, rgb, tolerance }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const scale = width / size.width; // device pixels per CSS pixel
    const cx = size.width / 2;
    const cy = size.height / 2;
    let count = 0; let sx = 0; let sy = 0;
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const x = (px + 0.5) / scale;
        const y = (py + 0.5) / scale;
        const r = Math.hypot(x - cx, y - cy);
        if (r < area.rMin || r > area.rMax) continue;
        const o = (py * width + px) * 4;
        const diff = Math.abs(data[o] - rgb[0]) + Math.abs(data[o + 1] - rgb[1]) + Math.abs(data[o + 2] - rgb[2]);
        if (diff > tolerance) continue;
        count += 1; sx += x - cx; sy += y - cy;
      }
    }
    // Offsets from the centre, in CSS pixels.
    return { count, x: count ? sx / count : NaN, y: count ? sy / count : NaN };
  }, { base64: png.toString('base64'), size: { width: g.width, height: g.height }, area, rgb, tolerance });
}

/** Asserts the marker is drawn exactly where the pose says (within `tolerance` CSS px). */
export async function expectMarkerAt(page: Page, ball: Locator, pose: Pose, tolerance = 1.25): Promise<void> {
  const g = await geometry(ball);
  const stats = await colourStats(ball, { rMin: 0, rMax: g.travel + 0.07 * g.radius }, MARKER_RGB);
  expect(stats.count, 'marker pixels found').toBeGreaterThan(20);
  expect(Math.abs(stats.x - g.travel * pose.x), `marker x offset (${stats.x})`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(stats.y - g.travel * pose.y), `marker y offset (${stats.y})`).toBeLessThanOrEqual(tolerance);
}

/** Pixels of the focus ring colour around the ball. */
export async function focusRingPixels(page: Page, ball: Locator): Promise<number> {
  const g = await geometry(ball);
  const r = FOCUS_RING_RATIO * g.radius;
  return (await colourStats(ball, { rMin: r - 2.5, rMax: r + 2.5 }, FOCUS_RGB, 30)).count;
}

/** Fixture page that loads the built packages directly (no playground code). */
export async function openFixture(page: Page): Promise<void> {
  const files = (relative: string): string => {
    const pathname = decodeURIComponent(new URL(relative, import.meta.url).pathname);
    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname; // Windows drive paths
  };
  const roots: Record<string, string> = {
    three: files('../../../node_modules/three/build/'),
    core: files('../../../packages/core/dist/'),
    controls: files('../../../packages/controls/dist/'),
  };
  await page.route('**/__e2e/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__e2e/fixture.html') {
      await route.fulfill({ contentType: 'text/html', body: FIXTURE_HTML });
      return;
    }
    const match = /^\/__e2e\/(three|core|controls)\/([\w.-]+\.js)$/.exec(url.pathname);
    if (!match) { await route.fulfill({ status: 404 }); return; }
    await route.fulfill({ path: roots[match[1]] + match[2], contentType: 'text/javascript' });
  });
  await page.goto('/__e2e/fixture.html');
  await page.waitForFunction(() => (window as unknown as { fixtureReady?: boolean }).fixtureReady === true);
}

const FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>trackball fixture</title>
<script type="importmap">{"imports":{
  "three":"/__e2e/three/three.module.js",
  "@lowquo/surface":"/__e2e/core/index.js",
  "@lowquo/surface-controls":"/__e2e/controls/index.js"}}</script>
<style>body{margin:0;background:#14161e}#root{width:400px;height:300px;margin:20px}#spacer{height:3000px}</style>
</head><body><div id="root" style="color: rgb(1, 2, 3)"></div><div id="spacer"></div>
<script type="module">
  import { Trackball } from '@lowquo/surface-controls';
  document.addEventListener('pointerdown', (event) => { window.lastPointerId = event.pointerId; }, true);
  window.log = [];
  window.create = (options = {}) => {
    window.ball = new Trackball(document.getElementById('root'), {
      onGestureStart: () => window.log.push('start'),
      onGestureEnd: () => window.log.push('end'),
      onChange: (pose) => window.log.push('change:' + [pose.x, pose.y, pose.z].map((v) => v.toFixed(4)).join(',')),
      ...options,
    });
  };
  window.fixtureReady = true;
</script></body></html>`;
