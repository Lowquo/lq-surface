# Security policy

## Supported versions

This is a pre-1.0 project. Only the most recent published release gets best-effort security fixes, and no production support commitment is made. Nothing has been published to npm yet, so in practice the current `main` branch is the only supported version.

## Responsible disclosure

**Do not post exploitable security reports in public issues.** Use GitHub's **Report a vulnerability** button (private vulnerability reporting) on the repository's Security tab, if the repository owner has enabled it. If that option isn't available, contact the maintainer privately through GitHub before sharing any details.

Include the affected commit or version, reproduction steps, the security impact and, optionally, a suggested fix. Don't include real users' data, secrets, credentials or live exploit payloads.

## Threat model

lq-surface is a UI toolkit. In a plug-in, the UI runs in a WebView beside native code that holds host state. The model below covers the packages and the JUCE example. **The JUCE example is an educational starting point, not a security-audited production plug-in.** A product built on it needs its own review.

### What we protect

- Host and project state: parameter values, automation and saved sessions.
- The host process. A plug-in fault can crash the DAW and lose the user's work.
- The user's machine. Bundled web content must not become a route to remote code or data exfiltration.
- Contributors and maintainers: CI credentials and repository write access.

### Trust boundaries

1. **WebView content → native functions.** Native code treats everything coming from the web UI as untrusted input, even though the UI is bundled.
2. **Native host state → WebView.** The UI treats host-state payloads as untrusted and validates them before use.
3. **Message thread → audio thread.** No web code runs on the real-time audio thread. Native functions run on the message thread, and the audio callback never waits on the UI.
4. **Fork pull requests → CI.** Code from forks is untrusted and must not reach secrets or write tokens.
5. **npm dependencies → build output.** Dependencies are pinned by the lockfile and reviewed when they change.

### Controls and their status

Status labels:

- **verified**: covered by a passing automated test, or by running it; the environment is stated.
- **implemented, not verified**: present in code, but with no test or host run yet.
- **pending**: implemented, but its CI run hasn't happened yet.
- **open**: not addressed.

"Locally" means macOS arm64, JUCE 9.0.4.

| Control | What it does | Status |
| --- | --- | --- |
| Bundled resources only | The page is served only from the ZIP embedded in the plug-in, through JUCE's resource provider, with no allowed external origin. Paths containing `..`, `\`, `:`, empty segments or control characters are refused, and so are entries over 16 MiB. A missing archive shows a built-in help page. | **Verified locally** by the headless native tests (archive and path rules). |
| Navigation restriction | Only the resource-provider root and `about:blank` (JUCE's unload page) may load in the WebView. `http`/`https` links open in the system browser, at most one per second. `file:`, `data:`, `javascript:` and every other scheme are blocked, and new-window requests never create a window. | **Verified locally.** The headless tests cover the policy, and the WKWebView smoke test checks that `file:` navigation is blocked. Not verified in WebView2. |
| Strict native-argument validation | Every native function checks the exact argument count, that `id` is exactly one of the three ID strings, and that `value` is a JSON number (not a string, boolean or null), finite and in [0, 1]. Anything else is rejected with `false` and no side effects. | **Verified locally** (headless tests with hostile arguments parsed as JUCE parses them, plus the smoke test). The JS side also rejects unknown IDs and non-finite values: verified by unit tests. |
| Validated host state | The UI accepts `surfaceHostState` / `surfaceGetState` payloads only as own numeric `x`, `y` and `z` fields, finite and in [0, 1]. Anything else is dropped. | **Verified** by unit tests (`packages/juce/test`). |
| Gesture teardown | Gestures are tracked per parameter. Everything the page left open is ended on navigation or reload and on editor destruction, so a reload or an editor close mid-drag never leaves automation stuck in "touch". | **Verified locally** (headless tests and the WKWebView smoke test). Not tested in a DAW. A WebView content-process crash *without* navigation leaves gestures open until reload or close (known limitation). |
| No runtime network fetches | `JUCE_USE_CURL=0`, and the bundle has no remote resources. The packages make no network requests. JUCE's default AU `Info.plist` still declares `network.client` (a maintainer decision). | Implemented. The headless tests check that `index.html` references no remote resources. A one-off Chromium check of the built playground saw no requests outside the local server. There is no automated network-blocking test of the running UI. |
| No audio-thread UI work | `processBlock` only clears surplus output channels. Native functions and the 30 Hz host-state timer run on the message thread. | Bit-exact passthrough verified locally. Thread placement is by code review. |
| Instance isolation | Each editor owns its UI archive. Instances share no state. | **Verified locally** (headless isolation tests). |
| CI secrets isolation | All workflows run on `pull_request` (not `pull_request_target`) with `permissions: contents: read`, and reference no secrets. The `JUCE example` workflow checks out with `persist-credentials: false`. | Implemented and verified on GitHub (all three workflows passed). |
| Dependency integrity | `npm ci` from the committed lockfile, `npm audit` on install (`.npmrc`), and a Dependabot cooldown before new releases. Dependabot PRs are never auto-merged. `check:pack` never resolves `@lowquo/*` from a registry. | Lockfile and `check:pack`: verified. Dependabot review is a process. |
| npm scope | The `@lowquo` scope is **not registered** on npm, so anyone could currently claim it. | **Open.** The maintainer creates the organisation with 2FA before any publish. |
| Publishing | Nothing is published from CI or on untrusted input. Publishing is manual and needs explicit maintainer approval. See [docs/releasing.md](docs/releasing.md). | Process. No publish workflow exists. |

### Out of scope

- Security of the DAW, the operating system's WebView (WKWebView, WebView2) or JUCE itself. Report those upstream.
- Code signing, notarisation and installer security. These belong to whichever product ships a binary, not to this toolkit.
- Denial of service by a user deliberately interacting with their own plug-in UI.

## Guidance for products built on lq-surface

- Keep native integration narrow. Expose only the functions the UI needs, and validate every argument on the native side. `src/SurfaceNativeBridge.*` in the example is a template.
- Ship UI assets inside the binary. Don't load a remote URL in a WebView that has native functions enabled, and send external links to the system browser.
- End open host gestures whenever the page can disappear: navigation, reload, editor destruction.
- Don't let UI code make host parameter writes from the audio thread, or block the audio thread on UI work.
- Treat host automation as authoritative. Apply host updates to the UI without echoing them back as new gestures.
