---
name: onboard
description: Generate a router CLAUDE.md, a verified wiki under docs/wiki, and path-scoped rules for the current repository by analysing it, running its commands, and verifying every page against the code.
disable-model-invocation: true
argument-hint: "[--force]"
allowed-tools: Read, Glob, Grep, Write, Edit, Agent, Bash(node *), Bash(git *)
---

# Onboard this repository

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --json || true`

Arguments: $ARGUMENTS

Shorthands: `<wikiDir>` = `config.wikiDir`, `<rulesDir>` = `config.rulesDir`, `<head>` = `git.head`, `<dataDir>` = `dataDir`, all from the facts above. Templates live under `${CLAUDE_PLUGIN_ROOT}/templates/`. Read `${CLAUDE_SKILL_DIR}/reference/pages.md` before step 6 and `${CLAUDE_SKILL_DIR}/reference/report.md` before step 12. Work through the steps in order; do not skip the verification steps to save time.

## 1. Preconditions

- `existing.wiki` is true and the arguments do not contain `--force`: stop. Say the wiki exists, that `/ship-faster:sync-docs` refreshes it, and that `--force` regenerates everything.
- `git.isRepo` is false: continue with reduced features: skip step 3, write `verified: unverified` on every page, and omit durations.
- `git.trackedFiles` under 20 and `existing.readme` false: ask the user for one paragraph describing the project. When you cannot ask (a non-interactive run), derive the paragraph from the manifests and say so in the report. Then follow the small-repository rule in reference/pages.md.

## 2. Existing CLAUDE.md

When `existing.claudeMd` is true:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" backup --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" sections --json
```

Classify every section that is not inside the managed block:

| Kind | Test | Destination |
|---|---|---|
| rule | imperative constraints (never, always, must, do not) | kept verbatim under `## Rules` |
| commands | commands, with or without descriptions | candidates for step 5; the section is removed once they are in `commands.md` |
| depth | explanations of architecture, layout, testing, history | moved into the matching page in step 6; the section is removed |
| stale | anything step 7 shows to be false | dropped and listed in the report |

Keep the classification for step 10 and the report. Do not edit CLAUDE.md yet.

## 3. Footprints

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/footprints.mjs" --json
```

Keep `clusters` and `hotspots`. A cluster with a clear task shape (its keywords and sample subjects describe one kind of change) becomes a recipe in step 6.

## 4. Analysis fan-out

Read `${CLAUDE_SKILL_DIR}/reference/areas.md`. Launch one `ship-faster:repo-analyst` agent per area, all in a single message so they run in parallel. Each prompt contains `area: <name>`, `brief: <the row's brief>`, `detect:` followed by the full detect JSON, and `footprints:` followed by the footprints JSON. When `git.sizeClass` is `large`, also launch one analyst per entry of `topDirs` with more than 50 files, brief "architecture and data flow of <dir> only".

Parse the JSON block each analyst returns; an analyst that returns no JSON block, or one that does not parse, becomes an open question for the report, and you continue with the rest. Drop any fact whose evidence path does not exist (check with Glob). Keep the `openQuestions` for the report.

## 5. Verify commands

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" resolve --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" run --continue --json
```

Every resolved check is executed; keep `status`, `durationMs`, and `log` per check. Commands the analysts found that are not checks (dev server, watch, migrate, generate) are listed with status `not run`. Deploy, publish, and release commands are never run and are listed with status `not run`. Only a command with status `pass` may appear as verified in `commands.md` or in CLAUDE.md. A failing check is still listed, with status `fail` and its log path, so a reader knows it exists.

The `checks:` frontmatter of `commands.md` lists the passing checks in run order; `timeout` is twice the measured duration in seconds, minimum 60. Its `setup:` frontmatter (same shape) lists the commands that install dependencies inside the project, taken from the Setup table (`npm ci`, `pnpm install --frozen-lockfile`, `uv sync`, `dotnet restore`); `checks.mjs setup` runs them in every worktree `kickoff --worktree` or `ship` creates. Leave `setup:` out when nothing needs installing or the only install writes outside the project, such as a bare `pip install`.

## 6. Draft pages

Follow `${CLAUDE_SKILL_DIR}/reference/pages.md`. For each page that has content, copy `${CLAUDE_PLUGIN_ROOT}/templates/pages/<page>.md`, replace every `{{placeholder}}`, delete the template comments, and write it to `<wikiDir>/<page>.md`. Set `verified: unverified` and `updated` to today; step 9 stamps the real sha. `covers` comes from the analysts' `suggestedCovers`, trimmed to globs that match tracked files.

Write one recipe per footprint cluster or analyst recipe candidate with a clear task shape to `<wikiDir>/recipes/<task>.md`, at most eight.

Monorepo (`workspaces` has two or more entries and `git.sizeClass` is not `small`): one `<wikiDir>/packages/<name>.md` per workspace from `templates/pages/package.md`, and in step 10 a per-package `CLAUDE.md` in each workspace directory from `templates/package-claude-md.md`, 30 lines maximum.

## 7. Verify pages

Launch one `ship-faster:doc-verifier` agent per page you wrote, all in one message. Prompt: `page: <path>`. For every `false` claim: fix it or delete it. For every `unverifiable` claim: delete it, or keep it under a final line `Unverified: <claim>` when a reader needs the pointer. One pass only.

Sections of an existing CLAUDE.md whose claims the verifier marks false are classified `stale` and dropped in step 10.

## 8. Rules files

For each area with at least one path-scoped rule (a `gotchas.md` entry or a `conventions.md` rule whose evidence names files under one directory), write `<rulesDir>/<area>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/rules-file.md`: `paths:` globs matching those files, one imperative line per rule pointing at the gotcha id or the page, 25 lines maximum. Never write a rules file without `paths`. Writing under `.claude/` can need the user's approval; when a Write is denied, save the drafts under `<dataDir>/rules-drafts/`, say so in the report, and ask the user to approve writing them.

## 9. Stamp and index

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" verify <every page written> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/index.mjs" --json
```

## 10. CLAUDE.md

Build the managed block from `${CLAUDE_PLUGIN_ROOT}/templates/claude-md.md`: the text between the two marker comments, placeholders replaced, comments deleted, within the budgets in reference/pages.md. Write it to `<dataDir>/claude-md-block.md`; if that directory is unwritable, write it to `<wikiDir>/.claude-md-block.tmp` and delete the file after the splice. Then:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" splice --block <that file> --name "<project name>" --dry-run --json
```

If a CLAUDE.md existed, show the old and the new file as a diff in your response. Then run the same command without `--dry-run`, followed by

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" workflow --json
```

which makes the Workflow section match the template word for word. Afterwards, with an existing file: remove the sections classified `commands`, `depth`, or `stale` in step 2 and keep the `rule` sections under `## Rules` verbatim. With a new file: put the rules found in an old `## Rules` section, plus at most five rules drawn from `gotchas.md`, under `## Rules` as imperative sentences.

Monorepos: write the per-package CLAUDE.md files now.

## 11. Lint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

Fix every error (a page over 200 lines, CLAUDE.md over 150, a `covers` glob matching no file, a link to a missing file, a credential-looking string, a rules file over 25 lines, an out-of-date index) and run lint again until `errors` is empty. Warnings go in the report.

## 12. Report

Follow `${CLAUDE_SKILL_DIR}/reference/report.md`.
