---
title: Ops
summary: One GitHub Actions workflow gates PRs on tests and Claude Code validation, another runs skill evals on manual dispatch; releases go through the release skill.
read_when: You are changing CI, preparing a release, or need to know how and where the software runs.
covers: [.github/workflows/ci.yml, .github/workflows/evals.yml, .claude-plugin/marketplace.json, plugins/ship-faster/.claude-plugin/plugin.json, plugins/ship-faster/CHANGELOG.md]
verified: 64af76e5be3e7efb43d7205c99eb9dec5a839682
updated: 2026-09-17
---
# Ops

## Environments
| Environment | Where | How it is configured |
|---|---|---|
| user install | Claude Code, from the GitHub marketplace `carloluisito/ship-faster-plugin` | `.claude-plugin/marketplace.json`; optional `.claude/ship-faster.json` in each target repository |
| local development | Claude Code with the marketplace added by its absolute path | `README.md` |
| CI | GitHub Actions | `.github/workflows/ci.yml`, `.github/workflows/evals.yml` |

## CI
`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, with `contents: read` permission.

| Job | Runs on | Steps | Gates |
|---|---|---|---|
| `test` | ubuntu-latest and windows-latest, Node 20 and 22, `fail-fast: false` | `node plugins/ship-faster/tests/validate.mjs`, `node plugins/ship-faster/tests/run.mjs`, `node plugins/ship-faster/scripts/lint.mjs`, `node plugins/ship-faster/scripts/index.mjs --check` | plugin structure, every test, and this wiki's lint and index on both OSes |
| `official-validate` | ubuntu-latest, Node 22 | installs `@anthropic-ai/claude-code@2.1.273`, then `claude plugin validate --strict plugins/ship-faster` and `claude plugin validate --strict .` | Claude Code accepts the plugin and the marketplace |

Measured locally: validate 0.4 s, tests 33.4 s, each `claude plugin validate` about 1 s (at 57442cc).

`.github/workflows/evals.yml` runs only on `workflow_dispatch` (inputs `runs`, empty for each case's own setting, and `case`, a case-name glob), never on pull requests or a schedule: it needs an `ANTHROPIC_API_KEY` repository secret, which a subscription account does not have, so evals normally run from WSL (`docs/wiki/testing.md`). One job on ubuntu-latest, Node 22, 180-minute timeout: installs `bubblewrap` and `socat` (the sandbox backend for `Bash`) and `@anthropic-ai/claude-code@2.1.273`, runs `claude plugin validate --strict plugins/ship-faster`, then `claude plugin eval plugins/ship-faster` with `--model claude-sonnet-5 --judge-model claude-haiku-4-5 --threshold 0.8 --max-cost-usd 40`, and uploads `evals-result.json`, `evals-summary.txt`, and `plugins/ship-faster/evals/results/` as an artifact.

## Deploy
There is no deploy step. Users add the marketplace with `/plugin marketplace add carloluisito/ship-faster-plugin`, install with `/plugin install ship-faster@ship-faster`, and restart Claude Code so the hooks register.

## Release
- Version: semver, set in `plugins/ship-faster/.claude-plugin/plugin.json` and on the plugin entry in `.claude-plugin/marketplace.json`; `plugins/ship-faster/tests/validate.mjs` fails when they differ. Current: 0.1.0.
- Changelog: `plugins/ship-faster/CHANGELOG.md` in Keep a Changelog format; changes collect under `[Unreleased]`.
- Cut a release with `/ship-faster:release <patch|minor|major|x.y.z>`: `version.mjs bump` sets `plugin.json` and the marketplace entry together and names the tag `ship-faster--vX.Y.Z`; the skill tags with `claude plugin tag` when `claude --version` succeeds, else `git tag -a` (steps in `docs/wiki/recipes/bump-the-version.md`).
- No workflow is triggered by tags, so the release skill runs `gh release create` itself after the user confirms publishing.

## Secrets by name
- `ANTHROPIC_API_KEY`: read by `.github/workflows/evals.yml`. `.github/workflows/ci.yml` references no secrets.
