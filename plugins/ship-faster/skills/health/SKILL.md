---
name: health
description: Maintenance audit of the repository (outdated and vulnerable dependencies, skipped and slow tests, stale docs, old TODOs and large files, failing CI runs, abandoned plans) as one table of coded findings, with optional fixes applied behind preflight.
disable-model-invocation: true
argument-hint: "[--fix <F1,F3,...>|safe]"
allowed-tools: Read, Glob, Grep, Write, Edit, Skill, Agent, Bash(node *), Bash(git *), Bash(gh *), Bash(npm *), Bash(pnpm *), Bash(yarn *), Bash(dotnet *), Bash(pip *), Bash(pip-audit *), Bash(cargo *), Bash(go *), Bash(govulncheck *)
---

# Health

Signals:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs" scan --json || true`

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

Never install a tool, never change a dependency file outside `--fix`, never push. Read `${CLAUDE_SKILL_DIR}/reference/areas.md` before step 1.

## 1. Fan out

Launch one `ship-faster:health-auditor` agent per area in areas.md, all in one message so they run in parallel. Each prompt carries `area`, the area's `brief` from areas.md, `scan` (the signals JSON above), and `detect` (the facts JSON). Areas whose brief says "script only" (hygiene, plans) still get an auditor, with the brief telling it to add nothing unless a tool shows more.

## 2. Merge

Parse each JSON reply. Drop findings without evidence. Deduplicate. Order by area in the order of areas.md, then by effort ascending. Code them `F1..Fn`.

## 3. Report

One table:

```
| Code | Area | Finding | Why it matters | Effort | Fix |
|---|---|---|---|---|---|
| F1 | dependencies | express 4.18.2 → 4.21.0 (minor) | two advisories fixed upstream | S | npm install express@^4.21.0 (safe) |
```

After the table: one line per area whose tools were missing (`toolsMissing`), and one line `Safe fixes: F1, F4, F7` listing the findings whose fix is a patch or minor dependency bump with a lockfile update, a docs sync, or a plan archive.

## 4. Fixes (only with --fix)

`--fix safe` selects the safe set; `--fix F1,F3` selects those codes. For each selected finding, in code order:

- Dependency bump: the package manager's install command for that version (`npm install <pkg>@<version>`, `pnpm add`, `yarn add`, `dotnet add package`, `pip install` with the pinned file updated, `cargo update -p`, `go get`) so the lockfile updates. Major bumps are never in `safe`.
- Docs: invoke the `ship-faster:sync-docs` skill with `--scope all`.
- Plan archive: `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" set-status <rel> abandoned --json`.
- Anything else: apply the finding's `fix` sentence when it names a concrete file edit; otherwise say it needs a person and skip it.

Record every file the fixes touched (`git status --porcelain` before and after). Then invoke `ship-faster:preflight`. On `Preflight: FAIL`: revert the touched files (`git checkout -- <tracked paths>`, delete new untracked ones), print the failure, and say which fixes were reverted. On PASS: list the applied fixes.

## 5. Record and close

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs" record --findings <n> --json
```

End with one line: `Next: /ship-faster:ship` when fixes were applied and passed, otherwise `Next: /ship-faster:health --fix safe` when safe fixes exist, otherwise `Nothing to fix.`
