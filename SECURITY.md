# Security policy

## Supported versions

This is a pre-1.0 project. Only the most recent published release receives best-effort security fixes. No production support commitment is made.

## Responsible disclosure

**Do not post exploitable security reports in public issues.** Use GitHub's **Report a vulnerability** / private vulnerability reporting feature on the Security tab, if the repository owner has enabled it. If that option is unavailable, contact the maintainer privately before sharing details.

Include affected commit/version, reproduction, security impact and an optional suggested fix. Do not include real users' data, secrets, credentials or live exploit payloads.

## Security model

The web UI is untrusted relative to the DSP/audio thread. Native functions must be narrowly scoped and validate IDs and values. The WebView must load only bundled, trusted resources in production (never third-party content with native integration enabled). CI running on public pull requests should not have write tokens or secret access.

The JUCE example is an educational starting point, not a security-audited production plugin.
