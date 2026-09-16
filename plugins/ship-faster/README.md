# ship-faster

Router CLAUDE.md, verified wiki, and a repo-aware shipping workflow for Claude Code.

This release ships the knowledge layer on top of the foundation: `onboard`, `sync-docs`, and `lesson`, the `repo-analyst` and `doc-verifier` agents, and the hooks and scripts they run on. The shipping skills (`kickoff`, `preflight`, `ship`, `release`, `health`, `review`) land in the next release. The design is in `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` at the repository root.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

Requires `node` (20 or newer) and `git` on your PATH. Restart Claude Code after installing: hooks register when a session starts.

## Skills

| Skill | Invoke | What it does |
|---|---|---|
| `onboard` | `/ship-faster:onboard [--force]` | Analyses the repository with parallel read-only agents, runs its checks, writes a wiki under `docs/wiki/` (one topic per page, each with `covers` globs and a `verified` commit), verifies every page against the code, writes path-scoped rules under `.claude/rules/`, and generates or updates the managed block of `CLAUDE.md`. Hand-written text outside the markers is preserved; an existing CLAUDE.md is backed up first. Slash-only. |
| `sync-docs` | `/ship-faster:sync-docs [--scope all\|diff\|session] [--since <branch>]` | Re-checks every claim of each stale, dirty, invalid, or unverifiable page against the files that changed, fixes or deletes what no longer holds, adds coverage for changed files no page covers, verifies the edits with the doc-verifier agent, and re-stamps `verified` at HEAD. Claude may invoke it on its own after changing behaviour a page describes. |
| `lesson` | `/ship-faster:lesson [sentence]` | Records a non-obvious cause, decision, or convention right after it is learned: symptom, cause, rule, evidence into `gotchas.md` (or the Decisions section of `architecture.md`, or `conventions.md`), plus one line in `.claude/rules/<area>.md` when the rule has a file scope. Claude may invoke it on its own after fixing a bug whose cause was not visible in the code it edited. |

Every skill runs the plugin's scripts for the deterministic parts (classification, stamping, indexing, lint) and asks the model only for judgement. A page is never called true unless the changed files behind it were read.

## Agents

| Agent | Model | Tools | Role |
|---|---|---|---|
| `repo-analyst` | haiku | Read, Glob, Grep | One per area during onboard; returns evidence-backed facts, `covers` suggestions, recipe candidates, and open questions as JSON. |
| `doc-verifier` | sonnet | Read, Glob, Grep | One per written page; returns the false and unverifiable claims with line numbers. |

Neither agent can write or run commands.

## What gets generated in your repository

- `CLAUDE.md`: under 150 lines, a managed block of at most 90 lines between `<!-- ship-faster:managed:start -->` and `<!-- ship-faster:managed:end -->`, and a hand-written `## Rules` section that regeneration never touches.
- `docs/wiki/`: `index.md` (generated), `overview.md`, `architecture.md`, `layout.md`, `commands.md` (with the `checks` list preflight runs), `conventions.md`, `testing.md`, `gotchas.md`, `dependencies.md`, `ops.md`, `recipes/<task>.md`, and `packages/<name>.md` in monorepos. Each page is under 200 lines and carries `title`, `summary`, `read_when`, `covers`, `verified`, and `updated`.
- `.claude/rules/<area>.md`: at most 25 lines each, with a `paths:` list so Claude Code loads them only when a matching file is read.

A page is stale when a covered file changed in a commit that did not also touch the page; a page committed together with the change it describes stays fresh.

## Hooks

| Event | Script | What it does | Cost |
|---|---|---|---|
| SessionStart | `hook-session-start.mjs` | Prints where the wiki is, how many pages are stale, the active plan for the branch, and whether the health audit is overdue. Suggests `/ship-faster:onboard` in a repo with 20+ files and no CLAUDE.md. | one `git log` per distinct verified commit, or one pass over the history from three; under 1.5 s on 30 pages |
| PreToolUse (Bash) | `hook-ship-guard.mjs` | Denies force pushes and direct pushes to protected branches, `--no-verify`, and `git add -A` when it would stage secrets, build output, or files over 5 MB. | no git call unless the command contains a `git push`, `git add`, `git commit`, or `git merge`; the repository root is resolved once per working directory and cached for a day |
| PostToolUse (Edit, Write, MultiEdit, NotebookEdit) | `hook-drift-marker.mjs` | Records which wiki pages cover the file you edited. Prints nothing. | no git call after the first per working directory |
| UserPromptSubmit | `hook-prompt-report.mjs` | Once per page per session, tells Claude which pages the session's edits touched and are not yet re-verified. | one small file read |
| SessionEnd | `hook-session-end.mjs` | Deletes the session record and prunes records older than 7 days. | one directory prune |

Every hook exits 0 on every error path and prints nothing when it has nothing to say. A deny from the guard names the alternative and the config key that overrides it.

Projected token cost, from `claude plugin details ship-faster`: about 640 tokens added to every session for the skill and agent listing (lesson 200, sync-docs 160, repo-analyst 120, doc-verifier 100, onboard 70); hooks add none. A skill costs its own body only when it fires (onboard about 2.9k, lesson 1.8k, sync-docs 1.4k). The release checklist refreshes these numbers.

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
projects/<hash16>/preflight/          check logs, last 10 runs
projects/<hash16>/backup/             copy of CLAUDE.md taken before onboard rewrites it
projects/<hash16>/health.json         last health run
cwd-cache/<hash16>.json               working directory → repository root
```

Everything here is metadata except `preflight/*.log`, which holds the output of the check commands your repository defines, pruned to the ten most recent runs, and `backup/`, which holds your pre-onboard CLAUDE.md. Nothing leaves your machine. `/plugin uninstall ship-faster` deletes this directory; pass `--keep-data` to keep it.

## Scripts

Every script under `scripts/` runs standalone with `--json`:

```
node scripts/detect.mjs        stacks, CI files, scripts, workspaces, suggested checks, resolved config, data dir (--brief for orientation only)
node scripts/footprints.mjs    files that change together, from git history
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable (--since <ref> marks pages in a branch's scope, --session all merges every session record; a page committed together with the covered change stays fresh)
node scripts/index.mjs         regenerate docs/wiki/index.md (--check to only compare)
node scripts/lint.mjs          budgets, links, covers, checks shape, secrets
node scripts/checks.mjs        resolve | run the repository's checks
node scripts/plan.mjs          find --branch | stale | set-status
node scripts/page.mjs          verify <page>... | touch <page>...: stamp verified (HEAD) and updated (today)
node scripts/claude-md.mjs     sections | splice --block <file> | backup: read, regenerate, and back up CLAUDE.md's managed block
node scripts/changes.mjs       branch, base, ahead/behind, uncommitted files with risk flags, commit style (ship's inventory)
```

## Evals

`evals/<skill>/` holds one case per skill: a prompt, a `case.yaml` naming a scaffold script that builds a fixture repository, and graders (deterministic checks plus one rubric a judge model scores). Runs spend real model credit and need a sandbox backend for `Bash`, so they are run by hand on Linux (a scheduled CI job arrives with the shipping skills), never as a PR gate:

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

## License

MIT
