---
name: release
description: Cut a version from the default branch: bump the version source, write the Keep a Changelog section from the commits since the last tag, re-stamp the wiki pages that cover the changed files, run preflight, commit "release: vX.Y.Z", tag it (claude plugin tag in a plugin repository), then publish with a GitHub release after confirmation.
disable-model-invocation: true
argument-hint: "<patch|minor|major|x.y.z> [--file <version file>] [--plugin <name>]"
allowed-tools: Read, Glob, Grep, Write, Edit, Skill, Agent, Bash(node *), Bash(git *), Bash(gh *), Bash(claude plugin *), Bash(claude --version)
---

# Release

Inventory:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/changes.mjs" --json || true`

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

The first argument is the bump: `patch`, `minor`, `major`, or an explicit `x.y.z`; nothing else is accepted. `--file` and `--plugin` pass through to the version script. `<default>` = `defaultBranch` from the inventory; `<dataDir>` = `dataDir` from the facts. Publishing (push, PR, GitHub release) is outward-facing and needs the user's explicit yes; in a non-interactive run stop before it and print the commands. Read `${CLAUDE_SKILL_DIR}/reference/publish.md` before step 10.

## 1. Clean tree on the default branch

`dirty` non-empty: stop with "release needs a clean working tree" and the list. `git switch <default>`. With a remote: `git fetch origin` then, when `upstream` is set, `git pull --ff-only`; a failure (diverged, conflict) stops the release with the git message.

## 2. Version source

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.mjs" detect --json
```

with `--file` or `--plugin` appended when given. `ok: false`: print the error and stop. Note `source.kind`, `source.current`, and `source.files`. A plugin repository (`source.kind` `plugin`) tags as `<name>--vX.Y.Z`; everything else tags as `vX.Y.Z`.

## 3. Commits since the last tag

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/changelog.mjs" since --json
```

Append `--match "<plugin name>--v*"` for a plugin repository. `commits` empty: stop with "nothing to release since <lastTag>".

## 4. Docs checkpoint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --json
```

Any page not `fresh`: invoke the `ship-faster:sync-docs` skill with `--scope all`. Its edits ship inside the release commit.

## 5. Changelog section

Compute the new version: `node "${CLAUDE_PLUGIN_ROOT}/scripts/version.mjs" detect --json` gave `current`; the target is `current` bumped by the argument (patch, minor, major, or the explicit value). Write the section with the Write tool to `<dataDir>/release/section.md` (when that directory cannot be written, a file under the system temp directory):

```
## [X.Y.Z] - <today yyyy-mm-dd>

### Added
- <one user-facing sentence per feat commit, grouped when several commits deliver one thing>

### Fixed
- <one sentence per fix commit>

### Changed
- <one sentence per other commit; breaking changes first, prefixed **Breaking:**>
```

Omit empty groups. Sentences describe what a user sees, not the commit subject; drop `chore` and `ci` commits that change nothing a user notices and say so in the report. Then:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/changelog.mjs" insert --section <that file> --json
```

For a plugin repository (`source.kind` is `plugin`) append `--file <plugin directory>/CHANGELOG.md` when that file exists, where the plugin directory is the one holding the `plugin.json` from `source.files`; the result's `path` is the changelog file from here on. `ok: false`: print the error and stop.

## 6. Bump

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.mjs" bump <argument> --json
```

with `--file` or `--plugin` when given. `ok: false`: revert the changelog edit (`git checkout -- <changelog path>`, or delete it when `created` was true) and stop. Note `from`, `to`, `files`, `tag`. Never run `npm version`.

## 7. Wiki pages covering the release

Without this step every page covering the version files or the changelog goes stale with the release commit.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --json
```

The release pages are the pages whose `status` is `dirty` and whose `changed` lists nothing but the version `files` and `<changelog path>`. A page stale or dirty for any other file is not one; it stays as step 4 left it.

When `from` is not null, Grep every page `stale.mjs` listed for `from` with its dots escaped; that also finds the previous tag. A mention giving `from` as the current or latest version is false after the bump: change it to `to`, or reword it so the page names no current version. A mention of history (a past release, the version something shipped in) stays.

Stamp the release pages and every `fresh` page you edited; with none of either, go on to step 8:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" verify <pages> --json
```

The bump and the changelog section are the only changes these pages cover, so no other claim needs rechecking. The stamp names the commit before the release; committed together with the release, the pages stay fresh. A page whose entry in `pages` has `ok: false` keeps its old stamp; name it in the report.

## 8. Preflight

Invoke the `ship-faster:preflight` skill. `Preflight: FAIL`: revert every file steps 4 to 7 changed (`git checkout -- <files>`; delete a <changelog path> that did not exist before), print the failure, and stop.

## 9. Commit and tag

Stage by name: the version `files`, `<changelog path>`, and every wiki file steps 4 and 7 changed (`git status --porcelain` lists them). Write the message `release: v<to>` to `<dataDir>/release/commit-msg.txt` (or a file under the system temp directory) and `git commit -F <file>`; when no file can be written, `git commit -F -` with the message on stdin. Tag:

- Plugin repository and `claude --version` succeeds: `claude plugin tag <plugin directory> -m "<name> %s"` where the plugin directory is the one holding the `plugin.json` from `source.files`.
- Otherwise: `git tag -a <tag> -m "<tag>"`.

`git tag -l <tag>` must now list it.

## 10. Publish

Follow reference/publish.md. Ask first; in a non-interactive run print the commands and stop.

## 11. GitHub release

Follow reference/publish.md, section GitHub release.

## 12. Report

Version, tag, the pages step 7 stamped and any it could not, release URL (or the commands still to run), and the commits that were left out of the changelog.
