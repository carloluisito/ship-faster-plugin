import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { projectDir } from '../scripts/lib/state.mjs';
import { listPages, loadPage, loadWiki, loadWikiCache, relPath, wikiDir } from '../scripts/lib/wiki.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

function page(title, covers) {
  return `---\ntitle: ${title}\nsummary: s\nread_when: r\ncovers: [${covers.map((c) => `"${c}"`).join(', ')}]\nverified: abc\nupdated: 2026-09-16\n---\n# ${title}\n`;
}

function makeWiki() {
  const root = tmpDir();
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  writeFileSync(join(w, 'index.md'), '# index\n');
  writeFileSync(join(w, 'a.md'), page('A', ['src/**']));
  writeFileSync(join(w, 'recipes', 'b.md'), page('B', ['package.json']));
  writeFileSync(join(w, 'nofm.md'), '# no frontmatter\n');
  return { root, w };
}

test('listPages excludes index.md, is sorted, and recurses', () => {
  const { root, w } = makeWiki();
  assert.equal(wikiDir(root, DEFAULTS), w);
  const rels = listPages(root, DEFAULTS).map((f) => relPath(root, f));
  assert.deepEqual(rels, ['docs/wiki/a.md', 'docs/wiki/nofm.md', 'docs/wiki/recipes/b.md']);
});

test('loadPage and loadWiki parse frontmatter and count lines', () => {
  const { root, w } = makeWiki();
  const p = loadPage(root, join(w, 'a.md'));
  assert.equal(p.rel, 'docs/wiki/a.md');
  assert.deepEqual(p.data.covers, ['src/**']);
  assert.equal(p.lines, 9);
  const none = loadPage(root, join(w, 'nofm.md'));
  assert.equal(none.data, null);
  const wiki = loadWiki(root, DEFAULTS);
  assert.equal(wiki.exists, true);
  assert.equal(wiki.pages.length, 3);
  assert.equal(loadWiki(tmpDir(), DEFAULTS).exists, false);
});

test('loadWikiCache builds once, reuses when unchanged, rebuilds on mtime change', () => {
  const { root, w } = makeWiki();
  const first = loadWikiCache(root, DEFAULTS);
  assert.deepEqual(first.pages.map((p) => p.rel), ['docs/wiki/a.md', 'docs/wiki/nofm.md', 'docs/wiki/recipes/b.md']);
  assert.deepEqual(first.pages[0].covers, ['src/**']);
  assert.deepEqual(first.pages[1].covers, []);
  const cacheFile = join(projectDir(root), 'wiki-cache.json');
  const second = loadWikiCache(root, DEFAULTS);
  assert.equal(second.builtAt, first.builtAt);
  writeFileSync(join(w, 'a.md'), page('A', ['lib/**']));
  const future = new Date(Date.now() + 5000);
  utimesSync(join(w, 'a.md'), future, future);
  const third = loadWikiCache(root, DEFAULTS);
  assert.deepEqual(third.pages[0].covers, ['lib/**']);
  assert.notEqual(third.builtAt, first.builtAt);
  assert.deepEqual(JSON.parse(readFileSync(cacheFile, 'utf8')).pages[0].covers, ['lib/**']);
});
