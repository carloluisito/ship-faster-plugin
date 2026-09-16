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
  const stamps = new Set(readdirSync(preflightDir(root)).filter((n) => n.endsWith('.log')).map((n) => n.slice(0, 24)));
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

test('a name: on a non-run step, and a top-level name:, do not leak onto the next check', () => {
  const DEPLOY_CI = `name: Deploy
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - run: npm test
`;
  const { root } = makeRepo({ files: { '.github/workflows/deploy.yml': DEPLOY_CI } });
  const r = resolveChecks(root, { config: DEFAULTS });
  assert.equal(r.source, 'ci');
  const test = r.checks.find((c) => c.run === 'npm test');
  assert.ok(test, 'expected npm test to be an included check');
  assert.notEqual(test.name, 'Checkout');
  assert.match(test.name, /^check-\d+$/);
});

test('circleci mapping-form run: is read as name/command, not literal lines', () => {
  const CIRCLE_CI = `version: 2.1
jobs:
  build:
    steps:
      - checkout
      - run:
          name: Run tests
          command: npm test
`;
  const { root } = makeRepo({ files: { '.circleci/config.yml': CIRCLE_CI } });
  const r = resolveChecks(root, { config: DEFAULTS });
  assert.equal(r.source, 'ci');
  assert.deepEqual(r.checks.map((c) => ({ name: c.name, run: c.run })), [{ name: 'Run tests', run: 'npm test' }]);
  const allRuns = [...r.checks, ...r.excluded].map((c) => c.run);
  assert.ok(!allRuns.some((run) => /name:|command:/.test(run)));
});

test('UNSAFE only matches whole words', () => {
  const PRERELEASE_CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:prerelease
      - run: npm run deploy
`;
  const { root } = makeRepo({ files: { '.github/workflows/ci.yml': PRERELEASE_CI } });
  const r = resolveChecks(root, { config: DEFAULTS });
  assert.ok(r.checks.some((c) => c.run === 'npm run test:prerelease'));
  assert.ok(r.excluded.some((e) => e.run === 'npm run deploy'));
});

test('echo is excluded only when the whole line is an echo', () => {
  const ECHO_CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi && npm run build
`;
  const { root } = makeRepo({ files: { '.github/workflows/ci.yml': ECHO_CI } });
  const r = resolveChecks(root, { config: DEFAULTS });
  assert.ok(r.checks.some((c) => c.run === 'echo hi && npm run build'));
  assert.ok(!r.excluded.some((e) => e.run === 'echo hi && npm run build'));
});

test('a block scalar joins line continuations instead of splitting them into bogus checks', () => {
  const COVERAGE_CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Test with coverage
        run: |
          pytest \\
            --cov=src
`;
  const cov = resolveChecks(makeRepo({ files: { '.github/workflows/ci.yml': COVERAGE_CI } }).root, { config: DEFAULTS });
  assert.deepEqual(cov.checks.map((c) => ({ name: c.name, run: c.run })), [{ name: 'Test with coverage', run: 'pytest --cov=src' }]);

  const CHAIN_CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          npm run lint &&
          npm run build
`;
  const chain = resolveChecks(makeRepo({ files: { '.github/workflows/ci.yml': CHAIN_CI } }).root, { config: DEFAULTS });
  assert.deepEqual(chain.checks.map((c) => c.run), ['npm run lint && npm run build']);

  const FLAG_CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          docker run \\
            -v /a:/b \\
            node:20 npm test
`;
  const flag = resolveChecks(makeRepo({ files: { '.github/workflows/ci.yml': FLAG_CI } }).root, { config: DEFAULTS });
  assert.deepEqual(flag.checks.map((c) => c.run), ['docker run -v /a:/b node:20 npm test']);
});

test('a finished run survives an unwritable log directory', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const blocked = join(tmpDir(), 'blocked');
  writeFileSync(blocked, '');
  process.env.CLAUDE_PLUGIN_DATA = join(blocked, 'sub');
  const checks = [
    { name: 'ok', run: 'node -e "process.exit(0)"', timeout: 30, source: 'test' },
    { name: 'bad', run: 'node -e "process.exit(3)"', timeout: 30, source: 'test' },
  ];
  const r = runChecks(root, { config: DEFAULTS, checks, continueOnFail: true });
  assert.equal(r.ok, true);
  assert.equal(r.passed, false);
  assert.deepEqual(r.checks.map((c) => c.status), ['pass', 'fail']);
  assert.equal(r.checks[1].exitCode, 3);
  assert.ok(r.checks.every((c) => c.log === null), 'a failed log write leaves log null');
});

test('a wiki checks list with no valid run stays source wiki with nothing to run', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'commands.md'), serializeFrontmatter({ title: 'Commands', summary: 's', read_when: 'r', covers: ['a.txt'], verified: 'abc', updated: '2026-09-16', checks: [{ name: 'broken' }] }) + '# C\n');
  const r = resolveChecks(root, { config: DEFAULTS });
  assert.equal(r.source, 'wiki');
  assert.deepEqual(r.checks, []);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].why, 'invalid check entry: missing run');
});

test('zero resolved checks is an honest failure, not a silent pass', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const r = runChecks(root, { config: DEFAULTS, checks: [] });
  assert.equal(r.passed, false);
  assert.match(r.summary[0], /no checks resolved/);
  const last = JSON.parse(readFileSync(join(preflightDir(root), 'last.json'), 'utf8'));
  assert.equal(last.passed, false);
});
