import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { currentBranch, dirtyFiles } from '../scripts/lib/git.mjs';
import { loadEdits, recordEdit } from '../scripts/lib/state.mjs';
import { addWorktree, carryFiles, clearFiles, listWorktrees, worktreePath } from '../scripts/worktree.mjs';

const extra = [];
after(() => { for (const p of extra) { try { rmSync(p, { recursive: true, force: true }); } catch {} } cleanupAll(); });
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const lf = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const commitIn = (cwd, message) => {
  for (const args of [['add', '-A'], ['commit', '-q', '-m', message]]) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } });
    assert.equal(r.status, 0, r.stderr);
  }
};
const claimsOf = (root, sid) => Object.keys((loadEdits(root).find((e) => e.sid === sid) || { files: {} }).files).sort();
const later = () => new Date(Date.now() + 5000).toISOString();

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
  assert.match(unknown.json.error, /use list, add, carry, or clear/);
  const added = runScript('worktree', ['add', '--branch', 'chore/cli', '--root', root, '--json']);
  extra.push(join(dirname(root), `${basename(root)}-chore-cli`));
  assert.equal(added.json.ok, true, JSON.stringify(added.json));
  assert.equal(currentBranch(added.json.path), 'chore/cli');
});

test('carry copies changed files and deletions into the worktree; clear restores them here and drops every claim on them', () => {
  const { root } = makeRepo({ files: { 'src/a.js': 'a\n', 'src/gone.js': 'g\n', 'other.txt': 'o\n' } });
  const wt = worktreePath(root, 'feat/carry');
  extra.push(wt);
  writeFileSync(join(root, 'src', 'a.js'), 'a2\n');
  mkdirSync(join(root, 'src', 'new'), { recursive: true });
  writeFileSync(join(root, 'src', 'new', 'b.js'), 'b\n');
  rmSync(join(root, 'src', 'gone.js'));
  writeFileSync(join(root, 'other.txt'), 'another session\n');
  recordEdit(root, 'me', 'src/a.js', { at: later() });
  recordEdit(root, 'them', 'src/a.js', { at: later() });
  recordEdit(root, 'them', 'other.txt', { at: later() });
  assert.equal(addWorktree(root, { branch: 'feat/carry', from: 'HEAD' }).ok, true);

  const carried = carryFiles(root, { to: wt, files: ['src/a.js', 'src/new/b.js', 'src/gone.js', 'nope/missing.js', '../escape.js', '.git/config'] });
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.copied, ['src/a.js', 'src/new/b.js']);
  assert.deepEqual(carried.deleted, ['src/gone.js']);
  assert.deepEqual(carried.skipped.map((s) => s.path), ['nope/missing.js', '../escape.js', '.git/config']);
  assert.equal(lf(join(wt, 'src', 'a.js')), 'a2\n');
  assert.equal(existsSync(join(wt, 'src', 'gone.js')), false);
  assert.equal(lf(join(wt, 'other.txt')), 'o\n');
  assert.match(clearFiles(root, { from: wt, files: ['src/a.js'] }).error, /no commit beyond/);

  commitIn(wt, 'feat: carried');
  const cleared = clearFiles(root, { from: wt, files: ['src/a.js', 'src/new/b.js', 'src/gone.js', 'other.txt'], session: 'me' });
  assert.equal(cleared.ok, true, cleared.error);
  assert.deepEqual([...cleared.cleared].sort(), ['src/a.js', 'src/gone.js', 'src/new/b.js']);
  assert.deepEqual(cleared.unchanged, ['other.txt']);
  assert.deepEqual(cleared.kept, []);
  assert.equal(lf(join(root, 'src', 'a.js')), 'a\n');
  assert.equal(existsSync(join(root, 'src', 'new', 'b.js')), false);
  assert.equal(lf(join(root, 'src', 'gone.js')), 'g\n');
  assert.equal(lf(join(root, 'other.txt')), 'another session\n');
  assert.deepEqual(dirtyFiles(root).map((d) => d.path), ['other.txt']);
  assert.deepEqual(claimsOf(root, 'me'), []);
  assert.deepEqual(claimsOf(root, 'them'), ['other.txt']);
});

test('clear takes only the shipped hunk out of a file another session also changed and keeps a file edited after carrying', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const { root } = makeRepo({ files: { 'shared.txt': lines, 'late.txt': 'x\n' } });
  const wt = worktreePath(root, 'feat/partial');
  extra.push(wt);
  writeFileSync(join(root, 'shared.txt'), lines.replace('line 2\n', 'line 2 mine\n').replace('line 28\n', 'line 28 theirs\n'));
  writeFileSync(join(root, 'late.txt'), 'y\n');
  recordEdit(root, 'me', 'shared.txt', { at: later() });
  recordEdit(root, 'them', 'shared.txt', { at: later() });
  assert.equal(addWorktree(root, { branch: 'feat/partial', from: 'HEAD' }).ok, true);
  assert.equal(carryFiles(root, { to: wt, files: ['shared.txt', 'late.txt'] }).copied.length, 2);
  writeFileSync(join(wt, 'shared.txt'), lines.replace('line 2\n', 'line 2 mine\n'));
  commitIn(wt, 'feat: mine only');
  writeFileSync(join(root, 'late.txt'), 'z\n');

  const r = clearFiles(root, { from: wt, files: ['shared.txt', 'late.txt'], session: 'me' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.partial, ['shared.txt']);
  assert.deepEqual(r.kept.map((k) => k.path), ['late.txt']);
  assert.equal(lf(join(root, 'shared.txt')), lines.replace('line 28\n', 'line 28 theirs\n'));
  assert.equal(lf(join(root, 'late.txt')), 'z\n');
  assert.deepEqual(claimsOf(root, 'me'), []);
  assert.deepEqual(claimsOf(root, 'them'), ['shared.txt']);
});

test('the partial clear keeps CRLF line endings of a working tree file', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join('\n') + '\n';
  const { root } = makeRepo({ files: { 'crlf.txt': lines } });
  const wt = worktreePath(root, 'feat/crlf');
  extra.push(wt);
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  writeFileSync(join(root, 'crlf.txt'), crlf(lines.replace('row 1\n', 'row 1 mine\n').replace('row 19\n', 'row 19 theirs\n')));
  assert.equal(addWorktree(root, { branch: 'feat/crlf', from: 'HEAD' }).ok, true);
  carryFiles(root, { to: wt, files: ['crlf.txt'] });
  writeFileSync(join(wt, 'crlf.txt'), crlf(lines.replace('row 1\n', 'row 1 mine\n')));
  commitIn(wt, 'feat: crlf');
  const r = clearFiles(root, { from: wt, files: ['crlf.txt'] });
  assert.deepEqual(r.partial, ['crlf.txt'], JSON.stringify(r));
  assert.equal(readFileSync(join(root, 'crlf.txt'), 'utf8'), crlf(lines.replace('row 19\n', 'row 19 theirs\n')));
});

test('carry and clear refuse a path that is not another worktree of this repository, and the CLI runs both', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const { root: stranger } = makeRepo({ files: { 'a.txt': 'a\n' } });
  assert.match(carryFiles(root, { to: stranger, files: ['a.txt'] }).error, /not a worktree of this repository/);
  assert.match(carryFiles(root, { to: root, files: ['a.txt'] }).error, /is this checkout/);
  assert.match(carryFiles(root, { files: ['a.txt'] }).error, /worktree path is required/);
  assert.match(clearFiles(root, { from: stranger, files: ['a.txt'] }).error, /not a worktree of this repository/);
  assert.equal(carryFiles(tmpDir('sf-nogit-'), { to: root, files: [] }).ok, false);

  const wt = worktreePath(root, 'feat/cli-carry');
  extra.push(wt);
  writeFileSync(join(root, 'a.txt'), 'changed\n');
  assert.equal(runScript('worktree', ['add', '--branch', 'feat/cli-carry', '--from', 'HEAD', '--root', root, '--json']).json.ok, true);
  const carried = runScript('worktree', ['carry', 'a.txt', '--to', wt, '--root', root, '--json']);
  assert.deepEqual(carried.json.copied, ['a.txt']);
  commitIn(wt, 'chore: cli');
  const cleared = runScript('worktree', ['clear', 'a.txt', '--from', wt, '--root', root, '--json']);
  assert.deepEqual(cleared.json.cleared, ['a.txt'], JSON.stringify(cleared.json));
  assert.equal(lf(join(root, 'a.txt')), 'a\n');
});

test('carrying a staged rename as a pair commits the rename and clear leaves this checkout clean', () => {
  const { root, git } = makeRepo({ files: { 'old.js': 'o\n', 'keep.txt': 'k\n' } });
  const wt = worktreePath(root, 'feat/rename');
  extra.push(wt);
  git(['mv', 'old.js', 'new.js']);
  assert.equal(addWorktree(root, { branch: 'feat/rename', from: 'HEAD' }).ok, true);
  const carried = carryFiles(root, { to: wt, files: ['new.js', 'old.js'] });
  assert.deepEqual([carried.copied, carried.deleted], [['new.js'], ['old.js']]);
  commitIn(wt, 'refactor: rename');
  const cleared = clearFiles(root, { from: wt, files: ['new.js', 'old.js'] });
  assert.deepEqual([...cleared.cleared].sort(), ['new.js', 'old.js'], JSON.stringify(cleared));
  assert.deepEqual(dirtyFiles(root), []);
  assert.equal(lf(join(root, 'old.js')), 'o\n');
  assert.equal(existsSync(join(root, 'new.js')), false);
  assert.match(git(['-C', wt, 'show', '--name-status', '--format=', 'HEAD']), /^R\d*\s+old\.js\s+new\.js$/m);
});
