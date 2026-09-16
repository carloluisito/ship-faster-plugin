import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { parseFrontmatter, serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { today, touchPages, verifyPages } from '../scripts/page.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const page = (title, extra = {}) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers: ['src/**'], verified: 'unverified', updated: '2020-01-01', ...extra }) + `# ${title}\n\nBody.\n`;
const fm = (file) => parseFrontmatter(readFileSync(file, 'utf8')).data;

test('today is a UTC yyyy-mm-dd string', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today(), new Date().toISOString().slice(0, 10));
});

test('verify stamps HEAD and today, keeps the body and the other fields, and handles many pages at once', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a' } });
  const head = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki', 'recipes');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(root, 'docs', 'wiki', 'commands.md'), page('Commands', { checks: [{ name: 'test', run: 'npm test', timeout: 60 }] }));
  writeFileSync(join(w, 'add-endpoint.md'), page('Add endpoint'));
  const r = verifyPages(root, ['docs/wiki/commands.md', 'docs/wiki/recipes/add-endpoint.md'], { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.equal(r.sha, head);
  assert.equal(r.date, today());
  assert.deepEqual(r.pages.map((p) => [p.rel, p.ok]), [['docs/wiki/commands.md', true], ['docs/wiki/recipes/add-endpoint.md', true]]);
  const commands = fm(join(root, 'docs', 'wiki', 'commands.md'));
  assert.equal(commands.verified, head);
  assert.equal(commands.updated, today());
  assert.deepEqual(commands.checks, [{ name: 'test', run: 'npm test', timeout: 60 }]);
  assert.deepEqual(commands.covers, ['src/**']);
  assert.match(readFileSync(join(root, 'docs', 'wiki', 'commands.md'), 'utf8'), /\n# Commands\n\nBody\.\n$/);
  assert.equal(fm(join(w, 'add-endpoint.md')).verified, head);
});

test('verify accepts explicit sha and date, and touch changes only updated', () => {
  const { root } = makeRepo({ files: { 'src/a.ts': 'a' } });
  const file = join(root, 'docs', 'wiki', 'testing.md');
  mkdirSync(join(root, 'docs', 'wiki'), { recursive: true });
  writeFileSync(file, page('Testing', { verified: 'aaaa' }));
  verifyPages(root, ['docs/wiki/testing.md'], { config: DEFAULTS, sha: 'bbbb', date: '2026-01-02' });
  assert.deepEqual([fm(file).verified, fm(file).updated], ['bbbb', '2026-01-02']);
  const t = touchPages(root, ['docs/wiki/testing.md'], { config: DEFAULTS, date: '2026-03-04' });
  assert.equal(t.ok, true);
  assert.deepEqual([fm(file).verified, fm(file).updated], ['bbbb', '2026-03-04']);
});

test('verify rejects paths outside the wiki, index.md, missing pages, and broken frontmatter but still updates the valid ones', () => {
  const { root } = makeRepo({ files: { 'src/a.ts': 'a', 'README.md': '# r\n' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'good.md'), page('Good'));
  writeFileSync(join(w, 'broken.md'), '---\ntitle: [oops\n---\nbody\n');
  const r = verifyPages(root, ['README.md', 'docs/wiki/index.md', 'docs/wiki/missing.md', 'docs/wiki/broken.md', 'docs/wiki/good.md'], { config: DEFAULTS });
  assert.equal(r.ok, false);
  assert.match(r.error, /4 page\(s\) not updated/);
  assert.deepEqual(r.pages.map((p) => p.ok), [false, false, false, false, true]);
  assert.match(r.pages[0].error, /not inside docs\/wiki/);
  assert.match(r.pages[1].error, /index\.md/);
  assert.match(r.pages[2].error, /not found/);
  assert.match(r.pages[3].error, /frontmatter/);
  assert.notEqual(fm(join(w, 'good.md')).verified, 'unverified');
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# r\n');
});

test('outside git the sha is unverified; the CLI runs verify and touch', () => {
  const root = tmpDir('sf-nogit-');
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'p.md'), page('P'));
  const r = verifyPages(root, ['docs/wiki/p.md'], { config: DEFAULTS });
  assert.equal(r.sha, 'unverified');
  const { root: repo, git } = makeRepo({ files: { 'src/a.ts': 'a' } });
  mkdirSync(join(repo, 'docs', 'wiki'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'wiki', 'q.md'), page('Q'));
  const cli = runScript('page', ['verify', 'docs/wiki/q.md', '--root', repo, '--json']);
  assert.equal(cli.code, 0);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.sha, git(['rev-parse', 'HEAD']));
  const touched = runScript('page', ['touch', 'docs/wiki/q.md', '--date', '2026-05-06', '--root', repo, '--json']);
  assert.equal(touched.json.ok, true);
  assert.equal(fm(join(repo, 'docs', 'wiki', 'q.md')).updated, '2026-05-06');
  const none = runScript('page', ['verify', '--root', repo, '--json']);
  assert.equal(none.json.ok, false);
  assert.match(none.json.error, /at least one page/);
});

test('rejections report normalized paths, and containment ignores drive-letter case on Windows', () => {
  const { root } = makeRepo({ files: { 'src/a.ts': 'a', 'other.md': '# o\n' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'p.md'), page('P'));
  const r = verifyPages(root, ['docs\\wiki\\..\\..\\other.md'], { config: DEFAULTS });
  assert.equal(r.pages[0].ok, false);
  assert.equal(r.pages[0].rel, 'docs/wiki/../../other.md');
  const absolute = join(root, 'docs', 'wiki', 'p.md');
  const flipDrive = (p) => (/^[A-Za-z]:/.test(p) ? (p[0] === p[0].toLowerCase() ? p[0].toUpperCase() : p[0].toLowerCase()) + p.slice(1) : p);
  const given = process.platform === 'win32' ? flipDrive(absolute) : absolute;
  const ok = verifyPages(root, [given], { config: DEFAULTS });
  assert.equal(ok.ok, true, JSON.stringify(ok.pages));
  assert.equal(ok.pages[0].rel, 'docs/wiki/p.md');
});
