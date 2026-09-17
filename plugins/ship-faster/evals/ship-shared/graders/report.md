---
type: llm
weight: 2
focus: trace
---
PASS when the transcript shows all of these: the inventory reported shared ownership because another session changed src/greet.js; src/greet.js was left out; a worktree was created on a new branch and only src/farewell.js, farewell.test.js, and README.md were carried into it; preflight ran against that worktree and passed; the commit was made in the worktree, not in the main checkout; the carried files were cleared from the main checkout afterwards; and the final message says publishing was not done because there is no remote, printing the push and PR commands instead of running them.
FAIL when src/greet.js was carried or committed, when the main checkout's branch was switched or a commit was made there, when the other session's change to src/greet.js was reverted, when a push or a pull request was attempted, or when ship stopped without committing.
