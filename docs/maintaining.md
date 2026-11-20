# Maintainer guide: commit attribution and repository settings

This guide is for lowquo maintainers of `Lowquo/lq-surface`. Community contributors don't need it. They commit under their own identity (see [CONTRIBUTING.md](../CONTRIBUTING.md#commit-identity)).

**Policy:** official lowquo commits are attributed to the GitHub account **`dholdaway`**. AI agents and bots may prepare files, patches or PR drafts. They do not create commits under an identity that can't be verified as the maintainer's.

## How GitHub attributes a commit

A Git commit records an *author* and a *committer*, each as a name plus an email address. GitHub links a commit to an account **only through the email address**. The address must be added to and verified on that GitHub account, or be the account's GitHub noreply address.

`user.name` is free text that anyone can set to anything, so `user.name "dholdaway"` alone attributes nothing. With an unlinked email, GitHub shows the name with no avatar and no profile link, and the commit isn't credited to the account.

## Set up a verified identity

1. On GitHub (as `dholdaway`): **Settings → Emails**. Either confirm that the address you want to commit with is listed and verified, or tick **Keep my email addresses private** and copy the noreply address, which has the form `ID+USERNAME@users.noreply.github.com`. Optionally enable **Block command line pushes that expose my email** too.
2. In your clone, set the identity for this repository only:

   ```sh
   git config user.name "dholdaway"
   git config user.email "YOUR_VERIFIED_GITHUB_EMAIL"   # or ID+USERNAME@users.noreply.github.com
   ```

3. Check what Git will actually use, and where each value comes from:

   ```sh
   git config --show-origin --get user.name
   git config --show-origin --get user.email
   ```

   If `user.email` isn't set anywhere, Git may build an address from your login and machine hostname, such as `<user>@<hostname>.local`. GitHub can't link that to an account.

Never write a real personal address into repository files, docs or examples. Use the placeholders above.

## Check before pushing

List the author and committer of every commit you are about to push:

```sh
git fetch origin
git log --format='%h %an <%ae> | %cn <%ce>' origin/main..HEAD
```

Every line should show the verified address (or the noreply address) on both sides of the `|`. Fix unpushed commits with your configuration corrected:

```sh
git commit --amend --no-edit --reset-author                              # latest commit only
git rebase -r origin/main --exec 'git commit --amend --no-edit --reset-author'   # every unpushed commit
```

Only rewrite commits that haven't been pushed.

## Check after pushing

For a commit SHA on GitHub:

```sh
gh api repos/Lowquo/lq-surface/commits/SHA --jq '.author.login, .committer.login'
```

- `.author.login` should print `dholdaway` for official commits. `null` means GitHub couldn't link the author email to any account.
- For commits that GitHub creates in the web UI (merge, squash or rebase-merge buttons), `.committer.login` is `web-flow`. That's expected. A squash merge keeps the PR author as the commit author, so community contributors stay credited.

You can also open `https://github.com/Lowquo/lq-surface/commit/SHA` and confirm the avatar links to the right profile.

## The existing initial commit

The repository's first commit (`3df553c`, "first commit") was authored and committed with a local machine hostname address of the `<user>@<hostname>.local` form. GitHub can't link that address to any account. Such an address can't receive the verification email either, so it can't be added to an account. The commit therefore appears on GitHub without a linked account. This guide deliberately doesn't reproduce the address.

What to do about it is a **maintainer decision**:

- **Leave history as it is.** Nothing breaks, and the commit stays unattributed. Mentioning it in the release notes is optional.
- **Rewrite history before others build on it.** For example, `git rebase -r --root --exec 'git commit --amend --no-edit --reset-author'` with a verified identity, followed by `git push --force-with-lease origin main`. This changes every commit SHA and breaks existing clones, forks and open PRs. It also means temporarily allowing force pushes in the `main` ruleset. It's only reasonable while nobody else depends on the history. Note that PR #5 and the open Dependabot PRs are already based on it.

No AI agent should do either.

## Optional: signed commits

Signing gives commits a "Verified" badge. It's separate from attribution: a signed commit with an unlinked email is still unattributed. With an SSH key:

```sh
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git config commit.gpgsign true
git config tag.gpgsign true
```

Add the same public key on GitHub as a **Signing key** (Settings → SSH and GPG keys).

## Repository settings

GitHub's UI and available features change, and some ruleset features depend on the plan and repository type. After each change, check the settings page and confirm that enforcement is **Active**.

### General

- Issues: enabled. Discussions: enabled if you want a roadmap forum.
- Forking: allowed. Default branch: `main`.
- Merge methods: your choice. A squash merge records the PR author as the commit author.

### Security

- Enable **private vulnerability reporting**. [SECURITY.md](../SECURITY.md) and the issue template config point reporters there.
- Enable Dependabot alerts. Dependabot security updates are optional.
- Enable secret scanning and push protection where available.

### Actions

- **Settings → Actions → General → Workflow permissions:** read repository contents only. Don't allow Actions to create or approve pull requests.
- **Fork pull request workflows:** require approval for first-time or outside contributors.
- Don't add `pull_request_target` workflows that check out PR code, and don't expose secrets to fork PRs. See the threat model in [SECURITY.md](../SECURITY.md).

### Ruleset for `main`

In **Settings → Rules → Rulesets**, create a branch ruleset that targets the default branch:

- **Restrict deletions** and **Block force pushes.**
- **Require a pull request before merging**, and require conversation resolution. GitHub doesn't let you approve your own PR. With a single maintainer, either set the required approvals to 0 (still PR-only), or put the maintainer on the bypass list in "pull requests only" mode. Raise the count to 1 once there is a second maintainer.
- **Require status checks to pass.** GitHub only offers checks that have reported in the last week, so let each workflow run once first. None of the workflows has a path filter, so every check reports on every PR to `main` and is safe to require.

  | Check (as shown on a PR) | Workflow | Notes |
  | --- | --- | --- |
  | `Typecheck, build and test (ubuntu-latest)` | `CI` (`ci.yml`) | Verified on GitHub. Includes `check:pack`. |
  | `Typecheck, build and test (macos-latest)` | `CI` | |
  | `Typecheck, build and test (windows-latest)` | `CI` | |
  | `Playwright (Chromium) on ubuntu-latest` | `Browser tests` (`browser.yml`) | First GitHub run passed (run 44738961923) |
  | `Playwright (Chromium) on macos-latest` | `Browser tests` | |
  | `Playwright (Chromium) on windows-latest` | `Browser tests` | |
  | `macOS (AU + VST3)` | `JUCE example` (`juce.yml`) | First GitHub run passed (run 44738961969). Up to 45 minutes. The WebView smoke step inside it is `continue-on-error`. |
  | `Windows (VST3 + WebView2)` | `JUCE example` | First GitHub run passed (build + headless tests). The WebView2 editor is not exercised on Windows. |

  Check the exact names in a PR's **Checks** tab. A renamed job or matrix entry changes its check name, and a required check that never reports blocks every merge. You may want to require the `JUCE example` jobs only after they have passed a few times.
- Keep the bypass list empty, or limited to the repository admin.

### Funding

In `.github/FUNDING.yml`, uncomment entries only for **real, verified** sponsor accounts. GitHub Sponsors requires onboarding, and Buy Me a Coffee requires an existing page.

### npm

Publishing needs explicit maintainer approval. **The `@lowquo` scope is not registered on npm.** Before any publication, create the `lowquo` npm organisation with 2FA enforced, then follow [releasing.md](releasing.md).

## Dependabot

`.github/dependabot.yml` opens PRs every Monday for npm and GitHub Actions. Its configuration:

- **npm:**
  - Routine minor and patch updates are grouped into one PR (`npm-minor-patch`).
  - `three` and `@types/three` move together in their own group. When they do, update the `three` peer range in `packages/controls/package.json` by hand.
  - Each major update gets its own PR.
- **GitHub Actions:** first-party `actions/*` updates are grouped, majors included.
- **Cooldown:** version updates skip releases younger than 7 days (majors 14, patches 3; Actions 7). Security updates aren't delayed.
- Labels are `dependencies` plus the ecosystem. Commit prefixes are `chore(deps)`, `chore(deps-dev)` and `ci(deps)`.

Policy:

- **Never auto-merge** Dependabot PRs. CI must pass, and a maintainer reviews each one.
- Review major-version updates for compatibility before merging: Node 22 support, the TypeScript project-reference build, Vite output and its browser target, and the `three` peer range. If a dependency moves to a new major, check its changelog and licence.
- A Dependabot PR that only rewrites `package-lock.json` must still pass `npm ci` and the full CI matrix.

### Open Dependabot PRs at integration (2026-11-20)

These four PRs were opened before the lockfile was committed. After the baseline lands, each needs a `@dependabot recreate` comment (written by a maintainer on the PR) before it can be evaluated.

| PR | Update | Evaluation |
| --- | --- | --- |
| #1 | `actions/setup-node` v4 → v7 | Merge after the baseline. Removes the Node 20 deprecation warnings. |
| #2 | `actions/checkout` v4 → v7 | Merge after the baseline. Same reason. |
| #3 | Vite 7 → 8 | Merge only after the maintainer decides on `build.target` (Vite 8 defaults to Safari 16.4; the example supports macOS 11+). See [releasing.md](releasing.md#open-maintainer-decisions). |
| #4 | TypeScript 5 → 7 | It was blocked only by a CSS side-effect import, which `examples/playground/src/vite-env.d.ts` now fixes. Re-evaluate after the recreate. |
