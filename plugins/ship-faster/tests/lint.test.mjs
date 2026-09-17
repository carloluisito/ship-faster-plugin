import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { writeIndex } from '../scripts/index.mjs';
import { lint } from '../scripts/lint.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const fm = (o) => serializeFrontmatter({ summary: 's', read_when: 'r', updated: '2026-09-16', ...o });

function goodRepo() {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'CLAUDE.md': '# p\n\nSee `src/a.ts` and run `npm run test`.\n' } });
  const sha = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  writeFileSync(join(w, 'commands.md'), fm({ title: 'Commands', covers: ['package.json'], verified: sha, checks: [{ name: 'test', run: 'npm test', timeout: 60 }] }) + '# Commands\n\nRun `npm run test`.\n');
  writeFileSync(join(w, 'architecture.md'), fm({ title: 'Architecture', covers: ['src/**'], verified: sha }) + '# A\n\nSee [commands](commands.md) and `src/a.ts`.\n');
  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'api.md'), '---\npaths: ["src/**"]\n---\n- Never block the event loop (g-20260916-loop).\n');
  writeIndex(root, DEFAULTS);
  return { root, w, sha };
}

const rules = (r) => [...r.errors, ...r.warnings].map((f) => f.rule).sort();

test('a good wiki lints clean', () => {
  const { root } = goodRepo();
  const r = lint(root, { config: DEFAULTS });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
});

test('every error rule fires', () => {
  const { root, w, sha } = goodRepo();
  writeFileSync(join(w, 'nofm.md'), '# no frontmatter\n');
  writeFileSync(join(w, 'bad.md'), fm({ title: 'Architecture', covers: [], verified: sha }) + '# dup title and empty covers\n[missing](nope.md)\n');
  writeFileSync(join(w, 'badfm.md'), '---\ntitle: BadFm\nnested:\n  child: v\n---\nx\n');
  const missingFm = { summary: 's', read_when: 'r', updated: '2026-09-16', title: 'Missing', covers: ['src/**'], verified: sha };
  delete missingFm.read_when;
  writeFileSync(join(w, 'missing.md'), serializeFrontmatter(missingFm) + 'x\n');
  writeFileSync(join(w, 'nomatch.md'), fm({ title: 'NoMatch', covers: ['nothing/**'], verified: sha }) + 'x\n');
  writeFileSync(join(w, 'long.md'), fm({ title: 'Long', covers: ['src/**'], verified: sha }) + 'line\n'.repeat(250));
  writeFileSync(join(w, 'secret.md'), fm({ title: 'Secret', covers: ['src/**'], verified: sha }) + 'token = ghp_' + 'a'.repeat(36) + '\n');
  writeFileSync(join(w, 'commands.md'), fm({ title: 'Commands', covers: ['package.json'], verified: sha, checks: [{ name: 'test' }], setup: [{ run: '' }] }) + '# C\n');
  writeFileSync(join(root, 'CLAUDE.md'), 'x\n'.repeat(160));
  writeFileSync(join(root, '.claude', 'rules', 'long.md'), '---\npaths: ["src/**"]\n---\n' + 'rule\n'.repeat(30));
  writeFileSync(join(root, '.claude', 'rules', 'nopaths.md'), '- always\n');
  const r = lint(root, { config: DEFAULTS });
  const got = new Set(r.errors.map((e) => e.rule));
  for (const rule of ['frontmatter-missing', 'frontmatter-invalid', 'frontmatter-required', 'covers-empty', 'covers-no-match', 'page-too-long', 'index-stale', 'claude-md-too-long', 'rules-too-long', 'link-missing', 'checks-shape', 'setup-shape', 'duplicate-title', 'secret']) {
    assert.ok(got.has(rule), `expected ${rule}, got ${[...got].join(', ')}`);
  }
  assert.ok(r.warnings.some((x) => x.rule === 'rules-no-paths'));
  assert.equal(r.ok, false);
  const secret = r.errors.find((e) => e.rule === 'secret');
  assert.equal(secret.line, 9);
  const missingReq = r.errors.find((e) => e.rule === 'frontmatter-required' && e.file === 'docs/wiki/missing.md');
  assert.ok(missingReq, 'expected frontmatter-required for docs/wiki/missing.md');
  assert.ok(missingReq.message.includes('read_when'));
  const cli = runScript('lint', ['--root', root, '--json']);
  assert.equal(cli.code, 1);
  assert.equal(cli.json.ok, false);
  assert.equal(runScript('lint', ['--root', root]).code, 1);
});

test('script-missing is scoped to pages and CLAUDE.md, not rules files', () => {
  const { root, w, sha } = goodRepo();
  writeFileSync(join(root, '.claude', 'rules', 'scriptish.md'), '---\npaths: ["src/**"]\n---\nRun `npm run nope`.\n');
  writeFileSync(join(w, 'scriptpage.md'), fm({ title: 'ScriptPage', covers: ['src/**'], verified: sha }) + 'Run `npm run nope`.\n');
  const r = lint(root, { config: DEFAULTS });
  assert.ok(!r.warnings.some((x) => x.rule === 'script-missing' && x.file === '.claude/rules/scriptish.md'));
  assert.ok(r.warnings.some((x) => x.rule === 'script-missing' && x.file === 'docs/wiki/scriptpage.md'));
});

test('plans: malformed frontmatter is frontmatter-invalid; a well-formed plan produces no finding', () => {
  const { root } = goodRepo();
  const plansDir = join(root, 'docs', 'plans');
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, '2026-09-16-x.md'), '---\ntitle: X\nnested:\n  child: v\n---\n# X\n');
  writeFileSync(join(plansDir, '2026-09-16-good.md'), '---\ntitle: Good\n---\n# Good\n');
  const r = lint(root, { config: DEFAULTS });
  const bad = r.errors.find((e) => e.rule === 'frontmatter-invalid' && e.file === 'docs/plans/2026-09-16-x.md');
  assert.ok(bad, 'expected frontmatter-invalid for docs/plans/2026-09-16-x.md');
  assert.ok(!r.errors.some((e) => e.file === 'docs/plans/2026-09-16-good.md'));
  assert.ok(!r.warnings.some((e) => e.file === 'docs/plans/2026-09-16-good.md'));
});

test('warnings: missing path, missing script, verified not in history; index-too-long', () => {
  const { root, w, sha } = goodRepo();
  writeFileSync(join(w, 'architecture.md'), fm({ title: 'Architecture', covers: ['src/**'], verified: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }) + '# A\n\nSee `src/missing.ts`, `https://x/y`, and run `npm run nope`. Globs like `src/**` are fine.\n');
  writeIndex(root, DEFAULTS);
  const r = lint(root, { config: DEFAULTS });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((x) => x.rule).sort(), ['path-missing', 'script-missing', 'verified-missing']);
  for (let i = 0; i < 90; i++) writeFileSync(join(w, `p${String(i).padStart(2, '0')}.md`), fm({ title: `P${i}`, covers: ['src/**'], verified: sha }) + 'x\n');
  writeIndex(root, DEFAULTS);
  assert.ok(lint(root, { config: DEFAULTS }).errors.some((e) => e.rule === 'index-too-long'));
});

test('a path:line citation is checked as a path and only warns when the file is missing', () => {
  const { root } = makeRepo({ files: { 'src/a.ts': 'a\n' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  const fm = serializeFrontmatter({ title: 'Cite', summary: 's', read_when: 'r', covers: ['src/**'], verified: 'unverified', updated: '2026-09-16' });
  writeFileSync(join(w, 'cite.md'), fm + '# Cite\n\nSee `src/a.ts:12` and `src/a.ts:12-14`, but not `src/missing.ts:3`.\n');
  const r = lint(root, { config: DEFAULTS });
  const missing = r.warnings.filter((x) => x.rule === 'path-missing');
  assert.deepEqual(missing.map((x) => x.message), ['path does not exist: src/missing.ts:3']);
});
