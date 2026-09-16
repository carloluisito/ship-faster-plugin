# Changelog

All notable changes to this plugin are documented here. The format follows Keep a Changelog and
versions follow semver.

## [Unreleased]

### Added
- SessionStart hook: wiki location, stale page count, active plan, overdue health audit, onboard suggestion.
- PreToolUse guard: denies force pushes and direct pushes to protected branches, `--no-verify`, and risky `git add -A`.
- PostToolUse drift marker and UserPromptSubmit report: pages covering edited files are recorded and reported once per session.
- SessionEnd cleanup of session records.
- Scripts: detect, footprints, stale, index, lint, checks, plan, with a shared zero-dependency library.
- Optional `.claude/ship-faster.json` configuration.
- `onboard` skill: analyses the repository with parallel `repo-analyst` agents, runs its checks, writes the wiki, verifies every page with `doc-verifier`, writes path-scoped rules, and generates or updates the managed block of CLAUDE.md (existing file backed up first).
- `sync-docs` skill: re-verifies stale, dirty, invalid, and unverifiable pages against the changed files, covers changed files no page describes, and re-stamps `verified` at HEAD; `--scope diff --since <branch>` limits it to a branch's changes.
- `lesson` skill: records a gotcha, decision, or convention with symptom, cause, rule, and evidence, plus a path-scoped rule line.
- Agents `repo-analyst` (haiku, read-only) and `doc-verifier` (sonnet, read-only).
- Templates for CLAUDE.md, per-package CLAUDE.md, every wiki page type, recipes, plans, rules files, and gotcha entries.
- Scripts `page.mjs` (stamp `verified`/`updated`) and `claude-md.mjs` (sections, splice, backup); `stale.mjs --since` and `--session all`; `detect.mjs --brief`, `config`, and `dataDir`.
- Eval cases for `onboard`, `sync-docs`, and `lesson` under `evals/`, with scaffold scripts that build fixture repositories.
- `kickoff` skill: a grounded plan under `docs/plans/` (goal, complete scope, ordered touchpoints, tests, docs impact, risks quoting gotchas, verification) and the branch for it.
- `preflight` skill: runs the repository's checks inside the `check-runner` agent and reports the table, the failure tail, the log path, and a diagnosis.
- `ship` skill: branch, preflight, docs sync, rules review, plan check, commit by name, push and PR with a verification table, optional squash-merge; the guard hook blocks force pushes, protected-branch pushes, `--no-verify`, and `git add -A`.
- `release` skill: docs checkpoint, Keep a Changelog section, version bump across manifests (plugin.json and marketplace entry together), preflight, `release: vX.Y.Z` commit, tag via `claude plugin tag` in plugin repositories, guarded publish and GitHub release.
- `health` skill: coded findings across dependencies, tests, docs, hygiene, CI, and plans from `health-auditor` agents, with `--fix safe` behind preflight.
- `review` skill: findings against the repository's own conventions, gotchas, decisions, and recipes through the `rules-reviewer` agent.
- Agents `check-runner`, `rules-reviewer`, and `health-auditor`.
- Scripts `changes.mjs`, `version.mjs`, `changelog.mjs`, `review.mjs`, `health.mjs`; the PR body template.
- Eval cases for every skill and a manual plus weekly eval workflow.

### Changed
- A wiki page committed together with the covered files it describes stays fresh: only commits that change covered files without touching the page make it stale, and a page with uncommitted edits of its own is not marked dirty by covered working-tree changes. Pages no longer go stale the moment `ship` commits them.

### Fixed
- The guard no longer waves through `git push origin main --tags`: pushing tags alongside a branch is still checked against the protected branches.
- Hooks exit as soon as they have read their input, instead of lingering when the caller leaves the input pipe open.
- A wiki whose pages were verified at many different commits no longer makes session start slow: the staleness check now reads the history once instead of once per commit.
- The guard waits at most two seconds for `git status` before it gives up and allows the command.
- Multi-line CI steps are read as one command, so a step split across lines with `\` or `&&` no longer turns into fragments that fail when run as checks.
- A preflight run still reports every check when its log file cannot be written.
- CI steps written as a YAML sequence where one item ends with `&&`, `|`, or `\` join into one command without carrying the next item's `- ` marker.
- A hook's stdin keeps an error handler after its input has been read, so a late pipe error cannot crash the process.
- Wiki freshness reads the history in one pass only when three or more pages were verified at different commits; at two, the two direct diffs are cheaper.
- Files changed by a merge commit itself (an "evil merge") now count as changed since a page's verified commit.
- The one-pass freshness check ignores malformed `verified` values instead of failing for every page.
