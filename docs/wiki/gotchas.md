---
title: Gotchas
summary: Hook stdin hangs, Windows renames, BOM shebangs, long-history staleness, tag pushes, and test state leaks, with evidence.
read_when: Something behaves in a way the code does not explain, or before touching the areas listed in covers.
covers: [plugins/ship-faster/scripts/lib/cli.mjs, plugins/ship-faster/scripts/lib/state.mjs, plugins/ship-faster/evals/*/scaffold.sh, plugins/ship-faster/scripts/stale.mjs, plugins/ship-faster/scripts/hook-ship-guard.mjs, plugins/ship-faster/tests/run.mjs]
verified: 7c2c6ba2f70b6f4b5563c9541b80449ff0fb7af6
updated: 2026-09-16
---
# Gotchas

### A hook prints its result and then hangs <!-- id: g-20260916-stdin-release -->
Symptom: A hook writes its output, then keeps running until Claude Code kills it at the hook timeout.
Cause: When the caller never closes the stdin pipe, a `process.stdin` still listening keeps the event loop alive after `readStdinJson` has resolved on its timeout.
Rule: Read hook input only through `readStdinJson` in `plugins/ship-faster/scripts/lib/cli.mjs`, which pauses, unhooks, and unrefs stdin before resolving.
Evidence: commit d7108c5, `plugins/ship-faster/scripts/lib/cli.mjs:37`, 2026-09-16.

### Renaming onto a state file fails on Windows <!-- id: g-20260916-windows-rename -->
Symptom: `renameSync` of a temp file onto an existing state file throws on Windows.
Cause: Windows refuses to rename over a file another process has open, and hooks from the same session can hold the same state file.
Rule: Write state only through `writeJsonAtomic`, which unlinks the target and retries the rename once, and check its boolean result.
Evidence: commit c280aab, `plugins/ship-faster/scripts/lib/state.mjs:47`, 2026-09-16.

### An eval scaffold with a BOM <!-- id: g-20260916-scaffold-bom -->
Symptom: `plugins/ship-faster/evals/onboard/scaffold.sh` began with a UTF-8 byte order mark before `#!/usr/bin/env bash`.
Cause: With a BOM, the first bytes of the file are not `#!`, so the shebang line is not recognised; some Windows editors and shells add the BOM on write.
Rule: Save every `evals/*/scaffold.sh` as UTF-8 without a BOM, with `#!/usr/bin/env bash` as the first bytes.
Evidence: commit 51c5c6d, 2026-09-16.

### Staleness loses the alongside rule on long histories <!-- id: g-20260916-log-limit -->
Symptom: A page committed together with the change it describes is reported stale.
Cause: When 2000 or more commits (`LOG_LIMIT`) separate the page's `verified` commit from HEAD, `stale.mjs` falls back to a plain `git diff`, which cannot skip commits that also touched the page.
Rule: Re-verify pages with `page.mjs verify` well before 2000 commits pass since their `verified` commit.
Evidence: `plugins/ship-faster/scripts/stale.mjs:10`, `plugins/ship-faster/scripts/stale.mjs:100`, 2026-09-16.

### A --tags push still pushes the named branch <!-- id: g-20260916-push-tags -->
Symptom: The guard allowed `git push origin main --tags`.
Cause: Any `--tags` was treated as a tag-only push, but a refspec given alongside `--tags` pushes that branch as well.
Rule: Exempt a `--tags` push from the protected-branch check only when it names no refspec, and keep the `--tags` cases in `plugins/ship-faster/tests/hook-ship-guard.test.mjs`.
Evidence: commit 7eb1c21, `plugins/ship-faster/scripts/hook-ship-guard.mjs:65`, 2026-09-16.

### A test run alone writes to the real plugin data directory <!-- id: g-20260916-plugin-data -->
Symptom: A test file run with `node --test` that reaches `lib/state.mjs` without setting `CLAUDE_PLUGIN_DATA` creates `projects/<hash>/` under `~/.claude/plugins/data/ship-faster/`.
Cause: `dataDir()` falls back to the user's Claude config directory when `CLAUDE_PLUGIN_DATA` is unset, and only `tests/run.mjs` sets it for the whole run.
Rule: In every test file that reaches `lib/state.mjs`, set `process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-')` in `beforeEach`.
Evidence: `plugins/ship-faster/scripts/lib/state.mjs:7`, `plugins/ship-faster/tests/run.mjs:14`, 2026-09-16.
