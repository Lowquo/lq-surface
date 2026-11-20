# Agent guidance for lq-surface

Scope: MIT-licensed UI framework, **not** lq-hit DSP. Never add lq-hit proprietary algorithms or assets.

## Boundaries

- `packages/core`: pure TypeScript maths and contracts; **no** DOM, JUCE or rendering imports.
- `packages/controls`: browser Three.js rendering/input, depends on core; avoid continuous animation when idle.
- `packages/juce`: native-function bridge contract; depends on core; **no direct audio-thread access**.
- `examples/playground`: UI demo and precision alternatives.
- `examples/juce-plugin`: JUCE-based passthrough host-parameter integration demo.

## Before opening a PR

Run `npm ci` after committing the generated lockfile (otherwise `npm install`), `npm run build`, `npm run typecheck`, `npm test`. For C++ edits additionally build the JUCE example on supported OSes where available. Do not claim macOS/Windows builds passed without running them.

## Commit identity

Official Lowquo-maintained commits must use the `dholdaway` identity. AI agents may prepare files, patches or PR drafts but must not make commits with an unverified bot identity. Community fork authors are not required to use that identity.

No network fetches at plugin runtime. No secrets in repository. Don't push binaries or caches.
