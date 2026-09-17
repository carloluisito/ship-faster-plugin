---
title: Bump the version
summary: Cut a new plugin version with the release skill, or by hand in both manifests and the changelog so validation passes.
read_when: You need to cut a new plugin version.
covers: [plugins/ship-faster/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugins/ship-faster/CHANGELOG.md, plugins/ship-faster/README.md, plugins/ship-faster/scripts/version.mjs, plugins/ship-faster/scripts/changelog.mjs, plugins/ship-faster/skills/release/**]
verified: adeca3dfc89dea0358d116f816e219f25698e3a4
updated: 2026-09-17
---
# Bump the version

## Steps
1. On a clean `main`, run `/ship-faster:release <patch|minor|major|x.y.z>`. `version.mjs detect` finds the marketplace entry and `plugins/ship-faster/.claude-plugin/plugin.json` and fails when their versions disagree; `version.mjs bump` sets both.
2. The skill writes the changelog section from the commits since the last `ship-faster--v*` tag, and `changelog.mjs insert` folds the `[Unreleased]` bullets into it. The skill passes `--file plugins/ship-faster/CHANGELOG.md`, so the plugin's changelog is the one updated; without `--file` the script edits `CHANGELOG.md` at the repository root.
3. The skill runs preflight, commits `release: v<version>`, and tags `ship-faster--v<version>` with `claude plugin tag plugins/ship-faster` (or `git tag -a` when the `claude` CLI is missing); pushing and the GitHub release wait for your yes.
4. By hand instead: set `version` in `plugins/ship-faster/.claude-plugin/plugin.json` and the same `version` on the `ship-faster` entry of `plugins` in `.claude-plugin/marketplace.json`, and move the `[Unreleased]` entries of `plugins/ship-faster/CHANGELOG.md` under a heading for the new version.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | plugin entry `version` |
| `plugins/ship-faster/CHANGELOG.md` | version heading |

## Test
Run `node plugins/ship-faster/tests/validate.mjs` (fails on non-semver or a version mismatch), then `claude plugin validate --strict plugins/ship-faster` and `claude plugin validate --strict .`.

## Docs
Update the current version in `docs/wiki/ops.md` (Release) and `docs/wiki/overview.md`.
