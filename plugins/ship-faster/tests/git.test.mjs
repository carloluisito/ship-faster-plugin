import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, tmpDir, cleanupAll } from './helpers.mjs';
import * as g from '../scripts/lib/git.mjs';

after(cleanupAll);

const norm = (p) => realpathSync(p).replace(/\\/g, '/').toLowerCase();

test('isRepo, repoRoot, head, commitExists, currentBranch, defaultBranch', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  assert.equal(g.isRepo(root), true);
  assert.equal(g.isRepo(tmpDir()), false);
  assert.equal(norm(g.repoRoot(join(root))), norm(root));
  const sha = g.head(root);
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(g.commitExists(root, sha), true);
  assert.equal(g.commitExists(root, 'deadbeef'), false);
  assert.equal(g.currentBranch(root), 'main');
  assert.equal(g.defaultBranch(root), 'main');
  git(['checkout', '-q', sha]);
  assert.equal(g.currentBranch(root), null);
});

test('changedSince, dirtyFiles, trackedFiles, log', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n', 'src/b.ts': 'b\n' } });
  const first = g.head(root);
  writeFileSync(join(root, 'src', 'b.ts'), 'b2\n');
  writeFileSync(join(root, 'c.md'), 'c\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: change b and add c']);
  assert.deepEqual(g.changedSince(root, first).sort(), ['c.md', 'src/b.ts']);
  assert.equal(g.changedSince(root, 'deadbeef'), null);
  writeFileSync(join(root, 'a.txt'), 'a2\n');
  writeFileSync(join(root, 'new.txt'), 'n\n');
  const dirty = g.dirtyFiles(root).map((d) => d.path).sort();
  assert.deepEqual(dirty, ['a.txt', 'new.txt']);
  const impatient = g.dirtyFiles(root, { timeoutMs: 1 });
  assert.ok(Array.isArray(impatient));
  assert.ok(impatient.length === 0 || impatient.map((d) => d.path).sort().join() === 'a.txt,new.txt');
  assert.deepEqual(g.trackedFiles(root).sort(), ['a.txt', 'c.md', 'src/b.ts']);
  const log = g.log(root, { n: 10 });
  assert.equal(log.length, 2);
  assert.equal(log[0].subject, 'feat: change b and add c');
  assert.deepEqual(log[0].files.sort(), ['c.md', 'src/b.ts']);
  assert.deepEqual(log[1].files.sort(), ['a.txt', 'src/b.ts']);
});

test('mergeBase and logTopo describe the range between a common base and HEAD', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 'side.txt'), 's\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'side']);
  const side = g.head(root);
  git(['checkout', '-q', 'main']);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'b']);
  const second = g.head(root);

  assert.equal(g.mergeBase(root, [first, side, second]), first);
  assert.equal(g.mergeBase(root, [first, 'deadbeef']), null);
  assert.equal(g.mergeBase(root, []), null);

  const linear = g.logTopo(root, `${first}..HEAD`);
  assert.deepEqual(linear.map((c) => c.sha), [second]);
  assert.deepEqual(linear[0].files, ['b.txt']);
  assert.deepEqual(linear[0].parents, [first]);

  git(['merge', '-q', '--no-ff', '-m', 'merge', 'side']);
  const merged = g.head(root);
  const branchy = g.logTopo(root, `${first}..HEAD`);
  assert.equal(branchy[0].sha, merged);
  assert.equal(branchy[0].parents.length, 2);
  assert.deepEqual(branchy.map((c) => c.sha).sort(), [merged, second, side].sort());
  assert.deepEqual(g.logTopo(root, `${first}..HEAD`, { n: 1 }).map((c) => c.sha), [merged]);
  assert.deepEqual(g.logTopo(tmpDir(), 'a..b'), []);
});

test('git() reports failure without throwing', () => {
  const r = g.git(['rev-parse', 'HEAD'], { cwd: tmpDir() });
  assert.equal(r.ok, false);
  assert.equal(g.head(tmpDir()), null);
  assert.equal(g.defaultBranch(tmpDir()), null);
});

test('logTopo lists the files an evil merge introduced and nothing for a clean merge', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 's.txt'), 's\n');
  git(['add', 's.txt']);
  git(['commit', '-q', '-m', 'side']);
  git(['checkout', '-q', 'main']);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'b']);
  git(['merge', '-q', '--no-ff', '-m', 'clean merge', 'side']);
  const clean = g.logTopo(root, `${first}..HEAD`).find((c) => c.parents.length === 2);
  assert.deepEqual(clean.files, []);
  writeFileSync(join(root, 'a.txt'), 'evil\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '--amend', '--no-edit']);
  const evil = g.logTopo(root, `${first}..HEAD`).find((c) => c.parents.length === 2);
  assert.deepEqual(evil.files, ['a.txt']);
});

test('mergeBase ignores arguments that are not hex shas', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  assert.equal(g.mergeBase(root, [first, '--help']), first);
  assert.equal(g.mergeBase(root, [first, 'unverified']), first);
  assert.equal(g.mergeBase(root, ['unverified', 'not a sha']), null);
});

test('commitsSince lists commits after a sha with their files, null for a bad sha, truncated at n', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'b']);
  writeFileSync(join(root, 'c.txt'), 'c\n');
  git(['add', 'c.txt']);
  git(['commit', '-q', '-m', 'c']);
  const r = g.commitsSince(root, first);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.commits.map((c) => c.files), [['c.txt'], ['b.txt']]);
  assert.deepEqual(r.commits[1].parents, [first]);
  assert.deepEqual(g.commitsSince(root, g.head(root)), { commits: [], truncated: false });
  assert.equal(g.commitsSince(root, 'deadbeef'), null);
  assert.equal(g.commitsSince(root, 'unverified'), null);
  assert.equal(g.commitsSince(root, first, { n: 1 }).truncated, true);
});

test('changedBetween lists the branch diff against the merge base and null for a bad ref', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  writeFileSync(join(root, 'main.txt'), 'm\n');
  git(['add', 'main.txt']);
  git(['commit', '-q', '-m', 'main moves']);
  git(['checkout', '-q', '-b', 'feat', 'HEAD~1']);
  writeFileSync(join(root, 'feat.txt'), 'f\n');
  git(['add', 'feat.txt']);
  git(['commit', '-q', '-m', 'feat']);
  assert.deepEqual(g.changedBetween(root, 'main'), ['feat.txt']);
  assert.equal(g.changedBetween(root, 'no-such-ref'), null);
  assert.equal(g.changedBetween(root, '--output=/tmp/x'), null);
  assert.equal(g.changedBetween(root, ''), null);
});
