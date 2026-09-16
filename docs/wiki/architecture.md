---
title: Architecture
summary: Skills call deterministic Node scripts and read-only agents; hooks track which wiki pages edits touch.
read_when: You are changing how components interact, adding a component, or need the reason behind a structural decision.
covers: [plugins/ship-faster/scripts/**, plugins/ship-faster/hooks/hooks.json, plugins/ship-faster/agents/**, plugins/ship-faster/skills/**]
verified: 6a999ea3f5c0c5626dec4619b1d6676ddd8b8510
updated: 2026-09-16
---
# Architecture

## Components
| Component | Responsibility | Code |
|---|---|---|
| Skills | model-facing procedures; scripts do the deterministic parts, agents do analysis | `plugins/ship-faster/skills/` |
| Agents | `repo-analyst` (haiku) and `doc-verifier` (sonnet), tools Read, Glob, Grep only | `plugins/ship-faster/agents/` |
| Hooks | session lifecycle scripts registered in `hooks.json` | `plugins/ship-faster/scripts/hook-*.mjs` |
| CLI scripts | detect, footprints, stale, index, lint, checks, plan, page, claude-md; each runs standalone with `--json` | `plugins/ship-faster/scripts/*.mjs` |
| Shared library | argument parsing and output, config, frontmatter, git, globs, root resolution, shell tokenizing, state, wiki loading | `plugins/ship-faster/scripts/lib/` |
| Templates | skeletons for CLAUDE.md, wiki pages, recipes, rules files, plans, gotcha entries | `plugins/ship-faster/templates/` |

## Data flow
Skill run (onboard, sync-docs, lesson):
1. A preprocessing line in `SKILL.md` runs `scripts/detect.mjs --json` and injects the result as "Repository facts".
2. The skill calls scripts for facts and bookkeeping (`footprints.mjs`, `checks.mjs`, `stale.mjs`) and agents for analysis and claim verification.
3. `page.mjs verify` stamps `verified` (HEAD) and `updated`; `index.mjs` regenerates `docs/wiki/index.md`; `claude-md.mjs splice` replaces the managed block; `lint.mjs` checks budgets, links, covers, and secrets.

Session hooks:
1. SessionStart: `hook-session-start.mjs` calls `stale()` and `findPlan()` and prints at most 600 characters: wiki location, pages not fresh, active plan, overdue health audit, or an onboard suggestion.
2. PostToolUse on an edit: `hook-drift-marker.mjs` resolves the root with `resolveRootCached`, matches the file against page covers from `wiki-cache.json` (`loadWikiCache`), and records the pages in the session record (`updateSession`).
3. UserPromptSubmit: `hook-prompt-report.mjs` prints the recorded pages not yet reported and marks them reported.
4. PreToolUse on Bash: `hook-ship-guard.mjs` splits the command into segments (`lib/shell.mjs`), finds git invocations past env assignments and wrappers, checks `push`, `commit`, `merge`, and `add`, and prints a `permissionDecision`.
5. SessionEnd: `hook-session-end.mjs` deletes the session record and prunes records older than 7 days.

Freshness (`stale.mjs`), per page: missing fields or empty covers is `invalid`; no git or an unknown `verified` commit is `unverifiable`; a covered file changed by a commit after `verified` that did not also touch the page is `stale`; a covered file changed in the working tree or the session is `dirty`, unless the page itself has uncommitted edits; otherwise `fresh`.

## Boundaries
- Scripts and hooks import from `scripts/lib/`; `lib/` modules import only each other and Node built-ins.
- Every CLI script, and `hook-ship-guard.mjs`, runs its CLI only when `process.argv[1]` ends with its own path, so it can be imported (`hook-session-start.mjs` imports `stale.mjs` and `plan.mjs`; `checks.mjs` imports `detect.mjs`; `lint.mjs` imports `index.mjs`). The other four hooks call `main()` on load and are never imported.
- Every git process is spawned by `git()` in `lib/git.mjs`, with a timeout (2000 ms by default).
- Plugin state goes only under the data directory through `lib/state.mjs`; nothing is written to the target repository except the generated files.
- Agents cannot write files or run commands.

## Decisions
### Zero dependencies; hooks degrade silently <!-- id: d-20260916-zero-deps -->
Decision: Plain Node ESM with built-ins only; hooks exit 0 on every error and print nothing when they have nothing to say.
Why: Hooks must never block a session by accident, and nothing leaves the machine.
Alternatives: Not recorded.
Evidence: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md:24`, 2026-09-16.

### Guard defaults are deny, never ask <!-- id: d-20260916-guard-deny -->
Decision: Every guard rule defaults to `deny`; `ask` is allowed only as an explicit override.
Why: A hook `deny` is documented to hold under bypass-permissions mode; `ask` there is not documented.
Alternatives: `ask` defaults, rejected for the reason above.
Evidence: `plugins/ship-faster/README.md:77`, `plugins/ship-faster/scripts/lib/config.mjs:10`, 2026-09-16.

### A page committed with its change stays fresh <!-- id: d-20260916-alongside -->
Decision: Commits that touch the page itself are excluded when computing what changed since `verified`.
Why: Otherwise a page goes stale the moment the commit that updates it alongside the code lands.
Alternatives: A plain `git diff <verified> HEAD`, still used when the history exceeds 2000 commits.
Evidence: `plugins/ship-faster/CHANGELOG.md:24`, `plugins/ship-faster/scripts/stale.mjs:24`, 2026-09-16.

### Walk the history once from three verified commits <!-- id: d-20260916-batch-history -->
Decision: With three or more distinct `verified` shas, `stale.mjs` runs one `git merge-base --octopus` and one `git log` over `base..HEAD`; with fewer it diffs per sha.
Why: Thirty distinct shas cost about 60 git processes and 1785 ms in a SessionStart hook budgeted at 1500 ms; batched, 5 processes and 312 ms. At two shas, two direct calls are cheaper.
Alternatives: One diff per sha, kept for one or two shas.
Evidence: commit 43c0f50, `plugins/ship-faster/scripts/stale.mjs:35`, 2026-09-16.
