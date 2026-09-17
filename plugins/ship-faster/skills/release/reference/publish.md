# Publish and GitHub release

## Branch protection

`gh --version` fails or `remote` is null: print the commands for the unprotected path below and stop.

```
gh api repos/{owner}/{repo}/branches/<default>/protection
```

Exit 0 means protected; a 404 (exit 1 with "Branch not protected") means unprotected. Any other failure: treat as protected, and say so.

## Unprotected

Ask: "Push <default> and the tag <tag> to origin?" On yes, two commands, in this order:

```
git push origin <default>
git push origin <tag>
```

## Protected

The release commit cannot land directly. Ask: "Open a release PR for <tag>?" Say in the same question that step 2 resets the local default branch to `origin/<default>`, discarding local commits on it that were never pushed (the reflog keeps them). On yes:

1. `git switch -c release/<version>` (the release commit moves with you).
2. `git branch -f <default> origin/<default>` (the default branch goes back to the remote).
3. `git push -u origin release/<version>`.
4. Write the PR body (`## Release <tag>` plus the changelog section) to `<dataDir>/release/pr-body.md` (or a file under the system temp directory); `gh pr create --base <default> --head release/<version> --title "release: v<version>" --body-file <that file>`.
5. `gh pr checks <number> --watch --fail-fast`; a failure stops here.
6. Ask again, then `gh pr merge <number> --squash --delete-branch`.
7. `git switch <default>`, `git pull --ff-only`.
8. The tag points at the pre-merge commit: `git tag -d <tag>`, then recreate it on the merged commit with the same command as step 8 of SKILL.md, then `git push origin <tag>`.

## GitHub release

Only after the push of step 9 happened. Ask: "Create the GitHub release <tag>?" On no, or in a non-interactive run, print the command for the branch below and stop.

Look for a workflow triggered by tags: Grep `.github/workflows/*.yml` for `tags:` under `push:`.

- One exists: wait for it: `gh run list --workflow <file> --branch <tag> --json status,conclusion,url -L 1` every 30 seconds for at most 15 minutes, until `status` is `completed`. Then replace its notes with the changelog section: `gh release edit <tag> --notes-file <dataDir>/release/section.md`.
- None: `gh release create <tag> --title "<tag>" --notes-file <dataDir>/release/section.md`.
- No `gh`: print both commands and stop.
