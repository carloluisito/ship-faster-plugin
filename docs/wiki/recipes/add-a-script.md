---
title: Add a script
summary: A new standalone script under plugins/ship-faster/scripts with the JSON output contract, a test, and docs.
read_when: You need to add a CLI script that skills or hooks call.
covers: [plugins/ship-faster/scripts/lib/cli.mjs, plugins/ship-faster/scripts/lib/root.mjs, plugins/ship-faster/tests/helpers.mjs, plugins/ship-faster/README.md]
verified: 7c2c6ba2f70b6f4b5563c9541b80449ff0fb7af6
updated: 2026-09-16
---
# Add a script

## Steps
1. Create `plugins/ship-faster/scripts/<name>.mjs`. Import `runMain` from `./lib/cli.mjs`, `resolveRoot` from `./lib/root.mjs`, `normalizePath` from `./lib/glob.mjs`, and `loadConfig` from `./lib/config.mjs` when you need config.
2. Export the logic as `export function <name>(root, options)` returning `{ ok: true, ..., summary: [...] }`, or `{ ok: false, error }` on failure. With subcommands, export one function per subcommand and dispatch on `positional[0]`, as `plugins/ship-faster/scripts/changelog.mjs:117` does.
3. Run git only through `./lib/git.mjs` and write state only through `./lib/state.mjs`.
4. End the file with the entry guard, as `plugins/ship-faster/scripts/stale.mjs:153` does: `if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/<name>.mjs')) runMain((positional, flags) => <name>(resolveRoot(flags), ...));`
5. When a skill calls it, write `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs" --json`; `plugins/ship-faster/tests/validate.mjs` fails when that path does not exist.
6. Add a line to the Scripts block of `plugins/ship-faster/README.md` and an entry under `[Unreleased]` in `plugins/ship-faster/CHANGELOG.md`.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/scripts/<name>.mjs` | new script |
| `plugins/ship-faster/tests/<name>.test.mjs` | new tests |
| `plugins/ship-faster/README.md` | Scripts block |
| `plugins/ship-faster/CHANGELOG.md` | Unreleased entry |

## Test
Create `plugins/ship-faster/tests/<name>.test.mjs`: build a fixture with `makeRepo`, call the exported function, and call the CLI with `runScript('<name>', ['--json'], { cwd: root })`, asserting on `json.ok`. Run `node --test plugins/ship-faster/tests/<name>.test.mjs`, then `node plugins/ship-faster/tests/run.mjs`.

## Docs
Add the script to the CLI scripts row in `docs/wiki/architecture.md`.
