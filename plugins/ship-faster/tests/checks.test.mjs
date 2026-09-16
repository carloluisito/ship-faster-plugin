import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { preflightDir } from '../scripts/lib/state.mjs';
import { resolveChecks, runChecks } from '../scripts/checks.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Test
        run: npm test
      - run: |
          npm run lint
          npm run build
      - run: echo done
      - run: npx vitest --shard=\${{ matrix.shard }}
      - name: Deploy
        run: npm run deploy
      - run: gh release create v1
`;

test('resolve prefers wiki checks, then ci, then detect', () => {
  const { root } = makeRepo({ files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }), '.github/workflows/ci.yml': CI } });
  const ci = resolveChecks(root, { config: DEFAULTS });
  assert.equal(ci.source, 'ci');
  assert.deepEqual(ci.checks.map((c) => [c.name, c.run]), [['Test', 'npm test'], ['check-3', 'npm run lint'], ['check-4', 'npm run build']]);
  assert.deepEqual(ci.excluded.map((e) => e.run), ['npm ci', 'echo done', 'npx vitest --shard=${{ matrix.shard }}', 'npm run deploy', 'gh release create v1']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'commands.md'), serializeFrontmatter({ title: 'Commands', summary: 's', read_when: 'r', covers: ['package.json'], verified: 'abc', updated: '2026-09-16', checks: [{ name: 'unit', run: 'node -e 0', timeout: 30 }] }) + '# C\n');
  const wiki = resolveChecks(root, { config: DEFAULTS });
  assert.equal(wiki.source, 'wiki');
  assert.deepEqual(wiki.checks, [{ name: 'unit', run: 'node -e 0', timeout: 30, source: 'wiki' }]);
  const plain = resolveChecks(makeRepo({ files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }) } }).root, { config: DEFAULTS });
  assert.equal(plain.source, 'detect');
  assert.deepEqual(plain.checks.map((c) => c.run), ['npm test']);
  assert.equal(resolveChecks(makeRepo({ files: { 'a.txt': '' } }).root, { config: DEFAULTS }).source, 'none');
});

test('run stops at the first failure, records tails and logs, writes last.json', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const checks = [
    { name: 'ok', run: 'node -e "process.exit(0)"', timeout: 30, source: 'test' },
    { name: 'bad', run: 'node -e "console.log(12345); console.error(\'oops\'); process.exit(3)"', timeout: 30, source: 'test' },
    { name: 'never', run: 'node -e "process.exit(0)"', timeout: 30, source: 'test' },
  ];
  const r = runChecks(root, { config: DEFAULTS, checks });
  assert.equal(r.passed, false);
  assert.deepEqual(r.checks.map((c) => c.status), ['pass', 'fail', 'skipped']);
  assert.equal(r.checks[1].exitCode, 3);
  assert.match(r.checks[1].tail, /12345/);
  assert.match(r.checks[1].tail, /oops/);
  assert.ok(existsSync(r.checks[1].log));
  assert.equal(r.checks[2].log, null);
  const last = JSON.parse(readFileSync(join(preflightDir(root), 'last.json'), 'utf8'));
  assert.equal(last.passed, false);
  assert.equal(last.checks.length, 3);
  assert.match(r.summary[0], /FAIL at bad/);
  const all = runChecks(root, { config: DEFAULTS, checks, continueOnFail: true });
  assert.deepEqual(all.checks.map((c) => c.status), ['pass', 'fail', 'pass']);
});

test('timeouts are reported and old logs are pruned to ten runs', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const slow = [{ name: 'slow', run: 'node -e "setTimeout(function(){}, 5000)"', timeout: 1, source: 'test' }];
  const r = runChecks(root, { config: DEFAULTS, checks: slow });
  assert.equal(r.checks[0].status, 'timeout');
  assert.equal(r.passed, false);
  const fast = [{ name: 'f', run: 'node -e 0', timeout: 30, source: 'test' }];
  for (let i = 0; i < 12; i++) runChecks(root, { config: DEFAULTS, checks: fast });
  const stamps = new Set(readdirSync(preflightDir(root)).filter((n) => n.endsWith('.log')).map((n) => n.split('-f.log')[0]));
  assert.ok(stamps.size <= 10, `expected at most 10 runs of logs, got ${stamps.size}`);
});

test('cli resolve and run', () => {
  const { root } = makeRepo({ files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }) } });
  const res = runScript('checks', ['resolve', '--root', root, '--json']);
  assert.equal(res.json.source, 'detect');
  const run = runScript('checks', ['run', '--root', root, '--json']);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.passed, true);
  assert.equal(run.code, 0);
});
