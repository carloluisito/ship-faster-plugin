---
description: sync-docs re-verifies a stale commands page after the test command changed
tags: [sync-docs, knowledge]
runs: 1
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
---
I moved the tests into tests/ and changed the npm test script to `node --test tests/*.test.js`; that commit is already on this branch. Before I ship, make sure the wiki still tells the truth about the commands.
