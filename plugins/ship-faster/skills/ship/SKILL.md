---
name: ship
description: Turn the current work into a pull request: branch off a protected branch, run preflight, sync the docs the change touches, review against the repository's rules, check the plan, commit by name, then push and open the PR with a verification table in the body; squash-merge only with --merge.
disable-model-invocation: true
argument-hint: "[branch-or-description] [--merge] [--draft] [--base <branch>] [--no-review]"
allowed-tools: Read, Glob, Grep, Write, Edit, Skill, Agent, Bash(node *), Bash(git *), Bash(gh *)
---

# Ship

Inventory:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/changes.mjs" --json || true`

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

Rules that hold throughout: never force push, never push to a protected branch, never `--no-verify`, never `git add -A` or `git add .` (the ship-guard hook blocks these four), never skip preflight, never merge without `--merge`. Push, PR creation, and merge are outward-facing: each needs the user's explicit yes first. When nobody can answer (a non-interactive run), stop before that step and print the exact commands instead of running them.

`<dataDir>` = `dataDir` from the facts; `<wikiDir>` = `config.wikiDir`. Read `${CLAUDE_SKILL_DIR}/reference/commit-and-pr.md` before step 7.

## 1. Inventory

From the inventory JSON: `ok: false` (not a git repository) or `detached: true`: stop with one line. `hasWork: false`: print "nothing to ship: no uncommitted changes and no commits ahead of <base>" and stop. Base is the `--base` argument, else `base` from the inventory; with `--base`, re-run `node "${CLAUDE_PLUGIN_ROOT}/scripts/changes.mjs" --base <branch> --json` and use that output from here on.

## 2. Branch

`onProtected: true` (you are on the default branch or a protected branch): derive a branch name. From the argument when it looks like `type/slug`; from a description argument by slugifying it; otherwise from `dirty` paths and `subjects`. Prefix `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, or `test/` by the change's nature, then 2 to 5 lowercase words joined by hyphens. Print it, then `git switch -c <name>`; uncommitted changes travel along. On a feature branch: stay.

## 3. Preflight

Invoke the `ship-faster:preflight` skill with the Skill tool (it runs in its own agent and returns the report). When the report starts with `Preflight: FAIL`, print its failure block and diagnosis, offer to fix the cause, and stop. Never continue past a failed preflight.

## 4. Docs impact

`existing.wiki` false: print "no wiki: /ship-faster:onboard creates one" and continue. Otherwise invoke `ship-faster:sync-docs` with the arguments `--scope diff --since <base>`; keep its table for the PR body's Docs section. Then, when the change reads like a fix for a non-obvious cause (subjects mention fix, bug, race, timeout, retry, flaky, or the diff adds a comment explaining a trap) and neither `git diff --stat <base>...HEAD -- <wikiDir>` nor the working tree shows a change to `gotchas*.md`, print one line: "This looks like a fix for a non-obvious cause; `/ship-faster:lesson` records it so nobody hits it again." Do not block.

## 5. Review

Unless the arguments contain `--no-review`, invoke `ship-faster:review` with `--base <base>`. Any `block` finding: print the findings and stop before committing. Keep `warn` findings for the PR body's Risks section.

## 6. Plan

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" find --branch <current branch> --json
```

When `plan` is not null: read the plan file. Build the checklist: one `- [x]` per touchpoint whose path appears in `git diff --name-only <base>...HEAD` or in `dirty`, `- [ ]` otherwise; one `- [ ] planned test absent: <path>` per test file named under Tests to add that has no change. Then `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" set-status <plan rel> shipped --json` and include the plan file in the commit. `ok: false`: report it and leave the plan file out of the commit.

## 7. Commit

Follow reference/commit-and-pr.md, section Commit: stage by name, list exclusions, write the message in the repository's style, show the staged files and the message, then commit. With nothing uncommitted (only commits ahead), skip to step 8.

## 8. Push and PR

Follow reference/commit-and-pr.md, section PR body, then section Push and PR. Ask before pushing.

## 9. Merge (opt-in)

Only with `--merge`, following reference/commit-and-pr.md, section Merge. Ask again before merging.

## 10. Report

Three lines: the PR URL (or the compare URL and body path when there is no `gh`), the checks status, and what was not done (a step you stopped before, with the command to run).
