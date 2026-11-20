/**
 * Pure state and geometry for expressive audio-software controls.
 *
 * This module has no DOM, renderer, JUCE, Node or DSP dependencies and no
 * runtime dependencies. Every function is deterministic: the same inputs give
 * the same outputs on a given JavaScript engine.
 *
 * Two input-validation rules apply throughout:
 *
 * - **Poses are sanitized.** A non-finite pose component (`NaN`, `±Infinity`)
 *   is replaced by the neutral value for that axis, and out-of-range values are
 *   constrained (see {@link clampPose}). UI code can always render a pose.
 * - **Host writes are validated.** {@link sanitizedParameter} throws instead of
 *   inventing a value, so a corrupted number can never become a real host
 *   parameter write (and therefore an automation point).
 *
 * @packageDocumentation
 */

/**
 * A three-axis control position.
 *
 * - `x`, `y` in `[-1, 1]` with `x * x + y * y <= 1` (the unit disk). Screen
 *   convention: `x = -1` is left and `y = -1` is the **top**.
 * - `z` in `[0, 1]`: the character/twist axis.
 *
 * Every pose returned by this package satisfies these bounds exactly in
 * double-precision arithmetic. Poses you construct yourself may not; pass them
 * through {@link clampPose} first.
 */
export type Pose = Readonly<{ x: number; y: number; z: number }>;

/** A pose axis key: `'x' | 'y' | 'z'`. */
export type PoseAxis = keyof Pose;

/**
 * Names of the five {@link DEFAULT_REGIONS}. These are illustrative UI labels,
 * not audio algorithms. Use {@link Region} for your own region names.
 */
export type RegionName = 'PUNCH' | 'TONE' | 'CLIP' | 'CRUSH' | 'GLUE';

/**
 * A named direction in the x/y disk.
 *
 * `angle` is in radians, measured **clockwise on screen from the top**:
 * `0` points to the top (`y = -1`), `π / 2` to the right (`x = +1`), `π` to
 * the bottom and `3π / 2` to the left. The direction vector is
 * `(sin(angle), -cos(angle))`. Angles must be finite; any finite value is
 * accepted (no wrapping is required).
 */
export type Region<Name extends string = string> = Readonly<{ name: Name; angle: number }>;

/**
 * The weight of one region for a pose, as returned by {@link regionWeights}.
 * The type parameter defaults to {@link RegionName} for backward compatibility.
 */
export type RegionWeight<Name extends string = RegionName> = Readonly<{ name: Name; weight: number }>;

/** Options for {@link regionWeights} and {@link blendRegionValues}. */
export type RegionWeightOptions = Readonly<{
  /**
   * Exponent applied to each region's angular closeness before normalization.
   * Higher values make regions more selective. Must be finite and `> 0`.
   * Defaults to {@link DEFAULT_REGION_SHARPNESS}.
   */
  sharpness?: number;
}>;

/**
 * Per-region value vectors for {@link blendRegionValues}.
 *
 * `neutral` and every `targets[name]` must have the same length and contain
 * only finite numbers. `targets` must have an own entry for every region name.
 */
export type RegionBlend<Name extends string = string> = Readonly<{
  regions: readonly Region<Name>[];
  neutral: readonly number[];
  targets: Readonly<Record<Name, readonly number[]>>;
}>;

/** The three host-automatable parameter IDs, in {@link PARAMETER_IDS} order. */
export type ParameterId = 'surface_x' | 'surface_y' | 'surface_z';

/** A normalized host parameter value: `value` is finite and in `[0, 1]`. */
export type ParameterValue = Readonly<{ id: ParameterId; value: number }>;

/**
 * Write-only channel from the UI to the host (DAW) parameter system.
 *
 * Callers (for example `SurfaceHostController` in `@lowquo/surface-juce`) must
 * follow this contract; implementations may rely on it:
 *
 * 1. **Begin before set.** For each `id`, `setParameter(id, …)` is only called
 *    between `beginGesture(id)` and the matching `endGesture(id)`. Hosts use
 *    gestures to decide when to record automation (touch/latch modes).
 * 2. **Balanced gestures.** Every `beginGesture(id)` is followed by exactly one
 *    `endGesture(id)`, and a gesture is never begun again for an `id` that is
 *    already inside a gesture. Different IDs may overlap (a pointer drag opens
 *    all three together).
 * 3. **Valid values.** `value` is finite and in `[0, 1]`. Produce values with
 *    {@link toParameters} or {@link sanitizedParameter}; never forward `NaN`,
 *    `±Infinity` or unvalidated input.
 * 4. **Ordering.** Implementations must deliver calls to the host in the order
 *    they were made (at least per `id`; the JUCE bridge serializes all calls).
 *    Callers may therefore fire calls without awaiting them. A returned promise
 *    settles when the host has accepted (resolve) or failed (reject) that call.
 *    Implementations may throw or reject for contract violations.
 * 5. **The host is authoritative.** The bridge never reads state. Host
 *    automation, project recall and other editors may change parameters at any
 *    time; the UI must display host state (for example via
 *    {@link fromParameters}) and must not echo host-originated changes back
 *    through the bridge. Writes happen only as a result of a user gesture.
 *
 * Implementations run on the UI/message side and must not touch the audio
 * thread directly.
 */
export interface ParameterBridge {
  /** Start a user gesture for `id` (host "begin change gesture"). */
  beginGesture(id: ParameterId): void | Promise<void>;
  /** Write a normalized, finite `value` in `[0, 1]` for `id` during a gesture. */
  setParameter(id: ParameterId, value: number): void | Promise<void>;
  /** End the user gesture for `id` started by {@link ParameterBridge.beginGesture}. */
  endGesture(id: ParameterId): void | Promise<void>;
}

/** The neutral pose `{ x: 0, y: 0, z: 0.5 }`. Frozen; functions never return this object itself. */
export const NEUTRAL_POSE: Pose = Object.freeze({ x: 0, y: 0, z: 0.5 });

/** All parameter IDs in canonical order: `surface_x`, `surface_y`, `surface_z`. Frozen. */
export const PARAMETER_IDS: readonly ParameterId[] = Object.freeze(['surface_x', 'surface_y', 'surface_z']);

/** Default {@link RegionWeightOptions.sharpness}: `4`. */
export const DEFAULT_REGION_SHARPNESS = 4;

/**
 * Radius below which a pose counts as neutral for region weighting: when the
 * constrained pose has `Math.hypot(x, y) < REGION_NEUTRAL_RADIUS` (`1e-8`),
 * {@link regionWeights} returns all-zero weights.
 */
export const REGION_NEUTRAL_RADIUS = 1e-8;

/**
 * Type guard for the three known parameter IDs. Accepts any value, so it can
 * validate untrusted payloads (for example from a native host).
 */
export function isParameterId(value: unknown): value is ParameterId {
  return typeof value === 'string' && (PARAMETER_IDS as readonly string[]).includes(value);
}

/**
 * Constrain `value` to `[min, max]`.
 *
 * - A finite `value` is clamped with `Math.min(max, Math.max(min, value))`;
 *   in-range values (including `-0`) are returned unchanged. Infinite bounds
 *   are allowed for finite values.
 * - A non-finite `value` (`NaN`, `±Infinity`) is replaced by the midpoint
 *   `(min + max) / 2`. This is the pose-sanitizing rule; for host writes use
 *   {@link sanitizedParameter}, which throws instead.
 *
 * @throws RangeError if `min` or `max` is `NaN`, if `min > max`, or if `value`
 *   is non-finite and the midpoint is not finite (an infinite bound).
 */
export function clamp(value: number, min: number, max: number): number {
  if (!(min <= max)) throw new RangeError(`clamp: invalid range [${String(min)}, ${String(max)}]`);
  if (Number.isFinite(value)) return Math.min(max, Math.max(min, value));
  const midpoint = (min + max) / 2;
  if (Number.isFinite(midpoint)) return midpoint;
  const halves = min / 2 + max / 2; // avoids overflow of min + max near ±Number.MAX_VALUE
  if (Number.isFinite(halves)) return halves;
  throw new RangeError(`clamp: no finite midpoint to substitute for ${String(value)} in [${String(min)}, ${String(max)}]`);
}

/** Each step scales by one ulp below 1. */
const INWARD_STEP = 1 - Number.EPSILON;

/** Radial projection onto the closed unit disk, exact in double precision. Inputs must be finite. */
function projectToUnitDisk(x: number, y: number): readonly [number, number] {
  if (x * x + y * y <= 1) return [x + 0, y + 0];
  const largest = Math.max(Math.abs(x), Math.abs(y));
  if (largest > 1) { x /= largest; y /= largest; } // pre-scale so Math.hypot cannot overflow
  const length = Math.hypot(x, y);
  x /= length;
  y /= length;
  // Rounding can leave x * x + y * y a few ulps above 1. The larger coordinate is at
  // least 1/√2 here, so each step shrinks it by at least one ulp: this terminates,
  // normally after zero to two iterations.
  while (x * x + y * y > 1) { x *= INWARD_STEP; y *= INWARD_STEP; }
  return [x + 0, y + 0]; // `+ 0` turns -0 into +0
}

/**
 * Return a fresh pose that satisfies the {@link Pose} bounds.
 *
 * - A non-finite component is replaced by its neutral value (`x`, `y` → `0`,
 *   `z` → `0.5`), independently per axis.
 * - A point outside the unit disk is projected **radially** onto its rim, which
 *   keeps its direction (angle). The result satisfies `x * x + y * y <= 1` when
 *   evaluated in double precision. Points already inside are returned unchanged.
 * - `z` is clamped to `[0, 1]`.
 * - The result never contains `-0`.
 *
 * Idempotent: `clampPose(clampPose(p))` equals `clampPose(p)` exactly.
 */
export function clampPose(pose: Pose): Pose {
  const [x, y] = projectToUnitDisk(Number.isFinite(pose.x) ? pose.x : 0, Number.isFinite(pose.y) ? pose.y : 0);
  return { x, y, z: clamp(pose.z, 0, 1) };
}

/**
 * True when every axis differs by strictly less than `epsilon` (default
 * `1e-6`). Symmetric. Returns `false` if any component is `NaN` or infinite
 * (so it is reflexive only for finite poses), and always `false` for
 * `epsilon <= 0`. Not transitive.
 */
export function equalPose(a: Pose, b: Pose, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) < epsilon
    && Math.abs(a.y - b.y) < epsilon
    && Math.abs(a.z - b.z) < epsilon;
}

/**
 * Map a pose to host parameter values, in {@link PARAMETER_IDS} order:
 * `surface_x = (x + 1) / 2`, `surface_y = (y + 1) / 2`, `surface_z = z`, after
 * {@link clampPose}. Every value is finite and in `[0, 1]`. Returns fresh objects.
 */
export function toParameters(pose: Pose): readonly ParameterValue[] {
  const p = clampPose(pose);
  return [
    { id: 'surface_x', value: (p.x + 1) / 2 },
    { id: 'surface_y', value: (p.y + 1) / 2 },
    { id: 'surface_z', value: p.z },
  ];
}

/**
 * Map host parameter values back to a pose (the inverse of
 * {@link toParameters}).
 *
 * Each input is clamped to `[0, 1]` (non-finite → `0.5`), mapped with
 * `v * 2 - 1` for x/y, then passed through {@link clampPose}. Host values whose
 * point lies outside the disk (for example `fromParameters(1, 1, z)`) are
 * projected onto the rim: the UI shows the projection, but nothing is written
 * back to the host unless the user starts a gesture.
 *
 * Round trip: `fromParameters(...toParameters(p))` matches `clampPose(p)` to
 * within a few `Number.EPSILON` per axis (`z` exactly).
 */
export function fromParameters(x: number, y: number, z: number): Pose {
  return clampPose({ x: clamp(x, 0, 1) * 2 - 1, y: clamp(y, 0, 1) * 2 - 1, z });
}

/**
 * Create regions with angles `startAngle + 2π · i / names.length`, i.e. evenly
 * spaced clockwise from `startAngle` (default `0`, the top). Returns a frozen
 * array of frozen regions; an empty `names` array gives an empty result.
 *
 * @throws RangeError if `startAngle` is not finite.
 */
export function evenlySpacedRegions<Name extends string>(names: readonly Name[], startAngle = 0): readonly Region<Name>[] {
  if (!Number.isFinite(startAngle)) throw new RangeError(`evenlySpacedRegions: startAngle must be finite, got ${String(startAngle)}`);
  const count = names.length;
  return Object.freeze(names.map((name, index) => Object.freeze({ name, angle: startAngle + (Math.PI * 2 * index) / count })));
}

/**
 * The five illustrative regions PUNCH (top), TONE, CLIP, CRUSH and GLUE, evenly
 * spaced clockwise (`evenlySpacedRegions([...])`). Frozen.
 */
export const DEFAULT_REGIONS: readonly Region<RegionName>[] = evenlySpacedRegions<RegionName>(['PUNCH', 'TONE', 'CLIP', 'CRUSH', 'GLUE']);

/** Below this total the direct formula may have lost precision to underflow. */
const MIN_RELIABLE_TOTAL = 2 ** -1000;

/**
 * Normalized angular proximity of a pose to each region.
 *
 * For each region, `closeness = max(0, (1 + cos Δ) / 2)` where `Δ` is the
 * angle between the pose direction and the region direction; the weight is
 * `closeness ** sharpness`, normalized so the weights sum to 1. Only the
 * direction of the pose matters, not its radius (see {@link intensity}).
 *
 * - Returns one fresh entry per region, in the order given.
 * - Every weight is finite and in `[0, 1]`; away from neutral the weights sum
 *   to 1 (within floating-point rounding).
 * - **Neutral:** if the constrained pose's radius is below
 *   {@link REGION_NEUTRAL_RADIUS}, every weight is exactly `0`.
 * - If the direct formula underflows (very high sharpness, or a pose exactly
 *   opposite every region) the weights are computed relative to the closest
 *   region instead, which is mathematically equivalent; exact ties share
 *   equally.
 * - With the default regions and sharpness the computation is the 0.1.0
 *   formula: on the same JavaScript engine the output is bit-identical to
 *   `regionWeights(pose)` in version 0.1.0. `Math.pow`, `Math.sin`, `Math.cos`
 *   and `Math.hypot` are implementation-approximated, so across engines or
 *   engine versions the last bit can differ (measured: at most 2 ulps between
 *   Node 22 and Node 24/25).
 *
 * @param regions Defaults to {@link DEFAULT_REGIONS}. An empty array gives `[]`.
 * @throws RangeError if `sharpness` is not finite and `> 0`, or a region angle is not finite.
 * @throws TypeError if `regions` is given but is not an array.
 */
export function regionWeights(pose: Pose, regions?: undefined, options?: RegionWeightOptions): readonly RegionWeight<RegionName>[];
/**
 * Normalized angular proximity of a pose to each of your own `regions` (same
 * rules as the default-region overload above; weights are named after your
 * regions, in the order given).
 *
 * @throws RangeError if `sharpness` is not finite and `> 0`, or a region angle is not finite.
 * @throws TypeError if `regions` is not an array.
 */
export function regionWeights<Name extends string>(pose: Pose, regions: readonly Region<Name>[], options?: RegionWeightOptions): readonly RegionWeight<Name>[];
export function regionWeights(pose: Pose, regions: readonly Region[] = DEFAULT_REGIONS, options: RegionWeightOptions = {}): readonly RegionWeight<string>[] {
  if (!Array.isArray(regions)) throw new TypeError('regionWeights: regions must be an array of { name, angle }');
  const sharpness = options.sharpness ?? DEFAULT_REGION_SHARPNESS;
  if (!(sharpness > 0 && sharpness < Infinity)) throw new RangeError(`regionWeights: sharpness must be finite and > 0, got ${String(sharpness)}`);
  const directions = regions.map(({ name, angle }) => {
    if (!Number.isFinite(angle)) throw new RangeError(`regionWeights: angle of region ${String(name)} must be finite, got ${String(angle)}`);
    return { name, dx: Math.sin(angle), dy: -Math.cos(angle) };
  });
  if (directions.length === 0) return [];
  const p = clampPose(pose);
  const radius = Math.hypot(p.x, p.y);
  if (radius < REGION_NEUTRAL_RADIUS) return directions.map(({ name }) => ({ name, weight: 0 }));
  const closeness = directions.map(({ dx, dy }) => Math.max(0, (1 + (p.x * dx + p.y * dy) / radius) / 2));
  let amounts = closeness.map((c) => Math.pow(c, sharpness));
  let total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!(total >= MIN_RELIABLE_TOTAL && total < Infinity)) {
    const peak = closeness.reduce((max, c) => Math.max(max, c), 0);
    amounts = closeness.map((c) => Math.pow(c === peak ? 1 : c / peak, sharpness));
    total = amounts.reduce((sum, amount) => sum + amount, 0);
  }
  return directions.map(({ name }, index) => ({ name, weight: amounts[index] / total }));
}

/**
 * The first entry with the greatest strictly positive weight, or `undefined`
 * when there is none (an empty array, or all-zero weights at neutral). `NaN`
 * weights are ignored. Returns the entry object from `weights` itself.
 */
export function dominantRegion<Name extends string>(weights: readonly RegionWeight<Name>[]): RegionWeight<Name> | undefined {
  let best: RegionWeight<Name> | undefined;
  for (const entry of weights) if (entry.weight > (best?.weight ?? 0)) best = entry;
  return best;
}

/**
 * Radial distance of the constrained pose from the centre, in `[0, 1]`.
 * Independent of direction and of `z`.
 */
export function intensity(pose: Pose): number {
  const p = clampPose(pose);
  return Math.min(1, Math.hypot(p.x, p.y));
}

/**
 * Morph N UI values (for example macro-knob positions) from a pose.
 *
 * For each component `j`:
 * `result[j] = (1 - a) * neutral[j] + a * Σ wᵢ · targets[regionᵢ][j]`, where
 * `wᵢ = regionWeights(pose, regions, options)` and `a = intensity(pose)`.
 * At neutral (all weights zero, or no regions) the result is an exact copy of
 * `neutral`; moving outwards blends continuously towards the region targets.
 * Each result is finite and lies within the range of `neutral[j]` and the
 * targets' `j`-th values (it is clamped there to remove rounding overshoot).
 *
 * This is UI parameter interpolation, not audio processing. Returns a fresh array.
 *
 * @throws RangeError if a value is not finite, a target is missing, or the vector lengths differ.
 * @throws RangeError for invalid `sharpness` or region angles (see {@link regionWeights}).
 */
export function blendRegionValues<Name extends string>(pose: Pose, blend: RegionBlend<Name>, options?: RegionWeightOptions): number[] {
  const { regions, neutral, targets } = blend;
  const checkFinite = (values: readonly number[], label: string): void => {
    for (const value of values) if (!Number.isFinite(value)) throw new RangeError(`blendRegionValues: ${label} contains non-finite value ${String(value)}`);
  };
  checkFinite(neutral, 'neutral');
  const vectors = regions.map(({ name }) => {
    const values: unknown = Object.hasOwn(targets, name) ? targets[name] : undefined;
    if (!Array.isArray(values)) throw new RangeError(`blendRegionValues: missing target for region ${String(name)}`);
    if (values.length !== neutral.length) throw new RangeError(`blendRegionValues: target ${String(name)} has ${values.length} values, expected ${neutral.length}`);
    checkFinite(values, `target ${String(name)}`);
    return values as readonly number[];
  });
  const weights = regionWeights(pose, regions, options);
  if (!weights.some((entry) => entry.weight > 0)) return neutral.slice();
  const amount = intensity(pose);
  return neutral.map((base, j) => {
    let mix = 0;
    let low = base;
    let high = base;
    vectors.forEach((values, i) => {
      const value = values[j];
      mix += weights[i].weight * value;
      low = Math.min(low, value);
      high = Math.max(high, value);
    });
    return Math.min(high, Math.max(low, (1 - amount) * base + amount * mix));
  });
}

/**
 * Validate a host parameter write. Use this immediately before
 * {@link ParameterBridge.setParameter}.
 *
 * A finite `value` is clamped to `[0, 1]` (`-0` becomes `0`). A non-finite
 * value is **rejected**, never replaced: substituting a value would turn a
 * corrupted number into a real host write that could be recorded as automation.
 *
 * @throws Error (`Unknown parameter: …`) if `id` is not one of {@link PARAMETER_IDS}.
 * @throws RangeError if `value` is not a finite number (`NaN`, `±Infinity`, or a non-number at runtime).
 */
export function sanitizedParameter(id: ParameterId, value: number): ParameterValue {
  if (!isParameterId(id)) throw new Error(`Unknown parameter: ${String(id)}`);
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite value for ${id}: ${String(value)}`);
  return { id, value: clamp(value, 0, 1) };
}
