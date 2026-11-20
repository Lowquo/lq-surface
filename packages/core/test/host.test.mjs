import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isParameterId, sanitizedParameter, toParameters, PARAMETER_IDS,
} from '../dist/index.js';
import { prng, randomFarPoint, NON_FINITE } from './helpers.mjs';

test('isParameterId accepts exactly the three IDs', () => {
  for (const id of PARAMETER_IDS) assert.equal(isParameterId(id), true);
  for (const value of [
    'surface_w', 'SURFACE_X', ' surface_x', 'surface_x ', '', 'toString', '__proto__',
    undefined, null, 0, 1, NaN, true, {}, ['surface_x'], new String('surface_x'), Symbol('surface_x'),
    { toString: () => 'surface_x' },
  ]) assert.equal(isParameterId(value), false, String(typeof value === 'symbol' ? 'symbol' : value));
});

test('sanitizedParameter rejects non-finite values instead of inventing 0.5', () => {
  for (const id of PARAMETER_IDS) {
    for (const bad of NON_FINITE) assert.throws(() => sanitizedParameter(id, bad), RangeError, `${id} ${bad}`);
    for (const bad of ['0.5', null, undefined, {}, 0n]) assert.throws(() => sanitizedParameter(id, bad), RangeError);
  }
});

test('sanitizedParameter checks the ID first and keeps its error message', () => {
  assert.throws(() => sanitizedParameter('not-a-parameter', 0), /Unknown parameter: not-a-parameter/);
  assert.throws(() => sanitizedParameter('not-a-parameter', NaN), /Unknown parameter/);
  assert.throws(() => sanitizedParameter(undefined, 0.5), /Unknown parameter/);
});

test('sanitizedParameter clamps finite values to [0, 1] and never emits -0', () => {
  const cases = [[0.25, 0.25], [0, 0], [1, 1], [-0.1, 0], [1.5, 1], [1e308, 1], [-1e308, 0], [5e-324, 5e-324], [1 - Number.EPSILON / 2, 1 - Number.EPSILON / 2]];
  for (const [input, expected] of cases) assert.deepEqual(sanitizedParameter('surface_x', input), { id: 'surface_x', value: expected });
  assert.ok(Object.is(sanitizedParameter('surface_y', -0).value, 0));
});

test('toParameters output always passes sanitizedParameter unchanged', () => {
  const rand = prng(101);
  for (let i = 0; i < 20_000; i++) {
    const pose = i % 2 ? randomFarPoint(rand) : { x: rand() * 4 - 2, y: NON_FINITE[i % 3], z: rand() * 4 - 2 };
    for (const { id, value } of toParameters(pose)) assert.ok(Object.is(sanitizedParameter(id, value).value, value));
  }
});

test('core stays dependency-free: no imports or requires in the source', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*(import|export\s+\*\s+from|export\s+\{[^}]*\}\s+from)\b/m);
  assert.doesNotMatch(source, /\brequire\s*\(|\bimport\s*\(/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});
