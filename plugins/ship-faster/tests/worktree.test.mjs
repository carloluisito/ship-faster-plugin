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
  assert.deepEqual(r.open, [`cd "${r.path}"`, 'claude']);
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
