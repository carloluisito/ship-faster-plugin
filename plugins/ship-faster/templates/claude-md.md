# {{project_name}}

<!-- ship-faster:managed:start -->
## What this is
{{purpose: one sentence on what the software does}}
{{users: one sentence on who uses it}}
{{shape: one sentence on the shape of the system}}

## Stack
- {{language and version}}
- {{framework}}
- {{package manager}}
- {{database or storage}}
- {{infra or runtime}}
- {{anything unusual}}

## Layout
| Directory | Responsibility | Entry point |
|---|---|---|
| `{{dir}}/` | {{one clause}} | `{{file}}` |

## Commands (verified {{yyyy-mm-dd}} at {{short_sha}})
| Purpose | Command | Duration |
|---|---|---|
| {{purpose}} | `{{command}}` | {{n}}s |
| {{deploy or publish}} | `{{command}}` | not run |

## Read next
| When you need to… | Open |
|---|---|
| {{task or question}} | `{{wiki_dir}}/{{page}}.md` |
| {{task shape}} | `{{wiki_dir}}/recipes/{{task}}.md` |

`{{wiki_dir}}/index.md` lists every page.

## Workflow
In this repository the ship-faster skills below own these steps. Use them instead of any other installed skill or command for the same step (another preflight, verification, code-review, planning, or branch-finishing skill) unless the user names that other one.

| Step | Use |
|---|---|
| check that a change works, before saying it does or committing | `ship-faster:preflight` |
| review the branch against this repository's rules | `ship-faster:review` |
| update docs after changing behaviour a page describes | `ship-faster:sync-docs` |
| record a cause the code does not show, right after learning it | `ship-faster:lesson` |
| plan a feature | `/ship-faster:kickoff` |
| push and open a PR (runs preflight, sync-docs, and review first) | `/ship-faster:ship` |
| cut a release | `/ship-faster:release` |
| audit maintenance | `/ship-faster:health` |

Only the user can start a `/ship-faster:` command. When they ask for one of those steps, answer with the command for them to run (for a PR: "run `/ship-faster:ship`"; it also copes with a missing remote or `gh`) instead of pushing, running `gh pr create`, or using another skill for it, unless they tell you to do it directly.
Pages under `{{wiki_dir}}/` carry `covers` globs and a `verified` commit; sync-docs re-verifies the ones whose covered files changed.
<!-- ship-faster:managed:end -->

## Rules
- {{imperative sentence, one per line; hand-written, preserved across regeneration}}
