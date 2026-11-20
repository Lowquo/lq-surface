import test from 'node:test';
import assert from 'node:assert/strict';
import { createJuceBridge, SurfaceHostController } from '../dist/index.js';
import { fakeNative, settle, withoutUnhandledRejections } from './helpers.mjs';

const ids = ['surface_x', 'surface_y', 'surface_z'];

function setup(options = {}) {
  const native = fakeNative(options);
  const errors = [];
  let idleCount = 0;
  const controller = new SurfaceHostController(createJuceBridge(native.lookup), {
    onError: (e) => errors.push(e),
    onIdle: () => { idleCount += 1; },
  });
  return { native, controller, errors, idle: () => idleCount };
}

test('change() outside a gesture is wrapped in its own balanced begin/end', async () => {
  const { native, controller } = setup();
  controller.change({ x: 1, y: 0, z: 0.25 });
  await settle();
  assert.deepEqual(native.calls, [
    ...ids.map((id) => ['surfaceBeginGesture', id]),
    ['surfaceSetParameter', 'surface_x', 1],
    ['surfaceSetParameter', 'surface_y', 0.5],
    ['surfaceSetParameter', 'surface_z', 0.25],
    ...ids.map((id) => ['surfaceEndGesture', id]),
  ]);
  assert.equal(controller.gestureActive, false);
});

test('within a gesture only changed axes are sent', () => {
  // A synchronous recording bridge, so the bridge's own coalescing does not hide the dedupe.
  const sets = [];
  const bridge = { beginGesture() {}, setParameter: (id, v) => { sets.push([id, v]); }, endGesture() {} };
  const controller = new SurfaceHostController(bridge);
  controller.begin();
  controller.change({ x: 0.2, y: 0.2, z: 0.5 });
  controller.change({ x: 0.2, y: 0.2, z: 0.5 }); // identical: nothing
  controller.change({ x: 0.4, y: 0.2, z: 0.5 }); // only x
  controller.change({ x: 0.4, y: 0.2, z: 0.9 }); // only z
  controller.end();
  assert.deepEqual(sets, [
    ['surface_x', 0.6],
    ['surface_y', 0.6],
    ['surface_z', 0.5],
    ['surface_x', 0.7],
    ['surface_z', 0.9],
  ]);
});

test('each new gesture re-sends the full pose once (host may have moved meanwhile)', async () => {
  const { native, controller } = setup();
  const pose = { x: 0, y: 0, z: 0.5 };
  controller.change(pose);
  controller.change(pose);
  await settle();
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceSetParameter').length, 6);
});

test('begin/end are idempotent and balanced per parameter', async () => {
  const { native, controller } = setup();
  controller.begin(); controller.begin();
  controller.end(); controller.end();
  controller.dispose(); controller.dispose();
  await settle();
  for (const id of ids) {
    assert.equal(native.calls.filter((c) => c[0] === 'surfaceBeginGesture' && c[1] === id).length, 1);
    assert.equal(native.calls.filter((c) => c[0] === 'surfaceEndGesture' && c[1] === id).length, 1);
  }
});

test('non-finite or malformed poses are reported and never reach the host', async () => {
  const { native, controller, errors } = setup();
  for (const pose of [
    { x: NaN, y: 0, z: 0.5 }, { x: 0, y: Infinity, z: 0.5 }, { x: 0, y: 0, z: -Infinity },
    { x: '0', y: 0, z: 0.5 }, { x: 0, y: 0 }, null, undefined, 42, 'pose',
  ]) {
    assert.doesNotThrow(() => controller.change(pose));
  }
  controller.begin();
  controller.change({ x: NaN, y: 0, z: 0 });
  controller.end();
  await settle();
  assert.equal(errors.length, 10);
  assert.ok(errors.every((e) => e instanceof RangeError));
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceSetParameter').length, 0);
  // The explicit gesture was still balanced; the rejected changes opened none of their own.
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceBeginGesture').length, 3);
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceEndGesture').length, 3);
});

test('synchronous bridge throws and rejections go to onError, never to the caller', async () => {
  await withoutUnhandledRejections(async () => {
    const errors = [];
    const throwing = {
      beginGesture() { throw new Error('begin'); },
      setParameter() { return Promise.reject(new Error('set')); },
      endGesture() { throw new Error('end'); },
    };
    const controller = new SurfaceHostController(throwing, { onError: (e) => errors.push(e.message) });
    assert.doesNotThrow(() => { controller.begin(); controller.change({ x: 0, y: 0, z: 0 }); controller.end(); });
    await settle();
    assert.deepEqual(errors.sort(), ['begin', 'begin', 'begin', 'end', 'end', 'end', 'set', 'set', 'set']);
  });
});

test('errors are swallowed silently without onError, and a throwing onError is contained', async () => {
  await withoutUnhandledRejections(async () => {
    const failing = createJuceBridge(() => () => Promise.reject(new Error('down')));
    const silent = new SurfaceHostController(failing);
    const loud = new SurfaceHostController(failing, { onError: () => { throw new Error('handler bug'); } });
    assert.doesNotThrow(() => { silent.change({ x: 0, y: 0, z: 0 }); loud.change({ x: 0, y: 0, z: 0 }); });
  });
});

test('idle tracking: onIdle fires once everything has settled after end()', async () => {
  const { native, controller, idle } = setup({ manual: true });
  assert.equal(controller.idle, true);
  controller.begin();
  controller.change({ x: 0.3, y: 0.3, z: 0.3 });
  assert.equal(controller.idle, false);
  controller.end();
  assert.equal(controller.gestureActive, false);
  assert.equal(controller.idle, false);
  assert.ok(controller.pendingCalls > 0);
  assert.equal(idle(), 0);
  await native.releaseAll();
  assert.equal(controller.pendingCalls, 0);
  assert.equal(controller.idle, true);
  assert.equal(idle(), 1);
});

test('dispose() closes an open gesture and ignores later calls', async () => {
  const { native, controller } = setup();
  controller.begin();
  controller.change({ x: 0.5, y: 0, z: 0 });
  controller.dispose();
  controller.begin();
  controller.change({ x: -0.5, y: 0, z: 1 });
  controller.end();
  await settle();
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceBeginGesture').length, 3);
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceSetParameter').length, 3);
  assert.equal(native.calls.filter((c) => c[0] === 'surfaceEndGesture').length, 3);
});

test('synchronous (void-returning) bridges are supported', () => {
  const calls = [];
  let idleCount = 0;
  const bridge = {
    beginGesture: (id) => { calls.push(['begin', id]); },
    setParameter: (id, v) => { calls.push(['set', id, v]); },
    endGesture: (id) => { calls.push(['end', id]); },
  };
  const controller = new SurfaceHostController(bridge, { onIdle: () => { idleCount += 1; } });
  controller.change({ x: 0, y: 0, z: 1 });
  assert.equal(calls.length, 9);
  assert.equal(idleCount, 1);
  assert.equal(controller.idle, true);
});
