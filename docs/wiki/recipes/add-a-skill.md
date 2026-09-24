---
title: Add a skill
summary: A new skill directory with validator-clean frontmatter, script calls through CLAUDE_PLUGIN_ROOT, and the eval case every skill needs.
read_when: You need to add a slash command or model-invocable skill to the plugin.
covers: [plugins/ship-faster/skills/**, plugins/ship-faster/evals/**, plugins/ship-faster/tests/validate.mjs]
verified: d8a378230d683ecc251a6a7e68bb27da4c3f49fd
updated: 2026-09-24
---
# Add a skill

## Steps
1. Create `plugins/ship-faster/skills/<name>/SKILL.md` with frontmatter `name` (equal to the directory), `description`, `when_to_use` (omit only with `disable-model-invocation: true`), and `allowed-tools`. Use only the fields in `SKILL_FIELDS` in `plugins/ship-faster/tests/validate.mjs`.
2. Inject repository facts with a preprocessing line ending in `|| true`, as `plugins/ship-faster/skills/lesson/SKILL.md:13` does.
3. Call scripts as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<script>.mjs" --json` and agents as `ship-faster:<agent>`; the validator fails on paths or names that do not exist.
4. Put long reference material in `plugins/ship-faster/skills/<name>/reference/` and point at it with `${CLAUDE_SKILL_DIR}/reference/<file>.md`, as `plugins/ship-faster/skills/ship/SKILL.md:25` does; the validator checks references in those files too. SKILL.md must stay at or under 500 lines and description plus when_to_use at or under 1536 characters.
5. To run the whole skill inside an agent, set `context: fork`, `agent: ship-faster:<agent>`, and `background: false`, as `plugins/ship-faster/skills/preflight/SKILL.md:7` does; the validator requires the agent to exist.
6. Create the eval case the validator requires: `plugins/ship-faster/evals/<name>/prompt.md` (frontmatter fields from `PROMPT_FIELDS`, non-empty body), at least one `graders/*.md` with a `type` of regex, tool_used, tool_order, file_exists, llm, or baseline, and, as every existing case has, `case.yaml` with `schema_version: "1.1"`, `name`, and a `scaffold_script`; when `case.yaml` exists the validator requires the first two and that the scaffold script exists. `.github/workflows/evals.yml` picks the case up with no registration. Start `scaffold.sh` from an existing one so the fixture commits the `.gitignore` block that hides the eval harness's own files (`docs/wiki/gotchas.md` g-20260917-eval-home). Extra cases for a flag live in their own directory named `<skill>-<flag>`, with a unique `name` in `case.yaml`. A model-invocable skill that overlaps a common skill from elsewhere also gets a row in the Workflow section of `plugins/ship-faster/templates/claude-md.md` and, when the overlap is likely, a decoy in `plugins/ship-faster/evals/routing/scaffold.sh` with a grader in `evals/routing/graders/`.
7. Add a row to the Skills table in `plugins/ship-faster/README.md` and, for a user-facing skill, the Use table in `README.md`, plus an `[Unreleased]` entry in `plugins/ship-faster/CHANGELOG.md`.

## Files
| File | Change |
|---|---|
| `plugins/ship-faster/skills/<name>/SKILL.md` | new skill |
| `plugins/ship-faster/skills/<name>/reference/` | long procedures, when needed |
| `plugins/ship-faster/evals/<name>/` | prompt, case, scaffold, graders |
| `plugins/ship-faster/README.md` | Skills table |
| `README.md` | Use table |
| `plugins/ship-faster/CHANGELOG.md` | Unreleased entry |

## Test
Run `node plugins/ship-faster/tests/validate.mjs` and `claude plugin validate --strict plugins/ship-faster`. Save `scaffold.sh` without a BOM (`docs/wiki/gotchas.md` g-20260916-scaffold-bom).

## Docs
Add the skill to `docs/wiki/overview.md` (What it is), the Entry points table in `docs/wiki/layout.md`, and the data flow in `docs/wiki/architecture.md`.
