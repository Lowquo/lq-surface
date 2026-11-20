# @lowquo/surface-controls

A precise three-axis trackball for audio software UIs: x/y position on a disk plus a z "twist". It renders with Three.js and falls back to a 2D canvas. It is built as a studio control rather than a performance instrument, so it never animates and never redraws on its own: it draws exactly one frame after each state change.

Requires `@lowquo/surface` and the peer dependency `three`. Browser only. It loads nothing from the network.

```sh
npm install @lowquo/surface @lowquo/surface-controls three
```

## Quick start

```ts
import { Trackball } from '@lowquo/surface-controls';

const trackball = new Trackball(document.querySelector('#trackball')!, {
  onGestureStart: () => host.begin(),        // e.g. beginChangeGesture on all three parameters
  onChange: (pose) => host.change(pose),     // user changes only
  onGestureEnd: () => host.end(),
});

// Host automation: never echoes back, because onChange is not called.
host.onState((pose) => {
  if (!trackball.isInteracting()) trackball.setPose(pose);
});

trackball.dispose();
```

## Pose contract

| Axis | Range | Meaning |
| --- | --- | --- |
| `x` | [-1, 1] | left to right |
| `y` | [-1, 1] | **screen convention**: -1 is the top (PUNCH), dragging down increases y |
| `z` | [0, 1] | twist / character |

`x² + y² ≤ 1`. Values outside the disk are projected radially onto it. Neutral is `{ x: 0, y: 0, z: 0.5 }`. Host parameters follow `@lowquo/surface`: `surface_x = (x + 1) / 2`, `surface_y = (y + 1) / 2`, `surface_z = z`.

## API

### `new Trackball(root: HTMLElement, options?: TrackballOptions)`

Appends the control to `root`. **The root's own styles are not changed.** The control fills the root (`width/height: 100%`, `min-height: 260px`), so give the root a size.

```ts
type TrackballOptions = {
  value?: Pose;                          // initial pose, default NEUTRAL_POSE
  onChange?: (pose: Pose) => void;       // every user-originated change, and setPose(v, true)
  onGestureStart?: () => void;           // a user gesture opened
  onGestureEnd?: () => void;             // that gesture closed (always paired)
  wheel?: boolean;                       // default true; see "Wheel" below
  label?: string;                        // accessible name, default "Surface position"
  description?: string;                  // keyboard instructions (aria-describedby), default English text
  formatValue?: (pose: Pose) => string;  // value text for assistive technology, default formatPose
};
```

| Method | Description |
| --- | --- |
| `getPose(): Pose` | A copy of the current pose. |
| `setPose(value: Pose, notify = false): void` | Clamp and display a pose. Host updates use the default `notify = false`: `onChange` is not called, so nothing is echoed back. With `notify = true`, `onChange` runs (it does not open a gesture). |
| `isInteracting(): boolean` | `true` from `onGestureStart` until `onGestureEnd` (a drag, or a coalesced keyboard/wheel gesture). Defer host updates while it is true, so the ball does not move under the user's pointer. |
| `dispose(): void` | Idempotent. Ends an open gesture (one balanced `onGestureEnd`), clears timers, removes listeners (including the resolution media query and ResizeObserver), releases GPU resources and the WebGL context, and removes the DOM it added. You can create a new `Trackball` in the same root afterwards. |

## Interaction reference

**Fine adjustment:** hold **Shift**, **Ctrl** or **Cmd (⌘)**. Every step becomes exactly **10× finer** (`FINE_RATIO`). On macOS, Ctrl+arrow keys are usually taken by the system, so use Shift or ⌘.

| Input | Effect | Coarse step | Fine step |
| --- | --- | --- | --- |
| Drag | Moves x/y relatively (pressing does not jump). The marker follows the pointer 1:1. | 1 px = 1/travel radius | 10× finer |
| Alt/Option + vertical drag | z (up increases); horizontal movement ignored | 1 px = 0.5/travel radius (same host-parameter rate as x/y) | 10× finer |
| ← / → | x −/+ | 0.02 (1 % of `surface_x`) | 0.002 |
| ↑ / ↓ | y −/+ (up moves towards PUNCH) | 0.02 | 0.002 |
| Page Up / Page Down | z +/− | 0.01 (1 % of `surface_z`) | 0.001 |
| Alt + ↑ / ↓ | z +/− (kept for compatibility) | 0.01 | 0.001 |
| Home or 0 | Reset to neutral (Ctrl/Cmd/Alt+0 are left to the browser) | | |
| Double-click | Reset to neutral | | |
| Wheel / trackpad scroll | z (scrolling up increases) | 100 px (one typical notch) = 0.025, capped at 0.1 per event; line and page modes are normalised | 10× finer |
| Escape during a drag | Cancels the drag: restores the pre-drag pose, sends it, then ends the gesture | | |

At the disk rim, x/y input slides along the rim. During a drag, other keyboard, wheel and double-click input is ignored, except Escape.

### Wheel

The wheel adjusts z and calls `preventDefault()`, so the page does not scroll while the pointer is over the control. That is right inside a plugin window. On a scrolling web page, pass `wheel: false`: the control then ignores wheel events and the page scrolls normally.

### Host gestures

Gestures are always balanced: every `onGestureStart` is followed by exactly one `onGestureEnd`, and two are never open at once.

- **Pointer:** begins on pointer down and ends on pointer up, `pointercancel`, `lostpointercapture`, window blur, Escape, or `dispose()`.
- **Discrete input** (keys, wheel, double-click): the first input opens a gesture and later inputs extend it. It ends after **400 ms** without input (`GESTURE_IDLE_MS`), on blur, on `dispose()`, or when a pointer gesture starts (the discrete gesture ends first). Holding an arrow key or scrolling a trackpad therefore produces one host gesture, not dozens.
- Input that does not change the value (e.g. pushing against a limit) opens no gesture.

## Rendering

- **"What you see is the value":** the marker sits on the ball's front pole. The ball is rotated so that the marker lands on the front-hemisphere point `(0.8·x, −0.8·y, √(1 − 0.64·r²))`. It is then twisted about that point by z. With the orthographic camera, the marker's screen position is exactly `centre + travel · (x, y)`, so neutral is dead centre. The fixed inner circle is the travel limit (r = 1), and the marker never turns edge-on.
- **z scale:** a 270° ring (z 0 → 1 is −135° → +135°, z 0.5 at 12 o'clock) with a bipolar value arc and pointer. An engraved index line on the ball shows the same twist.
- **On demand only:** a frame is requested only after a pose, focus, size or pixel-ratio change. Nothing runs while idle, and nothing is ever tweened, so there is no motion for `prefers-reduced-motion` to reduce.
- **High-DPI:** the backing store is the CSS size × `min(devicePixelRatio, 2)`. A ResizeObserver tracks layout changes, and a `(resolution: Ndppx)` media query, re-armed after each change, tracks moves between displays and zoom changes.
- **WebGL unavailable:** a 2D canvas renderer (on a fresh canvas) draws the same geometry, with identical interaction.
- **WebGL context lost:** the control switches to the 2D renderer and stays operable. When the browser restores the context, it switches back.
- The focusable element carries `data-renderer="webgl" | "2d" | "none"` for diagnostics.

## Accessibility

- The focusable element has `role="application"`, so screen readers pass arrow keys through. It also has `aria-roledescription="trackball"`, an accessible name (`label`), and `aria-describedby` pointing at the current value text and the keyboard instructions.
- User changes are announced through a visually hidden `aria-live="polite"` region, debounced (350 ms after input settles), so holding a key gives one announcement. Host/automation updates refresh the value text but are not announced.
- Keyboard focus shows a high-contrast ring around the control. Pointer focus does not. In forced-colours mode, the browser's own outline is kept.

## Pure interaction helpers

The interaction rules are exported as DOM-free functions. Use them to build matching controls or to test host integrations:

```ts
import {
  applyDrag, applyKey, applyWheel, isFineAdjust, formatPose, GestureTracker,
  FINE_RATIO, KEY_STEP_XY, KEY_STEP_Z, WHEEL_Z_PER_PIXEL, WHEEL_LINE_PIXELS, WHEEL_PAGE_PIXELS,
  WHEEL_MAX_STEP, Z_DRAG_RATIO, GESTURE_IDLE_MS,
} from '@lowquo/surface-controls';

applyDrag(pose, { dx, dy, pixelsPerUnit, shiftKey, altKey }); // → Pose
applyKey(pose, 'ArrowRight', { shiftKey: true });              // → Pose | null (null = not handled)
applyWheel(pose, { deltaY, deltaX, deltaMode, shiftKey });     // → Pose

const gestures = new GestureTracker({ onStart, onEnd, idleMs: 400, timers }); // timers: injectable clock
gestures.beginContinuous(); gestures.endContinuous();          // pointer-style gesture
gestures.touch();                                              // discrete input, coalesced
gestures.end();                                                // blur / dispose
gestures.kind;   // 'continuous' | 'discrete' | null
gestures.active; // boolean
```

## Licence

MIT. Contains no audio DSP.
