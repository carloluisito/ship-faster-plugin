import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function safeRef(name) {
  return typeof name === 'string' && SAFE_REF.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock');
}

export function worktreePath(mainRoot, branch) {
  const root = normalizePath(mainRoot).replace(/\/+$/, '');
  return normalizePath(join(dirname(root), `${basename(root)}-${branch.replace(/[\\/]+/g, '-')}`));
}

export function listWorktrees(root) {
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const info = git.worktreeInfo(root);
  const all = git.worktrees(root);
  if (!info || !all) return { ok: false, error: 'git worktree list failed' };
  const here = normalizePath(info.path).toLowerCase();
  const current = all.find((w) => w.path.toLowerCase() === here) || null;
  const others = all.filter((w) => w.path.toLowerCase() !== here);
  const label = (w) => `${w.branch || 'detached'}: ${w.path}${w.isMain ? ' (main checkout)' : ''}`;
  return {
    ok: true,
    isWorktree: info.isWorktree,
    mainRoot: info.mainRoot,
    current,
    others,
    worktrees: all,
    summary: [
      `${info.isWorktree ? `worktree of ${info.mainRoot}` : 'main checkout'} on ${current && current.branch ? current.branch : 'detached HEAD'}`,
      ...(others.length ? others.map(label) : ['no other worktrees']),
    ],
  };
}

export function addWorktree(root, { branch, from } = {}) {
  if (!safeRef(branch)) return { ok: false, error: 'add requires --branch <name> made of letters, digits, ., _, / and -' };
  if (from !== undefined && !safeRef(from)) return { ok: false, error: '--from must name a branch or ref' };
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const info = git.worktreeInfo(root);
  if (!info) return { ok: false, error: 'cannot resolve the main checkout' };
  if (git.branchExists(root, branch)) return { ok: false, error: `branch ${branch} already exists` };
  const path = worktreePath(info.mainRoot, branch);
  if (existsSync(path)) return { ok: false, error: `${path} already exists (another branch may map to the same directory name)` };
  const args = ['worktree', 'add', path, '-b', branch];
  if (from) args.push(from);
  const r = git.git(args, { cwd: root, timeoutMs: 60000 });
  if (!r.ok) return { ok: false, error: `git worktree add failed: ${(r.stderr || r.stdout).trim()}` };
  const open = [`cd "${path}"`, 'claude'];
  return {
    ok: true,
    path,
    branch,
    from: from || null,
    mainRoot: info.mainRoot,
    open,
    summary: [`worktree ${path} on new branch ${branch}`, `open a session there: ${open[0]} then ${open[1]}`],
  };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/worktree.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    if (positional[0] === 'list') return listWorktrees(root);
    if (positional[0] === 'add') {
      return addWorktree(root, {
        branch: typeof flags.branch === 'string' ? flags.branch : undefined,
        from: typeof flags.from === 'string' ? flags.from : undefined,
      });
    }
    return { ok: false, error: `unknown command ${positional[0]}; use list or add` };
  });
}
