## Summary

What does this change, and why? Link the related issue.

## Testing

Tick what you ran. For anything that doesn't apply, leave the box unticked and add "n/a" with a reason.

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run check:pack` (required for changes to a package's `package.json`, `exports`, public types or published files)
- [ ] `npm run test:e2e` after `npm run build` (required for controls, input, rendering or playground changes; install Chromium once with `npx playwright install chromium`)
- [ ] Keyboard and pointer behaviour checked by hand (controls changes)
- [ ] JUCE example: `npm run pack:juce`, CMake build and `ctest` (C++ or native-contract changes). Give OS, compiler, JUCE version, ctest result, and any host + version + format tested:

Only tick a native or host check you actually ran. "Not built on Windows" or "no DAW tested" is a fine answer.

## Docs

- [ ] Docs updated for behaviour changes (README, `docs/`, package README)
- [ ] `CHANGELOG.md` `[Unreleased]` updated for user-visible changes

## Contribution checks

- [ ] I own or have permission to submit these changes under the MIT licence.
- [ ] No proprietary DSP (including lq-hit), secrets, private assets, binaries or generated bundles.
- [ ] New or changed dependencies are listed below with their licences, or there are none.
- [ ] Commits are authored under my own identity.
- AI assistance (pick one):
  - [ ] None
  - [ ] Used. I describe below what was generated, and I have reviewed and tested it and checked its licensing.

Dependencies and licences (if any):

AI assistance details (if any):

Screenshots or recordings for UI changes:
