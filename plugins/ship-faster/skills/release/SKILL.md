---
name: release
description: Cut a version from the default branch: bump the version source, write the Keep a Changelog section from the commits since the last tag, run preflight, commit "release: vX.Y.Z", tag it (claude plugin tag in a plugin repository), then publish with a GitHub release after confirmation.
disable-model-invocation: true
argument-hint: "<patch|minor|major|x.y.z> [--file <version file>] [--plugin <name>]"
allowed-tools: Read, Glob, Grep, Write, Edit, Skill, Bash(node *), Bash(git *), Bash(gh *), Bash(claude plugin *), Bash(claude --version)
---

# Release

Inventory:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/changes.mjs" --json || true`

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

The first argument is the bump: `patch`, `minor`, `major`, or an explicit `x.y.z`; nothing else is accepted. `--file` and `--plugin` pass through to the version script. `<default>` = `defaultBranch` from the inventory; `<dataDir>` = `dataDir` from the facts. Publishing (push, PR, GitHub release) is outward-facing and needs the user's explicit yes; in a non-interactive run stop before it and print the commands. Read `${CLAUDE_SKILL_DIR}/reference/publish.md` before step 9.

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

Compute the new version: `node "${CLAUDE_PLUGIN_ROOT}/scripts/version.mjs" detect --json` gave `current`; the target is `current` bumped by the argument (patch, minor, major, or the explicit value). Write the section with the Write tool to `<dataDir>/release/section.md` (fallback `.git/RELEASE_SECTION.md`):

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

## 6. Bump

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.mjs" bump <argument> --json
```

with `--file` or `--plugin` when given. `ok: false`: revert the changelog edit (`git checkout -- CHANGELOG.md`, or delete it when `created` was true) and stop. Note `to`, `files`, `tag`. Never run `npm version`.

## 7. Preflight

Invoke the `ship-faster:preflight` skill. `Preflight: FAIL`: revert every file from step 5, 6, and 4 (`git checkout -- <files>`; delete a CHANGELOG.md that did not exist before), print the failure, and stop.

## 8. Commit and tag

Stage by name: the version `files`, `CHANGELOG.md`, and every wiki file step 4 changed (`git status --porcelain` lists them). Write the message `release: v<to>` to `<dataDir>/release/commit-msg.txt` and `git commit -F <file>`. Tag:

- Plugin repository and `claude --version` succeeds: `claude plugin tag <plugin directory> -m "<name> %s"` where the plugin directory is the one holding the `plugin.json` from `source.files`.
- Otherwise: `git tag -a <tag> -m "<tag>"`.

`git tag -l <tag>` must now list it.

## 9. Publish

Follow reference/publish.md. Ask first; in a non-interactive run print the commands and stop.

## 10. GitHub release

Follow reference/publish.md, section GitHub release.

## 11. Report

Version, tag, release URL (or the commands still to run), and the commits that were left out of the changelog.
