---
title: Commands
summary: {{One sentence: verified dev, test, and build commands with durations.}}
read_when: You need to run, test, build, or debug the environment, or preflight needs the check list.
covers: ["{{root manifest}}", "{{ci files}}", "{{scripts dir}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
checks:
  - name: {{check name}}
    run: {{command}}
    timeout: {{seconds}}
---
# Commands

## Setup
<!-- Tool versions, install command, env vars by name (never values), ports. -->
| Step | Command | Notes |
|---|---|---|
| {{step}} | `{{command}}` | {{note}} |

## Everyday
<!-- Only commands that passed when run. Deploy, publish, and release commands are listed with status "not run". -->
| Purpose | Command | Duration | Status |
|---|---|---|---|
| {{purpose}} | `{{command}}` | {{n}}s | pass |
| {{deploy}} | `{{command}}` | — | not run |

## Checks
<!-- The ordered list preflight runs; mirrors the checks frontmatter. -->
1. `{{command}}` — {{what it proves}}, about {{n}}s

## Known slow or flaky
- {{command or test}}: {{why, and what to do about it}}
