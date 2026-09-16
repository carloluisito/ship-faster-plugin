---
name: preflight
description: Run the repository's verification checks (typecheck, lint, test, build, resolved from commands.md, CI, or stack detection) in an isolated agent and report exactly what failed, with the failure tail and the log path. Read-only.
when_to_use: Use before claiming a change works, before committing or opening a PR, after a fix that could affect other tests, or when the user asks to run the checks, the tests, or CI locally. ship and release invoke it themselves.
argument-hint: "[--continue]"
allowed-tools: Bash(node *), Read
context: fork
agent: ship-faster:check-runner
background: false
---

# Preflight

Arguments: $ARGUMENTS

You are running inside the check-runner agent; the caller sees only your final message. Run the repository's checks and report what failed. Never edit a file, never re-run a check with different flags, never skip a check.

## 1. Resolve

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" resolve --json
```

Note `source` (`wiki`, `ci`, `detect`, or `none`) and the `excluded` list. When `source` is `none`, report `Preflight: FAIL (no checks resolved)` with one sentence on why a repository gets none (no `checks` in commands.md, no CI run steps, no recognised stack) and stop; no checks is a failure, not a pass.

## 2. Run

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" run --json
```

Append `--continue` only when the arguments contain it. Without it the script stops at the first failure. It writes one log per check and `preflight/last.json` under the plugin's data directory (`lastJson` in the output), and returns each check's `status`, `exitCode`, `durationMs`, `tail`, and `log` (`null` when the log could not be written).

## 3. Diagnose

For the first check whose status is not `pass`: read its `tail`; when the tail does not name the cause and `log` is not null, Read the last 200 lines of the log. State the failing check, its exit code, the output line that names the cause, and the smallest plausible fix, marked as a guess when it is one. Five sentences at most.

## 4. Report

Print exactly this shape and nothing after it:

```
Preflight: PASS|FAIL (source: <source>, <n> checks, <total>s)
| Check | Status | Duration |
|---|---|---|
| <name> | pass | 12.3s |
| <name> | fail (exit 1) | 4.0s |
| <name> | skipped | - |
Excluded: <run> (<why>); ...            (omit the line when nothing was excluded)
Failure: <check> exit <code>             (only on FAIL)
<last 20 lines of the tail in a fenced block>
Log: <path or "not written">
Diagnosis: <the five sentences>
Result file: <lastJson path>
```
