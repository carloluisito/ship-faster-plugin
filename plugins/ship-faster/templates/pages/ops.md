---
title: Ops
summary: {{One sentence: environments, CI, deploy and release process, and secret names.}}
read_when: You are changing CI, preparing a release, or need to know how and where the software runs.
covers: ["{{ci files}}", "{{infra dir}}/**", "{{deploy scripts}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Ops

## Environments
| Environment | Where | How it is configured |
|---|---|---|
| {{local, staging, production}} | {{host or platform}} | {{config source}} |

## CI
{{Pipeline file, the jobs in order, what each gates, typical duration.}}

## Deploy
<!-- Documented, never run by this plugin. -->
{{Who or what deploys, the trigger, the command or workflow, rollback.}}

## Release
{{Versioning scheme, where the version lives, tag format, changelog location.}}

## Secrets by name
<!-- Names only. Never values. -->
| Name | Used by | Provided through |
|---|---|---|
| {{ENV_VAR}} | `{{path}}` | {{secret store or CI variable}} |
