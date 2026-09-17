---
title: Architecture
summary: Skills call deterministic Node scripts and agents; hooks track which wiki pages edits touch and guard risky git commands.
read_when: You are changing how components interact, adding a component, or need the reason behind a structural decision.
covers: [plugins/ship-faster/scripts/**, plugins/ship-faster/hooks/hooks.json, plugins/ship-faster/agents/**, plugins/ship-faster/skills/**]
verified: a07432d57e5f412d4c900ee2d4e537917c4d70c1
updated: 2026-09-17
---
# Architecture

## Components
| Component | Responsibility | Code |
|---|---|---|
| Skills | model-facing procedures; scripts do the deterministic parts, agents do analysis; knowledge (onboard, sync-docs, lesson) and shipping (kickoff, preflight, review, ship, release, health) | `plugins/ship-faster/skills/` |
| Agents | `repo-analyst` (haiku), `doc-verifier` (sonnet), `rules-reviewer` (opus) with Read, Glob, Grep; `check-runner` (sonnet) with Bash, Read; `health-auditor` (sonnet) with Read, Glob, Grep, Bash | `plugins/ship-faster/agents/` |
| Hooks | session lifecycle scripts registered in `hooks.json` | `plugins/ship-faster/scripts/hook-*.mjs` |
| CLI scripts | detect, footprints, stale, index, lint, checks, plan, page, claude-md, changes, version, changelog, review, health; each runs standalone with `--json` | `plugins/ship-faster/scripts/*.mjs` |
| Shared library | argument parsing and output, config, file listing, frontmatter, git, globs, risky-path rules, root resolution, shell tokenizing, state, wiki loading | `plugins/ship-faster/scripts/lib/` |
| Templates | skeletons for CLAUDE.md, wiki pages, recipes, rules files, plans, gotcha entries, PR bodies | `plugins/ship-faster/templates/` |

## Data flow
Knowledge skills (onboard, sync-docs, lesson):
1. A preprocessing line in `SKILL.md` runs `scripts/detect.mjs --json` and injects the result as "Repository facts".
2. The skill calls scripts for facts and bookkeeping (`footprints.mjs`, `checks.mjs`, `stale.mjs`) and agents for analysis and claim verification.
3. `page.mjs verify` stamps `verified` (HEAD) and `updated`; `index.mjs` regenerates `docs/wiki/index.md`; `claude-md.mjs splice` replaces the managed block; `lint.mjs` checks budgets, links, covers, and secrets.

Shipping skills:
1. `preflight` runs in a forked `check-runner` agent (`context: fork`): `checks.mjs resolve`, then `checks.mjs run`, which writes one log per check and `preflight/last.json` in the data directory; the caller receives only the report.
2. `review` runs `review.mjs prepare`, which writes the diff against the merge base in chunks of up to 4000 lines, copies of untracked files, and a manifest under `review/<timestamp>/` in the data directory and names the rule pages and matching recipes; one `rules-reviewer` per chunk reads them from those paths.
3. `ship` injects `changes.mjs` (branch, base, ahead/behind, uncommitted files with risk flags, commit style), then invokes preflight, `sync-docs --scope diff`, and review as skills, marks the plan `shipped` with `plan.mjs set-status`, commits by name, and pushes and opens the PR only after the user says yes.
4. `release` uses `version.mjs detect` and `bump`, `changelog.mjs since` and `insert`, `stale.mjs` with `sync-docs --scope all`, and preflight, then commits `release: vX.Y.Z` and tags; publishing waits for a yes.
5. `health` injects `health.mjs scan`, fans out one `health-auditor` per area, and ends with `health.mjs record`, which writes `health.json`; `kickoff` reads the wiki, writes a plan from `templates/plan.md`, and creates the branch.

Session hooks:
1. SessionStart: `hook-session-start.mjs` calls `stale()` and `findPlan()` and prints at most 600 characters: wiki location, pages not fresh, active plan, overdue health audit, or an onboard suggestion.
2. PostToolUse on an edit: `hook-drift-marker.mjs` resolves the root with `resolveRootCached`, matches the file against page covers from `wiki-cache.json` (`loadWikiCache`), and records the pages in the session record (`updateSession`).
3. UserPromptSubmit: `hook-prompt-report.mjs` prints the recorded pages not yet reported and marks them reported.
4. PreToolUse on Bash: `hook-ship-guard.mjs` splits the command into segments (`lib/shell.mjs`), finds git invocations past env assignments and wrappers, checks `push` (force, protected branch, `--no-verify`), `commit` and `merge` (`--no-verify`), and `add` (risky paths from `lib/risky.mjs`), and prints a `permissionDecision`.
5. SessionEnd: `hook-session-end.mjs` deletes the session record and prunes records older than 7 days.

Freshness (`stale.mjs`), per page: missing fields or empty covers is `invalid`; no git or an unknown `verified` commit is `unverifiable`; a covered file changed by a commit after `verified` that did not also touch the page is `stale`; a covered file changed in the working tree or the session is `dirty`, unless the page itself has uncommitted edits; otherwise `fresh`.

## Boundaries
- Scripts and hooks import from `scripts/lib/`; `lib/` modules import only each other and Node built-ins.
- Every CLI script, and `hook-ship-guard.mjs`, runs its CLI only when `process.argv[1]` ends with its own path, so it can be imported (`hook-session-start.mjs` imports `stale.mjs` and `plan.mjs`; `health.mjs` imports `lint.mjs`, `plan.mjs`, and `stale.mjs`; `checks.mjs` imports `detect.mjs`; `lint.mjs` imports `index.mjs`). The other four hooks call `main()` on load and are never imported.
- Every git process is spawned by `git()` in `lib/git.mjs`, with `-c core.quotepath=false` and a timeout (2000 ms by default).
- Plugin state goes only under the data directory, located through `lib/state.mjs`. Scripts write into the target repository only the generated files, a changelog file (`changelog.mjs insert`, `CHANGELOG.md` by default or a `--file` path), and version files (`version.mjs bump`).
- `repo-analyst`, `doc-verifier`, and `rules-reviewer` cannot write files or run commands; `check-runner` and `health-auditor` run commands but never edit files.

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
Evidence: `plugins/ship-faster/README.md:95`, `plugins/ship-faster/scripts/lib/config.mjs:10`, 2026-09-16.

### A page committed with its change stays fresh <!-- id: d-20260916-alongside -->
Decision: Commits that touch the page itself are excluded when computing what changed since `verified`.
Why: Otherwise a page goes stale the moment the commit that updates it alongside the code lands.
Alternatives: A plain `git diff <verified> HEAD`, still used when the history exceeds 2000 commits.
Evidence: `plugins/ship-faster/CHANGELOG.md:33`, `plugins/ship-faster/scripts/stale.mjs:24`, 2026-09-16.

### Walk the history once from three verified commits <!-- id: d-20260916-batch-history -->
Decision: With three or more distinct `verified` shas, `stale.mjs` runs one `git merge-base --octopus` and one `git log` over `base..HEAD`; with fewer it diffs per sha.
Why: Thirty distinct shas cost about 60 git processes and 1785 ms in a SessionStart hook budgeted at 1500 ms; batched, 5 processes and 312 ms. At two shas, two direct calls are cheaper.
Alternatives: One diff per sha, kept for one or two shas.
Evidence: commit 43c0f50, `plugins/ship-faster/scripts/stale.mjs:35`, 2026-09-16.

### Preflight runs a script inside a forked agent <!-- id: d-20260917-preflight-fork -->
Decision: `checks.mjs` runs the checks deterministically; the `check-runner` agent hosting the `preflight` skill only interprets failures.
Why: Full test output never enters the caller's context.
Alternatives: Not recorded.
Evidence: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md:386`, `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md:811`, 2026-09-17.

### The reviewer reads the diff from files <!-- id: d-20260917-review-files -->
Decision: `review.mjs prepare` writes the diff to the data directory and `rules-reviewer` gets only Read, Glob, and Grep.
Why: Agents that need no shell get no Bash tool, and Bash cannot be pattern-restricted per agent.
Alternatives: Not recorded.
Evidence: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md:816`, 2026-09-17.
