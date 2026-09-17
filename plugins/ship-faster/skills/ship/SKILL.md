---
name: ship
description: Turn this session's work into a pull request. When other sessions share the checkout, take only this session's changes and build the commit in a worktree of its own; run preflight, sync the docs the change touches, review against the repository's rules, check the plan, commit by name, then push and open the PR with a verification table in the body; squash-merge only with --merge.
disable-model-invocation: true
argument-hint: "[branch-or-description] [--include <paths>] [--here] [--root <worktree>] [--merge] [--draft] [--base <branch>] [--no-review]"
allowed-tools: Read, Glob, Grep, Write, Edit, Skill, Agent, Bash(node *), Bash(git *), Bash(gh *)
---

# Ship

Inventory:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/changes.mjs" --session "${CLAUDE_SESSION_ID}" --json || true`

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

Session: ${CLAUDE_SESSION_ID}

Rules that hold throughout: never force push, never push to a protected branch, never `--no-verify`, never `git add -A` or `git add .` (the ship-guard hook denies pushes to protected branches, `--no-verify`, and an add-all that would stage a risky file), never skip preflight, never merge without `--merge`. Push, PR creation, and merge are outward-facing: each needs the user's explicit yes first. `attended: false` in the facts means nobody can answer (`claude -p`, an eval, a hook-driven run): then never ask, stop before that step, and print the exact commands instead, in your final message.

`<dataDir>` = `dataDir` from the facts; `<wikiDir>` = `config.wikiDir`; `<session>` = the session id above. `<root>` is the checkout being shipped: this one, the worktree step 3 creates, or the `--root` argument. Whenever `<root>` is not this checkout, every plugin script gets `--root <root>`, every git command runs as `git -C <root>`, every skill you invoke gets `--root <root>` in its arguments, and files are read and edited under `<root>`. Read `${CLAUDE_SKILL_DIR}/reference/shared-checkout.md` before step 3 when `ownership.mode` is `shared` or `--root` is given, and `${CLAUDE_SKILL_DIR}/reference/commit-and-pr.md` before step 8.

## 1. Inventory

From the inventory JSON: `ok: false` (not a git repository) or `detached: true`: stop with one line. When the arguments contain `--base`, `--include`, `--here`, or `--root`, run the inventory again with those flags and use that output from here on:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/changes.mjs" --session "${CLAUDE_SESSION_ID}" --json
```

appending `--base <branch>`, `--include <paths>`, `--here`, and `--root <path>` as given. `hasWork: false`: print "nothing to ship: no uncommitted changes and no commits ahead of <base>" and stop. Base is the `--base` argument, else `base` from the inventory.

## 2. Whose changes

`ownership.mode` decides what ships; `ownership.reason` says why.

- `solo`: every path in `ownership.ship` (all uncommitted files except `excluded`). With `ownership.forced` (`--here` while other sessions use the checkout), say that their files ship too. `ownership.session` null means the session id was unavailable: say so.
- `shared`: other sessions use this checkout (`ownership.others`: branch, last activity, files they changed). `ownership.ship` holds this session's files plus the `--include` matches.
  - `ownership.leave` (changed only by other open sessions) stays out. Name each file with its session's branch.
  - `ownership.ask` lists files whose owner is `both` (this session and another open one changed it), `earlier` (only a session that ended, or has been idle for two hours, changed it), or `unclaimed` (no session's edits explain it, such as the output of a Bash command). Ask the user once, listing each file with its owner, which to add; a `both` file can be added whole or with only this session's hunks. With `attended: false` add none and list them.
  - Nothing to ship after that: print "nothing of this session's to ship", the files other sessions own, and the two ways to take them anyway (`--include <paths>`, `--here`), then stop. Commits ahead of the base do not count in shared mode, because the checkout's branch is not this session's to push.

The files that ship are `<files>` from here on.

## 3. Branch or worktree

- `--root <path>`: `<root>` = that path, a worktree an earlier `ship` created; its branch is the PR's branch, so stay on it. `onProtected: true` there: stop with "--root must point at a checkout on a feature branch".
- `solo`: `<root>` = this checkout. `onProtected: true` (you are on the default branch or a protected branch): derive a branch name. From the argument when it looks like `type/slug`; from a description argument by slugifying it; otherwise from `<files>` and `subjects`. Prefix `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, or `test/` by the change's nature, then 2 to 5 lowercase words joined by hyphens. Print it, then `git switch -c <name>`; uncommitted changes travel along. On a feature branch: stay.
- `shared`: derive the name the same way, then follow reference/shared-checkout.md, sections Create, Setup, and Carry. This checkout keeps its branch and every file you did not carry; `<root>` = the new worktree.

## 4. Preflight

Invoke the `ship-faster:preflight` skill with the Skill tool (it runs in its own agent and returns the report). When the report starts with `Preflight: FAIL`, print its failure block and diagnosis, offer to fix the cause, and stop. Never continue past a failed preflight.

## 5. Docs impact

`existing.wiki` false: print "no wiki: /ship-faster:onboard creates one" and continue. Otherwise invoke `ship-faster:sync-docs` with the arguments `--scope diff --since <base>`; keep its table for the PR body's Docs section. Then, when the change reads like a fix for a non-obvious cause (subjects mention fix, bug, race, timeout, retry, flaky, or the diff adds a comment explaining a trap) and neither `git diff --stat <base>...HEAD -- <wikiDir>` nor the working tree of `<root>` shows a change to `gotchas*.md`, print one line: "This looks like a fix for a non-obvious cause; `/ship-faster:lesson` records it so nobody hits it again." Do not block.

## 6. Review

Unless the arguments contain `--no-review`, invoke `ship-faster:review` with `--base <base>`. Any `block` finding: print the findings and stop before committing. Keep `warn` findings for the PR body's Risks section.

## 7. Plan

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" find --branch <branch of root> --json
```

When `plan` is not null: read the plan file. Build the checklist: one `- [x]` per touchpoint whose path appears in `git diff --name-only <base>...HEAD` or in `<files>`, `- [ ]` otherwise; one `- [ ] planned test absent: <path>` per test file named under Tests to add that has no change. Then `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" set-status <plan rel> shipped --json` and include the plan file in the commit. `ok: false`: report it and leave the plan file out of the commit.

## 8. Commit

Follow reference/commit-and-pr.md, section Commit. With nothing uncommitted in `<root>` (only commits ahead), skip to step 9. In shared mode, follow reference/shared-checkout.md, section Clear, right after the commit.

## 9. Push and PR

Follow reference/commit-and-pr.md, section PR body, then section Push and PR. Ask before pushing.

## 10. Merge (opt-in)

Only with `--merge`, following reference/commit-and-pr.md, section Merge. Ask again before merging.

## 11. Report

Three lines: the PR URL (or the compare URL and body path when there is no `gh`), the checks status, and what was not done (a step you stopped before, with the command to run). When no PR was created, the report also carries the PR body of step 9 in full, inside one fenced block, so the user can paste it. In shared mode add two lines: the files left for other sessions (or `none`), and `Worktree: <root> — fix review feedback there, then run /ship-faster:ship --root <root>`. When `<root>` is a worktree (the inventory's `worktree.isWorktree`, or shared mode): after a merge in step 10, the cleanup commands from reference/commit-and-pr.md, section Worktrees; otherwise `Worktree stays until the PR merges; then run the cleanup from the main checkout.` Never run those commands from inside the worktree.
