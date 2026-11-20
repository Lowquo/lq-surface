import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceHostSession, HOST_STATE_EVENT } from '../dist/index.js';
import { fakeBackend, fakeNative, settle, withoutUnhandledRejections } from './helpers.mjs';

function assertPoses(actual, expected) {
  assert.equal(actual.length, expected.length, `expected ${expected.length} poses, got ${JSON.stringify(actual)}`);
  actual.forEach((pose, i) => {
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(pose[axis] - expected[i][axis]) < 1e-9, `pose ${i}.${axis}: ${pose[axis]} != ${expected[i][axis]}`);
    }
  });
}

function setup(options = {}) {
  const native = fakeNative(options);
  const backend = fakeBackend();
  const errors = [];
  const session = new SurfaceHostSession({ lookup: native.lookup, backend, onError: (e) => errors.push(e), timeoutMs: 50 });
  const poses = [];
  return { native, backend, session, errors, poses, listen: () => session.onHostState((p) => poses.push(p)) };
}

test('a new listener receives the current host state from an initial pull', async () => {
  const { native, backend, poses, listen } = setup();
  native.state.x = 1;
  listen();
  await settle();
  assertPoses(poses, [{ x: 1, y: 0, z: 0.5 }]);
  assert.deepEqual(native.names(), ['surfaceGetState']);
  assert.equal(backend.count(HOST_STATE_EVENT), 1);
});

test('host events are delivered while idle, and identical states only once', async () => {
  const { backend, poses, listen } = setup();
  listen();
  await settle();
  backend.emit(HOST_STATE_EVENT, { x: 0.25, y: 0.5, z: 0.5 });
  backend.emit(HOST_STATE_EVENT, { x: 0.25, y: 0.5, z: 0.5 });
  backend.emit(HOST_STATE_EVENT, { x: 0.25, y: 0.5, z: 0.9 });
  assertPoses(poses, [{ x: 0, y: 0, z: 0.5 }, { x: -0.5, y: 0, z: 0.5 }, { x: -0.5, y: 0, z: 0.9 }]);
});

test('our own writes are never echoed back to the UI', async () => {
  const { native, backend, session, poses, listen } = setup();
  listen();
  await settle();
  poses.length = 0;
  session.change({ x: 0.5, y: -0.5, z: 0.1 });
  await settle();
  // The native side reports the values it now holds (e.g. a host echoing automation writes).
  backend.emit(HOST_STATE_EVENT, { ...native.state });
  // Float storage on the host side differs from the double we sent by less than 1e-7.
  backend.emit(HOST_STATE_EVENT, { x: Math.fround(0.75), y: Math.fround(0.25), z: Math.fround(0.1) });
  assert.deepEqual(poses, []);
});

test('host updates during a gesture are held back, then resynced via surfaceGetState when idle', async () => {
  const { native, backend, session, poses, listen } = setup();
  listen();
  await settle();
  poses.length = 0;

  session.begin();
  session.change({ x: 0.2, y: 0, z: 0.5 });
  await settle();
  backend.emit(HOST_STATE_EVENT, { x: 0.9, y: 0.5, z: 0.5 }); // e.g. automation playback
  assert.deepEqual(poses, []);

  native.state.y = 0.75; // the host keeps moving
  session.end();
  await settle();
  const getStates = native.names().filter((n) => n === 'surfaceGetState');
  assert.equal(getStates.length, 2); // initial pull + resync after the gesture
  assertPoses(poses, [{ x: 0.2, y: 0.5, z: 0.5 }]);
});

test('no stale jump-back while queued writes are still in flight after a gesture', async () => {
  const { native, backend, session, poses, listen } = setup();
  listen();
  await settle();
  poses.length = 0;
  native.setManual(true);

  session.begin();
  for (let i = 1; i <= 20; i += 1) session.change({ x: i / 40, y: 0, z: 0.5 });
  session.end();
  // Meanwhile the native timer reports an intermediate value (one of our own earlier writes).
  backend.emit(HOST_STATE_EVENT, { x: 0.5 + 1 / 80, y: 0.5, z: 0.5 });
  assert.deepEqual(poses, []);
  assert.equal(session.idle, false);

  native.setManual(false);
  await native.releaseAll();
  await settle();
  // The resync shows the host holding our final value: nothing to deliver.
  assert.equal(session.idle, true);
  assert.deepEqual(poses, []);
  assert.ok(Math.abs(native.state.x - (0.5 + 1 / 4)) < 1e-12);
});

test('a surfaceGetState reply that arrives while busy is discarded and retried', async () => {
  let getStateCalls = 0;
  const { native, session, poses, listen } = setup({
    manual: true,
    respond: (name, _args, state) => {
      if (name !== 'surfaceGetState') return undefined;
      getStateCalls += 1;
      // The second (retry) reply reflects host automation that moved z after our writes.
      return getStateCalls === 2 ? { ...state, z: 0.8 } : undefined;
    },
  });
  listen(); // getState pending
  session.change({ x: 0.4, y: 0, z: 0.5 }); // gesture calls queue up behind the first begin
  await settle(); // both the getState and the first begin call are now pending natively
  const index = native.pending.findIndex((p) => p.name === 'surfaceGetState');
  native.pending.splice(index, 1)[0].resolve(); // reply arrives while our writes are in flight
  await settle();
  assert.deepEqual(poses, []);
  native.setManual(false);
  await native.releaseAll();
  await settle();
  assert.equal(getStateCalls, 2);
  assertPoses(poses, [{ x: 0.4, y: 0, z: 0.8 }]);
});

test('every listener gets the state once; unsubscribed listeners get nothing', async () => {
  const { backend, session } = setup();
  const a = [];
  const b = [];
  const stopA = session.onHostState((p) => a.push(p));
  await settle();
  session.onHostState((p) => b.push(p));
  await settle();
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  stopA();
  backend.emit(HOST_STATE_EVENT, { x: 0, y: 0, z: 0 });
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
});

test('a native side without surfaceGetState still delivers events', async () => {
  await withoutUnhandledRejections(async () => {
    const { backend, poses, errors, listen } = setup({
      respond: (name) => (name === 'surfaceGetState' ? Promise.reject(new Error('not registered')) : undefined),
    });
    listen();
    await settle();
    assert.equal(errors.length, 1);
    backend.emit(HOST_STATE_EVENT, { x: 0.5, y: 0.5, z: 0.25 });
    assertPoses(poses, [{ x: 0, y: 0, z: 0.25 }]);
  });
});

test('dispose() ends the gesture, unsubscribes and silences everything', async () => {
  const { native, backend, session, poses, listen } = setup();
  listen();
  await settle();
  poses.length = 0;
  session.begin();
  session.change({ x: 0.1, y: 0.1, z: 0.1 });
  session.dispose();
  await settle();
  assert.equal(native.names().filter((n) => n === 'surfaceEndGesture').length, 3);
  assert.equal(backend.count(HOST_STATE_EVENT), 0);
  backend.emit(HOST_STATE_EVENT, { x: 0, y: 0, z: 0 });
  session.change({ x: 0.9, y: 0, z: 0 });
  session.begin();
  assert.deepEqual(session.onHostState(() => assert.fail('listener after dispose'))(), undefined);
  await settle();
  assert.deepEqual(poses, []);
  assert.equal(native.names().filter((n) => n === 'surfaceSetParameter').length, 3);
});

test('listener exceptions are reported, not thrown into the JUCE event dispatch', async () => {
  const { backend, session, errors } = setup();
  session.onHostState(() => { throw new Error('ui bug'); });
  await settle();
  assert.doesNotThrow(() => backend.emit(HOST_STATE_EVENT, { x: 0.1, y: 0.1, z: 0.1 }));
  assert.deepEqual(errors.map((e) => e.message), ['ui bug', 'ui bug']);
});
