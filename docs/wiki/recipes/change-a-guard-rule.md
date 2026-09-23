---
title: Change a guard rule
summary: Add or change what the PreToolUse git guard denies, with its config key, fake-git tests, the shared risky-path rules, and the latency budget.
read_when: You need to change which git commands the ship guard blocks or how it decides.
covers: [plugins/ship-faster/scripts/hook-ship-guard.mjs, plugins/ship-faster/scripts/lib/shell.mjs, plugins/ship-faster/scripts/lib/config.mjs, plugins/ship-faster/scripts/lib/risky.mjs, plugins/ship-faster/tests/hook-ship-guard.test.mjs]
verified: 3131ff9134d61d1b6530d981ee587959fedcd813
updated: 2026-09-23
---
# Change a guard rule

## Steps
1. For a git subcommand the guard does not yet inspect, add it to `EVAL_SUBCOMMANDS` in `plugins/ship-faster/scripts/hook-ship-guard.mjs`; `needsEvaluation` returns false for anything else and the hook exits before loading config. A command other than git gets a matcher of its own that skips prefixes with `commandStart`, as `prCreateArgs` does for `gh pr create`, and a clause in `needsEvaluation`.
2. Add or change the check in `evaluate` (or in `checkPush` / `checkAdd`). Return `{ rule, reason }`; start `reason` with `ship-faster guard:`, name the alternative, and append `OVERRIDE(rule)`. A `noVerify` finding may omit `reason`; `evaluate` fills in the shared one.
3. Read git state only through `ctx.gitApi` (`currentBranch`, `defaultBranch`, `isTag`, `dirtyFiles`) and files only through `ctx.fileApi` (`hasWiki`, `read`) so tests can swap in fakes.
4. To change which paths make `git add -A` risky, edit `RISKY` or `isLarge` in `plugins/ship-faster/scripts/lib/risky.mjs`. `changes.mjs` uses the same rules for ship's exclusions and `review.mjs` for skipping untracked files, so the change reaches both.
5. For a new rule name, add it to `DEFAULTS.guard` in `plugins/ship-faster/scripts/lib/config.mjs` with `deny`, or with `warn` when the command is legitimate and Claude only needs to be told something (the reason then reaches Claude as `additionalContext`, as for `prOutsideShip`); `loadConfig` rejects `guard` keys that are not in the defaults.
6. Update the Hooks table and the Configuration block in `plugins/ship-faster/README.md`, the rules line in `plugins/ship-faster/skills/ship/SKILL.md` that names what the hook blocks, and add a `CHANGELOG.md` entry.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/hook-ship-guard.mjs` | rule logic |
| `plugins/ship-faster/scripts/lib/risky.mjs` | risky-path rules |
| `plugins/ship-faster/scripts/lib/config.mjs` | default for a new rule |
| `plugins/ship-faster/tests/hook-ship-guard.test.mjs` | cases |
| `plugins/ship-faster/tests/changes.test.mjs` | `riskyReason` cases |
| `plugins/ship-faster/tests/config.test.mjs` | config validation for a new rule |
| `plugins/ship-faster/README.md` | Hooks and Configuration |

## Test
Add one-line cases with `ev('<command>', over, config)` in `plugins/ship-faster/tests/hook-ship-guard.test.mjs` (pass a `fileApi` to `evaluate` when the rule reads files, as the `gh pr create` test does), covering both the denied form and the allowed look-alike (dry runs, tags, other branches). Run `node --test plugins/ship-faster/tests/hook-ship-guard.test.mjs` (and `changes.test.mjs` after a `risky.mjs` change), then `node plugins/ship-faster/tests/bench.mjs`; the guard budget is 150 ms.

## Docs
Update the guard step in `docs/wiki/architecture.md`; for a non-obvious case, add a gotcha as `g-20260916-push-tags` in `docs/wiki/gotchas.md` does.
