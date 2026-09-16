# ship-faster plugin design

Date: 2026-09-16. Status: approved design, pre-implementation.

A Claude Code plugin that makes an agent effective in any repository within one session, and keeps
it effective as the repository changes. It generates a short routing `CLAUDE.md` plus a small wiki
of verified, freshness-tracked pages, then builds the shipping workflow (plan, verify, review,
PR, release, maintenance) on top of that knowledge so every step is repo-aware instead of generic.

The design is written from the consumer's point of view: the agent that has to work in the repo.

## 1. Principles

1. **CLAUDE.md is a router, not a manual.** It is loaded into every session, so it stays under 150
   lines and says what exists and when to open it. Depth lives in pages opened on demand.
2. **Every claim is verifiable and dated.** Each page declares which paths it covers and which
   commit it was verified against. Staleness is computed by a script, never remembered.
3. **Commands are verified by running them.** A command that was not executed successfully is
   never written down as a command that works.
4. **Task routing beats architecture prose.** Recipes ("to add X, touch these files in this
   order, test here") are the highest-value content. File trees and restated code are noise.
5. **Rules are enforced where possible.** Hooks make the shipping rules real. Path-scoped rules put
   a gotcha in front of the agent at the moment it touches the relevant file.
6. **Zero dependencies, degrade silently.** Hooks and scripts are plain Node, exit 0 on any
   error, and never block a session by accident. Nothing leaves the machine.
7. **Complete product, dependency-ordered build.** Nothing is deferred to a later version. The
   build order follows what depends on what.

## 2. Scope

In scope: 9 skills, 5 subagents, 5 hooks, a set of plain-Node scripts, templates, tests, and
the generated artifacts in a target repository.

Out of scope, deliberately (decisions D8 to D10, D12):

- No MCP server and no bundled MCP configs. Everything is a file to read, a script to run, or a
  `gh` call. Tool schemas would cost context in every session and add an install-time failure mode.
- No LSP configuration.
- No `commands/` directory. Every entry point is a skill.
- No Stop hook that blocks finishing until docs are synced. Ship time is the deterministic
  moment for docs, and blocking mid-work is worse than the drift it prevents.
- No cross-repo memory or lesson search. That is a memory product, not a shipping product.
- No deploying. `ops.md` documents deployment; no skill runs it.

## 3. Plugin repository layout

The repository is a marketplace with one plugin. Claude Code installs plugins from a
marketplace catalog, and the documented form for a catalog entry is a relative path below the
directory holding `.claude-plugin/`, so the plugin lives in a subdirectory (D5).

```
.claude-plugin/marketplace.json     catalog: marketplace `ship-faster`, one entry → ./plugins/ship-faster
plugins/ship-faster/                the plugin, self-contained
  .claude-plugin/plugin.json        plugin manifest
  skills/<name>/SKILL.md            nine skills (section 6); supporting files beside each SKILL.md
  agents/<name>.md                  five subagents (section 7)
  hooks/hooks.json                  five hooks (section 8)
  scripts/*.mjs                     CLI entry points (section 9)
  scripts/lib/*.mjs                 shared modules: frontmatter, glob, git, wiki, state, config
  templates/                        CLAUDE.md, page, plan, PR body, rules-file templates
  evals/<skill>/                    eval cases for `claude plugin eval` (prompt.md + graders/)
  tests/run.mjs                     unit and integration tests (node:test, temp git repos)
  tests/validate.mjs                plugin structure validator
  tests/bench.mjs                   hook latency benchmark
  README.md  CHANGELOG.md
.github/workflows/ci.yml            validate + tests on ubuntu and windows
.github/workflows/evals.yml         manual and weekly eval run
README.md                           install instructions, points into the plugin
LICENSE
docs/superpowers/specs/             this document
docs/superpowers/plans/             implementation plans
```

Runtime requirements: Node 20 or newer, `git` on PATH. `gh` is optional; skills that need it
print the equivalent URL or command when it is absent. Skills reference their own files through
`${CLAUDE_SKILL_DIR}` and shared scripts through `${CLAUDE_PLUGIN_ROOT}`.

## 4. Generated artifacts in a target repository

### 4.1 CLAUDE.md

Budget: 150 lines total, enforced by lint (the Claude Code docs recommend staying under 200;
the tighter number leaves room for hand-written rules to grow). Generated content sits between
marker comments so regeneration never touches hand-written text.

```
# <Project name>

<!-- ship-faster:managed:start -->
## What this is
Three lines: purpose, users, shape of the system.

## Stack
Up to six bullets. Language, framework, package manager, database, infra, anything unusual.

## Layout
Up to twelve lines: directory, responsibility, entry point. Not a file tree.

## Commands (verified <date> at <short sha>)
| Purpose | Command | Duration |
Only commands that passed when run. Deploy and publish commands are listed as "not run".

## Read next
| When you need to… | Open |
One row per page and recipe. docs/wiki/index.md lists everything.

## Keeping docs true
Two lines: pages carry covers globs and a verified commit; /ship-faster:sync-docs refreshes
stale pages and /ship-faster:ship runs it before every PR; record non-obvious causes with
/ship-faster:lesson right after learning them.
<!-- ship-faster:managed:end -->

## Rules
Hand-written. Preserved verbatim across regeneration. Seeded at onboard from the rules found in
an existing CLAUDE.md plus the top gotchas. Imperative sentences only.
```

The managed block is capped at 90 lines. CLAUDE.md never uses `@path` imports of wiki pages
(D2): importing would load every page into every session and defeat on-demand reading.

### 4.2 Wiki

Location: `docs/wiki/` (D1), overridable through config. One topic per page, 200 lines maximum
per page, index generated and never hand-edited.

| Page | Purpose | Required sections | Typical `covers` |
|---|---|---|---|
| `index.md` | Generated table of every page: read when, summary | (generated) | none, excluded from staleness |
| `overview.md` | What the product is, who uses it, domain vocabulary, system boundaries | What it is · Users · Vocabulary · Boundaries | `README*`, root manifests |
| `architecture.md` | Components, data flow, boundaries, key decisions with their why | Components · Data flow · Boundaries · Decisions | `src/**` top-level dirs |
| `layout.md` | Directory to responsibility, entry points, where new things go | Map · Entry points · Where things go | root manifests, `src/**` |
| `commands.md` | Verified commands with durations, env setup, ports; the `checks` list used by preflight | Setup · Everyday · Checks · Known slow or flaky | manifests, CI files, `scripts/**` |
| `conventions.md` | Naming, patterns to follow, patterns to avoid, error handling, style | Follow · Avoid · Style | lint configs, `src/**` |
| `testing.md` | Test layout, how to add a test, fixtures, mocks, what cannot run locally | Layout · Adding a test · Fixtures and mocks · Not runnable locally | test dirs, test configs |
| `gotchas.md` | Hard-won constraints, each with symptom, cause, rule, evidence | (entries) | whatever the entries cite |
| `dependencies.md` | Key dependencies, why each is there, pins and their reasons, upgrade notes | Key deps · Pinned · Upgrading | lockfiles, manifests |
| `ops.md` | Environments, CI pipeline, deploy, release process, secret names (never values), monitoring | Environments · CI · Deploy · Release · Secrets by name | CI files, infra dirs, deploy scripts |
| `recipes/<task>.md` | One common change type: ordered steps, files, test to add, docs page to update | Steps · Files · Test · Docs | the files the recipe touches |
| `packages/<name>.md` | Monorepos only: one page per workspace package | What · Commands · Read next | the package directory |

Every page except `index.md` carries this frontmatter:

```yaml
---
title: Commands
summary: Verified dev, test, and build commands with durations.
read_when: You need to run, test, build, or debug the environment.
covers: ["package.json", ".github/workflows/**", "scripts/**"]
verified: 9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6
updated: 2026-09-16
---
```

`commands.md` additionally carries the check list preflight executes, in order:

```yaml
checks:
  - name: typecheck
    run: npx tsc --noEmit
    timeout: 300
  - name: test
    run: npm test
    timeout: 900
```

Frontmatter is a defined YAML subset (section 9.1). `covers` are gitignore-style globs relative
to the repository root, supporting `**`, `*`, `?`, and `{a,b}`. `covers` is never empty, and a
page whose `covers` matches no tracked file fails lint, because it could never go stale and would
therefore lie. A page with nothing to cover does not exist yet: `gotchas.md` is created by the
first `lesson` (or by onboard when analysis yields at least one entry), and its `covers` is the
union of the paths its entries cite as evidence. `index.md` is exempt from frontmatter and
staleness.

Gotcha entry format:

```
### <short title>            <!-- id: g-<yyyymmdd>-<slug> -->
Symptom: what you see.
Cause: why it happens, the part that is not visible locally.
Rule: the imperative sentence that prevents it.
Evidence: <commit sha or path:line>, <date>.
```

### 4.3 Path-scoped rules

`.claude/rules/<area>.md` files, 25 lines maximum each, with a `paths:` frontmatter listing the
globs they apply to. Each holds the imperative rules for one area of the code, one line per rule,
each pointing at the gotcha id or page that explains it. Claude Code loads a path-scoped rules
file when the agent reads a file matching one of its globs, which is the most reliable way to put
a constraint in front of the agent at the moment it matters. Every rules file written by this
plugin has a `paths:` list; a rules file without one loads into every session and would defeat
the router budget. Onboard generates them from gotchas and conventions that have a clear path
scope; `lesson` appends to them when a new gotcha has one.

### 4.4 Plans

`docs/plans/<yyyy-mm-dd>-<slug>.md` (D11), written by `kickoff`, committed with the work.

```yaml
---
title: Add SSO login
branch: feat/sso-login
status: active        # active | shipped | abandoned
created: 2026-09-16
pages: [architecture, recipes/add-endpoint, testing]
---
```

Body sections: Goal · Scope (complete, nothing deferred) · Touchpoints (ordered, file and what
changes) · Tests to add · Docs impact · Risks · Verification (commands). `ship` sets `status:
shipped` when the PR is created. `health` flags active plans whose branch was merged or deleted
more than 30 days ago (D12). Plans are transient intent and never live inside the wiki.

### 4.5 Configuration

`.claude/ship-faster.json`, optional, every key optional:

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

`defaultBranch: "auto"` resolves from `refs/remotes/origin/HEAD`, then falls back to `main`
or `master`, whichever exists. Guard values are `deny`, `ask`, or `allow`. Defaults never use
`ask`: a hook `deny` is documented to hold even under bypass-permissions mode, while what `ask`
does there is not documented, so `ask` is available only as an explicit user choice.

### 4.6 Monorepos (D3)

When the repo has two or more workspace packages (pnpm or npm workspaces, a solution with several
projects, `go.work`, a Cargo workspace) and at least a medium size class, onboard also writes one
`packages/<name>.md` wiki page per package and a per-package `CLAUDE.md` of at most 30 lines:
what the package is, its commands, and the three pages most relevant to it. The root CLAUDE.md
stays the router for the whole repo.

## 5. Plugin data

State lives under the plugin data directory Claude Code provides as `${CLAUDE_PLUGIN_DATA}`,
which resolves to `plugins/data/<plugin-id>/` under the config directory, survives plugin
updates, and is deleted on uninstall unless `--keep-data` is passed. When that placeholder
arrives empty or unexpanded, the fallback is `$CLAUDE_CONFIG_DIR/plugins/data/ship-faster`, or
`~/.claude/plugins/data/ship-faster` when `CLAUDE_CONFIG_DIR` is unset:

```
<data>/projects/<hash16>/
  project.json          { root, createdAt }
  sessions/<sid>.json   drift-marker state: pages touched this session, notified flags
  wiki-cache.json       page file, mtime, covers, verified, title (rebuilt when any mtime changes)
  remote-head.json      { branch, checkedAt } cached for one day
  health.json           { lastRun, counts }
  preflight/            last.json plus per-check logs, pruned to the ten most recent runs
  backup/               pre-onboard copy of an uncommitted CLAUDE.md
```

`hash16` is the first sixteen hex characters of the SHA-256 of the repository root path. Writes
are atomic (temp file then rename). Corrupt state is treated as empty and replaced. Everything here
is metadata except `preflight/*.log`, which holds the output of the check commands your repository
defines, pruned to the ten most recent runs. Nothing leaves your machine.

## 6. Skills

Invocation is `/ship-faster:<name>`; plugin skills are always namespaced. "Slash-only" means
`disable-model-invocation: true` so the agent never runs it uninvited. "Model-invocable" means
the agent may call it when the situation matches; those skills carry a `when_to_use` field
stating the trigger conditions separately from the description, and the two together stay under
the 1,536-character listing limit.

Skills inject script output at load time with the `` !`command` `` preprocessing form, always
suffixed with `|| true`, because a failing preprocessing command aborts the whole skill. Every
SKILL.md stays under 500 lines; reference material lives in files beside it, linked by relative
path.

| Code | Skill | Invocation | Uses |
|---|---|---|---|
| S1 | `onboard` | slash-only | G1, G2, detect, footprints, checks, index, lint |
| S2 | `sync-docs` | model-invocable | stale, G2, index, lint |
| S3 | `lesson` | model-invocable | lint |
| S4 | `kickoff` | slash-only | plan, index |
| S5 | `preflight` | model-invocable; `context: fork`, `agent: check-runner`, `background: false` so callers wait for the result | checks |
| S6 | `ship` | slash-only | S5, S2, S9, plan, guard (H2) |
| S7 | `release` | slash-only | S5, S2, checks |
| S8 | `health` | slash-only | G5, stale, lint, plan, S5 |
| S9 | `review` | model-invocable | G4 |

### S1 `onboard`

Generates CLAUDE.md, the wiki, and path-scoped rules for the current repository.

1. **Preconditions.** Run `detect` (section 9.3). If a wiki already exists, stop and point at
   `sync-docs`, unless `--force` was given. Requires nothing else; a repo without git still works
   with reduced features (no footprints, pages marked `verified: unverified`).
2. **Existing CLAUDE.md.** If present and uncommitted, copy it to the data backup directory. Parse
   its H2 sections and classify each: rule (imperative constraints, kept verbatim under Rules),
   depth (explanatory content, moved to the matching page), commands (verified and moved to
   `commands.md`), stale (claims G2 later finds false, dropped and listed in the report).
3. **Footprints.** Run `footprints` (section 9.4) to find files that change together and the
   commit vocabulary around them. These become recipe candidates.
4. **Analysis fan-out.** Launch G1 `repo-analyst` in parallel, one per area (stack and commands,
   layout and entry points, tests, conventions, architecture and data flow, ops and CI,
   dependencies), each given `detect` and `footprints` output. Each returns structured facts with
   file:line evidence, suggested `covers` globs, and open questions. Large repos (size class
   large) get areas split by top-level directory.
5. **Verify commands.** Run `checks resolve` then `checks run --continue` with the default timeout
   so every candidate check is actually executed. Deploy, publish, and release commands are never
   run and are recorded as "not run". Record status and duration for each.
6. **Draft pages.** Write every page from section 4.2 that has content, plus one recipe per
   footprint cluster with a clear task shape. Fill frontmatter: `covers` from analyst suggestions,
   `verified` = HEAD sha, `updated` = today. Enforce the 200-line budget by splitting (recipes) or
   cutting restated code, never by dropping rules.
7. **Verify pages.** Launch G2 `doc-verifier` per page. Fix or delete every claim it marks false.
   One pass; remaining doubts become an "Unverified" line at the bottom of the page.
8. **Rules files.** Write `.claude/rules/<area>.md` for each area with at least one path-scoped
   rule, drawn from gotchas and conventions.
9. **CLAUDE.md.** Render the template from section 4.1. Show the full diff against any existing
   file, then write. Monorepos also get per-package files (section 4.6).
10. **Index and lint.** Run `index` then `lint`. Fix lint errors before finishing.
11. **Report.** Pages written, commands verified with pass/fail/not-run, sections migrated or
    dropped from the old CLAUDE.md, recipes created, and a suggested first `lesson` if the analysis
    surfaced a constraint that is not yet written anywhere.

Empty or nearly empty repositories: onboard asks one question (a paragraph describing the
project) if no README exists, then writes CLAUDE.md, `overview.md`, `architecture.md`,
`commands.md`, `conventions.md`, and an empty index. Recipes come later from `sync-docs`.

### S2 `sync-docs`

Brings stale pages back to true. Description tells the agent to invoke it after changing
behaviour that a wiki page describes, and before claiming a feature done.

Arguments: `--scope all|diff|session` (default `all`; `ship` passes `diff` and includes the
session record from H3). Steps:

1. Run `stale` (section 9.5). Pages with status `fresh` are untouched.
2. For each `stale`, `dirty`, or `unverifiable` page: read the page, read the changed files that
   its `covers` matched, and decide per claim whether it still holds. Update what changed. A page
   whose claims all still hold is re-verified without edits.
3. New behaviour with no covering page: append to the closest page, or create a recipe when the
   change is a repeatable task shape. Never create a page under 15 lines.
4. Launch G2 on every edited page. Fix what it flags.
5. Set `verified` = HEAD sha and `updated` = today on every re-verified or edited page. Run
   `index` and `lint`.
6. Report a table: page, status before, action taken.

### S3 `lesson`

Records a non-obvious cause or decision at the moment it is learned. Description tells the agent
to invoke it right after fixing a bug whose cause was not visible in the code it edited, after
choosing between approaches for a reason a reader could not infer, or after discovering a
constraint imposed by something outside the repo.

Steps: draft the entry (symptom, cause, rule, evidence with commit or path:line, date); classify
as gotcha, decision, or convention; append to `gotchas.md`, the Decisions section of
`architecture.md`, or `conventions.md` respectively; if the rule has a clear path scope, append
one line to the matching `.claude/rules/<area>.md` (creating it when absent); bump `updated`,
keep `verified`; split `gotchas.md` by area when it passes the page budget; run `lint`. Shows
the entry before writing.

### S4 `kickoff <feature description>`

Produces a grounded plan for a feature and starts the branch.

1. Read `index.md`, then the pages whose `read_when` matches the feature. Read the recipe that
   matches the task shape, if one exists.
2. Write the plan (section 4.4). Scope is the complete feature. Touchpoints are ordered and
   name real files, confirmed to exist or explicitly marked new. Tests name the framework and
   location from `testing.md`. Docs impact lists the pages whose `covers` the touchpoints hit.
   Risks quote the gotchas that apply.
3. Derive the branch name (`feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, `test/` prefixes),
   show it, and create it from the default branch. `--no-branch` skips this step.
4. Report the plan path and the first touchpoint.

### S5 `preflight`

Runs the repository's checks and reports exactly what failed. Read-only. Executes inside G3
`check-runner` so full test output never enters the main context.

1. `checks resolve`: ordered list from `commands.md` `checks`, else from CI configuration, else
   from stack detection. The source is reported.
2. `checks run`: sequential, stop at first failure, per-check timeout from the check or config.
   Output logs land in the data directory; the result JSON carries the last 60 lines of a failure.
3. Report a table: check, status, duration. On failure: the exact tail, the log path, and a
   suggested fix when the cause is obvious. Never edits files, never skips a check, never
   continues past a failure unless `--continue` was given.

The result is written to `preflight/last.json` for `ship` to embed in the PR body.

### S6 `ship [branch-or-description] [--merge] [--draft] [--base <branch>] [--no-review]`

Turns the current work into a pull request. Every safety rule it states is also enforced by H2.

1. **Inventory.** Must be a git repo with uncommitted changes or commits ahead of the base.
   Detached HEAD, or nothing to ship, stops with a one-line message. Base branch: `--base`, else
   the resolved default branch.
2. **Branch.** On the default branch: derive a name from the argument or the diff, show it, create
   it. On a feature branch: stay.
3. **Preflight.** Invoke S5. A failure ends `ship` with the failure shown and an offer to fix.
4. **Docs impact.** Invoke S2 with `--scope diff`, which also reads the H3 session record so
   pages touched by edits committed earlier in the session are included. No wiki: skip with a
   one-line pointer to `onboard`. If the diff looks like a fix for a non-obvious cause and no
   gotcha was added this session, nudge once toward S3 without blocking.
5. **Review.** Invoke S9. Any `block` finding stops before commit with the list. `warn` findings
   go into the PR body under Risks. `--no-review` skips this step only.
6. **Plan.** If a plan with `branch` equal to the current branch exists, mark it `shipped` and
   build the planned-versus-delivered checklist from its touchpoints and tests.
7. **Commit.** Stage named files only, never `git add -A`. Exclude paths matching secret, local
   config, and build-output patterns and list the exclusions. Commit message follows the style
   of the last 30 commits: conventional (`type(scope): subject`) when at least 60 percent match,
   plain imperative otherwise. Show staged files and message, then commit.
8. **Push and PR.** Confirm, since this is outward-facing. Push with upstream set. Create the PR
   with `gh pr create`, body written to a temp file first. An open PR for the branch gets the
   push plus a comment carrying the new verification table instead of a second PR. Without `gh`,
   print the compare URL and the body path.
9. **Merge (opt-in).** With `--merge`: `gh pr checks --watch`, then squash-merge after a second
   confirmation, then delete the remote branch.
10. **Report.** PR URL and checks status.

PR body template:

```
## What
## Why
## How verified
| Check | Status | Duration |          (from preflight/last.json)
## Docs
Pages updated, pages re-verified, rules changed, lessons added, or "no wiki pages cover this change".
## Plan                                 (only when a plan exists)
- [x] touchpoint delivered   - [ ] touchpoint missing   - [ ] planned test absent
## Risks
Review warnings, plus anything the diff touches that gotchas.md mentions.
```

Never: force push, push to a protected branch, `--no-verify`, skip preflight, merge without
`--merge`.

### S7 `release <patch|minor|major|x.y.z> [--file <version file>]`

Cuts a version from the default branch.

1. Clean working tree required. Switch to the default branch, fetch, pull. Conflicts stop it.
2. Version source, first found: `--file`; `package.json`; `pyproject.toml`; `Cargo.toml`;
   `Directory.Build.props` then `*.csproj`; `version.txt`; otherwise tags only. Compute the new
   version.
3. Commits since the last tag (or root). None: stop.
4. Docs are a release checkpoint: run S2 with `--scope all` if `stale` reports anything.
5. CHANGELOG.md in Keep a Changelog form: `feat` to Added, `fix` to Fixed, everything else to
   Changed, written as user-facing sentences and grouped. Create the file if missing.
6. Bump the version file. Never `npm version`, which creates its own commit and tag.
7. Invoke S5. Failure stops the release before any commit.
8. Commit `release: vX.Y.Z`, tag `vX.Y.Z`. In a Claude Code plugin repository (a
   `.claude-plugin/plugin.json` at the root) the tag is created with `claude plugin tag` instead,
   which produces `<name>--vX.Y.Z` and checks that the plugin and marketplace manifests agree;
   the plain `vX.Y.Z` form is used when that CLI is absent.
9. Publish, after confirmation. Detect branch protection with `gh api` on the default branch.
   Unprotected: push the branch, then push the tag as a separate command. Protected: move the
   release commit to `release/vX.Y.Z`, reset the default branch to origin, push the release branch,
   open a PR, watch checks, squash-merge, pull, re-create the tag on the merged commit, push it.
10. GitHub release: if a tag-triggered release workflow exists, wait for it and then replace its
    notes with the changelog section using `gh release edit`. Otherwise `gh release create` with
    the changelog section as notes file. Without `gh`, print the commands.
11. Report version, tag, release URL.

### S8 `health [--fix <codes>|safe]`

Maintenance audit with optional fixes. Records `lastRun` in `health.json`.

Fan-out on G5 `health-auditor`, one per area, using only tools already installed (never installs
anything):

| Area | Signals |
|---|---|
| Dependencies | outdated by major and minor; vulnerable via `npm audit --json`, `dotnet list package --vulnerable`, `pip-audit`, `cargo audit`, `govulncheck` when present |
| Tests | skipped or ignored tests with locations; slow checks from the last preflight; flaky markers |
| Docs | `stale` output, `lint` output, pages over budget, recipes no plan or PR referenced in 90 days |
| Hygiene | TODO, FIXME, HACK older than 90 days by blame; tracked files over 1 MB |
| CI | failing workflows among the last ten runs via `gh run list --json` |
| Plans | active plans whose branch is merged or gone for 30 days |

Output: one table, findings coded F1..Fn: area, finding, why it matters, fix effort (S, M, L),
fix action. Then, with `--fix`: each chosen fix is applied, S5 runs, and on failure the touched
files are reverted with the failure shown. `safe` = patch and minor dependency bumps with lockfile
update, docs sync, plan archiving. Ends by suggesting `ship`.

### S9 `review [--base <branch>]`

Reviews the diff against this repository's own documented rules, not generic best practice.
Runs G4 `rules-reviewer` with the diff (base to HEAD plus working tree, chunked per file above
4,000 lines), `conventions.md`, `gotchas.md`, the Decisions section of `architecture.md`, and
the matching recipe. Findings: severity `block` (violates a documented gotcha or rule), `warn`
(deviates from a convention or a recipe step), `nit`; each with file, line, the quoted rule and
its page, and a fix. Standalone it prints them coded R1..Rn. Inside `ship` it gates the commit.

## 7. Subagents

Each agent file pins a model and a tool list. G1, G2, and G5 are read-only. Prompts state the
input they receive and the exact output shape they must return.

| Code | Agent | Model | Tools | Contract |
|---|---|---|---|---|
| G1 | `repo-analyst` | haiku | Read, Glob, Grep | In: area name, `detect` and `footprints` JSON. Out: `{ area, facts: [{ claim, evidence: ["path:line"], confidence }], suggestedCovers: [], recipeCandidates: [{ task, files, steps }], openQuestions: [] }`. Facts without evidence are rejected. |
| G2 | `doc-verifier` | sonnet | Read, Glob, Grep | In: one page path. Out: `{ page, false: [{ line, claim, why, evidence }], unverifiable: [{ line, claim }] }`. Checks every path, command, name, and behavioural claim against the code. |
| G3 | `check-runner` | sonnet | Bash, Read | Hosts S5 as a forked context. Runs `checks run`, reads failure tails and logs, returns the result table plus a diagnosis of the first failure. Never edits. |
| G4 | `rules-reviewer` | opus | Read, Glob, Grep | In: path of a diff file the caller wrote to the data directory, plus the rule pages. Out: findings as in S9. Must quote the rule it cites; a finding without a quoted rule from a page is downgraded to `nit`. |
| G5 | `health-auditor` | sonnet | Read, Glob, Grep, Bash | In: area. Out: `{ area, findings: [{ finding, why, effort, fix, evidence }] }`. Uses only installed tools; reports a tool as missing rather than installing it. |

Model choice: mechanical fan-out on haiku, judgement with a clear rubric on sonnet, adversarial
reading of a diff against rules on opus. Agent `tools` lists can only include or exclude whole
tools, never restrict Bash to certain commands, so any agent that needs no shell gets none (D19).
Each agent sets `maxTurns` as a cost ceiling. The main session assembles results; agents never
write into the repository except G3's log files in the data directory.

## 8. Hooks

All hooks are `node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-<name>.mjs"`, read the event JSON from
stdin, exit 0 on every error path, print nothing when they have nothing to say, and store state
only under the data directory. Timeouts are ceilings for a broken environment, not budgets.

Output contracts used, all documented: SessionStart and UserPromptSubmit add plain stdout to the
model's context on exit 0; PreToolUse decides through
`hookSpecificOutput.permissionDecision` with a `permissionDecisionReason`; PostToolUse stdout is
not shown to the model, so H3 only records; SessionEnd output is not honoured, so H4 only cleans
up. No hook uses `continue`, `stopReason`, or `suppressOutput`, which are not in the current
docs.

| Code | Event | Matcher | Timeout | Budget |
|---|---|---|---|---|
| H1 | SessionStart | `startup|resume|clear|compact|fork` | 10 s | under 1.5 s on a 30-page wiki |
| H2 | PreToolUse | `Bash` | 5 s | no git call unless the command contains `git push` or `git add` |
| H3 | PostToolUse | `Edit|Write|MultiEdit|NotebookEdit` | 5 s | no git call after the first per session; under 150 ms median |
| H4 | SessionEnd | (all) | 5 s | one directory prune, inside the shared 1.5 s SessionEnd budget |
| H5 | UserPromptSubmit | (all) | 5 s | one state-file read; under 100 ms median |

### H1 `session-start`

Prints at most four short lines as context for the model, capped at 600 characters:

```
ship-faster: wiki at docs/wiki/index.md (12 pages). Stale: 2 (commands, testing) → /ship-faster:sync-docs. Rules: .claude/rules (4 files).
ship-faster: active plan for branch feat/sso-login: docs/plans/2026-09-16-sso-login.md
ship-faster: health audit last ran 21 days ago → /ship-faster:health
```

Line one appears on every source, including `compact`, because that is when orientation is lost.
Lines two and three appear on `startup` and `resume`. When there is no wiki and no CLAUDE.md and
the repo has at least 20 tracked files, `startup` prints one line suggesting `onboard`. Otherwise
silent.

### H2 `ship-guard`

Parses the Bash command into segments on `&&`, `||`, `;`, `|`, and newlines, tokenising with
quote awareness. Applies these rules to each segment:

| Rule | Condition | Default |
|---|---|---|
| forcePush | `git push` with `-f`, `--force`, `--force-with-lease`, or `--force-if-includes`, targeting a protected branch by refspec or by being the current branch | deny |
| pushProtected | `git push` whose target branch is protected: explicit `origin main`, `HEAD:main`, or no refspec while the current branch is protected. Tag-only pushes are allowed | deny |
| noVerify | `git commit` with `--no-verify` or `-n`; `git push` or `git merge` with `--no-verify` (`push -n` is dry-run and allowed) | deny |
| addAll | `git add -A`, `--all`, `.`, `:/` when the staging would include a risky path: `.env*`, `*.pem`, `*.key`, `*.p12`, `*credentials*`, `*secret*`, `node_modules/`, `dist/`, `build/`, `*.log`, files over 5 MB. Checked with one `git status --porcelain` (2 s timeout; on timeout, allow). Clean staging is allowed | deny |

Protected branches: config, else `main` and `master`, plus the remote default branch resolved
once a day and cached. A deny reason names the alternative: "push the feature branch and open a
PR with /ship-faster:ship", or the list of risky paths and "stage files by name". Non-git commands
exit silently. Parse failure exits silently, because a guard that blocks unrelated commands is
worse than one that misses an edge case.

### H3 `drift-marker`

On each file edit: resolve the edited path against the repository root (resolved once per session
and cached), skip paths inside the wiki, plans, or rules directories, load `wiki-cache.json`
(rebuilt when any page mtime changed), match the path against every page's `covers`, and record
the hit in the session file as `{ page: { files: [...], reported: false } }`. It prints nothing:
PostToolUse output does not reach the model, and the only documented feedback channel for that
event is a `block` decision, which would wrongly signal a failed edit. `sync-docs --scope diff`
and `ship` read the session file so pages touched by already-committed edits are still
re-verified.

### H5 `prompt-report`

On each prompt, reads the session file and, for pages recorded by H3 but not yet reported, prints
one line and marks them reported:

```
ship-faster: edits this session touched files covered by docs/wiki/recipes/add-endpoint.md and docs/wiki/testing.md, not yet re-verified. If the changes alter what those pages claim, update them or run /ship-faster:sync-docs before shipping.
```

Each page is reported once per session, the line is capped at 400 characters (dropping page names
from the end and adding "and N more"), and the hook is silent when there is nothing new. The
nudge therefore lands at the start of the next instruction rather than mid-edit, which is where a
"before you ship" reminder belongs.

### H4 `session-end`

Deletes the session's state file and prunes session files older than seven days. Nothing else.
All SessionEnd hooks share a 1.5 s budget by default, so the prune touches only the plugin's own
directory and stops early when it runs long.

## 9. Scripts

All scripts: ESM, Node 20+, zero dependencies, `--json` output for skill consumption and a
one-line human summary otherwise. A script exits 0 whenever it produced a JSON document, and that
document carries `ok: true|false` plus `error` when false, so a skill reads the outcome from the
JSON rather than the exit code. Exit is non-zero only when no JSON could be produced. `lint` is
the one exception: it exits 1 on any lint error so it can gate CI directly. Paths are handled for
Windows and POSIX. Git is invoked through one helper with a timeout on every call.

### 9.1 `lib/fm.mjs` frontmatter

Parses and serialises the YAML subset used by pages, plans, and rules files: string, number,
date, and boolean scalars; inline lists `[a, "b c"]`; block lists of scalars; block lists of flat
maps (for `checks`). Anything outside the subset is a lint error with the line number. Round-trips
without reordering keys.

### 9.2 `lib/glob.mjs`

Matches gitignore-style globs: `**`, `*`, `?`, `{a,b}`, a leading `/` anchoring to root, a
trailing `/` meaning directory. Compiled once per pattern and cached.

### 9.3 `detect.mjs`

Emits repository facts. Detection table:

| Stack | Signals | Default checks (typecheck, lint, test, build) |
|---|---|---|
| Node | `package.json`; package manager from lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`) | `tsc --noEmit` when `tsconfig*.json`; `lint`, `test`, `build` scripts when present |
| .NET | `*.sln`, `*.csproj`, `Directory.Build.props` | `dotnet build --no-restore`, `dotnet format --verify-no-changes` when configured, `dotnet test` |
| Python | `pyproject.toml`, `setup.py`, `requirements*.txt` | `mypy` or `pyright` when configured, `ruff check` when configured, `pytest` |
| Go | `go.mod`, `go.work` | `go vet ./...`, `golangci-lint run` when configured, `go test ./...`, `go build ./...` |
| Rust | `Cargo.toml` | `cargo check`, `cargo clippy` when configured, `cargo test` |
| Java or Kotlin | `pom.xml`, `build.gradle*` | `./gradlew check` or `mvn -q verify` |

Also emitted: git facts (default branch, HEAD, tracked file count, size class small under 300,
medium under 3,000, large otherwise), CI files with kind, package scripts, test frameworks,
lint tools, entry point candidates, top-level directories by file count, workspace packages, and
which generated artifacts already exist.

### 9.4 `footprints.mjs`

From the last 500 commits (`git log --name-only`), for commits touching 2 to 30 files: pairwise
co-change counts, union-find clustering on pairs with count at least 3 and Jaccard at least 0.3,
then per cluster the files, commit-subject keywords with conventional prefixes stripped, and three
sample subjects. Also directory hotspots (commits per top-level directory). Output capped at 20
clusters.

### 9.5 `stale.mjs`

For every page with frontmatter: `unverifiable` when the `verified` sha is not in history or is
`unverified`; otherwise `stale` when `git diff --name-only <verified> HEAD` (one call per distinct
sha) matches a `covers` glob; `dirty` when `git status --porcelain` shows an uncommitted change to a
covered file; `invalid` when frontmatter is missing or malformed; else `fresh`. Accepts
`--session <sid>` to merge the H3 record and `--changed <file>` lists. Output per page: status,
matched files (capped at 50), verified sha.

### 9.6 `index.mjs`

Rebuilds `index.md` from frontmatter: a table of page, read when, summary; recipes and packages in
their own tables; a header comment marking it generated. Stable ordering, no timestamps, so it
does not churn in diffs.

### 9.7 `lint.mjs`

Errors: missing required frontmatter (`index.md` exempt); page over `pageMaxLines`; CLAUDE.md over `claudeMdMaxLines`;
index over 80 lines; rules file over `rulesFileMaxLines`; relative markdown link to a missing file;
`covers` matching no tracked file; `checks[].run` empty; duplicate titles; frontmatter outside the
YAML subset; a line matching a secret pattern (`AKIA`, `sk-`, `ghp_`, `github_pat_`, `xox`,
`AIza`, `password=`, `token=`, JWT shape). Warnings: backticked path-like token that does not
exist; `npm run`, `pnpm`, or `yarn` script absent from `package.json`; `verified` sha not in
history. Exit 1 on any error.

### 9.8 `checks.mjs`

`resolve`: ordered checks from `commands.md`, else from CI (`run:` steps extracted from GitHub,
GitLab, and Azure pipeline files, single-line and block scalars; steps containing `${{`
expressions are excluded; deploy-like commands and step names are excluded; matrix jobs receive
no special handling), else from `detect`. Commands whose name or text matches deploy, publish,
release, or `push` are excluded and reported. `run`: sequential execution with per-check timeout,
logs to the data directory, JSON result with status (`pass`, `fail`, `timeout`, `skipped`), exit
code, duration, and the last 60 lines (4 KB cap) of a failure; stops at the first failure unless
`--continue`. Writes `preflight/last.json`.

### 9.9 `plan.mjs`

`find --branch <name>` returns the active plan for a branch. `stale` lists active plans whose
branch is merged into the default branch or no longer exists, older than 30 days. `set-status`
rewrites the frontmatter field.

### 9.10 Hook scripts

`hook-session-start.mjs`, `hook-ship-guard.mjs`, `hook-drift-marker.mjs`, `hook-prompt-report.mjs`,
`hook-session-end.mjs` as specified in section 8. Each wraps its whole body in a try/catch that
exits 0.

## 10. Failure behaviour

- Hooks never fail a session. Missing `git`, no repository, malformed input, unreadable state,
  unwritable data directory: all exit 0 silently. H2 denies only when a rule matches an
  unambiguous parse; ambiguity allows.
- Skills never proceed past a failed gate: preflight failure stops `ship` and `release`; a
  `block` review finding stops `ship` before commit; lint errors stop `onboard` and `sync-docs`
  from reporting success.
- Scripts report outcomes as JSON on stdout with `ok: true|false` and exit 0 whenever a JSON
  document was produced, so skill preprocessing never aborts; `lint` alone exits 1 on lint errors
  to gate CI (D20).
- Generated files are only ever written after being shown as a diff (CLAUDE.md) or a listing
  (pages), and the pre-onboard CLAUDE.md is backed up when uncommitted.
- Nothing leaves the machine from the plugin itself. Network use is limited to `gh` and package
  manager audit commands, invoked by skills, in view of the user.

## 11. Testing

`tests/run.mjs` on `node:test`, building temporary git repositories per suite:

- Frontmatter parser round-trips and rejects everything outside the subset.
- Glob matcher against a fixture table including `**`, braces, anchors, directory suffixes.
- `detect` on fixture repos for each stack and a monorepo.
- `footprints` on a synthetic history with known co-change clusters.
- `stale` for every status, including a rebased-away `verified` sha and uncommitted changes.
- `index` stability: two runs produce identical bytes.
- `lint` for every error and warning rule.
- `checks resolve` precedence and deploy exclusion; `checks run` with a passing, a failing, and a
  timing-out command.
- Hook scripts driven through stdin: H1 output shape and silence conditions; H2 for every rule
  including quoted separators, tag pushes, `push -n`, chained commands, and `git add -A` with
  and without risky untracked files; H3 recording and silence; H5 first report, silence on the
  second prompt, and the 400-character cap; H4 pruning.
- `plan` find, stale, and status rewrite.

`tests/validate.mjs`: manifests agree on name and version; every skill has valid frontmatter and
every file it references exists; every agent has a valid model and tool list; every hooks.json
command points at an existing script; templates exist.

`tests/bench.mjs`: median latency of H2 and H3 over 20 runs, printed, with the budget from
section 8 stated. Not a CI gate, because runner variance would make it flaky.

`claude plugin validate --strict .` is the official manifest, skill, and agent validator. It runs
locally before every commit of plugin files and in CI, where the workflow installs the Claude Code
CLI first.

**Eval suite** under `evals/`, run with `claude plugin eval .`. Unit tests cannot exercise a
SKILL.md; evals can. One case per skill: `evals/<skill>/prompt.md` (frontmatter `max_turns`,
`allowed_tools`, `scaffold_script` that builds a fixture repository) plus `graders/`: a
deterministic grader asserting the skill fired (`tool_used: Skill`) and an `llm` criteria grader
stating what a correct result looks like, for example "CLAUDE.md exists, is under 150 lines,
contains a Read next table, and every wiki page has covers and verified frontmatter". Evals spend
real model credit, so they are a manual and weekly-scheduled workflow with `--runs 1` locally and
the default of three runs on the schedule, never a PR gate. `claude plugin details ship-faster`
reports the plugin's projected per-session token cost; the README quotes that number and the
release checklist refreshes it.

CI runs `tests/validate.mjs`, `tests/run.mjs`, and `claude plugin validate --strict` on
ubuntu-latest and windows-latest for every pull request.

## 12. Distribution

`plugins/ship-faster/.claude-plugin/plugin.json`: name `ship-faster`, semver version,
description, author, homepage, repository, license MIT, keywords. Root
`.claude-plugin/marketplace.json`: marketplace name `ship-faster`, owner, one plugin entry with
`source: "./plugins/ship-faster"` and the same version. Install:

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

During development the marketplace is added from the local checkout path instead. The version is
bumped in both manifests in the same commit, `claude plugin validate --strict` checks they agree,
and the plugin releases itself with its own `release` skill, which tags with `claude plugin tag`.

README covers install, each skill in one paragraph, what is stored and where (including that
uninstalling deletes the data directory unless `--keep-data` is passed), failure behaviour, the
exact hook costs, and the projected token cost from `claude plugin details`. CHANGELOG follows
Keep a Changelog.

## 13. Build order

Dependencies dictate three focused implementation plans, each independently testable:

1. **Foundation.** Manifests, `lib/*`, `detect`, `footprints`, `stale`, `index`, `lint`,
   `checks`, `plan`, the five hooks, tests, validator, CI. Everything later consumes these.
2. **Knowledge.** S1 `onboard`, S2 `sync-docs`, S3 `lesson`, agents G1 and G2, templates, and the
   dogfood run of `onboard` on this repository.
3. **Shipping.** S4 `kickoff`, S5 `preflight`, S6 `ship`, S7 `release`, S8 `health`, S9 `review`,
   agents G3, G4, G5, README, CHANGELOG, and the plugin's first release cut with its own skill.

## 14. Decision log

| Code | Decision |
|---|---|
| D1 | Wiki at `docs/wiki/`, one topic per page, 200-line cap, `covers` globs plus `verified` sha, generated index |
| D2 | CLAUDE.md links pages by path in a task-to-page table and never `@imports` them |
| D3 | Monorepos get a 30-line per-package CLAUDE.md and a page per package |
| D4 | Stack-agnostic detection for Node, .NET, Python, Go, Rust, Java; the model does the semantics |
| D5 | The repo is a one-plugin marketplace: catalog at the root, plugin at `plugins/ship-faster/`, because a catalog entry pointing at `./` is undocumented |
| D6 | `ship --merge` is opt-in; merging is a separate decision from proposing |
| D7 | `release` is separate from `ship` and also gated by preflight |
| D8 | No MCP server, no bundled MCP configs, no LSP |
| D9 | No blocking Stop hook; ship time is the docs checkpoint |
| D10 | Skills only, no `commands/`; S2, S3, S5, S9 model-invocable, the rest slash-only |
| D11 | `kickoff` writes `docs/plans/<date>-<slug>.md` with the branch in frontmatter; `ship` consumes it |
| D12 | Plans are transient and never live in the wiki; `health` flags stale ones |
| D13 | Path-scoped rules in `.claude/rules/` carry area rules, 25 lines each, pointing at gotcha ids |
| D14 | Preflight execution is a deterministic script; the forked agent only interprets failures |
| D15 | Guard denies only on an unambiguous parse; ambiguity allows |
| D16 | Commands appear in CLAUDE.md only after passing when run; deploy-like commands are never run |
| D17 | The docs-drift nudge is delivered by a UserPromptSubmit hook on the next prompt; the PostToolUse hook only records, because its output never reaches the model |
| D18 | Guard defaults are `deny` or `allow`, never `ask`; `git add -A` is denied only when risky untracked paths would be staged |
| D19 | Agents that need no shell get no Bash tool; the reviewer reads the diff from a file because Bash cannot be pattern-restricted per agent |
| D20 | Scripts report outcomes in JSON with `ok`, exiting 0, so skill preprocessing never aborts; `lint` alone exits non-zero to gate CI |
