# lq-surface

**An open-source interface toolkit for audio software.**

[![CI](https://github.com/Lowquo/lq-surface/actions/workflows/ci.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/ci.yml)
[![Browser tests](https://github.com/Lowquo/lq-surface/actions/workflows/browser.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/browser.yml)
[![JUCE example](https://github.com/Lowquo/lq-surface/actions/workflows/juce.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/juce.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

lq-surface provides precise three-axis controls for audio software, kept separate from the DSP. It is an independent lowquo project. **This repository does not contain the lq-hit sound engine or any proprietary DSP.**

> **Status: 0.1.0, pre-release.** Nothing has been published to npm. The `@lowquo` npm scope is not registered yet, so don't install `@lowquo/*` packages from a registry. The browser playground and the JUCE example are for evaluation. They are not production-validated plug-ins. No DAW has been tested yet. Windows is verified only as a CI build plus headless tests, not with a running editor. [docs/testing.md](docs/testing.md#status) lists what has and hasn't been verified.

## What is included?

| Package | Purpose |
| --- | --- |
| [`@lowquo/surface`](packages/core/README.md) | Pure TypeScript pose contract (exact unit disk, radial projection), host parameter mapping and validation, and generic sound-space regions with weights and value blending. No DOM, renderer or JUCE code, and no runtime dependencies. |
| [`@lowquo/surface-controls`](packages/controls/README.md) | A three-axis trackball (x/y on a disk, z twist). Rendered with Three.js, with a 2D canvas fallback. Pointer, wheel and keyboard input, 10× fine adjustment, balanced and coalesced host gestures, and screen-reader value text. Draws only when something changes; there is no animation and no idle render loop. |
| [`@lowquo/surface-juce`](packages/juce/README.md) | Adapter to a JUCE `WebBrowserComponent`. Ordered, coalesced, gesture-balanced parameter writes, and validated, echo-free host state. |
| `examples/playground` | Private (unpublished) browser demo with precision sliders. It is also the UI bundled into the JUCE example. |
| [`examples/juce-plugin`](examples/juce-plugin/README.md) | A JUCE 9 stereo **passthrough** plug-in (VST3, plus AU on macOS) whose editor is the playground, with headless native tests. **No DSP, no lq-hit code.** |

## Quick start

Requires **Node.js 22+** and **npm 10+** (npm 10 ships with Node 22). The committed `package-lock.json` was generated with Node 22.23.5 / npm 10.9.9.

```sh
git clone https://github.com/Lowquo/lq-surface.git
cd lq-surface
npm ci                            # exact install from the committed lockfile
npm run build                     # compile the packages (tsc -b), then build the playground (vite build)
npm test                          # compile the packages, then run the unit tests (node:test)
npm run dev                       # compile the packages, then serve the playground on 127.0.0.1
```

Browser tests run against the **built** playground. They need Playwright's Chromium, which is a one-off download:

```sh
npm run build
npx playwright install chromium   # on Linux CI: npx playwright install --with-deps chromium
npm run test:e2e
```

`npm run check:pack` checks the npm tarballs and runs a consumer smoke test. [CONTRIBUTING.md](CONTRIBUTING.md#commands) explains every script, including why `npm run typecheck` writes `packages/*/dist`.

Open the URL that Vite prints. To use the trackball:

- **Drag** to move x/y. The marker follows the pointer 1:1, and pressing doesn't make it jump. Hold **Shift**, **Ctrl** or **⌘** for 10× finer movement.
- To change character (z), **Alt/Option-drag** vertically, scroll the **wheel**, or press **Page Up/Down** (or **Alt + ↑/↓**).
- Use the **arrow keys** for x/y. ↑ moves towards PUNCH at the top. **Home**, **0** or a **double-click** resets to neutral, and **Esc** cancels a drag.
- The **precision sliders** are an alternative to the 3D control and stay in sync with it.

The full reference is in [docs/accessibility.md](docs/accessibility.md#keyboard-and-pointer-model).

## Using the packages

These examples type-check against the built 0.1.0 packages. The packages aren't on npm yet. Until they are, use them from this repository (npm workspaces) or from tarballs made with `npm pack`.

```ts
import { Trackball } from '@lowquo/surface-controls';
import { dominantRegion, regionWeights, toParameters } from '@lowquo/surface';

const trackball = new Trackball(document.querySelector<HTMLElement>('#trackball')!, {
  label: 'Sound-space trackball',
  onChange: (pose) => {
    const lead = dominantRegion(regionWeights(pose))?.name ?? 'NEUTRAL';
    console.log(lead, toParameters(pose)); // [{ id: 'surface_x', value }, ...]
  },
});

trackball.setPose({ x: 0.4, y: -0.2, z: 0.6 }); // display only: onChange is not called
trackball.dispose();
```

- The trackball fills its root element, so give the root a size.
- On a scrolling web page, pass `wheel: false`, so that the wheel scrolls the page instead of changing z.

Inside a JUCE WebView, connect the trackball to the host with `SurfaceHostSession`:

```ts
import { Trackball } from '@lowquo/surface-controls';
import { SurfaceHostSession } from '@lowquo/surface-juce';
import type { JuceEventBackend } from '@lowquo/surface-juce';

export async function connectToJuce(ball: Trackball): Promise<SurfaceHostSession | null> {
  // Check for JUCE before importing its frontend library (it installs a placeholder otherwise).
  const backend = (window as { __JUCE__?: { backend?: JuceEventBackend } }).__JUCE__?.backend;
  if (!backend) return null; // plain browser: nothing to connect to

  const { getNativeFunction } = await import('@juce-framework/webview');
  const host = new SurfaceHostSession({ lookup: getNativeFunction, backend, onError: console.warn });
  host.onHostState((pose) => ball.setPose(pose)); // host is authoritative; no echo
  return host;
}

let host: SurfaceHostSession | null = null;
const ball = new Trackball(document.querySelector<HTMLElement>('#trackball')!, {
  onGestureStart: () => host?.begin(),
  onChange: (pose) => host?.change(pose),
  onGestureEnd: () => host?.end(),
});
void connectToJuce(ball).then((session) => { host = session; });
```

- The session holds back host updates while a gesture is open or writes are still in flight, then pulls the current state.
- [`examples/playground/src/host.ts`](examples/playground/src/host.ts) does more thorough detection: it also checks which native functions are registered.
- `@juce-framework/webview` has its own licence; see [Licences](#licences-and-third-party-code).

The pose contract: x and y are in [-1, 1] and constrained to the unit disk, and z is in [0, 1].

- **y = −1 is the top**, the screen convention.
- Neutral is `{ x: 0, y: 0, z: 0.5 }`.
- The host parameters are `surface_x = (x + 1) / 2`, `surface_y = (y + 1) / 2` and `surface_z = z`.

**These are UI coordinates, not an audio-processing algorithm.** See [docs/architecture.md](docs/architecture.md).

## JUCE example

[examples/juce-plugin/README.md](examples/juce-plugin/README.md) covers build steps, the native functions, security and the verification status.

- The example needs **JUCE 9.0.4**, CMake 3.22+ and Node 22.
- On Windows it also needs the WebView2 SDK to build and the WebView2 Runtime to run.
- `npm run pack:juce` packs the playground into a deterministic ZIP, which CMake embeds in the plug-in.

| | Status |
| --- | --- |
| macOS arm64 build (AU + VST3) and `ctest` (headless suite + WKWebView smoke test) | Verified locally |
| Windows VST3 build and headless tests | Not run yet. The `JUCE example` CI job exists but hasn't run. |
| Any DAW, `auval`, `pluginval`, code signing, notarisation | Not done |

JUCE is licensed separately and **is not part of this MIT-licensed repository**. You must obtain and license JUCE yourself to build the example.

## Licences and third-party code

- `@lowquo/surface`, `@lowquo/surface-controls` and `@lowquo/surface-juce` are MIT-licensed. Each tarball includes the licence. None of them depends on any JUCE package. `@lowquo/surface-controls` has a peer dependency on `three` (MIT).
- The **playground** (private, unpublished) depends on [`@juce-framework/webview`](https://www.npmjs.com/package/@juce-framework/webview) 1.0.0, declared as `AGPL-3.0-only OR LicenseRef-JUCE`. That code is loaded with a dynamic `import()`, and only after a JUCE WebView has been detected, so the plain browser demo never loads it.
  - The playground build still **contains** it, as a separate ~9 kB chunk.
  - The `surface-ui.zip` packed from that build, and therefore the JUCE plug-in binary, contain it too.
- The **JUCE plug-in example** compiles against the JUCE framework, which is under JUCE's own licence.
- The minified build keeps no licence header comments (neither JUCE's nor three's `@license`).
- **Maintainer decision (2026-11-20):** the framework packages stay MIT and JUCE stays in the optional examples, which `check:pack` enforces. Compiled example plug-ins are **not distributed** until the licensing and redistribution requirements are verified. [docs/licensing.md](docs/licensing.md) lists the licences in each artefact and the obligations their texts state; it is not legal advice. The dependency inventory is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development and contribution

Anyone can fork the project and submit pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). Further documentation:

- [docs/architecture.md](docs/architecture.md): contract, gesture and host models, native functions
- [docs/testing.md](docs/testing.md): test layers, CI jobs, verification status and the manual DAW/host checklist
- [docs/accessibility.md](docs/accessibility.md): keyboard and screen-reader model, and the manual check procedure
- [docs/releasing.md](docs/releasing.md): release checklist and open maintainer decisions
- [docs/maintaining.md](docs/maintaining.md): commit attribution, repository settings, Dependabot
- [CHANGELOG.md](CHANGELOG.md)

Changes originating from lowquo maintainers are committed under the verified `dholdaway` GitHub identity. Community contributors keep their own authorship on their commits and PRs. The maintainer reviews merges and releases.

The code is MIT-licensed, including for commercial use, under the terms of the included licence. The **lowquo name, wordmark and product branding are not licensed with the software**; see [TRADEMARKS.md](TRADEMARKS.md).

## Support

You can help by starring the project, opening useful issues, testing it across DAWs, or contributing code. A sponsorship link can be added through `.github/FUNDING.yml` **once real sponsor account IDs are confirmed**. No placeholder or unverified payment URL has been published here.

Built by [lowquo](https://lowquo.io).
