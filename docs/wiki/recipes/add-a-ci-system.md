---
title: Add a CI system
summary: Detect a new CI file and extract its steps as checks, with install and deploy steps excluded.
read_when: You need checks.mjs to resolve checks from a CI system or step format it does not read yet.
covers: [plugins/ship-faster/scripts/checks.mjs, plugins/ship-faster/scripts/detect.mjs, plugins/ship-faster/tests/checks.test.mjs]
verified: 6a999ea3f5c0c5626dec4619b1d6676ddd8b8510
updated: 2026-09-16
---
# Add a CI system

## Steps
1. Add `[/<path regex>/, '<kind>']` to `CI_FILES` in `plugins/ship-faster/scripts/detect.mjs`.
2. Check whether `extractCi` in `plugins/ship-faster/scripts/checks.mjs` already reads the format: it takes values of `run:`, `script:`, `bash:`, and `pwsh:` keys, block scalars and sequences under them, and `command:` items, and joins lines ending in `\`, `&&`, or `|`. Add a branch for any other step syntax.
3. Extend `INSTALL` or `UNSAFE` in `checks.mjs` for the system's install and deploy commands; `classify` excludes those, CI expressions containing `${{`, and echo-only steps.
4. Keep resolution order intact in `resolveChecks`: wiki `checks`, then CI, then detected suggestions.
5. Add a `CHANGELOG.md` entry.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/detect.mjs` | `CI_FILES` entry |
| `plugins/ship-faster/scripts/checks.mjs` | extraction and exclusion |
| `plugins/ship-faster/tests/checks.test.mjs` | fixture cases |
| `plugins/ship-faster/tests/detect.test.mjs` | CI file detection |

## Test
In `plugins/ship-faster/tests/checks.test.mjs`, build a repository with the CI file via `makeRepo` and assert on `resolveChecks(root, { config: DEFAULTS })` checks and excluded entries, including a multi-line step and an install step. Run `node --test plugins/ship-faster/tests/checks.test.mjs`.

## Docs
None in this wiki unless resolution order changes; then update step 2 of Skill run in `docs/wiki/architecture.md`.
