---
title: Architecture
summary: {{One sentence: the main components and how data moves between them.}}
read_when: You are changing how components interact, adding a component, or need the reason behind a structural decision.
covers: ["{{src}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Architecture

## Components
| Component | Responsibility | Code |
|---|---|---|
| {{name}} | {{one clause}} | `{{path}}` |

## Data flow
{{Numbered steps from input to output, naming the file that handles each step.}}

## Boundaries
{{Which components may call which. What must never call what, and why.}}

## Decisions
<!-- One entry per decision. /ship-faster:lesson appends here when a lesson is classified as a decision. -->
### {{Decision title}} <!-- id: d-{{yyyymmdd}}-{{slug}} -->
Decision: {{what was chosen}}
Why: {{the reason a reader could not infer}}
Alternatives: {{what was rejected and why}}
Evidence: {{commit or path:line}}, {{yyyy-mm-dd}}.
