# Contributing to lq-surface

Thanks for contributing! lq-surface is MIT-licensed and welcomes community improvements.

## Workflow

1. Search Issues and Discussions first. For major architecture changes, open a design discussion.
2. Fork `Lowquo/lq-surface` into your account; clone your fork.
3. Create a branch, such as `feat/gesture-reset` or `fix/pointer-capture`.
4. Install dependencies with `npm ci` (if a lockfile is present) or `npm install`, run `npm run build`, `npm test` and `npm run typecheck`.
5. Add tests and update docs for behaviour changes.
6. Open a pull request to `Lowquo/lq-surface:main`, describe the behaviour, and attach screenshots/video for UI changes.
7. Respond to review feedback. Don't push generated bundles, secrets, private APIs or other people's copyrighted material.

## Standards

- Keep `@lowquo/surface` framework-neutral; no audio-thread work in JavaScript.
- Make controls keyboard-usable, precise and predictable; do not require a pointer gesture.
- Host automation must have balanced begin/end gestures. Native host code owns host parameter writes.
- Use small, explicit typed APIs and deterministic unit tests.
- AI-assisted work is welcome when reviewed by a responsible human; disclose substantial generated code in the PR and confirm tests and licensing.
- Don't incorporate code from proprietary plugins, reverse-engineered private source or third-party assets without proper permission.
- Please don't include lowquo proprietary DSP in this repository.

## Licence and credit

By submitting a pull request, you affirm that you have the necessary rights and that your submitted changes can be distributed under the repository's MIT licence. We do not require contributors to assign their copyright to lowquo. Attribution remains with original contributors as reflected in Git history and release notes.

## Maintainers and commits

Public forks naturally have commits authored by their contributors. The official lowquo maintainer identity for lowquo-originated commits is `dholdaway`; official branch merges/releases are controlled by project maintainers. Contributors aren't asked to impersonate this account.

## Reporting security problems

See [SECURITY.md](SECURITY.md). Please report security vulnerabilities privately rather than opening a public issue with exploit details.
