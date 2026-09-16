import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, cleanupAll, tmpDir } from './helpers.mjs';
import { parseFrontmatter, serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { branchExists, isMerged } from '../scripts/lib/git.mjs';
import { findPlan, stalePlans, setPlanStatus } from '../scripts/plan.mjs';

after(cleanupAll);

const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const plan = (title, branch, created, status = 'active') => serializeFrontmatter({ title, branch, status, created, pages: ['architecture'] }) + `# ${title}\n\n## Goal\n`;

test('findPlan picks the newest active plan for a branch; set-status rewrites frontmatter', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const dir = join(root, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-09-01-old.md'), plan('Old', 'feat/x', '2026-09-01'));
  writeFileSync(join(dir, '2026-09-10-new.md'), plan('New', 'feat/x', '2026-09-10'));
  writeFileSync(join(dir, '2026-09-12-shipped.md'), plan('Shipped', 'feat/x', '2026-09-12', 'shipped'));
  writeFileSync(join(dir, '2026-09-12-other.md'), plan('Other', 'feat/y', '2026-09-12'));
  const found = findPlan(root, { config: DEFAULTS, branch: 'feat/x' });
  assert.equal(found.plan.data.title, 'New');
  assert.equal(findPlan(root, { config: DEFAULTS, branch: 'feat/none' }).plan, null);
  const set = setPlanStatus(root, 'docs/plans/2026-09-10-new.md', 'shipped');
  assert.equal(set.ok, true);
  assert.equal(parseFrontmatter(readFileSync(join(dir, '2026-09-10-new.md'), 'utf8')).data.status, 'shipped');
  assert.equal(findPlan(root, { config: DEFAULTS, branch: 'feat/x' }).plan.data.title, 'Old');
  assert.equal(setPlanStatus(root, 'docs/plans/2026-09-10-new.md', 'bogus').ok, false);
  const cli = runScript('plan', ['find', '--branch', 'feat/y', '--root', root, '--json']);
  assert.equal(cli.json.plan.data.title, 'Other');
});

test('stalePlans flags merged and missing branches older than the window', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': '' } });
  git(['checkout', '-q', '-b', 'feat/merged']);
  writeFileSync(join(root, 'b.txt'), 'b');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'b']);
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--no-ff', '-m', 'merge', 'feat/merged']);
  git(['checkout', '-q', '-b', 'feat/open']);
  writeFileSync(join(root, 'c.txt'), 'c');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'c']);
  git(['checkout', '-q', 'main']);
  assert.equal(branchExists(root, 'feat/open'), true);
  assert.equal(isMerged(root, 'feat/merged', 'main'), true);
  assert.equal(isMerged(root, 'feat/open', 'main'), false);
  const dir = join(root, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.md'), plan('Merged old', 'feat/merged', daysAgo(45)));
  writeFileSync(join(dir, 'b.md'), plan('Gone old', 'feat/gone', daysAgo(45)));
  writeFileSync(join(dir, 'c.md'), plan('Open old', 'feat/open', daysAgo(45)));
  writeFileSync(join(dir, 'd.md'), plan('Merged recent', 'feat/merged', daysAgo(2)));
  writeFileSync(join(dir, 'e.md'), plan('Shipped old', 'feat/merged', daysAgo(45), 'shipped'));
  const r = stalePlans(root, { config: DEFAULTS });
  assert.deepEqual(r.plans.map((p) => [p.rel.split('/').pop(), p.reason]), [['a.md', 'branch merged'], ['b.md', 'branch gone']]);
  assert.deepEqual(stalePlans(root, { config: DEFAULTS, days: 1 }).plans.map((p) => p.rel.split('/').pop()), ['a.md', 'b.md', 'd.md']);
});

test('setPlanStatus rejects paths outside plans directory and validates --days', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const dir = join(root, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-09-10-test.md'), plan('Test', 'feat/x', '2026-09-10'));
  assert.equal(setPlanStatus(root, 'docs/plans/2026-09-10-test.md', 'shipped').ok, true);
  assert.equal(setPlanStatus(root, '../outside.md', 'shipped').ok, false);
  const outside = join(tmpDir(), 'x.md');
  writeFileSync(outside, 'test');
  assert.equal(setPlanStatus(root, outside, 'shipped').ok, false);
  const cli = runScript('plan', ['stale', '--days', 'abc', '--root', root, '--json']);
  assert.equal(cli.json.ok, false);
  assert.match(cli.json.error, /--days/);
  const cli2 = runScript('plan', ['stale', '--days', '1', '--root', root, '--json']);
  assert.equal(cli2.json.ok, true);
  const bare = runScript('plan', ['stale', '--days', '--root', root, '--json']);
  assert.equal(bare.json.ok, false);
  assert.match(bare.json.error, /--days/);
});

test('listPlans skips unreadable entries', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const dir = join(root, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'valid.md'), plan('Valid', 'feat/x', '2026-09-10'));
  mkdirSync(join(dir, 'dir.md'));
  const plans = findPlan(root, { config: DEFAULTS, branch: 'feat/x' });
  assert.equal(plans.plan.data.title, 'Valid');
});
