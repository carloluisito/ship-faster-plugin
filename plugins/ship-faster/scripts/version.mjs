import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { listRepoFiles } from './lib/files.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(s) {
  const m = SEMVER.exec(String(s || '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || null } : null;
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextVersion(current, spec) {
  const cur = current ? parseSemver(current) : { major: 0, minor: 0, patch: 0, pre: null };
  if (!cur) return null;
  if (spec === 'major') return `${cur.major + 1}.0.0`;
  if (spec === 'minor') return `${cur.major}.${cur.minor + 1}.0`;
  if (spec === 'patch') return `${cur.major}.${cur.minor}.${cur.patch + 1}`;
  const explicit = parseSemver(spec);
  if (!explicit || String(spec).startsWith('v')) return null;
  if (current && compare(explicit, cur) <= 0) return null;
  return `${explicit.major}.${explicit.minor}.${explicit.patch}${explicit.pre ? `-${explicit.pre}` : ''}`;
}

const read = (root, rel) => readFileSync(join(root, ...rel.split('/')), 'utf8');
const write = (root, rel, text) => writeFileSync(join(root, ...rel.split('/')), text);

function jsonStrings(text) {
  const out = [];
  const stack = [];
  let i = 0;
  const endOfString = (from) => {
    let j = from + 1;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '"') return j + 1;
      j++;
    }
    return text.length;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = endOfString(i);
      const top = stack[stack.length - 1];
      if (top && top.type === 'object' && top.expectKey) { top.key = JSON.parse(text.slice(i, end)); top.expectKey = false; }
      else out.push({ path: stack.map((s) => (s.type === 'object' ? s.key : s.index)), start: i + 1, end: end - 1, value: JSON.parse(text.slice(i, end)) });
      i = end;
      continue;
    }
    if (ch === '{') stack.push({ type: 'object', key: null, expectKey: true });
    else if (ch === '[') stack.push({ type: 'array', index: 0 });
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',') { const top = stack[stack.length - 1]; if (top) { if (top.type === 'object') top.expectKey = true; else top.index++; } }
    i++;
  }
  return out;
}

function jsonTopLevel(text, key) {
  return jsonStrings(text).find((r) => r.path.length === 1 && r.path[0] === key) || null;
}

function jsonMarketplaceEntry(text, name) {
  const all = jsonStrings(text);
  const hit = all.find((r) => r.path.length === 3 && r.path[0] === 'plugins' && r.path[2] === 'name' && r.value === name);
  if (!hit) return null;
  return all.find((r) => r.path.length === 3 && r.path[0] === 'plugins' && r.path[1] === hit.path[1] && r.path[2] === 'version') || null;
}

const JSON_KIND = {
  find: (t) => { const r = jsonTopLevel(t, 'version'); return r ? [r.value, r.value] : null; },
  replace: (t, v) => { const r = jsonTopLevel(t, 'version'); return r ? t.slice(0, r.start) + v + t.slice(r.end) : t; },
};

const KINDS = {
  'package.json': JSON_KIND,
  'pyproject.toml': { find: (t) => /\[project\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(t), replace: (t, v) => t.replace(/(\[project\][^[]*?^version\s*=\s*")[^"]+(")/ms, `$1${v}$2`) },
  'Cargo.toml': { find: (t) => /\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(t), replace: (t, v) => t.replace(/(\[package\][^[]*?^version\s*=\s*")[^"]+(")/ms, `$1${v}$2`) },
  'Directory.Build.props': { find: (t) => /<Version>([^<]+)<\/Version>/.exec(t), replace: (t, v) => t.replace(/(<Version>)[^<]+(<\/Version>)/, `$1${v}$2`) },
  csproj: { find: (t) => /<Version>([^<]+)<\/Version>/.exec(t), replace: (t, v) => t.replace(/(<Version>)[^<]+(<\/Version>)/, `$1${v}$2`) },
  'version.txt': { find: (t) => /^\s*(v?\d+\.\d+\.\d+[^\s]*)\s*$/.exec(t), replace: (t, v) => t.replace(/\S+/, v) },
  plugin: JSON_KIND,
};

function kindOfFile(rel) {
  const name = basename(rel);
  if (name === 'package.json') return 'package.json';
  if (name === 'pyproject.toml') return 'pyproject.toml';
  if (name === 'Cargo.toml') return 'Cargo.toml';
  if (name === 'Directory.Build.props') return 'Directory.Build.props';
  if (name.endsWith('.csproj')) return 'csproj';
  if (/^version(\.txt)?$/i.test(name)) return 'version.txt';
  if (name === 'plugin.json' || name === 'marketplace.json') return 'plugin';
  return null;
}

function versionIn(root, rel, kind) {
  const text = read(root, rel);
  const m = KINDS[kind].find(text);
  return m ? m[1].replace(/^v/, '') : null;
}

function pluginSource(root, files, pluginName) {
  const rootPlugin = files.includes('.claude-plugin/plugin.json') || existsSync(join(root, '.claude-plugin', 'plugin.json'));
  const marketplaceRel = '.claude-plugin/marketplace.json';
  const hasMarketplace = files.includes(marketplaceRel) || existsSync(join(root, '.claude-plugin', 'marketplace.json'));
  if (!rootPlugin && !hasMarketplace) return null;
  const entries = [];
  if (hasMarketplace) {
    let doc;
    try { doc = JSON.parse(read(root, marketplaceRel)); } catch (e) { return { error: `marketplace.json unreadable: ${e.message}` }; }
    for (const p of doc.plugins || []) {
      if (!p || typeof p.source !== 'string' || !p.source.startsWith('./')) continue;
      const pluginJson = normalizePath(`${p.source.replace(/\/+$/, '')}/.claude-plugin/plugin.json`);
      if (existsSync(join(root, ...pluginJson.split('/')))) entries.push({ name: p.name, pluginJson, marketplaceVersion: p.version });
    }
  }
  if (rootPlugin) {
    let doc;
    try { doc = JSON.parse(read(root, '.claude-plugin/plugin.json')); } catch (e) { return { error: `plugin.json unreadable: ${e.message}` }; }
    entries.push({ name: doc.name, pluginJson: '.claude-plugin/plugin.json', marketplaceVersion: undefined });
  }
  if (!entries.length) return null;
  let entry = entries[0];
  if (entries.length > 1) {
    if (!pluginName) return { error: `marketplace lists ${entries.length} plugins (${entries.map((e) => e.name).join(', ')}); pass --plugin <name>` };
    entry = entries.find((e) => e.name === pluginName);
    if (!entry) return { error: `no plugin named ${pluginName} in the marketplace` };
  } else if (pluginName && entry.name !== pluginName) return { error: `no plugin named ${pluginName} in the marketplace` };
  const pluginVersion = versionIn(root, entry.pluginJson, 'plugin');
  if (!pluginVersion) return { error: `${entry.pluginJson} has no version` };
  const sourceFiles = [{ path: entry.pluginJson, current: pluginVersion }];
  if (entry.marketplaceVersion !== undefined) {
    if (entry.marketplaceVersion !== pluginVersion) return { error: `plugin.json (${pluginVersion}) and the marketplace entry (${entry.marketplaceVersion}) disagree; fix one before releasing` };
    sourceFiles.push({ path: marketplaceRel, current: entry.marketplaceVersion, entry: entry.name });
  }
  return { kind: 'plugin', files: sourceFiles, current: pluginVersion, pluginName: entry.name };
}

function lastTagInfo(root, match, prefix) {
  const last = git.isRepo(root) ? git.lastTag(root, { match }) : null;
  return { last: last ? last.tag : null, prefix };
}

export function detectVersion(root, { file, plugin } = {}) {
  const files = listRepoFiles(root);
  if (file) {
    const rel = normalizePath(file);
    const kind = kindOfFile(rel);
    if (!kind || kind === 'plugin') return { ok: false, error: `${rel} is not a recognised version file` };
    if (!existsSync(join(root, ...rel.split('/')))) return { ok: false, error: `${rel} not found` };
    const current = versionIn(root, rel, kind);
    if (!current) return { ok: false, error: `${rel} has no version` };
    return { ok: true, source: { kind, files: [{ path: rel, current }], current }, tags: lastTagInfo(root, 'v*', 'v'), summary: [`version ${current} from ${rel}`] };
  }
  const p = pluginSource(root, files, plugin);
  if (p && p.error) return { ok: false, error: p.error };
  if (p) return { ok: true, source: p, tags: lastTagInfo(root, `${p.pluginName}--v*`, `${p.pluginName}--v`), summary: [`version ${p.current} from ${p.files.map((f) => f.path).join(' and ')}`] };
  const tags = lastTagInfo(root, 'v*', 'v');
  for (const rel of ['package.json', 'pyproject.toml', 'Cargo.toml', 'Directory.Build.props']) {
    if (!files.includes(rel)) continue;
    const current = versionIn(root, rel, rel);
    if (current) return { ok: true, source: { kind: rel, files: [{ path: rel, current }], current }, tags, summary: [`version ${current} from ${rel}`] };
  }
  const csproj = files.filter((f) => f.endsWith('.csproj')).map((rel) => ({ path: rel, current: versionIn(root, rel, 'csproj') })).filter((f) => f.current);
  if (csproj.length) {
    const versions = new Set(csproj.map((f) => f.current));
    if (versions.size > 1) return { ok: false, error: `project files disagree on the version: ${csproj.map((f) => `${f.path}=${f.current}`).join(', ')}` };
    return { ok: true, source: { kind: 'csproj', files: csproj, current: csproj[0].current }, tags, summary: [`version ${csproj[0].current} from ${csproj.length} project file(s)`] };
  }
  const txt = files.find((f) => /^version(\.txt)?$/i.test(f));
  if (txt) {
    const current = versionIn(root, txt, 'version.txt');
    if (current) return { ok: true, source: { kind: 'version.txt', files: [{ path: txt, current }], current }, tags, summary: [`version ${current} from ${txt}`] };
  }
  const current = tags.last ? tags.last.replace(/^v/, '') : null;
  return { ok: true, source: { kind: 'tags', files: [], current }, tags, summary: [current ? `version ${current} from tag ${tags.last}` : 'no version file and no tag yet'] };
}

export function bumpVersion(root, spec, { file, plugin } = {}) {
  const d = detectVersion(root, { file, plugin });
  if (!d.ok) return d;
  const to = nextVersion(d.source.current, spec);
  if (!to) return { ok: false, error: d.source.current && parseSemver(spec) ? `${spec} is not greater than the current version ${d.source.current}` : `cannot bump ${d.source.current || '(none)'} with ${spec}; use patch, minor, major, or x.y.z` };
  const edits = [];
  for (const f of d.source.files) {
    const text = read(root, f.path);
    let next;
    if (f.entry) {
      const r = jsonMarketplaceEntry(text, f.entry);
      if (!r) return { ok: false, error: `could not find the version of ${f.entry} in ${f.path}` };
      next = text.slice(0, r.start) + to + text.slice(r.end);
    } else {
      const kind = d.source.kind === 'plugin' ? 'plugin' : d.source.kind;
      if (!KINDS[kind].find(text)) return { ok: false, error: `could not find the version in ${f.path}` };
      next = KINDS[kind].replace(text, to);
    }
    edits.push({ path: f.path, next });
  }
  for (const e of edits) write(root, e.path, e.next);
  const written = edits.map((e) => e.path);
  const tag = d.source.kind === 'plugin' ? `${d.source.pluginName}--v${to}` : `v${to}`;
  return { ok: true, kind: d.source.kind, from: d.source.current, to, files: written, tag, summary: [`${d.source.current || '(none)'} → ${to} in ${written.length ? written.join(', ') : 'no file (tags only)'}; tag ${tag}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/version.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const [cmd, spec] = positional;
    const opts = { file: typeof flags.file === 'string' ? flags.file : undefined, plugin: typeof flags.plugin === 'string' ? flags.plugin : undefined };
    if (cmd === 'detect') return detectVersion(root, opts);
    if (cmd === 'bump') return spec ? bumpVersion(root, spec, opts) : { ok: false, error: 'bump requires patch, minor, major, or x.y.z' };
    return { ok: false, error: `unknown command ${cmd}; use detect or bump` };
  });
}
