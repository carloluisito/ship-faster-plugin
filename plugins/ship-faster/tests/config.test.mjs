import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS, loadConfig } from '../scripts/lib/config.mjs';

after(cleanupAll);

function withConfig(json) {
  const root = tmpDir();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'ship-faster.json'), json);
  return root;
}

test('defaults when no file', () => {
  const { config, errors, file } = loadConfig(tmpDir());
  assert.deepEqual(config, DEFAULTS);
  assert.deepEqual(errors, []);
  assert.equal(file, null);
});

test('merges valid overrides, including a partial guard', () => {
  const root = withConfig(JSON.stringify({ wikiDir: 'wiki', guard: { addAll: 'allow' }, protectedBranches: ['main', 'release'] }));
  const { config, errors } = loadConfig(root);
  assert.deepEqual(errors, []);
  assert.equal(config.wikiDir, 'wiki');
  assert.equal(config.guard.addAll, 'allow');
  assert.equal(config.guard.forcePush, 'deny');
  assert.deepEqual(config.protectedBranches, ['main', 'release']);
  assert.equal(config.pageMaxLines, 200);
});

test('reports invalid values and keeps defaults for them', () => {
  const root = withConfig(JSON.stringify({ guard: { noVerify: 'maybe' }, pageMaxLines: -5, wikiDir: '../x', protectedBranches: 'main' }));
  const { config, errors } = loadConfig(root);
  assert.equal(config.guard.noVerify, 'deny');
  assert.equal(config.pageMaxLines, 200);
  assert.equal(config.wikiDir, 'docs/wiki');
  assert.deepEqual(config.protectedBranches, ['main', 'master']);
  assert.equal(errors.length, 4);
});

test('invalid json yields one error and defaults', () => {
  const { config, errors } = loadConfig(withConfig('{ not json'));
  assert.deepEqual(config, DEFAULTS);
  assert.equal(errors.length, 1);
});
