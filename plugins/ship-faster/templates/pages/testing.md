---
title: Testing
summary: {{One sentence: how tests are organised and how to add one.}}
read_when: You are adding or fixing a test, need a fixture or mock, or a test cannot run locally.
covers: ["{{test dir}}/**", "{{test config}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Testing

## Layout
| Kind | Location | Runner | Command |
|---|---|---|---|
| {{unit, integration, e2e}} | `{{dir}}/` | {{framework}} | `{{command}}` |

## Adding a test
1. {{Where the file goes and how it is named.}}
2. {{What to import and the assertion style.}}
3. {{How to run just that test.}}

## Fixtures and mocks
| Need | Use | Defined in |
|---|---|---|
| {{a database, a fake clock, an HTTP stub}} | {{helper}} | `{{path}}` |

## Not runnable locally
- {{test or suite}}: {{why, and where it does run}}
