---
title: Gotchas
summary: Hook stdin hangs, Windows renames and 8.3 temp paths, BOM shebangs, long-history staleness, tag pushes, test state leaks, and eval sandbox traps, with evidence.
read_when: Something behaves in a way the code does not explain, or before touching the areas listed in covers.
covers: [plugins/ship-faster/tests/validate.mjs, plugins/ship-faster/evals/routing/prompt.md, plugins/ship-faster/scripts/lib/cli.mjs, plugins/ship-faster/scripts/lib/state.mjs, plugins/ship-faster/scripts/lib/root.mjs, plugins/ship-faster/evals/*/scaffold.sh, plugins/ship-faster/evals/*/graders/*.md, plugins/ship-faster/scripts/stale.mjs, plugins/ship-faster/scripts/hook-ship-guard.mjs, plugins/ship-faster/tests/run.mjs, plugins/ship-faster/tests/helpers.mjs]
verified: d8a378230d683ecc251a6a7e68bb27da4c3f49fd
updated: 2026-09-24
---
# Gotchas

### A hook prints its result and then hangs <!-- id: g-20260916-stdin-release -->
Symptom: A hook writes its output, then keeps running until Claude Code kills it at the hook timeout.
Cause: When the caller never closes the stdin pipe, a `process.stdin` still listening keeps the event loop alive after `readStdinJson` has resolved on its timeout.
Rule: Read hook input only through `readStdinJson` in `plugins/ship-faster/scripts/lib/cli.mjs`, which pauses, unhooks, and unrefs stdin before resolving.
Evidence: commit d7108c5, `plugins/ship-faster/scripts/lib/cli.mjs:40`, 2026-09-16.

### Renaming onto a state file fails on Windows <!-- id: g-20260916-windows-rename -->
Symptom: `renameSync` of a temp file onto an existing state file throws on Windows.
Cause: Windows refuses to rename over a file another process has open, and hooks from the same session can hold the same state file.
Rule: Write state only through `writeJsonAtomic`, which unlinks the target and retries the rename once, and check its boolean result.
Evidence: commit c280aab, `plugins/ship-faster/scripts/lib/state.mjs:80`, 2026-09-16.

### An eval scaffold with a BOM <!-- id: g-20260916-scaffold-bom -->
Symptom: `plugins/ship-faster/evals/onboard/scaffold.sh` began with a UTF-8 byte order mark before `#!/usr/bin/env bash`.
Cause: With a BOM, the first bytes of the file are not `#!`, so the shebang line is not recognised; some Windows editors and shells add the BOM on write.
Rule: Save every `evals/*/scaffold.sh` as UTF-8 without a BOM, with `#!/usr/bin/env bash` as the first bytes.
Evidence: commit 51c5c6d, 2026-09-16.

### Staleness loses the alongside rule on long histories <!-- id: g-20260916-log-limit -->
Symptom: A page committed together with the change it describes is reported stale.
Cause: When 2000 or more commits (`LOG_LIMIT`) separate the page's `verified` commit from HEAD, `stale.mjs` falls back to a plain `git diff`, which cannot skip commits that also touched the page.
Rule: Re-verify pages with `page.mjs verify` well before 2000 commits pass since their `verified` commit.
Evidence: `plugins/ship-faster/scripts/stale.mjs:10`, `plugins/ship-faster/scripts/stale.mjs:100`, 2026-09-16.

### A --tags push still pushes the named branch <!-- id: g-20260916-push-tags -->
Symptom: The guard allowed `git push origin main --tags`.
Cause: Any `--tags` was treated as a tag-only push, but a refspec given alongside `--tags` pushes that branch as well.
Rule: Exempt a `--tags` push from the protected-branch check only when it names no refspec, and keep the `--tags` cases in `plugins/ship-faster/tests/hook-ship-guard.test.mjs`.
Evidence: commit 7eb1c21, `plugins/ship-faster/scripts/hook-ship-guard.mjs:79`, 2026-09-16.

### A test run alone writes to the real plugin data directory <!-- id: g-20260916-plugin-data -->
Symptom: A test file run with `node --test` that reaches `lib/state.mjs` without setting `CLAUDE_PLUGIN_DATA` creates `projects/<hash>/` under `~/.claude/plugins/data/ship-faster/`.
Cause: `dataDir()` falls back to the user's Claude config directory when `CLAUDE_PLUGIN_DATA` is unset, and only `tests/run.mjs` sets it for the whole run.
Rule: In every test file that reaches `lib/state.mjs`, set `process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-')` in `beforeEach`.
Evidence: `plugins/ship-faster/scripts/lib/state.mjs:17`, `plugins/ship-faster/tests/run.mjs:14`, 2026-09-16.

### The eval workspace is the sandbox home, full of device-node dotfiles <!-- id: g-20260917-eval-home -->
Symptom: A release eval stops on a dirty tree, and `git status` in any fixture lists `.bashrc`, `.idea`, `.vscode`, `.eval-artifacts`, and `.claude/...` entries the scaffold never created.
Cause: `claude plugin eval` runs each case in a throwaway home directory that is also the working directory; the harness masks its own dotfiles as character devices, so directory-style ignore patterns such as `.idea/` do not match them.
Rule: Every `evals/*/scaffold.sh` commits a `.gitignore` naming those paths without a trailing slash (copy the block from an existing scaffold), and `review.mjs` copies only regular, readable untracked files.
Evidence: `plugins/ship-faster/evals/release/scaffold.sh:7`, `plugins/ship-faster/scripts/review.mjs:60`, 2026-09-17.

### Non-interactive runs deny writes under .git, .claude, and the plugin data directory <!-- id: g-20260917-denied-writes -->
Symptom: In an eval or a `claude -p` run, the Write tool fails on `<dataDir>/ship/commit-msg.txt`, `.git/SHIP_COMMIT_MSG`, and `.claude/rules/<area>.md`, while the plugin's own scripts write to the data directory without trouble.
Cause: Claude Code's permission settings deny the model's tools those paths when nobody can answer a prompt; scripts spawned through Bash are not subject to the tool-level rule.
Rule: Skills that need a scratch file fall back to the system temp directory and then to stdin (`git commit -F -`), and a skill that cannot write a rules file prints the rule line instead of failing.
Evidence: `plugins/ship-faster/skills/ship/reference/commit-and-pr.md:7`, `plugins/ship-faster/skills/lesson/SKILL.md:59`, 2026-09-17.

### GitHub's Windows runners hand out an 8.3 temp path <!-- id: g-20260917-short-temp-path -->
Symptom: Six tests pass on every developer machine and on the Ubuntu jobs but fail on `windows-latest` with paths like `c:/users/runner~1/appdata/local/temp/...` where `c:/users/runneradmin/...` was expected, or with session records that cannot be found.
Cause: The runner's `TEMP` uses the short (8.3) form of the profile directory, while `git rev-parse --show-toplevel` reports the long form; a fixture path and the repository root then hash to different project directories.
Rule: Create fixture directories through `tmpDir()` in `plugins/ship-faster/tests/helpers.mjs`, which resolves the real path, and resolve a working directory with `realpathSync.native` before comparing or hashing it, as `plugins/ship-faster/scripts/lib/root.mjs` does.
Evidence: CI run 35189638968 on 2026-09-17, `plugins/ship-faster/tests/helpers.mjs:13`, `plugins/ship-faster/scripts/lib/root.mjs:7`, 2026-09-17.

### An eval grader's input_match sees the tool input as JSON <!-- id: g-20260917-grader-json-escape -->
Symptom: The release case's `pages-stamped` grader reported "Bash called 0x (expected 1..∞)" although the kept trace shows the run calling `node "<plugin root>/scripts/page.mjs" verify docs/wiki/commands.md docs/wiki/ops.md --json`.
Cause: `tool_used` matches `input_match` against the serialized tool input, where every double quote of the command is escaped as a backslash and a quote, so a pattern holding a bare quote (`["']?`) never meets one.
Rule: Never put a literal quote in an `input_match`: write `\S*` or `[^ ]+` where the command quotes a path, as `git( -C ("[^"]*"|[^ ]+))?` does, and test a new pattern against a kept trace (`-KeepTemp`) before believing a zero-match verdict.
Evidence: `plugins/ship-faster/evals/release/graders/pages-stamped.md:4`, 2026-09-17.

### Hooks and skill scripts kept plugin state in different directories <!-- id: g-20260917-plugin-data-dir -->
Symptom: The installed plugin's hooks wrote session records under `plugins/data/ship-faster-ship-faster/`, while scripts run from skills wrote under `plugins/data/ship-faster/`; in an eval, `ship` found no second session although its session and claim files existed.
Cause: Claude Code sets `CLAUDE_PLUGIN_DATA` (`<plugins>/data/<name>-<marketplace>`, or `<name>-inline` for `--plugin-dir`) only for hooks, so scripts started through Bash used a fallback path; a sandboxed Bash also cannot see the Claude config directory at all.
Rule: Resolve plugin state only through `dataDir()`, which rebuilds the hooks' directory from the script's install path, and keep state that skills must read from a sandbox (session records, edit claims) in the checkout's git directory through `checkoutDir()`.
Evidence: `plugins/ship-faster/scripts/lib/state.mjs:17`, `plugins/ship-faster/scripts/lib/state.mjs:36`, 2026-09-17.

### GitHub's Windows runners keep core.autocrlf in the system git config <!-- id: g-20260917-system-git-config -->
Symptom: `worktree.test.mjs` passed on Windows locally and failed only on `windows-latest`: `clear` reported a file nobody had carried as shipped, because the worktree commit held its CRLF bytes.
Cause: the fixture committed with `GIT_CONFIG_NOSYSTEM=1` while `git worktree add` (through `lib/git.mjs`) read the system config, where those runners set `core.autocrlf=true`; locally the same setting also sits in the global config, which the flag leaves alone, so the two halves agreed.
Rule: In a test that commits into a checkout the plugin's own git calls created, use the same configuration they do: pass `GIT_TERMINAL_PROMPT=0` only, never `GIT_CONFIG_NOSYSTEM`.
Evidence: `plugins/ship-faster/tests/worktree.test.mjs:16`, CI run 35259384942, 2026-09-17.

### A `ship-faster:<word>` string in skill text must name a skill or agent <!-- id: g-20260924-plugin-prefix-marker -->
Symptom: `node plugins/ship-faster/tests/validate.mjs` failed with `skills/ship/reference/commit-and-pr.md: ship-faster:pr names no agent or skill` after the PR marker `<!-- ship-faster:pr -->` was added to a reference file.
Cause: the validator reads every bare `ship-faster:<name>` in skills and their reference files as an agent or skill reference unless another colon follows it; `ship-faster:managed:start` passes only because of that second colon.
Rule: Write markers and other strings in skill text that are not references without the `ship-faster:<name>` form, as the PR marker `<!-- opened-by: ship-faster -->` does.
Evidence: `plugins/ship-faster/tests/validate.mjs:93`, `plugins/ship-faster/scripts/hook-ship-guard.mjs:11`, 2026-09-24.

### An eval case never sees the fixture's CLAUDE.md <!-- id: g-20260924-eval-no-claude-md -->
Symptom: A case whose fixture CLAUDE.md held the Workflow section scored the same as one without it, and a control case asking for a magic word stated in the fixture's CLAUDE.md failed whether the file sat at `./CLAUDE.md` or `./.claude/CLAUDE.md`.
Cause: `claude plugin eval` runs the model without loading CLAUDE.md from the workspace, which is also the sandbox home; skills under `.claude/skills/` do load there.
Rule: Test behaviour that CLAUDE.md drives, such as the Workflow section's routing, with local `claude -p` runs in a fixture directory, and keep eval cases to what skills, hooks, and the prompt decide.
Evidence: `plugins/ship-faster/evals/routing/prompt.md:2`, 2026-09-24.
