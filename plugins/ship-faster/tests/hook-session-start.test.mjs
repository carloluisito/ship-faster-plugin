import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { projectDir, writeJsonAtomic } from '../scripts/lib/state.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const hook = (input, cwd) => runScript('hook-session-start', [], { cwd, stdin: input, env: { CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA } });
const page = (title, covers, verified) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified, updated: '2026-09-16' }) + `# ${title}\n`;

function bigRepo(extra = {}) {
  const files = { ...extra };
  for (let i = 0; i < 25; i++) files[`src/f${i}.ts`] = `${i}`;
  return makeRepo({ files });
}

test('silent for a small repo without a wiki, suggests onboard for a bigger one on startup only', () => {
  const small = makeRepo({ files: { 'a.txt': '' } });
  const r1 = hook({ session_id: 's', cwd: small.root, source: 'startup' }, small.root);
  assert.equal(r1.code, 0);
  assert.equal(r1.stdout, '');
  const big = bigRepo();
  const r2 = hook({ session_id: 's', cwd: big.root, source: 'startup' }, big.root);
  assert.match(r2.stdout, /no CLAUDE\.md or docs\/wiki here \(25 tracked files\)\. \/ship-faster:onboard/);
  assert.equal(hook({ session_id: 's', cwd: big.root, source: 'compact' }, big.root).stdout, '');
  const withClaude = bigRepo({ 'CLAUDE.md': '# x\n' });
  assert.equal(hook({ session_id: 's', cwd: withClaude.root, source: 'startup' }, withClaude.root).stdout, '');
});

test('reports wiki, stale pages, rules, plan, and overdue health; compact gets only line one', () => {
  const { root, git } = bigRepo({ 'lib/x.ts': 'x' });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'x.ts'), 'x2');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'x']);
  const head = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'feat/sso']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'commands.md'), page('Commands', ['lib/**'], first));
  writeFileSync(join(w, 'testing.md'), page('Testing', ['src/**'], head));
  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'api.md'), '---\npaths: ["src/**"]\n---\n- rule\n');
  mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(root, 'docs', 'plans', '2026-09-16-sso.md'), serializeFrontmatter({ title: 'SSO', branch: 'feat/sso', status: 'active', created: '2026-09-16' }) + '# SSO\n');
  writeJsonAtomic(join(projectDir(root), 'health.json'), { lastRun: new Date(Date.now() - 21 * 86400_000).toISOString() });

  const r = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 3, r.stdout);
  assert.match(lines[0], /^ship-faster: wiki at docs\/wiki\/index\.md \(2 pages\)\. Stale: 1 \(commands\) → \/ship-faster:sync-docs\. Rules: \.claude\/rules \(1 files\)\.$/);
  assert.equal(lines[1], 'ship-faster: active plan for branch feat/sso: docs/plans/2026-09-16-sso.md');
  assert.equal(lines[2], 'ship-faster: health audit last ran 21 days ago → /ship-faster:health');
  assert.ok(r.stdout.length <= 600);
  const compact = hook({ session_id: 's', cwd: root, source: 'compact' }, root);
  assert.equal(compact.stdout.trim().split('\n').length, 1);
  assert.match(compact.stdout, /wiki at/);
});

test('fresh project without health.json gets no health line; garbage input exits 0 silently', () => {
  const { root } = bigRepo();
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  const r = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  assert.match(r.stdout, /All pages fresh|0 pages/);
  assert.ok(!r.stdout.includes('health'));
  assert.equal(hook('not json', root).code, 0);
  assert.equal(hook('not json', root).stdout, '');
  const gone = hook({ session_id: 's', cwd: join(root, 'does-not-exist'), source: 'startup' }, root);
  assert.equal(gone.code, 0);
});
