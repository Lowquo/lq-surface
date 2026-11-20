# lq-surface

**An open-source UI toolkit for audio software.**

[![CI](https://github.com/Lowquo/lq-surface/actions/workflows/ci.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/ci.yml)
[![Browser tests](https://github.com/Lowquo/lq-surface/actions/workflows/browser.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/browser.yml)
[![JUCE example](https://github.com/Lowquo/lq-surface/actions/workflows/juce.yml/badge.svg)](https://github.com/Lowquo/lq-surface/actions/workflows/juce.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

lq-surface is a collection of interface components developed while building audio plugins and instruments at lowquo.

The first component is a three-axis trackball built with TypeScript and Three.js. It provides a different way to interact with multiple parameters through a single control.

The repository also includes a small JUCE integration layer and example plugin showing how the interface can communicate with an audio host.

It's an early project, shared under the MIT licence for anyone who wants to explore it, use it or contribute.

## What's included

- [`@lowquo/surface`](packages/core/README.md): the shared maths for the control's position and its host parameters, plus the small interface a host bridge implements. Plain TypeScript, with no DOM or rendering code.
- [`@lowquo/surface-controls`](packages/controls/README.md): the trackball. You move a point around a disk and twist it for a third value. It works with the keyboard as well as the mouse, and falls back to a 2D canvas when WebGL isn't available.
- [`@lowquo/surface-juce`](packages/juce/README.md): a thin adapter that connects the controls to a JUCE `WebBrowserComponent`.

The repository also has a browser playground (`examples/playground`) and a JUCE example plugin (`examples/juce-plugin`).

The packages aren't published to npm yet, so for now use them from this repository.

## Getting started

You'll need Node.js 22 or later, with npm 10 or later.

```sh
git clone https://github.com/Lowquo/lq-surface.git
cd lq-surface
npm ci
npm run build
npm run dev
```

`npm run dev` serves the playground locally; open the URL it prints. Drag the trackball to move it, hold Shift for finer control, or use the arrow keys or the sliders. `npm test` runs the unit tests.

[CONTRIBUTING.md](CONTRIBUTING.md#commands) lists the other scripts, including the browser tests.

## JUCE integration

`@lowquo/surface-juce` sends the trackball's movements to three host-automatable parameters through JUCE's native-function bridge. It also keeps the control in sync when the host changes those parameters, for example during automation playback.

The [example plugin](examples/juce-plugin/README.md) passes audio through unchanged (VST3, plus AU on macOS) and uses the playground as its editor. Building it needs JUCE 9, which is licensed separately from this repository; see [docs/licensing.md](docs/licensing.md).

## Project status

lq-surface is experimental, and its APIs may still change. The JUCE example builds and passes automated checks on macOS and Windows, but it hasn't been tested in a DAW yet.

[docs/testing.md](docs/testing.md) lists what has been tested so far. [docs/architecture.md](docs/architecture.md) describes how the pieces fit together.

## Contributing

Issues, feedback and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to set up the project and open a pull request. For questions and ideas, use [GitHub Discussions](https://github.com/Lowquo/lq-surface/discussions).

Please follow the [code of conduct](CODE_OF_CONDUCT.md), and report security issues privately as described in [SECURITY.md](SECURITY.md).

## Licence

MIT; see [LICENSE](LICENSE). The lowquo name and logo aren't covered by the licence; see [TRADEMARKS.md](TRADEMARKS.md).

## About lowquo

lq-surface is made by [lowquo](https://lowquo.io).
