# Drafting pages

## Budgets
- Page: 200 lines. Recipe: 60 lines. Index: generated, never edited by hand.
- CLAUDE.md: 150 lines; managed block 90 lines; What this is 3 lines; Stack 6 bullets; Layout 12 rows; Commands 12 rows; Read next one row per page and recipe.
- Rules file: 25 lines. Per-package CLAUDE.md: 30 lines.

## What goes where
| Page | Write it when | Source |
|---|---|---|
| overview | always | stack and architecture analysts, README |
| architecture | two or more components exist | architecture analyst |
| layout | always | layout analyst, `topDirs` |
| commands | always | step 5 results, stack analyst |
| conventions | any convention with an example path | conventions analyst |
| testing | a test framework or test directory exists | tests analyst |
| gotchas | at least one entry with symptom, cause, rule, and evidence in the analysts' facts or the old CLAUDE.md | any analyst |
| dependencies | a manifest declares dependencies | dependencies analyst |
| ops | CI, deploy, or release facts exist | ops analyst |
| recipes/<task> | a footprint cluster or recipe candidate with a clear task shape | footprints, analysts |
| packages/<name> | monorepo rule in SKILL.md step 6 | `workspaces` |

A page with no verified content is not written. Never pad a page to justify it.

## Frontmatter
- `title`: the template's title; the task name for a recipe; the package name for a package page.
- `summary`: one sentence under 120 characters, specific to this repository.
- `read_when`: one sentence starting with "You".
- `covers`: gitignore-style globs relative to the root, inline list, each matching at least one tracked file. Prefer the manifests, configs, and directories whose change would falsify the page. Never `**` alone.
- `verified`: `unverified` while drafting; step 9 stamps HEAD.
- `updated`: today, `yyyy-mm-dd`.
- `commands.md` also carries `checks:` (name, run, timeout) for every passing check, in run order, and `setup:` (same shape) for the install commands that stay inside the project, when there are any.

## Content rules
- Recipes beat prose. Every step names a file.
- A command appears only if it passed in step 5, with its measured duration. A failing check appears with status `fail` and its log path. Long-running, deploy, publish, and release commands appear with status `not run`.
- Paths, names, and numbers come from analyst evidence. No claim without a file behind it.
- Tables over paragraphs. No file trees. No restated code.
- Over budget: cut restated code first, then prose; never rules or steps. Split a recipe rather than shortening its steps.
- Secrets: names only, never values. A line that looks like a credential fails lint.

## Small repository (fewer than 20 tracked files and no README)
Write CLAUDE.md, overview, architecture (from the manifests and the user's paragraph), commands, conventions, and the index. Recipes arrive later through sync-docs.

## CLAUDE.md managed block
Six sections in this order, from `templates/claude-md.md`: What this is; Stack; Layout; Commands (verified <date> at <short sha>); Read next; Workflow. The Read next table has one row per page and recipe, phrased "When you need to…", pointing at a path. Copy Workflow as it stands, replacing only `{{wiki_dir}}`: it tells Claude to use the ship-faster skills over other installed skills with the same purpose, and `claude-md.mjs workflow` keeps it identical to the template. Never `@import` a page. Text outside the markers is preserved by the splice; `## Rules` holds imperative sentences only.
