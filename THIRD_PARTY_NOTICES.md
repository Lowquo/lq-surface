# Third-party notices

This file lists third-party code that the packages and examples in this repository depend on, and where that code ends up. It is a factual inventory, **not legal advice and not a licence determination**. The licence identifiers are the ones each package declares in its own `package.json`, as recorded in `package-lock.json`. Each package's own licence files are authoritative.

Last checked against `package-lock.json` and a local `npm run build` / `npm run pack:juce` on the 0.1 integration branch.

## Published packages (MIT)

`@lowquo/surface`, `@lowquo/surface-controls` and `@lowquo/surface-juce` are MIT-licensed. Each tarball contains a copy of the repository [LICENSE](LICENSE); `npm run check:pack` enforces this. Their build (`tsc`) compiles only this repository's sources and bundles no third-party code into `dist/`.

| Package | Runtime dependencies | Notes |
| --- | --- | --- |
| `@lowquo/surface` | none | |
| `@lowquo/surface-controls` | `@lowquo/surface`. Peer: `three` `^0.187.0` (MIT) | `three` is installed by the consumer, not bundled. |
| `@lowquo/surface-juce` | `@lowquo/surface` | Calls functions that the host injects. It doesn't import any JUCE package. |

**None of the three packages depends on `@juce-framework/webview` or on any other JUCE code.**

## Playground example (`examples/playground`, private, not published)

| Dependency | Version (lockfile) | Declared licence | Used for | In `vite build` output |
| --- | --- | --- | --- | --- |
| `three` | 0.187.0 | MIT | 3D rendering | Yes, in the main chunk |
| `@juce-framework/webview` | 1.0.0 (pinned) | `AGPL-3.0-only OR LicenseRef-JUCE` | `getNativeFunction`, to reach the JUCE host when running inside a JUCE WebView | Yes, as a **separate chunk** (`assets/dist-<hash>.js`, about 9 kB) |

About `@juce-framework/webview`:

- The publisher is Raw Material Software Limited (JUCE). The package ships `LICENSE.md`, `LICENSE-AGPL.md` and `LICENSE-JUCE.md`, which you can find in `node_modules/@juce-framework/webview/` after `npm ci`. Its `LICENSE.md` says the JUCE framework modules are dual-licensed under AGPLv3 and the commercial JUCE licence.
- `examples/playground/src/host.ts` first checks for a JUCE WebView (the injected `window.__JUCE__` with the required native functions). Only then does it load the package, with a dynamic `import()`. **The plain browser demo never loads or executes it**, but the build output still contains the chunk. This was confirmed in a one-off Chromium check of the built playground; no automated test asserts it.
- `npm run pack:juce` packs the whole playground build into `examples/juce-plugin/resources/surface-ui.zip`, which the JUCE example embeds in the plug-in binary. Both the ZIP and the binary therefore contain this code, and inside the plug-in it is loaded.

The minified playground build keeps **no licence header comments**: neither the JUCE file header nor three's `@license` comment. The build output contains no separate notices file. (Checked on the integration build: no `Raw Material Software`, `Three.js Authors` or `SPDX` strings in `examples/playground/dist/assets/*.js`.)

## JUCE plug-in example (`examples/juce-plugin`)

- It compiles against the **JUCE framework 9.0.4**, which isn't in this repository or in `package-lock.json`. You obtain JUCE separately, and it is under JUCE's own licence terms. The `JUCE example` CI workflow checks out JUCE 9.0.4 from its public repository at build time.
- It embeds the playground build (see above), including `@juce-framework/webview` and `three`.
- On Windows it is built with the Microsoft.Web.WebView2 NuGet SDK, whose loader is statically linked. At run time it uses the Microsoft Edge WebView2 Runtime installed on the user's system, which this repository does not redistribute.

## Development tooling (not distributed)

The following are used only to build and test, and don't end up in the published packages:

- TypeScript (Apache-2.0)
- Vite (MIT), esbuild (MIT), Rollup (MIT)
- `@playwright/test`, `playwright` and `playwright-core` (Apache-2.0)
- `@types/three` (MIT)
- their transitive dependencies, which the lockfile lists as MIT, ISC, BSD-3-Clause and Apache-2.0

Playwright downloads its own browser builds (Chromium) at `npx playwright install` time; those have their own licences. Vite adds a small runtime helper (module preload) to the playground build.

## Open questions for the maintainer

Decided on 2026-11-20: the MIT packages contain no JUCE code, JUCE stays in the examples, and compiled example plug-ins are not distributed until the requirements are verified. The per-artefact licence breakdown, the JUCE `JUCE.spdx.json` components linked into the plug-in, the WebView2 SDK licence, and the pre-distribution checklist are in [docs/licensing.md](docs/licensing.md). These remain open (also in [docs/releasing.md](docs/releasing.md#open-maintainer-decisions)); these docs make no recommendation on licensing outcomes.

1. Whether, and in what form, to distribute the built playground: for example a hosted demo, release assets, or `surface-ui.zip`. Also whether to distribute JUCE example binaries, given the `@juce-framework/webview` licence options and JUCE's own licence.
2. Whether build outputs should carry the licence notices of the bundled code, for example by keeping legal comments or generating a notices file during the build.
3. Whether the playground should keep depending on `@juce-framework/webview`.

Update this file whenever a dependency is added, removed or changes licence.
