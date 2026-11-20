// Verbatim port of the @lowquo/surface 0.1.0 region-weight computation (commit 3df553c,
// packages/core/src/index.ts): only the TypeScript types are removed. Do not "improve" or
// refactor this file; it is a test oracle.
//
// Why an oracle in addition to the captured fixtures: Math.sin, Math.cos, Math.hypot and
// Math.pow are implementation-approximated in ECMAScript, so their last bit can change between
// JavaScript engines and engine versions (e.g. V8's Math.pow changed by 1 ulp between V8 12.4 in
// Node 22 and V8 13.6 in Node 24). Evaluating this oracle on the same engine as the current
// implementation lets the tests demand exact (Object.is) equality on every runtime, so any change
// to the formula is still caught bit-for-bit.

export function legacyClamp(value, min, max) {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

// Note: 0.1.0 clamped each axis before projecting onto the disk; 0.1 hardening projects radially.
// The two agree exactly for poses inside the unit disk, which is where the oracle is compared.
export function legacyClampPose(pose) {
  let x = legacyClamp(pose.x, -1, 1);
  let y = legacyClamp(pose.y, -1, 1);
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y, z: legacyClamp(pose.z, 0, 1) };
}

const REGION_DIRECTIONS = [
  ['PUNCH', 0, -1],
  ['TONE', Math.sin(Math.PI * 2 / 5), -Math.cos(Math.PI * 2 / 5)],
  ['CLIP', Math.sin(Math.PI * 4 / 5), -Math.cos(Math.PI * 4 / 5)],
  ['CRUSH', Math.sin(Math.PI * 6 / 5), -Math.cos(Math.PI * 6 / 5)],
  ['GLUE', Math.sin(Math.PI * 8 / 5), -Math.cos(Math.PI * 8 / 5)],
];

/** Normalised positive region proximity. Weights sum to 1 away from neutral. */
export function legacyRegionWeights(pose) {
  const p = legacyClampPose(pose);
  const radius = Math.hypot(p.x, p.y);
  if (radius < 1e-8) return REGION_DIRECTIONS.map(([name]) => ({ name, weight: 0 }));
  const amounts = REGION_DIRECTIONS.map(([name, dx, dy]) => ({
    name,
    weight: Math.pow(Math.max(0, (1 + (p.x * dx + p.y * dy) / radius) / 2), 4),
  }));
  const total = amounts.reduce((sum, entry) => sum + entry.weight, 0);
  return amounts.map((entry) => ({ name: entry.name, weight: entry.weight / total }));
}
