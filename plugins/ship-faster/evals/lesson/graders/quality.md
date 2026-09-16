---
type: llm
weight: 2
focus: { source: file, path: docs/wiki/gotchas.md }
---
PASS when all of the following hold in the gotchas page:
- The page has frontmatter with title, summary, read_when, a non-empty covers list that includes src/client.js or a glob matching it, verified, and updated.
- There is exactly one gotcha entry, and it names the TOKEN_TTL unit mismatch (seconds read in src/client.js versus milliseconds written by config/env.js) as the cause, not merely "retries on 401" as the cause.
- The Rule line is a single imperative sentence a developer can follow (for example, keep TOKEN_TTL in one unit or convert at one boundary).
- The Evidence line cites src/client.js:12 or config/env.js with a date.
FAIL when the entry is generic, when the cause restates the symptom, when Evidence has no file reference, or when the page has no frontmatter.
