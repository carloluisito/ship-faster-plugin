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

test('git() reports failure without throwing', () => {
  const r = g.git(['rev-parse', 'HEAD'], { cwd: tmpDir() });
  assert.equal(r.ok, false);
  assert.equal(g.head(tmpDir()), null);
  assert.equal(g.defaultBranch(tmpDir()), null);
});
