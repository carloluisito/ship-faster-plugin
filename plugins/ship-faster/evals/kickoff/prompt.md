---
description: kickoff writes a grounded plan for a new endpoint and creates the branch
tags: [kickoff, shipping]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---
/ship-faster:kickoff add a DELETE /users/:id endpoint that returns 204 and 404 for a missing id
