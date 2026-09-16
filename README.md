# ship-faster

A Claude Code plugin that makes an agent effective in any repository within one session and
keeps it effective as the repository changes. Design: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md`.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

From a local checkout, add the marketplace by its absolute path instead of the GitHub slug.
Restart Claude Code after installing: hooks register at session start.

The plugin itself lives in [`plugins/ship-faster`](./plugins/ship-faster/README.md).

## What you get

`/ship-faster:onboard` writes a router `CLAUDE.md`, a verified wiki under `docs/wiki/`, and path-scoped rules under `.claude/rules/`. `/ship-faster:sync-docs` keeps the wiki true as the code changes, and `/ship-faster:lesson` records what was learned the moment it is learned. This repository is onboarded with its own plugin: read [`CLAUDE.md`](./CLAUDE.md) and [`docs/wiki/index.md`](./docs/wiki/index.md).

## Develop

```
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
claude plugin validate --strict plugins/ship-faster
```

## License

MIT
