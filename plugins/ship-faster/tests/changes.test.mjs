import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { riskyReason, isLarge } from '../scripts/lib/risky.mjs';
import { changes } from '../scripts/changes.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

test('riskyReason names the rule for secrets, credentials, build output, logs, and nothing for source', () => {
  assert.equal(riskyReason('.env'), 'env file');
  assert.equal(riskyReason('config/.env.local'), 'env file');
  assert.equal(riskyReason('certs/server.pem'), 'key material');
  assert.equal(riskyReason('id_rsa.key'), 'key material');
  assert.equal(riskyReason('aws-credentials.json'), 'credential file');
  assert.equal(riskyReason('secrets/prod.yaml'), 'secret file');
  assert.equal(riskyReason('node_modules/x/index.js'), 'dependency directory');
  assert.equal(riskyReason('dist/app.js'), 'build output');
  assert.equal(riskyReason('build/out.css'), 'build output');
  assert.equal(riskyReason('debug.log'), 'log file');
  assert.equal(riskyReason('src/env.ts'), null);
  assert.equal(riskyReason('docs/secret-santa.md'), 'secret file');
});

test('isLarge is true above the limit and false for missing files', () => {
  const root = tmpDir();
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(11));
  assert.equal(isLarge(root, 'big.bin', 10), true);
  assert.equal(isLarge(root, 'big.bin', 11), false);
  assert.equal(isLarge(root, 'missing.bin', 10), false);
});

test('changes reports branch, base, ahead/behind, dirty files with risk flags, and the commit style', () => {
  const files = { 'src/a.ts': 'a\n' };
  const { root, git } = makeRepo({ files });
  for (let i = 0; i < 8; i++) {
    writeFileSync(join(root, 'src', 'a.ts'), `a${i}\n`);
    git(['add', 'src/a.ts']);
    git(['commit', '-q', '-m', i % 4 === 3 ? `tweak ${i}` : `feat(core): change ${i}`]);
  }
  git(['checkout', '-q', '-b', 'feat/thing']);
  writeFileSync(join(root, 'src', 'b.ts'), 'b\n');
  git(['add', 'src/b.ts']);
  git(['commit', '-q', '-m', 'feat: b']);
  writeFileSync(join(root, 'src', 'c.ts'), 'c\n');
  writeFileSync(join(root, '.env'), 'TOKEN=abc\n');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'bundle.js'), 'x\n');
  const r = changes(root, { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.equal(r.branch, 'feat/thing');
  assert.equal(r.detached, false);
  assert.equal(r.defaultBranch, 'main');
  assert.equal(r.base, 'main');
  assert.equal(r.onProtected, false);
  assert.deepEqual([r.ahead, r.behind], [1, 0]);
  assert.equal(r.upstream, null);
  assert.equal(r.remote, null);
  const byPath = Object.fromEntries(r.dirty.map((d) => [d.path, d]));
  assert.equal(byPath['src/c.ts'].risky, null);
  assert.equal(byPath['.env'].risky, 'env file');
  assert.equal(byPath['dist/bundle.js'].risky, 'build output');
  assert.deepEqual(r.excluded, ['.env', 'dist/bundle.js']);
  assert.equal(r.commitStyle.kind, 'conventional');
  assert.ok(r.commitStyle.share >= 0.6, String(r.commitStyle.share));
  assert.equal(r.commitStyle.sampled, 10);
  assert.equal(r.subjects[0], 'feat: b');
  assert.equal(r.hasWork, true);
  const plainRepo = makeRepo({ files: { 'a.txt': '' }, commits: [{ message: 'first thing' }, { message: 'second thing' }, { message: 'feat: third' }] });
  const p = changes(plainRepo.root, { config: DEFAULTS });
  assert.equal(p.commitStyle.kind, 'plain');
  assert.equal(p.hasWork, false);
  assert.equal(p.onProtected, true);
  assert.equal(p.base, 'main');
});

test('changes handles --base, a detached HEAD, and a directory without git', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  git(['checkout', '-q', '-b', 'develop']);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'feat: b']);
  git(['checkout', '-q', '-b', 'topic']);
  const r = changes(root, { config: DEFAULTS, base: 'develop' });
  assert.equal(r.base, 'develop');
  assert.deepEqual([r.ahead, r.behind], [0, 0]);
  const cli = runScript('changes', ['--root', root, '--base', 'develop', '--json']);
  assert.equal(cli.json.base, 'develop');
  const missing = runScript('changes', ['--root', root, '--base', 'nope', '--json']);
  assert.equal(missing.json.ok, false);
  assert.match(missing.json.error, /base branch nope does not exist/);
  git(['checkout', '-q', '--detach']);
  const d = changes(root, { config: DEFAULTS });
  assert.equal(d.detached, true);
  assert.equal(d.branch, null);
  const nogit = changes(tmpDir(), { config: DEFAULTS });
  assert.equal(nogit.ok, false);
  assert.match(nogit.error, /not a git repository/);
});

test('a base that exists only as a remote-tracking branch is compared through refs/remotes/origin', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/develop', first]);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'feat: b']);
  const r = changes(root, { config: DEFAULTS, base: 'develop' });
  assert.equal(r.ok, true);
  assert.equal(r.base, 'develop');
  assert.deepEqual([r.ahead, r.behind], [1, 0]);
  assert.equal(r.hasWork, true);
});

test('on the base branch itself, changes counts commits ahead of the remote-tracking ref', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/main', first]);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'feat: b']);
  const r = changes(root, { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.equal(r.branch, 'main');
  assert.equal(r.base, 'main');
  assert.equal(r.onProtected, true);
  assert.deepEqual([r.ahead, r.behind], [1, 0]);
  assert.equal(r.hasWork, true);
  const noRemote = makeRepo({ files: { 'c.txt': 'c\n' } });
  const r2 = changes(noRemote.root, { config: DEFAULTS });
  assert.equal(r2.ok, true);
  assert.equal(r2.ahead, 0);
});

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
