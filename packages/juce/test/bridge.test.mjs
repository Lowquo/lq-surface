import test from 'node:test';
import assert from 'node:assert/strict';
import { createJuceBridge, SurfaceHostController } from '../dist/index.js';

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
