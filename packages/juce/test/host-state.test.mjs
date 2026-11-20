import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHostParameters, parseHostState, subscribeHostState, fetchHostState, HOST_STATE_EVENT, NativeCallError,
} from '../dist/index.js';
import { fakeBackend, fakeNative, withoutUnhandledRejections } from './helpers.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-12;

test('valid payloads map normalised parameters to a pose', () => {
  assert.deepEqual(parseHostState({ x: 0.5, y: 0.5, z: 0.5 }), { x: 0, y: 0, z: 0.5 });
  assert.deepEqual(parseHostState({ x: 1, y: 0.5, z: 0 }), { x: 1, y: 0, z: 0 });
  assert.deepEqual(parseHostParameters({ x: 0, y: 1, z: 1, extra: 'ignored' }), { x: 0, y: 1, z: 1 });
  // Host corners outside the unit disk are projected onto it.
  const corner = parseHostState({ x: 1, y: 1, z: 1 });
  assert.ok(close(Math.hypot(corner.x, corner.y), 1));
  // JSON round trip, as delivered by JUCE's emitByBackend.
  assert.deepEqual(parseHostParameters(JSON.parse('{"x":0.25,"y":0.75,"z":0.125}')), { x: 0.25, y: 0.75, z: 0.125 });
});

test('hostile payloads are rejected without throwing', () => {
  const throwingGetter = { y: 0.5, z: 0.5 };
  Object.defineProperty(throwingGetter, 'x', { enumerable: true, get() { throw new Error('boom'); } });
  const throwingProxy = new Proxy({}, {
    has() { throw new Error('trap'); }, get() { throw new Error('trap'); }, getOwnPropertyDescriptor() { throw new Error('trap'); },
  });
  const hostile = [
    undefined, null, 0, 1, 'x', true, Symbol('s'), 1n, () => ({ x: 0.5, y: 0.5, z: 0.5 }),
    [], [0.5, 0.5, 0.5], {}, { x: 0.5, y: 0.5 }, { x: 0.5, z: 0.5 }, { y: 0.5, z: 0.5 },
    { x: '0.5', y: 0.5, z: 0.5 }, { x: 0.5, y: null, z: 0.5 }, { x: 0.5, y: 0.5, z: true },
    { x: NaN, y: 0.5, z: 0.5 }, { x: 0.5, y: Infinity, z: 0.5 }, { x: 0.5, y: 0.5, z: -Infinity },
    { x: -0.0001, y: 0.5, z: 0.5 }, { x: 0.5, y: 1.0001, z: 0.5 }, { x: 0.5, y: 0.5, z: 2 },
    { x: [0.5], y: 0.5, z: 0.5 }, { x: { valueOf: () => 0.5 }, y: 0.5, z: 0.5 }, { x: 1n, y: 0.5, z: 0.5 },
    Object.create({ x: 0.5, y: 0.5, z: 0.5 }), // inherited, not own
    JSON.parse('{"__proto__":{"x":0.5,"y":0.5,"z":0.5}}'),
    throwingGetter, throwingProxy,
  ];
  hostile.forEach((payload, index) => {
    assert.doesNotThrow(() => parseHostState(payload));
    assert.equal(parseHostState(payload), null, `accepted hostile payload #${index}`);
  });
});

test('subscribeHostState delivers validated poses and unsubscribes cleanly', () => {
  const backend = fakeBackend();
  const poses = [];
  const errors = [];
  const unsubscribe = subscribeHostState(backend, (p) => poses.push(p), { onError: (e) => errors.push(e) });
  assert.equal(backend.count(HOST_STATE_EVENT), 1);

  backend.emit(HOST_STATE_EVENT, { x: 0.75, y: 0.5, z: 0.2 });
  backend.emit(HOST_STATE_EVENT, { x: 'nope' });
  backend.emit(HOST_STATE_EVENT, null);
  backend.emit('someOtherEvent', { x: 0, y: 0, z: 0 });
  assert.deepEqual(poses, [{ x: 0.5, y: 0, z: 0.2 }]);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e instanceof TypeError));

  unsubscribe();
  unsubscribe();
  assert.equal(backend.count(HOST_STATE_EVENT), 0);
  assert.equal(backend.removed.length, 1);
  backend.emit(HOST_STATE_EVENT, { x: 0, y: 0, z: 0 });
  assert.equal(poses.length, 1);
});

test('a stale backend callback after unsubscribe is ignored', () => {
  let captured;
  const backend = {
    addEventListener(_id, fn) { captured = fn; return 'handle'; },
    removeEventListener() { /* pretend removal is lazy */ },
  };
  const poses = [];
  const unsubscribe = subscribeHostState(backend, (p) => poses.push(p));
  unsubscribe();
  captured({ x: 0.5, y: 0.5, z: 0.5 });
  assert.equal(poses.length, 0);
});

test('listener, addEventListener and removeEventListener failures are contained', () => {
  const errors = [];
  const onError = (e) => errors.push(e.message);
  const backend = fakeBackend();
  const unsubscribe = subscribeHostState(backend, () => { throw new Error('listener'); }, { onError });
  assert.doesNotThrow(() => backend.emit(HOST_STATE_EVENT, { x: 0.5, y: 0.5, z: 0.5 }));
  unsubscribe();

  const broken = {
    addEventListener() { throw new Error('add'); },
    removeEventListener() { throw new Error('remove'); },
  };
  const noop = subscribeHostState(broken, () => {}, { onError });
  assert.doesNotThrow(noop);

  const failingRemove = { addEventListener: () => 1, removeEventListener() { throw new Error('remove'); } };
  assert.doesNotThrow(subscribeHostState(failingRemove, () => {}, { onError }));
  assert.deepEqual(errors, ['listener', 'add', 'remove']);
});

test('custom event ids are supported', () => {
  const backend = fakeBackend();
  const poses = [];
  subscribeHostState(backend, (p) => poses.push(p), { eventId: 'customState' });
  backend.emit('customState', { x: 0.5, y: 0.5, z: 1 });
  backend.emit(HOST_STATE_EVENT, { x: 0.5, y: 0.5, z: 0 });
  assert.deepEqual(poses, [{ x: 0, y: 0, z: 1 }]);
});

test('fetchHostState pulls and validates surfaceGetState, never rejecting', async () => {
  await withoutUnhandledRejections(async () => {
    const native = fakeNative();
    native.state.x = 1;
    assert.deepEqual(await fetchHostState(native.lookup), { x: 1, y: 0, z: 0.5 });
    assert.deepEqual(native.calls, [['surfaceGetState']]);

    const errors = [];
    const onError = (e) => errors.push(e);
    assert.equal(await fetchHostState(() => async () => false, { onError }), null);
    assert.equal(await fetchHostState(() => async () => ({ x: 2, y: 0, z: 0 }), { onError }), null);
    assert.equal(await fetchHostState(() => () => Promise.reject(new Error('down')), { onError }), null);
    assert.equal(await fetchHostState(() => { throw new Error('lookup'); }, { onError }), null);
    assert.equal(await fetchHostState(() => () => new Promise(() => {}), { onError, timeoutMs: 10 }), null);
    assert.equal(errors.length, 5);
    assert.ok(errors.slice(0, 3).every((e) => e instanceof NativeCallError));
  });
});
