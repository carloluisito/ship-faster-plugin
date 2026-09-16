---
type: llm
weight: 2
focus: { source: file, path: docs/wiki/commands.md }
---
PASS when the commands page now says the tests run from the tests/ directory (the command is `node --test tests/` or `npm test` described as running tests/), no line still claims that test files live in the repository root, the frontmatter `verified` value is a 40-character hexadecimal commit sha, and the checks list still contains a test check with a non-empty run command.
FAIL when the page still describes `node --test` over root-level *.test.js files, when frontmatter is missing or malformed, or when the page was deleted instead of updated.
