import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter, updateFrontmatter } from '../scripts/lib/fm.mjs';

const PAGE = `---
title: Commands
summary: Verified dev, test, and build commands with durations.
read_when: You need to run, test, build, or debug the environment.
covers: ["package.json", ".github/workflows/**", 'scripts/**']
verified: 9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6
updated: 2026-09-16
# the checks preflight runs, in order
checks:
  - name: typecheck
    run: npx tsc --noEmit
    timeout: 300
  - name: test
    run: npm test
    timeout: 900
tags:
  - docs
  - "two words"
---
# Commands

Body text.
`;

test('parses scalars, inline lists, block lists, lists of maps, comments', () => {
  const { data, body, errors } = parseFrontmatter(PAGE);
  assert.deepEqual(errors, []);
  assert.equal(data.title, 'Commands');
  assert.equal(data.read_when, 'You need to run, test, build, or debug the environment.');
  assert.deepEqual(data.covers, ['package.json', '.github/workflows/**', 'scripts/**']);
  assert.equal(data.updated, '2026-09-16');
  assert.deepEqual(data.checks, [
    { name: 'typecheck', run: 'npx tsc --noEmit', timeout: 300 },
    { name: 'test', run: 'npm test', timeout: 900 },
  ]);
  assert.deepEqual(data.tags, ['docs', 'two words']);
  assert.equal(body, '# Commands\n\nBody text.\n');
});

test('handles CRLF input and text without frontmatter', () => {
  const crlf = parseFrontmatter('---\r\ntitle: X\r\n---\r\nbody\r\n');
  assert.equal(crlf.data.title, 'X');
  assert.equal(crlf.body, 'body\r\n');
  const none = parseFrontmatter('# Just a doc\n');
  assert.equal(none.data, null);
  assert.equal(none.body, '# Just a doc\n');
});

test('scalars: quotes, escapes, booleans, numbers, null, trailing comments', () => {
  const { data, errors } = parseFrontmatter(`---
a: "quoted: with colon"
b: 'single'
c: "esc \\" quote"
d: true
e: 42
f: null
g: plain value # trailing comment
h: -7
---
`);
  assert.deepEqual(errors, []);
  assert.deepEqual(data, { a: 'quoted: with colon', b: 'single', c: 'esc " quote', d: true, e: 42, f: null, g: 'plain value', h: -7 });
});

test('reports errors with line numbers and keeps the good keys', () => {
  const { data, errors } = parseFrontmatter(`---
title: ok
nested:
  child: value
---
`);
  assert.equal(data.title, 'ok');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 4);
  assert.match(errors[0].message, /nested map/);
});

test('serialize then parse round-trips and quotes only when needed', () => {
  const data = {
    title: 'Commands: verified',
    covers: ['package.json', 'a b', 'c,d'],
    verified: 'abc123',
    n: 3,
    flag: false,
    checks: [{ name: 'test', run: 'npm test', timeout: 900 }],
  };
  const text = serializeFrontmatter(data);
  assert.match(text, /^---\n/);
  assert.match(text, /\ntitle: "Commands: verified"\n/);
  assert.match(text, /\ncovers: \[package\.json, "a b", "c,d"\]\n/);
  assert.match(text, /\nchecks:\n  - name: test\n    run: npm test\n    timeout: 900\n/);
  assert.deepEqual(parseFrontmatter(text + 'body').data, data);
});

test('updateFrontmatter keeps order and body, appends new keys, removes undefined', () => {
  const out = updateFrontmatter(PAGE, { verified: 'newsha', updated: '2026-10-01', tags: undefined, extra: 'x' });
  const { data, body } = parseFrontmatter(out);
  assert.deepEqual(Object.keys(data), ['title', 'summary', 'read_when', 'covers', 'verified', 'updated', 'checks', 'extra']);
  assert.equal(data.verified, 'newsha');
  assert.equal(data.extra, 'x');
  assert.equal(body, '# Commands\n\nBody text.\n');
  const fresh = updateFrontmatter('just body\n', { title: 'T' });
  assert.equal(fresh, '---\ntitle: T\n---\njust body\n');
});

test('block context quotes only when needed; commas and interior brackets do not require quoting', () => {
  const data = { summary: 'Verified dev, test, and build commands with durations.', tags: ['a,b'] };
  const text = serializeFrontmatter(data);
  assert.match(text, /\nsummary: Verified dev, test, and build commands with durations.\n/);
  assert.match(text, /\ntags: \["a,b"\]\n/);
  assert.deepEqual(parseFrontmatter(text + 'body').data, data);
});

test('parses comment lines inside block lists without errors', () => {
  const { data, errors } = parseFrontmatter(`---
checks:
  - name: test
  # a comment
  - name: other
---
`);
  assert.deepEqual(errors, []);
  assert.deepEqual(data.checks, [{ name: 'test' }, { name: 'other' }]);
});
