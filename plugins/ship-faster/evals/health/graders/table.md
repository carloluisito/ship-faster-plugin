---
type: llm
weight: 3
---
PASS when the final answer contains one table with columns Code, Area, Finding, Why it matters, Effort, Fix, whose rows are coded F1, F2, ... and include: the old TODO in src/legacy.js (hygiene), the skipped test in tests/legacy.test.js (tests), the large file big.bin (hygiene), and the stale plan docs/plans/2020-01-01-old-idea.md whose branch is gone (plans); each row has an effort of S, M, or L and an imperative fix; the answer states which findings are safe fixes (at least the plan archive) and ends with a Next line; and no file was modified and nothing was installed (no npm install, no dependency changes).
FAIL when any of the four findings is missing, when the answer applied a fix without --fix, when it installed a tool, or when the table is absent.
