---
description: ship in a checkout another open session is changing takes only the named files, commits them in a worktree of their own, clears them from the checkout, leaves the other session's change alone, and stops before pushing without a remote
tags: [ship, shipping, worktree]
runs: 1
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
---
/ship-faster:ship feat/farewell --include src/farewell.js,farewell.test.js,README.md
