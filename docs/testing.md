# Testing

Status labels used on this page:

- **verified**: run and passing in the stated environment.
- **pending**: implemented, but not yet run in that environment (for example remote CI).
- **not run**: nobody has done it yet.
- **blocked**: needs something not yet available or approved.

"Locally" means macOS arm64 with Node 22.23.5 / npm 10.9.9 (and JUCE 9.0.4 for native tests) on the integration branch.

## Status

| Area | Status |
| --- | --- |
| Phase 1 CI (`npm ci`, typecheck, build, unit tests) on ubuntu/macOS/windows | **Verified on GitHub Actions** (run 44737857469, PR #5, commit `b713702`). |
| Integrated tree: typecheck, build, 103 unit tests, `check:pack`, 33 browser tests | **Verified locally and on GitHub Actions** on ubuntu/macOS/windows (runs 44738961814 (`CI`), 44738961923 (`Browser tests`) and 44738961969 (`JUCE example`), commit `5b18ee8`). |
| Native example on macOS arm64: AU + VST3 build, headless suite, WKWebView smoke test | **Verified locally and on GitHub Actions** (`macos-latest`, Xcode 26.6; the smoke step passed). |
| Native example on Windows (VST3 + WebView2) | **Build and headless suite verified on GitHub Actions** (`windows-latest`, MSVC 14.52). The editor/WebView2 runtime has **not** been run on Windows (no GUI test there). |
| `auval -strict` (AU) | **Passed** locally (macOS 15.7.7) and on GitHub Actions (`macos-latest`). |
| `pluginval` v1.0.4, strictness 10, GUI tests on | **Passed** locally for VST3 and AU, and on GitHub Actions for macOS VST3 and AU. Windows VST3 on GitHub Actions (`windows-latest`): **passed**. Its Editor tests created and destroyed the WebView2 editor without error; what the page displays is not checked on Windows. |
| Steinberg VST3 validator | **Blocked:** pluginval skips it unless a validator binary is supplied. Building it from Steinberg's SDK needs maintainer approval. |
| Frozen plug-in identity (AU type/subtype/manufacturer, bundle IDs, VST3 CIDs) | **Verified** by the `JUCE example` workflow on macOS and Windows. |
| Any DAW (the [manual checklist](#manual-dawhost-checklist)) | **Not run.** The maintainer's Mac has only Ableton Live 12 Suite, which can't be driven from a terminal without granting accessibility permissions (a security setting). Use the [Ableton procedure](#ableton-live-12-macos-disposable-project) below. No Windows DAW is available. |
| VoiceOver / NVDA ([accessibility.md](accessibility.md#manual-check-procedure)) | **Not run** |
| WebView2 runtime behaviour, a real multi-display pixel-ratio change | **Not run.** The pixel-ratio change is only simulated in Chromium tests. |

## Test layers

| Layer | What it covers | Where | Command | CI job | Status |
| --- | --- | --- | --- | --- | --- |
| Static checks | Package and playground types (including the e2e tests), and the playground build | all workspaces | `npm run typecheck`, `npm run build` | `Typecheck, build and test (<os>)` | Verified locally |
| Core unit (41) | Pose contract (seeded randomised property tests: exact disk, idempotence, round trips), parameter validation, regions and blending, pinned 0.1.0 region fixtures | `packages/core/test` | `npm test` | `Typecheck, build and test (<os>)` | Verified locally |
| Controls unit (21) | Layout and projection geometry, drag/key/wheel maths and step sizes, fine ratio, `GestureTracker` coalescing and balance (randomised sequences) | `packages/controls/test` | `npm test` | `Typecheck, build and test (<os>)` | Verified locally |
| JUCE adapter unit (41) | Call ordering, coalescing and bounded queues, timeouts, `NativeCallError`, controller balance and per-axis dedupe, hostile host-state payloads, the session's echo suppression and stale-state resync | `packages/juce/test` | `npm test` | `Typecheck, build and test (<os>)` | Verified locally |
| Package contents | Tarball contents and manifests, workspace links, consumer install from local tarballs, Node ESM import, TypeScript `bundler` + `nodenext` | `scripts/check-pack.mjs` | `npm run check:pack` | `Typecheck, build and test (<os>)` | Verified locally |
| Browser e2e (33) | The built playground in Chromium. Rendering on demand, high-DPI, WebGL context loss and 2D fallback. Pointer, wheel, keyboard, Escape, focus ring and accessible text. Dispose and lifecycle, and gesture balance and host sync through a mocked JUCE backend. | `examples/playground/e2e` | `npm run test:e2e` | `Playwright (Chromium) on <os>` | Verified locally: 32/32, and 160/160 with `--repeat-each=5` |
| Native headless | Parameter layout, state round trip and hostile state, instance isolation, bit-exact passthrough, strict native-argument validation, gesture balance (including reload and teardown mid-gesture), host-state change detection and echo suppression, navigation policy, embedded archive | `examples/juce-plugin/tests/SurfaceExampleTests.cpp` (ctest `lq_surface_native_tests`) | `ctest` | `macOS (AU + VST3)`, `Windows (VST3 + WebView2)` | Verified locally (44 groups, 6299 expectations). Windows not run. |
| Native WebView smoke | The real editor off-screen in WKWebView: host automation reaches the UI, slider edits arrive as balanced gestures, `file:` navigation is blocked, reload and editor close mid-gesture end gestures, `surfaceGetState` restore, hostile calls refused | `examples/juce-plugin/tests/WebViewSmokeTest.cpp` (ctest label `gui`) | `ctest` (configure with `-DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON`) | `macOS (AU + VST3)`, informational (`continue-on-error`) | Verified locally (18/18). Not built on Windows. |
| Manual host matrix | Real DAWs: automation, recall, lifecycle, display, focus | [checklist below](#manual-dawhost-checklist) | manual | — | Not run |
| Manual assistive technology | VoiceOver, NVDA | [accessibility.md](accessibility.md#manual-check-procedure) | manual | — | Not run |

## Running the tests

With Node 22+ and npm 10+, from the repository root.

### Unit tests

```sh
npm ci
npm test
```

`npm test` compiles the packages (`npm run build:packages`), then runs each workspace's `node:test` suites. The suites import compiled output from `dist/`. To run one workspace, or one file, build first:

```sh
npm run build:packages
npm test -w @lowquo/surface            # or @lowquo/surface-controls, @lowquo/surface-juce
node --test packages/core/test/pose.test.mjs
```

### Browser tests

```sh
npm run build                        # the tests serve the BUILT playground
npx playwright install chromium      # once; on Linux: npx playwright install --with-deps chromium
npm run test:e2e
npm run test:e2e -- --repeat-each=5  # flakiness check
```

- The tests start `vite preview` on `127.0.0.1:4791`. Set `LQ_E2E_PORT` to use another port.
- Reports go to `examples/playground/playwright-report/`, and traces of failed tests to `examples/playground/test-results/`.
- The host tests emulate JUCE's native-interop protocol on `window.__JUCE__`, so the playground loads the real `@juce-framework/webview` chunk against that mock.
- No automated test asserts that the *plain* demo never fetches that chunk. A one-off Chromium check during integration found that the plain demo requested only the main chunk and made no requests outside the preview server.

### Package checks

```sh
npm run check:pack                   # full: tarballs + consumer install + import/type-check
npm run check:pack -- --contents-only  # tarball contents only, no install, no network
npm run release:dry-run              # `npm publish --dry-run` against an unreachable registry
npm run release:check                # typecheck + unit tests + check:pack + release:dry-run
```

Besides tarball contents, `check:pack` enforces these publication rules:

- Package README links are absolute, because npmjs.com can't resolve repository-relative links.
- No package bundles dependencies.
- Runtime and peer dependencies have permissive licences (MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, Zlib).
- No package depends on JUCE or ships JUCE source.
- All packages share one version, and internal ranges are `^<version>`.
- Every package runs the release guard in `prepublishOnly`.

The full check resolves `@lowquo/*` only from the local tarballs. `three`, `@types/three` and `typescript` come from your configured registry or the npm cache.

### Native (JUCE example)

**Verified on macOS arm64** (JUCE 9.0.4, Ninja). Expected result: 0 compiler warnings, and ctest 2/2 passing.

```sh
npm run pack:juce
cmake -S examples/juce-plugin -B <dir> -G Ninja -DCMAKE_BUILD_TYPE=Release -DJUCE_SOURCE_DIR=<JUCE 9.0.4> -DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON
cmake --build <dir>
ctest --test-dir <dir>
```

- Use `ctest --test-dir <dir> --label-exclude gui` to run only the headless suite, for example without a GUI session.
- The Windows commands are in [examples/juce-plugin/README.md](../examples/juce-plugin/README.md#2-build). They run in the `JUCE example` CI job on `windows-latest`; they have not been run on a local Windows machine.
- The build doesn't install anything into plug-in folders.

### Validators

Approved by the maintainer on 2026-11-20. They run locally and in the `JUCE example` workflow; nothing they
build or download is distributed.

- **pluginval** [v1.0.4](https://github.com/Tracktion/pluginval/releases/tag/v1.0.4) (Tracktion; a test
  tool, never shipped). The macOS build is a notarised Developer ID app (Tracktion Software Corp,
  `YLB5W3GE5T`). CI pins the SHA-256 of both release zips. The VST3 is validated by path, without installing:

  ```sh
  pluginval --strictness-level 10 --timeout-ms 300000 --validate "<build>/LqSurfaceExample_artefacts/Release/VST3/lq-surface example.vst3"
  ```

- **auval** needs the AU in a plug-in folder. Use the [test install script](#installing-for-validation-and-daw-tests):

  ```sh
  examples/juce-plugin/scripts/macos-test-install.sh install <build>
  auval -strict -v aufx Lqsf Lqoo
  pluginval --strictness-level 10 --validate "$HOME/Library/Audio/Plug-Ins/Components/lq-surface example.component"
  examples/juce-plugin/scripts/macos-test-install.sh uninstall
  ```

Results (macOS 15.7.7 arm64 locally, and GitHub's `macos-latest`):

| Check | VST3 | AU |
| --- | --- | --- |
| `pluginval`, strictness 10, 25 test groups incl. Editor, Open editor whilst processing, Editor Automation, Plugin state restoration, Automation, Fuzz parameters, Parameter and Background thread safety | SUCCESS | SUCCESS |
| `auval -v` and `auval -strict` | n/a | AU VALIDATION SUCCEEDED |

On Windows (GitHub's `windows-latest`, MSVC 14.52), pluginval v1.0.4 at strictness 10 with GUI tests also passes for the VST3.

Notes:

- pluginval skips its "vst3 validator" group unless `--vst3validator` points to Steinberg's validator (blocked, see [Status](#status)).
- For the AU, pluginval prints `!!! WARNING: Current program is -1... Is this correct?`. That comes from JUCE's AU
  hosting layer reading the current preset of a plug-in that has one program and no factory presets. It is
  informational and doesn't fail the run.
- `auval -a` and `auval -s aufx` (listing every installed AU) hung on the maintainer's Mac while scanning other
  vendors' components. Validate the example directly by its triple `aufx Lqsf Lqoo`.

### Installing for validation and DAW tests

`examples/juce-plugin/scripts/macos-test-install.sh` (macOS) installs into **user-level** folders only
(`~/Library/Audio/Plug-Ins/Components` and `.../VST3`). It never uses `/Library` or `sudo`, and **never
overwrites**: it stops if a bundle with the same name exists. `uninstall` removes a bundle only if its
`CFBundleIdentifier` is `io.lowquo.surface.example`. Both refresh the AU cache by restarting the user-level
`AudioComponentRegistrar`, which relaunches on demand. `status` shows what is installed.

On Windows, the user-level VST3 folder is `%LOCALAPPDATA%\Programs\Common\VST3`. Copy `lq-surface example.vst3`
there by hand for a DAW test, and delete it afterwards. No script is provided because no Windows machine was
available to test one.

Compiled example plug-ins must not be distributed ([licensing.md](licensing.md)), so remove them after testing.

## CI workflows

All three workflows run on pushes to `main`, on pull requests to `main`, and on manual dispatch. They use `permissions: contents: read` and no secrets.

| Workflow | Job (required-check name) | What it runs | Status |
| --- | --- | --- | --- |
| `CI` (`ci.yml`) | `Typecheck, build and test (ubuntu-latest)`, `(macos-latest)`, `(windows-latest)` | `npm ci`, typecheck, build, unit tests, `check:pack`, then fails if any tracked file changed | Verified on GitHub (all three OSes, including `check:pack`). |
| `Browser tests` (`browser.yml`) | `Playwright (Chromium) on ubuntu-latest`, `… on macos-latest`, `… on windows-latest` | `npm ci`, build, install Chromium (`--with-deps`), `npm run test:e2e`. Uploads the report on failure. | Verified on GitHub on each OS. |
| `JUCE example` (`juce.yml`) | `macOS (AU + VST3)`, `Windows (VST3 + WebView2)` | `npm ci`, `pack:juce`, JUCE 9.0.4 at a pinned commit, the WebView2 SDK from NuGet (Windows), build, headless ctest, bundle inspection. On macOS it also runs the WebView smoke test as `continue-on-error`. | Verified on GitHub: both jobs passed, including the macOS smoke step. |

CI doesn't run any DAW, `auval`, `pluginval`, code signing, or the Windows WebView smoke test.

## Manual DAW/host checklist

For maintainers, before a release and after changes to the JUCE example, the adapter, or gesture or host-state handling.

- This needs a native build of `examples/juce-plugin` ([above](#native-juce-example)).
- Install with the [test install script](#installing-for-validation-and-daw-tests), and uninstall afterwards.
- **Use a new, disposable project** saved under a temporary folder (for example `~/lq-surface-daw-tests/`). Never open or modify an existing production project.
- Put the plug-in on a stereo audio track.
- Record every run in the [results table](#results). If an item doesn't apply to a host, mark it "n/a" in the notes and say why.

### Load and pass-through

- [ ] The host scans the plug-in. On macOS AU, `auval -strict -v aufx Lqsf Lqoo` passes. The identity changed during 0.1 hardening (`LqSf`/`LqXX` became `Lqsf`/`Lqoo`), so rescan if an older build was ever installed.
- [ ] The editor opens and shows the trackball, or the 2D fallback when WebGL is unavailable, with no blank window.
- [ ] Audio passes through unchanged: the plug-in output null-tests against the dry signal.
- [ ] The parameter list shows exactly three parameters, "Surface X", "Surface Y" and "Surface Z" (IDs `surface_x`, `surface_y`, `surface_z`), each normalised [0, 1] with default 0.5.

### Automation

- [ ] **Write:** in write mode, a drag records all three lanes, as one gesture per lane per drag.
- [ ] **Read:** on playback, the UI follows the automation (the example polls host state at 30 Hz) and writes no new points.
- [ ] **Touch:** grabbing the control overrides the lanes only while you hold it. On release, playback returns to the existing automation.
- [ ] **Latch:** after release, the last value is held until the transport stops.
- [ ] Holding an arrow key or scrolling the wheel produces **one** touch per burst, which ends about 400 ms after the last input. Double-click reset, the precision sliders and the reset button produce balanced gestures. In the host, no lane is left in a touched state.
- [ ] Escape during a drag restores the pre-drag value in the host.

### Host automation while editing

- [ ] Play back automation on the same parameters while dragging. The UI doesn't jump or fight the pointer during the drag. After release, axes you didn't touch show the host's value, and the touched axes show your last write.
- [ ] Draw automation or edit a value in the host's generic parameter view with the editor open. The UI updates and sends nothing back (no new gesture).

### Project save and recall

- [ ] Set a non-neutral pose, then save, close and reopen the project. The parameters and the UI restore.
- [ ] Recall the project with the editor closed, then open the editor. The UI shows the recalled pose, not neutral.
- [ ] Host undo/redo of parameter changes (where supported) updates the UI.

### Multiple instances

- [ ] Run two or more instances on different tracks with all editors open. Each editor changes only its own instance's parameters.
- [ ] Duplicating a track or instance copies its state, after which the two stay independent.

### Editor lifecycle

- [ ] Close and reopen the editor at least 10 times, during playback too. Nothing crashes, and the UI matches the host state each time.
- [ ] **Close the editor mid-gesture** (keep the mouse button held and close the window with a host shortcut). The host isn't left with an open gesture, and automation write doesn't stay stuck in touch.
- [ ] Hide and show the editor, for example by switching host tabs or windows if the host does that. The UI restores the host state.
- [ ] Remove the plug-in from the track with its editor open. Nothing crashes.
- [ ] Click the GitHub and lowquo.io links. They open in the system browser, never inside the plug-in window.

### Sample rate and buffer size

- [ ] Change the sample rate (for example 44.1, 48 and 96 kHz) and the buffer size (for example 32 to 1024 samples) with the editor open, both stopped and during playback. Nothing crashes, the parameter values are unchanged, the UI stays responsive, and audio is still passthrough.
- [ ] An offline render or bounce with automation completes and matches the dry signal.

### Formats and platforms

- [ ] **macOS VST3** in at least one host.
- [ ] **macOS AU** in at least one host (for example Logic Pro or GarageBand).
- [ ] **Windows VST3** with the WebView2 runtime installed. Check that WebView2 can create its user-data folder (`%LOCALAPPDATA%\lowquo\lq-surface-example\WebView2`).
- [ ] **Windows without WebView2** (if practical): record what happens, such as a blank editor, an error message or a crash. Crashing the host is a bug.
- [ ] The oldest macOS you support (the deployment target is 11.0): the UI loads in that system's WKWebView.

### Display

- [ ] **High-DPI:** on Retina or Windows 150–200% scaling, the trackball is sharp and pointer positions map correctly. The render pixel ratio is capped at 2.
- [ ] **Multi-monitor with different scale factors:** move the editor between monitors. The UI re-renders at the new ratio, and pointer input still hits the right place.

### Keyboard focus inside the plug-in window

The example uses JUCE's default `EDITOR_WANTS_KEYBOARD_FOCUS` (`FALSE`), so results may vary by host.

- [ ] Click the trackball, then use the arrow keys, Page Up/Down and Escape. The plug-in receives them, and the host doesn't also act on them (by moving the playhead or selection, for example). Record per host.
- [ ] Tab and Shift+Tab move between the trackball, the precision sliders, the reset button and the links inside the plug-in window.
- [ ] The keyboard focus ring is visible on the trackball.
- [ ] Alt/Option+↑/↓ changes character and isn't swallowed by the host.
- [ ] Record what the space bar does while the plug-in has focus (host transport or plug-in).
- [ ] After the editor closes, host keyboard shortcuts work normally.

### Accessibility

- [ ] Follow the VoiceOver and NVDA procedure in [accessibility.md](accessibility.md#manual-check-procedure) inside the plug-in window, not only in a browser.

### Ableton Live 12 (macOS), disposable project

This is the only DAW on the maintainer's Mac. It has not been run yet. Allow about 20 minutes.

1. **Install.** Quit Live, then run `examples/juce-plugin/scripts/macos-test-install.sh install <build>`.
2. **Scan.** In Live's *Plug-Ins* settings, make sure Audio Units v2 and VST3 (system folders) are enabled, then
   rescan. If you have to switch a setting on, note it and switch it back during cleanup.
3. **Disposable project.** Create a **new** Live Set and save it at once as
   `~/lq-surface-daw-tests/lq-surface-<date>.als`. Don't open existing Sets during the test.
4. Load **lq-surface example** (listed under the manufacturer *lowquo*) on an audio track. Test the AU and the
   VST3 on separate tracks.
5. Work through the sections above:
   - Load and pass-through.
   - Automation: arm automation, record a drag in Arrangement view, then play it back. Live has no separate
     touch or latch modes, so record what happens when you release the control.
   - Host automation while editing.
   - Project save and recall: save, close and reopen *this* Set only.
   - Multiple instances.
   - Editor lifecycle: open and close the plug-in window repeatedly, and close it in the middle of a drag.
   - Keyboard focus: Live keeps many keys for its own shortcuts.
6. Record each item in the [results table](#results). Note the Live version and the plug-in format.
7. **Clean up.** Quit Live and run `macos-test-install.sh uninstall`. Delete `~/lq-surface-daw-tests/` when
   you no longer need it. Rescan plug-ins in Live, and revert any setting you changed in step 2.

### Results

Add one row per OS/host/format run. Use the commit SHA of the build tested. "Pass" means every applicable item passed. Otherwise list the failing sections and link an issue.

| Date | OS + version | Host | Host version | Format | Commit | Result | Tester | Notes / issues |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _none yet_ | | | | | | | | |
