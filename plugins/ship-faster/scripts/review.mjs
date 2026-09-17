import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { anyMatch, normalizePath } from './lib/glob.mjs';
import { riskyReason } from './lib/risky.mjs';
import { resolveRoot } from './lib/root.mjs';
import { projectDir, writeJsonAtomic } from './lib/state.mjs';
import { loadWiki } from './lib/wiki.mjs';

const UNTRACKED_MAX_BYTES = 200 * 1024;

function splitPerFile(patch) {
  const files = [];
  let cur = null;
  for (const line of patch.split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) { cur = { path: normalizePath(m[2]), lines: [] }; files.push(cur); }
    if (cur) cur.lines.push(line);
  }
  return files.map((f) => ({ path: f.path, text: f.lines.join('\n') + '\n', lines: f.lines.length }));
}

function pack(files, maxLines) {
  const chunks = [];
  let cur = { paths: [], text: '', lines: 0 };
  const flush = () => { if (cur.paths.length) chunks.push(cur); cur = { paths: [], text: '', lines: 0 }; };
  for (const f of files) {
    if (f.lines > maxLines) { flush(); chunks.push({ paths: [f.path], text: f.text, lines: f.lines }); continue; }
    if (cur.lines + f.lines > maxLines) flush();
    cur.paths.push(f.path);
    cur.text += f.text;
    cur.lines += f.lines;
  }
  flush();
  return chunks;
}

function prune(reviewRoot, keep = 5) {
  let names;
  try { names = readdirSync(reviewRoot).sort(); } catch { return; }
  for (const n of names.slice(0, Math.max(0, names.length - keep))) rmSync(join(reviewRoot, n), { recursive: true, force: true });
}

export function prepareReview(root, { config, base, maxLines = 4000 } = {}) {
  config = config || loadConfig(root).config;
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const head = git.head(root);
  const resolvedBase = base || (config.defaultBranch !== 'auto' ? config.defaultBranch : git.defaultBranch(root));
  if (!resolvedBase) return { ok: false, error: 'no base branch: pass --base <branch>' };
  const mergeBase = git.git(['merge-base', resolvedBase, 'HEAD'], { cwd: root, timeoutMs: 5000 });
  if (!mergeBase.ok) return { ok: false, error: `base ${resolvedBase} cannot be resolved` };
  const mb = mergeBase.stdout.trim();
  const diff = git.git(['diff', '--no-color', '--no-ext-diff', '-M', mb], { cwd: root, timeoutMs: 20000 });
  if (!diff.ok) return { ok: false, error: 'git diff failed' };
  const perFile = splitPerFile(diff.stdout);
  const untrackedPaths = git.dirtyFiles(root).filter((d) => d.status === '??').map((d) => d.path)
    .filter((p) => !riskyReason(p))
    .filter((p) => { try { const s = lstatSync(join(root, p)); return s.isFile() && s.size <= UNTRACKED_MAX_BYTES; } catch { return false; } });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reviewRoot = join(projectDir(root), 'review');
  const dir = join(reviewRoot, stamp);
  mkdirSync(dir, { recursive: true });
  const chunks = pack(perFile, maxLines).map((c, i) => {
    const file = join(dir, `chunk-${String(i + 1).padStart(2, '0')}.patch`);
    writeFileSync(file, c.text);
    return { file: normalizePath(file), lines: c.lines, paths: c.paths };
  });
  const untracked = [];
  for (const p of untrackedPaths) {
    let text;
    try { text = readFileSync(join(root, p), 'utf8'); } catch { continue; }
    const file = join(dir, `untracked-${String(untracked.length + 1).padStart(2, '0')}.txt`);
    writeFileSync(file, `# new file: ${p}\n${text}`);
    untracked.push({ path: p, file: normalizePath(file), lines: text.split('\n').length });
  }
  const files = perFile.map((f) => ({ path: f.path, lines: f.lines, chunk: chunks.findIndex((c) => c.paths.includes(f.path)) + 1 }));
  const changed = [...files.map((f) => f.path), ...untracked.map((u) => u.path)];
  const wiki = loadWiki(root, config);
  const wikiRel = (name) => `${config.wikiDir}/${name}`;
  const gotchaPages = wiki.pages.filter((p) => /\/gotchas(-[\w-]+)?\.md$/.test(p.rel)).map((p) => p.rel)
    .sort((a, b) => (a.endsWith('/gotchas.md') ? -1 : b.endsWith('/gotchas.md') ? 1 : a < b ? -1 : 1));
  const ruleRels = [wikiRel('conventions.md'), ...(gotchaPages.length ? gotchaPages : [wikiRel('gotchas.md')]), wikiRel('architecture.md')];
  const rulePages = [...new Set(ruleRels)].map((rel) => ({ rel, file: normalizePath(join(root, ...rel.split('/'))), exists: existsSync(join(root, ...rel.split('/'))) }));
  const recipes = wiki.pages
    .filter((p) => p.rel.startsWith(`${config.wikiDir}/recipes/`) && p.data && Array.isArray(p.data.covers) && changed.some((c) => anyMatch(p.data.covers.map(String), c)))
    .map((p) => ({ rel: p.rel, file: normalizePath(p.file) }));
  const totalLines = perFile.reduce((n, f) => n + f.lines, 0) + untracked.reduce((n, u) => n + u.lines, 0);
  const result = { ok: true, base: resolvedBase, mergeBase: mb, head, dir: normalizePath(dir), files, chunks, untracked, rulePages, recipes, totalLines };
  writeJsonAtomic(join(dir, 'manifest.json'), result);
  prune(reviewRoot);
  result.summary = [`${files.length} changed file(s), ${untracked.length} new, ${chunks.length} chunk(s), ${totalLines} lines → ${result.dir}`, `rules: ${rulePages.filter((p) => p.exists).map((p) => p.rel).join(', ') || 'none'}; recipes: ${recipes.map((r) => r.rel).join(', ') || 'none'}`];
  return result;
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/review.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    if (positional[0] !== 'prepare') return { ok: false, error: `unknown command ${positional[0]}; use prepare` };
    return prepareReview(root, { base: typeof flags.base === 'string' ? flags.base : undefined });
  });
}
