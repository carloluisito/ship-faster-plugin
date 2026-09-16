import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, matchGlob, anyMatch, filterPaths } from '../scripts/lib/glob.mjs';

const TABLE = [
  ['*.md', 'README.md', true],
  ['*.md', 'docs/a.md', true],
  ['/README.md', 'docs/README.md', false],
  ['/README.md', 'README.md', true],
  ['README*', 'README.md', true],
  ['package.json', 'packages/a/package.json', true],
  ['src/**', 'src/a/b.ts', true],
  ['src/**', 'src/a.ts', true],
  ['src/**', 'lib/a.ts', false],
  ['src/**', 'src', false],
  ['**/*.test.mjs', 'a/b/c.test.mjs', true],
  ['**/*.test.mjs', 'c.test.mjs', true],
  ['src/**/*.{ts,tsx}', 'src/x/y.tsx', true],
  ['src/**/*.{ts,tsx}', 'src/y.ts', true],
  ['src/**/*.{ts,tsx}', 'src/y.js', false],
  ['docs/', 'docs/a/b.md', true],
  ['docs/', 'x/docs/a.md', true],
  ['docs/', 'docsx/a.md', false],
  ['.github/workflows/**', '.github/workflows/ci.yml', true],
  ['?.md', 'a.md', true],
  ['?.md', 'ab.md', false],
  ['a/*', 'a/b', true],
  ['a/*', 'a/b/c', false],
  ['a/**/b', 'a/b', true],
  ['a/**/b', 'a/x/y/b', true],
  ['*.log', 'logs/x.log', true],
  ['file.with.dots', 'file.with.dots', true],
  ['file.with.dots', 'filexwithxdots', false],
];

test('glob table', () => {
  for (const [pattern, path, expected] of TABLE) {
    assert.equal(matchGlob(pattern, path), expected, `${pattern} vs ${path}`);
  }
});

test('normalizePath handles windows separators and ./ prefixes', () => {
  assert.equal(normalizePath('.\\src\\a.ts'), 'src/a.ts');
  assert.equal(normalizePath('./a//b/c.md'), 'a/b/c.md');
  assert.equal(matchGlob('src/**', 'src\\x\\y.ts'), true);
});

test('anyMatch and filterPaths', () => {
  assert.equal(anyMatch(['docs/**', '*.json'], 'package.json'), true);
  assert.equal(anyMatch(['docs/**', '*.json'], 'src/a.ts'), false);
  assert.deepEqual(filterPaths(['src/**'], ['src/a.ts', 'README.md', 'src/b/c.ts']), ['src/a.ts', 'src/b/c.ts']);
});
