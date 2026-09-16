---
title: Ops
summary: One GitHub Actions workflow gates PRs on tests and Claude Code validation; releases are a manual version bump.
read_when: You are changing CI, preparing a release, or need to know how and where the software runs.
covers: [.github/workflows/ci.yml, .claude-plugin/marketplace.json, plugins/ship-faster/.claude-plugin/plugin.json, plugins/ship-faster/CHANGELOG.md]
verified: 6a999ea3f5c0c5626dec4619b1d6676ddd8b8510
updated: 2026-09-16
---
# Ops

## Environments
| Environment | Where | How it is configured |
|---|---|---|
| user install | Claude Code, from the GitHub marketplace `carloluisito/ship-faster-plugin` | `.claude-plugin/marketplace.json`; optional `.claude/ship-faster.json` in each target repository |
| local development | Claude Code with the marketplace added by its absolute path | `README.md` |
| CI | GitHub Actions | `.github/workflows/ci.yml` |

## CI
`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, with `contents: read` permission.

| Job | Runs on | Steps | Gates |
|---|---|---|---|
| `test` | ubuntu-latest and windows-latest, Node 20 and 22, `fail-fast: false` | `node plugins/ship-faster/tests/validate.mjs`, `node plugins/ship-faster/tests/run.mjs`, `node plugins/ship-faster/scripts/lint.mjs`, `node plugins/ship-faster/scripts/index.mjs --check` | plugin structure, every test, and this wiki's lint and index on both OSes |
| `official-validate` | ubuntu-latest, Node 22 | installs `@anthropic-ai/claude-code@2.1.273`, then `claude plugin validate --strict plugins/ship-faster` and `claude plugin validate --strict .` | Claude Code accepts the plugin and the marketplace |

Measured locally: validate 0.1 s, tests 26.4 s, each `claude plugin validate` about 1 s.

## Deploy
There is no deploy step. Users add the marketplace with `/plugin marketplace add carloluisito/ship-faster-plugin`, install with `/plugin install ship-faster@ship-faster`, and restart Claude Code so the hooks register.

## Release
- Version: semver, set in `plugins/ship-faster/.claude-plugin/plugin.json` and on the plugin entry in `.claude-plugin/marketplace.json`; `plugins/ship-faster/tests/validate.mjs` fails when they differ. Current: 0.1.0.
- Changelog: `plugins/ship-faster/CHANGELOG.md` in Keep a Changelog format; changes collect under `[Unreleased]`.
- No release workflow exists.

## Secrets by name
None. `.github/workflows/ci.yml` references no secrets.
