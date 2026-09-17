---
description: lesson records a gotcha with symptom, cause, rule, evidence, and a path-scoped rule
tags: [lesson, knowledge]
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---
I just fixed a bug in src/client.js. The retry loop re-sent every request on a 401 because TOKEN_TTL is read as seconds in src/client.js but config/env.js writes it in milliseconds, so every token looked expired the moment it was issued. The fix on line 12 of src/client.js divides by 1000. Make sure nobody hits this again.
