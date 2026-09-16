import { flagList, runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { anyMatch, filterPaths, normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { loadAllSessions, loadSession } from './lib/state.mjs';
import { REQUIRED_FIELDS, loadWiki } from './lib/wiki.mjs';

const EMPTY = () => ({ fresh: 0, stale: 0, dirty: 0, unverifiable: 0, invalid: 0 });
const LOG_LIMIT = 2000;

function reachableFrom(commits, index, sha) {
  const reachable = new Set();
  const stack = [sha];
  while (stack.length) {
    const cur = stack.pop();
    if (reachable.has(cur) || !index.has(cur)) continue;
    reachable.add(cur);
    for (const parent of commits[index.get(cur)].parents) stack.push(parent);
  }
  return reachable;
}

function unionExcluding(commits, skip, pageRel) {
  const files = new Set();
  for (const c of commits) {
    if (skip(c) || c.files.includes(pageRel)) continue;
    for (const f of c.files) files.add(f);
  }
  return [...files];
}

function batchHistory(root, shas) {
  const resolved = new Map();
  // Two shas cost two direct log calls; walking the history once only pays off from three.
  if (shas.length < 3) return resolved;
  const base = git.mergeBase(root, shas);
  if (!base) return resolved;
  const commits = git.logTopo(root, `${base}..HEAD`, { n: LOG_LIMIT });
  if (!commits.length || commits.length >= LOG_LIMIT) return resolved;
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  for (const sha of shas) {
    if (sha !== base && !index.has(sha)) continue;
    const reachable = reachableFrom(commits, index, sha);
    resolved.set(sha, (pageRel) => unionExcluding(commits, (c) => reachable.has(c.sha), pageRel));
  }
  return resolved;
}

function verifiedShas(pages, head) {
  const shas = [];
  for (const p of pages) {
    const d = p.data;
    if (!d || p.errors.length || !Array.isArray(d.covers) || d.covers.length === 0) continue;
    if (REQUIRED_FIELDS.some((k) => !(k in d))) continue;
    const v = String(d.verified);
    if (v !== 'unverified' && v !== head) shas.push(v);
  }
  return [...new Set(shas)];
}

export function stale(root, { config, session = null, changed = [], since = null } = {}) {
  config = config || loadConfig(root).config;
  const wiki = loadWiki(root, config);
  if (!wiki.exists || wiki.pages.length === 0) {
    return { ok: true, exists: wiki.exists, head: null, pages: [], counts: EMPTY(), summary: [wiki.exists ? 'wiki has no pages' : 'no wiki'], since: null, uncovered: [] };
  }
  const isRepo = git.isRepo(root);
  const head = isRepo ? git.head(root) : null;
  const dirtyEntries = isRepo ? git.dirtyFiles(root) : [];
  const dirtyStatus = new Map(dirtyEntries.map((d) => [d.path, d.status]));
  const dirty = dirtyEntries.map((d) => d.path);
  const extra = [...changed.map(normalizePath)];
  if (session) {
    const rec = session === 'all' ? loadAllSessions(root) : loadSession(root, session);
    for (const entry of Object.values(rec.pages || {})) for (const f of entry.files || []) extra.push(normalizePath(f));
  }
  const uncommitted = [...new Set([...dirty, ...extra])];
  let scope = null;
  let scopeFiles = null;
  if (since) {
    const branch = isRepo ? git.changedBetween(root, since) : null;
    scope = { ref: since, files: branch ? branch.length : 0, error: branch ? null : (isRepo ? `cannot diff against ${since}` : 'not a git repository') };
    if (branch) scopeFiles = [...new Set([...branch, ...uncommitted])];
  }
  const batched = isRepo ? batchHistory(root, verifiedShas(wiki.pages, head)) : new Map();
  // merge-base resolved every sha it was given, so a batched sha needs no existence check of its own.
  const commitExistsCache = new Map([...batched.keys()].map((sha) => [sha, true]));
  const commitExists = (sha) => {
    if (!commitExistsCache.has(sha)) commitExistsCache.set(sha, sha === head ? true : git.commitExists(root, sha));
    return commitExistsCache.get(sha);
  };
  const historyCache = new Map();
  const changedSince = (sha, pageRel) => {
    if (sha === head) return [];
    if (batched.has(sha)) return batched.get(sha)(pageRel);
    if (!historyCache.has(sha)) historyCache.set(sha, git.commitsSince(root, sha, { n: LOG_LIMIT }));
    const history = historyCache.get(sha);
    if (history === null) return null;
    // A history too long to walk falls back to the plain diff, which cannot apply the alongside rule.
    if (history.truncated) return git.changedSince(root, sha);
    return unionExcluding(history.commits, () => false, pageRel);
  };
  const editedAlongside = (rel) => dirtyStatus.has(rel) && dirtyStatus.get(rel) !== '??';

  const classified = wiki.pages.map((p) => {
    const rel = p.rel;
    const data = p.data;
    if (!data || p.errors.length) return { rel, status: 'invalid', verified: null, changed: [], reason: !data ? 'no frontmatter' : p.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ') };
    const missing = REQUIRED_FIELDS.filter((k) => !(k in data));
    if (missing.length) return { rel, status: 'invalid', verified: null, changed: [], reason: `missing ${missing.join(', ')}` };
    if (!Array.isArray(data.covers) || data.covers.length === 0) return { rel, status: 'invalid', verified: null, changed: [], reason: 'covers must be a non-empty list' };
    const covers = data.covers.map(String);
    const verified = String(data.verified);
    if (!isRepo) return { rel, status: 'unverifiable', verified, changed: [], reason: 'not a git repository' };
    if (verified === 'unverified' || !commitExists(verified)) return { rel, status: 'unverifiable', verified, changed: [], reason: verified === 'unverified' ? 'never verified' : 'verified commit is not in history' };
    const diff = changedSince(verified, rel);
    if (diff === null) return { rel, status: 'unverifiable', verified, changed: [], reason: 'git diff failed' };
    const matched = filterPaths(covers, diff);
    if (matched.length) return { rel, status: 'stale', verified, changed: matched.slice(0, 50), reason: `${matched.length} covered file(s) changed since ${verified.slice(0, 7)}` };
    const dirtyMatched = editedAlongside(rel) ? [] : filterPaths(covers, uncommitted);
    if (dirtyMatched.length) return { rel, status: 'dirty', verified, changed: dirtyMatched.slice(0, 50), reason: `${dirtyMatched.length} covered file(s) changed in the working tree or this session` };
    return { rel, status: 'fresh', verified, changed: [], reason: '' };
  });

  const coversOf = new Map(wiki.pages.map((p) => [p.rel, p.data && Array.isArray(p.data.covers) ? p.data.covers.map(String) : []]));
  const pages = classified.map((r) => {
    let inScope;
    if (r.status === 'fresh') inScope = false;
    else if (!scopeFiles || r.status === 'invalid' || r.status === 'unverifiable') inScope = true;
    else inScope = filterPaths(coversOf.get(r.rel), scopeFiles).length > 0;
    return { ...r, inScope };
  });
  const allCovers = [...coversOf.values()].flat();
  const generated = [config.wikiDir, config.plansDir, config.rulesDir].map((d) => d.replace(/\/+$/, '') + '/');
  const uncovered = (scopeFiles || uncommitted)
    .filter((f) => f !== 'CLAUDE.md' && !generated.some((d) => f.startsWith(d)) && !anyMatch(allCovers, f))
    .sort()
    .slice(0, 50);

  const counts = EMPTY();
  for (const p of pages) counts[p.status]++;
  const name = (p) => p.rel.split('/').pop().replace(/\.md$/, '');
  const list = (status) => pages.filter((p) => p.status === status).map(name);
  const parts = [`${counts.fresh} fresh`];
  for (const s of ['stale', 'dirty', 'unverifiable', 'invalid']) if (counts[s]) parts.push(`${counts[s]} ${s} (${list(s).join(', ')})`);
  const summary = [`${pages.length} pages: ${parts.join(', ')}`];
  if (scope) summary[0] += scope.error ? `; --since ${scope.ref} ignored (${scope.error})` : `; ${pages.filter((p) => p.inScope).length} in scope of ${scope.ref}`;
  if (uncovered.length) summary.push(`${uncovered.length} changed file(s) no page covers: ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}`);
  return { ok: true, exists: true, head, since: scope, uncovered, pages, counts, summary };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/stale.mjs')) {
  runMain((_, flags) => stale(resolveRoot(flags), {
    session: typeof flags.session === 'string' ? flags.session : null,
    changed: flagList(flags, 'changed'),
    since: typeof flags.since === 'string' ? flags.since : null,
  }));
}
