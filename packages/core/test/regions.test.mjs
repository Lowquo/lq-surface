import test from 'node:test';
import assert from 'node:assert/strict';
import {
  regionWeights, evenlySpacedRegions, dominantRegion, blendRegionValues, intensity, clampPose,
  DEFAULT_REGIONS, DEFAULT_REGION_SHARPNESS, REGION_NEUTRAL_RADIUS, NEUTRAL_POSE,
} from '../dist/index.js';
import { LEGACY_REGION_ORDER, LEGACY_REGION_WEIGHTS } from './legacy-fixtures.mjs';
import { prng, randomInDisk, randomFarPoint, direction, TAU, NON_FINITE, sum } from './helpers.mjs';

const EPS = Number.EPSILON;
const at = (angle, radius = 1, z = 0.5) => {
  const d = direction(angle);
  return { x: radius * d.x, y: radius * d.y, z };
};

test('default output is bit-identical to version 0.1.0 (captured fixtures)', () => {
  assert.equal(LEGACY_REGION_WEIGHTS.length, 88);
  for (const [x, y, z, expected] of LEGACY_REGION_WEIGHTS) {
    const pose = { x, y, z };
    for (const weights of [
      regionWeights(pose),
      regionWeights(pose, DEFAULT_REGIONS),
      regionWeights(pose, undefined, { sharpness: 4 }),
      regionWeights(pose, evenlySpacedRegions(['PUNCH', 'TONE', 'CLIP', 'CRUSH', 'GLUE'])),
    ]) {
      assert.deepEqual(weights.map((w) => w.name), LEGACY_REGION_ORDER);
      weights.forEach((w, i) => assert.ok(Object.is(w.weight, expected[i]), `${JSON.stringify(pose)} ${w.name}: ${w.weight} !== ${expected[i]}`));
    }
  }
});

test('DEFAULT_REGIONS: five frozen regions, clockwise from the top', () => {
  assert.equal(DEFAULT_REGION_SHARPNESS, 4);
  assert.deepEqual(DEFAULT_REGIONS.map((r) => r.name), ['PUNCH', 'TONE', 'CLIP', 'CRUSH', 'GLUE']);
  assert.deepEqual(DEFAULT_REGIONS.map((r) => r.angle), [0, 1, 2, 3, 4].map((i) => (Math.PI * 2 * i) / 5));
  assert.ok(Object.isFrozen(DEFAULT_REGIONS) && DEFAULT_REGIONS.every(Object.isFrozen));
});

test('angle convention: 0 = top (-y), clockwise on screen', () => {
  const compass = [
    { name: 'top', angle: 0 }, { name: 'right', angle: Math.PI / 2 },
    { name: 'bottom', angle: Math.PI }, { name: 'left', angle: (3 * Math.PI) / 2 },
  ];
  const lead = (pose) => dominantRegion(regionWeights(pose, compass))?.name;
  assert.equal(lead({ x: 0, y: -1, z: 0 }), 'top');
  assert.equal(lead({ x: 1, y: 0, z: 0 }), 'right');
  assert.equal(lead({ x: 0, y: 1, z: 0 }), 'bottom');
  assert.equal(lead({ x: -1, y: 0, z: 0 }), 'left');
  assert.equal(lead({ x: 0.2, y: -0.7, z: 1 }), 'top');
  assert.equal(dominantRegion(regionWeights(at(Math.PI / 2 + 0.1))).name, 'TONE', 'TONE is clockwise of PUNCH');
});

test('evenlySpacedRegions: spacing, offset, freezing and validation', () => {
  assert.deepEqual(evenlySpacedRegions([]), []);
  for (let n = 1; n <= 12; n++) {
    const names = Array.from({ length: n }, (_, i) => `R${i}`);
    const regions = evenlySpacedRegions(names, 0.25);
    assert.equal(regions.length, n);
    assert.ok(Object.isFrozen(regions) && regions.every(Object.isFrozen));
    regions.forEach((r, i) => {
      assert.equal(r.name, names[i]);
      assert.ok(Math.abs(r.angle - (0.25 + (TAU * i) / n)) <= 4 * EPS);
    });
  }
  for (const bad of NON_FINITE) assert.throws(() => evenlySpacedRegions(['A'], bad), RangeError);
});

test('weights: finite, in [0, 1], sum to 1 away from neutral, for many region sets', () => {
  const rand = prng(0xbeef);
  for (let n = 1; n <= 12; n++) {
    const regions = evenlySpacedRegions(Array.from({ length: n }, (_, i) => `R${i}`), rand() * TAU);
    for (const sharpness of [0.5, 1, 2, 4, 8, 64, 1000, 1e6]) {
      for (let i = 0; i < 300; i++) {
        const pose = i % 3 ? randomInDisk(rand) : randomFarPoint(rand);
        if (intensity(pose) < 1e-7) continue;
        const weights = regionWeights(pose, regions, { sharpness });
        assert.equal(weights.length, n);
        for (const { weight } of weights) assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1, `n=${n} s=${sharpness} ${weight}`);
        assert.ok(Math.abs(sum(weights) - 1) <= n * EPS, `n=${n} s=${sharpness} sum ${sum(weights)}`);
      }
    }
  }
});

test('neutral: all-zero weights below REGION_NEUTRAL_RADIUS, normalized just above it', () => {
  assert.equal(REGION_NEUTRAL_RADIUS, 1e-8);
  for (const pose of [NEUTRAL_POSE, at(1, 9.9e-9), { x: NaN, y: Infinity, z: 0 }, { x: -0, y: -0, z: 1 }]) {
    assert.ok(regionWeights(pose).every((w) => w.weight === 0));
    assert.ok(regionWeights(pose, evenlySpacedRegions(['A', 'B', 'C']), { sharpness: 2 }).every((w) => w.weight === 0));
  }
  assert.ok(Math.abs(sum(regionWeights(at(1, 1.01e-8))) - 1) <= 5 * EPS);
  assert.deepEqual(regionWeights(NEUTRAL_POSE, []), []);
  assert.deepEqual(regionWeights(at(1), []), []);
});

test('weights are continuous under small angle changes', () => {
  // Empirically max |dw/dθ| <= max(1, sharpness) / 2 for 2-12 evenly spaced regions; allow 2x.
  const rand = prng(0xc0ffee);
  const delta = 1e-6;
  for (const [regions, sharpness] of [[DEFAULT_REGIONS, 4], [evenlySpacedRegions(['A', 'B']), 16], [evenlySpacedRegions(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), 1]]) {
    for (let i = 0; i < 5_000; i++) {
      const angle = rand() * TAU;
      const radius = 0.05 + rand() * 0.95;
      const a = regionWeights(at(angle, radius), regions, { sharpness });
      const b = regionWeights(at(angle + delta, radius), regions, { sharpness });
      a.forEach((w, k) => assert.ok(Math.abs(w.weight - b[k].weight) <= Math.max(1, sharpness) * delta + 1e-13));
    }
  }
});

test('weights depend on direction only, not radius or z', () => {
  const rand = prng(17);
  for (let i = 0; i < 2_000; i++) {
    const angle = rand() * TAU;
    const a = regionWeights(at(angle, 0.3, 0));
    const b = regionWeights(at(angle, 0.9, 1));
    a.forEach((w, k) => assert.ok(Math.abs(w.weight - b[k].weight) <= 1e-12));
  }
});

test('degenerate geometry and extreme sharpness stay normalized', () => {
  const single = [{ name: 'ONLY', angle: 0 }];
  assert.deepEqual(regionWeights({ x: 0, y: 1, z: 0 }, single), [{ name: 'ONLY', weight: 1 }], 'exactly opposite the only region');
  assert.deepEqual(regionWeights(at(2.5, 0.4), single), [{ name: 'ONLY', weight: 1 }]);
  const twins = [{ name: 'A', angle: 0 }, { name: 'B', angle: 0 }];
  assert.deepEqual(regionWeights({ x: 0, y: 1, z: 0 }, twins).map((w) => w.weight), [0.5, 0.5], 'ties share equally');
  // Nearly opposite two close regions: the direct formula underflows to 0 / 0.
  const close = [{ name: 'A', angle: 0 }, { name: 'B', angle: 0.002 }];
  const split = regionWeights(at(Math.PI + 0.001), close, { sharpness: 50 });
  assert.ok(Math.abs(split[0].weight - 0.5) < 1e-6 && Math.abs(split[1].weight - 0.5) < 1e-6);
  assert.ok(Math.abs(sum(split) - 1) <= 2 * EPS);
  // Huge sharpness: the closest region takes (almost) everything.
  const tone = regionWeights(at((Math.PI * 2) / 5, 0.7), DEFAULT_REGIONS, { sharpness: 1e6 });
  assert.equal(dominantRegion(tone).name, 'TONE');
  assert.ok(tone[1].weight > 1 - 1e-12 && Math.abs(sum(tone) - 1) <= 5 * EPS);
  const between = regionWeights(at(Math.PI / 5), DEFAULT_REGIONS, { sharpness: 7500 });
  assert.ok(Math.abs(between[0].weight - 0.5) < 1e-9 && Math.abs(between[1].weight - 0.5) < 1e-9);
});

test('regionWeights validates arguments', () => {
  for (const sharpness of [0, -1, NaN, Infinity]) assert.throws(() => regionWeights(at(1), undefined, { sharpness }), RangeError);
  for (const angle of NON_FINITE) assert.throws(() => regionWeights(at(1), [{ name: 'A', angle }]), RangeError);
  assert.throws(() => regionWeights(at(1), 0), TypeError);
  assert.throws(() => regionWeights(at(1), { name: 'A', angle: 0 }), TypeError);
});

test('regionWeights returns fresh entries and does not mutate inputs', () => {
  const regions = Object.freeze([Object.freeze({ name: 'A', angle: 0 }), Object.freeze({ name: 'B', angle: 3 })]);
  const pose = Object.freeze({ x: 0.2, y: -0.3, z: 0.1 });
  const a = regionWeights(pose, regions);
  const b = regionWeights(pose, regions);
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  assert.deepEqual(a, b);
});

test('dominantRegion: first maximum, undefined at neutral or when empty', () => {
  assert.equal(dominantRegion([]), undefined);
  assert.equal(dominantRegion(regionWeights(NEUTRAL_POSE)), undefined);
  const weights = [{ name: 'A', weight: 0.2 }, { name: 'B', weight: 0.4 }, { name: 'C', weight: 0.4 }];
  assert.equal(dominantRegion(weights), weights[1]);
  assert.equal(dominantRegion([{ name: 'A', weight: NaN }, { name: 'B', weight: 0.1 }]).name, 'B');
  assert.equal(dominantRegion([{ name: 'A', weight: 0 }, { name: 'B', weight: -1 }]), undefined);
  // Matches the playground's inline `reduce` away from neutral.
  const rand = prng(23);
  for (let i = 0; i < 5_000; i++) {
    const w = regionWeights(randomInDisk(rand));
    if (w.every((e) => e.weight === 0)) continue;
    assert.equal(dominantRegion(w), w.reduce((best, e) => (e.weight > best.weight ? e : best)));
  }
});

const BLEND = Object.freeze({
  regions: DEFAULT_REGIONS,
  neutral: Object.freeze([0.5, 0, 1, -2]),
  targets: Object.freeze({
    PUNCH: Object.freeze([1, 0.2, 0, 3]),
    TONE: Object.freeze([0, 0.4, 0, -4]),
    CLIP: Object.freeze([0.75, 0.6, 1, 0]),
    CRUSH: Object.freeze([0.25, 0.8, 0.5, 10]),
    GLUE: Object.freeze([0.5, 1, 0.25, -2]),
  }),
});

test('blendRegionValues: exact neutral at the centre, fresh array', () => {
  for (const pose of [NEUTRAL_POSE, at(2, 9e-9), { x: NaN, y: NaN, z: 0 }]) {
    const out = blendRegionValues(pose, BLEND);
    assert.deepEqual(out, [...BLEND.neutral]);
    assert.notEqual(out, BLEND.neutral);
  }
  assert.deepEqual(blendRegionValues(at(1), { regions: [], neutral: [3, 4], targets: {} }), [3, 4], 'no regions → neutral');
  assert.deepEqual(blendRegionValues(at(1), { regions: [], neutral: [], targets: {} }), []);
});

test('blendRegionValues: matches its formula and stays within each component range', () => {
  const rand = prng(0xb1e4d);
  for (let i = 0; i < 20_000; i++) {
    const pose = i % 4 ? randomInDisk(rand) : randomFarPoint(rand);
    const sharpness = [1, 4, 9][i % 3];
    const out = blendRegionValues(pose, BLEND, { sharpness });
    const weights = regionWeights(pose, DEFAULT_REGIONS, { sharpness });
    const a = intensity(pose);
    out.forEach((value, j) => {
      const column = DEFAULT_REGIONS.map((r) => BLEND.targets[r.name][j]);
      const mix = weights.reduce((total, w, k) => total + w.weight * column[k], 0);
      const expected = (1 - a) * BLEND.neutral[j] + a * mix;
      assert.ok(Math.abs(value - expected) <= 1e-14 * (1 + Math.abs(expected)), `${value} vs ${expected}`);
      assert.ok(Number.isFinite(value));
      assert.ok(value >= Math.min(BLEND.neutral[j], ...column) && value <= Math.max(BLEND.neutral[j], ...column));
    });
  }
});

test('blendRegionValues: reaches a lone target exactly and is continuous through neutral', () => {
  const lone = { regions: [{ name: 'UP', angle: 0 }], neutral: [0.1, 0.3], targets: { UP: [0.7, 0.9] } };
  assert.deepEqual(blendRegionValues({ x: 0, y: -1, z: 0 }, lone), [0.7, 0.9]);
  assert.deepEqual(blendRegionValues({ x: 0, y: -5, z: 0 }, lone), [0.7, 0.9]);
  const rand = prng(31);
  for (let i = 0; i < 2_000; i++) {
    const r = 10 ** (-1 - rand() * 9);
    const out = blendRegionValues(at(rand() * TAU, r), BLEND);
    out.forEach((value, j) => assert.ok(Math.abs(value - BLEND.neutral[j]) <= r * 14 * (1 + 1e-9), `r=${r} drift ${value - BLEND.neutral[j]}`));
  }
});

test('blendRegionValues validates vectors', () => {
  const base = { regions: [{ name: 'A', angle: 0 }], neutral: [0, 0] };
  assert.throws(() => blendRegionValues(at(1), { ...base, targets: {} }), RangeError, 'missing target');
  assert.throws(() => blendRegionValues(at(1), { ...base, targets: { A: [1] } }), RangeError, 'length mismatch');
  assert.throws(() => blendRegionValues(at(1), { ...base, targets: { A: [1, NaN] } }), RangeError);
  assert.throws(() => blendRegionValues(at(1), { ...base, neutral: [0, Infinity], targets: { A: [1, 1] } }), RangeError);
  assert.throws(() => blendRegionValues(at(1), { regions: [{ name: 'toString', angle: 0 }], neutral: [0], targets: {} }), RangeError, 'inherited keys are not targets');
  assert.throws(() => blendRegionValues(at(1), { ...base, targets: { A: [1, 1] } }, { sharpness: 0 }), RangeError);
});

test('clampPose output feeds regionWeights unchanged (pose path is consistent)', () => {
  const rand = prng(77);
  for (let i = 0; i < 2_000; i++) {
    const q = randomFarPoint(rand);
    assert.deepEqual(regionWeights(q), regionWeights(clampPose(q)));
  }
});
