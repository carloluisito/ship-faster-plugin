import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { preflightDir, writeJsonAtomic } from './lib/state.mjs';
import { loadWiki } from './lib/wiki.mjs';
import { detect } from './detect.mjs';

const CONTINUED = /(\\|&&|\|)$/;
const INSTALL = /^(npm (ci|install|i)\b|pnpm (install|i)\b|yarn( install)?$|pip3? install|poetry install|dotnet restore|go mod download|cargo fetch|bundle install)/;
const UNSAFE = /\b(deploy|publish|release|push|upload)\b|docker (build|push)|terraform apply|kubectl apply|aws s3/i;

function classify(run, stepName) {
  if (run.includes('${{')) return 'uses a CI expression that cannot be resolved locally';
  if (INSTALL.test(run)) return 'install step';
  if (/^echo\b[^&|;]*$/.test(run)) return 'echo only';
  if (UNSAFE.test(run) || (stepName && UNSAFE.test(stepName))) return 'deploy-like command is never run locally';
  return null;
}

function extractCi(root, ciFiles) {
  const found = [];
  for (const { path } of ciFiles) {
    let text;
    try { text = readFileSync(join(root, path), 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    let stepName = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*-\s/.test(line)) stepName = null;
      const nm = /^(?:\s*-\s*|\s+)name:\s*(.+)$/.exec(line);
      if (nm) { stepName = nm[1].trim().replace(/^["']|["']$/g, ''); continue; }
      const m = /^(\s*)(?:-\s*)?(run|script|bash|pwsh):\s*(.*)$/.exec(line);
      if (!m) continue;
      const indent = m[1].length;
      const value = m[3].trim();
      if (value === '' || /^[|>][-+]?$/.test(value)) {
        let blockName = null;
        let sequence = null;
        let previous = null;
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j];
          if (!l.trim()) continue;
          if (l.match(/^\s*/)[0].length <= indent) break;
          if (sequence === null) sequence = /^\s*-\s/.test(l);
          i = j;
          const cmd = /^\s*command:\s*(.+)$/.exec(l);
          if (cmd) { found.push({ run: cmd[1].trim(), stepName: blockName }); previous = null; continue; }
          const nmBlock = /^\s*name:\s*(.+)$/.exec(l);
          if (nmBlock) { blockName = nmBlock[1].trim().replace(/^["']|["']$/g, ''); previous = null; continue; }
          if (/^\s*[\w-]+:(\s|$)/.test(l)) { previous = null; continue; }
          const text = l.trim();
          const item = sequence ? text.replace(/^-\s+/, '') : text;
          if (!item) continue;
          if (previous && CONTINUED.test(previous.run)) { previous.run = `${previous.run.replace(/\\$/, '').trimEnd()} ${item}`; continue; }
          previous = { run: item, stepName };
          found.push(previous);
        }
      } else {
        found.push({ run: value.replace(/^["']|["']$/g, ''), stepName });
      }
      stepName = null;
    }
  }
  return found;
}

export function resolveChecks(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const timeout = config.checkTimeoutSeconds;
  const wiki = loadWiki(root, config);
  const commands = wiki.pages.find((p) => p.rel.endsWith('/commands.md') && p.data && Array.isArray(p.data.checks));
  if (commands) {
    const wikiChecks = [];
    const wikiExcluded = [];
    commands.data.checks.forEach((c, i) => {
      const name = String((c && c.name) || `check-${i + 1}`);
      if (c && typeof c.run === 'string' && c.run.trim()) {
        wikiChecks.push({ name, run: c.run.trim(), timeout: Number.isInteger(c.timeout) && c.timeout > 0 ? c.timeout : timeout, source: 'wiki' });
      } else {
        wikiExcluded.push({ name, run: (c && typeof c.run === 'string') ? c.run : '', why: 'invalid check entry: missing run' });
      }
    });
    return { ok: true, source: 'wiki', checks: wikiChecks, excluded: wikiExcluded };
  }
  const facts = detect(root);
  const excluded = [];
  const checks = [];
  const seen = new Set();
  extractCi(root, facts.ci).forEach((c, i) => {
    if (seen.has(c.run)) return;
    seen.add(c.run);
    const why = classify(c.run, c.stepName);
    const name = c.stepName || `check-${i + 1}`;
    if (why) excluded.push({ name, run: c.run, why });
    else checks.push({ name, run: c.run, timeout, source: 'ci' });
  });
  if (checks.length) return { ok: true, source: 'ci', checks, excluded };
  if (facts.suggestedChecks.length) return { ok: true, source: 'detect', checks: facts.suggestedChecks.map((c) => ({ ...c, timeout: c.timeout || timeout })), excluded };
  return { ok: true, source: 'none', checks: [], excluded };
}

function tailOf(text, lines = 60, max = 4096) {
  const t = text.split(/\r?\n/).slice(-lines).join('\n');
  return t.length > max ? t.slice(-max) : t;
}

function prune(dir, keep = 10) {
  const logs = readdirSync(dir).filter((n) => n.endsWith('.log'));
  const stamps = [...new Set(logs.map((n) => n.slice(0, 24)))].sort();
  for (const s of stamps.slice(0, Math.max(0, stamps.length - keep))) {
    for (const n of logs) if (n.startsWith(s)) rmSync(join(dir, n), { force: true });
  }
}

function runCommands(root, commands, { config, prefix = '', continueOnFail = false }) {
  const dir = preflightDir(root);
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  let stop = false;
  let totalMs = 0;
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (stop) { results.push({ name: c.name, run: c.run, status: 'skipped', exitCode: null, durationMs: 0, tail: '', log: null }); continue; }
    const started = Date.now();
    const r = spawnSync(c.run, { shell: true, cwd: root, encoding: 'utf8', timeout: (c.timeout || config.checkTimeoutSeconds) * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, windowsHide: true });
    const durationMs = Date.now() - started;
    totalMs += durationMs;
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
    const status = timedOut ? 'timeout' : r.status === 0 ? 'pass' : 'fail';
    const file = join(dir, `${prefix}${at}-${String(i + 1).padStart(2, '0')}-${c.name.replace(/[^\w.-]+/g, '_')}.log`);
    let log = normalizePath(file);
    try { writeFileSync(file, `$ ${c.run}\n${output}`); } catch { log = null; }
    results.push({ name: c.name, run: c.run, status, exitCode: r.status ?? null, durationMs, tail: status === 'pass' ? '' : tailOf(output), log });
    if (status !== 'pass' && !continueOnFail) stop = true;
  }
  return { dir, at, results, totalMs };
}

function hasDependencies(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return ['dependencies', 'devDependencies', 'optionalDependencies'].some((k) => pkg[k] && typeof pkg[k] === 'object' && Object.keys(pkg[k]).length > 0);
  } catch {
    return false;
  }
}

export function resolveSetup(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const timeout = config.checkTimeoutSeconds;
  const wiki = loadWiki(root, config);
  const commands = wiki.pages.find((p) => p.rel.endsWith('/commands.md') && p.data && Array.isArray(p.data.setup));
  if (commands) {
    const setup = [];
    const excluded = [];
    commands.data.setup.forEach((c, i) => {
      const name = String((c && c.name) || `setup-${i + 1}`);
      if (c && typeof c.run === 'string' && c.run.trim()) setup.push({ name, run: c.run.trim(), timeout: Number.isInteger(c.timeout) && c.timeout > 0 ? c.timeout : timeout, source: 'wiki' });
      else excluded.push({ name, run: (c && typeof c.run === 'string') ? c.run : '', why: 'invalid setup entry: missing run' });
    });
    return { ok: true, source: 'wiki', setup, excluded };
  }
  const has = (rel) => existsSync(join(root, rel));
  const setup = [];
  const add = (name, run) => setup.push({ name, run, timeout, source: 'detect' });
  // Only installs that stay inside the project: no global pip or gem installs from a guess.
  if (has('package.json')) {
    if (has('pnpm-lock.yaml')) add('pnpm install', 'pnpm install --frozen-lockfile');
    else if (has('yarn.lock')) add('yarn install', has('.yarnrc.yml') ? 'yarn install --immutable' : 'yarn install --frozen-lockfile');
    else if (has('bun.lockb') || has('bun.lock')) add('bun install', 'bun install --frozen-lockfile');
    else if (has('package-lock.json')) add('npm ci', 'npm ci');
    else if (hasDependencies(root)) add('npm install', 'npm install --no-package-lock');
  }
  const facts = detect(root);
  if (facts.stacks.some((s) => s.kind === 'dotnet')) add('dotnet restore', 'dotnet restore');
  if (has('go.mod') && has('go.sum')) add('go mod download', 'go mod download');
  if (has('Cargo.toml') && has('Cargo.lock')) add('cargo fetch', 'cargo fetch');
  if (has('uv.lock')) add('uv sync', 'uv sync');
  else if (has('poetry.lock')) add('poetry install', 'poetry install');
  return { ok: true, source: setup.length ? 'detect' : 'none', setup, excluded: [] };
}

export function runSetup(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const r = resolveSetup(root, { config });
  const { results, totalMs } = runCommands(root, r.setup, { config, prefix: 'setup-' });
  const passed = results.every((c) => c.status === 'pass');
  const failed = results.find((c) => c.status !== 'pass' && c.status !== 'skipped');
  return {
    ok: true,
    passed,
    source: r.source,
    commands: results,
    excluded: r.excluded,
    summary: results.length === 0
      ? [`setup: nothing to install (source: ${r.source})`]
      : [passed ? `setup: PASS (${results.length} command(s), ${(totalMs / 1000).toFixed(1)}s)` : `setup: FAIL at ${failed.name} (${failed.status}${failed.exitCode !== null ? ` exit ${failed.exitCode}` : ''})${failed.log ? ` log: ${failed.log}` : ''}`],
  };
}

export function runChecks(root, { config, checks, continueOnFail = false } = {}) {
  config = config || loadConfig(root).config;
  let source = 'given';
  if (!checks) { const r = resolveChecks(root, { config }); checks = r.checks; source = r.source; }
  const { dir, at, results, totalMs } = runCommands(root, checks, { config, continueOnFail });
  const passed = checks.length > 0 && results.every((r) => r.status === 'pass');
  const first = results.find((r) => r.status !== 'pass' && r.status !== 'skipped');
  const summary = checks.length === 0
    ? [`preflight: no checks resolved (source: ${source})`]
    : [passed ? `preflight: PASS (${results.length} checks, ${(totalMs / 1000).toFixed(1)}s)` : `preflight: FAIL at ${first ? first.name : '?'} (${first ? first.status + (first.exitCode !== null ? ' exit ' + first.exitCode : '') : ''}, ${(totalMs / 1000).toFixed(1)}s)${first && first.log ? ` log: ${first.log}` : ''}`];
  const result = {
    ok: true,
    passed,
    source,
    at,
    head: git.head(root),
    checks: results,
    lastJson: normalizePath(join(dir, 'last.json')),
    summary,
  };
  writeJsonAtomic(join(dir, 'last.json'), result);
  try { prune(dir); } catch {}
  return result;
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/checks.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const cmd = positional[0] || 'resolve';
    if (cmd === 'resolve') {
      const r = resolveChecks(root, { config });
      return { ...r, summary: [`${r.checks.length} check(s) from ${r.source}`, ...r.checks.map((c) => `${c.name}: ${c.run}`), ...r.excluded.map((e) => `excluded ${e.run} (${e.why})`)] };
    }
    if (cmd === 'run') return runChecks(root, { config, continueOnFail: Boolean(flags.continue) });
    if (cmd === 'setup') return runSetup(root, { config });
    return { ok: false, error: `unknown command ${cmd}; use resolve, run, or setup` };
  });
}
