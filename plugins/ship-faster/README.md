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
| `sync-docs` | `/ship-faster:sync-docs [--scope all\|diff\|session] [--since <branch>]` | Re-checks each stale, dirty, invalid, or unverifiable page against the files that changed, fixes or deletes what no longer holds, covers changed files no page describes, verifies the edits, and re-stamps `verified` at HEAD. Claude may invoke it after changing behaviour a page describes. |
| `lesson` | `/ship-faster:lesson [sentence]` | Records a non-obvious cause, decision, or convention as symptom, cause, rule, and evidence, plus one line in `.claude/rules/<area>.md` when the rule has a file scope. Claude may invoke it after fixing a bug whose cause was not visible in the code it edited. |
| `kickoff` | `/ship-faster:kickoff <feature> [--no-branch]` | Reads the pages and recipe that match the feature, writes a complete plan (goal, scope, ordered touchpoints naming real files, tests, docs impact, risks quoting gotchas, verification) to `docs/plans/`, and creates the branch. Slash-only. |
| `preflight` | `/ship-faster:preflight [--continue]` | Runs the repository's checks (from `commands.md`, else CI, else stack detection) inside the `check-runner` agent and reports the table plus the first failure's tail, log path, and diagnosis. Read-only. Claude may invoke it before claiming a change works. |
| `ship` | `/ship-faster:ship [branch-or-description] [--merge] [--draft] [--base <branch>] [--no-review]` | Branches off a protected branch, runs preflight, syncs the docs the change touches, reviews against the repository's rules, checks the plan, commits by name, then (after your yes) pushes and opens the PR with a verification table; `--merge` squash-merges after checks pass and a second yes. Slash-only. |
| `release` | `/ship-faster:release <patch\|minor\|major\|x.y.z> [--file <version file>] [--plugin <name>]` | From a clean default branch: docs checkpoint, Keep a Changelog section from the commits since the last tag, version bump, preflight, `release: vX.Y.Z` commit, tag (`claude plugin tag` in a plugin repository), then (after your yes) push or release PR, and a GitHub release. Slash-only. |
| `health` | `/ship-faster:health [--fix <codes>\|safe]` | Fans out `health-auditor` agents over dependencies, tests, docs, hygiene, CI, and plans and prints one table of coded findings with effort and fix; `--fix` applies chosen fixes behind preflight and reverts them on failure. Slash-only. |
| `review` | `/ship-faster:review [--base <branch>]` | Reviews the branch diff against `conventions.md`, `gotchas.md`, architecture decisions, and matching recipes through the `rules-reviewer` agent; findings coded R1..Rn quote the rule they cite. Inside `ship`, a `block` finding stops the commit. Claude may invoke it before a PR. |

Every skill runs the plugin's scripts for the deterministic parts and asks the model only for judgement. Safety rules the skills state: never force push, never push to a protected branch, never `--no-verify`, never `git add -A` (these four are also blocked by the PreToolUse hook), never skip preflight, never merge without `--merge`. Outward-facing steps (push, PR, merge, publish) wait for your explicit yes; in a non-interactive run the skill stops before them and prints the commands.

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

- `CLAUDE.md`: under 150 lines, a managed block of at most 90 lines between `<!-- ship-faster:managed:start -->` and `<!-- ship-faster:managed:end -->`, and a hand-written `## Rules` section regeneration never touches.
- `docs/wiki/`: `index.md` (generated), `overview.md`, `architecture.md`, `layout.md`, `commands.md` (with the `checks` list preflight runs), `conventions.md`, `testing.md`, `gotchas.md`, `dependencies.md`, `ops.md`, `recipes/<task>.md`, and `packages/<name>.md` in monorepos. Each page is under 200 lines and carries `title`, `summary`, `read_when`, `covers`, `verified`, and `updated`.
- `.claude/rules/<area>.md`: at most 25 lines each, with a `paths:` list so Claude Code loads them only when a matching file is read.
- `docs/plans/<date>-<slug>.md`: written by `kickoff`, marked `shipped` by `ship`, flagged by `health` when the branch is gone.

A page is stale when a covered file changed in a commit that did not also touch the page; a page committed together with the change it describes stays fresh.

## Hooks

| Event | Script | What it does | Cost |
|---|---|---|---|
| SessionStart | `hook-session-start.mjs` | Prints where the wiki is, how many pages are stale, the active plan for the branch, and whether the health audit is overdue. Suggests `/ship-faster:onboard` in a repo with 20+ files and no CLAUDE.md. | one `git log` per distinct verified commit, or one pass over the history from three; under 1.5 s on 30 pages |
| PreToolUse (Bash) | `hook-ship-guard.mjs` | Denies force pushes and direct pushes to protected branches, `--no-verify` on commit, merge, and push, and `git add -A` when it would stage secrets, dependency directories, build output, log files, or files over 5 MB. | no git call unless the command contains a `git push`, `git add`, `git commit`, or `git merge`; the repository root is cached for a day |
| PostToolUse (Edit, Write, MultiEdit, NotebookEdit) | `hook-drift-marker.mjs` | Records which wiki pages cover the file you edited. Prints nothing. | no git call after the first per working directory |
| UserPromptSubmit | `hook-prompt-report.mjs` | Once per page per session, tells Claude which pages the session's edits touched and are not yet re-verified. | one small file read |
| SessionEnd | `hook-session-end.mjs` | Deletes the session record and prunes records older than 7 days. | one directory prune |

Every hook exits 0 on every error path and prints nothing when it has nothing to say. A deny from the guard names the alternative and the config key that overrides it.

Projected token cost, from `claude plugin details ship-faster`: about 1,600 tokens added to every session for the skill and agent listing; hooks add none. The release checklist refreshes this number.

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
  "guard": { "forcePush": "deny", "pushProtected": "deny", "noVerify": "deny", "addAll": "deny" },
  "healthCadenceDays": 14,
  "pageMaxLines": 200,
  "claudeMdMaxLines": 150,
  "rulesFileMaxLines": 25,
  "checkTimeoutSeconds": 600
}
```

Guard values are `deny`, `ask`, or `allow`. Defaults never use `ask`: a hook `deny` is documented to hold under bypass-permissions mode, while `ask` there is not documented.

## What is stored, and where

Under the plugin data directory Claude Code provides (`~/.claude/plugins/data/ship-faster/`, or the same path under `CLAUDE_CONFIG_DIR`):

```
projects/<hash16>/project.json        { root, createdAt }
projects/<hash16>/sessions/<id>.json  pages touched this session
projects/<hash16>/wiki-cache.json     page covers and verified commits, keyed by mtime
projects/<hash16>/preflight/          check logs and last.json, last 10 runs
projects/<hash16>/review/             diff chunks for the reviewer agent, last 5 runs
projects/<hash16>/ship/, release/     commit messages, PR bodies, changelog sections
projects/<hash16>/backup/             copy of CLAUDE.md taken before onboard rewrites it
projects/<hash16>/health.json         last health run
cwd-cache/<hash16>.json               working directory → repository root
```

Everything here is metadata except `preflight/*.log` (the output of the check commands your repository defines), `review/` (your own diff), and `backup/` (your pre-onboard CLAUDE.md). Nothing leaves your machine. `/plugin uninstall ship-faster` deletes this directory; pass `--keep-data` to keep it.

## Scripts

Every script under `scripts/` runs standalone with `--json`:

```
node scripts/detect.mjs        stacks, CI files, scripts, workspaces, suggested checks, resolved config, data dir (--brief for orientation only)
node scripts/footprints.mjs    files that change together, from git history
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable (--since <ref> marks pages in a branch's scope, --session all merges every session record)
node scripts/index.mjs         regenerate docs/wiki/index.md (--check to only compare)
node scripts/lint.mjs          budgets, links, covers, checks shape, secrets
node scripts/checks.mjs        resolve | run the repository's checks
node scripts/plan.mjs          find --branch | stale | set-status
node scripts/page.mjs          verify <page>... | touch <page>...: stamp verified (HEAD) and updated (today)
node scripts/claude-md.mjs     sections | splice --block <file> | backup: read, regenerate, and back up CLAUDE.md's managed block
node scripts/changes.mjs       branch, base, ahead/behind, uncommitted files with risk flags, commit style (ship's inventory)
node scripts/version.mjs       detect | bump <patch|minor|major|x.y.z>: version source (manifests, plugin.json + marketplace, or tags) and bump
node scripts/changelog.mjs     since [--tag <tag>] | insert --section <file>: commits since the last tag grouped Added / Fixed / Changed
node scripts/review.mjs        prepare [--base <branch>]: write the branch diff in chunks plus new files to the data directory and name the rule pages
node scripts/health.mjs        scan | record: old TODOs by blame, large files, skipped tests, slow checks, stale recipes and plans, docs counts
```

## Evals

`evals/<skill>/` holds one case per skill: a prompt, a `case.yaml` naming a scaffold script that builds a fixture repository, and graders (deterministic checks plus one rubric a judge model scores). Runs spend real model credit and need a sandbox backend for `Bash`, so they run in CI on Linux (`.github/workflows/evals.yml`, manual and weekly), never as a PR gate:

```
claude plugin eval plugins/ship-faster --ablation none --runs 1 --scaffold --allow-tools Bash Write Edit --no-publish --trust-plugin --max-cost-usd 20
```

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
