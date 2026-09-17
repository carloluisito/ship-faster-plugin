# ship-faster

A Claude Code plugin that makes an agent effective in any repository within one session and keeps it effective as the repository changes: a router `CLAUDE.md`, a verified and freshness-tracked wiki, path-scoped rules, and a shipping workflow (plan, verify, review, PR, release, maintenance) that is repo-aware at every step. Design: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md`.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

From a local checkout, add the marketplace by its absolute path instead of the GitHub slug. Restart Claude Code after installing: hooks register at session start.

## Use

| Skill | When |
|---|---|
| `/ship-faster:onboard` | once per repository: writes CLAUDE.md, `docs/wiki/`, `.claude/rules/` |
| `/ship-faster:kickoff <feature>` | before starting a feature: a grounded plan and a branch |
| `/ship-faster:preflight` | before claiming a change works: the repository's checks |
| `/ship-faster:review` | before a PR: the diff against the repository's own rules |
| `/ship-faster:ship` | when the work is ready: this session's changes only, even with other sessions in the same checkout; preflight, docs sync, review, commit, PR |
| `/ship-faster:release <bump>` | to cut a version: changelog, bump, tag, release |
| `/ship-faster:health` | every two weeks: dependencies, tests, docs, hygiene, CI, plans |
| `/ship-faster:sync-docs`, `/ship-faster:lesson` | Claude invokes these itself when docs go stale or a lesson is learned |

The plugin lives in [`plugins/ship-faster`](./plugins/ship-faster/README.md), which documents every skill, agent, hook, generated file, and what is stored where. This repository is onboarded with its own plugin: read [`CLAUDE.md`](./CLAUDE.md) and [`docs/wiki/index.md`](./docs/wiki/index.md).

## Develop

```
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
claude plugin validate --strict plugins/ship-faster
```

Evals (`claude plugin eval`) need Linux, a sandbox backend for Bash, and model credit: `plugins/ship-faster/tests/evals.sh [case ...]` runs them on Linux, `plugins\ship-faster\tests\evals.ps1 [case ...]` runs them from Windows through WSL (`-Setup` the first time; see `docs/wiki/testing.md`), and `.github/workflows/evals.yml` runs them on dispatch once the repository has an `ANTHROPIC_API_KEY` secret.

## License

MIT
