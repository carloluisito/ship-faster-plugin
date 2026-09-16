---
title: Change a guard rule
summary: Add or change what the PreToolUse git guard denies, with its config key, fake-git tests, and the latency budget.
read_when: You need to change which git commands the ship guard blocks or how it decides.
covers: [plugins/ship-faster/scripts/hook-ship-guard.mjs, plugins/ship-faster/scripts/lib/shell.mjs, plugins/ship-faster/scripts/lib/config.mjs, plugins/ship-faster/tests/hook-ship-guard.test.mjs]
verified: 6a999ea3f5c0c5626dec4619b1d6676ddd8b8510
updated: 2026-09-16
---
# Change a guard rule

## Steps
1. For a git subcommand the guard does not yet inspect, add it to `EVAL_SUBCOMMANDS` in `plugins/ship-faster/scripts/hook-ship-guard.mjs`; `needsEvaluation` returns false for anything else and the hook exits before loading config.
2. Add or change the check in `evaluate` (or in `checkPush` / `checkAdd`). Return `{ rule, reason }`; start `reason` with `ship-faster guard:`, name the alternative, and append `OVERRIDE(rule)`.
3. Read git state only through `ctx.gitApi` (`currentBranch`, `defaultBranch`, `isTag`, `dirtyFiles`) so tests can swap in a fake.
4. For a new rule name, add it with value `deny` to `DEFAULTS.guard` in `plugins/ship-faster/scripts/lib/config.mjs`; `loadConfig` rejects `guard` keys that are not in the defaults.
5. Update the Hooks table and the Configuration block in `plugins/ship-faster/README.md`, and add a `CHANGELOG.md` entry.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/hook-ship-guard.mjs` | rule logic |
| `plugins/ship-faster/scripts/lib/config.mjs` | default for a new rule |
| `plugins/ship-faster/tests/hook-ship-guard.test.mjs` | cases |
| `plugins/ship-faster/tests/config.test.mjs` | config validation for a new rule |
| `plugins/ship-faster/README.md` | Hooks and Configuration |

## Test
Add one-line cases with `ev('<command>', over, config)` in `plugins/ship-faster/tests/hook-ship-guard.test.mjs`, covering both the denied form and the allowed look-alike (dry runs, tags, other branches). Run `node --test plugins/ship-faster/tests/hook-ship-guard.test.mjs`, then `node plugins/ship-faster/tests/bench.mjs`; the guard budget is 150 ms.

## Docs
Update the guard step in `docs/wiki/architecture.md`; for a non-obvious case, add a gotcha as `g-20260916-push-tags` in `docs/wiki/gotchas.md` does.
