---
title: Testing
summary: "node:test suites in plugins/ship-faster/tests with real git fixtures, a structure validator, a hook benchmark, and skill evals."
read_when: You are adding or fixing a test, need a fixture or mock, or a test cannot run locally.
covers: [plugins/ship-faster/tests/**, plugins/ship-faster/evals/**]
verified: 6a999ea3f5c0c5626dec4619b1d6676ddd8b8510
updated: 2026-09-16
---
# Testing

## Layout
| Kind | Location | Runner | Command |
|---|---|---|---|
| unit and script tests | `plugins/ship-faster/tests/*.test.mjs` | `node:test` | `node plugins/ship-faster/tests/run.mjs` |
| structure validation | `plugins/ship-faster/tests/validate.mjs`, tested by `validate.test.mjs` | plain node | `node plugins/ship-faster/tests/validate.mjs` |
| hook latency | `plugins/ship-faster/tests/bench.mjs` | plain node | `node plugins/ship-faster/tests/bench.mjs` |
| skill evals | `plugins/ship-faster/evals/<skill>/` | `claude plugin eval` | see the evals row in `docs/wiki/commands.md` |

## Adding a test
1. Create `plugins/ship-faster/tests/<module>.test.mjs`; `run.mjs` runs every `*.test.mjs` in that directory in sorted order.
2. Import `test` (and `after`, `beforeEach` as needed) from `node:test`, `assert` from `node:assert/strict`, helpers from `./helpers.mjs`, and the code under test from `../scripts/`.
3. Register `after(cleanupAll)`. When the code reaches `lib/state.mjs`, add `beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); })`, as `plugins/ship-faster/tests/hook-ship-guard.test.mjs:10` does.
4. Run the file alone: `node --test plugins/ship-faster/tests/<module>.test.mjs`.

## Fixtures and mocks
| Need | Use | Defined in |
|---|---|---|
| a git repository with files and commits | `makeRepo({ files, commits, branch })` returns `{ root, git }` | `plugins/ship-faster/tests/helpers.mjs` |
| a temp directory removed after the file | `tmpDir(prefix)` with `after(cleanupAll)` | `plugins/ship-faster/tests/helpers.mjs` |
| a script or hook run as a subprocess | `runScript(name, args, { cwd, stdin, env })` returns `{ code, stdout, stderr, json }` | `plugins/ship-faster/tests/helpers.mjs` |
| git answers for the guard without a repository | `fakeGit(over)` passed as `gitApi` to `evaluate` | `plugins/ship-faster/tests/hook-ship-guard.test.mjs` |
| a wiki page | `serializeFrontmatter({ title, summary, read_when, covers, verified, updated })` | `plugins/ship-faster/scripts/lib/fm.mjs` |
| isolated plugin state | `CLAUDE_PLUGIN_DATA` pointed at a temp directory | `plugins/ship-faster/tests/run.mjs` |

`makeRepo` sets a local user, disables commit signing, and runs git with `GIT_TERMINAL_PROMPT=0` and `GIT_CONFIG_NOSYSTEM=1`. No test needs credentials or a service beyond `git`. There is no coverage configuration.

## Not runnable locally
- Skill evals: they spend real model credit and need a sandbox backend for `Bash`, so the plugin README says they run in CI on Linux, never as a PR gate (`plugins/ship-faster/README.md:113`). `.github/workflows/ci.yml` has no eval job yet.
- The CI matrix (ubuntu-latest and windows-latest, Node 20 and 22) runs only in GitHub Actions; locally you test one OS and one Node version.
