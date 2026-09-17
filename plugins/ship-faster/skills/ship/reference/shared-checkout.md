# Shipping from a shared checkout

Other sessions have uncommitted work in this checkout, or may start editing again at any moment. Nothing below switches this checkout's branch, commits in it, or touches a path outside `<files>`.

## Create

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree.mjs" add --branch <name> --from HEAD --json
```

`ok: false` because the branch exists: append `-2`, `-3`, and so on and retry. Any other `ok: false`: print the error and stop. `path` is `<root>` from here on. The worktree starts at this checkout's HEAD commit; when the inventory's `branch` is not its `defaultBranch`, say that the new branch starts from `<branch>`, so the PR also carries that branch's commits until they merge.

## Setup

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" setup --root <root> --json
```

It installs dependencies from the `setup` list in `commands.md`, or from the lockfiles it recognises. `passed: false`: print the failing command, its exit code, and the last 20 lines of its `tail`, say that the worktree stays at `<root>` and is removed with `git worktree remove "<root>"` then `git branch -D <name>`, and stop. `source: none`: nothing needed installing.

## Carry

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree.mjs" carry <files...> --to <root> --json
```

It copies each file into `<root>`, and deletes there what was deleted here. `skipped` not empty: print each path with its reason and stop, so nothing ships half-carried.

A `both` file the user wants with only this session's hunks: after the carry, compare `git diff -- <file>` here with what this conversation changed, and Edit `<root>/<file>` so that it keeps only the hunks this session made. When you cannot tell the hunks apart, ask again whether to add the file whole or leave it out.

## Clear

Right after the commit in `<root>`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree.mjs" clear <files...> --from <root> --session <session> --json
```

- `cleared`: back to HEAD in this checkout, now that the commit in `<root>` holds them.
- `partial`: only this session's change was taken out; the other session's edits in the same file stay.
- `kept`: changed again after carrying, so it was left alone; say so, and that `git diff -- <path>` here shows what remains.
- `unchanged`: not part of the commit.

Print its summary lines.

## Follow-ups

Review feedback on the PR is fixed in `<root>`, not in this checkout: edit the files under `<root>`, then run `/ship-faster:ship --root <root>`, which commits on the same branch and pushes to the same PR.
