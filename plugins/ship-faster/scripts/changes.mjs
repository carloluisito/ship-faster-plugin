import { flagList, runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { ownership } from './lib/ownership.mjs';
import { isLarge, riskyReason } from './lib/risky.mjs';
import { resolveRoot } from './lib/root.mjs';

const CONVENTIONAL = /^(feat|fix|chore|docs|test|refactor|perf|build|ci|style|revert)(\([^)]*\))?!?: /;

export function commitStyle(subjects) {
  const sampled = subjects.length;
  const matching = subjects.filter((s) => CONVENTIONAL.test(s)).length;
  const share = sampled ? matching / sampled : 0;
  return { kind: sampled && share >= 0.6 ? 'conventional' : 'plain', share: Number(share.toFixed(2)), sampled };
}

export function changes(root, { config, base, session = null, include = [], here = false } = {}) {
  config = config || loadConfig(root).config;
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const branch = git.currentBranch(root);
  const defaultBranch = config.defaultBranch !== 'auto' ? config.defaultBranch : git.defaultBranch(root);
  const resolvedBase = base || defaultBranch;
  const localBase = resolvedBase ? git.branchExists(root, resolvedBase) : false;
  const remoteBase = resolvedBase ? git.git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${resolvedBase}`], { cwd: root }).ok : false;
  if (resolvedBase && !localBase && !remoteBase) return { ok: false, error: `base branch ${resolvedBase} does not exist` };
  const baseRef = localBase ? resolvedBase : remoteBase ? `refs/remotes/origin/${resolvedBase}` : null;
  const protectedSet = new Set(config.protectedBranches);
  if (defaultBranch) protectedSet.add(defaultBranch);
  const listed = git.dirtyFiles(root);
  const seen = new Set(listed.map((d) => d.path));
  // A staged rename lists only its new path; its old path is a deletion that has to travel with it.
  for (const d of [...listed]) {
    if (d.status.startsWith('R') && d.from && !seen.has(d.from)) { listed.push({ path: d.from, status: 'D', renamedTo: d.path }); seen.add(d.from); }
  }
  const found = listed.map((d) => ({ ...d, risky: riskyReason(d.path), large: isLarge(root, d.path) }));
  const skipped = new Set(found.filter((d) => d.risky || d.large).map((d) => d.path));
  for (const d of found) if (d.renamedTo && skipped.has(d.renamedTo)) skipped.add(d.path);
  const excluded = found.filter((d) => skipped.has(d.path)).map((d) => d.path);
  const { owner, ...owned } = ownership(root, { sid: session, dirty: found, excluded, includes: include, here });
  const dirty = found.map((d) => ({ ...d, owner: owner[d.path] }));
  const upstreamRef = git.upstream(root);
  const onBase = branch !== null && branch === resolvedBase;
  const counts = onBase
    ? upstreamRef ? git.aheadBehind(root, '@{u}') : remoteBase ? git.aheadBehind(root, `refs/remotes/origin/${resolvedBase}`) : { ahead: 0, behind: 0 }
    : baseRef && branch !== resolvedBase ? git.aheadBehind(root, baseRef) : { ahead: 0, behind: 0 };
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
    upstream: upstreamRef,
    remote: git.remoteUrl(root),
    worktree: git.worktreeInfo(root),
    ahead,
    behind: counts.behind,
    dirty,
    excluded,
    ownership: owned,
    commitStyle: commitStyle(subjects),
    subjects,
    hasWork: dirty.length > 0 || ahead > 0,
  };
  const others = owned.others.map((o) => `${o.branch || 'unknown branch'}${o.files.length ? `, ${o.files.length} file(s)` : ''}`).join('; ');
  result.summary = [
    `${branch ? `branch ${branch}` : 'detached HEAD'} vs ${result.base || '(no base)'}: ${ahead} ahead, ${result.behind} behind, ${dirty.length} uncommitted file(s)${excluded.length ? `, ${excluded.length} excluded (${excluded.slice(0, 3).join(', ')}${excluded.length > 3 ? ', …' : ''})` : ''}`,
    `ownership: ${owned.mode} (${owned.reason})${owned.mode === 'shared' ? `: ship ${owned.ship.length}, ask ${owned.ask.length}, leave ${owned.leave.length}; others: ${others}` : ''}`,
    `commit style: ${result.commitStyle.kind} (${Math.round(result.commitStyle.share * 100)}% of ${result.commitStyle.sampled})`,
  ];
  return result;
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/changes.mjs')) {
  runMain((_, flags) => changes(resolveRoot(flags), {
    base: typeof flags.base === 'string' ? flags.base : undefined,
    session: typeof flags.session === 'string' ? flags.session : null,
    include: flagList(flags, 'include'),
    here: Boolean(flags.here),
  }));
}
