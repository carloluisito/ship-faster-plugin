---
type: llm
weight: 3
---
The final answer reports a plan path, a branch, a worktree, and then prints the plan. PASS when all of the following hold:
- The worktree line names a directory whose name ends with the branch name with slashes turned into hyphens (for example a path ending in `-feat-delete-users-endpoint`), and gives the commands to open a session there (a `cd "<path>"` followed by `claude`).
- The plan path is inside that worktree directory, under docs/plans/.
- The printed plan has the sections Goal, Scope, Touchpoints, Tests to add, Docs impact, Risks, and Verification, and its Touchpoints name src/lib/db.js, src/routes/users.js, and tests/users.test.js.
- The Risks section mentions the gotcha g-20260101-route-order or its rule about adding routes above the final 404.
FAIL when no worktree is reported, when the plan was written into the current checkout instead of the worktree, when a plan section is missing, or when the answer says it switched the current checkout to the new branch.
