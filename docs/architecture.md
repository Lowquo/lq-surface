# Architecture and public API

```
@lowquo/surface (pure math/contract)
             |
   +---------+----------+
   |                    |
controls (Three.js)   juce adapter (injected functions)
   |                    |
playground             JUCE plugin example
```

## Pose and control parameters

- `x` in `[-1, +1]`: left/right; host parameter `surface_x` uses `(x + 1) / 2`.
- `y` in `[-1, +1]`: up/down; host parameter `surface_y` uses `(y + 1) / 2`.
- `x² + y² <= 1`: radial constraint, with normalized projection beyond the boundary.
- `z` in `[0, 1]`: character/twist; host parameter `surface_z` receives it unchanged.
- Neutral is `{ x: 0, y: 0, z: 0.5 }`.

These inputs are **UI parameter values**, not audio effect calculations. The DAW owns the authoritative parameter state; host automation may override the current control position. Host updates should use `trackball.setPose(...)` without emitting a feedback event.

## Angular sound-space weighting

`regionWeights(pose)` computes a normalized positive proximity distribution over the five named regions PUNCH, TONE, CLIP, CRUSH and GLUE. It is deliberately **illustrative**, not lq-hit DSP. We do not claim these regions or weightings as novel audio algorithms.

## Host contract

A `ParameterBridge` provides `beginGesture(id)`, `setParameter(id, normalizedValue)` and `endGesture(id)`. The UI only produces bounded, normalized values and gesture boundaries. In production, the native audio plugin implements DAW automation and project recall on its side, independently of UI rendering.

For pointer drags, all axes begin and end gestures together. For wheel/keyboard nudges the demo uses a short balanced gesture per change. A future production integration may batch discrete gestures where supported.

## Security and runtime

The WebView may load bundled assets, never remote pages with native functions enabled. Native callback implementations validate allowed IDs, finite numeric values, and normalized range. No web code should run on the real-time audio thread; the JUCE example processes audio as passthrough.

## Testing priorities

1. Pure coordinate and parameter mapping tests.
2. Pointer capture, fine adjustment, keyboard access and resets.
3. Host automation causing UI state updates without echo loops.
4. Host restarts, project recall, multiple plugin instances and WebView renderer failure.
5. DAW scanning, code signing/notarisation and CPU tests belong to the actual product, not this library proof of concept.
