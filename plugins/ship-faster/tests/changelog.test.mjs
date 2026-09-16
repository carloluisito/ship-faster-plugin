import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, cleanupAll } from './helpers.mjs';
import { changelogSince, classify, insertSection, insertSectionFile, renderSection } from '../scripts/changelog.mjs';

after(cleanupAll);

test('classify maps conventional prefixes to Keep a Changelog groups', () => {
  assert.deepEqual(classify('feat(api): add users endpoint'), { type: 'feat', scope: 'api', breaking: false, text: 'Add users endpoint', group: 'Added' });
  assert.deepEqual(classify('fix: 404 on missing id'), { type: 'fix', scope: null, breaking: false, text: '404 on missing id', group: 'Fixed' });
  assert.deepEqual(classify('refactor!: drop the v1 client'), { type: 'refactor', scope: null, breaking: true, text: 'Drop the v1 client', group: 'Changed' });
  assert.deepEqual(classify('Update readme'), { type: null, scope: null, breaking: false, text: 'Update readme', group: 'Changed' });
});

test('changelogSince groups commits after the last tag and skips merges and release commits', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  git(['tag', 'v1.0.0']);
  const commit = (name, msg) => { writeFileSync(join(root, name), msg + '\n'); git(['add', name]); git(['commit', '-q', '-m', msg]); };
  commit('b.txt', 'feat(api): add users endpoint');
  commit('c.txt', 'fix: 404 on missing id');
  commit('d.txt', 'chore: bump deps');
  commit('e.txt', 'release: v1.0.1');
  git(['checkout', '-q', '-b', 'side']);
  commit('s.txt', 'feat: side feature');
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side']);
  const r = changelogSince(root);
  assert.equal(r.ok, true);
  assert.equal(r.lastTag, 'v1.0.0');
  assert.equal(r.range, 'v1.0.0..HEAD');
  assert.deepEqual(r.groups.Added.map((c) => c.text), ['Side feature', 'Add users endpoint']);
  assert.deepEqual(r.groups.Fixed.map((c) => c.text), ['404 on missing id']);
  assert.deepEqual(r.groups.Changed.map((c) => c.text), ['Bump deps']);
  assert.equal(r.skipped, 2);
  const explicit = changelogSince(root, { tag: 'v1.0.0' });
  assert.equal(explicit.commits.length, r.commits.length);
  const none = changelogSince(root, { tag: 'HEAD' });
  assert.deepEqual(none.commits, []);
  const fresh = makeRepo({ files: { 'a.txt': '' }, commits: [{ message: 'feat: everything' }] });
  const whole = changelogSince(fresh.root);
  assert.equal(whole.lastTag, null);
  assert.equal(whole.range, 'HEAD');
  assert.equal(whole.commits.length, 2);
  const cli = runScript('changelog', ['since', '--root', root, '--json']);
  assert.equal(cli.json.groups.Fixed.length, 1);
  assert.equal(runScript('changelog', ['--root', root, '--json']).json.ok, false);
});

test('renderSection and insertSection produce Keep a Changelog markdown', () => {
  const groups = { Added: [{ text: 'Add users endpoint', sha: 'abcdef1234567890' }], Fixed: [], Changed: [{ text: 'Drop the v1 client', sha: '1234567890abcdef', breaking: true }] };
  const section = renderSection('1.1.0', '2026-09-16', groups);
  assert.equal(section, '## [1.1.0] - 2026-09-16\n\n### Added\n- Add users endpoint (abcdef1)\n\n### Changed\n- **Breaking:** Drop the v1 client (1234567)\n');
  const created = insertSection('', section);
  assert.match(created, /^# Changelog\n/);
  assert.match(created, /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-09-16\n/);
  const existing = '# Changelog\n\nIntro.\n\n## [Unreleased]\n\n### Fixed\n- Pending fix.\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- First.\n';
  const merged = insertSection(existing, section);
  assert.match(merged, /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-09-16\n/);
  assert.match(merged, /## \[1\.1\.0\][\s\S]*### Fixed\n- Pending fix\.[\s\S]*## \[1\.0\.0\]/);
  assert.ok(!/## \[Unreleased\]\n\n### Fixed/.test(merged));
  const again = insertSection(merged, renderSection('1.1.0', '2026-09-17', groups));
  assert.equal((again.match(/## \[1\.1\.0\]/g) || []).length, 1);
  assert.match(again, /2026-09-17/);
  const noUnreleased = insertSection('# Changelog\n\n## [1.0.0] - 2026-01-01\n- x\n', section);
  assert.match(noUnreleased, /# Changelog\n\n## \[Unreleased\]\n\n## \[1\.1\.0\]/);
});

test('insertSectionFile creates or updates CHANGELOG.md from a section file, also through the CLI', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const sectionFile = join(root, 'section.md');
  writeFileSync(sectionFile, '## [1.1.0] - 2026-09-16\n\n### Added\n- Add users endpoint (abcdef1)\n');
  const created = insertSectionFile(root, sectionFile);
  assert.deepEqual([created.ok, created.created, created.version], [true, true, '1.1.0']);
  assert.match(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-09-16\n\n### Added\n- Add users endpoint \(abcdef1\)\n/);
  writeFileSync(sectionFile, '## [1.2.0] - 2026-10-01\n\n### Fixed\n- Fix a thing (1234567)\n');
  const cli = runScript('changelog', ['insert', '--section', sectionFile, '--root', root, '--json']);
  assert.deepEqual([cli.json.ok, cli.json.created, cli.json.version], [true, false, '1.2.0']);
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(text.indexOf('## [1.2.0]') < text.indexOf('## [1.1.0]'));
  writeFileSync(sectionFile, 'no heading here\n');
  assert.equal(insertSectionFile(root, sectionFile).ok, false);
  assert.equal(runScript('changelog', ['insert', '--root', root, '--json']).json.ok, false);
});

test('pending Unreleased bullets fold in after the last bullet of a matching group', () => {
  const section = '## [1.2.0] - 2026-09-17\n\n### Fixed\n- New fix one.\n- New fix two.\n\n### Changed\n- Something.\n';
  const existing = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- Pending fix.\n\n## [1.1.0] - 2026-09-16\n- x\n';
  const merged = insertSection(existing, section);
  assert.match(merged, /### Fixed\n- New fix one\.\n- New fix two\.\n- Pending fix\.\n\n### Changed\n- Something\.\n\n## \[1\.1\.0\]/);
});

test('insertSectionFile writes to a --file path relative to root, rejects paths that escape it, and strips a BOM', () => {
  const { root } = makeRepo({ files: { 'plugins/demo/CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' } });
  const sectionFile = join(root, 'section.md');
  writeFileSync(sectionFile, '## [1.1.0] - 2026-09-16\n\n### Added\n- Add users endpoint (abcdef1)\n');
  const result = insertSectionFile(root, sectionFile, { file: 'plugins/demo/CHANGELOG.md' });
  assert.deepEqual([result.ok, result.created, result.path], [true, false, 'plugins/demo/CHANGELOG.md']);
  assert.match(readFileSync(join(root, 'plugins/demo/CHANGELOG.md'), 'utf8'), /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-09-16\n\n### Added\n- Add users endpoint \(abcdef1\)\n/);
  assert.equal(existsSync(join(root, 'CHANGELOG.md')), false);
  assert.equal(insertSectionFile(root, sectionFile, { file: '../x.md' }).ok, false);
  writeFileSync(sectionFile, '﻿## [1.2.0] - 2026-10-01\n\n### Added\n- BOM safe.\n');
  assert.equal(insertSectionFile(root, sectionFile).ok, true);
});
