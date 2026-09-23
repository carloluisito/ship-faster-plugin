# Commit, PR body, push, merge

## Commit

1. Files to stage: `<files>` from step 2, plus every path that step 5 (docs) or step 7 (plan) changed in `<root>`; compare `git status --porcelain` in `<root>` with `<files>` to find those. Any other uncommitted path in `<root>` stays out and is listed; in a new worktree that is output of the setup install, and in this checkout it is another session's work. Print the inventory's `excluded` paths with their `risky` reason. A deleted tracked file is staged by name too (`git add -- <path>` stages a deletion).
2. Stage by name, at most 20 paths per command: `git add -- <path> <path> ...` (`git -C <root> add -- ...` when `<root>` is not this checkout). Never `-A`, `--all`, `.`, or `:/`.
3. Message. `commitStyle.kind` `conventional`: `type(scope): subject` — type from feat, fix, chore, docs, test, refactor, perf, build, ci; scope optional; subject imperative, under 72 characters. `plain`: an imperative subject line under 72 characters. Body: one to three lines on why, when the subject cannot carry it. Write the message with the Write tool to `<dataDir>/ship/commit-msg.txt` (create the directory; if `<dataDir>` is unwritable use a file under the system temp directory).
4. Show `git diff --cached --stat` and the message. Then `git commit -F <message file>`; when no file can be written anywhere, `git commit -F -` with the message on stdin. Both run in `<root>`. Never `--no-verify`. A commit hook failure is reported as is; fix what it reports, do not bypass it.

## PR body

Copy `${CLAUDE_PLUGIN_ROOT}/templates/pr-body.md` and fill it. Keep its first line, `<!-- opened-by: ship-faster -->`: the ship-guard hook tells Claude that a PR opened without it skipped this workflow.

- **What**, **Why**: from the diff and the subjects, in terms of behaviour.
- **How verified**: the table from the `Result file` the preflight report names (`<dataDir>/preflight/last.json` for this checkout; Read it): one row per check with `status` and `durationMs` in seconds, one decimal. When the file is missing, one row `preflight | not recorded | -` and say why.
- **Docs**: the sync-docs table (pages updated, re-verified, created), rules changed, lessons added; or `no wiki pages cover this change`.
- **Plan**: only when a plan exists: the checklist from step 6. Delete the section otherwise.
- **Risks**: the review's `warn` findings (rule and file), plus every `gotchas*.md` entry whose Evidence path appears in the diff (Grep the page for each changed path); or `none found`.

Write it to `<dataDir>/ship/pr-body.md` (same fallback as the commit message: a file under the system temp directory). Print the body in full; when no PR is created it is the only copy the user sees, so step 11 repeats it in the final message.

## Push and PR

1. No remote (`remote` null in the inventory): print `git remote add origin <url>` and the push command, and stop.
2. Ask the user: "Push <branch> to origin and open the PR against <base>?" On yes:
   - `git push -u origin <branch>` in `<root>` (never `--force`).
   - `gh --version` fails: print the compare URL `<remote url without .git>/compare/<base>...<branch>?expand=1` and the body path, and stop.
   - `gh pr view <branch> --json number,url,state` reports an open PR: push happened already; post the verification table as a comment: write the table to `<dataDir>/ship/pr-comment.md` and run `gh pr comment <number> --body-file <that file>`. Report the URL and stop.
   - Otherwise `gh pr create --base <base> --head <branch> --title "<commit subject>" --body-file <body path>`, plus `--draft` when the arguments contain it. Report the URL it prints.
3. With `attended: false` in the facts print the exact commands above in the final message instead of asking, and stop.

## Merge

Only when the arguments contain `--merge`:

1. `gh pr checks <number> --watch --fail-fast`. A failing check stops here with its name.
2. Ask: "Squash-merge PR #<number> into <base> and delete the remote branch?" On yes: `gh pr merge <number> --squash --delete-branch`.
3. Report the merge commit. When `<root>` is this checkout and not a worktree, remind that the local branch can be deleted with `git branch -D <branch>` (a squash merge leaves it unmerged in git's eyes) after `git switch <base>` and `git pull --ff-only`. When `<root>` is a worktree, print the commands from the Worktrees section instead; the plan marked shipped reaches the main checkout with the pull.

## Worktrees

`<root>` is a worktree when the inventory says `worktree.isWorktree` (then `<mainRoot>` = `worktree.mainRoot` and `<path>` = `worktree.path`) or when step 3 created it in shared mode (then `<mainRoot>` = this checkout and `<path>` = `<root>`). Print these commands for the user to run from the main checkout once the PR needs no more work (after the merge with `--merge`); do not run them, because a worktree cannot remove itself while a session sits in it, and another session may still use the main checkout:

```
git -C "<mainRoot>" pull --ff-only
git -C "<mainRoot>" worktree remove "<path>"
git -C "<mainRoot>" branch -D <branch>
```

Say that the pull is for when the main checkout is on `<base>`, that the second command refuses while the worktree has uncommitted changes, and that `-D` is needed because a squash merge leaves the branch's commits outside the base's history; `--delete-branch` in the merge step removes only the remote branch when the local one is checked out in a worktree.
