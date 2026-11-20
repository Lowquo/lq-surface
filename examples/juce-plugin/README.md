# JUCE WebView plugin example (not lq-hit)

A minimal stereo **passthrough** plug-in (VST3 everywhere, AU on macOS) whose editor is the bundled
lq-surface playground running in a JUCE `WebBrowserComponent`. The trackball drives three
host-automatable parameters. Audio is never modified: there is no DSP, no commercial algorithm and
no lq-hit code in this example.

This is an educational starting point, **not** a production-validated plug-in. See
[Verification status](#verification-status) for exactly what has and has not been tested.

## Requirements

| | |
| --- | --- |
| JUCE | **9.0.4** (supplied separately under its own licence; other versions are untested) |
| CMake | 3.22+ |
| Compilers | C **and** C++17 (JUCE 9 builds its bundled zlib/libpng as C) |
| Node.js | 22+ with npm 10+ (packages the web UI; Python is not needed) |
| macOS | Apple Command Line Tools are enough with the Ninja or Unix Makefiles generator; minimum deployment target 11.0 |
| Windows | Visual Studio 2019/2022, the **Microsoft.Web.WebView2** NuGet package at build time, the Microsoft Edge **WebView2 Runtime** at run time |

## 1. Package the web UI

At the repository root:

```sh
npm ci
npm run pack:juce
```

This builds the playground and writes `examples/juce-plugin/resources/surface-ui.zip` with
`scripts/pack-juce.mjs`. The ZIP is deterministic (sorted entries, fixed timestamps, no OS
attributes), so identical inputs give byte-identical archives. It is generated locally and ignored
by Git. CMake refuses to configure without it.

## 2. Build

macOS (no Xcode.app required):

```sh
cmake -S examples/juce-plugin -B build/surface-juce -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DJUCE_SOURCE_DIR=/absolute/path/to/JUCE-9.0.4
cmake --build build/surface-juce
ctest --test-dir build/surface-juce --output-on-failure
```

Windows (PowerShell). The WebView2 SDK is only needed to build; `nuget.exe` or the
`Install-Package` command printed by JUCE's `FindWebView2.cmake` both work:

```powershell
nuget install Microsoft.Web.WebView2 -Version 1.0.3485.44 -OutputDirectory C:\deps\nuget
cmake -S examples/juce-plugin -B build/surface-juce -DJUCE_SOURCE_DIR=C:/path/to/JUCE-9.0.4 `
  -DJUCE_WEBVIEW2_PACKAGE_LOCATION=C:/deps/nuget
cmake --build build/surface-juce --config Release
ctest --test-dir build/surface-juce -C Release --output-on-failure
```

Instead of `JUCE_SOURCE_DIR` you can use an installed JUCE CMake package (`find_package(JUCE)`).

Bundles are written to `build/surface-juce/LqSurfaceExample_artefacts/<Config>/{VST3,AU}`.
`COPY_PLUGIN_AFTER_BUILD` is off: nothing is installed into system or user plug-in folders. Copying
a bundle into a plug-in folder to try it in a DAW is a deliberate, manual step.

CMake options: `LQ_SURFACE_BUILD_TESTS` (default `ON`) builds the headless test runner;
`LQ_SURFACE_WEBVIEW_SMOKE_TEST` (default `OFF`) adds the off-screen WebView smoke test (needs a GUI
session).

## How it works

### Parameters and state

`surface_x`, `surface_y`, `surface_z`: normalised `[0, 1]`, default `0.5`, version hint 1
(`surface_x = (x + 1) / 2`, `surface_y = (y + 1) / 2`, `surface_z = z`). Host parameter state is
authoritative. State is saved as the `AudioProcessorValueTreeState` XML (`<SurfaceState>`).
`setStateInformation` ignores data with any other root tag or that is not a JUCE state blob; known
parameters with non-numeric or non-finite values fall back to the default, other values are
clamped to `[0, 1]`, missing parameters are reset to the default and unknown children are dropped.

### Native functions (WebView -> C++)

| Function | Arguments | Result |
| --- | --- | --- |
| `surfaceBeginGesture` | `id` | `true`, or `false` if rejected |
| `surfaceSetParameter` | `id`, `value` | `true`, or `false` if rejected |
| `surfaceEndGesture` | `id` | `true`, or `false` if rejected |
| `surfaceGetState` | none | `{ x, y, z }` (normalised), or `false` if called with arguments |

Validation is strict: exactly the listed number of arguments; `id` must be the string `surface_x`,
`surface_y` or `surface_z`; `value` must be a JSON number (not a string, boolean or null), finite and
in `[0, 1]`. All logic lives in `src/SurfaceNativeBridge.*`, which has no WebView dependency.

Gesture balance, tracked per parameter:

- a duplicate begin is ignored, an unmatched end is ignored;
- a set without an open gesture is applied as a self-contained begin/set/end;
- every gesture the page left open is ended when the page navigates or reloads (`pageAboutToLoad`,
  including JUCE's own `about:blank` unload while the editor is hidden) and when the editor is
  destroyed. A reload or an editor close mid-drag never leaves automation stuck in "touch".

### Host state (C++ -> WebView)

A 30 Hz message-thread timer compares the parameter values with what the page has already seen and
emits `surfaceHostState` with `{ x, y, z }` only when something changed. Values the page wrote itself
or pulled with `surfaceGetState` count as seen, so the page never receives echoes of its own writes,
and nothing is emitted while a page gesture is open. On load the page pulls the state with
`surfaceGetState`, so reopening the editor or recalling a project restores the UI deterministically.
The UI side (`@lowquo/surface-juce`'s `SurfaceHostSession`) additionally holds back host updates
while its own writes are still in flight and resynchronises once they have settled, which prevents a
jump back to stale values right after a drag.

Nothing in the editor runs on, or is called from, the audio thread. `processBlock` only clears
surplus output channels.

### Security

- Pages are served only from the embedded ZIP through JUCE's resource provider (no allowed external
  origin). Request paths containing `..`, backslashes, colons, empty segments or control characters
  are refused; entries larger than 16 MiB are refused. If the archive is missing a small built-in
  page explains how to rebuild it.
- The WebView may only load the resource-provider root (`juce://juce.backend/` on macOS/Linux,
  `https://juce.backend/` on Windows) and `about:blank`. `http`/`https` links are never loaded in the
  WebView; they open in the system browser (rate-limited to one per second). Every other scheme
  (`file:`, `data:`, `javascript:`, ...) is blocked. New-window requests never create a window.
- No network access is needed at runtime (`JUCE_USE_CURL=0`, no remote resources in the bundle).
  Note: JUCE's default AU `Info.plist` still declares the `network.client` resource usage.
- The UI archive is owned by each editor (no static `ZipFile`), so instances share nothing and
  nothing is destroyed during static de-initialisation.

### Windows / WebView2

- The WebView2 loader is linked statically (`NEEDS_WEBVIEW2 TRUE` +
  `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1`); a plug-in cannot rely on `WebView2Loader.dll`
  being on the host's DLL search path.
- WebView2 must be able to write its user-data folder. The default sits next to the host executable
  and is often not writable, so the editor uses
  `%LOCALAPPDATA%\lowquo\lq-surface-example\WebView2` (falling back to the temp folder).
- Users need the Microsoft Edge WebView2 Runtime (preinstalled on current Windows 10/11).

## Tests

`LqSurfaceExampleTests` (registered with CTest as `lq_surface_native_tests`) is headless: it creates
no window, editor or WebView. It covers the parameter layout; state round trip, wrong tag, garbage
and hostile values; multiple-instance isolation; bit-exact passthrough (random data plus denormals,
NaN and infinities); strict native-function validation with hostile arguments parsed exactly as JUCE
parses them; gesture balance (duplicates, unmatched ends, set without begin, reload mid-gesture,
teardown, randomised sequences); host-state change detection and echo suppression; the navigation
policy; and the embedded archive (found by original file name, `index.html` and every referenced
asset served with the right MIME type, traversal refused).

`LqSurfaceWebViewSmoke` (`-DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON`, CTest label `gui`) creates the real
editor off-screen and drives the page through `evaluateJavascript`: host automation reaches the
UI, a slider edit reaches the host as a balanced gesture, `file:` navigation is blocked, a reload
mid-gesture ends the gesture and restores the UI from host state, hostile native calls are refused,
and closing the editor mid-gesture ends the gesture.

## Verification status

Verified on macOS 15 (Apple Silicon, Apple clang 17, Command Line Tools only, CMake 4.4, Ninja)
with JUCE 9.0.4:

- Release and Debug builds of the VST3 and AU bundles, `lq_surface_native_tests` and the WebView
  smoke test all pass. Debug runs print no JUCE assertions.
- Bundle structure and `Info.plist` were inspected and the VST3 `moduleinfo.json` was generated by
  JUCE's post-build helper (which loads the plug-in). The bundles were **not** installed.

Not verified:

- **Windows**: no Windows machine was available. `.github/workflows/juce.yml` builds the VST3 with
  the WebView2 SDK and runs the headless tests, but it has not run yet; treat Windows as untested.
- No DAW testing, no `pluginval` or `auval` run (these need maintainer approval), no code signing
  or notarisation, no universal (x86_64) macOS build.
- Linux is not a target of this example.

Before using this in a released product, validate startup in real DAWs, automation read/write and
touch behaviour, project recall, multiple instances, editor open/close cycles and WebView renderer
failures.

## Known limitations

- If the WebView's content process crashes without a navigation, gestures the page had open stay
  open until the page reloads or the editor closes.
- Host state is polled at 30 Hz; changes faster than that are coalesced (the latest value wins).
- `about:blank` is allowed because JUCE uses it to unload the page while the editor is hidden.
