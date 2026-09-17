import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { riskyReason, isLarge } from '../scripts/lib/risky.mjs';
import { recordEdit, sessionFile, writeJsonAtomic } from '../scripts/lib/state.mjs';
import { splitIncludes } from '../scripts/lib/ownership.mjs';
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

const soon = (ms = 5000) => new Date(Date.now() + ms).toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const openSession = (root, sid, { branch = 'main', at = new Date().toISOString() } = {}) =>
  writeJsonAtomic(sessionFile(root, sid), { startedAt: at, updatedAt: at, branch, pages: {} });

function sharedRepo() {
  const files = { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n', 'd.txt': 'd\n', 'e.txt': 'e\n' };
  const { root, git } = makeRepo({ files });
  for (const name of Object.keys(files)) writeFileSync(join(root, name), `${name} changed\n`);
  writeFileSync(join(root, '.env'), 'TOKEN=x\n');
  return { root, git };
}

test('ownership is solo without a session id or without another session, and ships every uncommitted file as before', () => {
  const { root } = sharedRepo();
  openSession(root, 'them');
  recordEdit(root, 'them', 'b.txt', { at: soon() });
  const anonymous = changes(root, { config: DEFAULTS });
  assert.equal(anonymous.ownership.mode, 'solo');
  assert.equal(anonymous.ownership.session, null);
  assert.match(anonymous.ownership.reason, /no session id/);
  assert.deepEqual(anonymous.ownership.ship, ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']);

  const { root: alone } = sharedRepo();
  openSession(alone, 'me');
  recordEdit(alone, 'me', 'a.txt', { at: soon() });
  const solo = changes(alone, { config: DEFAULTS, session: 'me' });
  assert.equal(solo.ownership.mode, 'solo');
  assert.deepEqual(solo.ownership.others, []);
  assert.deepEqual(solo.ownership.ship, ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']);
  assert.deepEqual([solo.ownership.ask, solo.ownership.leave], [[], []]);
  assert.equal(solo.dirty.find((d) => d.path === 'a.txt').owner, 'mine');
  assert.equal(solo.dirty.find((d) => d.path === 'b.txt').owner, 'unclaimed');
});

test('shared ownership splits files into mine, both, theirs, earlier, and unclaimed, and ships only mine plus includes', () => {
  const { root } = sharedRepo();
  openSession(root, 'me');
  openSession(root, 'them', { branch: 'feat/them' });
  recordEdit(root, 'me', 'a.txt', { at: soon() });
  recordEdit(root, 'me', '.env', { at: soon() });
  recordEdit(root, 'them', 'b.txt', { at: soon() });
  recordEdit(root, 'me', 'c.txt', { at: soon() });
  recordEdit(root, 'them', 'c.txt', { at: soon() });
  recordEdit(root, 'ended', 'd.txt', { at: soon() });
  const r = changes(root, { config: DEFAULTS, session: 'me' });
  const own = r.ownership;
  assert.equal(own.mode, 'shared');
  assert.equal(own.forced, false);
  assert.deepEqual(own.others.map((o) => [o.sid, o.branch, o.files]), [['them', 'feat/them', ['b.txt', 'c.txt']]]);
  assert.deepEqual(Object.fromEntries(r.dirty.map((d) => [d.path, d.owner])), { '.env': 'mine', 'a.txt': 'mine', 'b.txt': 'theirs', 'c.txt': 'both', 'd.txt': 'earlier', 'e.txt': 'unclaimed' });
  assert.deepEqual(own.ship, ['a.txt']);
  assert.deepEqual(own.ask, [
    { path: 'c.txt', owner: 'both', sessions: ['them'] },
    { path: 'd.txt', owner: 'earlier', sessions: ['ended'] },
    { path: 'e.txt', owner: 'unclaimed', sessions: [] },
  ]);
  assert.deepEqual(own.leave, [{ path: 'b.txt', sessions: ['them'] }]);
  assert.match(r.summary.join('\n'), /ownership: shared \(1 other session uses this checkout\): ship 1, ask 3, leave 1; others: feat\/them, 2 file\(s\)/);

  const included = changes(root, { config: DEFAULTS, session: 'me', include: ['b.txt,e.*', '.env'] });
  assert.deepEqual([...included.ownership.included].sort(), ['.env', 'b.txt', 'e.txt']);
  assert.deepEqual(included.ownership.ship, ['a.txt', 'b.txt', 'e.txt']);
  assert.deepEqual(included.ownership.leave, []);
  assert.deepEqual(included.ownership.ask.map((x) => x.path), ['c.txt', 'd.txt']);

  const here = changes(root, { config: DEFAULTS, session: 'me', here: true });
  assert.equal(here.ownership.mode, 'solo');
  assert.equal(here.ownership.forced, true);
  assert.deepEqual(here.ownership.ship, ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']);
});

test('a session counts as another user of the checkout when recently active or holding current claims, and a committed claim goes stale', () => {
  const { root, git } = sharedRepo();
  openSession(root, 'me');
  openSession(root, 'idle', { at: ago(3 * 3600_000) });
  assert.equal(changes(root, { config: DEFAULTS, session: 'me' }).ownership.mode, 'solo');

  recordEdit(root, 'idle', 'b.txt', { at: soon() });
  const claimed = changes(root, { config: DEFAULTS, session: 'me' });
  assert.equal(claimed.ownership.mode, 'shared');
  assert.deepEqual(claimed.ownership.others.map((o) => o.sid), ['idle']);

  const { root: other } = sharedRepo();
  openSession(other, 'me');
  openSession(other, 'old', { at: ago(3 * 3600_000) });
  recordEdit(other, 'old', 'b.txt', { at: ago(150 * 60_000) });
  const stale = changes(other, { config: DEFAULTS, session: 'me' });
  assert.equal(stale.dirty.find((d) => d.path === 'b.txt').owner, 'unclaimed');
  assert.equal(stale.ownership.mode, 'solo');

  const { root: live } = sharedRepo();
  openSession(live, 'me');
  openSession(live, 'fresh');
  const recent = changes(live, { config: DEFAULTS, session: 'me' });
  assert.equal(recent.ownership.mode, 'shared');
  assert.deepEqual(recent.ownership.ship, []);
  assert.equal(recent.ownership.ask.length, 5);
});

test('splitIncludes flattens comma lists and repeated flags, and the CLI passes session, include, and here', () => {
  assert.deepEqual(splitIncludes(['src/a.js, ./b.js', 'c/**', true]), ['src/a.js', 'b.js', 'c/**']);
  assert.deepEqual(splitIncludes(undefined), []);
  const { root } = sharedRepo();
  openSession(root, 'me');
  openSession(root, 'them');
  recordEdit(root, 'me', 'a.txt', { at: soon() });
  const env = { CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA };
  const shared = runScript('changes', ['--root', root, '--session', 'me', '--include', 'e.txt', '--json'], { env });
  assert.deepEqual(shared.json.ownership.ship, ['a.txt', 'e.txt']);
  const forced = runScript('changes', ['--root', root, '--session', 'me', '--here', '--json'], { env });
  assert.equal(forced.json.ownership.mode, 'solo');
  const unsubstituted = runScript('changes', ['--root', root, '--session', '${CLAUDE_SESSION_ID}', '--json'], { env });
  assert.equal(unsubstituted.json.ownership.session, null);
});

test('a staged rename ships as a pair, and an idle session record with claims keeps shared mode but has its files asked about', () => {
  const { root, git } = makeRepo({ files: { 'old.js': 'o\n', 'b.txt': 'b\n', 'c.txt': 'c\n' } });
  git(['mv', 'old.js', 'new.js']);
  writeFileSync(join(root, 'b.txt'), 'b changed\n');
  writeFileSync(join(root, 'c.txt'), 'c changed\n');
  openSession(root, 'me');
  openSession(root, 'them');
  openSession(root, 'crashed', { at: ago(3 * 3600_000) });
  recordEdit(root, 'them', 'b.txt', { at: soon() });
  // A crashed session: its claim is newer than the last commit, but nothing has touched its records for 150 minutes.
  writeJsonAtomic(join(root, '.git', 'ship-faster', 'edits', 'crashed.json'), { sid: 'crashed', updatedAt: ago(150 * 60_000), files: { 'c.txt': { at: soon(), tool: 'Edit' } } });

  const r = changes(root, { config: DEFAULTS, session: 'me', include: ['new.js'] });
  const byPath = Object.fromEntries(r.dirty.map((d) => [d.path, d]));
  assert.equal(byPath['old.js'].status, 'D');
  assert.equal(byPath['old.js'].renamedTo, 'new.js');
  assert.equal(byPath['new.js'].from, 'old.js');
  assert.equal(r.ownership.mode, 'shared');
  assert.deepEqual([...r.ownership.ship].sort(), ['new.js', 'old.js']);
  assert.deepEqual(r.ownership.leave.map((x) => x.path), ['b.txt']);
  assert.deepEqual(r.ownership.ask.map((x) => [x.path, x.owner]), [['c.txt', 'earlier']]);
  assert.deepEqual(r.ownership.others.map((o) => o.sid).sort(), ['crashed', 'them']);

  const unnamed = changes(root, { config: DEFAULTS, session: 'me' });
  assert.deepEqual(unnamed.ownership.ask.map((x) => x.path).sort(), ['c.txt', 'new.js', 'old.js']);
});
