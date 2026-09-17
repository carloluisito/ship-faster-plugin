---
paths: ["plugins/ship-faster/scripts/**", "plugins/ship-faster/hooks/hooks.json"]
---
# Scripts rules
- Use Node built-ins only; add no npm dependency. (docs/wiki/conventions.md)
- Run git only through `git()` in `scripts/lib/git.mjs`, with a timeout. (docs/wiki/conventions.md)
- Read hook input only through `readStdinJson`. (docs/wiki/gotchas.md g-20260916-stdin-release)
- End a hook with `main().catch(() => {}).finally(() => { process.exitCode = 0; })` and print nothing when there is nothing to say. (docs/wiki/conventions.md)
- Write JSON state only through `writeJsonAtomic` and check its result. (docs/wiki/gotchas.md g-20260916-windows-rename)
- Run a script's CLI only when `process.argv[1]` ends with its own path, so it can be imported. (docs/wiki/conventions.md)
- Exempt a `--tags` push from the protected-branch check only when it names no refspec. (docs/wiki/gotchas.md g-20260916-push-tags)
- Re-run `node plugins/ship-faster/tests/bench.mjs` after changing a hook or `stale.mjs`. (docs/wiki/architecture.md)
- Resolve plugin state only through `dataDir()` and `checkoutDir()` in `scripts/lib/state.mjs`; never build a `plugins/data` path by hand. (docs/wiki/gotchas.md g-20260917-plugin-data-dir)
