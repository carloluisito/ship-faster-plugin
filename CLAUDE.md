# ship-faster

<!-- ship-faster:managed:start -->
## What this is
ship-faster is a Claude Code plugin that generates a router CLAUDE.md, a verified wiki, and path-scoped rules for a repository, and keeps them true as the code changes.
Claude Code users run it through slash-command skills and hooks; Claude reads what it generates.
The marketplace manifest sits at the root and the plugin under `plugins/ship-faster/`: skills and read-only agents that call zero-dependency Node scripts.

## Stack
- Node.js 20+ ESM (`.mjs`), built-ins only, no `package.json`
- Claude Code plugin: skills, agents, hooks
- `git` CLI for history and page freshness
- Tests with `node:test`; CI on GitHub Actions (ubuntu and windows, Node 20 and 22)
- State as JSON under the plugin data directory (`CLAUDE_PLUGIN_DATA`)
- LF line endings enforced by `.gitattributes`

## Layout
| Directory | Responsibility | Entry point |
|---|---|---|
| `.claude-plugin/` | marketplace manifest | `.claude-plugin/marketplace.json` |
| `plugins/ship-faster/skills/` | onboard, sync-docs, lesson | `plugins/ship-faster/skills/onboard/SKILL.md` |
| `plugins/ship-faster/agents/` | repo-analyst, doc-verifier | `plugins/ship-faster/agents/repo-analyst.md` |
| `plugins/ship-faster/hooks/` | hook registration | `plugins/ship-faster/hooks/hooks.json` |
| `plugins/ship-faster/scripts/` | CLI scripts and hook scripts | `plugins/ship-faster/scripts/stale.mjs` |
| `plugins/ship-faster/scripts/lib/` | shared modules | `plugins/ship-faster/scripts/lib/cli.mjs` |
| `plugins/ship-faster/templates/` | skeletons for generated files | `plugins/ship-faster/templates/claude-md.md` |
| `plugins/ship-faster/evals/` | one eval case per skill | `plugins/ship-faster/evals/onboard/prompt.md` |
| `plugins/ship-faster/tests/` | tests, validator, benchmark | `plugins/ship-faster/tests/run.mjs` |
| `docs/superpowers/` | design spec and implementation plans | `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` |

## Commands (verified 2026-09-16 at 65c55bf)
| Purpose | Command | Duration |
|---|---|---|
| Validate plugin structure | `node plugins/ship-faster/tests/validate.mjs` | 0.1s |
| Run all tests | `node plugins/ship-faster/tests/run.mjs` | 26s |
| Run one test file | `node --test plugins/ship-faster/tests/<name>.test.mjs` | 0.2s |
| Claude Code plugin validation | `claude plugin validate --strict plugins/ship-faster` | 1s |
| Claude Code marketplace validation | `claude plugin validate --strict .` | 1s |
| Hook latency benchmark | `node plugins/ship-faster/tests/bench.mjs` | 12s |
| Skill evals (spend model credit) | see `docs/wiki/commands.md` | not run |

## Read next
| When you need to… | Open |
|---|---|
| learn what the plugin is and its vocabulary | `docs/wiki/overview.md` |
| change how skills, scripts, hooks, and agents interact | `docs/wiki/architecture.md` |
| find where a file lives or where a new one goes | `docs/wiki/layout.md` |
| run tests, validation, or the benchmark | `docs/wiki/commands.md` |
| follow the code and plugin-file conventions | `docs/wiki/conventions.md` |
| write or fix a test | `docs/wiki/testing.md` |
| explain behaviour the code does not | `docs/wiki/gotchas.md` |
| change CI or cut a release | `docs/wiki/ops.md` |
| add a script | `docs/wiki/recipes/add-a-script.md` |
| add a hook | `docs/wiki/recipes/add-a-hook.md` |
| add a skill | `docs/wiki/recipes/add-a-skill.md` |
| change what the git guard blocks | `docs/wiki/recipes/change-a-guard-rule.md` |
| change when a page counts as stale | `docs/wiki/recipes/change-page-freshness.md` |
| detect a new stack | `docs/wiki/recipes/detect-a-stack.md` |
| resolve checks from a new CI system | `docs/wiki/recipes/add-a-ci-system.md` |
| bump the plugin version | `docs/wiki/recipes/bump-the-version.md` |

`docs/wiki/index.md` lists every page.

## Keeping docs true
Pages under `docs/wiki/` carry `covers` globs and a `verified` commit; `/ship-faster:sync-docs` refreshes stale pages.
Record non-obvious causes with `/ship-faster:lesson` right after learning them.
<!-- ship-faster:managed:end -->

## Rules
- Read hook input only through `readStdinJson` in `plugins/ship-faster/scripts/lib/cli.mjs`.
- Write plugin state only through `writeJsonAtomic` in `plugins/ship-faster/scripts/lib/state.mjs`, and check its result.
- Save every `plugins/ship-faster/evals/*/scaffold.sh` as UTF-8 without a BOM.
- Exempt a `--tags` push from the protected-branch check only when it names no refspec.
- In every test file that reaches `lib/state.mjs`, set `CLAUDE_PLUGIN_DATA` to a temp directory in `beforeEach`.
- Stage files by name; never `git add -A`, `--all`, or `.`.
- End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
