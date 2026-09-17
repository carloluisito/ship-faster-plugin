import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { projectDir, readJson, sessionFile, writeJsonAtomic } from '../scripts/lib/state.mjs';

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

test('output over 600 characters drops whole lines instead of cutting mid-line or mid-word', () => {
  const { root, git } = bigRepo({ 'lib/x.ts': 'x' });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'x.ts'), 'x2');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'x']);
  git(['checkout', '-q', '-b', 'feat/sso']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  for (let i = 0; i < 4; i++) {
    const slug = 'a'.repeat(89) + i;
    writeFileSync(join(w, `${slug}.md`), page(slug, ['lib/**'], first));
  }
  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'api.md'), '---\npaths: ["src/**"]\n---\n- rule\n');
  mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
  const planSlug = 'b'.repeat(120);
  writeFileSync(join(root, 'docs', 'plans', `${planSlug}.md`), serializeFrontmatter({ title: 'Long', branch: 'feat/sso', status: 'active', created: '2026-09-16' }) + '# Long\n');
  writeJsonAtomic(join(projectDir(root), 'health.json'), { lastRun: new Date(Date.now() - 21 * 86400_000).toISOString() });

  const r = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  assert.ok(r.stdout.length <= 600, r.stdout.length);
  const lines = r.stdout.trim().split('\n');
  for (const line of lines) {
    assert.ok(
      /^ship-faster: wiki at /.test(line) || /^ship-faster: active plan for branch /.test(line) || /^ship-faster: health audit /.test(line),
      line
    );
    assert.notEqual(line.slice(-1), ' ', line);
  }
});

test('a rules path that is a file does not blank the output', () => {
  const { root } = bigRepo();
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules'), 'not a directory\n');
  const r = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  assert.match(r.stdout, /^ship-faster: wiki at /);
});

test('startup names the sibling worktrees from both sides and says nothing about them on compact', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const wt = join(tmpDir('sf-wt-'), 'feat-a');
  git(['worktree', 'add', wt, '-b', 'feat/a']);
  const fromMain = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  assert.equal(fromMain.code, 0);
  assert.match(fromMain.stdout, /^ship-faster: worktrees: this=main \(main checkout\); others=feat\/a$/m);
  const fromWorktree = hook({ session_id: 's2', cwd: wt, source: 'startup' }, wt);
  assert.match(fromWorktree.stdout, /^ship-faster: worktrees: this=feat\/a \(worktree of .+\); others=main$/m);
  assert.equal(hook({ session_id: 's', cwd: root, source: 'compact' }, root).stdout, '');
});

test('startup warns when another session used this checkout recently, and records its own start', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = hook({ session_id: 'first', cwd: root, source: 'startup' }, root);
  assert.equal(first.stdout, '');
  const rec = readJson(sessionFile(root, 'first'), null);
  assert.equal(rec.branch, 'main');
  assert.ok(Date.parse(rec.startedAt) > 0);
  const second = hook({ session_id: 'second', cwd: root, source: 'startup' }, root);
  assert.match(second.stdout, /^ship-faster: another session started .+ ago in this checkout \(branch main\); for parallel work start a second session with claude --worktree\.$/m);
  const resumed = hook({ session_id: 'first', cwd: root, source: 'resume' }, root);
  assert.match(resumed.stdout, /another session/);
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  writeJsonAtomic(sessionFile(root, 'second'), { startedAt: old, updatedAt: old, branch: 'main', pages: {} });
  const later = hook({ session_id: 'third', cwd: root, source: 'startup' }, root);
  assert.doesNotMatch(later.stdout, /second/);
  assert.match(later.stdout, /another session/);
});
