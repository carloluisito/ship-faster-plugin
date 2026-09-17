---
type: llm
weight: 3
---
The final answer names a plan file under docs/plans/ and prints its contents. PASS when all of the following hold for the printed plan:
- Its frontmatter has title, a branch starting with feat/, status: active, created, and pages.
- Its body has the sections Goal, Scope, Touchpoints, Tests to add, Docs impact, Risks, and Verification.
- Touchpoints name src/lib/db.js (a delete or remove function), src/routes/users.js (the DELETE branch placed above the final 404), and tests/users.test.js, in that order.
- Tests to add name a file under tests/ and cover both the 204 success case and the 404 missing-id case.
- Docs impact names docs/wiki/recipes/add-endpoint.md or docs/wiki/layout.md.
- Risks quote the gotcha g-20260101-route-order or its rule about adding routes above the final 404.
- Verification lists npm test or node --test.
FAIL when a section is missing, when a touchpoint names a file that does not exist without marking it as new, when the plan defers part of the feature to later, or when no plan is printed.
