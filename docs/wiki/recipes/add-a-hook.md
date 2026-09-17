---
title: Add a hook
summary: "A new hook script that reads Claude Code's JSON input, stays silent on error, is registered in hooks.json, and is tested and benchmarked."
read_when: You need to run plugin code on a Claude Code hook event.
covers: [plugins/ship-faster/hooks/hooks.json, plugins/ship-faster/scripts/hook-*.mjs, plugins/ship-faster/tests/bench.mjs, plugins/ship-faster/tests/validate.mjs]
verified: ddc228c8a5a56b6392321c6bf037c056f17793bb
updated: 2026-09-17
---
# Add a hook

## Steps
1. Create `plugins/ship-faster/scripts/hook-<name>.mjs` with an `async function main()` that starts `const input = await readStdinJson(1000); if (!input) return;` and resolves the root with `resolveRootCached(input.cwd)`, as `plugins/ship-faster/scripts/hook-prompt-report.mjs` does.
2. Print only when there is something to say. SessionStart and UserPromptSubmit print plain text; a PreToolUse decision prints `hookSpecificOutput` JSON, as `plugins/ship-faster/scripts/hook-ship-guard.mjs:156` does.
3. End with `main().catch(() => {}).finally(() => { process.exitCode = 0; });`. If tests must import functions from it, use the `process.argv[1]` entry guard instead, as `hook-ship-guard.mjs:159` does.
4. Keep git calls off the common path: `resolveRootCached` caches the root per working directory for a day, and every git call through `lib/git.mjs` takes a timeout.
5. Register it in `plugins/ship-faster/hooks/hooks.json` under the event: `{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-<name>.mjs\"", "timeout": 5 }`, inside a group with `matcher` when the event takes one.
6. Add a row to the Hooks table of `plugins/ship-faster/README.md` and to `rows` in `plugins/ship-faster/tests/bench.mjs` with a budget in ms.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/hook-<name>.mjs` | new hook |
| `plugins/ship-faster/hooks/hooks.json` | registration |
| `plugins/ship-faster/tests/hook-<name>.test.mjs` | new tests |
| `plugins/ship-faster/tests/bench.mjs` | latency row |
| `plugins/ship-faster/README.md` | Hooks table |

## Test
Drive the hook as a subprocess with `runScript('hook-<name>', [], { cwd: root, stdin: { session_id, cwd: root, ... }, env: { CLAUDE_PLUGIN_DATA } })`, and assert exit code 0 for garbage input, as `plugins/ship-faster/tests/hook-drift.test.mjs:108` does. Run `node plugins/ship-faster/tests/validate.mjs`, `node plugins/ship-faster/tests/run.mjs`, and `node plugins/ship-faster/tests/bench.mjs`.

## Docs
Add the hook to the Session hooks steps in `docs/wiki/architecture.md` and to the Entry points table in `docs/wiki/layout.md`.
