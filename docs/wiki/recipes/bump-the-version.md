---
title: Bump the version
summary: Set a new plugin version in both manifests and the changelog so validation passes.
read_when: You need to cut a new plugin version.
covers: [plugins/ship-faster/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugins/ship-faster/CHANGELOG.md, plugins/ship-faster/README.md]
verified: 57442cc23c96f7b6c7a961a149cf9363f2a5540b
updated: 2026-09-16
---
# Bump the version

## Steps
1. Set `version` in `plugins/ship-faster/.claude-plugin/plugin.json` to the new semver.
2. Set the same `version` on the `ship-faster` entry of `plugins` in `.claude-plugin/marketplace.json`.
3. In `plugins/ship-faster/CHANGELOG.md`, move the `[Unreleased]` entries under a heading for the new version.
4. Update the release paragraph at the top of `plugins/ship-faster/README.md`, which says what this release ships.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | plugin entry `version` |
| `plugins/ship-faster/CHANGELOG.md` | version heading |
| `plugins/ship-faster/README.md` | release paragraph |

## Test
Run `node plugins/ship-faster/tests/validate.mjs` (fails on non-semver or a version mismatch), then `claude plugin validate --strict plugins/ship-faster` and `claude plugin validate --strict .`.

## Docs
Update the current version in `docs/wiki/ops.md` (Release) and `docs/wiki/overview.md`.
