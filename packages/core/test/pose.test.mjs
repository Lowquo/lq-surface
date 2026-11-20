import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, clampPose, equalPose, toParameters, fromParameters, intensity,
  NEUTRAL_POSE, PARAMETER_IDS,
} from '../dist/index.js';
import { prng, randomInDisk, randomFarPoint, direction, TAU, NON_FINITE } from './helpers.mjs';

const EPS = Number.EPSILON;
const insideDisk = (p) => p.x * p.x + p.y * p.y <= 1;
const validPose = (p) => insideDisk(p)
  && p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1 && p.z >= 0 && p.z <= 1
  && !Object.is(p.x, -0) && !Object.is(p.y, -0) && !Object.is(p.z, -0);

test('clamp: finite values are clamped; in-range values are untouched', () => {
  assert.equal(clamp(0.25, 0, 1), 0.25);
  assert.equal(clamp(-3, -1, 1), -1);
  assert.equal(clamp(3, -1, 1), 1);
  assert.equal(clamp(1e308, 0, 1), 1);
  assert.equal(clamp(-1e308, 0, 1), 0);
  assert.equal(clamp(5e-324, 0, 1), 5e-324);
  assert.ok(Object.is(clamp(-0, -1, 1), -0), 'in-range -0 is returned unchanged');
  assert.ok(Object.is(clamp(-0, 0, 1), 0), 'Math.max(0, -0) is +0');
  assert.equal(clamp(7, 2, 2), 2, 'min === max is a valid, degenerate range');
  assert.equal(clamp(5, 0, Infinity), 5, 'infinite bounds are allowed for finite values');
  assert.equal(clamp(-5, -Infinity, 0), -5);
});

test('clamp: non-finite values become the midpoint (pose-sanitizing rule)', () => {
  for (const bad of NON_FINITE) {
    assert.equal(clamp(bad, 0, 1), 0.5);
    assert.equal(clamp(bad, -1, 1), 0);
    assert.equal(clamp(bad, 2, 2), 2);
  }
  const huge = clamp(NaN, Number.MAX_VALUE * 0.75, Number.MAX_VALUE);
  assert.ok(Number.isFinite(huge) && huge >= Number.MAX_VALUE * 0.75 && huge <= Number.MAX_VALUE, 'midpoint does not overflow');
  assert.equal(clamp(NaN, -Number.MAX_VALUE, Number.MAX_VALUE), 0);
});

test('clamp: invalid ranges throw RangeError instead of returning a value', () => {
  assert.throws(() => clamp(0.5, 1, 0), RangeError, 'min > max');
  assert.throws(() => clamp(0.5, NaN, 1), RangeError);
  assert.throws(() => clamp(0.5, 0, NaN), RangeError);
  assert.throws(() => clamp(NaN, 0, Infinity), RangeError, 'no finite midpoint');
  assert.throws(() => clamp(Infinity, -Infinity, Infinity), RangeError);
});

test('clampPose: far-out points project radially and satisfy x*x + y*y <= 1 exactly', () => {
  const rand = prng(0xd15c);
  for (let i = 0; i < 100_000; i++) {
    const q = i % 2 ? randomFarPoint(rand) : { x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() }; // square corners included
    const p = clampPose(q);
    assert.ok(validPose(p), `invalid ${JSON.stringify(p)} from ${JSON.stringify(q)}`);
    if (insideDisk(q)) {
      assert.deepEqual(p, { x: q.x + 0, y: q.y + 0, z: q.z }, 'points inside the disk are unchanged');
      continue;
    }
    // On the rim (pulled in by at most a few ulps) and in the same direction.
    assert.ok(p.x * p.x + p.y * p.y >= 1 - 4 * EPS, 'lands on the rim');
    const scale = Math.max(Math.abs(q.x), Math.abs(q.y));
    const cross = p.x * (q.y / scale) - p.y * (q.x / scale);
    const dot = p.x * (q.x / scale) + p.y * (q.y / scale);
    assert.ok(Math.abs(cross) <= 4 * EPS && dot > 0, `direction changed for ${JSON.stringify(q)}`);
  }
});

test('clampPose: rim points computed from many directions stay inside', () => {
  const rand = prng(42);
  for (let i = 0; i < 100_000; i++) {
    const p = clampPose({ ...direction(rand() * TAU), z: 0.5 });
    assert.ok(insideDisk(p));
  }
});

test('clampPose: huge, tiny, denormal and -0 values', () => {
  const s = 0.7071067811865475; // 1 / Math.hypot(1, 1), one ulp below Math.SQRT1_2
  assert.deepEqual(clampPose({ x: 1e308, y: 1e308, z: 1e308 }), { x: s, y: s, z: 1 });
  assert.deepEqual(clampPose({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE, z: -Number.MAX_VALUE }), { x: s, y: -s, z: 0 });
  assert.deepEqual(clampPose({ x: -1e308, y: 0, z: 0.5 }), { x: -1, y: 0, z: 0.5 });
  assert.deepEqual(clampPose({ x: 1e308, y: 5e-324, z: 0.5 }), { x: 1, y: 0, z: 0.5 });
  assert.deepEqual(clampPose({ x: 5, y: 0.5, z: 0 }), { x: 0.995037190209989, y: 0.0995037190209989, z: 0 }, 'radial, not per-axis');
  assert.deepEqual(clampPose({ x: 5e-324, y: -5e-324, z: 5e-324 }), { x: 5e-324, y: -5e-324, z: 5e-324 }, 'denormals are preserved');
  assert.deepEqual(clampPose({ x: 1e-310, y: 2.2250738585072014e-308, z: 1 - EPS / 2 }), { x: 1e-310, y: 2.2250738585072014e-308, z: 1 - EPS / 2 });
  const zero = clampPose({ x: -0, y: -0, z: -0 });
  assert.ok(Object.is(zero.x, 0) && Object.is(zero.y, 0) && Object.is(zero.z, 0), 'never returns -0');
  assert.ok(Object.is(clampPose({ x: -0, y: -3, z: 0 }).x, 0));
});

test('clampPose: NaN and ±Infinity are replaced per axis, independently', () => {
  for (const bad of NON_FINITE) {
    assert.deepEqual(clampPose({ x: bad, y: 0.3, z: 0.7 }), { x: 0, y: 0.3, z: 0.7 });
    assert.deepEqual(clampPose({ x: -0.3, y: bad, z: 0.2 }), { x: -0.3, y: 0, z: 0.2 });
    assert.deepEqual(clampPose({ x: 0.1, y: -0.2, z: bad }), { x: 0.1, y: -0.2, z: 0.5 });
    assert.deepEqual(clampPose({ x: bad, y: 2, z: bad }), { x: 0, y: 1, z: 0.5 });
    assert.deepEqual(clampPose({ x: bad, y: bad, z: bad }), NEUTRAL_POSE);
  }
});

test('clampPose: idempotent, fresh objects, NEUTRAL_POSE stays frozen', () => {
  const rand = prng(7);
  const pick = () => [rand() * 4 - 2, 1e308, -1e308, 5e-324, -0, ...NON_FINITE][Math.floor(rand() * 8)];
  for (let i = 0; i < 50_000; i++) {
    const q = i % 3 === 0 ? { x: pick(), y: pick(), z: pick() } : i % 3 === 1 ? randomFarPoint(rand) : randomInDisk(rand);
    const once = clampPose(q);
    assert.deepEqual(clampPose(once), once);
  }
  assert.ok(Object.isFrozen(NEUTRAL_POSE));
  assert.ok(Object.isFrozen(PARAMETER_IDS));
  const copy = clampPose(NEUTRAL_POSE);
  assert.notEqual(copy, NEUTRAL_POSE);
  assert.notEqual(fromParameters(0.5, 0.5, 0.5), NEUTRAL_POSE);
  copy.x = 0.9; // the returned object is the caller's own
  assert.deepEqual(NEUTRAL_POSE, { x: 0, y: 0, z: 0.5 });
  assert.notEqual(clampPose(copy), copy);
});

test('equalPose: symmetric, NaN-safe, uses strict < epsilon', () => {
  const rand = prng(99);
  const values = [0, 0.5, -0.5, 1e-7, NaN, Infinity];
  for (let i = 0; i < 2_000; i++) {
    const v = () => (rand() < 0.2 ? values[Math.floor(rand() * values.length)] : rand());
    const a = { x: v(), y: v(), z: v() };
    const b = { x: v(), y: v(), z: v() };
    const eps = [1e-6, 0.1, 0.5][i % 3];
    assert.equal(equalPose(a, b, eps), equalPose(b, a, eps));
  }
  assert.ok(equalPose(NEUTRAL_POSE, { x: 9e-7, y: -9e-7, z: 0.5 }));
  assert.ok(!equalPose(NEUTRAL_POSE, { x: 1e-6, y: 0, z: 0.5 }), 'difference equal to epsilon is not equal');
  assert.ok(!equalPose({ x: NaN, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }));
  assert.ok(!equalPose({ x: Infinity, y: 0, z: 0 }, { x: Infinity, y: 0, z: 0 }));
  assert.ok(!equalPose(NEUTRAL_POSE, NEUTRAL_POSE, 0));
  assert.ok(equalPose({ x: -0, y: 0, z: 0 }, { x: 0, y: -0, z: 0 }));
});

test('toParameters: canonical order, every value finite and in [0, 1]', () => {
  const rand = prng(3);
  for (let i = 0; i < 20_000; i++) {
    const q = i % 2 ? randomFarPoint(rand) : { x: NON_FINITE[i % 3], y: rand() * 6 - 3, z: rand() * 6 - 3 };
    const params = toParameters(q);
    assert.deepEqual(params.map((p) => p.id), [...PARAMETER_IDS]);
    for (const { value } of params) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
  assert.deepEqual(toParameters({ x: -1, y: 0, z: 1 }), [
    { id: 'surface_x', value: 0 }, { id: 'surface_y', value: 0.5 }, { id: 'surface_z', value: 1 },
  ]);
  assert.notEqual(toParameters(NEUTRAL_POSE), toParameters(NEUTRAL_POSE));
});

test('fromParameters(toParameters(p)) round trips within a few ulps', () => {
  const rand = prng(11);
  let worst = 0;
  for (let i = 0; i < 100_000; i++) {
    const p = i % 10 ? randomInDisk(rand) : clampPose({ ...direction(rand() * TAU), z: rand() }); // include the rim
    const [x, y, z] = toParameters(p).map((v) => v.value);
    const back = fromParameters(x, y, z);
    worst = Math.max(worst, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
    assert.equal(back.z, p.z);
    assert.ok(validPose(back));
  }
  assert.ok(worst <= 2 * EPS, `round-trip error ${worst}`);
});

test('fromParameters: host values are clamped; points outside the disk project onto it', () => {
  const s = 0.7071067811865475;
  assert.deepEqual(fromParameters(1, 1, 0.25), { x: s, y: s, z: 0.25 });
  assert.deepEqual(fromParameters(0, 0, 0.25), { x: -s, y: -s, z: 0.25 });
  assert.deepEqual(fromParameters(-5, 7, 3), { x: -s, y: s, z: 1 });
  assert.deepEqual(fromParameters(0, 0.5, 0), { x: -1, y: 0, z: 0 });
  assert.deepEqual(fromParameters(NaN, Infinity, -Infinity), NEUTRAL_POSE);
  // The projection is display-only: re-reading it gives parameters inside the disk, not the host's (1, 1).
  const [x, y] = toParameters(fromParameters(1, 1, 0.25)).map((v) => v.value);
  assert.ok(x < 1 && y < 1);
});

test('intensity: in [0, 1], radial distance only', () => {
  const rand = prng(5);
  for (let i = 0; i < 20_000; i++) {
    const far = intensity(randomFarPoint(rand));
    assert.ok(far <= 1 && far >= 1 - 4 * EPS);
    const near = randomInDisk(rand);
    assert.equal(intensity(near), Math.hypot(near.x, near.y));
  }
  assert.equal(intensity(NEUTRAL_POSE), 0);
  assert.equal(intensity({ x: NaN, y: Infinity, z: 0 }), 0);
  assert.equal(intensity({ x: 0, y: -0.5, z: 0.99 }), intensity({ x: 0.5, y: 0, z: 0 }));
});
