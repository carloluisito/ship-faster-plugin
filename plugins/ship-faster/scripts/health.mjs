import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { listRepoFiles } from './lib/files.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { preflightDir, projectDir, readJson, writeJsonAtomic } from './lib/state.mjs';
import { lint } from './lint.mjs';
import { stalePlans } from './plan.mjs';
import { stale } from './stale.mjs';

const MARKER = /(?:\/\/|#|\/\*|\*|<!--|--|;)\s*(TODO|FIXME|HACK)\b/;
const SKIP_MARKERS = [
  [/\.skip\(/, '.skip('], [/\bxit\(/, 'xit('], [/\bxdescribe\(/, 'xdescribe('], [/\btest\.todo\(/, 'test.todo('],
  [/@pytest\.mark\.skip/, '@pytest.mark.skip'], [/@unittest\.skip/, '@unittest.skip'], [/\[Ignore\]/, '[Ignore]'], [/\[Fact\(Skip/, '[Fact(Skip'],
  [/\bt\.Skip\(/, 't.Skip('], [/#\[ignore\]/, '#[ignore]'], [/@Disabled\b/, '@Disabled'], [/@Ignore\b/, '@Ignore'],
];
const TEXT_MAX_BYTES = 512 * 1024;
const MAX_MARKERS = 60;
const DAY = 86400_000;

function isTextFile(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function blameAge(root, path, line, now) {
  const r = git.git(['blame', '-w', '-L', `${line},${line}`, '--porcelain', '--', path], { cwd: root, timeoutMs: 3000 });
  if (!r.ok) return null;
  const m = /^author-time (\d+)$/m.exec(r.stdout);
  return m ? Math.floor((now - Number(m[1]) * 1000) / DAY) : null;
}

function lastCommitAge(root, path, now) {
  const v = git.git(['log', '-1', '--format=%ct', '--', path], { cwd: root, timeoutMs: 3000 });
  const t = v.ok ? Number(v.stdout.trim()) : NaN;
  return Number.isFinite(t) && t > 0 ? Math.floor((now - t * 1000) / DAY) : null;
}

export function scanHealth(root, { config, todoAgeDays = 90, largeBytes = 1024 * 1024, recipeAgeDays = 90, now = Date.now() } = {}) {
  config = config || loadConfig(root).config;
  const isRepo = git.isRepo(root);
  const files = listRepoFiles(root);
  const todos = [];
  const skippedTests = [];
  const largeFiles = [];
  let markersSeen = 0;
  for (const rel of files) {
    let size;
    try { size = statSync(join(root, rel)).size; } catch { continue; }
    if (size > largeBytes) largeFiles.push({ path: rel, bytes: size });
    if (size > TEXT_MAX_BYTES || rel.startsWith(config.wikiDir + '/')) continue;
    let buf;
    try { buf = readFileSync(join(root, rel)); } catch { continue; }
    if (!isTextFile(buf)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    const isTest = /(^|\/)(tests?|__tests__|spec)\//.test(rel) || /\.(test|spec)\.\w+$/.test(rel) || /_test\.\w+$/.test(rel) || /Tests?\.\w+$/.test(rel) || /(^|\/)test_[^/]+\.py$/.test(rel);
    lines.forEach((text, i) => {
      const m = MARKER.exec(text);
      if (m && markersSeen < MAX_MARKERS) {
        markersSeen++;
        const ageDays = isRepo ? blameAge(root, rel, i + 1, now) : null;
        if (ageDays !== null && ageDays >= todoAgeDays) todos.push({ path: rel, line: i + 1, tag: m[1], text: text.trim().slice(0, 120), ageDays });
      }
      if (isTest) {
        const hit = SKIP_MARKERS.find(([re]) => re.test(text));
        if (hit) skippedTests.push({ path: rel, line: i + 1, marker: hit[1] });
      }
    });
  }
  const last = readJson(join(preflightDir(root), 'last.json'), null);
  const slowChecks = last && Array.isArray(last.checks)
    ? last.checks.filter((c) => Number.isFinite(c.durationMs)).sort((a, b) => b.durationMs - a.durationMs).slice(0, 3).map((c) => ({ name: c.name, durationMs: c.durationMs }))
    : [];
  const plansDir = join(root, ...config.plansDir.split('/'));
  const planText = existsSync(plansDir) ? readdirSync(plansDir).filter((n) => n.endsWith('.md')).map((n) => readFileSync(join(plansDir, n), 'utf8')).join('\n') : '';
  const staleRecipes = [];
  if (isRepo) {
    for (const rel of files.filter((f) => f.startsWith(`${config.wikiDir}/recipes/`) && f.endsWith('.md'))) {
      const name = rel.slice(config.wikiDir.length + 1).replace(/\.md$/, '');
      if (planText.includes(name)) continue;
      const ageDays = lastCommitAge(root, rel, now);
      if (ageDays !== null && ageDays >= recipeAgeDays) staleRecipes.push({ rel, ageDays });
    }
  }
  const plans = isRepo ? stalePlans(root, { config }).plans : [];
  const s = stale(root, { config });
  const l = lint(root, { config });
  const docs = { stale: s.counts.stale, dirty: s.counts.dirty, unverifiable: s.counts.unverifiable, invalid: s.counts.invalid, lintErrors: l.errors.length, overBudget: l.errors.filter((e) => e.rule === 'page-too-long').map((e) => e.file) };
  const summary = [
    `${todos.length} old TODO/FIXME/HACK, ${largeFiles.length} large file(s), ${skippedTests.length} skipped test(s), ${staleRecipes.length} stale recipe(s), ${plans.length} stale plan(s)`,
    `docs: ${docs.stale} stale, ${docs.dirty} dirty, ${docs.unverifiable} unverifiable, ${docs.invalid} invalid, ${docs.lintErrors} lint error(s)`,
  ];
  return { ok: true, todos, largeFiles, skippedTests, slowChecks, staleRecipes, plans, docs, summary };
}

export function recordHealth(root, counts = {}) {
  const file = join(projectDir(root), 'health.json');
  const lastRun = new Date().toISOString();
  const ok = writeJsonAtomic(file, { lastRun, counts });
  return { ok, file: normalizePath(file), lastRun, summary: [ok ? `health.json written (${lastRun})` : 'health.json could not be written'] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/health.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    if (positional[0] === 'scan') return scanHealth(root);
    if (positional[0] === 'record') {
      const n = flags.findings === undefined ? 0 : Number(flags.findings);
      if (!Number.isInteger(n) || n < 0) return { ok: false, error: '--findings must be a non-negative integer' };
      return recordHealth(root, { findings: n });
    }
    return { ok: false, error: `unknown command ${positional[0]}; use scan or record` };
  });
}
