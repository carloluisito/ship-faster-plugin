# Commit, PR body, push, merge

## Commit

1. Files to stage: every `dirty` path from the inventory except those in `excluded` (risky or over 5 MB). Print the exclusions with their `risky` reason. A deleted tracked file is staged by name too (`git add -- <path>` stages a deletion).
2. Stage by name, at most 20 paths per command: `git add -- <path> <path> ...`. Never `-A`, `--all`, `.`, or `:/`.
3. Message. `commitStyle.kind` `conventional`: `type(scope): subject` — type from feat, fix, chore, docs, test, refactor, perf, build, ci; scope optional; subject imperative, under 72 characters. `plain`: an imperative subject line under 72 characters. Body: one to three lines on why, when the subject cannot carry it. Write the message with the Write tool to `<dataDir>/ship/commit-msg.txt` (create the directory; if `<dataDir>` is unwritable use `.git/SHIP_COMMIT_MSG` inside the repository).
4. Show `git diff --cached --stat` and the message. Then `git commit -F <message file>`. Never `--no-verify`. A commit hook failure is reported as is; fix what it reports, do not bypass it.

## PR body

Copy `${CLAUDE_PLUGIN_ROOT}/templates/pr-body.md` and fill it:

- **What**, **Why**: from the diff and the subjects, in terms of behaviour.
- **How verified**: the table from `<dataDir>/preflight/last.json` (Read it): one row per check with `status` and `durationMs` in seconds, one decimal. When the file is missing, one row `preflight | not recorded | -` and say why.
- **Docs**: the sync-docs table (pages updated, re-verified, created), rules changed, lessons added; or `no wiki pages cover this change`.
- **Plan**: only when a plan exists: the checklist from step 6. Delete the section otherwise.
- **Risks**: the review's `warn` findings (rule and file), plus every `gotchas*.md` entry whose Evidence path appears in the diff (Grep the page for each changed path); or `none found`.

Write it to `<dataDir>/ship/pr-body.md` (same fallback as the commit message: `.git/SHIP_PR_BODY.md`). Print the body.

## Push and PR

1. No remote (`remote` null in the inventory): print `git remote add origin <url>` and the push command, and stop.
2. Ask the user: "Push <branch> to origin and open the PR against <base>?" On yes:
   - `git push -u origin <branch>` (never `--force`).
   - `gh --version` fails: print the compare URL `<remote url without .git>/compare/<base>...<branch>?expand=1` and the body path, and stop.
   - `gh pr view <branch> --json number,url,state` reports an open PR: push happened already; post the verification table as a comment: write the table to `<dataDir>/ship/pr-comment.md` and run `gh pr comment <number> --body-file <that file>`. Report the URL and stop.
   - Otherwise `gh pr create --base <base> --head <branch> --title "<commit subject>" --body-file <body path>`, plus `--draft` when the arguments contain it. Report the URL it prints.
3. In a non-interactive run print the exact commands above instead of asking, and stop.

## Merge

Only when the arguments contain `--merge`:

1. `gh pr checks <number> --watch --fail-fast`. A failing check stops here with its name.
2. Ask: "Squash-merge PR #<number> into <base> and delete the remote branch?" On yes: `gh pr merge <number> --squash --delete-branch`.
3. Report the merge commit and remind that the local branch can be deleted with `git branch -d <branch>` after `git switch <base>` and `git pull --ff-only`.
