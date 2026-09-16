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

const INSTALL = /^(npm (ci|install|i)\b|pnpm (install|i)\b|yarn( install)?$|pip3? install|poetry install|dotnet restore|go mod download|cargo fetch|bundle install)/;
const UNSAFE = /deploy|publish|release|\bpush\b|upload|docker (build|push)|terraform apply|kubectl apply|aws s3/i;

function classify(run, stepName) {
  if (run.includes('${{')) return 'uses a CI expression that cannot be resolved locally';
  if (INSTALL.test(run)) return 'install step';
  if (/^echo\b/.test(run)) return 'echo only';
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
      const nm = /^\s*-?\s*name:\s*(.+)$/.exec(line);
      if (nm) { stepName = nm[1].trim().replace(/^["']|["']$/g, ''); continue; }
      const m = /^(\s*)(?:-\s*)?(run|script|bash|pwsh):\s*(.*)$/.exec(line);
      if (!m) continue;
      const indent = m[1].length;
      const value = m[3].trim();
      if (value === '' || /^[|>][-+]?$/.test(value)) {
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j];
          if (!l.trim()) continue;
          if (l.match(/^\s*/)[0].length <= indent) break;
          const item = l.trim().replace(/^-\s*/, '');
          if (item) found.push({ run: item, stepName });
          i = j;
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
    const valid = commands.data.checks.filter((c) => c && typeof c.run === 'string' && c.run.trim());
    if (valid.length) {
      return { ok: true, source: 'wiki', excluded: [], checks: valid.map((c, i) => ({ name: String(c.name || `check-${i + 1}`), run: c.run.trim(), timeout: Number.isInteger(c.timeout) && c.timeout > 0 ? c.timeout : timeout, source: 'wiki' })) };
    }
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

export function runChecks(root, { config, checks, continueOnFail = false } = {}) {
  config = config || loadConfig(root).config;
  let source = 'given';
  if (!checks) { const r = resolveChecks(root, { config }); checks = r.checks; source = r.source; }
  const dir = preflightDir(root);
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  let stop = false;
  let totalMs = 0;
  for (const c of checks) {
    if (stop) { results.push({ name: c.name, run: c.run, status: 'skipped', exitCode: null, durationMs: 0, tail: '', log: null }); continue; }
    const started = Date.now();
    const r = spawnSync(c.run, { shell: true, cwd: root, encoding: 'utf8', timeout: (c.timeout || config.checkTimeoutSeconds) * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, windowsHide: true });
    const durationMs = Date.now() - started;
    totalMs += durationMs;
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
    const status = timedOut ? 'timeout' : r.status === 0 ? 'pass' : 'fail';
    const log = join(dir, `${at}-${c.name.replace(/[^\w.-]+/g, '_')}.log`);
    writeFileSync(log, `$ ${c.run}\n${output}`);
    results.push({ name: c.name, run: c.run, status, exitCode: r.status ?? null, durationMs, tail: status === 'pass' ? '' : tailOf(output), log: normalizePath(log) });
    if (status !== 'pass' && !continueOnFail) stop = true;
  }
  const passed = results.every((r) => r.status === 'pass');
  const first = results.find((r) => r.status !== 'pass' && r.status !== 'skipped');
  const result = {
    ok: true,
    passed,
    source,
    at,
    head: git.head(root),
    checks: results,
    lastJson: normalizePath(join(dir, 'last.json')),
    summary: [passed ? `preflight: PASS (${results.length} checks, ${(totalMs / 1000).toFixed(1)}s)` : `preflight: FAIL at ${first ? first.name : '?'} (${first ? first.status + (first.exitCode !== null ? ' exit ' + first.exitCode : '') : ''}, ${(totalMs / 1000).toFixed(1)}s)${first && first.log ? ` log: ${first.log}` : ''}`],
  };
  writeJsonAtomic(join(dir, 'last.json'), result);
  prune(dir);
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
    return { ok: false, error: `unknown command ${cmd}; use resolve or run` };
  });
}
