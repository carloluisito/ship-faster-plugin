import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './git.mjs';
import { normalizePath } from './glob.mjs';
import { dataDir, projectHash, readJson, writeJsonAtomic } from './state.mjs';

export function resolveRoot(flags = {}, cwd = process.cwd()) {
  if (typeof flags.root === 'string' && flags.root.trim()) return normalizePath(flags.root);
  return repoRoot(cwd) || normalizePath(cwd);
}

export function resolveRootCached(cwd = process.cwd()) {
  const file = join(dataDir(), 'cwd-cache', `${projectHash(cwd)}.json`);
  const cached = readJson(file, null);
  if (cached && typeof cached.root === 'string' && Date.now() - Date.parse(cached.at) < 86400_000 && existsSync(join(cached.root, '.git'))) {
    return cached.root;
  }
  const root = repoRoot(cwd) || normalizePath(cwd);
  writeJsonAtomic(file, { root, at: new Date().toISOString() });
  return root;
}
