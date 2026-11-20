# Architecture and contracts

```
@lowquo/surface  (pure maths and contracts: pose, parameters, regions)
        |
   +----+---------------------+
   |                          |
@lowquo/surface-controls    @lowquo/surface-juce
(Trackball, Three.js/2D)    (bridge, controller, host session)
   |                          |
   +------------+-------------+
                |
       examples/playground  ── bundled as surface-ui.zip ──>  examples/juce-plugin (C++)
```

The package READMEs are the API reference: [core](../packages/core/README.md), [controls](../packages/controls/README.md), [juce](../packages/juce/README.md), and the [JUCE example](../examples/juce-plugin/README.md). This page describes the contracts that connect them. Everything here is **UI parameter handling, not audio processing**.

## Pose contract

| Axis | Range | Meaning | Host parameter |
| --- | --- | --- | --- |
| `x` | [-1, 1] | left (−1) to right (+1) | `surface_x = (x + 1) / 2` |
| `y` | [-1, 1] | **top (−1)** to bottom (+1), the screen convention | `surface_y = (y + 1) / 2` |
| `z` | [0, 1] | character / twist | `surface_z = z` |

- **Exact disk.** Every pose the packages return satisfies `x * x + y * y <= 1` when evaluated in double precision.
- **Radial projection.** `clampPose` moves a point outside the disk onto the rim along its own direction, so the angle is kept. Points inside are unchanged, and `z` is clamped to [0, 1].
- **Sanitising.** A non-finite component becomes that axis's neutral value (`0`, `0`, `0.5`), independently per axis. `-0` becomes `+0`. `clampPose` is idempotent.
- Neutral is `{ x: 0, y: 0, z: 0.5 }`, and `intensity(pose)` (the radius) is in [0, 1].
- **Host writes are validated, not repaired.** `sanitizedParameter` throws `RangeError` for a non-finite value and `Error('Unknown parameter: …')` for an unknown ID, so corrupt data can't become an automation point.
- `fromParameters` maps host values back to a pose. Host values outside the disk (for example hand-drawn automation of `(1, 1)`) are *displayed* projected onto the rim, but nothing is written back unless the user starts a gesture.

## Sound-space regions

A region is a named direction: `{ name, angle }`.

- `angle` is in radians, clockwise on screen from the top: `0` is the top (`y = −1`) and `π/2` is the right.
- `DEFAULT_REGIONS` holds five illustrative labels (PUNCH at the top, then TONE, CLIP, CRUSH and GLUE clockwise). You can pass any region set, for example one from `evenlySpacedRegions(names, startAngle)`.
- `regionWeights(pose, regions?, { sharpness? })` gives each region `closeness ** sharpness`, normalised to sum to 1, where `closeness = max(0, (1 + cos Δ) / 2)`. The default sharpness is 4.
  - Below radius `1e-8` all weights are exactly `0`.
  - With the defaults, the computation is the 0.1.0 formula: bit-identical to 0.1.0 on the same JavaScript engine, and within a few ulps across engines or engine versions (`Math.pow`, `Math.sin`, `Math.cos` and `Math.hypot` are implementation-approximated; Node 22 vs Node 24/25 differ by at most 2 ulps).
- `dominantRegion(weights)` returns the leading region, or `undefined` at neutral.
- `blendRegionValues(pose, { regions, neutral, targets })` morphs a vector of UI values: `(1 − a) · neutral + a · Σ wᵢ · targetᵢ`, where `a = intensity(pose)`.

The regions and weights are UI labels and interpolation, not lq-hit DSP or a claimed audio algorithm.

## Gesture model

A host *gesture* is the begin/end bracket (JUCE `beginChangeGesture` / `endChangeGesture`) that DAWs use for automation touch and latch, and for undo. Gestures are balanced at every layer.

### In the control (`Trackball`)

At most one gesture is open at a time. `onGestureStart` and `onGestureEnd` are always paired, and `isInteracting()` is true in between.

| Input | Gesture |
| --- | --- |
| Pointer drag | **Continuous.** Opens on pointer down. Closes on pointer up, `pointercancel`, `lostpointercapture`, window blur, **Escape** (which first restores and sends the pre-drag pose), or `dispose()`. |
| Keys, wheel, double-click | **Discrete, coalesced.** The first input opens a gesture and later input extends it. It closes after **400 ms** without input (`GESTURE_IDLE_MS`), on blur, on `dispose()`, or when a drag starts (closing first, so the two never overlap). A held arrow key or a trackpad scroll is one gesture. |
| Input that changes nothing (for example at a limit) | No gesture. |
| `setPose(pose)` (host update) | No gesture, and no `onChange`. |

### In the adapter (`@lowquo/surface-juce`)

- `SurfaceHostController` maps one UI gesture onto `beginGesture` for all three IDs, and later `endGesture` for all three. `begin()` and `end()` are idempotent.
- `change()` sends only the axes that changed since the last write in that gesture. The first change of each gesture sends all three, possibly including unchanged values, because the host may have moved in the meantime.
- `change()` outside a gesture wraps itself in its own begin/end.
- `createJuceBridge` runs native calls one at a time, in order. Queued `setParameter` calls for the same ID are coalesced (the latest value wins), never across a begin/end of that ID, so the queue stays bounded over slow IPC.
- The bridge rejects unknown IDs (`TypeError`) and non-finite values (`RangeError`) without forwarding them. A native `false`, a throw, or no answer within 5 s (`DEFAULT_NATIVE_TIMEOUT_MS`) becomes a `NativeCallError`. No error is thrown at the caller or left as an unhandled rejection; errors go to `onError`.

### In the native example

Gestures are tracked per parameter:

- A duplicate begin is ignored, and so is an unmatched end.
- A set without an open gesture is applied as a self-contained begin/set/end.
- Every gesture the page left open is ended when the page navigates or reloads, including JUCE's own `about:blank` unload while the editor is hidden, and when the editor is destroyed. A reload or editor close mid-drag therefore never leaves automation stuck in "touch".

### In the playground

The trackball and the precision sliders share one host gesture: an open-gesture counter calls `begin()` once and `end()` once. Slider pointer drags are continuous gestures. Slider keyboard and assistive-technology adjustments are coalesced like the trackball's discrete input.

## Host model

**The host's parameter state is authoritative; the UI converges to it.** The UI writes only in response to user gestures and never echoes host updates back.

1. **Native → UI.** A 30 Hz message-thread timer compares the parameter values with what the page has already seen. It emits `surfaceHostState` `{ x, y, z }` only when something differs.
   - Values the page wrote itself, or pulled with `surfaceGetState`, count as seen, so the page receives no echoes.
   - Nothing is emitted while a page gesture is open.
   - After each page load the full state is reported again.
2. **UI session** (`SurfaceHostSession`):
   - A new listener receives the current state once, pulled with `surfaceGetState`.
   - While the session is idle (no gesture open, no write in flight), host events are delivered. A state equal to what the UI last sent or showed isn't delivered again.
   - While a gesture is open or writes are in flight, host events are **buffered** (held back). Once the session is idle again, it **pulls** `surfaceGetState`. A reply that arrives while busy is discarded and the pull retried. As a result, axes the user didn't touch show the host's value, and touched axes show the user's last write. There is no jump back to stale values after a drag.
3. **Playground.** It additionally defers host updates while `trackball.isInteracting()` or a slider gesture is active. It applies the deferred update afterwards only if nothing was sent after it arrived.
4. **Control.** Host updates go through `trackball.setPose(pose)`, whose default `notify = false` means `onChange` isn't called, so nothing is echoed.

Host state is polled at 30 Hz, so faster changes are coalesced and the latest value wins.

## Native functions (WebView → C++)

Registered by the JUCE example with `WebBrowserComponent::Options::withNativeFunction`. The names are exported as `NATIVE_FUNCTIONS` and `HOST_STATE_EVENT`.

| Function / event | Arguments | Result |
| --- | --- | --- |
| `surfaceBeginGesture` | `id` | `true`, or `false` if rejected. A duplicate begin returns `true` and is ignored. |
| `surfaceSetParameter` | `id`, `value` | `true`, or `false` if rejected. Without an open gesture, it's a self-contained gesture. |
| `surfaceEndGesture` | `id` | `true`, or `false` if rejected. An unmatched end returns `true` and is ignored. |
| `surfaceGetState` | none | `{ x, y, z }` (normalised [0, 1]), or `false` if called with arguments |
| `surfaceHostState` (event, C++ → WebView) | — | `{ x, y, z }` (normalised [0, 1]) |

Validation is strict on the native side:

- The argument count must be exact.
- `id` must be exactly the string `surface_x`, `surface_y` or `surface_z`.
- `value` must be a JSON number (not a string, boolean or null) that is finite and in [0, 1].

The UI side validates `surfaceHostState` and `surfaceGetState` payloads in the same way (`parseHostParameters`). The parameters are `surface_x`, `surface_y` and `surface_z`, displayed as "Surface X/Y/Z", with default `0.5` and version hint 1.

On restore, state from any other root tag, or anything that isn't a JUCE state blob, is ignored. Within a valid state:

- Non-numeric or non-finite values fall back to the default.
- Other values are clamped to [0, 1].
- Missing parameters are reset to the default.
- Unknown children are dropped.

## Security and runtime

[SECURITY.md](../SECURITY.md) has the full threat model.

- **Bundled content only.** The page is served from the embedded ZIP through JUCE's resource provider. Paths containing `..`, `\`, `:`, empty segments or control characters are refused, and so are entries over 16 MiB.
- **Navigation.** Only the resource-provider root and `about:blank` load in the WebView. `http`/`https` links open in the system browser (at most one per second), every other scheme is blocked, and no new windows are created.
- **No runtime network.** The plug-in is built with `JUCE_USE_CURL=0`, and the bundle has no remote resources. JUCE's default AU `Info.plist` still declares `network.client` (a maintainer decision; see [releasing.md](releasing.md#open-maintainer-decisions)).
- **No audio-thread UI work.** Native functions and the host-state timer run on the message thread. `processBlock` only clears surplus output channels.
- **Isolation.** Each editor owns its own UI archive. Plug-in instances share no state.

## Testing priorities

[testing.md](testing.md) records which of these are covered and how to run them.

1. Pure coordinate, parameter and region maths.
2. Pointer capture, fine adjustment, keyboard access, resets, and gesture balance.
3. Host automation reaching the UI without echo loops or stale jump-backs.
4. Host restarts, project recall, multiple plug-in instances, and WebView reload or failure.
5. DAW scanning, code signing/notarisation and CPU tests belong to a shipping product, not to this toolkit.
