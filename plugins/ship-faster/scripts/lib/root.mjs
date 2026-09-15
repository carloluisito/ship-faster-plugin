import { repoRoot } from './git.mjs';
import { normalizePath } from './glob.mjs';

export function resolveRoot(flags = {}, cwd = process.cwd()) {
  if (typeof flags.root === 'string' && flags.root.trim()) return normalizePath(flags.root);
  return repoRoot(cwd) || normalizePath(cwd);
}
