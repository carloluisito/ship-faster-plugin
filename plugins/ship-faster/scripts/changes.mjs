import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { isLarge, riskyReason } from './lib/risky.mjs';
import { resolveRoot } from './lib/root.mjs';

const CONVENTIONAL = /^(feat|fix|chore|docs|test|refactor|perf|build|ci|style|revert)(\([^)]*\))?!?: /;

export function commitStyle(subjects) {
  const sampled = subjects.length;
  const matching = subjects.filter((s) => CONVENTIONAL.test(s)).length;
  const share = sampled ? matching / sampled : 0;
  return { kind: sampled && share >= 0.6 ? 'conventional' : 'plain', share: Number(share.toFixed(2)), sampled };
}

export function changes(root, { config, base } = {}) {
  config = config || loadConfig(root).config;
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const branch = git.currentBranch(root);
  const defaultBranch = config.defaultBranch !== 'auto' ? config.defaultBranch : git.defaultBranch(root);
  const resolvedBase = base || defaultBranch;
  const localBase = resolvedBase ? git.branchExists(root, resolvedBase) : false;
  const remoteBase = resolvedBase && !localBase ? git.git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${resolvedBase}`], { cwd: root }).ok : false;
  if (resolvedBase && !localBase && !remoteBase) return { ok: false, error: `base branch ${resolvedBase} does not exist` };
  const baseRef = localBase ? resolvedBase : remoteBase ? `refs/remotes/origin/${resolvedBase}` : null;
  const protectedSet = new Set(config.protectedBranches);
  if (defaultBranch) protectedSet.add(defaultBranch);
  const dirty = git.dirtyFiles(root).map((d) => ({ path: d.path, status: d.status, risky: riskyReason(d.path), large: isLarge(root, d.path) }));
  const excluded = dirty.filter((d) => d.risky || d.large).map((d) => d.path);
  const counts = baseRef && branch !== resolvedBase ? git.aheadBehind(root, baseRef) : { ahead: 0, behind: 0 };
  if (counts === null) return { ok: false, error: `cannot compare with base ${resolvedBase}` };
  const subjects = git.subjects(root, { n: 30 });
  const ahead = counts.ahead;
  const result = {
    ok: true,
    branch,
    detached: branch === null,
    defaultBranch,
    base: resolvedBase || null,
    onProtected: branch !== null && protectedSet.has(branch),
    upstream: git.upstream(root),
    remote: git.remoteUrl(root),
    ahead,
    behind: counts.behind,
    dirty,
    excluded,
    commitStyle: commitStyle(subjects),
    subjects,
    hasWork: dirty.length > 0 || ahead > 0,
  };
  result.summary = [
    `${branch ? `branch ${branch}` : 'detached HEAD'} vs ${result.base || '(no base)'}: ${ahead} ahead, ${result.behind} behind, ${dirty.length} uncommitted file(s)${excluded.length ? `, ${excluded.length} excluded (${excluded.slice(0, 3).join(', ')}${excluded.length > 3 ? ', …' : ''})` : ''}`,
    `commit style: ${result.commitStyle.kind} (${Math.round(result.commitStyle.share * 100)}% of ${result.commitStyle.sampled})`,
  ];
  return result;
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/changes.mjs')) {
  runMain((_, flags) => changes(resolveRoot(flags), { base: typeof flags.base === 'string' ? flags.base : undefined }));
}
