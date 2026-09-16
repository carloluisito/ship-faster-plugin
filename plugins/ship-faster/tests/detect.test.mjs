import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { detect } from '../scripts/detect.mjs';
import { projectHash } from '../scripts/lib/state.mjs';

beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

after(cleanupAll);

test('node repo with pnpm, tsconfig, scripts, github ci, existing CLAUDE.md', () => {
  const { root } = makeRepo({ files: {
    'package.json': JSON.stringify({ name: 'x', main: 'dist/index.js', scripts: { lint: 'eslint .', test: 'vitest run', build: 'tsc -p .' }, devDependencies: { vitest: '1', eslint: '9', typescript: '5' } }),
    'pnpm-lock.yaml': '',
    'tsconfig.json': '{}',
    'src/index.ts': 'export {}\n',
    'src/api/users.ts': 'export {}\n',
    '.github/workflows/ci.yml': 'on: push\n',
    'CLAUDE.md': '# x\n',
    'README.md': '# x\n',
  } });
  const r = detect(root);
  assert.equal(r.ok, true);
  assert.equal(r.git.isRepo, true);
  assert.equal(r.git.sizeClass, 'small');
  assert.deepEqual(r.stacks.map((s) => s.kind), ['node']);
  assert.equal(r.stacks[0].packageManager, 'pnpm');
  assert.deepEqual(r.ci, [{ path: '.github/workflows/ci.yml', kind: 'github' }]);
  assert.deepEqual(r.testFrameworks, ['vitest']);
  assert.deepEqual(r.lintTools, ['eslint']);
  assert.deepEqual(r.typecheck, ['tsc']);
  assert.ok(r.entryPoints.includes('src/index.ts'));
  assert.equal(r.existing.claudeMd, true);
  assert.equal(r.existing.wiki, false);
  assert.equal(r.existing.readme, true);
  assert.deepEqual(r.suggestedChecks.map((c) => [c.name, c.run]), [
    ['typecheck', 'pnpm exec tsc --noEmit'],
    ['lint', 'pnpm run lint'],
    ['test', 'pnpm test'],
    ['build', 'pnpm run build'],
  ]);
  assert.equal(r.topDirs.find((d) => d.dir === 'src').files, 2);
  assert.equal(r.topDirs.find((d) => d.dir === '.').files, 5);
});

test('dotnet, python, go, rust, java are detected with their checks', () => {
  const cases = [
    [{ 'App.sln': '', 'src/App/App.csproj': '<Project/>', '.editorconfig': '' }, 'dotnet', ['build', 'format', 'test']],
    [{ 'pyproject.toml': '[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n', 'app/main.py': '' }, 'python', ['typecheck', 'lint', 'test']],
    [{ 'setup.cfg': '[mypy]\nstrict = true\n', 'app.py': '' }, 'python', ['typecheck']],
    [{ 'go.mod': 'module x\n', 'main.go': 'package main\n', '.golangci.yml': '' }, 'go', ['vet', 'lint', 'test', 'build']],
    [{ 'Cargo.toml': '[package]\nname="x"\n', 'src/main.rs': '', 'clippy.toml': '' }, 'rust', ['check', 'lint', 'test']],
    [{ 'build.gradle': '', 'gradlew': '' }, 'java', ['check']],
    [{ 'pom.xml': '<project/>' }, 'java', ['verify']],
  ];
  for (const [files, kind, checks] of cases) {
    const r = detect(makeRepo({ files }).root);
    assert.deepEqual(r.stacks.map((s) => s.kind), [kind], kind);
    assert.deepEqual(r.suggestedChecks.map((c) => c.name), checks, kind);
  }

  const setupCfgMypy = detect(makeRepo({ files: { 'setup.cfg': '[mypy]\nstrict = true\n', 'app.py': '' } }).root);
  assert.deepEqual(setupCfgMypy.suggestedChecks.map((c) => [c.name, c.run]), [['typecheck', 'mypy .']]);
});

test('Directory.Build.props is a .NET manifest signal alongside project files', () => {
  const r = detect(makeRepo({ files: { 'Directory.Build.props': '<Project/>', 'src/A/A.csproj': '<Project/>' } }).root);
  assert.deepEqual(r.stacks.map((s) => s.kind), ['dotnet']);
  assert.deepEqual(r.stacks[0].manifests.slice().sort(), ['Directory.Build.props', 'src/A/A.csproj']);
});

test('pnpm workspaces become workspaces entries', () => {
  const { root } = makeRepo({ files: {
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'pnpm-lock.yaml': '',
    'packages/a/package.json': JSON.stringify({ name: '@m/a' }),
    'packages/b/package.json': JSON.stringify({ name: '@m/b' }),
  } });
  const r = detect(root);
  assert.deepEqual(r.workspaces.map((w) => [w.name, w.path]), [['@m/a', 'packages/a'], ['@m/b', 'packages/b']]);
});

test('pnpm workspace ** matches nested packages while * matches only one level', () => {
  const files = {
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-lock.yaml': '',
    'packages/a/package.json': JSON.stringify({ name: '@m/a' }),
    'packages/nested/deep/package.json': JSON.stringify({ name: '@m/deep' }),
  };
  const star2 = detect(makeRepo({ files: { ...files, 'pnpm-workspace.yaml': "packages:\n  - 'packages/**'\n" } }).root);
  assert.deepEqual(star2.workspaces.map((w) => w.path), ['packages/a', 'packages/nested/deep']);

  const star1 = detect(makeRepo({ files: { ...files, 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n" } }).root);
  assert.deepEqual(star1.workspaces.map((w) => w.path), ['packages/a']);
});

test('pnpm-workspace.yaml only reads patterns under the packages key', () => {
  const { root } = makeRepo({ files: {
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\nonlyBuiltDependencies:\n  - esbuild\n",
    'pnpm-lock.yaml': '',
    'packages/a/package.json': JSON.stringify({ name: '@m/a' }),
    'esbuild/package.json': JSON.stringify({ name: 'esbuild' }),
  } });
  const r = detect(root);
  assert.deepEqual(r.workspaces.map((w) => w.path), ['packages/a']);
});

test('works without git and via the CLI', () => {
  const root = tmpDir();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"nogit","scripts":{"test":"node --test"}}');
  writeFileSync(join(root, 'src', 'index.js'), '');
  const r = detect(root);
  assert.equal(r.git.isRepo, false);
  assert.equal(r.git.trackedFiles, 2);
  assert.deepEqual(r.suggestedChecks.map((c) => c.run), ['npm test']);
  const cli = runScript('detect', ['--root', root, '--json']);
  assert.equal(cli.code, 0);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.stacks[0].kind, 'node');
});

test('detect reports the resolved config and the project data directory, and --brief drops the long lists', () => {
  const { root } = makeRepo({ files: { '.claude/ship-faster.json': JSON.stringify({ wikiDir: 'wiki', pageMaxLines: 120 }), 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }), 'src/index.js': '' } });
  const r = detect(root);
  assert.equal(r.config.wikiDir, 'wiki');
  assert.equal(r.config.pageMaxLines, 120);
  assert.equal(r.config.rulesDir, '.claude/rules');
  assert.ok(r.dataDir.endsWith(`/projects/${projectHash(root)}`), r.dataDir);
  assert.ok(!r.dataDir.includes('\\'));
  const brief = detect(root, { brief: true });
  assert.deepEqual(Object.keys(brief).sort(), ['ci', 'config', 'dataDir', 'existing', 'git', 'ok', 'root', 'stacks', 'summary']);
  assert.equal(brief.git.head, r.git.head);
  const cli = runScript('detect', ['--root', root, '--brief', '--json']);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.scripts, undefined);
  assert.equal(cli.json.config.wikiDir, 'wiki');
});
