# Contributing to lq-surface

Thanks for contributing. lq-surface is MIT-licensed and welcomes community improvements.

## Workflow

1. Search Issues and Discussions first. For a major architecture change, open a design discussion before writing code.
2. Fork `Lowquo/lq-surface` into your account and clone your fork.
3. Create a branch, such as `feat/gesture-reset` or `fix/pointer-capture`.
4. Install with `npm ci`, then run the checks in [Before opening a PR](#before-opening-a-pr).
5. Add tests and update the docs for any behaviour change. Add an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
6. Open a pull request against `Lowquo/lq-surface:main`. Describe the behaviour change, and attach screenshots or video for UI changes.
7. Respond to review feedback. Don't push generated bundles, build output, caches, binaries, secrets, private APIs or other people's copyrighted material.

## Toolchain

- **Node.js 22+ and npm 10+.** CI uses Node 22, and the lockfile was generated with Node 22.23.5 / npm 10.9.9. Another npm major may rewrite `package-lock.json`. If a PR's lockfile diff is only that churn, revert it.
- Any version manager (nvm, fnm, Volta, etc.) or the official installer will do. Check with `node --version` and `npm --version`.
- Browser tests use Playwright's Chromium. Install it once with `npx playwright install chromium`; on Linux use `npx playwright install --with-deps chromium`.
- For the JUCE example you also need JUCE **9.0.4** (obtained and licensed separately), CMake 3.22+, C and C++17 compilers, and Ninja or Visual Studio. Windows also needs the WebView2 SDK (NuGet). See [examples/juce-plugin/README.md](examples/juce-plugin/README.md).

## Installing dependencies

```sh
npm ci
```

`package-lock.json` is committed, and `npm ci` installs exactly what it records. It fails if the lockfile is missing or out of sync with a workspace `package.json`. Use `npm install <pkg>` (or `npm install` after editing a `package.json`) only to change dependencies on purpose, and commit the updated lockfile in the same PR. Explain why each new dependency is needed and state its licence (see [Licence and credit](#licence-and-credit)).

## Commands

All commands run from the repository root.

| Command | What it does |
| --- | --- |
| `npm run build:packages` | `tsc -b` on `packages/core`, `packages/controls` and `packages/juce`, in dependency order through project references. Writes JS, `.d.ts` and `dist/.tsbuildinfo` into each `packages/*/dist`. Incremental. |
| `npm run typecheck` | Runs `build:packages`, then type-checks the playground and its e2e tests (`tsc --noEmit`). **It writes package output to `packages/*/dist`.** That's intended: dependents resolve `@lowquo/surface` through `exports` to `dist/index.d.ts`, so the declarations must exist before they can be type-checked. |
| `npm run build` | Runs `build:packages`, then `vite build` for the playground (`examples/playground/dist`). Vite warns that the main chunk is over 500 kB; that is expected. |
| `npm test` | Runs `build:packages`, then the `node:test` suites of `@lowquo/surface-controls`, `@lowquo/surface` and `@lowquo/surface-juce`. The suites import from `dist/`, so run `build:packages` before calling a single workspace's tests directly (for example `npm test -w @lowquo/surface`). |
| `npm run test:e2e` | Playwright tests (Chromium) against the **built** playground, which they serve with `vite preview` on `127.0.0.1:4791`. Run `npm run build` first. Set `LQ_E2E_PORT` to use another port. It doesn't build anything itself. |
| `npm run check:pack` | Runs `build:packages`, then checks what `npm publish` would ship for each package. It installs the tarballs into a temporary consumer project, then imports them in Node and type-checks them (`bundler` and `nodenext`). `@lowquo/*` resolves only from the local tarballs. `three`, `@types/three` and `typescript` come from your configured registry or the npm cache. `npm run check:pack -- --contents-only` skips the install and needs no network. |
| `npm run dev` | Runs `build:packages`, then the Vite dev server on `127.0.0.1`. Package sources aren't watched. Run `npx tsc -b packages/core packages/controls packages/juce --watch` in a second terminal while editing `packages/*/src`. |
| `npm run pack:juce` | Runs `build`, then writes the playground build to `examples/juce-plugin/resources/surface-ui.zip` with `scripts/pack-juce.mjs` (Node only). The ZIP is deterministic: identical inputs give byte-identical archives. |
| `npm run clean` | Deletes every `dist` (and the `.tsbuildinfo` inside it, which forces a full rebuild next time), the JUCE UI archive, and Playwright output. |

## Before opening a PR

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run check:pack
npm run test:e2e        # needs the build above and Playwright's Chromium
```

- `npm run test:e2e` is required for changes to controls, input, rendering or the playground.
- `npm run check:pack` is required for changes to a package's `package.json`, `exports`, public types or published files.

If you change C++ in `examples/juce-plugin`, build the example and run `ctest` on every OS you have access to. On macOS:

```sh
npm run pack:juce
cmake -S examples/juce-plugin -B build/surface-juce -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DJUCE_SOURCE_DIR=/absolute/path/to/JUCE-9.0.4
cmake --build build/surface-juce
ctest --test-dir build/surface-juce --output-on-failure
```

- Add `-DLQ_SURFACE_WEBVIEW_SMOKE_TEST=ON` to also run the off-screen WebView smoke test (needs a GUI session).
- The Windows commands are in [examples/juce-plugin/README.md](examples/juce-plugin/README.md#2-build).
- In the PR, give the OS, compiler, JUCE version and ctest result. Don't report a macOS or Windows build as passing unless you ran it. Saying "not built on Windows" is fine.

[docs/testing.md](docs/testing.md) describes each test layer, what CI covers, and the manual DAW/host checklist.

## Standards

- Keep `@lowquo/surface` framework-neutral: no DOM, JUCE or rendering imports. No audio-thread work in JavaScript.
- Controls must work from the keyboard and be precise and predictable. No action may require a pointer gesture. See [docs/accessibility.md](docs/accessibility.md).
- Avoid continuous animation or render loops while idle.
- Host gestures must stay balanced, and host state stays authoritative: apply host updates without echoing them back. [docs/architecture.md](docs/architecture.md) describes the gesture and host models.
- Use small, explicit, typed APIs and deterministic unit tests.
- Don't add network fetches at plugin runtime.
- Don't copy code from proprietary plugins, reverse-engineered private source or third-party assets without permission.
- Don't add lowquo proprietary DSP (including lq-hit algorithms or assets) to this repository.

## AI-assisted contributions

AI-assisted work is welcome when a responsible human has reviewed it.

- Disclose substantial AI-generated code or text in the PR description (the PR template has a checkbox).
- You are responsible for the change. Confirm that you understand it, that you ran the tests yourself, and that it carries no licensing problems such as copied code of unknown origin.
- AI tools may prepare files, patches or PR drafts. They must not create commits under an identity that isn't yours or can't be verified. Commit under your own identity.

## Commit identity

- **Community contributors:** commit with your own name and an email linked to your GitHub account, so GitHub credits you. You aren't asked to use any lowquo identity, and you must not impersonate one.
- **Official lowquo maintainer commits** use the `dholdaway` GitHub account, with an author and committer email verified on that account (or its GitHub noreply address). [docs/maintaining.md](docs/maintaining.md) explains how to check this.
- Never put a personal email address in repository files. In examples, use placeholders such as `YOUR_VERIFIED_GITHUB_EMAIL` or `ID+USERNAME@users.noreply.github.com`.

## Licence and credit

By submitting a pull request, you affirm that you have the necessary rights and that your changes can be distributed under the repository's MIT licence. Contributors don't assign copyright to lowquo. Attribution stays with the original contributors, as recorded in Git history and release notes.

The three `@lowquo/*` packages are MIT and have no JUCE dependency. A PR that adds a dependency under a copyleft, dual or unusual licence to any package or example needs explicit maintainer review. Name the licence in the PR. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists the current third-party code.

## Reporting security problems

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately rather than in a public issue.
