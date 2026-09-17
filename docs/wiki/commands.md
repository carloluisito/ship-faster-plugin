---
title: Commands
summary: Verified validation, test, and benchmark commands for the plugin, run from the repository root, with durations.
read_when: You need to run, test, build, or debug the environment, or preflight needs the check list.
covers: [.github/workflows/ci.yml, .github/workflows/evals.yml, plugins/ship-faster/tests/run.mjs, plugins/ship-faster/tests/validate.mjs, plugins/ship-faster/tests/bench.mjs, plugins/ship-faster/README.md]
verified: 1eeff4846a11978c84a07002ffa3bf99422c4437
updated: 2026-09-17
checks:
  - name: validate
    run: node plugins/ship-faster/tests/validate.mjs
    timeout: 60
  - name: test
    run: node plugins/ship-faster/tests/run.mjs
    timeout: 120
  - name: plugin-validate
    run: claude plugin validate --strict plugins/ship-faster
    timeout: 60
  - name: marketplace-validate
    run: claude plugin validate --strict .
    timeout: 60
  - name: lint-wiki
    run: node plugins/ship-faster/scripts/lint.mjs
    timeout: 60
  - name: index-check
    run: node plugins/ship-faster/scripts/index.mjs --check
    timeout: 60
---
# Commands

## Setup
| Step | Command | Notes |
|---|---|---|
| Runtime | `node --version` | Node 20 or newer and `git` on PATH; CI runs Node 20 and 22 |
| Install | none | no `package.json`; scripts use Node built-ins only |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code@2.1.273` | needed only for `claude plugin validate`; version pinned in CI; not run |
| Plugin data directory | `CLAUDE_PLUGIN_DATA` | where scripts keep state; the test runner points it at a temp directory |

No ports, no servers, no watchers.

## Everyday
| Purpose | Command | Duration | Status |
|---|---|---|---|
| All tests | `node plugins/ship-faster/tests/run.mjs` | 36.1s | pass (184 tests) |
| One test file | `node --test plugins/ship-faster/tests/glob.test.mjs` | 0.2s | pass |
| Plugin structure | `node plugins/ship-faster/tests/validate.mjs` | 0.4s | pass |
| Claude Code plugin validation | `claude plugin validate --strict plugins/ship-faster` | 1.0s | pass |
| Claude Code marketplace validation | `claude plugin validate --strict .` | 1.0s | pass |
| Hook latency benchmark | `node plugins/ship-faster/tests/bench.mjs` | 12.9s | pass |
| Skill evals (spend model credit) | `.\plugins\ship-faster\tests\evals.ps1 [case ...]` on Windows (runs `plugins/ship-faster/tests/evals.sh` inside WSL; `-Setup` once); `plugins/ship-faster/tests/evals.sh [case ...]` on Linux; a case is a name or a `*` glob, several cases run one harness run each | 20 to 35 min, 5 to 7 USD for every case | all 10 cases pass (2026-09-17; kickoff, kickoff-worktree, ship, health, and release rerun for 0.2.0 at about 6.5 USD); the same flags run in `.github/workflows/evals.yml` on dispatch |

## Checks
1. `node plugins/ship-faster/tests/validate.mjs` — manifests, hooks, skills, agents, evals, and templates are well formed, under 1s
2. `node plugins/ship-faster/tests/run.mjs` — every `*.test.mjs` passes under `node --test`, about 38s
3. `claude plugin validate --strict plugins/ship-faster` — Claude Code accepts the plugin, about 1s
4. `claude plugin validate --strict .` — Claude Code accepts the marketplace, about 1s
5. `node plugins/ship-faster/scripts/lint.mjs` — this repository's own wiki, CLAUDE.md, and rules pass lint, under 1s
6. `node plugins/ship-faster/scripts/index.mjs --check` — `docs/wiki/index.md` matches its pages, under 1s

## Known slow or flaky
- `node plugins/ship-faster/tests/run.mjs`: the slowest check; tests build real git repositories with `makeRepo` and spawn scripts with `runScript` (`plugins/ship-faster/tests/helpers.mjs`).
- `node plugins/ship-faster/tests/bench.mjs`: prints each hook's median against its budget and marks `OVER`, but exits 0 either way; Node startup dominates, so a loaded machine can read over budget.
