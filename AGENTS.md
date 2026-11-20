# Agent guidance for lq-surface

Scope: MIT-licensed UI framework, **not** lq-hit DSP. Never add lq-hit proprietary algorithms or assets.

## Boundaries

- `packages/core`: pure TypeScript maths and contracts; **no** DOM, JUCE or rendering imports.
- `packages/controls`: browser Three.js rendering/input, depends on core; avoid continuous animation when idle.
- `packages/juce`: native-function bridge contract; depends on core; **no direct audio-thread access**.
- `examples/playground`: UI demo and precision alternatives.
- `examples/juce-plugin`: JUCE-based passthrough host-parameter integration demo.

## Before opening a PR

Run `npm ci` (the lockfile is committed; use `npm install` only to change dependencies, and commit the updated lockfile), `npm run build`, `npm run typecheck`, `npm test` and `npm run check:pack`. For controls, input, rendering or playground changes, also run `npm run test:e2e` after `npm run build` (install Chromium once with `npx playwright install chromium`). For C++ edits, additionally build the JUCE example and run `ctest` on supported OSes where available (`npm run pack:juce`, then the CMake and `ctest` commands in `examples/juce-plugin/README.md`). Do not claim macOS/Windows builds passed without running them. See `CONTRIBUTING.md` and `docs/testing.md`.

## Commit identity

Official Lowquo-maintained commits must use the `dholdaway` identity. AI agents may prepare files, patches or PR drafts but must not make commits with an unverified bot identity. Community fork authors are not required to use that identity.

No network fetches at plugin runtime. No secrets in repository. Don't push binaries or caches.
