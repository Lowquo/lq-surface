import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPose, fromParameters, toParameters, regionWeights, intensity,
  sanitizedParameter, NEUTRAL_POSE,
} from '../dist/index.js';

test('neutral maps to centre and character midpoint', () => {
  assert.deepEqual(toParameters(NEUTRAL_POSE), [
    { id: 'surface_x', value: .5 },
    { id: 'surface_y', value: .5 },
    { id: 'surface_z', value: .5 },
  ]);
});

test('clamps to unit disk and finite bounds', () => {
  const p = clampPose({ x: 1, y: 1, z: 99 });
  assert.ok(Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-9);
  assert.equal(p.z, 1);
  assert.deepEqual(clampPose({ x: NaN, y: Infinity, z: NaN }), NEUTRAL_POSE);
});

test('parameter round trip', () => {
  const source = { x: .15, y: -.6, z: .75 };
  const [x, y, z] = toParameters(source);
  const p = fromParameters(x.value, y.value, z.value);
  assert.ok(Math.abs(p.x - source.x) < 1e-9);
  assert.ok(Math.abs(p.y - source.y) < 1e-9);
  assert.equal(p.z, source.z);
});

test('neutral weights are zero; active weights sum to one', () => {
  assert.ok(regionWeights(NEUTRAL_POSE).every((w) => w.weight === 0));
  const weights = regionWeights({ x: .2, y: -.7, z: 1 });
  assert.ok(Math.abs(weights.reduce((sum, w) => sum + w.weight, 0) - 1) < 1e-9);
  assert.equal(weights.reduce((best, w) => w.weight > best.weight ? w : best).name, 'PUNCH');
});

test('intensity ignores twist; validates parameter values', () => {
  assert.equal(intensity({ x: 0, y: -.5, z: .99 }), .5);
  assert.deepEqual(sanitizedParameter('surface_z', 8), { id: 'surface_z', value: 1 });
  assert.throws(() => sanitizedParameter('not-a-parameter', 0), /Unknown/);
});
