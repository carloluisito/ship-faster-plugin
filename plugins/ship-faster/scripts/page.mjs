import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { parseFrontmatter, updateFrontmatter } from './lib/fm.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { relPath, wikiDir } from './lib/wiki.mjs';

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function stamp(root, rels, patchFor, { config } = {}) {
  config = config || loadConfig(root).config;
  const wiki = normalizePath(resolve(wikiDir(root, config)));
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const inside = (abs) => fold(abs).startsWith(fold(wiki) + '/');
  const pages = [];
  for (const given of rels) {
    const file = isAbsolute(given) ? given : join(root, ...normalizePath(given).split('/'));
    const abs = normalizePath(resolve(file));
    if (!inside(abs)) { pages.push({ rel: normalizePath(given), ok: false, error: `not inside ${config.wikiDir}` }); continue; }
    const rel = relPath(root, file);
    if (rel.endsWith('/index.md')) { pages.push({ rel, ok: false, error: 'index.md is generated and has no frontmatter' }); continue; }
    if (!existsSync(file)) { pages.push({ rel, ok: false, error: 'not found' }); continue; }
    const text = readFileSync(file, 'utf8');
    const { data, errors } = parseFrontmatter(text);
    if (!data || errors.length) { pages.push({ rel, ok: false, error: 'frontmatter missing or invalid' }); continue; }
    const patch = patchFor();
    writeFileSync(file, updateFrontmatter(text, patch));
    pages.push({ rel, ok: true, ...patch });
  }
  const failed = pages.filter((p) => !p.ok);
  return { ok: failed.length === 0, error: failed.length ? `${failed.length} page(s) not updated` : undefined, pages };
}

export function verifyPages(root, rels, { config, sha, date } = {}) {
  sha = sha || (git.isRepo(root) ? git.head(root) : null) || 'unverified';
  date = date || today();
  const r = stamp(root, rels, () => ({ verified: sha, updated: date }), { config });
  return { ...r, sha, date, summary: r.pages.map((p) => (p.ok ? `${p.rel}: verified ${sha.slice(0, 7)}, updated ${date}` : `${p.rel}: ${p.error}`)) };
}

export function touchPages(root, rels, { config, date } = {}) {
  date = date || today();
  const r = stamp(root, rels, () => ({ updated: date }), { config });
  return { ...r, date, summary: r.pages.map((p) => (p.ok ? `${p.rel}: updated ${date}` : `${p.rel}: ${p.error}`)) };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/page.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const [cmd, ...rels] = positional;
    if (cmd !== 'verify' && cmd !== 'touch') return { ok: false, error: `unknown command ${cmd}; use verify or touch` };
    if (!rels.length) return { ok: false, error: `${cmd} needs at least one page path` };
    const date = typeof flags.date === 'string' ? flags.date : undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '--date must be yyyy-mm-dd' };
    if (cmd === 'touch') return touchPages(root, rels, { config, date });
    const sha = typeof flags.sha === 'string' ? flags.sha : undefined;
    if (sha && sha !== 'unverified' && !/^[0-9a-f]{4,40}$/i.test(sha)) return { ok: false, error: '--sha must be a hex commit or unverified' };
    return verifyPages(root, rels, { config, sha, date });
  });
}
