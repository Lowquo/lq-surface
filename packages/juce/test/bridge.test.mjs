import test from 'node:test';
import assert from 'node:assert/strict';
import { createJuceBridge, SurfaceHostController, NativeCallError, NATIVE_FUNCTIONS } from '../dist/index.js';
import { fakeNative, settle, withoutUnhandledRejections } from './helpers.mjs';

test('native function calls are ordered and clipped', async () => {
  const calls = [];
  const bridge = createJuceBridge((name) => async (...args) => { calls.push([name, ...args]); });
  const actions = [bridge.beginGesture('surface_z'), bridge.setParameter('surface_z', 3), bridge.endGesture('surface_z')];
  await Promise.all(actions);
  assert.deepEqual(calls, [
    ['surfaceBeginGesture', 'surface_z'],
    ['surfaceSetParameter', 'surface_z', 1],
    ['surfaceEndGesture', 'surface_z'],
  ]);
});

test('host controller balances three-axis gestures', async () => {
  const calls = [];
  const bridge = createJuceBridge((name) => async (...args) => { calls.push([name, ...args]); });
  const c = new SurfaceHostController(bridge);
  c.begin(); c.begin(); c.change({ x: 0, y: 0, z: .5 }); c.end(); c.dispose();
  // Flush queued microtasks after scheduled calls.
  await bridge.endGesture('surface_z');
  assert.equal(calls.filter((v) => v[0] === 'surfaceBeginGesture').length, 3);
  assert.equal(calls.filter((v) => v[0] === 'surfaceSetParameter').length, 3);
  assert.equal(calls.filter((v) => v[0] === 'surfaceEndGesture').length, 4);
});

test('the three gesture functions are looked up once, at creation', () => {
  const native = fakeNative();
  createJuceBridge(native.lookup);
  assert.deepEqual(native.lookups, [NATIVE_FUNCTIONS.beginGesture, NATIVE_FUNCTIONS.setParameter, NATIVE_FUNCTIONS.endGesture]);
});

test('only one native call is in flight at a time', async () => {
  const native = fakeNative({ manual: true });
  const bridge = createJuceBridge(native.lookup);
  bridge.beginGesture('surface_x');
  bridge.setParameter('surface_x', 0.1);
  bridge.endGesture('surface_x');
  await settle();
  assert.equal(native.pending.length, 1);
  assert.deepEqual(native.calls, [['surfaceBeginGesture', 'surface_x']]);
  await native.releaseAll();
  assert.deepEqual(native.names(), ['surfaceBeginGesture', 'surfaceSetParameter', 'surfaceEndGesture']);
});

test('pending sets coalesce per id (latest value wins) and share one promise', async () => {
  const native = fakeNative({ manual: true });
  const bridge = createJuceBridge(native.lookup);
  const begin = bridge.beginGesture('surface_x'); // in flight
  const a = bridge.setParameter('surface_x', 0.1);
  const b = bridge.setParameter('surface_x', 0.2);
  const y = bridge.setParameter('surface_y', 0.5);
  const c = bridge.setParameter('surface_x', 0.3);
  assert.equal(a, b);
  assert.equal(b, c);
  await native.releaseAll();
  await Promise.all([begin, a, y]);
  assert.deepEqual(native.calls, [
    ['surfaceBeginGesture', 'surface_x'],
    ['surfaceSetParameter', 'surface_x', 0.3],
    ['surfaceSetParameter', 'surface_y', 0.5],
  ]);
});

test('coalescing never crosses a begin/end boundary of the same id', async () => {
  const native = fakeNative({ manual: true });
  const bridge = createJuceBridge(native.lookup);
  bridge.beginGesture('surface_x'); // in flight
  bridge.setParameter('surface_x', 0.1);
  bridge.endGesture('surface_x');
  bridge.beginGesture('surface_x');
  bridge.setParameter('surface_x', 0.2);
  bridge.setParameter('surface_x', 0.25);
  bridge.endGesture('surface_x');
  await native.releaseAll();
  assert.deepEqual(native.calls, [
    ['surfaceBeginGesture', 'surface_x'],
    ['surfaceSetParameter', 'surface_x', 0.1],
    ['surfaceEndGesture', 'surface_x'],
    ['surfaceBeginGesture', 'surface_x'],
    ['surfaceSetParameter', 'surface_x', 0.25],
    ['surfaceEndGesture', 'surface_x'],
  ]);
});

test('a set that is already in flight is not modified by later sets', async () => {
  const native = fakeNative({ manual: true });
  const bridge = createJuceBridge(native.lookup);
  bridge.setParameter('surface_z', 0.1); // starts immediately
  bridge.setParameter('surface_z', 0.2); // queued
  bridge.setParameter('surface_z', 0.3); // coalesced into the queued one
  await native.releaseAll();
  assert.deepEqual(native.calls, [
    ['surfaceSetParameter', 'surface_z', 0.1],
    ['surfaceSetParameter', 'surface_z', 0.3],
  ]);
});

test('the queue stays bounded under a flood of pointer moves over slow IPC', async () => {
  const native = fakeNative({ manual: true });
  const bridge = createJuceBridge(native.lookup);
  const controller = new SurfaceHostController(bridge);
  controller.begin();
  let last;
  for (let i = 0; i < 5000; i += 1) {
    last = { x: Math.sin(i) * 0.5, y: Math.cos(i) * 0.5, z: (i % 100) / 100 };
    controller.change(last);
  }
  controller.end();
  await native.releaseAll();
  // 3 begins, at most one in-flight + one coalesced set per axis, 3 ends.
  assert.ok(native.calls.length <= 3 + 6 + 3, `sent ${native.calls.length} native calls`);
  assert.deepEqual(native.names().slice(0, 3), Array(3).fill('surfaceBeginGesture'));
  assert.deepEqual(native.names().slice(-3), Array(3).fill('surfaceEndGesture'));
  assert.ok(Math.abs(native.state.x - (last.x + 1) / 2) < 1e-12);
  assert.ok(Math.abs(native.state.y - (last.y + 1) / 2) < 1e-12);
  assert.ok(Math.abs(native.state.z - last.z) < 1e-12);
});

test('non-finite and non-number values are rejected and never forwarded', async () => {
  const native = fakeNative();
  const bridge = createJuceBridge(native.lookup);
  for (const value of [NaN, Infinity, -Infinity, '0.5', undefined, null, {}]) {
    await assert.rejects(bridge.setParameter('surface_x', value), RangeError, String(value));
  }
  assert.equal(native.calls.length, 0);
});

test('unknown parameter ids are rejected for begin, set and end', async () => {
  const native = fakeNative();
  const bridge = createJuceBridge(native.lookup);
  for (const id of ['surface_w', '', 'SURFACE_X', undefined, 1, '__proto__']) {
    await assert.rejects(bridge.beginGesture(id), TypeError);
    await assert.rejects(bridge.setParameter(id, 0.5), TypeError);
    await assert.rejects(bridge.endGesture(id), TypeError);
  }
  assert.equal(native.calls.length, 0);
});

test('a native `false` result rejects with NativeCallError and the queue continues', async () => {
  const native = fakeNative({ respond: (name) => (name === 'surfaceBeginGesture' ? false : undefined) });
  const bridge = createJuceBridge(native.lookup);
  const begin = bridge.beginGesture('surface_y');
  const set = bridge.setParameter('surface_y', 0.4);
  await assert.rejects(begin, (error) => error instanceof NativeCallError && error.functionName === 'surfaceBeginGesture');
  await set;
  assert.deepEqual(native.names(), ['surfaceBeginGesture', 'surfaceSetParameter']);
});

test('native rejections and synchronous throws become NativeCallError with a cause', async () => {
  const boom = new Error('IPC failed');
  const bridge = createJuceBridge((name) => () => {
    if (name === 'surfaceSetParameter') throw boom;
    return Promise.reject(boom);
  });
  await assert.rejects(bridge.setParameter('surface_x', 0.5), (error) => error instanceof NativeCallError && error.cause === boom);
  await assert.rejects(bridge.endGesture('surface_x'), (error) => error instanceof NativeCallError && error.cause === boom);
});

test('a native call that never completes times out and unblocks the queue', async () => {
  let hang = true;
  const calls = [];
  const bridge = createJuceBridge((name) => (...args) => {
    calls.push([name, ...args]);
    if (hang) { hang = false; return new Promise(() => {}); }
    return Promise.resolve(true);
  }, { timeoutMs: 20 });
  const stuck = bridge.beginGesture('surface_x');
  const next = bridge.setParameter('surface_x', 0.7);
  await assert.rejects(stuck, (error) => error instanceof NativeCallError && /did not complete/.test(error.message));
  await next;
  assert.deepEqual(calls, [['surfaceBeginGesture', 'surface_x'], ['surfaceSetParameter', 'surface_x', 0.7]]);
});

test('bridge calls never cause unhandled rejections when driven by the controller', async () => {
  await withoutUnhandledRejections(async () => {
    const bridge = createJuceBridge(() => () => Promise.reject(new Error('down')), { timeoutMs: 0 });
    const errors = [];
    const controller = new SurfaceHostController(bridge, { onError: (e) => errors.push(e) });
    controller.change({ x: 0.1, y: 0.2, z: 0.3 });
    await settle(10);
    assert.equal(errors.length, 9);
    assert.ok(errors.every((e) => e instanceof NativeCallError));
  });
});
