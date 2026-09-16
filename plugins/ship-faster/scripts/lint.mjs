import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { listRepoFiles } from './lib/files.mjs';
import { parseFrontmatter } from './lib/fm.mjs';
import * as git from './lib/git.mjs';
import { compileGlob, normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { REQUIRED_FIELDS, loadWiki, relPath, wikiDir } from './lib/wiki.mjs';
import { buildIndex } from './index.mjs';

const SECRETS = [
  /AKIA[0-9A-Z]{16}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];
const ASSIGN = /\b(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*["']?([^\s"'<${*]{8,})/i;
const PLACEHOLDER = /^(your|example|changeme|redacted|xxxx)/i;

export function lint(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const errors = [];
  const warnings = [];
  const err = (file, line, rule, message) => errors.push({ file, line, rule, message });
  const warn = (file, line, rule, message) => warnings.push({ file, line, rule, message });
  const files = listRepoFiles(root);
  const topLevel = new Set(files.map((f) => f.split('/')[0]));
  const pkgScripts = readScripts(root);
  const isRepo = git.isRepo(root);

  const wiki = loadWiki(root, config);
  const titles = new Map();
  for (const p of wiki.pages) {
    const text = readFileSync(p.file, 'utf8');
    if (!p.data) { err(p.rel, 1, 'frontmatter-missing', 'page has no frontmatter'); }
    for (const e of p.errors) err(p.rel, e.line, 'frontmatter-invalid', e.message);
    if (p.data) {
      for (const k of REQUIRED_FIELDS) if (!(k in p.data)) err(p.rel, 1, 'frontmatter-required', `missing ${k}`);
      if (!Array.isArray(p.data.covers) || p.data.covers.length === 0) err(p.rel, 1, 'covers-empty', 'covers must be a non-empty list');
      else for (const g of p.data.covers) {
        const re = compileGlob(String(g));
        if (!files.some((f) => re.test(f))) err(p.rel, 1, 'covers-no-match', `covers glob matches no file: ${g}`);
      }
      if (typeof p.data.title === 'string') {
        if (titles.has(p.data.title)) err(p.rel, 1, 'duplicate-title', `title also used by ${titles.get(p.data.title)}`);
        else titles.set(p.data.title, p.rel);
      }
      if (typeof p.data.verified === 'string' && p.data.verified !== 'unverified' && isRepo && !git.commitExists(root, p.data.verified)) {
        warn(p.rel, 1, 'verified-missing', `verified commit ${p.data.verified.slice(0, 7)} is not in history`);
      }
      if (p.rel.endsWith('/commands.md') && 'checks' in p.data) {
        const c = p.data.checks;
        const okShape = Array.isArray(c) && c.every((x) => x && typeof x === 'object' && typeof x.run === 'string' && x.run.trim());
        if (!okShape) err(p.rel, 1, 'checks-shape', 'checks must be a list of maps with a non-empty run');
      }
    }
    if (p.lines > config.pageMaxLines) err(p.rel, null, 'page-too-long', `${p.lines} lines, limit ${config.pageMaxLines}`);
    scanBody(root, p.file, p.rel, text, { err, warn, topLevel, files, pkgScripts, tokens: true });
  }

  const wdir = wikiDir(root, config);
  const indexFile = join(wdir, 'index.md');
  if (wiki.pages.length) {
    const built = buildIndex(root, config);
    if (built.changed) err(relPath(root, indexFile), null, 'index-stale', 'index.md differs from the generated index');
    if (existsSync(indexFile) && countLines(readFileSync(indexFile, 'utf8')) > 80) err(relPath(root, indexFile), null, 'index-too-long', 'index over 80 lines');
  }

  const claude = join(root, 'CLAUDE.md');
  if (existsSync(claude)) {
    const text = readFileSync(claude, 'utf8');
    const n = countLines(text);
    if (n > config.claudeMdMaxLines) err('CLAUDE.md', null, 'claude-md-too-long', `${n} lines, limit ${config.claudeMdMaxLines}`);
    scanBody(root, claude, 'CLAUDE.md', text, { err, warn, topLevel, files, pkgScripts, tokens: true });
  }

  const rulesDir = join(root, ...config.rulesDir.split('/'));
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir).filter((f) => f.endsWith('.md'))) {
      const file = join(rulesDir, name);
      const rel = relPath(root, file);
      const text = readFileSync(file, 'utf8');
      const { data, errors: fmErrors } = parseFrontmatter(text);
      for (const e of fmErrors) err(rel, e.line, 'frontmatter-invalid', e.message);
      if (!data || !Array.isArray(data.paths) || data.paths.length === 0) warn(rel, 1, 'rules-no-paths', 'rules file has no paths list and will load in every session');
      const n = countLines(text);
      if (n > config.rulesFileMaxLines) err(rel, null, 'rules-too-long', `${n} lines, limit ${config.rulesFileMaxLines}`);
      scanBody(root, file, rel, text, { err, warn, topLevel, files, pkgScripts, tokens: false });
    }
  }

  const plansDir = join(root, ...config.plansDir.split('/'));
  if (existsSync(plansDir)) {
    for (const name of readdirSync(plansDir).filter((f) => f.endsWith('.md'))) {
      const file = join(plansDir, name);
      const rel = relPath(root, file);
      const { errors: fmErrors } = parseFrontmatter(readFileSync(file, 'utf8'));
      for (const e of fmErrors) err(rel, e.line, 'frontmatter-invalid', e.message);
    }
  }

  const summary = [`${errors.length} error(s), ${warnings.length} warning(s)`, ...errors.slice(0, 20).map((e) => `${e.file}${e.line ? ':' + e.line : ''} ${e.rule}: ${e.message}`)];
  return { ok: errors.length === 0, errors, warnings, summary };
}

function countLines(text) {
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function readScripts(root) {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || null; } catch { return null; }
}

function scanBody(root, file, rel, text, { err, warn, topLevel, files, pkgScripts, tokens }) {
  const lines = text.split(/\r?\n/);
  const fileSet = new Set(files);
  let inFence = false;
  lines.forEach((line, i) => {
    const no = i + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;
    for (const re of SECRETS) if (re.test(line)) { err(rel, no, 'secret', 'line matches a credential pattern'); return; }
    const a = ASSIGN.exec(line);
    if (a && !PLACEHOLDER.test(a[2])) { err(rel, no, 'secret', `${a[1]} assignment with a literal value`); return; }
    for (const m of line.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target) continue;
      if (!existsSync(resolve(dirname(file), target))) err(rel, no, 'link-missing', `link target not found: ${m[1]}`);
    }
    if (inFence) return;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const tok = m[1].trim();
      if (!tokens) continue;
      const script = /^(?:npm|pnpm|yarn) run ([\w:.-]+)/.exec(tok);
      if (script && pkgScripts && !(script[1] in pkgScripts)) warn(rel, no, 'script-missing', `package.json has no script "${script[1]}"`);
      if (!tok.includes('/') || /\s|[*?{}<>$]|^https?:|^\.\.?$/.test(tok) || tok.length > 120 || tok.startsWith('-')) continue;
      const p = normalizePath(tok).replace(/^\.\//, '').replace(/\/$/, '');
      if (!topLevel.has(p.split('/')[0])) continue;
      if (fileSet.has(p) || existsSync(join(root, p))) continue;
      warn(rel, no, 'path-missing', `path does not exist: ${tok}`);
    }
  });
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/lint.mjs')) {
  runMain((_, flags) => {
    const r = lint(resolveRoot(flags));
    process.on('exit', () => { if (r.errors.length) process.exitCode = 1; });
    return r;
  });
}
