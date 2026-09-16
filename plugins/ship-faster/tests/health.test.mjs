import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { preflightDir, projectDir, writeJsonAtomic } from '../scripts/lib/state.mjs';
import { recordHealth, scanHealth } from '../scripts/health.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const OLD = '2020-01-01T00:00:00Z';
function commitAt(root, date, message) {
  const r = spawnSync('git', ['commit', '-q', '-m', message], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (r.status !== 0) throw new Error(r.stderr);
}

test('scan finds old TODOs, large files, skipped tests, slow checks, stale recipes, stale plans, and docs counts', () => {
  const { root, git } = makeRepo({});
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  mkdirSync(join(root, 'docs', 'wiki', 'recipes'), { recursive: true });
  mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(root, 'src', 'old.js'), 'const a = 1;\n// TODO: remove this shim\nconst b = 2;\n');
  writeFileSync(join(root, 'docs', 'wiki', 'recipes', 'ancient.md'), serializeFrontmatter({ title: 'Ancient', summary: 's', read_when: 'r', covers: ['src/**'], verified: 'unverified', updated: '2020-01-01' }) + '# Ancient\n');
  writeFileSync(join(root, 'docs', 'wiki', 'recipes', 'cited.md'), serializeFrontmatter({ title: 'Cited', summary: 's', read_when: 'r', covers: ['src/**'], verified: 'unverified', updated: '2020-01-01' }) + '# Cited\n');
  writeFileSync(join(root, 'docs', 'plans', '2020-01-01-old.md'), '---\ntitle: Old\nbranch: feat/gone\nstatus: active\ncreated: 2020-01-01\npages: [recipes/cited]\n---\n# Old\n');
  git(['add', 'src/old.js', 'docs/wiki/recipes/ancient.md', 'docs/wiki/recipes/cited.md', 'docs/plans/2020-01-01-old.md']);
  commitAt(root, OLD, 'chore: old code');
  writeFileSync(join(root, 'src', 'new.js'), '// FIXME: fresh marker\n');
  writeFileSync(join(root, 'tests', 'a.test.js'), "test.skip('later', () => {});\nit('ok', () => {});\n");
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(1024 * 1024 + 1));
  writeFileSync(join(root, 'docs', 'wiki', 'index.md'), '# i\n');
  git(['add', 'src/new.js', 'tests/a.test.js', 'big.bin', 'docs/wiki/index.md']);
  git(['commit', '-q', '-m', 'feat: new']);
  writeJsonAtomic(join(preflightDir(root), 'last.json'), { checks: [{ name: 'test', durationMs: 90000 }, { name: 'lint', durationMs: 1000 }, { name: 'build', durationMs: 45000 }, { name: 'typecheck', durationMs: 30000 }] });

  const r = scanHealth(root, { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.deepEqual(r.todos.map((t) => [t.path, t.line, t.tag]), [['src/old.js', 2, 'TODO']]);
  assert.ok(r.todos[0].ageDays > 365);
  assert.deepEqual(r.largeFiles.map((f) => f.path), ['big.bin']);
  assert.deepEqual(r.skippedTests, [{ path: 'tests/a.test.js', line: 1, marker: '.skip(' }]);
  assert.deepEqual(r.slowChecks.map((c) => c.name), ['test', 'build', 'typecheck']);
  assert.deepEqual(r.staleRecipes.map((x) => x.rel), ['docs/wiki/recipes/ancient.md']);
  assert.deepEqual(r.plans.map((p) => [p.rel, p.reason]), [['docs/plans/2020-01-01-old.md', 'branch gone']]);
  assert.equal(r.docs.unverifiable, 2);
  assert.equal(typeof r.docs.lintErrors, 'number');
  assert.match(r.summary[0], /1 old TODO/);
});

test('scan is quiet on a clean repository and survives a missing preflight record', () => {
  const { root } = makeRepo({ files: { 'src/a.js': 'const a = 1;\n' } });
  const r = scanHealth(root, { config: DEFAULTS });
  assert.deepEqual([r.todos, r.largeFiles, r.skippedTests, r.slowChecks, r.staleRecipes, r.plans], [[], [], [], [], [], []]);
  assert.equal(r.docs.stale, 0);
});

test('record writes health.json with lastRun and counts; the CLI runs scan and record', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const rec = recordHealth(root, { findings: 3 });
  assert.equal(rec.ok, true);
  const saved = JSON.parse(readFileSync(join(projectDir(root), 'health.json'), 'utf8'));
  assert.deepEqual(saved.counts, { findings: 3 });
  assert.ok(Date.now() - Date.parse(saved.lastRun) < 60_000);
  const scan = runScript('health', ['scan', '--root', root, '--json']);
  assert.equal(scan.json.ok, true);
  const cli = runScript('health', ['record', '--findings', '5', '--root', root, '--json']);
  assert.equal(cli.json.ok, true);
  assert.equal(JSON.parse(readFileSync(join(projectDir(root), 'health.json'), 'utf8')).counts.findings, 5);
  assert.equal(runScript('health', ['--root', root, '--json']).json.ok, false);
});

test('skip markers need word boundaries, TODO markers need a comment prefix, and blame ignores whitespace', () => {
  const { root, git } = makeRepo({});
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'tests', 'run.js'), 'process.exit(1);\ncontext.Skip();\nxit("later", () => {});\n');
  writeFileSync(join(root, 'docs', 'notes.md'), 'The health scan looks for TODO, FIXME, HACK markers.\n');
  writeFileSync(join(root, 'src', 'old.js'), '// TODO: remove\nconst a = 1;\n');
  git(['add', 'tests/run.js', 'docs/notes.md', 'src/old.js']);
  commitAt(root, OLD, 'chore: old');
  writeFileSync(join(root, 'src', 'old.js'), '    // TODO: remove\nconst a = 1;\n');
  git(['add', 'src/old.js']);
  git(['commit', '-q', '-m', 'style: reindent']);
  const r = scanHealth(root, { config: DEFAULTS });
  assert.deepEqual(r.skippedTests, [{ path: 'tests/run.js', line: 3, marker: 'xit(' }]);
  assert.deepEqual(r.todos.map((t) => [t.path, t.line]), [['src/old.js', 1]]);
});
