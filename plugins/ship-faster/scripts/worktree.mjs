import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { dropClaims } from './lib/state.mjs';

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

function repoPath(given) {
  const p = normalizePath(String(given || '').trim()).replace(/^\.\//, '');
  const parts = p.split('/');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || parts.some((s) => s === '' || s === '.' || s === '..') || parts[0] === '.git') return null;
  return p;
}

function sameRepoWorktree(root, given) {
  if (typeof given !== 'string' || !given.trim()) return { error: 'a worktree path is required' };
  const all = git.worktrees(root);
  if (!all) return { error: 'git worktree list failed' };
  const want = normalizePath(given.trim()).replace(/\/+$/, '').toLowerCase();
  const here = (git.repoRoot(root) || '').toLowerCase();
  const match = all.find((w) => w.path.toLowerCase() === want);
  if (!match) return { error: `${given} is not a worktree of this repository` };
  if (match.path.toLowerCase() === here) return { error: `${given} is this checkout, not another worktree` };
  return { path: match.path };
}

export function carryFiles(root, { to, files = [] } = {}) {
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const target = sameRepoWorktree(root, to);
  if (target.error) return { ok: false, error: target.error };
  const copied = [];
  const deleted = [];
  const skipped = [];
  for (const given of files) {
    const rel = repoPath(given);
    if (!rel) { skipped.push({ path: String(given), why: 'not a path inside the repository' }); continue; }
    const src = join(root, ...rel.split('/'));
    const dst = join(target.path, ...rel.split('/'));
    let st = null;
    try { st = lstatSync(src); } catch {}
    try {
      if (!st) {
        if (!existsSync(dst)) { skipped.push({ path: rel, why: 'missing in both checkouts' }); continue; }
        rmSync(dst, { force: true });
        deleted.push(rel);
      } else if (!st.isFile()) {
        skipped.push({ path: rel, why: st.isSymbolicLink() ? 'symbolic link' : 'not a regular file' });
      } else {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        if (process.platform !== 'win32') chmodSync(dst, st.mode & 0o777);
        copied.push(rel);
      }
    } catch (e) {
      skipped.push({ path: rel, why: `cannot write: ${String((e && e.code) || e)}` });
    }
  }
  return {
    ok: true,
    to: target.path,
    copied,
    deleted,
    skipped,
    summary: [`carried ${copied.length} file(s) and ${deleted.length} deletion(s) to ${target.path}`, ...skipped.map((s) => `skipped ${s.path}: ${s.why}`)],
  };
}

const toLf = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

// Takes the shipped change back out of a file that also holds another session's edits: a three-way merge
// from the shipped version to the original. All three sides are compared with LF endings, because a
// working tree file may be CRLF (autocrlf checkout) or LF (written by a tool) while blobs are usually LF.
function revertShipped(root, rel, { base, commit }) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-clear-'));
  try {
    const target = join(root, ...rel.split('/'));
    const current = readFileSync(target);
    const shipped = git.git(['cat-file', 'blob', `${commit}:${rel}`], { cwd: root, raw: true, timeoutMs: 10000 });
    const original = git.git(['cat-file', 'blob', `${base}:${rel}`], { cwd: root, raw: true, timeoutMs: 10000 });
    if (!shipped.ok || !original.ok) return false;
    const files = { current: join(dir, 'current'), shipped: join(dir, 'shipped'), original: join(dir, 'original') };
    writeFileSync(files.current, toLf(current));
    writeFileSync(files.shipped, toLf(shipped.stdout));
    writeFileSync(files.original, toLf(original.stdout));
    const merged = git.git(['merge-file', '-p', files.current, files.shipped, files.original], { cwd: root, raw: true, timeoutMs: 10000 });
    if (!merged.ok) return false;
    const crlf = current.includes('\r\n');
    writeFileSync(target, crlf ? Buffer.from(merged.stdout.toString('latin1').replace(/\n/g, '\r\n'), 'latin1') : merged.stdout);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function clearFiles(root, { from, files = [], session = null } = {}) {
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const source = sameRepoWorktree(root, from);
  if (source.error) return { ok: false, error: source.error };
  const base = git.head(root);
  const commit = git.head(source.path);
  if (!base || !commit) return { ok: false, error: 'cannot resolve HEAD in both checkouts' };
  if (base === commit) return { ok: false, error: 'the worktree has no commit beyond this checkout; commit there first' };
  const kept = [];
  const rels = [];
  for (const given of files) {
    const rel = repoPath(given);
    if (rel) rels.push(rel);
    else kept.push({ path: String(given), why: 'not a path inside the repository' });
  }
  const committed = git.blobIds(root, commit, rels);
  const original = git.blobIds(root, base, rels);
  const current = git.hashFiles(root, rels);
  const cleared = [];
  const partial = [];
  const unchanged = [];
  const restore = [];
  const remove = [];
  for (const rel of rels) {
    const c = committed.get(rel) || null;
    const b = original.get(rel) || null;
    const cur = current.get(rel) || null;
    if (c === b) { unchanged.push(rel); continue; }
    if (cur === c) { (b ? restore : remove).push(rel); continue; }
    if (cur && b && c) {
      if (revertShipped(root, rel, { base, commit })) partial.push(rel);
      else kept.push({ path: rel, why: 'changed since it was carried' });
      continue;
    }
    kept.push({ path: rel, why: 'changed since it was carried' });
  }
  for (let i = 0; i < restore.length; i += 100) {
    const chunk = restore.slice(i, i + 100);
    const r = git.git(['checkout', 'HEAD', '--', ...chunk], { cwd: root, timeoutMs: 20000 });
    if (r.ok) cleared.push(...chunk);
    else kept.push(...chunk.map((path) => ({ path, why: `git checkout failed: ${(r.stderr || '').trim()}` })));
  }
  for (const rel of remove) {
    git.git(['rm', '--cached', '-q', '--ignore-unmatch', '--', rel], { cwd: root, timeoutMs: 10000 });
    try { rmSync(join(root, ...rel.split('/')), { force: true }); cleared.push(rel); } catch (e) { kept.push({ path: rel, why: `cannot delete: ${String((e && e.code) || e)}` }); }
  }
  dropClaims(root, cleared);
  if (session) dropClaims(root, partial, { sid: session });
  return {
    ok: true,
    from: source.path,
    commit,
    cleared,
    partial,
    kept,
    unchanged,
    summary: [
      `cleared ${cleared.length} file(s)${partial.length ? `, removed this change from ${partial.length} file(s) another session also edits` : ''} in this checkout (shipped in ${commit.slice(0, 7)})`,
      ...kept.map((k) => `kept ${k.path}: ${k.why}`),
      ...(unchanged.length ? [`not in the commit, left alone: ${unchanged.join(', ')}`] : []),
    ],
  };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/worktree.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const cmd = positional[0];
    if (cmd === 'list') return listWorktrees(root);
    if (cmd === 'add') {
      return addWorktree(root, {
        branch: typeof flags.branch === 'string' ? flags.branch : undefined,
        from: typeof flags.from === 'string' ? flags.from : undefined,
      });
    }
    if (cmd === 'carry') return carryFiles(root, { to: flags.to, files: positional.slice(1) });
    if (cmd === 'clear') return clearFiles(root, { from: flags.from, files: positional.slice(1), session: typeof flags.session === 'string' ? flags.session : null });
    return { ok: false, error: `unknown command ${cmd}; use list, add, carry, or clear` };
  });
}
