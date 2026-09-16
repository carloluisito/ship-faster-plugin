import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';
import { parseFrontmatter } from '../scripts/lib/fm.mjs';
import { REQUIRED_FIELDS } from '../scripts/lib/wiki.mjs';
import { END, START } from '../scripts/claude-md.mjs';

const T = join(PLUGIN_ROOT, 'templates');
const read = (rel) => readFileSync(join(T, rel), 'utf8');
const countLines = (text) => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
const h2s = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());

const PAGES = {
  overview: ['What it is', 'Users', 'Vocabulary', 'Boundaries'],
  architecture: ['Components', 'Data flow', 'Boundaries', 'Decisions'],
  layout: ['Map', 'Entry points', 'Where things go'],
  commands: ['Setup', 'Everyday', 'Checks', 'Known slow or flaky'],
  conventions: ['Follow', 'Avoid', 'Style'],
  testing: ['Layout', 'Adding a test', 'Fixtures and mocks', 'Not runnable locally'],
  gotchas: [],
  dependencies: ['Key deps', 'Pinned', 'Upgrading'],
  ops: ['Environments', 'CI', 'Deploy', 'Release', 'Secrets by name'],
  recipe: ['Steps', 'Files', 'Test', 'Docs'],
  package: ['What', 'Commands', 'Read next'],
};

test('every template file exists', () => {
  for (const f of ['claude-md.md', 'package-claude-md.md', 'plan.md', 'rules-file.md', 'gotcha-entry.md', 'pr-body.md', ...Object.keys(PAGES).map((p) => `pages/${p}.md`)]) {
    assert.ok(existsSync(join(T, f)), `missing templates/${f}`);
  }
});

test('page templates carry the required frontmatter and the required sections in order, under budget', () => {
  for (const [name, expected] of Object.entries(PAGES)) {
    const text = read(`pages/${name}.md`);
    const { data, errors } = parseFrontmatter(text);
    assert.ok(data, `${name}: no frontmatter`);
    assert.deepEqual(errors, [], `${name}: ${JSON.stringify(errors)}`);
    for (const k of REQUIRED_FIELDS) assert.ok(k in data, `${name}: missing ${k}`);
    assert.ok(Array.isArray(data.covers) && data.covers.length > 0, `${name}: covers must be a non-empty list`);
    const found = h2s(text);
    for (const h of expected) assert.ok(found.includes(h), `${name}: missing section "${h}" (found ${found.join(', ')})`);
    assert.deepEqual(found.filter((h) => expected.includes(h)), expected, `${name}: sections out of order`);
    assert.ok(countLines(text) <= 60, `${name}: template is ${countLines(text)} lines`);
  }
  const commands = parseFrontmatter(read('pages/commands.md')).data;
  assert.ok(Array.isArray(commands.checks) && commands.checks.every((c) => typeof c.run === 'string'), 'commands template needs a checks list');
  assert.match(read('pages/gotchas.md'), /^### /m);
});

test('the CLAUDE.md template has the managed markers, the six managed sections, and a Rules section', () => {
  const text = read('claude-md.md');
  assert.ok(text.includes(START) && text.includes(END));
  const inside = text.slice(text.indexOf(START), text.indexOf(END));
  assert.deepEqual(h2s(inside).map((h) => h.replace(/\s*\(.*\)$/, '')), ['What this is', 'Stack', 'Layout', 'Commands', 'Read next', 'Keeping docs true']);
  assert.ok(h2s(text.slice(text.indexOf(END))).includes('Rules'));
  assert.ok(countLines(inside) <= 60, 'managed skeleton must leave room under the 90-line cap');
  assert.ok(!text.includes('@docs/') && !/^@/m.test(text), 'CLAUDE.md never imports wiki pages');
});

test('plan, rules, package CLAUDE.md, and gotcha entry templates have the right shape', () => {
  const plan = parseFrontmatter(read('plan.md'));
  for (const k of ['title', 'branch', 'status', 'created', 'pages']) assert.ok(k in plan.data, `plan: missing ${k}`);
  assert.equal(plan.data.status, 'active');
  assert.deepEqual(h2s(read('plan.md')), ['Goal', 'Scope', 'Touchpoints', 'Tests to add', 'Docs impact', 'Risks', 'Verification']);
  const rules = parseFrontmatter(read('rules-file.md'));
  assert.ok(Array.isArray(rules.data.paths) && rules.data.paths.length > 0, 'rules file needs a paths list');
  assert.ok(countLines(read('rules-file.md')) <= 25);
  assert.ok(countLines(read('package-claude-md.md')) <= 30);
  assert.deepEqual(h2s(read('package-claude-md.md')), ['What this is', 'Commands', 'Read next']);
  const entry = read('gotcha-entry.md');
  for (const label of ['Symptom:', 'Cause:', 'Rule:', 'Evidence:']) assert.ok(entry.includes(label), `gotcha entry: missing ${label}`);
  assert.match(entry, /<!-- id: g-\{\{yyyymmdd\}\}-\{\{slug\}\} -->/);
});

test('the PR body template carries the six sections in order', () => {
  assert.deepEqual(h2s(read('pr-body.md')), ['What', 'Why', 'How verified', 'Docs', 'Plan', 'Risks']);
  assert.match(read('pr-body.md'), /\| Check \| Status \| Duration \|/);
});
