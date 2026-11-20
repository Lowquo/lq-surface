# lq-surface

**An open-source interface toolkit for audio software.**

[![CI](https://github.com/Lowquo/lq-surface/actions/workflows/ci.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

lq-surface makes expressive, three-dimensional controls usable in audio applications, without coupling the renderer to the DSP. It is an independent lowquo project. **This repository does not contain the lq-hit sound engine or any proprietary DSP.**

> **Status: 0.1.0 starter / proof of concept.** The browser playground and the JUCE integration *example* are provided for evaluation, not as production-validated audio-plugin releases. Package names are reserved as proposals until actually published to npm.

## What is included?

| Package | Purpose |
| --- | --- |
| `@lowquo/surface` | Typed poses, constraints, sound-space region blending and host parameter mapping. No JUCE, browser or Three.js dependency. |
| `@lowquo/surface-controls` | A tactile Three.js trackball, including pointer, keyboard and reduced-motion friendly redraw behaviour. |
| `@lowquo/surface-juce` | Small adapter that forwards host parameter gestures to injected JUCE native functions. |
| `@lowquo/surface-playground` | Browser demonstration and alternative precision controls. |
| `examples/juce-plugin` | Minimal stereo passthrough VST3/AU JUCE example with an embedded browser UI. **No lq-hit DSP.** |

## Quick start

Requires Node.js 22+ and npm 10+.

```sh
git clone https://github.com/Lowquo/lq-surface.git
cd lq-surface
npm install # also generates package-lock.json for reproducible CI
npm run build
npm test
npm run dev
```

Open the localhost URL printed by Vite. Drag the sphere, press arrow keys for fine control, hold **Alt/Option** and drag up/down to change character, use the mouse wheel, or edit the accessible sliders. Press **0** to reset.

## Using the packages

Once released to npm (not published automatically by this repository):

```sh
npm install @lowquo/surface @lowquo/surface-controls three
```

```ts
import { Trackball } from '@lowquo/surface-controls';

const trackball = new Trackball(document.querySelector('#trackball')!, {
  onChange: (pose) => console.log(pose),
});

// Later:
trackball.setPose({ x: 0.4, y: -0.2, z: 0.6 });
trackball.dispose();
```

The pose has three normalized dimensions: x/y in [-1, 1], constrained to a unit disk; z in [0, 1]. **These are UI coordinates, not any patented or proprietary effect algorithm.** See [the contract](docs/architecture.md).

## JUCE example

See [the JUCE example instructions](examples/juce-plugin/README.md). It demonstrates forwarding user gestures from an embedded WebView to three host-automatable parameters using JUCE `withNativeFunction`. It intentionally processes audio as passthrough.

JUCE is separately licensed and **is not part of this MIT-licensed repository**. You must supply and license JUCE appropriately when building the example. On Windows, WebView2 is required.

## Development and contribution

Everyone can fork this project and submit pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). The official repository's maintainer policy is that lowquo-maintained changes must be committed using the verified `dholdaway` identity. Community contributors should retain credit on their own commits and PRs; merges and releases are reviewed by the maintainer.

This is MIT-licensed code, including for commercial use, subject to the included licence. The **lowquo name, wordmark and product branding are not granted under the software licence**; see [TRADEMARKS.md](TRADEMARKS.md).

## Support

If you find the project useful, starring it, opening useful issues, testing it across DAWs, or contributing code is helpful. Sponsorship can be enabled through `.github/FUNDING.yml` **after real sponsor account IDs are confirmed**. No placeholder or unverified payment URL has been published here.

Built by [lowquo](https://lowquo.io). 

## First push to an empty public repository

See [docs/first-push.md](docs/first-push.md) for exact `dholdaway` commit-attribution and branch-protection steps.
