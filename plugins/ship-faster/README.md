# ship-faster

Router CLAUDE.md, verified wiki, and a repo-aware shipping workflow for Claude Code.

This release ships the foundation: five hooks and the scripts the skills are built on. The
skills (`onboard`, `sync-docs`, `lesson`, `kickoff`, `preflight`, `ship`, `release`, `health`,
`review`) land in the next two releases; the design is in
`docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` at the repository root.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

Requires `node` (20 or newer) and `git` on your PATH. Restart Claude Code after installing:
hooks register when a session starts.

## Hooks

| Event | Script | What it does | Cost |
|---|---|---|---|
| SessionStart | `hook-session-start.mjs` | Prints where the wiki is, how many pages are stale, the active plan for the branch, and whether the health audit is overdue. Suggests `/ship-faster:onboard` in a repo with 20+ files and no CLAUDE.md. | one `git diff` per distinct verified commit; under 1.5 s on 30 pages |
| PreToolUse (Bash) | `hook-ship-guard.mjs` | Denies force pushes and direct pushes to protected branches, `--no-verify`, and `git add -A` when it would stage secrets, build output, or files over 5 MB. | no git call unless the command contains a `git push`, `git add`, `git commit`, or `git merge`; the repository root is resolved once per working directory and cached for a day |
| PostToolUse (Edit, Write, MultiEdit, NotebookEdit) | `hook-drift-marker.mjs` | Records which wiki pages cover the file you edited. Prints nothing. | no git call after the first per working directory |
| UserPromptSubmit | `hook-prompt-report.mjs` | Once per page per session, tells Claude which pages the session's edits touched and are not yet re-verified. | one small file read |
| SessionEnd | `hook-session-end.mjs` | Deletes the session record and prunes records older than 7 days. | one directory prune |

Every hook exits 0 on every error path and prints nothing when it has nothing to say. A deny
from the guard names the alternative and the config key that overrides it.

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

Guard values are `deny`, `ask`, or `allow`. Defaults never use `ask`: a hook `deny` is
documented to hold under bypass-permissions mode, while `ask` there is not documented.

## What is stored, and where

Under the plugin data directory Claude Code provides (`~/.claude/plugins/data/ship-faster/`, or
the same path under `CLAUDE_CONFIG_DIR`):

```
projects/<hash16>/project.json        { root, createdAt }
projects/<hash16>/sessions/<id>.json  pages touched this session
projects/<hash16>/wiki-cache.json     page covers and verified commits, keyed by mtime
projects/<hash16>/preflight/          check logs, last 10 runs
projects/<hash16>/health.json         last health run
cwd-cache/<hash16>.json               working directory → repository root
```

Everything here is metadata except `preflight/*.log`, which holds the output of the check commands
your repository defines, pruned to the ten most recent runs. Nothing leaves your machine.
`/plugin uninstall ship-faster` deletes this directory; pass `--keep-data` to keep it.

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
node scripts/page.mjs          verify <page>... | touch <page>...: stamp verified (HEAD) and updated (today) on wiki pages
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
