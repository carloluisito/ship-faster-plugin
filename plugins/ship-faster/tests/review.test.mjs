import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { projectDir } from '../scripts/lib/state.mjs';
import { prepareReview } from '../scripts/review.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const page = (title, covers) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified: 'unverified', updated: '2026-09-16' }) + `# ${title}\n`;

function fixture() {
  const { root, git } = makeRepo({ files: {
    'src/api/users.ts': 'export const a = 1;\n',
    'src/lib/db.ts': 'export const db = 1;\n',
    'docs/wiki/conventions.md': page('Conventions', ['src/**']),
    'docs/wiki/gotchas.md': page('Gotchas', ['src/lib/**']),
    'docs/wiki/gotchas-api.md': page('Gotchas: api', ['src/api/**']),
    'docs/wiki/recipes/add-endpoint.md': page('Add endpoint', ['src/api/**']),
    'docs/wiki/recipes/add-migration.md': page('Add migration', ['migrations/**']),
    'docs/wiki/index.md': '# i\n',
  } });
  git(['checkout', '-q', '-b', 'feat/users']);
  writeFileSync(join(root, 'src', 'api', 'users.ts'), 'export const a = 2;\nexport const b = 3;\n');
  git(['add', 'src/api/users.ts']);
  git(['commit', '-q', '-m', 'feat: b']);
  writeFileSync(join(root, 'src', 'lib', 'db.ts'), 'export const db = 2;\n');
  writeFileSync(join(root, 'src', 'api', 'new.ts'), 'export const fresh = true;\n');
  writeFileSync(join(root, '.env'), 'SECRET=1\n');
  return { root, git };
}

test('prepare writes chunked diffs, untracked files, and names the rule pages and matching recipes', () => {
  const { root } = fixture();
  const r = prepareReview(root, { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.equal(r.base, 'main');
  assert.match(r.mergeBase, /^[0-9a-f]{40}$/);
  assert.deepEqual(r.files.map((f) => f.path).sort(), ['src/api/users.ts', 'src/lib/db.ts']);
  assert.equal(r.chunks.length, 1);
  const chunk = readFileSync(r.chunks[0].file, 'utf8');
  assert.match(chunk, /diff --git a\/src\/api\/users\.ts/);
  assert.match(chunk, /\+export const b = 3;/);
  assert.match(chunk, /\+export const db = 2;/);
  assert.deepEqual(r.untracked.map((u) => u.path), ['src/api/new.ts']);
  assert.match(readFileSync(r.untracked[0].file, 'utf8'), /fresh = true/);
  assert.deepEqual(r.rulePages.map((p) => [p.rel, p.exists]), [['docs/wiki/conventions.md', true], ['docs/wiki/gotchas.md', true], ['docs/wiki/gotchas-api.md', true], ['docs/wiki/architecture.md', false]]);
  assert.deepEqual(r.recipes.map((p) => p.rel), ['docs/wiki/recipes/add-endpoint.md']);
  assert.ok(r.dir.startsWith(projectDir(root).replace(/\\/g, '/') + '/review/'), r.dir);
  const manifest = JSON.parse(readFileSync(join(r.dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.chunks.length, 1);
  assert.ok(!r.chunks[0].file.includes('\\'));
});

test('a file over the line limit gets its own chunk and other files pack together', () => {
  const { root, git } = makeRepo({ files: { 'big.txt': 'x\n', 'small-a.txt': 'a\n', 'small-b.txt': 'b\n' } });
  git(['checkout', '-q', '-b', 'topic']);
  writeFileSync(join(root, 'big.txt'), Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n');
  writeFileSync(join(root, 'small-a.txt'), 'a2\n');
  writeFileSync(join(root, 'small-b.txt'), 'b2\n');
  const r = prepareReview(root, { config: DEFAULTS, maxLines: 20 });
  assert.equal(r.chunks.length, 2);
  const big = r.chunks.find((c) => c.paths.includes('big.txt'));
  assert.deepEqual(big.paths, ['big.txt']);
  const rest = r.chunks.find((c) => !c.paths.includes('big.txt'));
  assert.deepEqual(rest.paths.sort(), ['small-a.txt', 'small-b.txt']);
  assert.ok(r.totalLines > 50);
});

test('nothing to review, a bad base, no git, and pruning of old review directories', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const empty = prepareReview(root, { config: DEFAULTS });
  assert.equal(empty.ok, true);
  assert.deepEqual([empty.files, empty.chunks, empty.untracked], [[], [], []]);
  const bad = prepareReview(root, { config: DEFAULTS, base: 'nope' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /base nope/);
  assert.equal(prepareReview(tmpDir(), { config: DEFAULTS }).ok, false);
  writeFileSync(join(root, 'a.txt'), 'a2\n');
  for (let i = 0; i < 7; i++) prepareReview(root, { config: DEFAULTS });
  const dirs = readdirSync(join(projectDir(root), 'review'));
  assert.ok(dirs.length <= 5, `expected at most 5 review dirs, got ${dirs.length}`);
  const cli = runScript('review', ['prepare', '--root', root, '--json']);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.files.length, 1);
  assert.equal(runScript('review', ['--root', root, '--json']).json.ok, false);
});

test('a renamed file appears once at its new path, not the old one', () => {
  const { root, git } = makeRepo({ files: { 'src/old.ts': 'export const a = 1;\n' } });
  git(['checkout', '-q', '-b', 'feat/rename']);
  git(['mv', 'src/old.ts', 'src/new.ts']);
  git(['commit', '-q', '-m', 'refactor: rename old to new']);
  const r = prepareReview(root, { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.path), ['src/new.ts']);
});

test('untracked entries that are not regular files are left out of the review', () => {
  const { root } = fixture();
  let linked = true;
  try { symlinkSync(join(root, 'src', 'lib', 'db.ts'), join(root, 'db-link.ts'), 'file'); } catch { linked = false; }
  const r = prepareReview(root, { config: DEFAULTS });
  assert.equal(r.ok, true);
  const paths = r.untracked.map((u) => u.path);
  assert.ok(paths.includes('src/api/new.ts'));
  if (linked) assert.ok(!paths.includes('db-link.ts'));
  assert.ok(!r.files.some((f) => f.path === 'db-link.ts'));
});
