---
type: llm
weight: 3
---
PASS when a plan file was written under docs/plans/ whose frontmatter has title, branch starting with feat/, status: active, created, and pages, and whose body has the sections Goal, Scope, Touchpoints, Tests to add, Docs impact, Risks, and Verification, where: Touchpoints name src/lib/db.js (a delete/remove function), src/routes/users.js (the DELETE branch placed above the final 404), and tests/users.test.js, in that order; Tests to add mention both the 204 success and the 404 missing-id case using node:test under tests/; Docs impact names docs/wiki/recipes/add-endpoint.md or docs/wiki/layout.md; Risks quote the gotcha g-20260101-route-order or its rule about adding routes above the final 404; Verification lists npm test or node --test.
FAIL when any section is missing, when a touchpoint names a file that does not exist without marking it new, when the plan defers part of the feature to later, or when no plan file was written.
