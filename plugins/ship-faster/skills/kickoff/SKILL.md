---
name: kickoff
description: Turn a feature description into a grounded plan (goal, complete scope, ordered touchpoints naming real files, tests to add, docs impact, risks quoting gotchas, verification commands) written under docs/plans/, and start the branch for it.
disable-model-invocation: true
argument-hint: "<feature description> [--no-branch|--worktree]"
allowed-tools: Read, Glob, Grep, Write, Bash(node *), Bash(git *)
---

# Kickoff

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

`<wikiDir>` = `config.wikiDir`, `<plansDir>` = `config.plansDir`, `<default>` = `git.defaultBranch`. The feature description is every argument except `--no-branch` and `--worktree`. `--worktree` puts the branch in its own checkout next to this one, with its dependencies installed, so a second session can work on it while this one continues; `--no-branch` and `--worktree` together contradict each other: stop with one line. With no description, ask for one; when you cannot ask, stop with one line saying what `kickoff` needs. Without a wiki (`existing.wiki` false), plan from the repository files alone and say in the report that the plan is ungrounded because the wiki does not exist yet.

## 1. Read what the repository already knows

Read `<wikiDir>/index.md`. Open every page whose `read_when` matches the feature, plus `layout.md`, `testing.md`, and `commands.md` when they exist, and the recipe whose task shape matches (a recipe named like the change: add an endpoint, add a migration, add a provider). Read the `gotchas.md` entries whose `covers` include the directories the feature will touch. Note the `checks` list in `commands.md`.

## 2. Draft the plan

Copy `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`, replace every placeholder, delete the comments, and follow these rules:

- **Goal**: one paragraph naming the outcome and how it is verified.
- **Scope**: the complete feature. Nothing deferred to later. Bullet what is out and why.
- **Touchpoints**: ordered. Every path exists (confirm each with Glob) or is marked `(new)`. One clause per path on what changes. Order follows the recipe when one applies.
- **Tests to add**: the framework and directory from `testing.md`, one bullet per behaviour.
- **Docs impact**: every page whose `covers` matches a touchpoint (read the `covers` in each page's frontmatter), with the claim that will change.
- **Risks**: quote the applicable gotchas by id and rule line; add integration and data risks you can name.
- **Verification**: the commands from the `checks` list, in order, plus the single test that proves the feature.

Frontmatter: `title`, `branch` (from step 3), `status: active`, `created` today, `pages` (the pages you read, as `name` or `recipes/<name>`). The file name is `<yyyy-mm-dd>-<slug>.md`, slug 2 to 5 lowercase words joined by hyphens. Hold the text; step 4 writes it where the branch lives.

## 3. Branch or worktree

Name: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, or `test/` plus the slug, chosen by the change's nature. Print it. When `<default>` is null (no git or no default branch) skip this step and say so.

With `--no-branch`: skip this step.

Without `--worktree`:

```
git rev-parse --verify --quiet <name>
```

If that succeeds the name is taken: append `-2`, `-3`, and so on. Then:

```
git switch -c <name> <default>
```

Uncommitted changes travel with the switch; do not stash or commit them.

With `--worktree`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree.mjs" add --branch <name> --from <default> --json
```

`ok: false` because the branch exists: append `-2`, `-3`, and so on and retry; any other `ok: false`: print the error and stop without writing the plan. Note `path` and `open`. The new checkout starts clean at `<default>`; uncommitted changes in this checkout stay here, and say so when `git status --porcelain` is not empty. Then install its dependencies, so the session opened there can run the checks at once:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" setup --root <path> --json
```

`passed: false`: keep going and write the plan, but note the failing command and its exit code for the report. `source: none`: nothing needed installing.

## 4. Write the plan and lint

Write the plan to `<plansDir>/<yyyy-mm-dd>-<slug>.md` in this checkout, or, with `--worktree`, to `<path>/<plansDir>/<yyyy-mm-dd>-<slug>.md` so the plan lives on its branch. Then:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

with `--root <path>` appended in the worktree case. Fix any error in the plan's frontmatter.

## 5. Report and show the plan

Put everything in your final message, in this order and nothing else:

1. Three lines: the plan path, the branch (or "no branch"), and the first touchpoint.
2. With `--worktree`, a fourth line: `Worktree: <path> (open it with: <first open command> then <second open command>)`, the two entries of `open` printed one after the other so that every shell accepts them; when the setup failed, a fifth line naming the command and its exit code.
3. The plan file in full, inside one fenced block, so the user reads it before starting.

Nothing after the plan: no summary, note, or offer. Do not split these across messages.
