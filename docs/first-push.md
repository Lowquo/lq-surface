# First push to Lowquo/lq-surface (from your own computer)

This repository is public and currently intended to be maintained by GitHub user **dholdaway**. The archive contains source files, **no** `.git` history and no credentials.

1. Unzip `lq-surface-starter.zip` and open a terminal in the `lq-surface` directory.
2. Install Node.js 22+ and npm 10+, then run `npm install`. This generates `package-lock.json`; **commit the lockfile** with the project for reproducible installs.
3. Run `npm run build`, `npm run typecheck`, and `npm test`. Build native JUCE only if JUCE, CMake and platform SDKs are installed.

For an empty GitHub repository, run:

```sh
git init
git branch -M main
git remote add origin https://github.com/Lowquo/lq-surface.git
# Use the name and an email address VERIFIED on your GitHub account:
git config user.name "dholdaway"
git config user.email "YOUR_VERIFIED_GITHUB_EMAIL"
git add .
git status
git commit -m "chore: initialise lq-surface open source toolkit"
git log -1 --format='%an <%ae> | %cn <%ce>'
git push -u origin main
```

**Verify** the commit at https://github.com/Lowquo/lq-surface/commits/main and confirm it is attributed to `dholdaway`. Don't use the assistant's or a bot's Git author email for official changes. The username alone does not guarantee GitHub attribution; the commit email must belong to the desired account.

## After the initial push

1. In repository Settings, enable Issues, Discussions, private vulnerability reporting and Dependabot alerts where available.
2. In Settings > Rules > Rulesets, protect `main`: require pull requests and successful `CI / Typecheck, build and test` checks, block force pushes/deletions, and select appropriate maintainer/bypass permissions. Ruleset features depend on GitHub plan and repository type; check enforcement.
3. In Settings > General, confirm forking is allowed; keep `main` as default.
4. In `.github/FUNDING.yml`, replace the commented examples with **real, verified sponsor account names**. GitHub Sponsors requires onboarding, and Buy Me a Coffee requires an existing page.
5. Ensure Actions workflow tokens have read-only permissions; keep secrets unavailable to untrusted fork PRs.
6. Before npm publication, verify the `@lowquo` scope availability, enable 2FA, and use a dedicated manual publishing workflow with provenance.

Note: the initial archive did not have access to npm dependency downloads. Web and native builds are **not** claimed to pass until you run them in your own environment.
