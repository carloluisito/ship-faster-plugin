---
name: review
description: Review the current branch's diff against this repository's own documented rules (conventions, gotchas, architecture decisions, matching recipes), not generic best practice, and print findings coded R1..Rn with the quoted rule and a fix.
when_to_use: Use before committing or opening a PR, after finishing a change in an area gotchas.md covers, or when the user asks for a review, a self-review, or whether a change follows the project's rules. ship invokes it before committing.
argument-hint: "[--base <branch>]"
allowed-tools: Bash(node *), Agent, Read, Grep
---

# Review against the repository's rules

Arguments: $ARGUMENTS

## 1. Prepare

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" prepare --json
```

Append `--base <branch>` when the arguments contain it. `ok: false`: print the error and stop. Empty `files` and empty `untracked`: say there is nothing to review and stop. No rule page with `exists: true`: say the repository has no documented rules yet, that `/ship-faster:onboard` writes them, and stop.

## 2. Fan out

Launch `ship-faster:rules-reviewer` once per entry in `chunks`, all in one message so they run in parallel. Each prompt carries `chunks: [that chunk's file]`, `untracked: [...]` (every untracked file path, given to the first chunk's reviewer only), `rulePages: [...]` (only entries with `exists: true`, as file paths), and `recipes: [...]` (file paths), and asks for the JSON contract in the agent's definition.

## 3. Merge

Parse each JSON reply. A finding whose `rule` you cannot find verbatim in its `source` page (check with Grep when in doubt) becomes `nit`. Deduplicate on file, line, and rule. Order `block`, then `warn`, then `nit`.

## 4. Report

```
Review: <n> finding(s) against <pages read, comma separated> — coded R1..R<n>
R1 [block] src/api/users.ts:42 — "Never call the provider without a timeout." (docs/wiki/gotchas.md g-20260916-provider-timeout)
    evidence: <from the finding>
    fix: <from the finding>
```

Close with one line: `block findings stop /ship-faster:ship before the commit; warn findings go into the PR body under Risks.` With no findings print `Review: no documented rule applies to this change (<rulesConsidered> rules considered).` Never edit files.
