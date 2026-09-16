---
title: Conventions
summary: Zero-dependency ESM scripts with a JSON output contract, silent hooks, bounded git calls, and validator-enforced plugin files.
read_when: You are writing or reviewing code and need the naming, error handling, or style rules this repository actually follows.
covers: [plugins/ship-faster/scripts/**, plugins/ship-faster/skills/*/SKILL.md, plugins/ship-faster/tests/validate.mjs, .gitattributes]
verified: 5a02df2ff9fc60e125f40384fd2cb83945d97276
updated: 2026-09-16
---
# Conventions

## Follow
- Use Node built-ins only and add no npm dependency. Example: `plugins/ship-faster/scripts/lib/git.mjs:1`
- Write ES modules with the `.mjs` extension. Example: `plugins/ship-faster/scripts/stale.mjs:1`
- Export the logic as a function and run the CLI only when `process.argv[1]` ends with the script's own path, so tests and other scripts can import it. Example: `plugins/ship-faster/scripts/stale.mjs:153`
- Return a result object with `ok` and a `summary` list from the function passed to `runMain`; `emit` prints JSON with `--json` and exits 0, otherwise prints the summary and exits 1 when `ok` is false. Example: `plugins/ship-faster/scripts/lib/cli.mjs:60`
- Report failure as `{ ok: false, error }`; `runMain` turns a thrown error into the same shape. Example: `plugins/ship-faster/scripts/checks.mjs:175`
- Take a script's subcommand as the first positional argument and answer an unknown one with `{ ok: false, error: 'unknown command …' }`. Example: `plugins/ship-faster/scripts/health.mjs:116`
- Classify risky paths only with `riskyReason` and `isLarge` from `lib/risky.mjs`, which the guard, `changes.mjs`, and `review.mjs` share. Example: `plugins/ship-faster/scripts/lib/risky.mjs:14`
- In a hook, read input with `readStdinJson`, end with `main().catch(() => {}).finally(() => { process.exitCode = 0; })`, and print nothing when there is nothing to say. Example: `plugins/ship-faster/scripts/hook-drift-marker.mjs:39`
- Run git only through `git()` in `lib/git.mjs`, which sets a timeout, `GIT_TERMINAL_PROMPT=0`, and `GIT_OPTIONAL_LOCKS=0`. Example: `plugins/ship-faster/scripts/lib/git.mjs:4`
- Write JSON state with `writeJsonAtomic` (temp file, then rename). Example: `plugins/ship-faster/scripts/lib/state.mjs:36`
- Normalize paths to `/` separators with `normalizePath` before matching or storing them. Example: `plugins/ship-faster/scripts/lib/glob.mjs:3`
- Freeze default objects. Example: `plugins/ship-faster/scripts/lib/config.mjs:4`
- End every skill preprocessing command line (an exclamation mark followed by a backtick command) with `|| true`. Example: `plugins/ship-faster/skills/lesson/SKILL.md:13`
- In a skill, ask for the user's explicit yes before an outward-facing step (push, PR, merge, publish), and in a non-interactive run stop before it and print the commands. Example: `plugins/ship-faster/skills/ship/SKILL.md:21`
- Launch a skill's parallel agents all in one message. Example: `plugins/ship-faster/skills/review/SKILL.md:23`
- Use conventional commit subjects (`feat:`, `fix:`, `perf:`, `test:`, `chore:`, `docs:`) and stage files by name. Example: `docs/superpowers/plans/2026-09-16-foundation.md:25`

## Avoid
- Comments that restate code — the plan allows only one-line comments on non-obvious constraints (`docs/superpowers/plans/2026-09-16-foundation.md:24`). Instead: comment the why, as in `plugins/ship-faster/scripts/lib/cli.mjs:35`.
- Unbounded work in hooks — hook timeouts are 5 to 10 seconds and `plugins/ship-faster/tests/bench.mjs` budgets 100 to 1500 ms. Instead: pass `timeoutMs`, cache per working directory (`resolveRootCached`), and batch git reads.
- `ask` as a guard default — its behaviour under bypass-permissions mode is undocumented (`plugins/ship-faster/README.md:95`). Instead: default to `deny`.
- CRLF line endings — `.gitattributes` sets `eol=lf`. Instead: keep LF.

## Style
| Aspect | Rule | Enforced by |
|---|---|---|
| Test files | `<module>.test.mjs` in `plugins/ship-faster/tests/` | `plugins/ship-faster/tests/run.mjs` |
| Skill frontmatter | known fields only; `name` equals the directory; `description` and `allowed-tools` present; `when_to_use` unless `disable-model-invocation`; description plus when_to_use at most 1536 characters; SKILL.md at most 500 lines; `context` only `fork`, with `agent: ship-faster:<existing agent>`; `background` a boolean | `plugins/ship-faster/tests/validate.mjs` |
| Agent frontmatter | known fields; `model` is haiku, sonnet, opus, fable, inherit, or `claude-*`; `tools` a comma-separated string of known tools; positive integer `maxTurns` | `plugins/ship-faster/tests/validate.mjs` |
| Skill and agent references | `/ship-faster:<name>` names a skill from the spec list or an existing skill directory; bare `ship-faster:<name>` names an agent or skill | `plugins/ship-faster/tests/validate.mjs` |
| Hook registration | type `command`, command references an existing `${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs`, numeric timeout | `plugins/ship-faster/tests/validate.mjs` |
| Versions | semver, identical in `plugin.json` and `marketplace.json` | `plugins/ship-faster/tests/validate.mjs` |
| Lint and format | no linter or formatter configured | review |
