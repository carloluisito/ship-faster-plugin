import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { backupDir } from './lib/state.mjs';

export const START = '<!-- ship-faster:managed:start -->';
export const END = '<!-- ship-faster:managed:end -->';
export const MANAGED_MAX = 90;

const lf = (text) => String(text).replace(/\r\n/g, '\n');

function countLines(text) {
  const t = lf(text);
  return t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
}

export function sections(text) {
  const lines = lf(text).split('\n');
  const total = countLines(text);
  const out = [];
  let managed = null;
  let title = null;
  let inFence = false;
  let cur = null;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const trimmed = line.trim();
    if (trimmed === START) managed = { start: i + 1, end: null };
    else if (trimmed === END && managed && managed.end === null) managed.end = i + 1;
    if (inFence) return;
    const h1 = /^# (.+)$/.exec(line);
    if (h1 && title === null) { title = h1[1].trim(); return; }
    const h2 = /^## (.+)$/.exec(line);
    if (!h2) return;
    if (cur) cur.end = i;
    cur = { heading: h2[1].trim(), start: i + 1, end: total, lines: 0, managed: false, text: '' };
    out.push(cur);
  });
  for (const s of out) {
    s.text = lines.slice(s.start - 1, s.end).join('\n').replace(/\n+$/, '');
    s.lines = s.text === '' ? 0 : s.text.split('\n').length;
    s.managed = Boolean(managed && managed.end && s.start > managed.start && s.start < managed.end);
  }
  if (managed && managed.end === null) managed = null;
  return { title, sections: out, managed, lines: countLines(text) };
}

export function splice(existing, block, { projectName = 'Project' } = {}) {
  const body = lf(block).replace(/^\n+|\n+$/g, '');
  const managedLines = body === '' ? 0 : body.split('\n').length;
  const managedBlock = `${START}\n${body}\n${END}`;
  let content;
  let replaced = false;
  if (existing === null || existing === undefined) {
    content = `# ${projectName}\n\n${managedBlock}\n\n## Rules\n`;
  } else {
    const text = lf(existing);
    const starts = text.split(START).length - 1;
    const ends = text.split(END).length - 1;
    if (starts === 1 && ends === 1 && text.indexOf(START) < text.indexOf(END)) {
      const s = text.indexOf(START);
      const e = text.indexOf(END);
      content = text.slice(0, s) + managedBlock + text.slice(e + END.length);
      replaced = true;
    } else if (starts === 0 && ends === 0) {
      const lines = text.split('\n');
      const h1 = lines.findIndex((l) => /^# /.test(l));
      const head = lines.slice(0, h1 + 1);
      const rest = lines.slice(h1 + 1);
      while (rest.length && rest[0].trim() === '') rest.shift();
      const parts = h1 === -1 ? [managedBlock] : [...head, '', managedBlock];
      content = (rest.length ? [...parts, '', ...rest] : parts).join('\n');
    } else {
      return { error: `CLAUDE.md has ${starts} start and ${ends} end marker(s); expected one matched pair or none. Fix the markers by hand.` };
    }
  }
  if (!content.endsWith('\n')) content += '\n';
  return { content, managedLines, lines: countLines(content), replaced };
}

export function spliceFile(root, block, { config, projectName, force = false, dryRun = false } = {}) {
  config = config || loadConfig(root).config;
  const file = join(root, 'CLAUDE.md');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const crlf = existing !== null && /\r\n/.test(existing) && (existing.match(/\r\n/g) || []).length >= (existing.match(/(?<!\r)\n/g) || []).length;
  const name = projectName || (existing !== null && sections(existing).title) || basename(normalizePath(root).replace(/\/+$/, '')) || 'Project';
  const r = splice(existing, block, { projectName: name });
  if (r.error) return { ok: false, error: r.error, path: 'CLAUDE.md', created: false, replaced: false, written: false, warnings: [] };
  const warnings = [];
  if (r.managedLines > MANAGED_MAX) warnings.push(`managed block is ${r.managedLines} lines, limit ${MANAGED_MAX}`);
  if (r.lines > config.claudeMdMaxLines) warnings.push(`CLAUDE.md would be ${r.lines} lines, limit ${config.claudeMdMaxLines}`);
  const base = { path: 'CLAUDE.md', created: existing === null, replaced: r.replaced, lines: r.lines, managedLines: r.managedLines, warnings };
  if (warnings.length && !force) return { ok: false, error: warnings.join('; '), ...base, written: false };
  if (!dryRun) writeFileSync(file, crlf ? r.content.replace(/\n/g, '\r\n') : r.content);
  const verb = dryRun ? 'would write' : 'wrote';
  return { ok: true, ...base, written: !dryRun, content: dryRun ? (crlf ? r.content.replace(/\n/g, '\r\n') : r.content) : undefined, summary: [`${verb} CLAUDE.md: ${r.lines} lines, managed block ${r.managedLines} lines${r.replaced ? ' (replaced)' : existing === null ? ' (created)' : ' (inserted)'}`, ...warnings] };
}

export function backupClaudeMd(root) {
  const file = join(root, 'CLAUDE.md');
  if (!existsSync(file)) return { ok: true, backup: null, summary: ['no CLAUDE.md to back up'] };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(backupDir(root), `CLAUDE.md.${stamp}.${process.pid}.${randomBytes(2).toString('hex')}`);
  copyFileSync(file, dest);
  const backup = normalizePath(dest);
  return { ok: true, backup, summary: [`backed up CLAUDE.md to ${backup}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/claude-md.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const [cmd] = positional;
    if (cmd === 'sections') {
      const file = join(root, 'CLAUDE.md');
      if (!existsSync(file)) return { ok: true, exists: false, title: null, sections: [], managed: null, lines: 0, summary: ['no CLAUDE.md'] };
      const s = sections(readFileSync(file, 'utf8'));
      return { ok: true, exists: true, ...s, summary: [`${s.sections.length} section(s), ${s.lines} lines${s.managed ? ', managed block present' : ''}`, ...s.sections.map((x) => `${x.heading}: ${x.lines} lines${x.managed ? ' (managed)' : ''}`)] };
    }
    if (cmd === 'splice') {
      if (typeof flags.block !== 'string') return { ok: false, error: 'splice requires --block <file>' };
      if (!existsSync(flags.block)) return { ok: false, error: `block file not found: ${flags.block}` };
      return spliceFile(root, readFileSync(flags.block, 'utf8'), { config, projectName: typeof flags.name === 'string' ? flags.name : undefined, force: Boolean(flags.force), dryRun: Boolean(flags['dry-run']) });
    }
    if (cmd === 'backup') return backupClaudeMd(root);
    return { ok: false, error: `unknown command ${cmd}; use sections, splice, or backup` };
  });
}
