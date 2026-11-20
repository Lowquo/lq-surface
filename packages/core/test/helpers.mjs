// Shared deterministic test helpers (not a test file: not matched by *.test.mjs).

/** mulberry32: small, fast, deterministic 32-bit PRNG returning values in [0, 1). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;

/** Direction for a screen-convention angle (0 = top, clockwise). */
export const direction = (angle) => ({ x: Math.sin(angle), y: -Math.cos(angle) });

/** Uniformly distributed pose strictly inside the disk of `maxRadius` (< 1). */
export function randomInDisk(rand, maxRadius = 1) {
  const r = maxRadius * Math.sqrt(rand());
  const { x, y } = direction(rand() * TAU);
  return { x: r * x, y: r * y, z: rand() };
}

/** A far-out point: random direction, radius log-uniform in [1, 1e308]. */
export function randomFarPoint(rand) {
  const r = 10 ** (rand() * 308);
  const { x, y } = direction(rand() * TAU);
  return { x: r * x, y: r * y, z: rand() * 4 - 2 };
}

export const NON_FINITE = [NaN, Infinity, -Infinity];

export const sum = (weights) => weights.reduce((total, entry) => total + entry.weight, 0);
