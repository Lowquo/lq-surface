# Release checklist

**Do not auto-publish to npm or GitHub from untrusted PR CI.**

1. Confirm package name availability and owner permission for the `@lowquo` npm scope.
2. Ensure the maintainer release uses verified `dholdaway` Git author/committer attribution.
3. `npm ci` (after generating and committing `package-lock.json`), `npm run typecheck`, `npm run build`, `npm test` on macOS, Windows and Linux.
4. In the JUCE example, run `npm run pack:juce`, then separately build and host-test macOS AU/VST3 and Windows VST3.
5. Check zero external runtime network fetches and license compliance (JUCE licence separate).
6. Produce versioned changelog, release/tag signed or verified through the maintainer's own environment.
7. Manually publish `@lowquo/surface`, `@lowquo/surface-controls`, `@lowquo/surface-juce` in dependency order only after npm provenance, ownership and 2FA are configured.
8. Add the Sponsor button only after verifying sponsorship profiles.
9. Enable `main` ruleset requiring review, CI and appropriate bypass permissions after initial commit.

`0.1.0` is a source starter and prototype; do not label it a production-ready audio plugin.
