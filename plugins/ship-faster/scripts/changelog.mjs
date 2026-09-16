import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const PREFIX = /^(\w+)(?:\(([^)]*)\))?(!)?:\s+(.*)$/;
const GROUPS = ['Added', 'Fixed', 'Changed'];

export function classify(subject) {
  const m = PREFIX.exec(subject.trim());
  const type = m ? m[1].toLowerCase() : null;
  const text0 = m ? m[4] : subject.trim();
  const text = text0.charAt(0).toUpperCase() + text0.slice(1);
  const group = type === 'feat' ? 'Added' : type === 'fix' ? 'Fixed' : 'Changed';
  return { type, scope: m && m[2] ? m[2] : null, breaking: Boolean(m && m[3]), text, group };
}

export function changelogSince(root, { tag, match = 'v*' } = {}) {
  if (!git.isRepo(root)) return { ok: false, error: 'not a git repository' };
  const last = tag ? { tag } : git.lastTag(root, { match });
  const ref = last ? last.tag : null;
  const raw = git.logSince(root, ref);
  let skipped = 0;
  const commits = [];
  for (const c of raw) {
    if (c.parents.length > 1 || /^release:/i.test(c.subject)) { skipped++; continue; }
    commits.push({ sha: c.sha, subject: c.subject, ...classify(c.subject) });
  }
  const groups = Object.fromEntries(GROUPS.map((g) => [g, commits.filter((c) => c.group === g)]));
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  return { ok: true, lastTag: ref, range, commits, groups, skipped, summary: [`${commits.length} commit(s) since ${ref || 'the beginning'}: ${GROUPS.map((g) => `${groups[g].length} ${g.toLowerCase()}`).join(', ')}${skipped ? `, ${skipped} skipped` : ''}`] };
}

export function renderSection(version, date, groups) {
  const out = [`## [${version}] - ${date}`];
  for (const g of GROUPS) {
    const items = groups[g] || [];
    if (!items.length) continue;
    out.push('', `### ${g}`);
    for (const c of items) out.push(`- ${c.breaking ? '**Breaking:** ' : ''}${c.text}${c.sha ? ` (${String(c.sha).slice(0, 7)})` : ''}`);
  }
  return out.join('\n') + '\n';
}

const SKELETON = '# Changelog\n\nAll notable changes to this project are documented here. The format follows Keep a Changelog and versions follow semver.\n\n## [Unreleased]\n';

export function insertSection(text, section) {
  const version = /^## \[([^\]]+)\]/.exec(section)[1];
  let doc = (text || '').replace(/\r\n/g, '\n');
  if (!doc.trim()) doc = SKELETON;
  const stripped = removeSection(doc, version);
  const unreleased = /^## \[Unreleased\][^\n]*\n/m.exec(stripped);
  if (!unreleased) {
    const h1 = /^# [^\n]*\n/.exec(stripped);
    const at = h1 ? h1.index + h1[0].length : 0;
    return normalizeBlankLines(stripped.slice(0, at) + '\n## [Unreleased]\n\n' + section + '\n' + stripped.slice(at));
  }
  const start = unreleased.index + unreleased[0].length;
  const nextHeading = stripped.slice(start).search(/^## /m);
  const end = nextHeading === -1 ? stripped.length : start + nextHeading;
  const pending = stripped.slice(start, end).trim();
  let body = section;
  if (pending) body = mergePending(section, pending);
  return normalizeBlankLines(stripped.slice(0, start) + '\n' + body + '\n' + stripped.slice(end));
}

function removeSection(doc, version) {
  const re = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^\\n]*\\n`, 'm');
  const m = re.exec(doc);
  if (!m) return doc;
  const start = m.index;
  const rest = doc.slice(start + m[0].length);
  const next = rest.search(/^## /m);
  return doc.slice(0, start) + (next === -1 ? '' : rest.slice(next));
}

function mergePending(section, pending) {
  // Unreleased bullets belong to the version being cut: fold each pending group into the section.
  const blocks = pending.split(/^(?=### )/m).map((b) => b.trim()).filter(Boolean);
  let out = section.trimEnd();
  for (const block of blocks) {
    const heading = /^### (\w+)/.exec(block);
    const name = heading ? heading[1] : 'Changed';
    const bullets = block.replace(/^### [^\n]*\n?/, '').trim();
    if (!bullets) continue;
    const marker = `### ${name}\n`;
    const at = out.search(new RegExp(`^### ${name}\\n`, 'm'));
    if (at === -1) { out += `\n\n${marker}${bullets}`; continue; }
    const rest = out.slice(at + marker.length);
    const next = rest.search(/^### /m);
    const groupEnd = next === -1 ? out.length : at + marker.length + next;
    const group = out.slice(at, groupEnd).trimEnd();
    out = out.slice(0, at) + `${group}\n${bullets}` + (next === -1 ? '' : `\n\n${out.slice(groupEnd)}`);
  }
  return out + '\n';
}

function normalizeBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

export function insertSectionFile(root, sectionFile) {
  let section;
  try { section = readFileSync(sectionFile, 'utf8'); } catch (e) { return { ok: false, error: `cannot read ${sectionFile}: ${e.message}` }; }
  const heading = /^## \[([^\]]+)\]/.exec(section);
  if (!heading) return { ok: false, error: 'section must start with "## [version] - date"' };
  const path = join(root, 'CHANGELOG.md');
  const created = !existsSync(path);
  const current = created ? '' : readFileSync(path, 'utf8');
  writeFileSync(path, insertSection(current, section));
  return { ok: true, path: 'CHANGELOG.md', created, version: heading[1], summary: [`${created ? 'created' : 'updated'} CHANGELOG.md with [${heading[1]}]`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/changelog.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    if (positional[0] === 'since') return changelogSince(root, { tag: typeof flags.tag === 'string' ? flags.tag : undefined, match: typeof flags.match === 'string' ? flags.match : 'v*' });
    if (positional[0] === 'insert') return typeof flags.section === 'string' ? insertSectionFile(root, flags.section) : { ok: false, error: 'insert requires --section <file>' };
    return { ok: false, error: `unknown command ${positional[0]}; use since or insert` };
  });
}
