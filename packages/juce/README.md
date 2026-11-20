# @lowquo/surface-juce

Adapter between lq-surface UIs and a JUCE `WebBrowserComponent` host. It forwards user gestures to
injected JUCE native functions and turns validated host state back into poses. It depends only on
`@lowquo/surface`; it never imports the JUCE frontend library or touches `window` itself — pass
`getNativeFunction` and `window.__JUCE__.backend` in. No audio code is part of this package.

The native counterpart is the [JUCE example](../../examples/juce-plugin/README.md), which registers
`surfaceBeginGesture(id)`, `surfaceSetParameter(id, value)`, `surfaceEndGesture(id)` and
`surfaceGetState()`, and emits `surfaceHostState` events with `{ x, y, z }` normalised values.

## Recommended: `SurfaceHostSession`

```ts
import { SurfaceHostSession } from '@lowquo/surface-juce';
import type { JuceEventBackend } from '@lowquo/surface-juce';
import { Trackball } from '@lowquo/surface-controls';

// Inside a JUCE WebView only (the JUCE frontend library is AGPL-3.0-only OR JUCE-licensed):
const { getNativeFunction } = await import('@juce-framework/webview');
const juce = (window as unknown as { __JUCE__: { backend: JuceEventBackend } }).__JUCE__;

const host = new SurfaceHostSession({
  lookup: getNativeFunction,
  backend: juce.backend,
  onError: (error) => console.warn(error),
});

const trackball = new Trackball(document.querySelector<HTMLElement>('#trackball')!, {
  onGestureStart: () => host.begin(),
  onChange: (pose) => host.change(pose),
  onGestureEnd: () => host.end(),
});
host.onHostState((pose) => trackball.setPose(pose)); // setPose does not notify the host

// Later:
host.dispose();
trackball.dispose();
```

- Writes are gesture-balanced; `change()` outside `begin()`/`end()` gets its own gesture.
- Host state is authoritative. A listener receives the current state once when it subscribes
  (pulled with `surfaceGetState`) and afterwards only changes that did not come from this UI.
- Host updates that arrive while a gesture is open or writes are still in flight are held back;
  the state is pulled again once everything has settled, so the UI never jumps back to stale values.
- Nothing throws and no promise rejection is left unhandled; errors go to `onError`.

`examples/playground/src/host.ts` shows how to detect a JUCE WebView before loading
`@juce-framework/webview` with a dynamic `import()`, so the plain browser page never loads it. (Vite still emits it as a
separate chunk in the build output, and it is inside `surface-ui.zip`.)

## Lower-level API

| Export | Purpose |
| --- | --- |
| `createJuceBridge(lookup, { timeoutMs? })` | `ParameterBridge` over the three gesture functions. Calls run one at a time in order; queued `setParameter` calls for the same ID are coalesced (latest value wins), never across a begin/end of that ID. Unknown IDs reject with `TypeError`, non-finite values with `RangeError`, a native `false`, throw or timeout (default 5000 ms, `0` disables) with `NativeCallError`. |
| `new SurfaceHostController(bridge, { onError?, onIdle? })` | Three-axis gestures: idempotent `begin`/`end`, `change` sends only axes that changed within a gesture (the first change of each gesture sends all three), non-finite poses are dropped and reported. `gestureActive`, `pendingCalls` and `idle` expose its state. |
| `parseHostParameters(payload)` / `parseHostState(payload)` | Validate an untrusted `{ x, y, z }` payload (own numeric fields, finite, in `[0, 1]`; extra fields ignored). Return the values / a disk-constrained `Pose`, or `null`. Never throw. |
| `subscribeHostState(backend, listener, { onError?, eventId? })` | Validated `surfaceHostState` subscription. Returns an idempotent unsubscribe function. |
| `fetchHostState(lookup, { onError?, timeoutMs? })` | Pull the state via `surfaceGetState`. Resolves `null` on failure, never rejects. |
| `NATIVE_FUNCTIONS`, `HOST_STATE_EVENT`, `DEFAULT_NATIVE_TIMEOUT_MS` | Contract constants. |
| `NativeCallError` | Error class with `functionName` and optional `cause`. |
| Types | `NativeFunctionLookup`, `ErrorHandler`, `JuceBridgeOptions`, `SurfaceHostControllerOptions`, `HostParameterState`, `JuceEventBackend`, `HostStateSubscriptionOptions`, `SurfaceHostSessionOptions`. |

## Tests

`npm test -w @lowquo/surface-juce` runs the `node:test` suites in `test/` against the built
`dist/`: ordering, coalescing and bounded queues, dedupe, gesture balance, error and timeout paths,
unhandled-rejection checks, hostile host-state payloads and the session's echo and stale-state
handling.
