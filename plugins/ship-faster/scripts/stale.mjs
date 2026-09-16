import { flagList, runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { filterPaths, normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { loadSession } from './lib/state.mjs';
import { REQUIRED_FIELDS, loadWiki } from './lib/wiki.mjs';

const EMPTY = () => ({ fresh: 0, stale: 0, dirty: 0, unverifiable: 0, invalid: 0 });
const LOG_LIMIT = 2000;

function filesAfter(commits, index, sha) {
  const reachable = new Set();
  const stack = [sha];
  while (stack.length) {
    const cur = stack.pop();
    if (reachable.has(cur) || !index.has(cur)) continue;
    reachable.add(cur);
    for (const parent of commits[index.get(cur)].parents) stack.push(parent);
  }
  const files = new Set();
  for (const c of commits) if (!reachable.has(c.sha)) for (const f of c.files) files.add(f);
  return [...files];
}

function batchChangedSince(root, shas) {
  const resolved = new Map();
  if (shas.length < 2) return resolved;
  const base = git.mergeBase(root, shas);
  if (!base) return resolved;
  const commits = git.logTopo(root, `${base}..HEAD`, { n: LOG_LIMIT });
  if (!commits.length || commits.length >= LOG_LIMIT) return resolved;
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  for (const sha of shas) {
    if (sha !== base && !index.has(sha)) continue;
    resolved.set(sha, filesAfter(commits, index, sha));
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

export function stale(root, { config, session = null, changed = [] } = {}) {
  config = config || loadConfig(root).config;
  const wiki = loadWiki(root, config);
  if (!wiki.exists || wiki.pages.length === 0) {
    return { ok: true, exists: wiki.exists, head: null, pages: [], counts: EMPTY(), summary: [wiki.exists ? 'wiki has no pages' : 'no wiki'] };
  }
  const isRepo = git.isRepo(root);
  const head = isRepo ? git.head(root) : null;
  const dirty = isRepo ? git.dirtyFiles(root).map((d) => d.path) : [];
  const extra = [...changed.map(normalizePath)];
  if (session) {
    const rec = loadSession(root, session);
    for (const entry of Object.values(rec.pages || {})) for (const f of entry.files || []) extra.push(normalizePath(f));
  }
  const uncommitted = [...new Set([...dirty, ...extra])];
  const batched = isRepo ? batchChangedSince(root, verifiedShas(wiki.pages, head)) : new Map();
  // merge-base resolved every sha it was given, so a batched sha needs no existence check of its own.
  const commitExistsCache = new Map([...batched.keys()].map((sha) => [sha, true]));
  const commitExists = (sha) => {
    if (!commitExistsCache.has(sha)) commitExistsCache.set(sha, sha === head ? true : git.commitExists(root, sha));
    return commitExistsCache.get(sha);
  };
  const diffCache = new Map();
  const changedSince = (sha) => {
    if (!diffCache.has(sha)) diffCache.set(sha, sha === head ? [] : batched.has(sha) ? batched.get(sha) : git.changedSince(root, sha));
    return diffCache.get(sha);
  };

  const pages = wiki.pages.map((p) => {
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
    const diff = changedSince(verified);
    if (diff === null) return { rel, status: 'unverifiable', verified, changed: [], reason: 'git diff failed' };
    const matched = filterPaths(covers, diff);
    if (matched.length) return { rel, status: 'stale', verified, changed: matched.slice(0, 50), reason: `${matched.length} covered file(s) changed since ${verified.slice(0, 7)}` };
    const dirtyMatched = filterPaths(covers, uncommitted);
    if (dirtyMatched.length) return { rel, status: 'dirty', verified, changed: dirtyMatched.slice(0, 50), reason: `${dirtyMatched.length} covered file(s) changed in the working tree or this session` };
    return { rel, status: 'fresh', verified, changed: [], reason: '' };
  });

  const counts = EMPTY();
  for (const p of pages) counts[p.status]++;
  const name = (p) => p.rel.split('/').pop().replace(/\.md$/, '');
  const list = (status) => pages.filter((p) => p.status === status).map(name);
  const parts = [`${counts.fresh} fresh`];
  for (const s of ['stale', 'dirty', 'unverifiable', 'invalid']) if (counts[s]) parts.push(`${counts[s]} ${s} (${list(s).join(', ')})`);
  return { ok: true, exists: true, head, pages, counts, summary: [`${pages.length} pages: ${parts.join(', ')}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/stale.mjs')) {
  runMain((_, flags) => stale(resolveRoot(flags), { session: typeof flags.session === 'string' ? flags.session : null, changed: flagList(flags, 'changed') }));
}
