import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseFrontmatter } from './fm.mjs';
import { normalizePath } from './glob.mjs';
import { projectDir, readJson, writeJsonAtomic } from './state.mjs';

export const REQUIRED_FIELDS = ['title', 'summary', 'read_when', 'covers', 'verified', 'updated'];

export function wikiDir(root, config) {
  return join(root, ...config.wikiDir.split('/'));
}

export function relPath(root, file) {
  return normalizePath(relative(root, file));
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function listPages(root, config) {
  const dir = wikiDir(root, config);
  if (!existsSync(dir)) return [];
  const index = join(dir, 'index.md');
  return walk(dir, []).filter((f) => f !== index).sort((a, b) => {
    const x = relPath(root, a);
    const y = relPath(root, b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function loadPage(root, file) {
  const text = readFileSync(file, 'utf8');
  const { data, body, errors } = parseFrontmatter(text);
  const lines = text === '' ? 0 : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
  return { file, rel: relPath(root, file), data, body, errors, lines };
}

export function loadWiki(root, config) {
  const dir = wikiDir(root, config);
  const exists = existsSync(dir);
  return { dir, exists, pages: listPages(root, config).map((f) => loadPage(root, f)) };
}

function snapshot(root, config) {
  return listPages(root, config).map((file) => ({ file, rel: relPath(root, file), mtimeMs: statSync(file).mtimeMs }));
}

export function loadWikiCache(root, config) {
  const cacheFile = join(projectDir(root), 'wiki-cache.json');
  const current = snapshot(root, config);
  const cached = readJson(cacheFile, null);
  if (cached && Array.isArray(cached.pages) && cached.pages.length === current.length) {
    const same = cached.pages.every((p, i) => p.rel === current[i].rel && p.mtimeMs === current[i].mtimeMs);
    if (same) return cached;
  }
  const pages = current.map(({ file, rel, mtimeMs }) => {
    const { data } = loadPage(root, file);
    return {
      rel,
      file,
      mtimeMs,
      title: data && typeof data.title === 'string' ? data.title : rel,
      covers: data && Array.isArray(data.covers) ? data.covers.map(String) : [],
      verified: data && data.verified ? String(data.verified) : null,
    };
  });
  const built = { builtAt: new Date().toISOString(), pages };
  writeJsonAtomic(cacheFile, built);
  return built;
}
