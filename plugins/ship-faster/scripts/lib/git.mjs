import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizePath } from './glob.mjs';

export function git(args, { cwd, timeoutMs = 2000, input, raw = false } = {}) {
  try {
    const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: cwd || process.cwd(),
      encoding: raw ? 'buffer' : 'utf8',
      input,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
    });
    if (r.error) return { ok: false, stdout: raw ? Buffer.alloc(0) : '', stderr: String(r.error.message || r.error), code: null };
    const stdout = raw ? (r.stdout || Buffer.alloc(0)) : (r.stdout || '');
    return { ok: r.status === 0, stdout, stderr: String(r.stderr || ''), code: r.status };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String((e && e.message) || e), code: null };
  }
}

function out(args, cwd, timeoutMs) {
  const r = git(args, { cwd, timeoutMs });
  return r.ok ? r.stdout.trim() : null;
}

export function isRepo(cwd) {
  return out(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

export function repoRoot(cwd) {
  const v = out(['rev-parse', '--show-toplevel'], cwd);
  return v ? normalizePath(v) : null;
}

export function head(cwd) {
  const v = out(['rev-parse', '--verify', '-q', 'HEAD'], cwd);
  return v && /^[0-9a-f]{40}$/.test(v) ? v : null;
}

export function commitExists(cwd, sha) {
  if (!sha || !/^[0-9a-f]{4,40}$/i.test(sha)) return false;
  return git(['cat-file', '-e', `${sha}^{commit}`], { cwd }).ok;
}

export function currentBranch(cwd) {
  const v = out(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return v && v !== 'HEAD' ? v : null;
}

export function branchExists(cwd, name) {
  return git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd }).ok;
}

export function isMerged(cwd, branch, into) {
  if (!branchExists(cwd, branch) || !into) return false;
  return git(['merge-base', '--is-ancestor', branch, into], { cwd }).ok;
}

export function defaultBranch(cwd) {
  const ref = out(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], cwd);
  if (ref) return ref.replace(/^refs\/remotes\/origin\//, '');
  if (!isRepo(cwd)) return null;
  if (branchExists(cwd, 'main')) return 'main';
  if (branchExists(cwd, 'master')) return 'master';
  return null;
}

function splitZ(s) {
  return s.split('\0').filter((x) => x.length > 0);
}

export function changedSince(cwd, sha) {
  if (!commitExists(cwd, sha)) return null;
  const r = git(['diff', '--name-only', '-z', sha, 'HEAD'], { cwd, timeoutMs: 5000 });
  if (!r.ok) return null;
  return splitZ(r.stdout).map(normalizePath);
}

export function changedBetween(cwd, ref) {
  const r0 = String(ref || '');
  if (!r0 || r0.startsWith('-')) return null;
  const r = git(['diff', '--name-only', '-z', `${r0}...HEAD`], { cwd, timeoutMs: 5000 });
  if (!r.ok) return null;
  return splitZ(r.stdout).map(normalizePath);
}

export function dirtyFiles(cwd, { timeoutMs = 5000 } = {}) {
  const r = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, timeoutMs });
  if (!r.ok) return [];
  const parts = splitZ(r.stdout);
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    const item = { path: normalizePath(entry.slice(3)), status: status.trim() || '??' };
    if (status[0] === 'R' || status[0] === 'C') {
      if (parts[i + 1] !== undefined) item.from = normalizePath(parts[i + 1]);
      i++;
    }
    result.push(item);
  }
  return result;
}

function chunks(list, size = 100) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function lastCommitTimes(cwd, paths, { n = 2000 } = {}) {
  const times = new Map();
  for (const chunk of chunks([...new Set(paths)].filter(Boolean))) {
    const r = git(['log', `-n${n}`, '--pretty=format:__C__%ct', '--name-only', 'HEAD', '--', ...chunk], { cwd, timeoutMs: 10000 });
    if (!r.ok) continue;
    let at = null;
    for (const line of r.stdout.split(/\r?\n/)) {
      if (line.startsWith('__C__')) { at = Number(line.slice(5)) * 1000; continue; }
      const p = normalizePath(line.trim());
      if (p && at !== null && !times.has(p)) times.set(p, at);
    }
  }
  return times;
}

export function blobIds(cwd, ref, paths) {
  const ids = new Map();
  if (!ref || String(ref).startsWith('-')) return ids;
  for (const chunk of chunks([...new Set(paths)].filter(Boolean))) {
    const r = git(['ls-tree', '-r', '-z', ref, '--', ...chunk], { cwd, timeoutMs: 10000 });
    if (!r.ok) continue;
    for (const entry of splitZ(r.stdout)) {
      const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/s.exec(entry);
      if (m) ids.set(normalizePath(m[2]), m[1]);
    }
  }
  return ids;
}

export function hashFiles(cwd, paths) {
  const ids = new Map();
  // hash-object fails the whole batch on one missing path, so only regular files go in.
  const regular = [...new Set(paths)].filter((p) => {
    if (!p || p.includes('\n')) return false;
    try { return lstatSync(join(cwd, p)).isFile(); } catch { return false; }
  });
  for (const chunk of chunks(regular)) {
    const r = git(['hash-object', '--stdin-paths'], { cwd, input: chunk.join('\n') + '\n', timeoutMs: 10000 });
    if (!r.ok) continue;
    const lines = r.stdout.trim().split(/\r?\n/);
    if (lines.length !== chunk.length) continue;
    chunk.forEach((p, i) => { if (/^[0-9a-f]{40}$/.test(lines[i])) ids.set(p, lines[i]); });
  }
  return ids;
}

export function trackedFiles(cwd) {
  const r = git(['ls-files', '-z'], { cwd, timeoutMs: 5000 });
  return r.ok ? splitZ(r.stdout).map(normalizePath) : [];
}

function parseLog(stdout, meta) {
  const commits = [];
  let cur = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('__C__')) {
      const [sha, rest] = line.slice(5).split('\x1f');
      cur = { sha, ...meta(rest || ''), files: [] };
      commits.push(cur);
    } else if (cur && line.trim()) {
      cur.files.push(normalizePath(line.trim()));
    }
  }
  return commits;
}

export function log(cwd, { n = 500 } = {}) {
  const r = git(['log', `-n${n}`, '--no-merges', '--pretty=format:__C__%H%x1f%s', '--name-only'], { cwd, timeoutMs: 10000 });
  return r.ok ? parseLog(r.stdout, (subject) => ({ subject })) : [];
}

export function logTopo(cwd, range, { n = 2000 } = {}) {
  // combined diffs list only what a merge commit changed relative to every parent: an evil merge
  // shows its files, a clean merge shows nothing its side commits do not already report.
  const r = git(['log', '--topo-order', `-n${n}`, '--diff-merges=combined', '--pretty=format:__C__%H%x1f%P', '--name-only', range], { cwd, timeoutMs: 10000 });
  return r.ok ? parseLog(r.stdout, (parents) => ({ parents: parents.split(' ').filter(Boolean) })) : [];
}

export function commitsSince(cwd, sha, { n = 2000 } = {}) {
  if (!commitExists(cwd, sha)) return null;
  const r = git(['log', '--topo-order', `-n${n}`, '--diff-merges=combined', '--pretty=format:__C__%H%x1f%P', '--name-only', `${sha}..HEAD`], { cwd, timeoutMs: 10000 });
  if (!r.ok) return null;
  const commits = parseLog(r.stdout, (parents) => ({ parents: parents.split(' ').filter(Boolean) }));
  return { commits, truncated: commits.length >= n };
}

const SHA = /^[0-9a-f]{4,40}$/i;

export function mergeBase(cwd, shas) {
  const valid = (Array.isArray(shas) ? shas : []).map(String).filter((s) => SHA.test(s));
  if (valid.length === 0) return null;
  const v = out(['merge-base', '--octopus', ...valid], cwd, 5000);
  return v && /^[0-9a-f]{40}$/.test(v) ? v : null;
}

export function lastTag(cwd, { match } = {}) {
  const args = ['describe', '--tags', '--abbrev=0'];
  if (match) args.push('--match', match);
  const tag = out(args, cwd);
  if (!tag) return null;
  const sha = out(['rev-list', '-n1', tag], cwd);
  return sha && /^[0-9a-f]{40}$/.test(sha) ? { tag, sha } : null;
}

export function tagExists(cwd, name) {
  return git(['show-ref', '--verify', '--quiet', `refs/tags/${name}`], { cwd }).ok;
}

export function subjects(cwd, { n = 30 } = {}) {
  const v = out(['log', `-n${n}`, '--no-merges', '--pretty=%s'], cwd, 5000);
  return v ? v.split(/\r?\n/).filter(Boolean) : [];
}

export function logSince(cwd, ref, { n = 500 } = {}) {
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  const r = git(['log', `-n${n}`, '--pretty=format:%H%x1f%P%x1f%s', range], { cwd, timeoutMs: 10000 });
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, parents, subject] = line.split('\x1f');
    return { sha, parents: (parents || '').split(' ').filter(Boolean), subject: subject || '' };
  });
}

export function aheadBehind(cwd, base) {
  if (!base || String(base).startsWith('-')) return null;
  const v = out(['rev-list', '--left-right', '--count', `${base}...HEAD`], cwd, 5000);
  if (!v) return null;
  const [behind, ahead] = v.split(/\s+/).map(Number);
  return Number.isInteger(ahead) && Number.isInteger(behind) ? { ahead, behind } : null;
}

export function upstream(cwd) {
  return out(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
}

export function remoteUrl(cwd, name = 'origin') {
  return out(['remote', 'get-url', name], cwd);
}

export function isAncestor(cwd, a, b) {
  if (!a || !b) return false;
  return git(['merge-base', '--is-ancestor', a, b], { cwd }).ok;
}

export function worktrees(cwd) {
  const r = git(['worktree', 'list', '--porcelain'], { cwd, timeoutMs: 5000 });
  if (!r.ok) return null;
  const list = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: normalizePath(line.slice(9).trim()), head: null, branch: null, detached: false, bare: false };
      list.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (line.trim() === 'detached') {
      cur.detached = true;
    } else if (line.trim() === 'bare') {
      cur.bare = true;
    }
  }
  return list.map((w, i) => ({ ...w, isMain: i === 0 }));
}

function absoluteGitPath(cwd, flag) {
  const modern = out(['rev-parse', '--path-format=absolute', flag], cwd);
  if (modern && !modern.includes('\n') && !modern.startsWith('--')) return modern;
  const legacy = out(['rev-parse', flag], cwd);
  return legacy ? resolve(cwd, legacy) : null;
}

export function worktreeInfo(cwd) {
  const path = repoRoot(cwd);
  if (!path) return null;
  const gitDir = absoluteGitPath(cwd, '--git-dir');
  const common = absoluteGitPath(cwd, '--git-common-dir');
  if (!gitDir || !common) return null;
  return {
    isWorktree: normalizePath(gitDir) !== normalizePath(common),
    mainRoot: normalizePath(gitDir) === normalizePath(common) ? path : normalizePath(dirname(common)),
    path,
  };
}
