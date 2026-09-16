---
title: {{Feature title}}
branch: {{type}}/{{slug}}
status: active
created: {{yyyy-mm-dd}}
pages: [{{page}}, {{recipes/task}}]
---
# {{Feature title}}

## Goal
{{One paragraph: the outcome, who it is for, how you will know it works.}}

## Scope
{{The complete feature. Nothing deferred. Bullet what is in; bullet what is explicitly out and why.}}

## Touchpoints
<!-- Ordered. Every path confirmed to exist, or marked (new). -->
1. `{{path}}` — {{what changes}}
2. `{{path}}` (new) — {{what it holds}}

## Tests to add
<!-- Framework and location from testing.md. -->
- `{{test path}}`: {{behaviour under test}}

## Docs impact
<!-- Pages whose covers the touchpoints hit, and what claim changes. -->
- `{{wiki_dir}}/{{page}}.md`: {{claim that changes}}

## Risks
<!-- Quote the gotchas that apply, by id. -->
- {{risk}} (see `{{wiki_dir}}/gotchas.md` g-{{yyyymmdd}}-{{slug}})

## Verification
```
{{command that proves it works}}
```
