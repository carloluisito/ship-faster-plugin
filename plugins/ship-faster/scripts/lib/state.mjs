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
    try {
      renameSync(tmp, file);
    } catch {
      // Windows refuses to rename over a file another process has open; replace it explicitly once.
      try { unlinkSync(file); } catch {}
      try { renameSync(tmp, file); } catch { try { unlinkSync(tmp); } catch {} }
    }
    return true;
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
  try {
    return writeJsonAtomic(sessionFile(root, sid), data);
  } catch {
    return false;
  }
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
