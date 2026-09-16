import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = join(PLUGIN_ROOT, 'scripts');

const created = [];

export function tmpDir(prefix = 'sf-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupAll() {
  for (const dir of created.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function makeRepo({ files = {}, commits = [], branch = 'main' } = {}) {
  const root = tmpDir('sf-repo-');
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: gitEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(['init', '-q', '-b', branch]);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  if (Object.keys(files).length) {
    writeFiles(root, files);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);
  }
  for (const c of commits) {
    writeFiles(root, c.files || {});
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', c.message]);
  }
  return { root, git };
}

function gitEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
}

export function runScript(name, args = [], { cwd, stdin, env } = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`), ...args], {
    cwd: cwd || process.cwd(),
    input: stdin === undefined ? undefined : (typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
