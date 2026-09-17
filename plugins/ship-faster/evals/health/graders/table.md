---
type: llm
weight: 3
---
PASS when the final answer contains a table with the columns Code, Area, Finding, Why it matters, Effort, Fix, and that table has:
- a row about the TODO comment in src/legacy.js,
- a row about the skipped test in tests/legacy.test.js,
- a row about the file big.bin,
- a row about docs/plans/2020-01-01-old-idea.md (a plan whose branch is gone),
and the answer also has a line beginning "Safe fixes:" and a line beginning "Next:".
Rows for other findings are fine. The area names, the effort letters, and the wording of the fixes do not matter for this check.
FAIL when the table is missing, when any of those four rows is missing, or when the answer says it changed a file or applied a fix.
