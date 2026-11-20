# Project governance

lq-surface is maintained by lowquo and open to community contributions. Contributions arrive as pull requests and go through tests and maintainer review. Anyone can fork the MIT-licensed project, and no copyright assignment is required.

## Decisions and review

- The `main` branch of the official repository is meant to be protected by a ruleset that requires pull requests and passing CI. [docs/maintaining.md](docs/maintaining.md) describes the settings.
- Issues and Discussions are the preferred places for roadmap and design proposals.
- Maintainers keep control of release tagging and signing, npm publishing and organisation settings. **Nothing is published to npm, and no release is cut, without explicit maintainer approval** ([docs/releasing.md](docs/releasing.md)).
- Dependabot PRs are reviewed by a human and never auto-merged. Major updates are reviewed for compatibility.
- Licensing questions, such as how example builds that contain third-party code are distributed, are maintainer decisions ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Commit identity

- The current lowquo maintainer commit identity is the GitHub account `dholdaway`, with a verified email address.
- Community contributors keep their own authorship on their forks and pull requests.
- No bot or AI assistant makes official commits under an author or committer identity that can't be confirmed. Agents may prepare changes, and a maintainer reviews and commits them.

## Status

The project is experimental (0.1.0) and has no guaranteed release cadence.
