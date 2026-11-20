# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, minor releases may contain breaking changes, and those are called out explicitly.

Nothing has been published to npm yet, and no version has been tagged. The `lowquo` npm organisation exists (created 2026-11-20), and the package names `@lowquo/surface`, `@lowquo/surface-controls` and `@lowquo/surface-juce` are reserved for the first release.

## [Unreleased]

Hardening of the starter, prepared as the first npm release. All `package.json` files say `0.1.0`, the recommended first version (nothing with that version was ever published or tagged). The maintainer confirms the version when approving the release.

The changes below are **breaking relative to the untagged starter** (commit `3df553c`). It was never published, so no registry consumers exist.

### Added

**`@lowquo/surface` (core)**

- `isParameterId(value)`: a type guard for untrusted input.
- Generic sound-space regions:
  - the `Region` type `{ name, angle }` (angle measured clockwise from the top);
  - `evenlySpacedRegions(names, startAngle?)` and `DEFAULT_REGIONS`;
  - an optional region set and `{ sharpness }` option on `regionWeights`;
  - `dominantRegion(weights)` and `blendRegionValues(pose, { regions, neutral, targets })`;
  - the constants `DEFAULT_REGION_SHARPNESS` and `REGION_NEUTRAL_RADIUS`.
- 42 unit tests, including seeded randomised property tests. Two tests pin `regionWeights` with the default regions to 0.1.0: bit-identical to a verbatim port of the 0.1.0 code on the same runtime, and within 4 ulps of the outputs captured on Node 22, on any runtime.

**`@lowquo/surface-controls`**

- `Trackball.isInteracting()`, and the options `wheel`, `label`, `description` and `formatValue`.
- A 2D canvas renderer, used when WebGL is unavailable or the context is lost. The control switches back when the context is restored.
- New input: Page Up/Down for z, Escape to cancel a drag, and Ctrl/Cmd as fine modifiers besides Shift (all exactly 10× finer).
- Value text for screen readers, through `aria-describedby`, and a debounced polite live region for user changes. A focus ring for keyboard focus only.
- High-DPI handling: pixel ratio capped at 2, with changes tracked through a resolution media query.
- Pure, DOM-free helpers: `applyDrag`, `applyKey`, `applyWheel`, `isFineAdjust`, `formatPose`, `GestureTracker`, and the step constants (`FINE_RATIO`, `KEY_STEP_XY`, `KEY_STEP_Z`, `GESTURE_IDLE_MS`, …).
- 21 unit tests (geometry, interaction maths, gesture tracking).

**`@lowquo/surface-juce`**

- `SurfaceHostSession`: gesture-balanced writes plus host-authoritative, echo-free state. Host updates are buffered during a gesture, and the state is pulled with `surfaceGetState` once idle.
- Host-state helpers: `parseHostParameters`, `parseHostState`, `subscribeHostState` and `fetchHostState`.
- Errors and constants: `NativeCallError`, `NATIVE_FUNCTIONS`, `HOST_STATE_EVENT` and `DEFAULT_NATIVE_TIMEOUT_MS`.
- Options: `timeoutMs` on the bridge; `onError` and `onIdle` on the controller, which also gains the `gestureActive`, `pendingCalls` and `idle` getters.
- 41 unit tests.

**JUCE example**

- The `surfaceGetState` native function, and `SurfaceNativeBridge`, which holds the WebView-independent native logic so it can be tested.
- Navigation policy, resource-path rules, and a per-user WebView2 data folder on Windows.
- `LqSurfaceExampleTests`: a headless native test runner (ctest `lq_surface_native_tests`).
- An optional off-screen WebView smoke test (`-DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON`, ctest label `gui`).
- CMake options `LQ_SURFACE_BUILD_TESTS` and `LQ_SURFACE_WEBVIEW_SMOKE_TEST`.

**Tooling and CI**

- `npm run test:e2e`: 32 Playwright tests (Chromium) against the built playground, with a mocked JUCE backend.
- `npm run check:pack`: tarball contents and manifests, a consumer install from local tarballs only, a Node ESM import, and TypeScript `bundler` + `nodenext` checks. Runs in CI.
- New workflows: `Browser tests` (Playwright on three OSes), and `JUCE example` (macOS AU + VST3, Windows VST3 + WebView2; JUCE 9.0.4 at a pinned commit; headless ctest; bundle inspection).
- Packaging: a `LICENSE` copy in each package, plus publish metadata (`repository`, `homepage`, `bugs`, `keywords`, `publishConfig.access: public`, `sideEffects: false`, and an `exports` `default` condition).
- Dependabot: grouped minor/patch updates, separate majors, a release cooldown, labels and commit prefixes.

**Documentation**

- `docs/testing.md`, `docs/accessibility.md`, `docs/maintaining.md` (replaces `docs/first-push.md`), `THIRD_PARTY_NOTICES.md` and this changelog.
- `docs/licensing.md`: what each artefact contains, the licences involved (from JUCE 9.0.4's `LICENSE.md` and `JUCE.spdx.json`, and the WebView2 SDK's `LICENSE.txt`), the obligations those texts state, and the maintainer's licensing decisions.
- `check:pack` also fails if a published package depends on a JUCE package or ships JUCE source, which keeps JUCE inside the examples.
- Validators in the `JUCE example` workflow: pluginval v1.0.4 (pinned SHA-256) at strictness 10 on the VST3 (macOS, Windows) and the AU (macOS), plus `auval -strict`. The workflow also fails if the built plug-in identity ever changes.
- `examples/juce-plugin/scripts/macos-test-install.sh`: user-level install/uninstall for validation and DAW tests. It never overwrites, and only removes bundles carrying the example's bundle ID.
- **npm release preparation** (nothing is published):
  - Each package's `prepublishOnly` runs `tsc -b` and `scripts/release-guard.mjs`. The guard refuses a real `npm publish` unless `LQ_SURFACE_RELEASE_APPROVED` equals the package version and the publish runs from a clean checkout tagged `v<version>`. Dry runs are always allowed.
  - `npm run release:dry-run` (a publish dry run against an unreachable registry) and `npm run release:check` (typecheck, unit tests, `check:pack`, dry run).
  - `check:pack` additionally requires: package README links absolute (npmjs.com can't resolve repository-relative links), no bundled dependencies, permissively licensed runtime and peer dependencies, lockstep versions, internal ranges of `^<version>`, and the release guard in `prepublishOnly`.
  - Package README links now point to absolute GitHub URLs.
  - `docs/releasing.md` gives the full manual publish procedure; draft release notes are in `docs/release-notes/v0.1.0.md`.
- `docs/architecture.md`, `docs/releasing.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `GOVERNANCE.md`, and the issue and PR templates were rewritten.

### Changed

**`@lowquo/surface` (core), breaking**

- `sanitizedParameter` throws `RangeError` for a non-finite value. It used to substitute `0.5`.
- `clamp` throws `RangeError` when `min` or `max` is `NaN` or `min > max`.
- `clampPose` projects points outside the disk **radially**, so their direction is kept. Before, it clamped each axis to [-1, 1] first, which changed the direction of points outside the square. The result now satisfies `x * x + y * y <= 1` exactly, and `-0` becomes `+0`.
- `intensity` is capped at 1.
- `regionWeights(pose, regions?, options?)` now takes optional extra arguments. A point-free call such as `poses.map(regionWeights)` passes the array index as `regions` and throws a `TypeError`. Write `poses.map((p) => regionWeights(p))` instead.

**`@lowquo/surface-controls`, breaking**

- **DOM structure.** The control appends a focusable `div.lq-trackball` (with its canvas inside) and a visually hidden assistive container to the root. It no longer sets `position` or `min-height` on the root; the control fills the root, so give the root a size. The canvas is no longer the focus target.
- **Visuals.** The projection is orthographic, and the marker is drawn exactly at the pose position. A 270° ring shows z, and the twist now turns **clockwise** as z increases (it used to turn anticlockwise).
- **Sensitivities and steps:**
  - Arrow keys move 0.02 (fine 0.002); this was 0.025 (Shift 0.005).
  - z keys move 0.01 (fine 0.001); this was 0.025.
  - A drag moves the marker 1:1 with the pointer.
  - The wheel changes z by 0.025 per 100 px notch, capped at 0.1 per event.
- **Gestures.** Keyboard, wheel and double-click input coalesces into one gesture that ends 400 ms after the last input. Before, every event got its own begin/end, so `onGestureEnd` for discrete input now fires up to 400 ms later.
- Ctrl/Cmd/Alt+0 no longer reset; they are left to the browser (zoom reset). Plain `0` and Home still reset.
- `setPose` after `dispose()` is a no-op.
- The default accessible name is "Surface position", with `aria-roledescription="trackball"`. Keyboard help moved to `aria-describedby`.

**`@lowquo/surface-juce`, breaking**

- `createJuceBridge` rejects unknown IDs (`TypeError`) and non-finite values (`RangeError`) and never forwards them. Before, `setParameter` threw synchronously on an unknown ID, `beginGesture`/`endGesture` forwarded unknown IDs to the native side, and `NaN` became `0.5`.
- A native `false` result, a throw, or a timeout (5 s by default) rejects with `NativeCallError`.
- Queued `setParameter` calls are coalesced per ID (the latest value wins), never across a begin/end of that ID.
- `SurfaceHostController.change()` outside a gesture wraps itself in its own begin/end (it used to send un-gestured writes).
- Within a gesture, `change()` sends only the axes that changed. The first change of each gesture still sends all three.
- Non-finite poses are dropped and reported. No method throws, and no rejection is left unhandled.

**JUCE example, breaking for anyone who loaded an earlier build in a host**

- **Plug-in identity, now frozen (maintainer decision):** manufacturer `Lqoo` (was the placeholder `LqXX`), plug-in `Lqsf` (was `LqSf`; the AU and GarageBand rule is exactly one upper-case letter), bundle ID `io.lowquo.surface.example`. This changes the AU type/subtype/manufacturer triple and the VST3 class IDs, so hosts see a different plug-in from any earlier build. The values are distinct from every commercial lowquo plug-in.
- The parameter display names are now "Surface X/Y/Z" (they were the IDs). The IDs `surface_x`, `surface_y` and `surface_z` are unchanged.
- Gestures are tracked per parameter:
  - a set without a begin is applied as a self-contained gesture;
  - duplicate begins and unmatched ends are ignored;
  - open gestures end on navigation, reload and editor destruction.
- State restore:
  - data with a foreign root tag, or that isn't a JUCE state blob, is ignored;
  - non-numeric or non-finite values fall back to the default;
  - missing parameters reset to the default;
  - unknown children are dropped.
- Host state is checked at 30 Hz and emitted only when it changed and no page gesture is open. It used to be emitted at 12 Hz unconditionally.
- External `http(s)` links open in the system browser, and other navigation is blocked (see Security).
- Requires JUCE 9.0.4. C is now an enabled language, the macOS deployment target is 11.0, AU is built on macOS only, and the WebView2 loader is statically linked on Windows.
- The UI archive is owned per editor (it used to be a static `ZipFile`). The entry size limit is now 16 MiB (was 10 MB).

**Playground**

- `@juce-framework/webview` is pinned to 1.0.0. It is loaded with a dynamic `import()`, as a separate chunk, only after a JUCE WebView has been detected, so the plain browser demo never loads it.
- Host sync goes through `SurfaceHostSession`. The trackball and the sliders share one host gesture. Slider keyboard input is coalesced, and host updates are deferred while the user is interacting.
- The region-bar transition is disabled under `prefers-reduced-motion: reduce`.

**Tooling**

- `npm run pack:juce` uses `scripts/pack-juce.mjs` (Node only) and writes a deterministic ZIP: identical inputs give a byte-identical archive.
- `npm run clean` also removes Playwright output.
- The playground's `typecheck` covers the e2e tests too.

### Removed

- `scripts/pack_juce.py`. Python is no longer needed.
- The playground's `aria-live` readout. The trackball now announces user changes itself.

### Fixed

- **The npm release verification failed on Node 24** (`regions.test.mjs`). The core regression test compared `regionWeights` with fixtures captured on Node 22 using `Object.is`. V8 13.6 (Node 24) computes some `Math.pow` results 1 ulp differently from V8 12.4 (Node 22), so some weights moved by up to 2 ulps (about 1.6e-20 for the reported CRUSH value). This was not a regression: the unmodified 0.1.0 code shows the same drift on Node 24, and the current code is bit-identical to it on Node 22, 24 and 25. The fixtures are unchanged. They are now compared with a documented 4-ulp tolerance (exact zeros stay exact). A new test requires bit-for-bit equality with a verbatim port of the 0.1.0 code on the same runtime. Both tests catch a sharpness change of 1e-9 or a region-angle change of 1e-12 rad, and the exact test also catches numerically equivalent rewrites.
- **CI failed on all three OSes before installing anything.** `actions/setup-node@v4` with `cache: npm` stopped with "Dependencies lock file is not found", because `package-lock.json` had never been committed. The lockfile is now committed (Node 22.23.5 / npm 10.9.9), and CI installs with `npm ci`. The Phase 1 run (commit `b713702`) was verified green on ubuntu, macOS and windows.
- **`npm run typecheck` would have failed on a clean checkout.** Dependents resolve `@lowquo/surface` through `exports` to `dist/index.d.ts`, which didn't exist before a build. The fix is TypeScript project references (`tsc -b`, `composite: true`), plus a root `build:packages` that `typecheck`, `test`, `dev` and `check:pack` run first.
- Removed the invalid `packageManager: "npm@10"` field. The field expects an exact version.
- Closing the editor or reloading the page mid-drag could leave host gestures open ("stuck in touch").
- Plug-in instances shared one static UI archive, which also risked destruction-order problems at unload.
- Host updates could be echoed back, or the UI could jump back to stale values right after a drag.
- The playground type-checks under TypeScript 7: `vite-env.d.ts` declares the CSS side-effect import.
- Native warnings reported only by GitHub's hosted compilers (Xcode 26.6, MSVC 14.52): the deprecated `juce::ZipFile(InputStream*, bool)` constructor is replaced by the `std::unique_ptr` overload, and a shadowed variable in the native tests (MSVC C4458) is renamed.
- The trackball's default screen-reader instructions now mention every binding: Alt+Up/Down and the wheel for twist, and Shift, Control or Command for fine steps.
- Browser tests no longer assume that real key and wheel events arrive within the 400 ms gesture idle window. A loaded macOS runner spaced them further apart, which correctly produced two gestures, and the test failed. Balance is now checked once the native call log is quiet. A new test keeps the strict one-gesture check by dispatching the burst synchronously. Both were verified with events deliberately spaced 450 ms apart.
- Package READMEs: the controls quick start used a non-existent `onState` method, and its guard could drop a host update that arrived mid-gesture. The JUCE adapter sample didn't type-check. Both now compile against the published types.

### Security

- **Navigation restriction.** Only the resource-provider root and `about:blank` load in the WebView. `http(s)` links open in the system browser (rate-limited to one per second), every other scheme is blocked, and new-window requests never create a window. In 0.1.0, every navigation was allowed.
- **Strict native-argument validation.** Every native function checks the exact argument count, an exact parameter-ID string, and that the value is a JSON number, finite and in [0, 1]. Strings, booleans and null are rejected, where 0.1.0 coerced them.
- **Gesture teardown** on navigation, reload and editor destruction. This is covered by the headless native tests and the WebView smoke test.
- **Resource paths.** `..`, backslashes, colons, empty segments and control characters are refused.
- `JUCE_USE_CURL=0`: no network access at plug-in runtime.
- `check:pack` never resolves `@lowquo/*` from a registry. Inside the repository the packages always come from the local workspace, never from a published copy.
- The `JUCE example` workflow checks out with `persist-credentials: false`. All workflows are read-only and use no secrets.

### Known limitations / not verified

- **Windows:** the VST3 builds, and the headless native suite and pluginval (strictness 10, GUI tests on) pass on GitHub's `windows-latest`. Nothing checks what the WebView2 page displays on Windows, and no Windows DAW has been tested.
- **No DAW testing.** Only Ableton Live 12 is available, and it needs a manual pass (procedure in `docs/testing.md`). Steinberg's VST3 validator hasn't been run (pluginval skips it without the binary; building it needs approval). There is no code signing or notarisation, and no universal (x86_64) macOS build. pluginval and `auval -strict` pass on macOS.
- **No screen-reader verification** (VoiceOver, NVDA), and keyboard routing inside DAWs is untested.
- The WebView2 runtime behaviour is untested. A real multi-display pixel-ratio change is untested (it is simulated in Chromium).
- If the WebView content process crashes without a navigation, gestures stay open until the page reloads or the editor closes.
- Host state is polled at 30 Hz, so faster host changes are coalesced.
- `vite build` warns that the main playground chunk is over 500 kB (about 573 kB).
- npm scope, licensing and plug-in identity were decided on 2026-11-20 ([docs/releasing.md](docs/releasing.md#open-maintainer-decisions)). Still open: licence notices in bundles and the pre-distribution checklist (docs/licensing.md), the Vite 8 build target, Playwright version age, the AU `network.client` entitlement, editor keyboard focus, initial-commit attribution and the version number.

## Initial source import (2026-11-20, untagged, never published)

Initial source starter, committed as `3df553c` ("first commit"). It was not tagged and not published to npm.

### Added

- `@lowquo/surface`: typed pose, clamping, host parameter mapping, illustrative region weights, and parameter sanitising.
- `@lowquo/surface-controls`: a Three.js trackball with pointer, wheel and keyboard input. Without WebGL it showed a static, CSS-styled canvas that didn't display the value.
- `@lowquo/surface-juce`: a JUCE native-function bridge with ordered calls and a gesture-balancing host controller.
- `examples/playground`: a Vite browser demo with precision sliders.
- `examples/juce-plugin`: a stereo passthrough JUCE WebView example with three host-automatable parameters. It was not built or host-tested.

[Unreleased]: https://github.com/Lowquo/lq-surface/compare/3df553c...HEAD
