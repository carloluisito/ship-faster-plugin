---
title: Overview
summary: ship-faster is a Claude Code plugin that writes a router CLAUDE.md and a verified wiki, keeps them true, and ships changes through repo-aware skills.
read_when: You are new to the repository or need the domain vocabulary and system boundaries.
covers: [README.md, plugins/ship-faster/README.md, plugins/ship-faster/.claude-plugin/plugin.json, .claude-plugin/marketplace.json]
verified: f686438135832ac8b9d79670bbd0b0a81c1bde8d
updated: 2026-09-16
---
# Overview

## What it is
ship-faster is a Claude Code plugin that makes an agent effective in a repository within one session: it generates a router `CLAUDE.md`, a wiki under `docs/wiki/` whose pages declare the files they cover and the commit they were verified at, and path-scoped rules under `.claude/rules/`. A shipping workflow builds on that knowledge: checks come from `commands.md`, reviews cite the repository's own rules, and PR bodies carry the verification table. This repository is both the marketplace (`.claude-plugin/marketplace.json`) and the plugin (`plugins/ship-faster/`), version 0.1.0.

It ships nine skills: knowledge (`onboard`, `sync-docs`, `lesson`) and shipping (`kickoff`, `preflight`, `review`, `ship`, `release`, `health`); five agents (`repo-analyst`, `doc-verifier`, `check-runner`, `rules-reviewer`, `health-auditor`); five hooks; and the scripts they run. `preflight`, `review`, `sync-docs`, and `lesson` are model-invocable; the others are slash-only.

## Users
Claude Code users install it with `/plugin marketplace add carloluisito/ship-faster-plugin` and `/plugin install ship-faster@ship-faster`, then run the skills as slash commands; hooks run on their own after a restart. Claude is the main reader of what it generates. It needs `node` 20 or newer and `git` on PATH; `gh` is optional, and skills that need it print the equivalent URL or command when it is absent.

## Vocabulary
| Term | Meaning | Where it lives |
|---|---|---|
| page | wiki markdown file with `title`, `summary`, `read_when`, `covers`, `verified`, `updated` frontmatter | `plugins/ship-faster/scripts/lib/wiki.mjs` |
| covers | gitignore-style globs naming the files whose change can make a page false | `plugins/ship-faster/scripts/lib/glob.mjs` |
| verified | commit sha a page was last checked at, or `unverified` | `plugins/ship-faster/scripts/page.mjs` |
| fresh, stale, dirty, unverifiable, invalid | page freshness statuses | `plugins/ship-faster/scripts/stale.mjs` |
| managed block | the part of CLAUDE.md between the ship-faster markers that regeneration replaces | `plugins/ship-faster/scripts/claude-md.mjs` |
| check | a command preflight runs, listed under `checks` in `commands.md` or taken from CI | `plugins/ship-faster/scripts/checks.mjs` |
| plan | branch-scoped file under `docs/plans/` written by `kickoff`, with status `active`, `shipped`, or `abandoned` | `plugins/ship-faster/scripts/plan.mjs` |
| footprint | cluster of files that change together in git history | `plugins/ship-faster/scripts/footprints.mjs` |
| guard | PreToolUse hook that denies risky git commands | `plugins/ship-faster/scripts/hook-ship-guard.mjs` |
| lesson | gotcha, decision, or convention with symptom, cause, rule, and evidence | `plugins/ship-faster/skills/lesson/SKILL.md` |
| inventory | branch, base, ahead/behind, uncommitted files with risk flags, and commit style that `ship` and `release` start from | `plugins/ship-faster/scripts/changes.mjs` |
| finding | a coded result: `R1..Rn` from review (severity `block`, `warn`, `nit`), `F1..Fn` from health | `plugins/ship-faster/skills/review/SKILL.md`, `plugins/ship-faster/skills/health/SKILL.md` |
| version source | where a repository's version lives (plugin manifests, package manifests, project files, `version.txt`, or tags) | `plugins/ship-faster/scripts/version.mjs` |

## Boundaries
- Owns everything under `plugins/ship-faster/`: skills, agents, hooks, scripts, templates, evals, tests.
- Called by Claude Code, which runs the hooks registered in `plugins/ship-faster/hooks/hooks.json` and loads the skills and agents.
- Calls the `git` CLI (only through `plugins/ship-faster/scripts/lib/git.mjs`) and the target repository's check commands through a shell (`plugins/ship-faster/scripts/checks.mjs`); skills also run `gh`, `claude plugin tag`, and package-manager report commands.
- Writes into a target repository: `CLAUDE.md`, `docs/wiki/`, `.claude/rules/`, plans in `docs/plans/`, and on release `CHANGELOG.md` and the version files; skills create branches, commits, and tags.
- Writes its own state under the plugin data directory (`CLAUDE_PLUGIN_DATA`, else `~/.claude/plugins/data/ship-faster/`) through `plugins/ship-faster/scripts/lib/state.mjs`.
- Has no npm dependencies. The scripts make no network calls; network use is limited to `git push`, `gh`, and package-manager audit commands that skills run in view of the user, and push, PR, merge, and publish wait for the user's yes.
