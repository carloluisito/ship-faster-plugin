---
title: Detect a stack
summary: Teach detect.mjs a new language or build tool, with its suggested checks, entry points, workspaces, and lockfile.
read_when: You need detect.mjs to recognise a stack, test framework, linter, or workspace layout it misses.
covers: [plugins/ship-faster/scripts/detect.mjs, plugins/ship-faster/scripts/footprints.mjs, plugins/ship-faster/tests/detect.test.mjs]
verified: c2b59ed7f81346348d2e95b0bb502271a89f0c65
updated: 2026-09-17
---
# Detect a stack

## Steps
1. In `detect()` in `plugins/ship-faster/scripts/detect.mjs`, add a block keyed on the manifest with `has('<manifest>')`, following the node, dotnet, python, go, rust, and java blocks.
2. Push `{ kind, manifests }` onto `stacks`, and names onto `testFrameworks`, `lintTools`, and `typecheck` as the manifest or config files show them.
3. Suggest checks with `push(name, run, timeout)`; the existing blocks give test commands a 900 s timeout and use the 600 s default otherwise.
4. Push entry point paths onto `entryPoints` and workspace members as `{ name, path, kind }` onto `workspaces`.
5. Add the stack's lockfile to `IGNORED` in `plugins/ship-faster/scripts/footprints.mjs` so it does not form co-change clusters.
6. Add a `CHANGELOG.md` entry.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/detect.mjs` | new stack block |
| `plugins/ship-faster/scripts/footprints.mjs` | lockfile in `IGNORED` |
| `plugins/ship-faster/tests/detect.test.mjs` | fixture case |

## Test
Add a case to `plugins/ship-faster/tests/detect.test.mjs` that builds a repository with `makeRepo({ files: { '<manifest>': '...' } })` and asserts on `detect(root).stacks`, `suggestedChecks`, and `workspaces`. Run `node --test plugins/ship-faster/tests/detect.test.mjs`.

## Docs
None in this wiki; detection output feeds onboard, whose steps live in `plugins/ship-faster/skills/onboard/SKILL.md`.
