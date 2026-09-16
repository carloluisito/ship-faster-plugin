---
title: Add a skill
summary: A new skill directory with validator-clean frontmatter, script calls through CLAUDE_PLUGIN_ROOT, and the eval case every skill needs.
read_when: You need to add a slash command or model-invocable skill to the plugin.
covers: [plugins/ship-faster/skills/**, plugins/ship-faster/evals/**, plugins/ship-faster/tests/validate.mjs]
verified: 57442cc23c96f7b6c7a961a149cf9363f2a5540b
updated: 2026-09-16
---
# Add a skill

## Steps
1. Create `plugins/ship-faster/skills/<name>/SKILL.md` with frontmatter `name` (equal to the directory), `description`, `when_to_use` (omit only with `disable-model-invocation: true`), and `allowed-tools`. Use only the fields in `SKILL_FIELDS` in `plugins/ship-faster/tests/validate.mjs`.
2. Inject repository facts with a preprocessing line ending in `|| true`, as `plugins/ship-faster/skills/lesson/SKILL.md:13` does.
3. Call scripts as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<script>.mjs" --json` and agents as `ship-faster:<agent>`; the validator fails on paths or names that do not exist.
4. Put long reference material in `plugins/ship-faster/skills/<name>/reference/`, as onboard does; SKILL.md must stay at or under 500 lines and description plus when_to_use at or under 1536 characters.
5. Create the eval case the validator requires: `plugins/ship-faster/evals/<name>/prompt.md` (frontmatter fields from `PROMPT_FIELDS`, non-empty body), at least one `graders/*.md` with a `type` of regex, tool_used, tool_order, file_exists, llm, or baseline, and, as every existing case has, `case.yaml` with `schema_version: "1.1"`, `name`, and a `scaffold_script`; when `case.yaml` exists the validator requires the first two and that the scaffold script exists.
6. Add a row to the Skills table in `plugins/ship-faster/README.md` and an `[Unreleased]` entry in `plugins/ship-faster/CHANGELOG.md`.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/skills/<name>/SKILL.md` | new skill |
| `plugins/ship-faster/evals/<name>/` | prompt, case, scaffold, graders |
| `plugins/ship-faster/README.md` | Skills table |
| `plugins/ship-faster/CHANGELOG.md` | Unreleased entry |

## Test
Run `node plugins/ship-faster/tests/validate.mjs` and `claude plugin validate --strict plugins/ship-faster`. Save `scaffold.sh` without a BOM (`docs/wiki/gotchas.md` g-20260916-scaffold-bom).

## Docs
Add the skill to `docs/wiki/overview.md` (What it is) and the Entry points table in `docs/wiki/layout.md`.
