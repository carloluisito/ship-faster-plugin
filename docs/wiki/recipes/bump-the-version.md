---
title: Bump the version
summary: Cut a new plugin version with the release skill, or by hand in both manifests and the changelog so validation passes.
read_when: You need to cut a new plugin version.
covers: [plugins/ship-faster/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugins/ship-faster/CHANGELOG.md, plugins/ship-faster/README.md, plugins/ship-faster/scripts/version.mjs, plugins/ship-faster/scripts/changelog.mjs, plugins/ship-faster/skills/release/**]
verified: dec01697c96af9f0f0c698c0501b143d7fa60ef4
updated: 2026-09-17
---
# Bump the version

## Steps
1. On a clean `main`, run `/ship-faster:release <patch|minor|major|x.y.z>`. `version.mjs detect` finds the marketplace entry and `plugins/ship-faster/.claude-plugin/plugin.json` and fails when their versions disagree; `version.mjs bump` sets both.
2. The skill writes the changelog section from the commits since the last `ship-faster--v*` tag, and `changelog.mjs insert` folds the `[Unreleased]` bullets into it. The skill passes `--file plugins/ship-faster/CHANGELOG.md`, so the plugin's changelog is the one updated; without `--file` the script edits `CHANGELOG.md` at the repository root.
3. The skill corrects any line of a page covering the manifests or the changelog that still gives the old version as current, re-stamps those pages with `page.mjs verify`, runs preflight, commits `release: v<version>` together with them, and tags `ship-faster--v<version>` with `claude plugin tag plugins/ship-faster` (or `git tag -a` when the `claude` CLI is missing); pushing and the GitHub release wait for your yes. With the guard's default `pushProtected: deny`, the release commit reaches `main` through a `release/<version>` pull request and the tag is recreated on the merged commit, because the guard refuses a direct push of `main`.
4. By hand instead: set `version` in `plugins/ship-faster/.claude-plugin/plugin.json` and the same `version` on the `ship-faster` entry of `plugins` in `.claude-plugin/marketplace.json`, and move the `[Unreleased]` entries of `plugins/ship-faster/CHANGELOG.md` under a heading for the new version. Then run `node plugins/ship-faster/scripts/page.mjs verify` on the pages in the Files table and commit them with the bump.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | plugin entry `version` |
| `plugins/ship-faster/CHANGELOG.md` | version heading |
| `docs/wiki/layout.md`, `docs/wiki/ops.md`, `docs/wiki/overview.md`, this recipe | `verified` and `updated` (they cover the files above) |

## Test
Run `node plugins/ship-faster/tests/validate.mjs` (fails on non-semver or a version mismatch), then `claude plugin validate --strict plugins/ship-faster` and `claude plugin validate --strict .`.

## Docs
No page names the current version, so a release only re-stamps the pages that cover the manifests and the changelog. Keep it that way: point at `plugins/ship-faster/.claude-plugin/plugin.json` instead of writing the number.
