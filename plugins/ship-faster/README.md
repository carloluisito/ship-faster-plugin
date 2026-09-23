# ship-faster

Router CLAUDE.md, verified wiki, and a repo-aware shipping workflow for Claude Code.

`onboard` writes a short `CLAUDE.md` that routes to a wiki of verified, freshness-tracked pages. The shipping skills (`kickoff`, `preflight`, `ship`, `release`, `health`, `review`) build on that knowledge so every step is repo-aware: checks come from `commands.md`, reviews cite the repository's own rules, PR bodies carry the verification table, releases sync the docs first. Design: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` at the repository root.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

Requires `node` (20 or newer) and `git` on your PATH. `gh` is optional: skills that need it print the equivalent URL or command when it is absent. Restart Claude Code after installing: hooks register when a session starts.

## Skills

| Skill | Invoke | What it does |
|---|---|---|
| `onboard` | `/ship-faster:onboard [--force]` | Analyses the repository with parallel read-only agents, runs its checks, writes the wiki under `docs/wiki/`, verifies every page against the code, writes path-scoped rules under `.claude/rules/`, and generates or updates the managed block of `CLAUDE.md`. An existing CLAUDE.md is backed up first and its hand-written text preserved. Slash-only. |
| `sync-docs` | `/ship-faster:sync-docs [--scope all\|diff\|session] [--since <branch>] [--root <path>]` | Re-checks each stale, dirty, invalid, or unverifiable page against the files that changed, fixes or deletes what no longer holds, covers changed files no page describes, verifies the edits, and re-stamps `verified` at HEAD. Claude may invoke it after changing behaviour a page describes. |
| `lesson` | `/ship-faster:lesson [sentence]` | Records a non-obvious cause, decision, or convention as symptom, cause, rule, and evidence, plus one line in `.claude/rules/<area>.md` when the rule has a file scope. Claude may invoke it after fixing a bug whose cause was not visible in the code it edited. |
| `kickoff` | `/ship-faster:kickoff <feature> [--no-branch\|--worktree]` | Reads the pages and recipe that match the feature, writes a complete plan (goal, scope, ordered touchpoints naming real files, tests, docs impact, risks quoting gotchas, verification) to `docs/plans/`, and creates the branch. Slash-only. `--worktree` creates the branch in a sibling checkout (`<repo>-<branch>`), installs its dependencies, and writes the plan there, so a second session can take the ticket while this one continues. |
| `preflight` | `/ship-faster:preflight [--continue] [--root <path>]` | Runs the repository's checks (from `commands.md`, else CI, else stack detection) inside the `check-runner` agent and reports the table plus the first failure's tail, log path, and diagnosis; `--root` runs them in another checkout. Read-only. Claude may invoke it before claiming a change works. |
| `ship` | `/ship-faster:ship [branch-or-description] [--include <paths>] [--here] [--root <worktree>] [--merge] [--draft] [--base <branch>] [--no-review]` | Ships this session's work: alone in the checkout it branches off a protected branch in place; when other sessions share the checkout it takes only this session's files (plus `--include`), builds the commit in a worktree of its own, and removes them from the checkout afterwards. Then preflight, docs sync, review against the repository's rules, plan check, commit by name, and (after your yes) push and PR with a verification table; `--merge` squash-merges after checks pass and a second yes. `--here` ships every change in place as before; `--root` ships follow-ups from that worktree. Slash-only. |
| `release` | `/ship-faster:release <patch\|minor\|major\|x.y.z> [--file <version file>] [--plugin <name>]` | From a clean default branch: docs checkpoint, Keep a Changelog section from the commits since the last tag, version bump, re-stamp of the wiki pages covering the bumped files, preflight, `release: vX.Y.Z` commit, tag (`claude plugin tag` in a plugin repository), then (after your yes) push or release PR, and a GitHub release. Slash-only. |
| `health` | `/ship-faster:health [--fix <codes>\|safe]` | Fans out `health-auditor` agents over dependencies, tests, docs, hygiene, CI, and plans and prints one table of coded findings with effort and fix; `--fix` applies chosen fixes behind preflight and reverts them on failure. Slash-only. |
| `review` | `/ship-faster:review [--base <branch>] [--root <path>]` | Reviews the branch diff against `conventions.md`, `gotchas.md`, architecture decisions, and matching recipes through the `rules-reviewer` agent; findings coded R1..Rn quote the rule they cite. Inside `ship`, a `block` finding stops the commit. Claude may invoke it before a PR. |

Every skill runs the plugin's scripts for the deterministic parts and asks the model only for judgement. Safety rules the skills state: never force push, never push to a protected branch, never `--no-verify`, never `git add -A` (the PreToolUse hook denies pushes to protected branches, `--no-verify`, and an add-all that would stage a risky file), never skip preflight, never merge without `--merge`. Outward-facing steps (push, PR, merge, publish) wait for your explicit yes; when nobody can answer (`claude -p`, an eval, a hook-driven run, which `detect.mjs` reports as `attended: false`) the skill stops before them and prints the commands.

## Several tickets at once

Several sessions can work in one checkout. The edit hook records which files each session changes, and `/ship-faster:ship` in any of them ships only that session's files: it creates a sibling worktree (`<repo>-<branch>`) on a new branch from the checkout's current commit, installs dependencies there, copies the files in, runs preflight, docs sync, and review against that worktree, commits there, and takes the shipped changes back out of the shared checkout. The checkout keeps its branch and every other session's work. Files that another open session also changed, files left by a session that ended or has been idle for two hours, and changes no session's edits explain (a formatter or code generator run through Bash) are asked about, or left out in a non-interactive run; `--include <paths>` adds files, and `--here` ships everything in place as before. Review follow-ups go into the worktree and ship with `/ship-faster:ship --root <worktree>`.

To keep tickets apart from the start instead, begin each in its own worktree from the main checkout:

```
/ship-faster:kickoff <ticket description> --worktree
```

It writes the plan into a new sibling checkout on a new branch, installs its dependencies, and prints the commands to open a session there (`claude --worktree` starts a session in a fresh worktree, without the plan or the install). Session start in any checkout names the other worktrees and says when another session used the same checkout in the last two hours. Plans live on their branch until the PR merges. After a merge, ship prints the `git worktree remove` and `git branch -D` commands to run from the main checkout (a squash merge leaves the branch unmerged in git's eyes, so `-d` would refuse).

## Agents

| Agent | Model | Tools | Role |
|---|---|---|---|
| `repo-analyst` | haiku | Read, Glob, Grep | One per area during onboard; returns evidence-backed facts, `covers` suggestions, recipe candidates, open questions. |
| `doc-verifier` | sonnet | Read, Glob, Grep | One per written page; returns false and unverifiable claims with line numbers. |
| `check-runner` | sonnet | Bash, Read | Hosts `preflight`; runs the checks and diagnoses the first failure so test output never enters your session. |
| `rules-reviewer` | opus | Read, Glob, Grep | Reads the diff chunks and rule pages from files; returns findings that quote the rule they cite. |
| `health-auditor` | sonnet | Read, Glob, Grep, Bash | One per audit area; runs only installed tools and reports a missing tool instead of installing it. |

Agents never write into the repository. `check-runner` writes only check logs under the plugin's data directory.

## What gets generated in your repository

- `CLAUDE.md`: under 150 lines, a managed block of at most 90 lines between `<!-- ship-faster:managed:start -->` and `<!-- ship-faster:managed:end -->`, and a hand-written `## Rules` section regeneration never touches. The managed block ends with a Workflow section that maps each step (checks, review, docs, lessons, plans, PRs, releases, audits) to its ship-faster skill and tells Claude to prefer those over other installed skills with the same purpose. `sync-docs` rewrites that section from the template whenever the plugin changes it, and the session-start line says when it is missing or out of date.
- `docs/wiki/`: `index.md` (generated), `overview.md`, `architecture.md`, `layout.md`, `commands.md` (with the `checks` list preflight runs and the `setup` list new worktrees install with), `conventions.md`, `testing.md`, `gotchas.md`, `dependencies.md`, `ops.md`, `recipes/<task>.md`, and `packages/<name>.md` in monorepos. Each page is under 200 lines and carries `title`, `summary`, `read_when`, `covers`, `verified`, and `updated`.
- `.claude/rules/<area>.md`: at most 25 lines each, with a `paths:` list so Claude Code loads them only when a matching file is read.
- `docs/plans/<date>-<slug>.md`: written by `kickoff`, marked `shipped` by `ship`, flagged by `health` when the branch is gone.

A page is stale when a covered file changed in a commit that did not also touch the page; a page committed together with the change it describes stays fresh.

## Hooks

| Event | Script | What it does | Cost |
|---|---|---|---|
| SessionStart | `hook-session-start.mjs` | Prints where the wiki is, how many pages are stale, the active plan for the branch, the other worktrees, a note when another session used this checkout in the last two hours, whether CLAUDE.md's Workflow section is missing or out of date, and whether the health audit is overdue. Suggests `/ship-faster:onboard` in a repo with 20+ files and no CLAUDE.md. | one `git log` per distinct verified commit, or one pass over the history from three; under 1.5 s on 30 pages |
| PreToolUse (Bash) | `hook-ship-guard.mjs` | Denies force pushes and direct pushes to protected branches, `--no-verify` on commit, merge, and push, and `git add -A` when it would stage secrets, dependency directories, build output, log files, or files over 5 MB. In a repository with a wiki, lets `gh pr create` run but tells Claude when the PR body lacks the `<!-- opened-by: ship-faster -->` line that `ship` and `release` write, so it runs preflight, sync-docs, and review on the branch afterwards. | no git call unless the command contains a `git push`, `git add`, `git commit`, or `git merge`; `gh pr create` reads only its body file; the repository root is cached for a day |
| PostToolUse (Edit, Write, MultiEdit, NotebookEdit) | `hook-drift-marker.mjs` | Records that this session changed the file (so `ship` can tell sessions apart) and which wiki pages cover it. Prints nothing. | no git call after the first per working directory |
| UserPromptSubmit | `hook-prompt-report.mjs` | Once per page per session, tells Claude which pages the session's edits touched and are not yet re-verified. | one small file read |
| SessionEnd | `hook-session-end.mjs` | Deletes the session record, keeps its record of edited files, and prunes both kinds older than 7 days. | one directory prune |

Every hook exits 0 on every error path and prints nothing when it has nothing to say. A deny from the guard names the alternative and the config key that overrides it.

Projected token cost, from `claude plugin details ship-faster`: about 1,600 tokens added to every session for the skill and agent listing; hooks add none. Re-measure it with that command at each release.

## Failure behaviour

- Hooks never fail a session: missing git, no repository, malformed input, unreadable state, or an unwritable data directory all exit 0 silently.
- Skills never proceed past a failed gate: a failed preflight stops `ship` and `release`; a `block` review finding stops `ship` before the commit; lint errors stop `onboard` and `sync-docs` from reporting success.
- Scripts report outcomes as JSON with `ok: true|false` and exit 0 whenever a document was produced, so skill preprocessing never aborts; `lint` alone exits 1 on lint errors to gate CI.
- Generated files are shown before they are written (CLAUDE.md as a diff, pages as a listing), and a pre-onboard CLAUDE.md is backed up.
- Nothing leaves the machine from the plugin itself. Network use is limited to `gh` and package-manager audit commands, run by skills in view of the user.

## Configuration

Optional `.claude/ship-faster.json` in the repository. Every key is optional:

```json
{
  "wikiDir": "docs/wiki",
  "plansDir": "docs/plans",
  "rulesDir": ".claude/rules",
  "defaultBranch": "auto",
  "protectedBranches": ["main", "master"],
  "guard": { "forcePush": "deny", "pushProtected": "deny", "noVerify": "deny", "addAll": "deny", "prOutsideShip": "warn" },
  "healthCadenceDays": 14,
  "pageMaxLines": 200,
  "claudeMdMaxLines": 150,
  "rulesFileMaxLines": 25,
  "checkTimeoutSeconds": 600
}
```

Guard values are `deny`, `ask`, `warn`, or `allow`. `warn` lets the command run and adds the reason to Claude's context. Defaults never use `ask`: it prompts even in bypass-permissions mode (Claude Code 2.1.196 and later) and changes nothing in the other modes, which prompt anyway.

## What is stored, and where

Under the plugin data directory Claude Code provides, `<config>/plugins/data/ship-faster-<marketplace>/` (`~/.claude/plugins/data/ship-faster-ship-faster/` for this marketplace, `ship-faster-inline` with `--plugin-dir`); scripts run from skills rebuild the same path, so hooks and skills share it:

```
projects/<hash16>/project.json        { root, createdAt }
projects/<hash16>/wiki-cache.json     page covers and verified commits, keyed by mtime
projects/<hash16>/preflight/          check logs and last.json, last 10 runs
projects/<hash16>/ship/, release/     commit messages, PR bodies, changelog sections
projects/<hash16>/backup/             copy of CLAUDE.md taken before onboard rewrites it
projects/<hash16>/health.json         last health run
cwd-cache/<hash16>.json               working directory → repository root
```

In each checkout's git directory (`.git/ship-faster/`, or the worktree's own directory under `.git/worktrees/`), where hooks, skills, and sandboxed commands all read the same files:

```
sessions/<id>.json                    pages touched this session, its branch, and when it was last active
edits/<id>.json                       files this session changed and when, until 7 days after its last edit
```

Everything here is metadata except `preflight/*.log` (the output of the check commands your repository defines) and `backup/` (your pre-onboard CLAUDE.md). The diff chunks the reviewer agent reads live under `ship-faster/review/` in the system temp directory, last 5 runs per repository. Nothing leaves your machine. `/plugin uninstall ship-faster` deletes the plugin data directory (pass `--keep-data` to keep it); `.git/ship-faster/` is pruned after 7 days and goes with `git worktree remove`.

## Scripts

Every script under `scripts/` runs standalone with `--json`:

```
node scripts/detect.mjs        stacks, CI files, scripts, workspaces, suggested checks, resolved config, data dir, whether a user can answer (--brief for orientation only)
node scripts/footprints.mjs    files that change together, from git history
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable (--since <ref> marks pages in a branch's scope, --session all merges every session record)
node scripts/index.mjs         regenerate docs/wiki/index.md (--check to only compare)
node scripts/lint.mjs          budgets, links, covers, checks and setup shape, secrets
node scripts/checks.mjs        resolve | run the repository's checks | setup: install dependencies (commands.md setup list, else lockfiles)
node scripts/plan.mjs          find --branch | stale | set-status
node scripts/page.mjs          verify <page>... | touch <page>...: stamp verified (HEAD) and updated (today)
node scripts/claude-md.mjs     sections | splice --block <file> | workflow [--dry-run] | backup: read, regenerate, refresh the Workflow section of, and back up CLAUDE.md's managed block
node scripts/changes.mjs       branch, base, ahead/behind, uncommitted files with risk flags and owner, commit style (ship's inventory; --session <id> [--include <globs>] [--here] decides what ships)
node scripts/version.mjs       detect | bump <patch|minor|major|x.y.z>: version source (manifests, plugin.json + marketplace, or tags) and bump
node scripts/changelog.mjs     since [--tag <tag>] | insert --section <file>: commits since the last tag grouped Added / Fixed / Changed
node scripts/review.mjs        prepare [--base <branch>]: write the branch diff in chunks plus new files to the data directory and name the rule pages
node scripts/health.mjs        scan | record: old TODOs by blame, large files, skipped tests, slow checks, stale recipes and plans, docs counts
node scripts/worktree.mjs      list | add --branch <name> [--from <ref>] | carry --to <worktree> <files> | clear --from <worktree> <files>: worktrees, a new sibling worktree, and moving a session's files into one and back out once committed
```

## Evals

`evals/<case>/` holds at least one case per skill (`ship` and `kickoff` have a second), plus `routing`, which installs same-purpose skills next to the plugin and checks that Claude still picks ship-faster's: a prompt, a `case.yaml` naming a scaffold script that builds a fixture repository, and graders (deterministic checks, and in most cases a rubric a judge model scores). Runs spend real model credit and need a sandbox backend for `Bash`, so they never gate a PR. Run them on Linux, from Windows through WSL, or with `.github/workflows/evals.yml` on manual dispatch (it needs an `ANTHROPIC_API_KEY` repository secret):

```
plugins/ship-faster/tests/evals.sh [case ...]
.\plugins\ship-faster\tests\evals.ps1 [case ...]
```

Each case is a name or a glob such as `kickoff*`; several cases run one harness run each, and a pattern that matches no case fails the run. The Windows script installs the WSL prerequisites once with `-Setup`. Both print a per-case table at the end.

## Development

```
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
node plugins/ship-faster/tests/bench.mjs
claude plugin validate --strict plugins/ship-faster
```

Releases are cut with the plugin's own skill: `/ship-faster:release <bump>` bumps `plugin.json` and the marketplace entry together and tags with `claude plugin tag`.

## License

MIT
