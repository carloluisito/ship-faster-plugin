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

## Keeping docs true
Pages under `{{wiki_dir}}/` carry `covers` globs and a `verified` commit; `/ship-faster:sync-docs` refreshes stale pages and `/ship-faster:ship` runs it before every PR.
Record non-obvious causes with `/ship-faster:lesson` right after learning them.
<!-- ship-faster:managed:end -->

## Rules
- {{imperative sentence, one per line; hand-written, preserved across regeneration}}
