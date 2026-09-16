import { isAbsolute, join, relative } from 'node:path';
import { readStdinJson } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { anyMatch, normalizePath } from './lib/glob.mjs';
import { resolveRootCached } from './lib/root.mjs';
import { updateSession } from './lib/state.mjs';
import { loadWikiCache } from './lib/wiki.mjs';

const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

async function main() {
  const input = await readStdinJson(1000);
  if (!input || !TOOLS.has(input.tool_name)) return;
  const ti = input.tool_input || {};
  const file = typeof ti.file_path === 'string' ? ti.file_path : typeof ti.notebook_path === 'string' ? ti.notebook_path : null;
  if (!file) return;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = resolveRootCached(cwd);
  const abs = isAbsolute(file) ? file : join(cwd, file);
  const rel = normalizePath(relative(root, abs));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return;
  const { config } = loadConfig(root);
  for (const dir of [config.wikiDir, config.plansDir, config.rulesDir]) if (rel.startsWith(dir.replace(/\/+$/, '') + '/')) return;
  const cache = loadWikiCache(root, config);
  const hits = cache.pages.filter((p) => p.covers.length && anyMatch(p.covers, rel));
  if (!hits.length) return;
  const sid = input.session_id || 'default';
  updateSession(root, sid, (session) => {
    session.pages = session.pages || {};
    for (const p of hits) {
      const entry = session.pages[p.rel] || { files: [], reported: false };
      if (!entry.files.includes(rel) && entry.files.length < 200) entry.files.push(rel);
      session.pages[p.rel] = entry;
    }
    session.updatedAt = new Date().toISOString();
  });
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
