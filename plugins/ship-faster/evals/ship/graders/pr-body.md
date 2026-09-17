---
type: llm
weight: 2
---
PASS when all of the following hold for the final answer:
- It contains a PR body with the sections What, Why, How verified, Docs, and Risks.
- The How verified section is a table with a row for the test check marked pass.
- It says that no remote is configured (or that pushing needs the user's confirmation), and it prints the git push and gh pr create commands for the user instead of reporting that it ran them.
FAIL when a PR body section is missing, when the How verified table is absent, or when the answer reports that it pushed or opened a pull request.
