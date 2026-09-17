---
description: review flags a console.log against the repository's documented logging rule
tags: [review, shipping]
runs: 1
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash]
---
I finished the change on this branch. Review it against the project's own rules before I open the PR.
