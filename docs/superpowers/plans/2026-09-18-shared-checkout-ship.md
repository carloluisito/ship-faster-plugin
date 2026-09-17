# Shipping from a shared checkout

**Goal:** `/ship-faster:ship` produces a pull request holding exactly the invoking session's changes even when other Claude Code sessions work in the same checkout, without switching that checkout's branch or touching the other sessions' uncommitted work. `kickoff` stays optional.

**Problem (0.2.1):** isolation exists only when a ticket starts in a worktree (`kickoff --worktree`, `claude --worktree`). Two sessions in one folder get a session-start warning, then `ship` stages every uncommitted file (both tickets land in one PR) and `git switch -c` moves the whole folder, so the other session keeps working on the wrong branch.

## Behaviour

- **Claims.** The PostToolUse edit hook records, per session, every file the session changes through Edit, Write, MultiEdit, or NotebookEdit (`.git/ship-faster/edits/<sid>.json`: path → time and tool). Changes made through Bash commands are not attributable and count as unclaimed.
- **Current claim.** A claim counts while the file is uncommitted and no commit on HEAD touched the file after the claim. `worktree.mjs clear` drops claims on the files it clears.
- **Open session.** A session whose record still exists (SessionEnd deletes it) and that was active in the last two hours. Claims of ended sessions, and of records idle longer (a session killed without SessionEnd), are `earlier`, so they are asked about rather than left out.
- **Owner of each uncommitted file:** `mine` (this session only, or this session plus ended ones), `both` (this session and another open one), `theirs` (only other open sessions), `earlier` (only ended sessions), `unclaimed`.
- **Mode.** `shared` when another session record holds a current claim at any age, or was active in the last two hours (its branch must not move). Otherwise `solo`. Without a session id, `solo`. `--here` forces `solo`.
- **Solo** is 0.2.1 behaviour exactly: every uncommitted file except risky or oversized ones, branch in place.
- **Shared:**
  - Files to ship: `mine` plus `--include <globs>` matches. `both`, `earlier`, `unclaimed` are asked about once when someone can answer and left out otherwise; `theirs` only through `--include`.
  - Nothing to ship: stop, naming what other sessions own and the two ways to take it (`--include`, `--here`).
  - `worktree.mjs add --branch <name> --from HEAD` creates the PR's checkout from the folder's current commit; `checks.mjs setup --root <path>` installs dependencies there; `worktree.mjs carry --to <path> <files>` copies the files (deletions included).
  - Preflight, docs sync, review, plan check, and the commit run against the worktree (`--root <path>`, `git -C <path>`).
  - After the commit, `worktree.mjs clear --from <path>` removes the shipped changes from the folder: a file identical to the committed one is restored to HEAD; a file that also holds another session's hunks gets a three-way merge from the committed version back to the original, on LF-normalised content; a file changed since carrying is kept and reported.
  - The worktree stays for review follow-ups (`/ship-faster:ship --root <path>`) and is removed with the existing cleanup commands after the merge.
  - A both-sessions file can be carried with only this session's hunks (interactive choice); the merge in `clear` then leaves the other session's hunks in the folder.
- **Setup** (`checks.mjs setup`): commands from a `setup` list in `commands.md` frontmatter (same shape as `checks`), else detection limited to project-local installs: npm/pnpm/yarn/bun with a lockfile (`npm install --no-package-lock` when dependencies exist without one), `dotnet restore`, `go mod download`, `cargo fetch`, `uv sync`, `poetry install`. Nothing runs for a package without dependencies. `kickoff --worktree` runs it too.
- **Other checkouts.** `preflight`, `review`, `sync-docs`, and `ship` accept `--root <path>`.
- **Session start** says that `ship` keeps each session's changes apart and still recommends `claude --worktree` for parallel work.

## Rulings

- Claims come from the edit tools only. Bash-made changes are unowned. Cost if wrong: such files need `--include` or an answer.
- Shared mode always extracts into a worktree, also on a feature branch; the new branch starts at the folder's HEAD, so when that is another feature branch the PR also carries its commits, and the report says so. Cost if wrong: a stacked PR where the user wanted commits on the shared branch; `--here` restores the old flow.
- An idle session record older than two hours without claims does not trigger shared mode (closed terminals skip SessionEnd). A record with current claims does, at any age up to the seven-day prune, but after two hours idle its files are asked about instead of left out. Cost if wrong: one extra question after a crash.
- A staged rename ships as a pair: the old path travels as a deletion with the new path, so the worktree commit records the rename and `clear` restores both paths. Cost if wrong: none found; found by review.
- Setup never installs outside the project (no global pip or gem installs). Cost if wrong: a Python or Ruby worktree needs `setup` in `commands.md`.
- Shipping with nothing of this session's but commits ahead stops in shared mode instead of pushing a branch it cannot attribute. Cost if wrong: one `--here` rerun.

## Interfaces

- `lib/state.mjs`: `dataDir()` rebuilds the hooks' `CLAUDE_PLUGIN_DATA` path for scripts run from skills; `checkoutDir(root)` puts session records and claims in the checkout's git directory; `editsFile(root, sid)`, `recordEdit(root, sid, rel, { tool, at })` (merge-safe, capped at 1000 paths), `loadEdits(root)`, `dropClaims(root, rels, { sid })`, `sessionRecords(root)`; `pruneSessions` also prunes `edits/`.
- `lib/cli.mjs`: switches (`--json`, `--here`, and the like) never take the next argument as a value.
- `lib/git.mjs`: `git(args, { input, raw })`; `dirtyFiles` entries gain `from` for renames and copies; `lastCommitTimes(cwd, paths)`; `blobIds(cwd, ref, paths)`; `hashFiles(cwd, paths)`.
- `lib/ownership.mjs`: `ownership(root, { sid, dirty, includes, here, now })` → `{ session, mode, forced, others, owners, ship, ask, leave }`.
- `changes.mjs --session <sid> [--include <globs>] [--here]`: adds `ownership` and per-entry `owner`; a staged rename adds its old path as a deletion paired with the new one.
- `worktree.mjs carry --to <path> <files...>`, `worktree.mjs clear --from <path> [--session <sid>] <files...>`.
- `checks.mjs setup` (resolve and run); `lint.mjs` validates `setup` like `checks`.

## Tests

state (claims merge, cap, prune, drop), hook-drift (claims for covered and uncovered files, wiki files, no session id, outside root), git (rename `from`, commit times, blob ids, hash), ownership through `changes()` (solo, shared by recent session, shared by claims, owners, commit-time staleness, ended sessions, includes, `--here`, unknown session), worktree (carry copy, delete, skip, containment; clear exact, partial, kept, unchanged, claims dropped), checks (setup from frontmatter, node detection with and without lockfile or dependencies, run pass and fail), lint (`setup` shape), session start (new warning).

## Eval

`evals/ship-shared/`: a fixture on `main` with an open second session (record and claims seeded in `.git/ship-faster/`, which the sandboxed session can read; the plugin data directory is hidden from it) owning one changed file, and this ticket's files named with `--include`. Graders: a worktree is created, nothing switches the folder's branch, the other session's change is still in the folder, the carried file is back to HEAD in the folder, nothing is pushed, no add-all, and a judge on the trace.

## Docs

Plugin README (ship row, multi-session section, scripts), root README, wiki pages covering the changed files (architecture, overview vocabulary, layout, testing, conventions where claims apply), CHANGELOG, the handbook's "Several tickets at once", release 0.3.0.
