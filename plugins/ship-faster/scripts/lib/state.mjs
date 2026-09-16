import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizePath } from './glob.mjs';

export function dataDir() {
  const env = process.env.CLAUDE_PLUGIN_DATA;
  if (env && env.trim() && !env.includes('${')) return env;
  const cfg = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()
    ? process.env.CLAUDE_CONFIG_DIR
    : join(homedir(), '.claude');
  return join(cfg, 'plugins', 'data', 'ship-faster');
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
  return join(projectDir(root), 'sessions', `${safeId(sid)}.json`);
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
  const dir = join(projectDir(root), 'sessions');
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return merged; }
  for (const name of names) {
    const rec = readJson(join(dir, name), null);
    if (!rec || typeof rec !== 'object' || !rec.pages || typeof rec.pages !== 'object') continue;
    for (const [rel, entry] of Object.entries(rec.pages)) {
      const cur = merged.pages[rel] || { files: [], reported: false };
      for (const f of (entry && entry.files) || []) if (!cur.files.includes(f) && cur.files.length < 200) cur.files.push(f);
      cur.reported = cur.reported || Boolean(entry && entry.reported);
      merged.pages[rel] = cur;
    }
  }
  return merged;
}

export function pruneSessions(root, { maxAgeDays = 7, deadlineMs = 1000 } = {}) {
  try {
    const dir = join(projectDir(root), 'sessions');
    const started = Date.now();
    const cutoff = started - maxAgeDays * 86400_000;
    let removed = 0;
    if (!existsSync(dir)) return { removed };
    for (const name of readdirSync(dir)) {
      if (Date.now() - started > deadlineMs) break;
      const file = join(dir, name);
      try {
        if (statSync(file).mtimeMs < cutoff) { rmSync(file, { force: true }); removed++; }
      } catch {}
    }
    return { removed };
  } catch {
    return { removed: 0 };
  }
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
