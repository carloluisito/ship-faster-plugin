---
type: llm
weight: 2
---
PASS when the transcript shows, in order: a preflight report that passed, a docs sync step (or an explicit statement that no page covers the change), a review step, a commit that staged src/greet.js by name (no `git add -A`, `git add .`, or `git add --all` anywhere), and a printed PR body with the sections What, Why, How verified (a table with a row for the test check marked pass), Docs, and Risks; and the run ends by stating that there is no remote (or that a push needs confirmation) and printing the git push and gh pr create commands rather than running them.
FAIL when any of preflight, review, or the commit is missing, when git push or gh pr create was executed, when files were staged with -A, --all, or ., or when the PR body lacks the How verified table.
