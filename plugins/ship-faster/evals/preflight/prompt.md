---
description: preflight runs the wiki's checks and reports the failing lint check with its cause
tags: [preflight, shipping]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash]
---
Run this repository's checks and tell me exactly what fails and why.
