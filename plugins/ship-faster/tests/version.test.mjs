import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, cleanupAll } from './helpers.mjs';
import { bumpVersion, detectVersion, nextVersion, parseSemver } from '../scripts/version.mjs';

after(cleanupAll);

test('parseSemver and nextVersion', () => {
  assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3, pre: null });
  assert.deepEqual(parseSemver('v1.2.3-rc.1'), { major: 1, minor: 2, patch: 3, pre: 'rc.1' });
  assert.equal(parseSemver('1.2'), null);
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', '1.2.3'), null);
  assert.equal(nextVersion('1.2.3', '1.2.2'), null);
  assert.equal(nextVersion('1.2.3', '2.0.0'), '2.0.0');
  assert.equal(nextVersion(null, '0.1.0'), '0.1.0');
  assert.equal(nextVersion(null, 'patch'), '0.0.1');
  assert.equal(nextVersion('1.2.3', 'banana'), null);
});

test('package.json is detected and bumped without reformatting', () => {
  const pkg = '{\n  "name": "x",\n  "version": "1.4.9",\n  "scripts": { "test": "node -e 0" }\n}\n';
  const { root } = makeRepo({ files: { 'package.json': pkg } });
  const d = detectVersion(root);
  assert.equal(d.source.kind, 'package.json');
  assert.equal(d.source.current, '1.4.9');
  const b = bumpVersion(root, 'minor');
  assert.deepEqual([b.ok, b.from, b.to, b.tag], [true, '1.4.9', '1.5.0', 'v1.5.0']);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), pkg.replace('1.4.9', '1.5.0'));
});

test('pyproject, Cargo, csproj with Directory.Build.props, and version.txt', () => {
  const py = makeRepo({ files: { 'pyproject.toml': '[project]\nname = "x"\nversion = "0.9.0"\n' } });
  assert.equal(detectVersion(py.root).source.kind, 'pyproject.toml');
  assert.equal(bumpVersion(py.root, 'patch').to, '0.9.1');
  assert.match(readFileSync(join(py.root, 'pyproject.toml'), 'utf8'), /^version = "0\.9\.1"$/m);

  const rs = makeRepo({ files: { 'Cargo.toml': '[package]\nname = "x"\nversion = "2.0.0"\n\n[dependencies]\nserde = { version = "1" }\n' } });
  assert.equal(detectVersion(rs.root).source.kind, 'Cargo.toml');
  assert.equal(bumpVersion(rs.root, 'major').to, '3.0.0');
  const cargo = readFileSync(join(rs.root, 'Cargo.toml'), 'utf8');
  assert.match(cargo, /^version = "3\.0\.0"$/m);
  assert.match(cargo, /serde = \{ version = "1" \}/);

  const props = makeRepo({ files: { 'Directory.Build.props': '<Project>\n  <PropertyGroup>\n    <Version>4.1.0</Version>\n  </PropertyGroup>\n</Project>\n', 'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n' } });
  assert.equal(detectVersion(props.root).source.kind, 'Directory.Build.props');
  assert.equal(bumpVersion(props.root, 'patch').to, '4.1.1');
  assert.match(readFileSync(join(props.root, 'Directory.Build.props'), 'utf8'), /<Version>4\.1\.1<\/Version>/);

  const cs = makeRepo({ files: { 'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <Version>1.0.0</Version>\n  </PropertyGroup>\n</Project>\n', 'src/Lib/Lib.csproj': '<Project>\n  <PropertyGroup><Version>1.0.0</Version></PropertyGroup>\n</Project>\n' } });
  const csd = detectVersion(cs.root);
  assert.equal(csd.source.kind, 'csproj');
  assert.deepEqual(csd.source.files.map((f) => f.path).sort(), ['src/App/App.csproj', 'src/Lib/Lib.csproj']);
  const csb = bumpVersion(cs.root, 'minor');
  assert.equal(csb.to, '1.1.0');
  assert.deepEqual(csb.files.sort(), ['src/App/App.csproj', 'src/Lib/Lib.csproj']);

  const txt = makeRepo({ files: { 'version.txt': '7.7.7\n' } });
  assert.equal(detectVersion(txt.root).source.kind, 'version.txt');
  assert.equal(bumpVersion(txt.root, 'patch').to, '7.7.8');
  assert.equal(readFileSync(join(txt.root, 'version.txt'), 'utf8'), '7.7.8\n');
});

test('a plugin repository bumps plugin.json and the marketplace entry together and tags with the plugin prefix', () => {
  const { root } = makeRepo({ files: {
    '.claude-plugin/marketplace.json': '{\n  "name": "mk",\n  "plugins": [\n    { "name": "ship-faster", "source": "./plugins/ship-faster", "version": "0.1.0" }\n  ]\n}\n',
    'plugins/ship-faster/.claude-plugin/plugin.json': '{\n  "name": "ship-faster",\n  "version": "0.1.0"\n}\n',
    'package.json': '{ "name": "not-the-source", "version": "9.9.9" }\n',
  } });
  const d = detectVersion(root);
  assert.equal(d.source.kind, 'plugin');
  assert.equal(d.source.current, '0.1.0');
  assert.deepEqual(d.source.files.map((f) => f.path).sort(), ['.claude-plugin/marketplace.json', 'plugins/ship-faster/.claude-plugin/plugin.json']);
  const b = bumpVersion(root, '0.2.0');
  assert.deepEqual([b.to, b.tag], ['0.2.0', 'ship-faster--v0.2.0']);
  assert.match(readFileSync(join(root, 'plugins/ship-faster/.claude-plugin/plugin.json'), 'utf8'), /"version": "0\.2\.0"/);
  assert.match(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'), /"version": "0\.2\.0"/);
  assert.match(readFileSync(join(root, 'package.json'), 'utf8'), /9\.9\.9/);
  const same = bumpVersion(root, '0.2.0');
  assert.equal(same.ok, false);
  assert.match(same.error, /not greater than/);

  const demo = makeRepo({ files: { '.claude-plugin/plugin.json': '{\n  "name": "demo",\n  "version": "0.1.0"\n}\n' } });
  demo.git(['tag', 'demo--v0.1.0']);
  const dd = detectVersion(demo.root);
  assert.equal(dd.source.kind, 'plugin');
  assert.equal(dd.tags.last, 'demo--v0.1.0');
});

test('a marketplace with two plugins needs --plugin, and a disagreeing pair is an error', () => {
  const { root } = makeRepo({ files: {
    '.claude-plugin/marketplace.json': '{ "name": "mk", "plugins": [ { "name": "a", "source": "./plugins/a", "version": "1.0.0" }, { "name": "b", "source": "./plugins/b", "version": "2.0.0" } ] }\n',
    'plugins/a/.claude-plugin/plugin.json': '{ "name": "a", "version": "1.0.0" }\n',
    'plugins/b/.claude-plugin/plugin.json': '{ "name": "b", "version": "2.5.0" }\n',
  } });
  const none = detectVersion(root);
  assert.equal(none.ok, false);
  assert.match(none.error, /--plugin/);
  const a = detectVersion(root, { plugin: 'a' });
  assert.equal(a.source.current, '1.0.0');
  const b = detectVersion(root, { plugin: 'b' });
  assert.equal(b.ok, false);
  assert.match(b.error, /disagree/);
});

test('tags-only repositories, --file, and the CLI', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const t0 = detectVersion(root);
  assert.equal(t0.source.kind, 'tags');
  assert.equal(t0.source.current, null);
  assert.equal(bumpVersion(root, 'patch').to, '0.0.1');
  git(['tag', 'v1.2.3']);
  const t1 = detectVersion(root);
  assert.equal(t1.source.current, '1.2.3');
  assert.equal(t1.tags.last, 'v1.2.3');
  const tb = bumpVersion(root, 'minor');
  assert.deepEqual([tb.to, tb.files, tb.tag], ['1.3.0', [], 'v1.3.0']);
  writeFileSync(join(root, 'VERSION'), '3.3.3\n');
  const f = detectVersion(root, { file: 'VERSION' });
  assert.equal(f.source.kind, 'version.txt');
  assert.equal(f.source.current, '3.3.3');
  const bad = detectVersion(root, { file: 'a.txt' });
  assert.equal(bad.ok, false);
  const cli = runScript('version', ['detect', '--root', root, '--json']);
  assert.equal(cli.json.source.kind, 'tags');
  const bump = runScript('version', ['bump', 'major', '--root', root, '--json']);
  assert.equal(bump.json.to, '2.0.0');
  const junk = runScript('version', ['bump', 'sideways', '--root', root, '--json']);
  assert.equal(junk.json.ok, false);
  const nocmd = runScript('version', ['--root', root, '--json']);
  assert.equal(nocmd.json.ok, false);
});

test('the top-level version is bumped even when a nested object has its own version key first', () => {
  const pkg = '{\n  "name": "x",\n  "engines": { "node": ">=20", "version": "20.0.0" },\n  "version": "1.4.9"\n}\n';
  const { root } = makeRepo({ files: { 'package.json': pkg } });
  assert.equal(detectVersion(root).source.current, '1.4.9');
  const b = bumpVersion(root, 'patch');
  assert.equal(b.to, '1.4.10');
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), pkg.replace('"version": "1.4.9"', '"version": "1.4.10"'));
});

test('a marketplace whose own name collides with a plugin name bumps only that plugin entry', () => {
  const mk = '{\n  "name": "b",\n  "plugins": [\n    { "name": "a", "source": "./plugins/a", "version": "1.0.0" },\n    { "name": "b", "source": "./plugins/b", "version": "2.0.0" }\n  ]\n}\n';
  const { root } = makeRepo({ files: {
    '.claude-plugin/marketplace.json': mk,
    'plugins/a/.claude-plugin/plugin.json': '{ "name": "a", "version": "1.0.0" }\n',
    'plugins/b/.claude-plugin/plugin.json': '{ "name": "b", "version": "2.0.0" }\n',
  } });
  const r = bumpVersion(root, 'minor', { plugin: 'b' });
  assert.deepEqual([r.ok, r.to, r.tag], [true, '2.1.0', 'b--v2.1.0']);
  assert.equal(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'), mk.replace('"version": "2.0.0"', '"version": "2.1.0"'));
  assert.match(readFileSync(join(root, 'plugins/b/.claude-plugin/plugin.json'), 'utf8'), /2\.1\.0/);
  assert.match(readFileSync(join(root, 'plugins/a/.claude-plugin/plugin.json'), 'utf8'), /1\.0\.0/);
});
