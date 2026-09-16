---
name: kickoff
description: Turn a feature description into a grounded plan (goal, complete scope, ordered touchpoints naming real files, tests to add, docs impact, risks quoting gotchas, verification commands) written under docs/plans/, and start the branch for it.
disable-model-invocation: true
argument-hint: "<feature description> [--no-branch]"
allowed-tools: Read, Glob, Grep, Write, Bash(node *), Bash(git *)
---

# Kickoff

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

`<wikiDir>` = `config.wikiDir`, `<plansDir>` = `config.plansDir`, `<default>` = `git.defaultBranch`. The feature description is every argument except `--no-branch`. With no description, ask for one; when you cannot ask, stop with one line saying what `kickoff` needs. Without a wiki (`existing.wiki` false), plan from the repository files alone and say in the report that the plan is ungrounded because the wiki does not exist yet.

## 1. Read what the repository already knows

Read `<wikiDir>/index.md`. Open every page whose `read_when` matches the feature, plus `layout.md`, `testing.md`, and `commands.md` when they exist, and the recipe whose task shape matches (a recipe named like the change: add an endpoint, add a migration, add a provider). Read the `gotchas.md` entries whose `covers` include the directories the feature will touch. Note the `checks` list in `commands.md`.

## 2. Write the plan

Copy `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`, replace every placeholder, delete the comments, and follow these rules:

- **Goal**: one paragraph naming the outcome and how it is verified.
- **Scope**: the complete feature. Nothing deferred to later. Bullet what is out and why.
- **Touchpoints**: ordered. Every path exists (confirm each with Glob) or is marked `(new)`. One clause per path on what changes. Order follows the recipe when one applies.
- **Tests to add**: the framework and directory from `testing.md`, one bullet per behaviour.
- **Docs impact**: every page whose `covers` matches a touchpoint (read the `covers` in each page's frontmatter), with the claim that will change.
- **Risks**: quote the applicable gotchas by id and rule line; add integration and data risks you can name.
- **Verification**: the commands from the `checks` list, in order, plus the single test that proves the feature.

Frontmatter: `title`, `branch` (from step 3), `status: active`, `created` today, `pages` (the pages you read, as `name` or `recipes/<name>`). Path: `<plansDir>/<yyyy-mm-dd>-<slug>.md`, slug 2 to 5 lowercase words joined by hyphens. Print the plan, then write it.

## 3. Branch

Name: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, or `test/` plus the slug, chosen by the change's nature. Print it. Unless the arguments contain `--no-branch`:

```
git rev-parse --verify --quiet <name>
```

If that succeeds the name is taken: append `-2`, `-3`, and so on. Then:

```
git switch -c <name> <default>
```

When `<default>` is null (no git or no default branch) skip the branch and say so. Uncommitted changes travel with the switch; do not stash or commit them.

## 4. Lint and report

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

Fix any error in the plan's frontmatter. Report three lines: the plan path, the branch (or "no branch"), and the first touchpoint.
