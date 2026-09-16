import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSegments, tokenize } from '../scripts/lib/shell.mjs';

test('splitSegments respects quotes and all separators', () => {
  assert.deepEqual(splitSegments('npm test && git push origin main'), ['npm test', 'git push origin main']);
  assert.deepEqual(splitSegments('echo "a && b"; git status | cat'), ['echo "a && b"', 'git status', 'cat']);
  assert.deepEqual(splitSegments("git commit -m 'x; y' || true\ngit push"), ["git commit -m 'x; y'", 'true', 'git push']);
});

test('tokenize strips quotes and honours escapes', () => {
  assert.deepEqual(tokenize('git commit -m "hello world" -n'), ['git', 'commit', '-m', 'hello world', '-n']);
  assert.deepEqual(tokenize("echo 'git push origin main'"), ['echo', 'git push origin main']);
  assert.deepEqual(tokenize('git add file\\ name.txt'), ['git', 'add', 'file name.txt']);
});

test('splitSegments expands command substitution, including inside double quotes', () => {
  assert.ok(splitSegments('echo "$(git push origin main)"').includes('git push origin main'));
  assert.ok(splitSegments('echo `git status` done').includes('git status'));
});
