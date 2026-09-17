# Worktree Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let several tickets move through ship-faster at once, one Claude Code session per git worktree, with kickoff creating the worktree, ship cleaning it up, session start naming the sibling worktrees and warning when two sessions share one checkout, and plans living on their branch.

**Architecture:** One new zero-dependency script, `scripts/worktree.mjs` (`list`, `add`), built on two new helpers in `lib/git.mjs` (`worktrees`, `worktreeInfo`). `changes.mjs` reports the worktree state so `ship` knows where it is. `hook-session-start.mjs` gains two lines (other live sessions in this checkout, sibling worktrees) backed by two new `lib/state.mjs` functions (`markSessionStart`, `liveSessions`). The `kickoff` and `ship` skills read those outputs; no skill runs raw `git worktree` commands.

**Tech Stack:** Node.js 20+ ESM, built-ins only; `node:test`; Claude Code plugin skills and hooks; git 2.31+ (`git rev-parse --path-format=absolute`, with a fallback for older git).

**Spec:** `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` sections 4.4 (plans), 6 S4 (kickoff) and S6 (ship), 8 (hooks, SessionStart budget 1500 ms), 9 (scripts), 10 (failure behaviour), 11 (evals). The five decisions this plan implements were agreed in conversation on 2026-09-17: D1 `kickoff --worktree`; D2 ship finishes a worktree; D3 session start names sibling worktrees; D4 plans live on their branch; D5 session start warns when another live session uses the same checkout.

## Global Constraints

- Node.js 20 or newer, ESM `.mjs`, Node built-ins only, no `package.json`, no dependencies.
- Every CLI script runs standalone with `--json`, returns `{ ok, ..., summary: [] }` or `{ ok: false, error }`, and runs its CLI only when `process.argv[1]` ends with its own path.
- Every git process goes through `git()` in `lib/git.mjs` with a timeout; hooks never block a session: exit 0 on every error, print nothing when there is nothing to say; SessionStart stays under 1500 ms on 30 pages (`tests/bench.mjs`).
- Plugin state lives under the plugin data directory through `lib/state.mjs`; scripts write into the target repository only generated files.
- Skills reference scripts as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"`; outward-facing steps (push, PR, merge, publish) wait for the user's yes; in a non-interactive run the skill prints the commands and stops (ruling R-S5).
- No comments that restate code; LF line endings; every file ends with one newline; stage files by name, never `git add -A`; every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests: `node --test`, fixtures through `makeRepo`/`tmpDir` in `tests/helpers.mjs`, `CLAUDE_PLUGIN_DATA` set in `beforeEach` in every file that reaches `lib/state.mjs`; `node plugins/ship-faster/tests/validate.mjs` prints `validate: ok`, `claude plugin validate --strict plugins/ship-faster` passes, `node plugins/ship-faster/scripts/lint.mjs` has 0 errors.
- Eval cases: `prompt.md` (description, tags, runs, max_turns ≤ 200, timeout_seconds ≤ 3600, allowed_tools), `case.yaml` (`schema_version: "1.1"`, unique `name`, `context.scaffold_script`), graders `tool_used` (input_match, min, max), `file_exists` (path glob, `exists`), `llm` (rubric naming observable text only); scaffold starts with `#!/usr/bin/env bash`, no BOM, commits a `.gitignore` listing the harness dotfiles (copy from an existing scaffold).
- A worktree created by the plugin is a sibling directory of the main checkout named `<main basename>-<branch with / replaced by ->`; removal is never run from inside that worktree (the skill prints the commands).

---

### Task 1: git helpers `worktrees` and `worktreeInfo`

**Files:**
- Modify: `plugins/ship-faster/scripts/lib/git.mjs` (append after `isAncestor`; add `dirname`/`resolve` import)
- Test: `plugins/ship-faster/tests/git.test.mjs` (append one test)

**Interfaces:**
- Produces: `worktrees(cwd) → Array<{ path, head, branch, detached, bare, isMain }> | null` (paths normalized with `/`, `branch` without `refs/heads/`, first entry `isMain: true`); `worktreeInfo(cwd) → { isWorktree: boolean, mainRoot: string, path: string } | null`.

- [ ] **Step 1: Write the failing test**

Append to `plugins/ship-faster/tests/git.test.mjs` (the file already imports `makeRepo`, `tmpDir`, `cleanupAll`, `git` as `* as git` or named functions; check its imports and add `worktrees`, `worktreeInfo` to the named import list from `../scripts/lib/git.mjs`, and `join` from `node:path` plus `realpathSync` from `node:fs` if missing):

```js
test('worktrees lists every checkout and worktreeInfo tells a worktree from the main checkout', () => {
  const { root, git: g } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const wt = join(tmpDir('sf-wt-'), 'feat-x');
  g(['worktree', 'add', wt, '-b', 'feat/x']);
  const norm = (p) => realpathSync.native(p).replace(/\\/g, '/').toLowerCase();
  const list = worktrees(root);
  assert.equal(list.length, 2);
  assert.equal(list[0].isMain, true);
  assert.equal(norm(list[0].path), norm(root));
  assert.equal(list[0].branch, 'main');
  assert.equal(list[1].isMain, false);
  assert.equal(norm(list[1].path), norm(wt));
  assert.equal(list[1].branch, 'feat/x');
  assert.equal(list[1].detached, false);
  assert.match(list[1].head, /^[0-9a-f]{40}$/);
  const main = worktreeInfo(root);
  assert.equal(main.isWorktree, false);
  assert.equal(norm(main.mainRoot), norm(root));
  const inner = worktreeInfo(wt);
  assert.equal(inner.isWorktree, true);
  assert.equal(norm(inner.mainRoot), norm(root));
  assert.equal(norm(inner.path), norm(wt));
  assert.equal(worktrees(tmpDir('sf-nogit-')), null);
  assert.equal(worktreeInfo(tmpDir('sf-nogit-')), null);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test plugins/ship-faster/tests/git.test.mjs`
Expected: the new test fails with `worktrees is not a function` (or an import error naming it).

- [ ] **Step 3: Implement**

In `plugins/ship-faster/scripts/lib/git.mjs`, change the first two lines to:

```js
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { normalizePath } from './glob.mjs';
```

Append at the end of the file:

```js
export function worktrees(cwd) {
  const r = git(['worktree', 'list', '--porcelain'], { cwd, timeoutMs: 5000 });
  if (!r.ok) return null;
  const list = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: normalizePath(line.slice(9).trim()), head: null, branch: null, detached: false, bare: false };
      list.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (line.trim() === 'detached') {
      cur.detached = true;
    } else if (line.trim() === 'bare') {
      cur.bare = true;
    }
  }
  return list.map((w, i) => ({ ...w, isMain: i === 0 }));
}

function absoluteGitPath(cwd, flag) {
  const modern = out(['rev-parse', '--path-format=absolute', flag], cwd);
  if (modern) return modern;
  const legacy = out(['rev-parse', flag], cwd);
  return legacy ? resolve(cwd, legacy) : null;
}

export function worktreeInfo(cwd) {
  const path = repoRoot(cwd);
  if (!path) return null;
  const gitDir = absoluteGitPath(cwd, '--git-dir');
  const common = absoluteGitPath(cwd, '--git-common-dir');
  if (!gitDir || !common) return null;
  return {
    isWorktree: normalizePath(gitDir) !== normalizePath(common),
    mainRoot: normalizePath(dirname(common)),
    path,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/ship-faster/tests/git.test.mjs`
Expected: all pass, including the new test.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/lib/git.mjs plugins/ship-faster/tests/git.test.mjs
git commit -F <message file>
```

Message:

```
feat: git helpers list worktrees and tell a worktree from the main checkout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 2: `scripts/worktree.mjs` with `list` and `add`

**Files:**
- Create: `plugins/ship-faster/scripts/worktree.mjs`
- Create: `plugins/ship-faster/tests/worktree.test.mjs`
- Modify: `plugins/ship-faster/README.md` (Scripts block: one line after the `health.mjs` line)

**Interfaces:**
- Consumes: `worktrees`, `worktreeInfo`, `isRepo`, `branchExists`, `git` from `lib/git.mjs` (Task 1).
- Produces: `worktreePath(mainRoot, branch) → string`; `listWorktrees(root) → { ok, isWorktree, mainRoot, current, others, worktrees, summary }`; `addWorktree(root, { branch, from }) → { ok, path, branch, from, mainRoot, open, summary }`; CLI `node scripts/worktree.mjs list --json` and `node scripts/worktree.mjs add --branch <name> [--from <ref>] --json`.

- [ ] **Step 1: Write the failing test**

Create `plugins/ship-faster/tests/worktree.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { currentBranch } from '../scripts/lib/git.mjs';
import { addWorktree, listWorktrees, worktreePath } from '../scripts/worktree.mjs';

const extra = [];
after(() => { for (const p of extra) { try { rmSync(p, { recursive: true, force: true }); } catch {} } cleanupAll(); });

const norm = (p) => realpathSync.native(p).replace(/\\/g, '/').toLowerCase();

test('worktreePath is a sibling of the main checkout named after the branch', () => {
  assert.equal(worktreePath('/repos/tiny-api', 'feat/delete-users'), '/repos/tiny-api-feat-delete-users');
  assert.equal(worktreePath('C:/w/app', 'fix/x'), 'C:/w/app-fix-x');
});

test('add creates a sibling worktree on a new branch and list sees it from both sides', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const expected = join(dirname(root), `${basename(root)}-feat-x`);
  extra.push(expected);
  const r = addWorktree(root, { branch: 'feat/x', from: 'main' });
  assert.equal(r.ok, true, r.error);
  assert.equal(norm(r.path), norm(expected));
  assert.equal(r.branch, 'feat/x');
  assert.equal(norm(r.mainRoot), norm(root));
  assert.match(r.open, /^cd ".+" && claude$/);
  assert.ok(existsSync(join(r.path, 'a.txt')));
  assert.equal(currentBranch(r.path), 'feat/x');

  const fromMain = listWorktrees(root);
  assert.equal(fromMain.ok, true);
  assert.equal(fromMain.isWorktree, false);
  assert.equal(fromMain.current.branch, 'main');
  assert.deepEqual(fromMain.others.map((w) => w.branch), ['feat/x']);

  const fromWorktree = listWorktrees(r.path);
  assert.equal(fromWorktree.isWorktree, true);
  assert.equal(norm(fromWorktree.mainRoot), norm(root));
  assert.equal(fromWorktree.current.branch, 'feat/x');
  assert.deepEqual(fromWorktree.others.map((w) => w.branch), ['main']);
  assert.equal(fromWorktree.others[0].isMain, true);

  const again = addWorktree(root, { branch: 'feat/x', from: 'main' });
  assert.equal(again.ok, false);
  assert.match(again.error, /already exists/);
});

test('add rejects bad names, missing branches, and directories that are not repositories', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  assert.equal(addWorktree(root, { branch: '../evil' }).ok, false);
  assert.equal(addWorktree(root, { branch: '-x' }).ok, false);
  assert.equal(addWorktree(root, {}).ok, false);
  const missing = addWorktree(root, { branch: 'feat/y', from: 'nope' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /git worktree add failed/);
  assert.equal(addWorktree(tmpDir('sf-nogit-'), { branch: 'feat/z' }).ok, false);
  assert.equal(listWorktrees(tmpDir('sf-nogit-')).ok, false);
});

test('the CLI answers list and add with JSON and rejects an unknown command', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const list = runScript('worktree', ['list', '--root', root, '--json']);
  assert.equal(list.json.ok, true);
  assert.equal(list.json.others.length, 0);
  const unknown = runScript('worktree', ['nope', '--root', root, '--json']);
  assert.equal(unknown.json.ok, false);
  assert.match(unknown.json.error, /use list or add/);
  const added = runScript('worktree', ['add', '--branch', 'chore/cli', '--root', root, '--json']);
  extra.push(join(dirname(root), `${basename(root)}-chore-cli`));
  assert.equal(added.json.ok, true, JSON.stringify(added.json));
  assert.equal(currentBranch(added.json.path), 'chore/cli');
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test plugins/ship-faster/tests/worktree.test.mjs`
Expected: fails to import `../scripts/worktree.mjs`.

- [ ] **Step 3: Implement**

Create `plugins/ship-faster/scripts/worktree.mjs`:

```js
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function safeRef(name) {
  return typeof name === 'string' && SAFE_REF.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock');
}

export function worktreePath(mainRoot, branch) {
  const root = normalizePath(mainRoot).replace(/\/+$/, '');
  return normalizePath(join(dirname(root), `${basename(root)}-${branch.replace(/[\\/]+/g, '-')}`));
}

export function listWorktrees(root) {
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const info = git.worktreeInfo(root);
  const all = git.worktrees(root);
  if (!info || !all) return { ok: false, error: 'git worktree list failed' };
  const here = normalizePath(info.path).toLowerCase();
  const current = all.find((w) => w.path.toLowerCase() === here) || null;
  const others = all.filter((w) => w.path.toLowerCase() !== here);
  const label = (w) => `${w.branch || 'detached'}: ${w.path}${w.isMain ? ' (main checkout)' : ''}`;
  return {
    ok: true,
    isWorktree: info.isWorktree,
    mainRoot: info.mainRoot,
    current,
    others,
    worktrees: all,
    summary: [
      `${info.isWorktree ? `worktree of ${info.mainRoot}` : 'main checkout'} on ${current && current.branch ? current.branch : 'detached HEAD'}`,
      ...(others.length ? others.map(label) : ['no other worktrees']),
    ],
  };
}

export function addWorktree(root, { branch, from } = {}) {
  if (!safeRef(branch)) return { ok: false, error: 'add requires --branch <name> made of letters, digits, ., _, / and -' };
  if (from !== undefined && !safeRef(from)) return { ok: false, error: '--from must name a branch or ref' };
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const info = git.worktreeInfo(root);
  if (!info) return { ok: false, error: 'cannot resolve the main checkout' };
  if (git.branchExists(root, branch)) return { ok: false, error: `branch ${branch} already exists` };
  const path = worktreePath(info.mainRoot, branch);
  if (existsSync(path)) return { ok: false, error: `${path} already exists` };
  const args = ['worktree', 'add', path, '-b', branch];
  if (from) args.push(from);
  const r = git.git(args, { cwd: root, timeoutMs: 60000 });
  if (!r.ok) return { ok: false, error: `git worktree add failed: ${(r.stderr || r.stdout).trim()}` };
  const open = `cd "${path}" && claude`;
  return {
    ok: true,
    path,
    branch,
    from: from || null,
    mainRoot: info.mainRoot,
    open,
    summary: [`worktree ${path} on new branch ${branch}`, `open a session there: ${open}`],
  };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/worktree.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    if (positional[0] === 'list') return listWorktrees(root);
    if (positional[0] === 'add') {
      return addWorktree(root, {
        branch: typeof flags.branch === 'string' ? flags.branch : undefined,
        from: typeof flags.from === 'string' ? flags.from : undefined,
      });
    }
    return { ok: false, error: `unknown command ${positional[0]}; use list or add` };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/ship-faster/tests/worktree.test.mjs`
Expected: 4 tests pass. Then `node plugins/ship-faster/tests/validate.mjs` prints `validate: ok`.

- [ ] **Step 5: Document the script**

In `plugins/ship-faster/README.md`, inside the Scripts block, after the line that starts with `node scripts/health.mjs`, add:

```
node scripts/worktree.mjs      list | add --branch <name> [--from <ref>]: the repository's worktrees, and a new sibling worktree on a new branch
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/worktree.mjs plugins/ship-faster/tests/worktree.test.mjs plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: worktree script lists checkouts and adds a sibling worktree on a new branch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 3: `changes.mjs` reports the worktree state

**Files:**
- Modify: `plugins/ship-faster/scripts/changes.mjs` (result object)
- Test: `plugins/ship-faster/tests/changes.test.mjs` (append one test)

**Interfaces:**
- Consumes: `worktreeInfo` from `lib/git.mjs` (Task 1).
- Produces: `changes(root).worktree → { isWorktree, mainRoot, path } | null`; `ship` reads `worktree.isWorktree`, `worktree.mainRoot`, `worktree.path` (Task 6).

- [ ] **Step 1: Write the failing test**

Append to `plugins/ship-faster/tests/changes.test.mjs` (add `realpathSync` to its `node:fs` import and `basename`, `dirname`, `rmSync` handling as below; the file already has `join` and `makeRepo`):

```js
test('changes reports whether the checkout is a worktree and where the main checkout is', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a\n' } });
  const norm = (p) => realpathSync.native(p).replace(/\\/g, '/').toLowerCase();
  const main = changes(root, { config: DEFAULTS });
  assert.equal(main.worktree.isWorktree, false);
  assert.equal(norm(main.worktree.mainRoot), norm(root));
  const wt = join(tmpDir('sf-wt-'), 'feat-w');
  git(['worktree', 'add', wt, '-b', 'feat/w']);
  const inner = changes(wt, { config: DEFAULTS });
  assert.equal(inner.branch, 'feat/w');
  assert.equal(inner.worktree.isWorktree, true);
  assert.equal(norm(inner.worktree.mainRoot), norm(root));
  assert.equal(norm(inner.worktree.path), norm(wt));
});
```

`tmpDir` must be imported from `./helpers.mjs` if the file does not import it yet.

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test plugins/ship-faster/tests/changes.test.mjs`
Expected: the new test fails on `main.worktree` being undefined.

- [ ] **Step 3: Implement**

In `plugins/ship-faster/scripts/changes.mjs`, inside the `result` object literal, add after the `remote: git.remoteUrl(root),` line:

```js
    worktree: git.worktreeInfo(root),
```

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/ship-faster/tests/changes.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/changes.mjs plugins/ship-faster/tests/changes.test.mjs
git commit -F <message file>
```

Message:

```
feat: the branch inventory says whether the checkout is a worktree

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 4: session start names sibling worktrees and warns about a shared checkout

**Files:**
- Modify: `plugins/ship-faster/scripts/lib/state.mjs` (append `markSessionStart`, `liveSessions`)
- Modify: `plugins/ship-faster/scripts/hook-session-start.mjs`
- Test: `plugins/ship-faster/tests/state.test.mjs` (append one test)
- Test: `plugins/ship-faster/tests/hook-session-start.test.mjs` (append two tests)

**Interfaces:**
- Consumes: `worktrees`, `worktreeInfo`, `currentBranch`, `isRepo` from `lib/git.mjs` (Task 1); `updateSession`, `projectDir`, `readJson`, `safeId` (module-private, same file) in `lib/state.mjs`.
- Produces: `markSessionStart(root, sid, { branch, cwd }) → boolean`; `liveSessions(root, { exceptSid, maxAgeHours = 8 }) → Array<{ sid, branch, at }>`; two SessionStart lines whose exact text the tests below fix.

- [ ] **Step 1: Write the failing state test**

Append to `plugins/ship-faster/tests/state.test.mjs` (it already sets `CLAUDE_PLUGIN_DATA` in `beforeEach` and imports the module as `s` with `import * as s from '../scripts/lib/state.mjs'`):

```js
test('markSessionStart stamps the record and liveSessions lists other recent sessions only', () => {
  const root = tmpDir('sf-root-');
  assert.equal(s.markSessionStart(root, 'one', { branch: 'main', cwd: root }), true);
  const rec = s.loadSession(root, 'one');
  assert.equal(rec.branch, 'main');
  assert.equal(rec.cwd, root);
  assert.ok(Date.parse(rec.startedAt) > 0);
  assert.ok(Date.parse(rec.updatedAt) > 0);
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  s.writeJsonAtomic(s.sessionFile(root, 'stale'), { startedAt: old, updatedAt: old, branch: 'feat/old', pages: {} });
  s.writeJsonAtomic(s.sessionFile(root, 'two'), { startedAt: new Date().toISOString(), branch: 'feat/two', pages: {} });
  const live = s.liveSessions(root, { exceptSid: 'one' });
  assert.deepEqual(live.map((x) => x.sid).sort(), ['two']);
  assert.equal(live[0].branch, 'feat/two');
  assert.deepEqual(s.liveSessions(root, { exceptSid: 'two' }).map((x) => x.sid), ['one']);
  assert.deepEqual(s.liveSessions(root, { exceptSid: 'one', maxAgeHours: 48 }).map((x) => x.sid).sort(), ['stale', 'two']);
  assert.deepEqual(s.liveSessions(tmpDir('sf-empty-'), { exceptSid: 'x' }), []);
  s.markSessionStart(root, 'one', { branch: 'feat/renamed', cwd: root });
  assert.equal(s.loadSession(root, 'one').startedAt, rec.startedAt);
  assert.equal(s.loadSession(root, 'one').branch, 'feat/renamed');
});
```

- [ ] **Step 2: Write the failing hook tests**

Append to `plugins/ship-faster/tests/hook-session-start.test.mjs`:

```js
test('startup names the sibling worktrees from both sides and says nothing about them on compact', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const wt = join(tmpDir('sf-wt-'), 'feat-a');
  git(['worktree', 'add', wt, '-b', 'feat/a']);
  const fromMain = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  assert.equal(fromMain.code, 0);
  assert.match(fromMain.stdout, /^ship-faster: worktrees: this=main \(main checkout\); others=feat\/a$/m);
  const fromWorktree = hook({ session_id: 's2', cwd: wt, source: 'startup' }, wt);
  assert.match(fromWorktree.stdout, /^ship-faster: worktrees: this=feat\/a \(worktree of .+\); others=main$/m);
  assert.equal(hook({ session_id: 's', cwd: root, source: 'compact' }, root).stdout, '');
});

test('startup warns when another session used this checkout recently, and records its own start', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = hook({ session_id: 'first', cwd: root, source: 'startup' }, root);
  assert.equal(first.stdout, '');
  const rec = readJson(sessionFile(root, 'first'), null);
  assert.equal(rec.branch, 'main');
  assert.ok(Date.parse(rec.startedAt) > 0);
  const second = hook({ session_id: 'second', cwd: root, source: 'startup' }, root);
  assert.match(second.stdout, /^ship-faster: another session started .+ ago in this checkout \(branch main\); for parallel work start a second session with claude --worktree\.$/m);
  const resumed = hook({ session_id: 'first', cwd: root, source: 'resume' }, root);
  assert.match(resumed.stdout, /another session/);
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  writeJsonAtomic(sessionFile(root, 'second'), { startedAt: old, updatedAt: old, branch: 'main', pages: {} });
  const later = hook({ session_id: 'third', cwd: root, source: 'startup' }, root);
  assert.doesNotMatch(later.stdout, /second/);
  assert.match(later.stdout, /another session/);
});
```

The second test's last assertion holds because `first` is still recent; add `readJson`, `sessionFile` to the test file's import from `../scripts/lib/state.mjs`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `node --test plugins/ship-faster/tests/state.test.mjs` and `node --test plugins/ship-faster/tests/hook-session-start.test.mjs`
Expected: the new tests fail (`markSessionStart is not a function`; hook output lacks the lines).

- [ ] **Step 4: Implement the state helpers**

Append to `plugins/ship-faster/scripts/lib/state.mjs`:

```js
export function markSessionStart(root, sid, { branch = null, cwd = null } = {}) {
  const now = new Date().toISOString();
  return updateSession(root, sid, (record) => {
    record.startedAt = record.startedAt || now;
    record.updatedAt = now;
    record.branch = branch;
    record.cwd = cwd;
  });
}

export function liveSessions(root, { exceptSid, maxAgeHours = 8 } = {}) {
  const dir = join(projectDir(root), 'sessions');
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const own = `${safeId(exceptSid)}.json`;
  const live = [];
  for (const name of names) {
    if (name === own) continue;
    const rec = readJson(join(dir, name), null);
    const at = rec && typeof rec === 'object' ? Date.parse(rec.updatedAt || rec.startedAt || '') : NaN;
    if (Number.isNaN(at) || at < cutoff) continue;
    live.push({ sid: name.replace(/\.json$/, ''), branch: typeof rec.branch === 'string' ? rec.branch : null, at: new Date(at).toISOString() });
  }
  return live.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
```

- [ ] **Step 5: Implement the hook lines**

In `plugins/ship-faster/scripts/hook-session-start.mjs`:

Change the state import to:

```js
import { liveSessions, markSessionStart, projectDir, readJson } from './lib/state.mjs';
```

Replace the block that begins `if (hasWiki) {` and ends before `const text = capOutput(lines, MAX);` with:

```js
  const startup = source === 'startup' || source === 'resume';
  const inRepo = git.isRepo(root);
  const branch = inRepo ? git.currentBranch(root) : null;
  if (startup && inRepo) {
    const sid = typeof input.session_id === 'string' && input.session_id ? input.session_id : 'default';
    const others = liveSessions(root, { exceptSid: sid, maxAgeHours: 8 });
    markSessionStart(root, sid, { branch, cwd });
    if (others.length) {
      const newest = others[0];
      lines.push(`ship-faster: another session started ${ago(newest.at)} ago in this checkout (branch ${newest.branch || 'unknown'}); for parallel work start a second session with claude --worktree.`);
    }
  }

  if (hasWiki) {
    const s = stale(root, { config });
    const notFresh = s.pages.filter((p) => p.status !== 'fresh').map((p) => p.rel.split('/').pop().replace(/\.md$/, ''));
    let line = `ship-faster: wiki at ${config.wikiDir}/index.md (${pages.length} pages).`;
    line += notFresh.length ? ` Stale: ${notFresh.length} (${notFresh.slice(0, 4).join(', ')}${notFresh.length > 4 ? ', …' : ''}) → /ship-faster:sync-docs.` : ' All pages fresh.';
    const rulesDir = join(root, ...config.rulesDir.split('/'));
    const rules = existsSync(rulesDir) && statSync(rulesDir).isDirectory() ? readdirSync(rulesDir).filter((n) => n.endsWith('.md')).length : 0;
    if (rules) line += ` Rules: ${config.rulesDir} (${rules} files).`;
    lines.unshift(line);
    if (startup) {
      if (branch) {
        const { plan } = findPlan(root, { config, branch });
        if (plan) lines.push(`ship-faster: active plan for branch ${branch}: ${plan.rel}`);
      }
    }
  } else if (source === 'startup' && !existsSync(join(root, 'CLAUDE.md')) && inRepo) {
    const n = git.trackedFiles(root).length;
    if (n >= 20) lines.push(`ship-faster: no CLAUDE.md or ${config.wikiDir} here (${n} tracked files). /ship-faster:onboard generates them.`);
  }

  if (startup && inRepo) {
    const siblings = git.worktrees(root);
    if (siblings && siblings.length > 1) {
      const info = git.worktreeInfo(root);
      const here = info ? info.path.toLowerCase() : '';
      const others = siblings.filter((w) => w.path.toLowerCase() !== here).map((w) => w.branch || 'detached');
      const where = info && info.isWorktree ? `worktree of ${info.mainRoot}` : 'main checkout';
      lines.push(`ship-faster: worktrees: this=${branch || 'detached'} (${where}); others=${others.join(', ')}`);
    }
    if (hasWiki) {
      const health = healthLine(root, config);
      if (health) lines.push(health);
    }
  }
```

Add this helper next to `capOutput`:

```js
function ago(iso) {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} h`;
}
```

The wiki line stays first (`unshift`), the shared-checkout warning second, then the plan, the worktrees, and health; `capOutput` drops from the end.

- [ ] **Step 6: Run the tests**

Run: `node --test plugins/ship-faster/tests/state.test.mjs`, `node --test plugins/ship-faster/tests/hook-session-start.test.mjs`, `node --test plugins/ship-faster/tests/hook-session-end.test.mjs` if it exists, then `node plugins/ship-faster/tests/run.mjs`
Expected: all pass. The existing session-start test that expects three lines (wiki, plan, health) still passes because a repository without worktrees or other sessions prints nothing new.

Then: `node plugins/ship-faster/tests/bench.mjs`
Expected: `hook-session-start` median under 1500 ms (the two added git calls cost about 40 ms each).

- [ ] **Step 7: Commit**

```bash
git add plugins/ship-faster/scripts/lib/state.mjs plugins/ship-faster/scripts/hook-session-start.mjs plugins/ship-faster/tests/state.test.mjs plugins/ship-faster/tests/hook-session-start.test.mjs
git commit -F <message file>
```

Message:

```
feat: session start names sibling worktrees and warns when a checkout is shared

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 5: `kickoff --worktree`, with an eval case

**Files:**
- Modify: `plugins/ship-faster/skills/kickoff/SKILL.md`
- Create: `plugins/ship-faster/evals/kickoff-worktree/prompt.md`, `case.yaml`, `scaffold.sh` (byte-for-byte copy of `plugins/ship-faster/evals/kickoff/scaffold.sh`), `graders/worktree-added.md`, `graders/no-switch.md`, `graders/plan-elsewhere.md`, `graders/report.md`
- Modify: `plugins/ship-faster/README.md` (kickoff row of the Skills table)

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree.mjs" add --branch <name> --from <default> --json` → `{ ok, path, branch, open }` (Task 2); `lint.mjs --root <path>`.
- Produces: the `--worktree` flag; the report line `Worktree: <path> (open it with: cd "<path>" && claude)`.

- [ ] **Step 1: Edit the skill frontmatter and preamble**

In `plugins/ship-faster/skills/kickoff/SKILL.md` replace

```
argument-hint: "<feature description> [--no-branch]"
```

with

```
argument-hint: "<feature description> [--no-branch|--worktree]"
```

and replace the sentence `The feature description is every argument except `--no-branch`.` with:

```
The feature description is every argument except `--no-branch` and `--worktree`. `--worktree` puts the branch in its own checkout next to this one, so a second session can work on it while this one continues; `--no-branch` and `--worktree` together contradict each other: stop with one line.
```

- [ ] **Step 2: Rewrite steps 2 to 5**

Replace everything from `## 2. Write the plan` to the end of the file with:

````markdown
## 2. Draft the plan

Copy `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`, replace every placeholder, delete the comments, and follow these rules:

- **Goal**: one paragraph naming the outcome and how it is verified.
- **Scope**: the complete feature. Nothing deferred to later. Bullet what is out and why.
- **Touchpoints**: ordered. Every path exists (confirm each with Glob) or is marked `(new)`. One clause per path on what changes. Order follows the recipe when one applies.
- **Tests to add**: the framework and directory from `testing.md`, one bullet per behaviour.
- **Docs impact**: every page whose `covers` matches a touchpoint (read the `covers` in each page's frontmatter), with the claim that will change.
- **Risks**: quote the applicable gotchas by id and rule line; add integration and data risks you can name.
- **Verification**: the commands from the `checks` list, in order, plus the single test that proves the feature.

Frontmatter: `title`, `branch` (from step 3), `status: active`, `created` today, `pages` (the pages you read, as `name` or `recipes/<name>`). The file name is `<yyyy-mm-dd>-<slug>.md`, slug 2 to 5 lowercase words joined by hyphens. Hold the text; step 4 writes it where the branch lives.

## 3. Branch or worktree

Name: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, or `test/` plus the slug, chosen by the change's nature. Print it. When `<default>` is null (no git or no default branch) skip this step and say so.

With `--no-branch`: skip this step.

Without `--worktree`:

```
git rev-parse --verify --quiet <name>
```

If that succeeds the name is taken: append `-2`, `-3`, and so on. Then:

```
git switch -c <name> <default>
```

Uncommitted changes travel with the switch; do not stash or commit them.

With `--worktree`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree.mjs" add --branch <name> --from <default> --json
```

`ok: false` because the branch exists: append `-2`, `-3`, and so on and retry; any other `ok: false`: print the error and stop without writing the plan. Note `path` and `open`. The new checkout starts clean at `<default>`; uncommitted changes in this checkout stay here, and say so when `git status --porcelain` is not empty.

## 4. Write the plan and lint

Write the plan to `<plansDir>/<yyyy-mm-dd>-<slug>.md` in this checkout, or, with `--worktree`, to `<path>/<plansDir>/<yyyy-mm-dd>-<slug>.md` so the plan lives on its branch. Then:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

with `--root <path>` appended in the worktree case. Fix any error in the plan's frontmatter.

## 5. Report

Three lines: the plan path, the branch (or "no branch"), and the first touchpoint. With `--worktree`, a fourth line: `Worktree: <path> (open it with: <open>)`.

## 6. Show the plan

Print the plan file in full, inside one fenced block, so the user reads it before starting. It is the last thing you print: no summary, note, or offer after it.
````

- [ ] **Step 3: Write the eval case**

`plugins/ship-faster/evals/kickoff-worktree/prompt.md` (no blank line between the closing `---` and the body):

```markdown
---
description: kickoff --worktree writes the plan into a new sibling worktree on a feature branch and leaves the current checkout on main
tags: [kickoff, shipping, worktree]
runs: 3
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---
/ship-faster:kickoff add a DELETE /users/:id endpoint that returns 204 and 404 for a missing id --worktree
```

`plugins/ship-faster/evals/kickoff-worktree/case.yaml`:

```yaml
schema_version: "1.1"
name: kickoff-worktree
context:
  scaffold_script: scaffold.sh
```

`plugins/ship-faster/evals/kickoff-worktree/scaffold.sh`: copy `plugins/ship-faster/evals/kickoff/scaffold.sh` byte for byte (`cp`), so the fixture is the same tiny-api repository with its wiki, recipe, and gotcha.

`plugins/ship-faster/evals/kickoff-worktree/graders/worktree-added.md`:

```markdown
---
type: tool_used
tool: Bash
input_match: 'worktree\.mjs.*\badd\b.*--branch feat/'
---
```

`plugins/ship-faster/evals/kickoff-worktree/graders/no-switch.md`:

```markdown
---
type: tool_used
tool: Bash
input_match: 'git (switch -c|checkout -b)'
min: 0
max: 0
---
```

`plugins/ship-faster/evals/kickoff-worktree/graders/plan-elsewhere.md`:

```markdown
---
type: file_exists
path: docs/plans/*.md
exists: false
---
```

`plugins/ship-faster/evals/kickoff-worktree/graders/report.md`:

```markdown
---
type: llm
weight: 3
---
The final answer reports a plan path, a branch, a worktree, and then prints the plan. PASS when all of the following hold:
- The worktree line names a directory whose name ends with the branch name with slashes turned into hyphens (for example a path ending in `-feat-delete-users-endpoint`), and gives a command to open a session there (`cd "<path>" && claude`).
- The plan path is inside that worktree directory, under docs/plans/.
- The printed plan has the sections Goal, Scope, Touchpoints, Tests to add, Docs impact, Risks, and Verification, and its Touchpoints name src/lib/db.js, src/routes/users.js, and tests/users.test.js.
- The Risks section mentions the gotcha g-20260101-route-order or its rule about adding routes above the final 404.
FAIL when no worktree is reported, when the plan was written into the current checkout instead of the worktree, when a plan section is missing, or when the answer says it switched the current checkout to the new branch.
```

- [ ] **Step 4: Update the README row**

In `plugins/ship-faster/README.md` Skills table, change the kickoff row's Invoke cell to `` `/ship-faster:kickoff <feature> [--no-branch|--worktree]` `` and append to its description: `` `--worktree` creates the branch in a sibling checkout (`<repo>-<branch>`) and writes the plan there, so a second session can take the ticket while this one continues. ``

- [ ] **Step 5: Validate**

Run: `node plugins/ship-faster/tests/validate.mjs`, `claude plugin validate --strict plugins/ship-faster`, `node --test plugins/ship-faster/tests/validate.test.mjs`, `node plugins/ship-faster/scripts/lint.mjs`, `wc -l plugins/ship-faster/skills/kickoff/SKILL.md`, and `node -e "const b=require('fs').readFileSync('plugins/ship-faster/evals/kickoff-worktree/scaffold.sh');console.log(b.slice(0,3).toString('hex'), b.includes('\r'), b.slice(-1).toString('hex'))"` printing `23212f false 0a`.
Expected: all pass; SKILL.md under 500 lines.

Also run the scaffold in a scratch directory and confirm `node plugins/ship-faster/scripts/worktree.mjs add --branch feat/probe --from main --root <that dir> --json` returns `ok: true` with a sibling path, then delete both directories.

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/skills/kickoff/SKILL.md plugins/ship-faster/evals/kickoff-worktree plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: kickoff --worktree starts the ticket in a sibling worktree

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 6: `ship` finishes a worktree, and plans live on their branch

**Files:**
- Modify: `plugins/ship-faster/skills/ship/SKILL.md` (step 10)
- Modify: `plugins/ship-faster/skills/ship/reference/commit-and-pr.md` (Push and PR step 2; Merge step 3)
- Modify: `plugins/ship-faster/skills/health/reference/areas.md` (plans row)
- Modify: `plugins/ship-faster/README.md` (ship row; new section)

**Interfaces:**
- Consumes: `worktree.isWorktree`, `worktree.mainRoot`, `worktree.path` from the inventory `changes.mjs` injects (Task 3).

- [ ] **Step 1: Ship report and reference**

In `plugins/ship-faster/skills/ship/SKILL.md`, replace the `## 10. Report` section with:

```markdown
## 10. Report

Three lines: the PR URL (or the compare URL and body path when there is no `gh`), the checks status, and what was not done (a step you stopped before, with the command to run). When the inventory's `worktree.isWorktree` is true, a fourth line gives the worktree cleanup commands from reference/commit-and-pr.md, section Worktrees; never run them from inside the worktree.
```

In `plugins/ship-faster/skills/ship/reference/commit-and-pr.md`, replace the Merge section's step 3 with:

```markdown
3. Report the merge commit. Outside a worktree, remind that the local branch can be deleted with `git branch -d <branch>` after `git switch <base>` and `git pull --ff-only`. Inside a worktree (`worktree.isWorktree` in the inventory), print the commands from the Worktrees section instead; the plan marked shipped reaches the main checkout with the pull.
```

and append this section at the end of the file:

```markdown
## Worktrees

When the inventory says `worktree.isWorktree`, this checkout is a worktree of `worktree.mainRoot` at `worktree.path`. Print these commands for the user to run from the main checkout once the PR needs no more work (after the merge with `--merge`); do not run them here, because a worktree cannot remove itself while a session sits in it:

```
git -C "<mainRoot>" pull --ff-only
git -C "<mainRoot>" worktree remove "<path>"
git -C "<mainRoot>" branch -d <branch>
```

Say that the pull is for when the main checkout is on `<base>`, and that the second command refuses while the worktree has uncommitted changes.
```

- [ ] **Step 2: Plans on their branch**

In `plugins/ship-faster/skills/health/reference/areas.md`, replace the plans row's text after `Script only:` with:

```
`scan.plans` (active plans whose branch is merged or gone for 30 days). A plan whose branch is checked out in another worktree is live, not gone; plans written by `kickoff --worktree` live on their branch and reach this checkout when the PR merges. Fix: archive with `plan.mjs set-status <rel> abandoned` (safe). Effort S.
```

- [ ] **Step 3: README**

In `plugins/ship-faster/README.md`, append to the ship row's description: `` In a worktree, the report ends with the commands that remove the worktree and its branch from the main checkout. ``

After the Skills table's closing paragraph (the one that starts `Every skill runs the plugin's scripts`), add:

```markdown
## Several tickets at once

One session per worktree, one worktree per ticket. From the main checkout:

```
/ship-faster:kickoff <ticket description> --worktree
```

writes the plan into a new sibling checkout (`<repo>-<branch>`) on a new branch and prints the command to open a session there. Work and `/ship-faster:ship` in that session; the PR belongs to that branch alone. Session start in either checkout names the other worktrees, and warns when two sessions share one checkout, because one working tree holds one branch. Plans live on their branch (`docs/plans/` in the worktree) until the PR merges. After the merge, ship prints the `git worktree remove` and `git branch -d` commands to run from the main checkout.
```

- [ ] **Step 4: Validate**

Run: `node plugins/ship-faster/tests/validate.mjs`, `claude plugin validate --strict plugins/ship-faster`, `node plugins/ship-faster/scripts/lint.mjs`, `wc -l plugins/ship-faster/skills/ship/SKILL.md`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/skills/ship/SKILL.md plugins/ship-faster/skills/ship/reference/commit-and-pr.md plugins/ship-faster/skills/health/reference/areas.md plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: ship prints the worktree cleanup commands and plans live on their branch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 7: Wiki, changelog, and verification

**Files:**
- Modify: `docs/wiki/architecture.md` (Components table CLI scripts cell; Data flow shipping list; Session hooks item 1)
- Modify: `docs/wiki/testing.md` (Eval cases paragraph)
- Modify: `docs/wiki/recipes/add-a-skill.md` (step 6)
- Modify: `plugins/ship-faster/CHANGELOG.md` (`[Unreleased]`)
- Re-verify every page the commits above made stale.

- [ ] **Step 1: Wiki**

`docs/wiki/architecture.md`:
- In the Components table, CLI scripts cell: replace `changes, version, changelog, review, health;` with `changes, version, changelog, review, health, worktree;`.
- In the Shipping skills list, replace item 5's kickoff clause `` `kickoff` reads the wiki, writes a plan from `templates/plan.md`, and creates the branch. `` with `` `kickoff` reads the wiki, writes a plan from `templates/plan.md`, and creates the branch, or with `--worktree` a sibling checkout through `worktree.mjs add` and writes the plan there. ``
- In Session hooks item 1, after `or an onboard suggestion.` append: ` It records the session's start in its session record, warns when another session used this checkout in the last 8 hours (`liveSessions` in `lib/state.mjs`), and names the other worktrees (`worktrees` in `lib/git.mjs`).`

`docs/wiki/testing.md`, Eval cases paragraph: append the sentence `A skill may have more than one case (`evals/kickoff-worktree/` covers `kickoff --worktree`); the validator only requires that every skill has at least the case named after it.`

`docs/wiki/recipes/add-a-skill.md`, step 6: append the sentence `Extra cases for a flag live in their own directory named `<skill>-<flag>`, with a unique `name` in `case.yaml`.`

- [ ] **Step 2: Changelog**

Under `## [Unreleased]` in `plugins/ship-faster/CHANGELOG.md`, add before the existing `### Added` bullet list (create the heading if absent):

```markdown
- `kickoff --worktree` creates a sibling worktree on the new branch and writes the plan there, so one session per ticket can run in parallel; `ship` prints the worktree cleanup commands after the merge; session start names the other worktrees and warns when two sessions share one checkout.
- `scripts/worktree.mjs` (`list`, `add`) and the `worktree` field of the branch inventory.
```

- [ ] **Step 3: Verify and re-stamp**

Run: `node plugins/ship-faster/tests/run.mjs`, `node plugins/ship-faster/tests/validate.mjs`, `node plugins/ship-faster/scripts/lint.mjs`, `node plugins/ship-faster/scripts/index.mjs --check`, `claude plugin validate --strict plugins/ship-faster`, `node plugins/ship-faster/tests/bench.mjs`.

Then list the pages that are not fresh (`node plugins/ship-faster/scripts/stale.mjs --json`), confirm each one's text is still true after the commits above (architecture, conventions, gotchas, layout, ops, testing, add-a-script, add-a-skill are the likely ones), fix any sentence that is not, and re-stamp them all with `node plugins/ship-faster/scripts/page.mjs verify <pages> --json`; `node plugins/ship-faster/scripts/stale.mjs` must then report every page fresh.

- [ ] **Step 4: Commit**

```bash
git add docs/wiki plugins/ship-faster/CHANGELOG.md
git commit -F <message file>
```

Message:

```
docs: worktree support in the wiki and changelog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 8: Evals after the merge (controller step)

After `superpowers:finishing-a-development-branch` merges the branch into `main`, run from the main checkout:

```
.\plugins\ship-faster\tests\evals.ps1 kickoff-worktree
.\plugins\ship-faster\tests\evals.ps1 kickoff
.\plugins\ship-faster\tests\evals.ps1 ship
.\plugins\ship-faster\tests\evals.ps1 health
```

Expected: every case at or above 0.8. A failing `kickoff-worktree` run is read from its trace (`--keep-temp` is on in the runner) before any grader or skill edit. Then `/ship-faster:release minor` (0.2.0), push `main` and the tag, `claude plugin marketplace update ship-faster` and `claude plugin update ship-faster@ship-faster`, and update the handbook artifact with a "Several tickets at once" section.

---

## Plan self-review notes

- Spec coverage: D1 (Task 5), D2 (Task 6), D3 (Task 4), D4 (Task 6 areas row and README; plan files are written on the branch by Task 5), D5 (Task 4); scripts (Tasks 1 to 3) follow spec section 9's JSON contract; hooks stay silent and bounded (Task 4, bench check in Task 7); evals (Task 5 case, Task 8 runs).
- Names used across tasks: `worktrees`, `worktreeInfo` (Task 1; used by Tasks 2, 3, 4); `worktreePath`, `listWorktrees`, `addWorktree`, CLI `list`/`add` with `--branch`/`--from` (Task 2; used by Task 5); `changes().worktree` with `isWorktree`, `mainRoot`, `path` (Task 3; used by Task 6); `markSessionStart`, `liveSessions` (Task 4).
- Rulings made while writing: R-W1 the worktree directory is a sibling of the main checkout named `<basename>-<branch with / → ->`, not `.claude/worktrees/`, so it never shows up untracked inside the repository and needs no ignore entry (cost if wrong: a different path convention later, one script function); R-W2 the plugin never removes a worktree, it prints the commands, because a session cannot delete its own working directory (cost if wrong: one manual command per ticket); R-W3 the shared-checkout warning uses an 8-hour window on the session record's last update, which the drift marker refreshes on every edit, so a crashed session stops triggering it the same day (cost if wrong: a false warning for one day); R-W4 `kickoff --worktree` writes the plan in the worktree rather than the current checkout, which is what makes plans live on their branch (cost if wrong: a plan the main checkout cannot see until the merge, by design).
