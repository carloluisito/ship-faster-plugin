import * as git from './git.mjs';
import { anyMatch, normalizePath } from './glob.mjs';
import { loadEdits, sessionRecords } from './state.mjs';

const RECENT_MS = 2 * 3600_000;
const SID = /^[A-Za-z0-9_-]{1,64}$/;
const ASK = new Set(['both', 'earlier', 'unclaimed']);

export function splitIncludes(values) {
  return [].concat(values || [])
    .filter((v) => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((v) => normalizePath(v.trim()).replace(/^\.\//, ''))
    .filter(Boolean);
}

function latest(...stamps) {
  const ms = stamps.map((s) => Date.parse(s || '')).filter((n) => !Number.isNaN(n));
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null;
}

export function ownership(root, { sid, dirty = [], excluded = [], includes = [], here = false, now = Date.now() } = {}) {
  const session = typeof sid === 'string' && SID.test(sid) && sid !== 'default' ? sid : null;
  const paths = dirty.map((d) => d.path);
  const dirtySet = new Set(paths);
  const renamedTo = new Map(dirty.filter((d) => d.renamedTo && dirtySet.has(d.renamedTo)).map((d) => [d.path, d.renamedTo]));
  const edits = loadEdits(root);
  const editsBySid = new Map(edits.map((e) => [e.sid, e]));
  const records = sessionRecords(root)
    .filter((r) => r.sid !== 'default')
    .map((r) => ({ ...r, lastActive: latest(r.lastActive, editsBySid.get(r.sid) && editsBySid.get(r.sid).updatedAt) }));
  const recent = (r) => r.lastActive !== null && now - Date.parse(r.lastActive) <= RECENT_MS;
  // A record left behind by a session that never ran SessionEnd looks like an open one; once it has been idle
  // for two hours its files are asked about (earlier) instead of being left out as another session's.
  const open = new Set(records.filter(recent).map((r) => r.sid));

  const claimedDirty = new Set();
  for (const e of edits) for (const p of Object.keys(e.files)) if (dirtySet.has(p)) claimedDirty.add(p);
  const committedAt = git.lastCommitTimes(root, [...claimedDirty]);
  const claimants = new Map(paths.map((p) => [p, new Set()]));
  for (const e of edits) {
    for (const [p, claim] of Object.entries(e.files)) {
      if (!dirtySet.has(p)) continue;
      const at = Date.parse(claim && claim.at);
      if (Number.isNaN(at)) continue;
      const committed = committedAt.get(p);
      // Commit times have one-second resolution: an edit inside the commit's second counts as committed.
      if (committed !== undefined && at < committed + 1000) continue;
      claimants.get(p).add(e.sid);
    }
  }

  const owner = {};
  for (const p of paths) {
    const cs = [...claimants.get(p)];
    const mine = session !== null && cs.includes(session);
    const openOthers = cs.filter((s) => s !== session && open.has(s));
    owner[p] = mine ? (openOthers.length ? 'both' : 'mine') : openOthers.length ? 'theirs' : cs.length ? 'earlier' : 'unclaimed';
  }
  // The old path of a rename ships, or stays, together with the new one.
  for (const [from, to] of renamedTo) owner[from] = owner[to];

  const others = records
    .filter((r) => r.sid !== session)
    .map((r) => ({ sid: r.sid, branch: r.branch, lastActive: r.lastActive, files: paths.filter((p) => claimants.get(p).has(r.sid)) }))
    .filter((o) => o.files.length > 0 || recent(o))
    .sort((a, b) => Date.parse(b.lastActive || 0) - Date.parse(a.lastActive || 0));

  let mode = 'shared';
  let reason = `${others.length} other session${others.length === 1 ? '' : 's'} use${others.length === 1 ? 's' : ''} this checkout`;
  if (!session) { mode = 'solo'; reason = 'no session id, so every uncommitted file counts'; }
  else if (!others.length) { mode = 'solo'; reason = 'no other session uses this checkout'; }
  else if (here) { mode = 'solo'; reason = '--here: every uncommitted file ships from this checkout'; }

  const patterns = splitIncludes(includes);
  const includedSet = new Set(patterns.length ? paths.filter((p) => anyMatch(patterns, p)) : []);
  for (const [from, to] of renamedTo) {
    if (includedSet.has(from) || includedSet.has(to)) { includedSet.add(from); includedSet.add(to); }
  }
  const included = paths.filter((p) => includedSet.has(p));
  const skip = new Set(excluded);
  const eligible = paths.filter((p) => !skip.has(p));
  const sessionsOf = (p) => [...new Set([...claimants.get(p), ...(renamedTo.has(p) ? claimants.get(renamedTo.get(p)) : [])])].filter((s) => s !== session);
  const solo = mode === 'solo';

  return {
    session,
    mode,
    forced: Boolean(here && session && others.length),
    reason,
    others: others.map((o) => ({ ...o, files: o.files.slice(0, 20) })),
    owner,
    included,
    ship: solo ? eligible : eligible.filter((p) => owner[p] === 'mine' || includedSet.has(p)),
    ask: solo ? [] : eligible.filter((p) => !includedSet.has(p) && ASK.has(owner[p])).map((p) => ({ path: p, owner: owner[p], sessions: sessionsOf(p) })),
    leave: solo ? [] : eligible.filter((p) => !includedSet.has(p) && owner[p] === 'theirs').map((p) => ({ path: p, sessions: sessionsOf(p) })),
  };
}
