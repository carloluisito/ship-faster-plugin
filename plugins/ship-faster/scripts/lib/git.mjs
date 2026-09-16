import { spawnSync } from 'node:child_process';
import { normalizePath } from './glob.mjs';

export function git(args, { cwd, timeoutMs = 2000 } = {}) {
  try {
    const r = spawnSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
    });
    if (r.error) return { ok: false, stdout: '', stderr: String(r.error.message || r.error), code: null };
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '', code: r.status };
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

export function dirtyFiles(cwd, { timeoutMs = 5000 } = {}) {
  const r = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, timeoutMs });
  if (!r.ok) return [];
  const parts = splitZ(r.stdout);
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status[0] === 'R' || status[0] === 'C') i++;
    result.push({ path: normalizePath(path), status: status.trim() || '??' });
  }
  return result;
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
