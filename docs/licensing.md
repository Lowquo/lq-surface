# Licensing

This page records what each lq-surface artefact contains, the licences involved, and the obligations those
licence texts state. It is a project record, **not legal advice**. JUCE's own licence file says the JUCE team
cannot confirm compliance and that you must obtain your own legal advice; the same applies here.

## Maintainer decisions (2026-11-20)

1. The framework packages (`@lowquo/surface`, `@lowquo/surface-controls`, `@lowquo/surface-juce`) stay
   **MIT-licensed** and contain **no JUCE code**. `@lowquo/surface-juce` only defines a contract for functions
   that the host page injects; it does not import any JUCE library.
2. JUCE is used **only** in the optional examples: the JUCE framework in `examples/juce-plugin`, and the
   JUCE frontend library `@juce-framework/webview` in `examples/playground`.
3. **Compiled example plug-ins are not distributed** until the licensing and redistribution requirements
   below have been verified. CI builds and validates them on disposable runners only.
4. No npm package is published until the maintainer explicitly authorises a release. The maintainer
   registers and controls the `@lowquo` npm organisation.

### How this is enforced

| Rule | Mechanism |
| --- | --- |
| MIT packages contain no JUCE code | `npm run check:pack` (in CI on all three OSes) fails if a published package depends on a JUCE package (`@juce-framework/*`, `juce*`), or ships a file containing JUCE's source header ("This file is part of the JUCE framework" / "Raw Material Software Limited"). Every import in shipped files must also be a declared dependency. |
| MIT notice ships with each package | Each package directory has a `LICENSE` copy, and `check:pack` checks it matches the repository `LICENSE` and is in the tarball. |
| No binary distribution | No workflow uploads plug-in binaries or the UI ZIP as artefacts, and none creates releases. The only artefact upload (`browser.yml`) is the Playwright report on failure. Build outputs and `examples/juce-plugin/resources/surface-ui.zip` are git-ignored. |
| No publishing | There is no publish workflow. See [releasing.md](releasing.md). |

## What each artefact contains

| Artefact | Contents | Licences |
| --- | --- | --- |
| npm tarballs `@lowquo/surface`, `-controls`, `-juce` | lq-surface code only (`dist/`, `README.md`, `LICENSE`). `-controls` has the peer dependency `three`. | MIT. `three` is MIT and installed by the consumer. |
| Playground build `examples/playground/dist` | The three packages above, `three`, and `@juce-framework/webview` 1.0.0 as a separate, lazily loaded chunk (`assets/dist-*.js`, ~9 kB) that the plain browser page never loads. | MIT (lq-surface, three) and **AGPL-3.0-only OR LicenseRef-JUCE** (`@juce-framework/webview`). The minified build keeps no licence comments. |
| `examples/juce-plugin/resources/surface-ui.zip` | The playground build above, embedded into the plug-in. | As the playground build. |
| Example plug-in binaries (macOS AU + VST3, Windows VST3) | The example's own C++ sources (MIT), JUCE 9.0.4 modules, the third-party code those modules vendor (next table), `surface-ui.zip`, and on Windows the statically linked WebView2 loader. | MIT, **AGPLv3 OR the JUCE 9 licence**, plus the third-party licences below. |

### JUCE 9.0.4

From `LICENSE.md` in the JUCE 9.0.4 source tree:

- The JUCE Framework modules are **dual-licensed under the AGPLv3 and the commercial JUCE licence**
  ([JUCE 9 End User Licence Agreement](https://juce.com/legal/juce-9-licence/)).
- If you do not license JUCE under the AGPLv3, then by downloading, installing or using it, or combining it
  with other work, you agree to the JUCE 9 EULA and its incorporated terms.
- The JUCE examples are ISC-licensed.
- Vendored third-party code is inventoried in `JUCE.spdx.json` (an SPDX 2.3 software bill of materials).

### Third-party code in the example plug-in

The example plug-in compiles these JUCE modules: `juce_audio_basics`, `juce_audio_processors`,
`juce_audio_processors_headless`, `juce_core`, `juce_data_structures`, `juce_events`, `juce_graphics`,
`juce_gui_basics` and `juce_gui_extra`, plus JUCE's plug-in wrappers. The list below is taken from
`JUCE.spdx.json` (packages vendored in those modules). The "in binary" column comes from a `strings` probe of
the macOS Release binaries. That is a heuristic: it can confirm that a library is present, but not prove that
one is absent.

| Component | Version | Licence (SPDX) | In binary (macOS probe) |
| --- | --- | --- | --- |
| zlib | 1.3.2 | Zlib | yes |
| libpng | 1.6.58 | libpng-2.0 | yes |
| jpeglib (IJG) | 10.0 | IJG | yes |
| libwebp | 1.6.0 | BSD-3-Clause | yes |
| HarfBuzz | 14.2.1 | MIT-Modern-Variant | yes |
| LunaSVG / PlutoVG | 3.5.0 / 1.3.2 | MIT | yes |
| SheenBidi | 2.9.0 | Apache-2.0 | not detectable by `strings`; treat as present |
| VST3 SDK (Steinberg) | 3.8.0 | MIT | VST3 wrapper; treat as present in the VST3 |
| AudioUnitSDK (Apple) | 1.1.0 | Apache-2.0 | yes, AU only |
| LV2, lilv, serd, sord, sratom | various | ISC | no (LV2 hosting is off) |
| pslextensions | n/a | Public domain | not checked |
| `@juce-framework/webview` | 1.0.0 | AGPL-3.0-only OR LicenseRef-JUCE-Commercial | yes, inside `surface-ui.zip` |
| Microsoft WebView2 SDK loader (`WebView2LoaderStatic.lib`) | 1.0.3485.44 | Microsoft licence, BSD-3-Clause style (`LICENSE.txt` in the NuGet package), plus the package's `NOTICE.txt` | Windows only, statically linked |

The audio-format codecs (FLAC, Ogg/Vorbis, Opus), ASIO SDK, AAX SDK, Oboe and QuickJS are in JUCE modules
the example does **not** compile.

## Obligations stated by the licence texts

These apply if compiled example plug-ins (or the UI ZIP) are ever distributed. They are summaries of the
licence texts, to be confirmed with legal advice before any distribution.

- **JUCE route (choose one):**
  - **AGPLv3:** the distributed plug-in, as a work based on JUCE, is conveyed under AGPLv3 terms. Recipients
    must be offered the Corresponding Source of the whole work under AGPLv3, and §13 extends that to users
    who interact with a modified version over a network. lq-surface's MIT code may be included in such a work.
  - **JUCE 9 commercial licence:** hold the appropriate JUCE licence and follow the
    [JUCE 9 EULA](https://juce.com/legal/juce-9-licence/). This page does not summarise the EULA's tiers or
    conditions; read the EULA itself.
  - `@juce-framework/webview` (in `surface-ui.zip`) is under the same "AGPL-3.0-only OR JUCE licence" choice.
- **BSD-3-Clause** (libwebp, WebView2 SDK): binary redistributions must reproduce the copyright notice,
  conditions and disclaimer in the documentation or other materials. The WebView2 SDK's `NOTICE.txt` lists
  further third-party notices.
- **MIT / MIT-Modern-Variant / ISC** (HarfBuzz, LunaSVG, PlutoVG, VST3 SDK, three, lq-surface): include the
  copyright and permission notices with copies.
- **Apache-2.0** (SheenBidi, AudioUnitSDK): give recipients a copy of the licence, and keep the attribution
  notices of any `NOTICE` file.
- **IJG** (jpeglib): if only executable code is distributed, the accompanying documentation must state that
  the software is based in part on the work of the Independent JPEG Group.
- **Zlib, libpng-2.0:** the origin must not be misrepresented, altered versions must be marked as such, and
  the notice must stay in source distributions.
- **Trademarks:** the VST name and logo follow Steinberg's usage guidelines (`VST3_Usage_Guidelines.pdf` in the
  VST3 SDK). Apple's AU and Microsoft's names are their trademarks. The lowquo name and branding are not
  licensed by MIT; see [TRADEMARKS.md](../TRADEMARKS.md).

## Before any binary distribution (open, maintainer)

- [ ] Choose the JUCE route (AGPLv3 or an appropriate JUCE 9 licence), with legal advice.
- [ ] Generate a notices file for the linked components (from `JUCE.spdx.json` plus the WebView2 SDK
      `LICENSE.txt`/`NOTICE.txt` and `three`), and ship it with the binaries and the UI ZIP.
- [ ] Re-run the binary probe on the Windows build (only macOS was probed).
- [ ] Code-sign and notarise (macOS) and sign (Windows) the binaries.
- [ ] Record the decision in this file and in [CHANGELOG.md](../CHANGELOG.md).

Developer tools used only to build or test (TypeScript, Vite, Playwright, pluginval, CMake) are not
distributed with any artefact. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the npm dependency
inventory.
