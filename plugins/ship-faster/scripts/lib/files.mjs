import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRepo, trackedFiles } from './git.mjs';

export const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__']);

export function listRepoFiles(root) {
  if (isRepo(root)) return trackedFiles(root);
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
