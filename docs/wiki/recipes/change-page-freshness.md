---
title: Change page freshness
summary: Change how stale.mjs classifies wiki pages, with the git helpers, fixture tests, and the SessionStart budget.
read_when: You need to change when a wiki page counts as fresh, stale, dirty, unverifiable, or invalid.
covers: [plugins/ship-faster/scripts/stale.mjs, plugins/ship-faster/scripts/lib/git.mjs, plugins/ship-faster/tests/stale.test.mjs, plugins/ship-faster/tests/git.test.mjs]
verified: 6a999ea3f5c0c5626dec4619b1d6676ddd8b8510
updated: 2026-09-16
---
# Change page freshness

## Steps
1. Find the status in the `classified` map in `plugins/ship-faster/scripts/stale.mjs`; checks run in order invalid, unverifiable, stale, dirty, fresh, and the first match wins.
2. Committed changes come from `changedSince(sha, pageRel)`: the batched history from `batchHistory` for three or more distinct verified shas, otherwise `git.commitsSince` per sha; `unionExcluding` drops commits that touched the page.
3. Uncommitted changes come from `git.dirtyFiles`, `--changed`, and session records; `editedAlongside` keeps a page with its own uncommitted edits from turning dirty.
4. Put any new git read in `plugins/ship-faster/scripts/lib/git.mjs` with a `timeoutMs`; `stale()` runs inside the SessionStart hook.
5. Update the staleness sentence in `plugins/ship-faster/README.md` ("A page is stale when…") and add a `CHANGELOG.md` entry.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/stale.mjs` | classification |
| `plugins/ship-faster/scripts/lib/git.mjs` | new git reads |
| `plugins/ship-faster/tests/stale.test.mjs` | fixture cases |
| `plugins/ship-faster/tests/git.test.mjs` | helper tests |
| `plugins/ship-faster/README.md` | staleness sentence |

## Test
Build histories with `makeRepo({ files, commits })` and pages with `serializeFrontmatter`, then assert on `stale(root, ...)` statuses in `plugins/ship-faster/tests/stale.test.mjs`. Cover both the per-sha path (one or two verified shas) and the batched path (three or more). Run `node --test plugins/ship-faster/tests/stale.test.mjs`, then `node plugins/ship-faster/tests/bench.mjs`; session start is budgeted at 1500 ms.

## Docs
Update the Freshness paragraph in `docs/wiki/architecture.md` and, if the long-history fallback changes, `g-20260916-log-limit` in `docs/wiki/gotchas.md`.
