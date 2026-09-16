import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { saveSession } from '../scripts/lib/state.mjs';
import { stale } from '../scripts/stale.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const page = (title, covers, verified, extra = {}) =>
  serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified, updated: '2026-09-16', ...extra }) + `# ${title}\n`;

test('classifies fresh, stale, dirty, unverifiable, invalid and merges session records', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b', 'docs/c.md': 'c', 'ops/d.txt': 'd' } });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'change b']);
  const headSha = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'fresh.md'), page('Fresh', ['src/**'], headSha));
  writeFileSync(join(w, 'stale.md'), page('Stale', ['lib/**'], first));
  writeFileSync(join(w, 'dirty.md'), page('Dirty', ['docs/c.md'], headSha));
  writeFileSync(join(w, 'unver.md'), page('Unver', ['src/**'], 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));
  writeFileSync(join(w, 'invalid.md'), '---\ntitle: Invalid\n---\nno covers\n');
  writeFileSync(join(w, 'session.md'), page('Session', ['ops/**'], headSha));
  writeFileSync(join(root, 'docs', 'c.md'), 'c2');
  saveSession(root, 'sid1', { pages: { 'docs/wiki/session.md': { files: ['ops/d.txt'], reported: false } } });

  const r = stale(root, { config: DEFAULTS, session: 'sid1' });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['fresh.md'].status, 'fresh');
  assert.equal(by['stale.md'].status, 'stale');
  assert.deepEqual(by['stale.md'].changed, ['lib/b.ts']);
  assert.equal(by['dirty.md'].status, 'dirty');
  assert.deepEqual(by['dirty.md'].changed, ['docs/c.md']);
  assert.equal(by['unver.md'].status, 'unverifiable');
  assert.equal(by['invalid.md'].status, 'invalid');
  assert.equal(by['session.md'].status, 'dirty');
  assert.deepEqual(r.counts, { fresh: 1, stale: 1, dirty: 2, unverifiable: 1, invalid: 1 });
  assert.equal(r.head, headSha);
  assert.match(r.summary[0], /6 pages/);

  const cli = runScript('stale', ['--root', root, '--json', '--changed', 'src/a.ts']);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.pages.find((p) => p.rel.endsWith('fresh.md')).status, 'dirty');
});

test('ten pages sharing one verified sha are all classified stale (commitExists memoization does not change results)', () => {
  const { root, git } = makeRepo({ files: { 'lib/b.ts': 'b' } });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'change b']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  for (let i = 0; i < 10; i++) writeFileSync(join(w, `page-${i}.md`), page(`Page ${i}`, ['lib/**'], first));

  const r = stale(root, { config: DEFAULTS });
  assert.equal(r.pages.length, 10);
  assert.ok(r.pages.every((p) => p.status === 'stale'));
  assert.deepEqual(r.counts, { fresh: 0, stale: 10, dirty: 0, unverifiable: 0, invalid: 0 });
});

test('distinct verified shas are classified exactly by the batched pass, with a per-sha fallback', () => {
  const { root, git } = makeRepo({ files: { 'a/f.ts': 'a1' } });
  const c1 = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 'side.ts'), 's');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'side']);
  const cSide = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main']);
  const commit = (dir) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'f.ts'), dir);
    git(['add', '-A']);
    git(['commit', '-q', '-m', dir]);
    return git(['rev-parse', 'HEAD']);
  };
  const c2 = commit('b');
  commit('c');
  const c4 = commit('d');

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'a.md'), page('A', ['a/**'], c1));
  writeFileSync(join(w, 'b.md'), page('B', ['b/**'], c1));
  writeFileSync(join(w, 'c.md'), page('C', ['c/**'], c2));
  writeFileSync(join(w, 'd.md'), page('D', ['d/**'], c4));
  writeFileSync(join(w, 'side.md'), page('Side', ['b/**'], cSide));

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['a.md'].status, 'fresh');
  assert.equal(by['b.md'].status, 'stale');
  assert.deepEqual(by['b.md'].changed, ['b/f.ts']);
  assert.equal(by['c.md'].status, 'stale');
  assert.deepEqual(by['c.md'].changed, ['c/f.ts']);
  assert.equal(by['d.md'].status, 'fresh');
  assert.equal(by['side.md'].status, 'stale');
  assert.deepEqual(by['side.md'].changed, ['b/f.ts']);
  assert.deepEqual(r.counts, { fresh: 2, stale: 3, dirty: 0, unverifiable: 0, invalid: 0 });
});

test('no wiki and no git are reported, not thrown', () => {
  const none = stale(tmpDir(), { config: DEFAULTS });
  assert.equal(none.exists, false);
  assert.deepEqual(none.pages, []);
  const root = tmpDir();
  mkdirSync(join(root, 'docs', 'wiki'), { recursive: true });
  writeFileSync(join(root, 'docs', 'wiki', 'p.md'), page('P', ['src/**'], 'abc'));
  const r = stale(root, { config: DEFAULTS });
  assert.equal(r.pages[0].status, 'unverifiable');
  assert.match(r.pages[0].reason, /not a git repository/);
});

test('a change introduced by the merge commit itself counts as changed since a page verified before it', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a', 'lib/b.ts': 'b' } });
  const first = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 's.txt'), 's');
  git(['add', 's.txt']);
  git(['commit', '-q', '-m', 'side']);
  const side = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', 'lib/b.ts']);
  git(['commit', '-q', '-m', 'b']);
  const b = git(['rev-parse', 'HEAD']);
  git(['merge', '-q', '--no-ff', '-m', 'merge side', 'side']);
  writeFileSync(join(root, 'a.txt'), 'evil');
  git(['add', 'a.txt']);
  git(['commit', '-q', '--amend', '--no-edit']);

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'from-side.md'), page('From side', ['a.txt'], side));
  writeFileSync(join(w, 'from-b.md'), page('From b', ['a.txt'], b));
  writeFileSync(join(w, 'from-first.md'), page('From first', ['s.txt'], first));

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['from-side.md'].status, 'stale');
  assert.deepEqual(by['from-side.md'].changed, ['a.txt']);
  assert.equal(by['from-b.md'].status, 'stale');
  assert.deepEqual(by['from-b.md'].changed, ['a.txt']);
  assert.equal(by['from-first.md'].status, 'stale');
  assert.deepEqual(by['from-first.md'].changed, ['s.txt']);
});

test('exactly two distinct verified shas classify exactly', () => {
  const { root, git } = makeRepo({ files: { 'a/f.ts': 'a1' } });
  const c1 = git(['rev-parse', 'HEAD']);
  mkdirSync(join(root, 'b'), { recursive: true });
  writeFileSync(join(root, 'b', 'f.ts'), 'b');
  git(['add', 'b/f.ts']);
  git(['commit', '-q', '-m', 'b']);
  const c2 = git(['rev-parse', 'HEAD']);
  mkdirSync(join(root, 'c'), { recursive: true });
  writeFileSync(join(root, 'c', 'f.ts'), 'c');
  git(['add', 'c/f.ts']);
  git(['commit', '-q', '-m', 'c']);

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'a.md'), page('A', ['a/**'], c1));
  writeFileSync(join(w, 'b.md'), page('B', ['b/**'], c1));
  writeFileSync(join(w, 'c.md'), page('C', ['c/**'], c2));
  writeFileSync(join(w, 'd.md'), page('D', ['b/**'], c2));

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['a.md'].status, 'fresh');
  assert.equal(by['b.md'].status, 'stale');
  assert.deepEqual(by['b.md'].changed, ['b/f.ts']);
  assert.equal(by['c.md'].status, 'stale');
  assert.deepEqual(by['c.md'].changed, ['c/f.ts']);
  assert.equal(by['d.md'].status, 'fresh');
});

test('a covered change committed together with the page keeps the page fresh; committed without it makes the page stale', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  const verifiedAt = git(['rev-parse', 'HEAD']);
  writeFileSync(join(w, 'together.md'), page('Together', ['src/**'], verifiedAt));
  writeFileSync(join(w, 'alone.md'), page('Alone', ['lib/**'], verifiedAt));
  writeFileSync(join(root, 'src', 'a.ts'), 'a2');
  git(['add', 'docs/wiki/index.md', 'docs/wiki/together.md', 'docs/wiki/alone.md', 'src/a.ts']);
  git(['commit', '-q', '-m', 'ship: code and docs together']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', 'lib/b.ts']);
  git(['commit', '-q', '-m', 'change b without touching its page']);

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['together.md'].status, 'fresh');
  assert.equal(by['alone.md'].status, 'stale');
  assert.deepEqual(by['alone.md'].changed, ['lib/b.ts']);

  writeFileSync(join(root, 'src', 'a.ts'), 'a3');
  git(['add', 'src/a.ts']);
  git(['commit', '-q', '-m', 'change a later without the page']);
  const later = stale(root, { config: DEFAULTS });
  assert.equal(later.pages.find((p) => p.rel.endsWith('together.md')).status, 'stale');
});

test('the alongside rule also holds on the one-pass path with three distinct verified shas', () => {
  const { root, git } = makeRepo({ files: { 'a/f.ts': 'a', 'b/f.ts': 'b', 'c/f.ts': 'c' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  const shas = [];
  for (const dir of ['a', 'b', 'c']) {
    shas.push(git(['rev-parse', 'HEAD']));
    writeFileSync(join(w, `${dir}.md`), page(dir.toUpperCase(), [`${dir}/**`], shas[shas.length - 1]));
    writeFileSync(join(root, dir, 'f.ts'), `${dir}2`);
    git(['add', `docs/wiki/${dir}.md`, `${dir}/f.ts`]);
    git(['commit', '-q', '-m', `${dir} with page`]);
  }
  writeFileSync(join(root, 'c', 'f.ts'), 'c3');
  git(['add', 'c/f.ts']);
  git(['commit', '-q', '-m', 'c alone']);
  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['a.md'].status, 'fresh');
  assert.equal(by['b.md'].status, 'fresh');
  assert.equal(by['c.md'].status, 'stale');
  assert.deepEqual(by['c.md'].changed, ['c/f.ts']);
});

test('a tracked page with uncommitted edits is not dirty for covered working-tree changes; an untracked page still is', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b' } });
  const headSha = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'tracked.md'), page('Tracked', ['src/**'], headSha));
  git(['add', 'docs/wiki/index.md', 'docs/wiki/tracked.md']);
  git(['commit', '-q', '-m', 'wiki']);
  const committed = git(['rev-parse', 'HEAD']);
  writeFileSync(join(w, 'tracked.md'), page('Tracked', ['src/**'], committed) + 'Edited alongside.\n');
  writeFileSync(join(w, 'new.md'), page('New', ['lib/**'], committed));
  writeFileSync(join(root, 'src', 'a.ts'), 'a2');
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['tracked.md'].status, 'fresh');
  assert.equal(by['new.md'].status, 'dirty');
  assert.deepEqual(by['new.md'].changed, ['lib/b.ts']);
});

test('--since scopes non-fresh pages to the branch diff, the working tree, and session records, and lists uncovered files', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b', 'ops/d.txt': 'd', 'etc/e.txt': 'e', 'new/n.ts': 'n' } });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', 'lib/b.ts']);
  git(['commit', '-q', '-m', 'main change']);
  git(['checkout', '-q', '-b', 'feat']);
  writeFileSync(join(root, 'src', 'a.ts'), 'a2');
  writeFileSync(join(root, 'new', 'n.ts'), 'n2');
  git(['add', 'src/a.ts', 'new/n.ts']);
  git(['commit', '-q', '-m', 'feat change']);
  const headSha = git(['rev-parse', 'HEAD']);

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'a.md'), page('A', ['src/**'], first));
  writeFileSync(join(w, 'b.md'), page('B', ['lib/**'], first));
  writeFileSync(join(w, 'd.md'), page('D', ['ops/**'], headSha));
  writeFileSync(join(w, 'e.md'), page('E', ['etc/**'], headSha));
  writeFileSync(join(w, 'inv.md'), '---\ntitle: Invalid\n---\nno covers\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# x\n');
  saveSession(root, 'sid9', { pages: { 'docs/wiki/d.md': { files: ['ops/d.txt'], reported: false } } });

  const scoped = stale(root, { config: DEFAULTS, session: 'all', since: 'main' });
  const by = Object.fromEntries(scoped.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.deepEqual([by['a.md'].status, by['a.md'].inScope], ['stale', true]);
  assert.deepEqual([by['b.md'].status, by['b.md'].inScope], ['stale', false]);
  assert.deepEqual([by['d.md'].status, by['d.md'].inScope], ['dirty', true]);
  assert.deepEqual([by['e.md'].status, by['e.md'].inScope], ['fresh', false]);
  assert.deepEqual([by['inv.md'].status, by['inv.md'].inScope], ['invalid', true]);
  assert.deepEqual(scoped.since, { ref: 'main', files: 2, error: null });
  assert.deepEqual(scoped.uncovered, ['new/n.ts']);
  assert.match(scoped.summary[0], /in scope/);

  const unscoped = stale(root, { config: DEFAULTS, session: 'all' });
  assert.equal(unscoped.pages.find((p) => p.rel.endsWith('b.md')).inScope, true);
  assert.equal(unscoped.pages.find((p) => p.rel.endsWith('e.md')).inScope, false);
  assert.equal(unscoped.since, null);
  assert.deepEqual(unscoped.uncovered, []);

  const bad = stale(root, { config: DEFAULTS, since: 'no-such-ref' });
  assert.equal(bad.since.error, 'cannot diff against no-such-ref');
  assert.equal(bad.pages.find((p) => p.rel.endsWith('b.md')).inScope, true);

  const cli = runScript('stale', ['--root', root, '--json', '--session', 'all', '--since', 'main']);
  assert.equal(cli.json.pages.find((p) => p.rel.endsWith('d.md')).inScope, true);
  assert.equal(cli.json.pages.find((p) => p.rel.endsWith('b.md')).inScope, false);
  assert.deepEqual(cli.json.uncovered, ['new/n.ts']);
});
