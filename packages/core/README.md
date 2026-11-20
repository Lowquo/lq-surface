# @lowquo/surface

Framework-neutral pose, host-parameter and sound-space geometry for audio
interfaces. Pure TypeScript: no DOM, renderer, JUCE, Node or DSP code, and no
runtime dependencies. All functions are deterministic.

These are **UI coordinates and UI parameter mappings**, not audio processing.
Part of [lq-surface](https://github.com/Lowquo/lq-surface/blob/main/README.md), MIT licensed.

```sh
npm install @lowquo/surface
```

## The pose contract

```ts
type Pose = Readonly<{ x: number; y: number; z: number }>;
```

| Axis | Range | Meaning | Host parameter |
| --- | --- | --- | --- |
| `x` | `[-1, 1]` | left (−1) to right (+1) | `surface_x = (x + 1) / 2` |
| `y` | `[-1, 1]` | **top (−1)** to bottom (+1), screen convention | `surface_y = (y + 1) / 2` |
| `z` | `[0, 1]` | character / twist | `surface_z = z` |

- `x` and `y` are constrained to the unit disk: `x * x + y * y <= 1`.
- Neutral is `{ x: 0, y: 0, z: 0.5 }` (`NEUTRAL_POSE`).
- The host (DAW) parameter state is authoritative; see [`ParameterBridge`](#parameterbridge).

Two validation rules apply throughout:

1. **Poses are sanitized.** A non-finite component (`NaN`, `±Infinity`) becomes
   that axis's neutral value and out-of-range values are constrained, so UI code
   can always render something.
2. **Host writes are validated.** `sanitizedParameter` throws on a non-finite
   value instead of inventing one, so corrupted data never becomes a host write
   (or an automation point).

## Poses

### `clampPose(pose): Pose`

Returns a fresh pose that satisfies the contract:

- non-finite components become `x = 0`, `y = 0`, `z = 0.5`, independently per axis;
- points outside the unit disk are projected **radially** onto the rim (their
  direction is kept); points inside are returned unchanged;
- `z` is clamped to `[0, 1]`;
- the result satisfies `x * x + y * y <= 1` exactly in double precision and
  never contains `-0`;
- idempotent: `clampPose(clampPose(p))` equals `clampPose(p)`.

```ts
import { clampPose } from '@lowquo/surface';

clampPose({ x: 3, y: 0, z: 2 });          // { x: 1, y: 0, z: 1 }
clampPose({ x: NaN, y: -0.25, z: 0.8 });  // { x: 0, y: -0.25, z: 0.8 }
```

### `intensity(pose): number`

Distance of the constrained pose from the centre, in `[0, 1]`. Ignores
direction and `z`.

```ts
intensity({ x: 0.3, y: -0.4, z: 0 }); // 0.5
```

### `equalPose(a, b, epsilon = 1e-6): boolean`

`true` when every axis differs by strictly less than `epsilon`. Symmetric;
`false` if any component is `NaN` or infinite, and for `epsilon <= 0`.

### `clamp(value, min, max): number`

- Finite `value`: clamped to `[min, max]` (in-range values, including `-0`,
  are returned unchanged; infinite bounds are allowed).
- Non-finite `value`: returns the midpoint `(min + max) / 2` (the
  pose-sanitizing rule).
- Throws `RangeError` if `min` or `max` is `NaN`, if `min > max`, or if a
  midpoint is needed but is not finite.

```ts
clamp(NaN, 0, 1);  // 0.5
clamp(0.5, 1, 0);  // throws RangeError
```

## Host parameters

`PARAMETER_IDS` is the frozen array `['surface_x', 'surface_y', 'surface_z']`;
`ParameterId` is its element type and `ParameterValue` is
`Readonly<{ id: ParameterId; value: number }>` with `value` finite in `[0, 1]`.

### `toParameters(pose): readonly ParameterValue[]`

Constrains the pose, then maps it to the three normalized values in
`PARAMETER_IDS` order.

```ts
toParameters({ x: -1, y: 0, z: 0.75 });
// [{ id: 'surface_x', value: 0 }, { id: 'surface_y', value: 0.5 }, { id: 'surface_z', value: 0.75 }]
```

### `fromParameters(x, y, z): Pose`

The inverse mapping, for displaying host state. Each value is clamped to
`[0, 1]` (non-finite → `0.5`), mapped back, then passed through `clampPose`.
`fromParameters(...toParameters(p).map((v) => v.value))` matches `clampPose(p)`
within `2 * Number.EPSILON` per axis (`z` exactly).

Host values can describe a point outside the disk (for example from automation
drawn by hand). The UI shows the projection onto the disk; nothing is written
back to the host unless the user starts a gesture.

```ts
fromParameters(1, 1, 0.5); // { x: 0.7071067811865475, y: 0.7071067811865475, z: 0.5 }
```

### `sanitizedParameter(id, value): ParameterValue`

Validates one host write. Use it immediately before `setParameter`.

- Throws `Error('Unknown parameter: …')` if `id` is not a `ParameterId`.
- Throws `RangeError` if `value` is not a finite number.
- Otherwise clamps `value` to `[0, 1]` (`-0` becomes `0`).

```ts
sanitizedParameter('surface_x', 1.2); // { id: 'surface_x', value: 1 }
sanitizedParameter('surface_x', NaN); // throws RangeError
```

### `isParameterId(value: unknown): value is ParameterId`

Type guard for untrusted input such as native-host payloads.

```ts
isParameterId('surface_y'); // true
isParameterId('gain');      // false
```

### `ParameterBridge`

```ts
interface ParameterBridge {
  beginGesture(id: ParameterId): void | Promise<void>;
  setParameter(id: ParameterId, value: number): void | Promise<void>;
  endGesture(id: ParameterId): void | Promise<void>;
}
```

A write-only channel from the UI to the host. The contract:

1. **Begin before set:** `setParameter(id, …)` only between `beginGesture(id)`
   and the matching `endGesture(id)`.
2. **Balanced:** exactly one `endGesture(id)` per `beginGesture(id)`; never begin
   an `id` that is already in a gesture. Different IDs may overlap.
3. **Valid values:** finite and in `[0, 1]`, from `toParameters` or
   `sanitizedParameter`.
4. **Ordering:** implementations deliver calls in the order they were made (at
   least per `id`), so callers may fire them without awaiting. A returned
   promise settles when the host accepted or rejected that call.
   Implementations may throw or reject on contract violations.
5. **The host is authoritative:** the bridge never reads state. Display host
   changes (automation, project recall) without echoing them back; write only in
   response to user gestures.

`createJuceBridge` and `SurfaceHostController` in `@lowquo/surface-juce`
implement and drive this contract.

## Sound-space regions

A `Region` is a named direction in the disk:

```ts
type Region<Name extends string = string> = Readonly<{ name: Name; angle: number }>;
```

`angle` is in radians, measured **clockwise on screen from the top**: `0` is the
top (`y = -1`), `π / 2` the right, `π` the bottom, `3π / 2` the left. The
direction vector is `(sin(angle), -cos(angle))`. Angles must be finite.

`DEFAULT_REGIONS` holds five illustrative regions, `PUNCH` (top), `TONE`,
`CLIP`, `CRUSH` and `GLUE`, evenly spaced clockwise (`RegionName` is the union
of those names). They are UI labels, not audio algorithms.

### `evenlySpacedRegions(names, startAngle = 0): readonly Region[]`

Regions at `startAngle + 2π · i / names.length`. Returns frozen objects; throws
`RangeError` for a non-finite `startAngle`.

```ts
const quadrants = evenlySpacedRegions(['N', 'E', 'S', 'W']);
// [{ name: 'N', angle: 0 }, { name: 'E', angle: π/2 }, { name: 'S', angle: π }, { name: 'W', angle: 3π/2 }]
```

### `regionWeights(pose, regions = DEFAULT_REGIONS, options?): readonly RegionWeight[]`

Normalized angular proximity of the pose to each region. For each region,
`closeness = max(0, (1 + cos Δ) / 2)`, where `Δ` is the angle between the pose
and the region; the weight is `closeness ** sharpness`, normalized to sum to 1.
`options.sharpness` defaults to `DEFAULT_REGION_SHARPNESS` (`4`) and must be
finite and `> 0`.

- One fresh `{ name, weight }` per region, in input order. Weights are finite
  and in `[0, 1]`, and sum to 1 (within rounding) away from neutral.
- Only the direction matters; combine with `intensity` for distance.
- **Neutral:** if the constrained pose's radius is below
  `REGION_NEUTRAL_RADIUS` (`1e-8`), every weight is exactly `0`.
- Weights vary continuously with the pose angle. Extreme sharpness or
  degenerate layouts (for example a pose exactly opposite a single region) still
  produce normalized weights.
- With the default regions and sharpness, the computation is the 0.1.0 formula: results are
  bit-identical to 0.1.0 **on the same JavaScript engine**. `Math.pow`, `Math.sin`, `Math.cos` and
  `Math.hypot` are implementation-approximated, so across engines or engine versions the last bit
  can differ (measured: at most 2 ulps between Node 22 and Node 24/25).
- Throws `RangeError` for an invalid sharpness or non-finite angle, and
  `TypeError` if `regions` is not an array.

```ts
const weights = regionWeights({ x: 0.2, y: -0.7, z: 1 });
// PUNCH 0.677, TONE 0.270, CLIP 0.001, CRUSH 0.000, GLUE 0.053

regionWeights({ x: 0.5, y: 0, z: 0.5 }, quadrants, { sharpness: 8 });
// N 0.0039, E 0.9922, S 0.0039, W 0
```

### `dominantRegion(weights): RegionWeight | undefined`

The first entry with the greatest strictly positive weight, or `undefined` at
neutral (all zero) or for an empty array.

```ts
dominantRegion(weights)?.name ?? 'NEUTRAL'; // 'PUNCH'
```

### `blendRegionValues(pose, { regions, neutral, targets }, options?): number[]`

Morphs a vector of UI values (for example macro-knob positions) from the pose:
`result[j] = (1 - a) · neutral[j] + a · Σ wᵢ · targets[nameᵢ][j]`, with
`wᵢ = regionWeights(pose, regions, options)` and `a = intensity(pose)`.

- At neutral (or with no regions) the result is an exact copy of `neutral`, and
  it moves continuously away from it.
- Each output lies within the range of `neutral[j]` and the targets' `j`-th values.
- `neutral` and every target must have the same length and finite values, and
  every region name needs its own entry in `targets`; otherwise `RangeError`.

```ts
const macros = { regions: quadrants, neutral: [0.5, 0.5],
  targets: { N: [1, 0.5], E: [0.5, 1], S: [0, 0.5], W: [0.5, 0] } };

blendRegionValues({ x: 0, y: 0, z: 0.5 }, macros);  // [0.5, 0.5]
blendRegionValues({ x: 0, y: -1, z: 0.5 }, macros); // [0.944…, 0.5]
```

## Testing

```sh
npm test   # from the repository root: builds, then runs node:test suites
```

The suites use a seeded PRNG for randomized property tests (disk constraint,
idempotence, round trips, weight normalization and continuity) and pin
`regionWeights` against values captured from version 0.1.0.
