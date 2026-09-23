import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  wikiDir: 'docs/wiki',
  plansDir: 'docs/plans',
  rulesDir: '.claude/rules',
  defaultBranch: 'auto',
  protectedBranches: Object.freeze(['main', 'master']),
  guard: Object.freeze({ forcePush: 'deny', pushProtected: 'deny', noVerify: 'deny', addAll: 'deny', prOutsideShip: 'warn' }),
  healthCadenceDays: 14,
  pageMaxLines: 200,
  claudeMdMaxLines: 150,
  rulesFileMaxLines: 25,
  checkTimeoutSeconds: 600,
});

const DIR_KEYS = ['wikiDir', 'plansDir', 'rulesDir'];
const INT_KEYS = ['healthCadenceDays', 'pageMaxLines', 'claudeMdMaxLines', 'rulesFileMaxLines', 'checkTimeoutSeconds'];
const GUARD_VALUES = new Set(['deny', 'ask', 'warn', 'allow']);

export function loadConfig(root) {
  const file = join(root, '.claude', 'ship-faster.json');
  const config = { ...DEFAULTS, protectedBranches: [...DEFAULTS.protectedBranches], guard: { ...DEFAULTS.guard } };
  const errors = [];
  if (!existsSync(file)) return { config, errors, file: null };
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { config, errors: [`invalid JSON in ${file}: ${e.message}`], file }; }
  if (!raw || typeof raw !== 'object') return { config, errors: ['config must be a JSON object'], file };

  for (const key of DIR_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (typeof v === 'string' && v.trim() && !v.split(/[\\/]/).includes('..')) config[key] = v.replace(/\\/g, '/').replace(/\/+$/, '');
    else errors.push(`${key} must be a relative directory without "..", got ${JSON.stringify(v)}`);
  }
  for (const key of INT_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (Number.isInteger(v) && v > 0) config[key] = v;
    else errors.push(`${key} must be a positive integer, got ${JSON.stringify(v)}`);
  }
  if ('defaultBranch' in raw) {
    if (typeof raw.defaultBranch === 'string' && raw.defaultBranch.trim()) config.defaultBranch = raw.defaultBranch.trim();
    else errors.push('defaultBranch must be a non-empty string');
  }
  if ('protectedBranches' in raw) {
    const v = raw.protectedBranches;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim())) config.protectedBranches = v.map((x) => x.trim());
    else errors.push('protectedBranches must be an array of branch names');
  }
  if ('guard' in raw) {
    if (raw.guard && typeof raw.guard === 'object' && !Array.isArray(raw.guard)) {
      for (const [k, v] of Object.entries(raw.guard)) {
        if (!(k in DEFAULTS.guard)) { errors.push(`guard.${k} is not a known rule`); continue; }
        if (GUARD_VALUES.has(v)) config.guard[k] = v;
        else errors.push(`guard.${k} must be deny, ask, warn, or allow, got ${JSON.stringify(v)}`);
      }
    } else errors.push('guard must be an object');
  }
  return { config, errors, file };
}
