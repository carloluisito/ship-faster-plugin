import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath } from './glob.mjs';

const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function pluginName(pluginRoot) {
  const manifest = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'), null);
  return manifest && typeof manifest.name === 'string' && manifest.name ? manifest.name : 'ship-faster';
}

// Claude Code gives only hooks CLAUDE_PLUGIN_DATA. Scripts that skills run through Bash rebuild the same
// path: <plugins dir>/data/<name@marketplace>, or <name@inline> for --plugin-dir, with other characters as "-".
export function dataDir({ env = process.env, pluginRoot = PLUGIN_ROOT, home = homedir() } = {}) {
  const given = env.CLAUDE_PLUGIN_DATA;
  if (given && given.trim() && !given.includes('${')) return given;
  const parts = normalizePath(pluginRoot).replace(/\/+$/, '').split('/');
  let pluginsDir;
  let source;
  if (parts.length >= 5 && parts[parts.length - 4] === 'cache') {
    pluginsDir = parts.slice(0, parts.length - 4).join('/');
    source = `${pluginName(pluginRoot)}@${parts[parts.length - 3]}`;
  } else {
    const config = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
    pluginsDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR && env.CLAUDE_CODE_PLUGIN_CACHE_DIR.trim() ? env.CLAUDE_CODE_PLUGIN_CACHE_DIR : join(config, 'plugins');
    source = `${pluginName(pluginRoot)}@inline`;
  }
  return join(pluginsDir, 'data', source.replace(/[^a-zA-Z0-9\-_]/g, '-'));
}

// Session records and edit claims describe one working tree, so they live in its git directory, where hooks,
// skills, and sandboxed commands all see the same files; outside git they fall back to the project directory.
export function checkoutDir(root) {
  const dotGit = join(root, '.git');
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return join(dotGit, 'ship-faster');
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
      if (m) return join(resolve(root, m[1]), 'ship-faster');
    }
  } catch {}
  return projectDir(root);
}

export function projectHash(root) {
  let key = normalizePath(root).replace(/\/+$/, '');
  if (process.platform === 'win32') key = key.toLowerCase();
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function projectDir(root) {
  const dir = join(dataDir(), 'projects', projectHash(root));
  try {
    mkdirSync(dir, { recursive: true });
    const meta = join(dir, 'project.json');
    if (!existsSync(meta)) writeJsonAtomic(meta, { root: normalizePath(root), createdAt: new Date().toISOString() });
  } catch {}
  return dir;
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJsonAtomic(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    let renamed = false;
    try {
      renameSync(tmp, file);
      renamed = true;
    } catch {
      // Windows refuses to rename over a file another process has open; replace it explicitly once.
      try { unlinkSync(file); } catch {}
      try { renameSync(tmp, file); renamed = true; } catch {}
    }
    if (!renamed) try { unlinkSync(tmp); } catch {}
    return renamed;
  } catch {
    return false;
  }
}

function safeId(sid) {
  const clean = String(sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return clean || 'default';
}

export function sessionFile(root, sid) {
  return join(checkoutDir(root), 'sessions', `${safeId(sid)}.json`);
}

export function loadSession(root, sid) {
  try {
    const v = readJson(sessionFile(root, sid), {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function saveSession(root, sid, data) {
  return writeJsonAtomic(sessionFile(root, sid), data);
}

export function updateSession(root, sid, mutate) {
  try {
    const record = loadSession(root, sid);
    mutate(record);
    record.pages = record.pages || {};
    const diskPages = (loadSession(root, sid) || {}).pages || {};
    for (const [rel, diskEntry] of Object.entries(diskPages)) {
      const mutated = record.pages[rel];
      if (!mutated) { record.pages[rel] = diskEntry; continue; }
      const files = (mutated.files || []).slice();
      for (const f of diskEntry.files || []) {
        if (!files.includes(f) && files.length < 200) files.push(f);
      }
      record.pages[rel] = { files, reported: !!(mutated.reported || diskEntry.reported) };
    }
    return saveSession(root, sid, record);
  } catch {
    return false;
  }
}

export function loadAllSessions(root) {
  const merged = { pages: {} };
  let names = [];
  const dir = join(checkoutDir(root), 'sessions');
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return merged; }
  for (const name of names) {
    const rec = readJson(join(dir, name), null);
    if (!rec || typeof rec !== 'object' || !rec.pages || typeof rec.pages !== 'object') continue;
    for (const [rel, entry] of Object.entries(rec.pages)) {
      const cur = merged.pages[rel] || { files: [], reported: false };
      for (const f of Array.isArray(entry && entry.files) ? entry.files : []) if (!cur.files.includes(f) && cur.files.length < 200) cur.files.push(f);
      cur.reported = cur.reported || Boolean(entry && entry.reported);
      merged.pages[rel] = cur;
    }
  }
  return merged;
}

export function pruneSessions(root, { maxAgeDays = 7, deadlineMs = 1000 } = {}) {
  try {
    const started = Date.now();
    const cutoff = started - maxAgeDays * 86400_000;
    let removed = 0;
    for (const sub of ['sessions', 'edits']) {
      const dir = join(checkoutDir(root), sub);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (Date.now() - started > deadlineMs) break;
        const file = join(dir, name);
        try {
          if (statSync(file).mtimeMs < cutoff) { rmSync(file, { force: true }); removed++; }
        } catch {}
      }
    }
    return { removed };
  } catch {
    return { removed: 0 };
  }
}

const MAX_CLAIMS = 1000;

export function editsFile(root, sid) {
  return join(checkoutDir(root), 'edits', `${safeId(sid)}.json`);
}

function readEdits(file) {
  const v = readJson(file, null);
  const files = v && typeof v === 'object' && !Array.isArray(v) && v.files && typeof v.files === 'object' && !Array.isArray(v.files) ? v.files : {};
  return { updatedAt: v && typeof v.updatedAt === 'string' ? v.updatedAt : null, files };
}

export function recordEdit(root, sid, rel, { tool = null, at = new Date().toISOString() } = {}) {
  try {
    const file = editsFile(root, sid);
    const files = { ...readEdits(file).files, [rel]: { at, tool } };
    // Parallel tool calls run their hooks at the same moment; fold in whatever another process wrote meanwhile.
    for (const [path, claim] of Object.entries(readEdits(file).files)) {
      if (!files[path] || Date.parse(claim && claim.at) > Date.parse(files[path].at)) files[path] = claim;
    }
    const kept = Object.entries(files)
      .filter(([, claim]) => claim && !Number.isNaN(Date.parse(claim.at)))
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
      .slice(0, MAX_CLAIMS);
    return writeJsonAtomic(file, { sid: safeId(sid), updatedAt: kept.length ? kept[0][1].at : at, files: Object.fromEntries(kept) });
  } catch {
    return false;
  }
}

export function loadEdits(root) {
  const dir = join(checkoutDir(root), 'edits');
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((name) => ({ sid: name.replace(/\.json$/, ''), ...readEdits(join(dir, name)) }));
}

export function dropClaims(root, rels, { sid = null } = {}) {
  const drop = new Set(rels);
  let dropped = 0;
  for (const record of loadEdits(root)) {
    if (sid && record.sid !== safeId(sid)) continue;
    const hits = Object.keys(record.files).filter((p) => drop.has(p));
    if (!hits.length) continue;
    for (const p of hits) delete record.files[p];
    if (writeJsonAtomic(editsFile(root, record.sid), { sid: record.sid, updatedAt: record.updatedAt || new Date().toISOString(), files: record.files })) dropped += hits.length;
  }
  return dropped;
}

export function sessionRecords(root) {
  const dir = join(checkoutDir(root), 'sessions');
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const records = [];
  for (const name of names) {
    const rec = readJson(join(dir, name), null);
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const stamps = [rec.updatedAt, rec.startedAt].map((s) => Date.parse(s || '')).filter((n) => !Number.isNaN(n));
    records.push({
      sid: name.replace(/\.json$/, ''),
      branch: typeof rec.branch === 'string' ? rec.branch : null,
      lastActive: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    });
  }
  return records;
}

export function preflightDir(root) {
  const dir = join(projectDir(root), 'preflight');
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

export function backupDir(root) {
  const dir = join(projectDir(root), 'backup');
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

export function markSessionStart(root, sid, { branch = null, cwd = null } = {}) {
  const now = new Date().toISOString();
  return updateSession(root, sid, (record) => {
    record.startedAt = record.startedAt || now;
    record.updatedAt = now;
    record.branch = branch;
    record.cwd = cwd;
  });
}

export function liveSessions(root, { exceptSid, maxAgeHours = 2 } = {}) {
  const dir = join(checkoutDir(root), 'sessions');
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const own = `${safeId(exceptSid)}.json`;
  const live = [];
  for (const name of names) {
    if (name === own) continue;
    const rec = readJson(join(dir, name), null);
    const at = rec && typeof rec === 'object' ? Date.parse(rec.updatedAt || rec.startedAt || '') : NaN;
    if (Number.isNaN(at) || at < cutoff) continue;
    live.push({ sid: name.replace(/\.json$/, ''), branch: typeof rec.branch === 'string' ? rec.branch : null, at: new Date(at).toISOString() });
  }
  return live.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
