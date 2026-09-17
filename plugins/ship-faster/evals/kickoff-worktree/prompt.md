---
description: kickoff --worktree writes the plan into a new sibling worktree on a feature branch and leaves the current checkout on main
tags: [kickoff, shipping, worktree]
runs: 3
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---
/ship-faster:kickoff add a DELETE /users/:id endpoint that returns 204 and 404 for a missing id --worktree
