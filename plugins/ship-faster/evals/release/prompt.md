---
description: release bumps the version, writes the changelog, re-stamps the wiki pages covering the version file, runs preflight, commits and tags, and stops before publishing without a remote
tags: [release, shipping]
runs: 1
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
---
/ship-faster:release minor
