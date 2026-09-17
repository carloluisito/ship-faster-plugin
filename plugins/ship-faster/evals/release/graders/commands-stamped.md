---
type: regex
pattern: '^updated: (?!2026-01-01)\d{4}-\d{2}-\d{2}\s*$'
flags: m
target: { source: file, path: docs/wiki/commands.md }
---
