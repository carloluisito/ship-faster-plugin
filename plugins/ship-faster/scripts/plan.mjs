import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { parseFrontmatter, updateFrontmatter } from './lib/fm.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { relPath } from './lib/wiki.mjs';

const STATUSES = new Set(['active', 'shipped', 'abandoned']);

function plansDir(root, config) {
  return join(root, ...config.plansDir.split('/'));
}

export function listPlans(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const dir = plansDir(root, config);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => {
    const file = join(dir, n);
    try {
      const { data, errors } = parseFrontmatter(readFileSync(file, 'utf8'));
      return { file, rel: relPath(root, file), data: data || {}, errors };
    } catch {
      return null;
    }
  }).filter((p) => p !== null);
}

const isActive = (p) => !p.data.status || p.data.status === 'active';

export function findPlan(root, { config, branch } = {}) {
  config = config || loadConfig(root).config;
  const matches = listPlans(root, { config }).filter((p) => isActive(p) && p.data.branch === branch);
  matches.sort((a, b) => {
    const aCreated = String(a.data.created || '');
    const bCreated = String(b.data.created || '');
    const cmp = bCreated < aCreated ? -1 : bCreated > aCreated ? 1 : 0;
    return cmp || (b.rel < a.rel ? -1 : b.rel > a.rel ? 1 : 0);
  });
  const plan = matches[0] ? { file: matches[0].file, rel: matches[0].rel, data: matches[0].data } : null;
  return { ok: true, plan, summary: [plan ? `plan for ${branch}: ${plan.rel}` : `no active plan for ${branch}`] };
}

export function stalePlans(root, { config, days = 30 } = {}) {
  config = config || loadConfig(root).config;
  const cutoff = Date.now() - days * 86400_000;
  const base = git.isRepo(root) ? git.defaultBranch(root) : null;
  const plans = [];
  for (const p of listPlans(root, { config })) {
    if (!isActive(p) || !p.data.branch || !p.data.created) continue;
    const created = Date.parse(String(p.data.created));
    if (Number.isNaN(created) || created > cutoff) continue;
    const branch = String(p.data.branch);
    let reason = null;
    if (!git.branchExists(root, branch)) reason = 'branch gone';
    else if (base && git.isMerged(root, branch, base)) reason = 'branch merged';
    if (reason) plans.push({ rel: p.rel, branch, created: String(p.data.created), reason });
  }
  return { ok: true, plans, summary: [`${plans.length} stale plan(s)`, ...plans.map((p) => `${p.rel}: ${p.reason}`)] };
}

export function setPlanStatus(root, fileOrRel, status) {
  if (!STATUSES.has(status)) return { ok: false, error: `status must be one of ${[...STATUSES].join(', ')}` };
  const file = isAbsolute(fileOrRel) ? fileOrRel : join(root, ...normalizePath(fileOrRel).split('/'));
  const { config } = loadConfig(root);
  const dir = plansDir(root, config);
  const normalizedFile = normalizePath(resolve(file));
  const normalizedDir = normalizePath(resolve(dir));
  if (!normalizedFile.startsWith(normalizedDir + '/')) return { ok: false, error: `plan must be inside ${config.plansDir}` };
  if (!existsSync(file)) return { ok: false, error: `plan not found: ${fileOrRel}` };
  writeFileSync(file, updateFrontmatter(readFileSync(file, 'utf8'), { status }));
  const rel = relPath(root, file);
  return { ok: true, rel, status, summary: [`${rel}: status ${status}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/plan.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const [cmd, a, b] = positional;
    if (cmd === 'find') return typeof flags.branch === 'string' ? findPlan(root, { config, branch: flags.branch }) : { ok: false, error: 'find requires --branch <name>' };
    if (cmd === 'stale') {
      const given = flags.days;
      const days = given === undefined ? 30 : typeof given === 'string' || typeof given === 'number' ? Number(given) : NaN;
      if (!Number.isInteger(days) || days < 0) return { ok: false, error: '--days must be a non-negative integer' };
      return stalePlans(root, { config, days });
    }
    if (cmd === 'set-status') return a && b ? setPlanStatus(root, a, b) : { ok: false, error: 'set-status requires <file> <status>' };
    return { ok: false, error: `unknown command ${cmd}; use find, stale, or set-status` };
  });
}
