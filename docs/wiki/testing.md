---
title: Testing
summary: "node:test suites in plugins/ship-faster/tests with real git fixtures, a structure validator, a hook benchmark, and skill evals run from WSL or on CI dispatch."
read_when: You are adding or fixing a test, need a fixture or mock, or a test cannot run locally.
covers: [plugins/ship-faster/tests/**, plugins/ship-faster/evals/**, .github/workflows/evals.yml]
verified: 607fa5cbb1e1036f982decf34cab105446830786
updated: 2026-09-23
---
# Testing

## Layout
| Kind | Location | Runner | Command |
|---|---|---|---|
| unit and script tests | `plugins/ship-faster/tests/*.test.mjs` | `node:test` | `node plugins/ship-faster/tests/run.mjs` |
| structure validation | `plugins/ship-faster/tests/validate.mjs`, tested by `validate.test.mjs` | plain node | `node plugins/ship-faster/tests/validate.mjs` |
| hook latency | `plugins/ship-faster/tests/bench.mjs` | plain node | `node plugins/ship-faster/tests/bench.mjs` |
| skill evals | `plugins/ship-faster/evals/<skill>/`, one case per skill | `claude plugin eval` | see the evals row in `docs/wiki/commands.md` |

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
| a wiki and PR body files for the guard without a repository | `{ hasWiki, read }` passed as `fileApi` to `evaluate` | `plugins/ship-faster/tests/hook-ship-guard.test.mjs` |
| a wiki page | `serializeFrontmatter({ title, summary, read_when, covers, verified, updated })` | `plugins/ship-faster/scripts/lib/fm.mjs` |
| isolated plugin state | `CLAUDE_PLUGIN_DATA` pointed at a temp directory | `plugins/ship-faster/tests/run.mjs` |
| a commit dated in the past (old TODOs, stale recipes) | `commitAt(root, date, message)` sets `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` | `plugins/ship-faster/tests/health.test.mjs` |
| a recorded preflight run | `writeJsonAtomic(join(preflightDir(root), 'last.json'), ...)` | `plugins/ship-faster/scripts/lib/state.mjs` |

`makeRepo` sets a local user, disables commit signing, and runs git with `GIT_TERMINAL_PROMPT=0` and `GIT_CONFIG_NOSYSTEM=1`. A test that commits into a checkout the plugin created (a worktree from `worktree.mjs add`) leaves `GIT_CONFIG_NOSYSTEM` out, so it reads the same configuration those git calls do (`docs/wiki/gotchas.md` g-20260917-system-git-config). No test needs credentials or a service beyond `git`. There is no coverage configuration.

## Eval cases
Each `plugins/ship-faster/evals/<skill>/` holds `prompt.md` (frontmatter such as `description`, `tags`, `max_turns`, `timeout_seconds`, `allowed_tools`; the body is the slash command for a slash-only skill, a plain request for a model-invocable one, as in `plugins/ship-faster/evals/preflight/prompt.md`), `case.yaml` (`schema_version: "1.1"`, `name`, `context.scaffold_script: scaffold.sh`), a `scaffold.sh` that builds the fixture repository, and `graders/*.md`. A grader that must never fire uses `type: tool_used` with `input_match`, `min: 0`, `max: 0`, as `plugins/ship-faster/evals/ship/graders/never-pushed.md` does for `git push` (including `git -C <path> push`) and `gh pr create`; git patterns allow the `-C <path>` form because agents often address the workspace that way. A skill may have more than one case (`evals/kickoff-worktree/` covers `kickoff --worktree`, `evals/ship-shared/` covers `ship` in a checkout another session is changing); the validator only requires that every skill has at least the case named after it. `evals/routing/` belongs to no single skill: its scaffold writes an onboarded CLAUDE.md and same-purpose `preflight`, `requesting-code-review`, and `verification-before-completion` skills under `.claude/skills/`, and its graders require `ship-faster:preflight` and `ship-faster:review` and forbid the others; `plugins/ship-faster/tests/templates.test.mjs` fails when that CLAUDE.md drifts from the template's Workflow section. A case that needs another session's state writes it from the scaffold into `.git/ship-faster/sessions/` and `.git/ship-faster/edits/`, which sandboxed commands can read while the plugin data directory is hidden from them, and backdates its commits so seeded edit claims count as newer, as `plugins/ship-faster/evals/ship-shared/scaffold.sh` does.

## Not runnable locally
- Skill evals: they spend real model credit and need a sandbox backend for `Bash`, so they run from WSL or through `.github/workflows/evals.yml` (manual dispatch, needs an `ANTHROPIC_API_KEY` secret), never as a PR gate (`plugins/ship-faster/README.md:156`). On Windows the harness refuses them (no sandbox); `plugins/ship-faster/tests/evals.ps1 [case ...]` runs them from WSL Ubuntu as a dedicated user whose `~/.docker` holds no symlinks (`-Setup` once installs `bubblewrap`, `socat`, the pinned `claude` CLI, and that user; every run copies your Claude login into the user's own config directory), and `plugins/ship-faster/tests/evals.sh [case ...]` is the Linux entry point with the CI flags; both end with the per-case table from `tests/eval-report.mjs`. The harness takes one `--case` glob per run and understands `*` and `?` but not `{a,b}` or commas, so the runner splits a list into one run per name and fails when a pattern matches no case. The eval workspace doubles as the sandbox home, so fixtures ignore the harness dotfiles and the model's writes to `.git/` and the plugin data directory are denied (`docs/wiki/gotchas.md` g-20260917-eval-home, g-20260917-denied-writes).
- The CI matrix (ubuntu-latest and windows-latest, Node 20 and 22) runs only in GitHub Actions; locally you test one OS and one Node version.
