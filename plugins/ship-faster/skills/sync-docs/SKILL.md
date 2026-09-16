---
name: sync-docs
description: Bring stale wiki pages back to true by re-checking their claims against the code that changed, re-verify them at HEAD, and add coverage for new behaviour no page describes.
when_to_use: Use after changing behaviour that a docs/wiki page describes, before claiming a feature done, when session-start or a prompt note reports stale pages, or when the user asks to update, refresh, or verify the docs. Pass --scope diff when only the current branch's changes matter.
argument-hint: "[--scope all|diff|session] [--since <base-branch>]"
allowed-tools: Read, Glob, Grep, Write, Edit, Agent, Bash(node *), Bash(git *)
---

# Sync docs

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

`<wikiDir>` = `config.wikiDir`. `<base>` = the `--since` argument, else `git.defaultBranch`. No wiki (`existing.wiki` false): stop and say `/ship-faster:onboard` creates it.

## 1. Classify pages

Scope defaults to `all`.

| Scope | Run | Act on |
|---|---|---|
| `all` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --session all --json` | every page with `inScope: true` |
| `diff` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --session all --since <base> --json` | every page with `inScope: true` |
| `session` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --session all --json` | pages with status `dirty` |

If `since.error` is set, or `git.currentBranch` equals `<base>` (on the base branch there is no branch diff; committed changes there need the `all` rule), say so and use the `all` rule. Nothing to act on and `uncovered` empty: report "all pages fresh" with the counts and stop.

## 2. Re-verify each page in scope

Order: `invalid`, `unverifiable`, `stale`, `dirty`. For each page:

1. Read the page. Read the files in its `changed` list (up to 50). For an `unverifiable` page treat every claim as suspect and read the files its `covers` globs name.
2. Go claim by claim: paths, commands, names, numbers, behaviour. A claim that still holds stays. A claim that changed is rewritten to what the code does now. A claim about something that no longer exists is deleted.
3. `invalid` page: repair the frontmatter first. Required fields are `title`, `summary`, `read_when`, `covers`, `verified`, `updated`; `covers` is a non-empty inline list of globs that match tracked files.
4. Keep the page under 200 lines. Cut restated code before cutting rules or steps.
5. Record whether you edited the page or only confirmed it.

## 3. Cover new behaviour

`uncovered` lists changed files no page covers. Skip lockfiles, generated output, fixtures, and pure test data. For each remaining file decide:

- It belongs to an existing page's topic: add the claim to that page and extend its `covers` with a glob matching the file.
- It is a repeatable task shape (a new kind of handler, a migration, a provider adapter): create `<wikiDir>/recipes/<task>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/pages/recipe.md` with the ordered steps, the files, the test, and the docs page to update; `covers` = the files the recipe touches.
- Otherwise leave it and say so in the report.

Never create a page whose body is under 15 lines.

## 4. Verify the edits

For every page you edited or created, launch the `ship-faster:doc-verifier` agent once, all in one message so they run in parallel. Prompt: `page: <path>` and `changed: <the files you read>`. Fix every `false` claim it returns (rewrite or delete). For each `unverifiable` claim, delete it or move it under a final line `Unverified: ...` at the bottom of the page.

## 5. Stamp, index, lint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" verify <every page you edited, created, or confirmed> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/index.mjs" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

`page verify` sets `verified` to HEAD and `updated` to today. Fix every lint error and re-run lint until `errors` is empty.

## 6. Report

One table: page, status before, action (`confirmed`, `updated`, `created`, `frontmatter repaired`, or `left stale: <reason>`), then one line naming uncovered files you left alone. Never call a page true unless you read the changed files behind it.
