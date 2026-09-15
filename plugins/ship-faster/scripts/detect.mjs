import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__']);
const CI_FILES = [
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, 'github'],
  [/^\.gitlab-ci\.yml$/, 'gitlab'],
  [/^azure-pipelines\.yml$/, 'azure'],
  [/^Jenkinsfile$/, 'jenkins'],
  [/^\.circleci\/config\.yml$/, 'circle'],
  [/^bitbucket-pipelines\.yml$/, 'bitbucket'],
];
const DOUBLE_STAR = '\u0001';

function walkFiles(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < 20000) {
    const rel = stack.pop();
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(r); }
      else if (e.isFile()) out.push(r);
    }
  }
  return out.sort();
}

function readText(root, rel) {
  try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
}

function readJson(root, rel) {
  try { return JSON.parse(readText(root, rel)); } catch { return null; }
}

export function detect(root) {
  root = normalizePath(root);
  const { config } = loadConfig(root);
  const isRepo = git.isRepo(root);
  const files = isRepo ? git.trackedFiles(root) : walkFiles(root);
  const has = (rel) => files.includes(rel);
  const any = (re) => files.some((f) => re.test(f));
  const list = (re) => files.filter((f) => re.test(f));

  const stacks = [];
  const scripts = {};
  const testFrameworks = [];
  const lintTools = [];
  const typecheck = [];
  const entryPoints = [];
  const workspaces = [];
  const checks = [];
  const push = (name, run, timeout = 600) => checks.push({ name, run, timeout, source: 'detect' });

  const pkg = has('package.json') ? readJson(root, 'package.json') : null;
  if (pkg) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : (has('bun.lockb') || has('bun.lock')) ? 'bun' : 'npm';
    stacks.push({ kind: 'node', manifests: ['package.json'], packageManager: pm });
    Object.assign(scripts, pkg.scripts || {});
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const [dep, name] of [['vitest', 'vitest'], ['jest', 'jest'], ['mocha', 'mocha'], ['ava', 'ava'], ['@playwright/test', 'playwright'], ['cypress', 'cypress']]) {
      if (dep in deps) testFrameworks.push(name);
    }
    for (const [dep, name] of [['eslint', 'eslint'], ['@biomejs/biome', 'biome'], ['prettier', 'prettier']]) {
      if (dep in deps) lintTools.push(name);
    }
    const hasTs = any(/^tsconfig[^/]*\.json$/);
    if (hasTs) typecheck.push('tsc');
    for (const c of [pkg.main, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {}))]) {
      if (typeof c === 'string' && has(normalizePath(c))) entryPoints.push(normalizePath(c));
    }
    for (const c of ['src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.mjs', 'src/main.ts', 'src/main.tsx', 'src/main.js', 'index.js', 'index.ts', 'server.js', 'app.js']) {
      if (has(c)) entryPoints.push(c);
    }
    const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm];
    const run = { npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn', bun: 'bun run' }[pm];
    const testCmd = { npm: 'npm test', pnpm: 'pnpm test', yarn: 'yarn test', bun: 'bun run test' }[pm];
    if (hasTs) push('typecheck', `${exec} tsc --noEmit`);
    if (scripts.lint) push('lint', `${run} lint`);
    if (scripts.test) push('test', testCmd, 900);
    if (scripts.build) push('build', `${run} build`);
    detectNodeWorkspaces(root, pkg, files, workspaces);
  }

  const dotnetManifests = list(/(^|\/)[^/]+\.(sln|csproj|fsproj)$/).slice(0, 20);
  if (dotnetManifests.length) {
    stacks.push({ kind: 'dotnet', manifests: dotnetManifests });
    testFrameworks.push('dotnet-test');
    push('build', 'dotnet build --no-restore');
    if (has('.editorconfig')) { lintTools.push('dotnet-format'); push('format', 'dotnet format --verify-no-changes'); }
    push('test', 'dotnet test --no-build', 900);
  }

  const pyManifests = ['pyproject.toml', 'setup.py', 'setup.cfg', ...list(/^requirements[^/]*\.txt$/)].filter(has);
  if (pyManifests.length) {
    stacks.push({ kind: 'python', manifests: pyManifests });
    const pyproject = readText(root, 'pyproject.toml') || '';
    const setupCfg = readText(root, 'setup.cfg') || '';
    const py = pyproject + setupCfg;
    if (/\[tool\.mypy\]/.test(pyproject) || /^\[mypy\]\s*$/m.test(setupCfg) || has('mypy.ini')) { typecheck.push('mypy'); push('typecheck', 'mypy .'); }
    if (/\[tool\.pyright\]/.test(py) || has('pyrightconfig.json')) { typecheck.push('pyright'); push('typecheck', 'pyright'); }
    if (/\[tool\.ruff/.test(py) || has('ruff.toml')) { lintTools.push('ruff'); push('lint', 'ruff check .'); }
    if (/\[tool\.pytest/.test(py) || has('pytest.ini') || has('conftest.py') || any(/^tests\//)) { testFrameworks.push('pytest'); push('test', 'pytest', 900); }
    for (const c of ['__main__.py', 'main.py', 'app.py', 'manage.py', ...list(/^[^/]+\/(main|app|__main__)\.py$/)]) if (has(c)) entryPoints.push(c);
  }

  if (has('go.mod')) {
    stacks.push({ kind: 'go', manifests: ['go.mod', ...(has('go.work') ? ['go.work'] : [])] });
    testFrameworks.push('go-test');
    push('vet', 'go vet ./...');
    if (has('.golangci.yml') || has('.golangci.yaml')) { lintTools.push('golangci-lint'); push('lint', 'golangci-lint run'); }
    push('test', 'go test ./...', 900);
    push('build', 'go build ./...');
    for (const c of ['main.go', ...list(/^cmd\/[^/]+\/main\.go$/)]) if (has(c)) entryPoints.push(c);
    const work = readText(root, 'go.work');
    if (work) for (const m of work.matchAll(/^\s*\.\/([^\s]+)/gm)) workspaces.push({ name: m[1], path: m[1], kind: 'go' });
  }

  if (has('Cargo.toml')) {
    stacks.push({ kind: 'rust', manifests: ['Cargo.toml'] });
    testFrameworks.push('cargo-test');
    push('check', 'cargo check');
    if (has('clippy.toml')) { lintTools.push('clippy'); push('lint', 'cargo clippy -- -D warnings'); }
    push('test', 'cargo test', 900);
    for (const c of ['src/main.rs', 'src/lib.rs']) if (has(c)) entryPoints.push(c);
    const cargo = readText(root, 'Cargo.toml') || '';
    const members = /\[workspace\][\s\S]*?members\s*=\s*\[([^\]]*)\]/.exec(cargo);
    if (members) for (const m of members[1].matchAll(/"([^"]+)"/g)) workspaces.push({ name: m[1], path: m[1], kind: 'rust' });
  }

  if (any(/^build\.gradle(\.kts)?$/)) {
    stacks.push({ kind: 'java', manifests: list(/^build\.gradle(\.kts)?$/), buildTool: 'gradle' });
    testFrameworks.push('junit');
    push('check', has('gradlew') ? './gradlew check' : 'gradle check', 900);
  } else if (has('pom.xml')) {
    stacks.push({ kind: 'java', manifests: ['pom.xml'], buildTool: 'maven' });
    testFrameworks.push('junit');
    push('verify', 'mvn -q verify', 900);
  }

  const ci = [];
  for (const f of files) for (const [re, kind] of CI_FILES) if (re.test(f)) ci.push({ path: f, kind });

  const counts = new Map();
  for (const f of files) {
    const dir = f.includes('/') ? f.split('/')[0] : '.';
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  const topDirs = [...counts.entries()].map(([dir, n]) => ({ dir, files: n })).sort((a, b) => b.files - a.files || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)).slice(0, 12);

  const wikiIndex = `${config.wikiDir}/index.md`;
  const existing = {
    claudeMd: has('CLAUDE.md') || existsSync(join(root, 'CLAUDE.md')),
    wiki: existsSync(join(root, wikiIndex)),
    rules: existsSync(join(root, config.rulesDir)) && readdirSync(join(root, config.rulesDir)).some((n) => n.endsWith('.md')),
    plans: existsSync(join(root, config.plansDir)),
    config: existsSync(join(root, '.claude', 'ship-faster.json')),
    agentsMd: existsSync(join(root, 'AGENTS.md')),
    readme: any(/^README(\.[^/]+)?$/i),
  };

  const n = files.length;
  const sizeClass = n < 300 ? 'small' : n < 3000 ? 'medium' : 'large';
  const result = {
    ok: true,
    root,
    git: { isRepo, defaultBranch: isRepo ? git.defaultBranch(root) : null, head: isRepo ? git.head(root) : null, currentBranch: isRepo ? git.currentBranch(root) : null, trackedFiles: n, sizeClass },
    stacks, ci, scripts, testFrameworks, lintTools, typecheck,
    entryPoints: [...new Set(entryPoints)],
    topDirs, workspaces, existing,
    suggestedChecks: checks,
  };
  result.summary = [
    `${stacks.map((s) => s.kind).join('+') || 'unknown stack'}, ${n} files (${sizeClass}), ${ci.length} CI file(s)`,
    `checks: ${checks.map((c) => c.run).join(' | ') || 'none detected'}`,
  ];
  return result;
}

function pnpmWorkspacePackagePatterns(text) {
  const out = [];
  let capturing = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) { capturing = true; continue; }
    if (!capturing) continue;
    const item = /^\s+-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (item) { out.push(item[1]); continue; }
    if (/^\S/.test(line)) capturing = false;
  }
  return out;
}

function detectNodeWorkspaces(root, pkg, files, workspaces) {
  let patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && Array.isArray(pkg.workspaces.packages) ? pkg.workspaces.packages : []);
  const pnpmWs = readText(root, 'pnpm-workspace.yaml');
  if (pnpmWs) patterns.push(...pnpmWorkspacePackagePatterns(pnpmWs));
  patterns = patterns.filter((p) => !p.startsWith('!'));
  if (!patterns.length) return;
  const pkgFiles = files.filter((f) => f.endsWith('/package.json'));
  for (const f of pkgFiles) {
    const dir = f.slice(0, -'/package.json'.length);
    const matches = patterns.some((p) => {
      const re = new RegExp('^' + p.replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, DOUBLE_STAR).replace(/\*/g, '[^/]*').split(DOUBLE_STAR).join('.*') + '$');
      return re.test(dir);
    });
    if (!matches) continue;
    const sub = readJson(root, f);
    workspaces.push({ name: (sub && sub.name) || basename(dir), path: dir, kind: 'node' });
  }
  workspaces.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/detect.mjs')) {
  runMain((_, flags) => detect(resolveRoot(flags)));
}
