# Release checklist

**Nothing is published without explicit maintainer approval.** This covers npm packages, GitHub releases and plug-in binaries. No workflow publishes anything, and none may publish on untrusted (fork PR) input.

0.1.0 is a pre-release toolkit. Don't describe it, or the JUCE example, as a production-ready audio plug-in. Before the first release, work through the [open maintainer decisions](#open-maintainer-decisions) at the end of this page.

## 0. Decide

- [ ] The maintainer has decided to cut a release, and has *separately* decided whether to publish to npm.
- [ ] The version number follows [SemVer](https://semver.org/). Before 1.0, a minor bump may contain breaking changes, so call them out in the changelog. The `Unreleased` changes are breaking relative to the untagged 0.1.0 starter (see [CHANGELOG.md](../CHANGELOG.md)).
- [ ] The release commits will be made under the verified `dholdaway` identity ([maintaining.md](maintaining.md)).

## 1. Prepare the release PR

On a branch such as `release/vX.Y.Z`:

- [ ] Bump `version` in `package.json`, `packages/core/package.json`, `packages/controls/package.json`, `packages/juce/package.json` and `examples/playground/package.json`.
- [ ] Update the internal `@lowquo/*` dependency ranges. For 0.x, `^0.1.0` does **not** match `0.2.0`. `npm run check:pack` fails if the internal ranges and the workspace versions disagree.
- [ ] Update the other hard-coded version strings: the playground header (`<span class="version">`) in `examples/playground/src/main.ts`, and `project(... VERSION ...)` in `examples/juce-plugin/CMakeLists.txt`. Search with `git grep -n 'OLD_VERSION'`.
- [ ] Run `npm install` with Node 22 / npm 10 to refresh `package-lock.json`. In the lockfile diff, only the `@lowquo/*` version entries should change.
- [ ] Update [CHANGELOG.md](../CHANGELOG.md): move `[Unreleased]` under `## [X.Y.Z] - YYYY-MM-DD`, and update the compare links.
- [ ] Update [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) if dependencies changed.

## 2. Local checks from a fresh clone

With Node 22 and npm 10:

```sh
node --version && npm --version
npm ci
npm run typecheck
npm run build
npm test
npm run check:pack
npx playwright install chromium
npm run test:e2e
git status --porcelain   # must print nothing
```

- [ ] All of the above pass, and the working tree is clean afterwards.
- [ ] `npm run check:pack` reports each tarball's contents. Each package ships `package.json`, `README.md`, `LICENSE` and `dist/**/*.js` + `.d.ts`, and nothing else: no `dist/.tsbuildinfo`, `src/` or `test/`.

## 3. CI gates

All of these must be green on the release PR's head commit:

- [ ] `Typecheck, build and test (ubuntu-latest)`, `(macos-latest)`, `(windows-latest)`, from the `CI` workflow: install, typecheck, build, unit tests, `check:pack`, clean tree.
- [ ] `Playwright (Chromium) on ubuntu-latest`, `… on macos-latest`, `… on windows-latest`, from the `Browser tests` workflow.
- [ ] `macOS (AU + VST3)` and `Windows (VST3 + WebView2)`, from the `JUCE example` workflow. The macOS WebView smoke step is `continue-on-error`, so open its log and confirm that it passed. Treat a failure there as a release blocker unless it's explained.

At the time of writing, all three workflows have passed on GitHub (runs 44738961814 (`CI`), 44738961923 (`Browser tests`) and 44738961969 (`JUCE example`), commit `5b18ee8`). [maintaining.md](maintaining.md#ruleset-for-main) explains how to make these jobs required checks.

## 4. Native build and host testing

**Verified on macOS arm64** (JUCE 9.0.4, Ninja):

```sh
npm run pack:juce
cmake -S examples/juce-plugin -B <dir> -G Ninja -DCMAKE_BUILD_TYPE=Release -DJUCE_SOURCE_DIR=<JUCE 9.0.4> -DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON
cmake --build <dir>
ctest --test-dir <dir>
```

- Windows: follow [examples/juce-plugin/README.md](../examples/juce-plugin/README.md#2-build). It has run only in the `JUCE example` CI job (build + headless tests), not on a local Windows machine or in a DAW.
- Nothing is installed into plug-in folders. Bundles are in `<dir>/LqSurfaceExample_artefacts/<Config>/{VST3,AU}`.

| OS | Formats | Validation |
| --- | --- | --- |
| macOS | AU, VST3 | After copying the AU into `~/Library/Audio/Plug-Ins/Components` (with approval): `auval -v aufx Lqsf LqXX`. `pluginval` is optional and needs approval to download. |
| Windows | VST3 | Requires the WebView2 runtime. `pluginval` is optional and needs approval to download. |
| Linux | none | Not a target of the example. |

- [ ] Work through the **manual DAW/host checklist** in [testing.md](testing.md#manual-dawhost-checklist), and record each result (OS, host, version, format, result, tester) in the release PR.
- [ ] Unsigned and un-notarised example binaries are **not** attached to releases unless the maintainer decides otherwise.

## 5. Licence and runtime review

- [ ] The three published packages are MIT, include `LICENSE` (enforced by `check:pack`), and have no JUCE dependency.
- [ ] The decision on `@juce-framework/webview` in the playground build and the JUCE example has been made and recorded (see [below](#open-maintainer-decisions)).
- [ ] No runtime network fetches have been added (see [SECURITY.md](../SECURITY.md)).

## 6. Merge, tag and release

- [ ] Merge the release PR through the ruleset (required checks green).
- [ ] Tag the merge commit on `main`, as `dholdaway`:

  ```sh
  git fetch origin && git switch main && git pull --ff-only
  git tag -s vX.Y.Z -m "lq-surface vX.Y.Z"     # -s if signing is configured, otherwise -a
  git push origin vX.Y.Z
  ```

- [ ] Confirm the tag points at the intended commit, and that commit's attribution: `gh api repos/Lowquo/lq-surface/commits/vX.Y.Z --jq .author.login`.
- [ ] Create the GitHub release from the tag, and paste in that version's changelog section.

## 7. npm publication (only with explicit approval)

Skip this section unless the maintainer has approved publishing this version.

- [ ] **The `@lowquo` scope is not registered on npm.** The maintainer must first create the npm organisation `lowquo`, with 2FA enforced. Until then, anyone could claim the name. `check:pack` deliberately never resolves `@lowquo/*` from a registry.
- [ ] Prefer a manual `workflow_dispatch` publish workflow behind a protected environment, with npm provenance. None exists yet; adding one is a separate, reviewed change. Local publishing can't produce provenance.
- [ ] Publish in dependency order. First `@lowquo/surface`, then `@lowquo/surface-controls` and `@lowquo/surface-juce`. Each package already sets `publishConfig.access: public`.
- [ ] Afterwards, install the published versions into a scratch project and import each package.
- [ ] Add a fresh `## [Unreleased]` section to the changelog.

## Afterwards

- [ ] Add the Sponsor button only after verifying the sponsorship profiles.
- [ ] Review open Dependabot PRs ([maintaining.md](maintaining.md#dependabot)). They are never auto-merged, and major updates are reviewed for compatibility.

## Open maintainer decisions

These came up during the 0.1 hardening work. They are recorded neutrally, and none of them has been decided.

| # | Topic | Facts | Status |
| --- | --- | --- | --- |
| 1 | npm scope | The maintainer registers the `@lowquo` npm organisation and keeps publishing control. Nothing is published until the maintainer explicitly authorises a release. | **Decided** (2026-11-20). Until the org exists, `check:pack` keeps `@lowquo/*` from resolving to the registry. |
| 2 | Licensing | Framework packages stay MIT with no JUCE code (enforced by `check:pack`). JUCE stays in the optional examples. Compiled example plug-ins are not distributed until the licensing and redistribution requirements are verified. See [licensing.md](licensing.md). | **Decided** (2026-11-20). The pre-distribution checklist in licensing.md is open. |
| 3 | Licence notices in bundles | The minified playground build keeps neither three's `@license` header nor JUCE's header comment, and no notices file is generated. | Open: part of the pre-distribution checklist in [licensing.md](licensing.md). |
| 4 | Plug-in identity | Manufacturer `Lqoo`, plug-in `Lqsf`, bundle ID `io.lowquo.surface.example`. These were checked against every AU installed on the maintainer's Mac (280 components, no collision) and against all lowquo projects (lq-trace uses `Lwqo`/`Lqtr`; the others are apps). | **Decided and frozen** (2026-11-20). `juce.yml` fails if the built AU type/subtype/manufacturer, bundle IDs or VST3 CIDs change. |
| 5 | Vite 8 build target | Dependabot's Vite 8 PR raises the default build target to Safari 16.4. The example's macOS deployment target is 11.0, whose WKWebView is older. Set `build.target` explicitly before merging. | Open |
| 6 | Playwright version age | `@playwright/test` `^1.65.1` was about a week old at integration, which is shorter than the Dependabot cooldown policy for new releases. | Open |
| 7 | AU `network.client` | JUCE's default AU `Info.plist` declares the `network.client` resource usage, even though the example makes no network requests. | Open |
| 8 | Editor keyboard focus | The example doesn't set `EDITOR_WANTS_KEYBOARD_FOCUS` (JUCE default `FALSE`), which may stop arrow keys etc. reaching the trackball in some DAWs. This is untested. | Open |
| 9 | Initial commit attribution | `3df553c` uses an unlinkable hostname email. Leave it, or rewrite it ([maintaining.md](maintaining.md#the-existing-initial-commit)). | Open |
| 10 | First version number | Ship the integrated work as 0.1.0 (never tagged or published) or as 0.1.1. | Open |
