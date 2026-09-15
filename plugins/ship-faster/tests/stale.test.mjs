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
