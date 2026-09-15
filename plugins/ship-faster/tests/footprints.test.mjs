import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { footprints } from '../scripts/footprints.mjs';

after(cleanupAll);

function history() {
  const commits = [];
  for (let i = 0; i < 6; i++) {
    commits.push({ message: `feat(api): add endpoint ${i}`, files: { 'src/api/routes.ts': `r${i}`, 'src/api/schema.ts': `s${i}`, 'package-lock.json': `${i}` } });
  }
  for (let i = 0; i < 4; i++) {
    commits.push({ message: `fix: repair parser case ${i}`, files: { 'lib/parser.py': `p${i}`, 'lib/tokens.py': `t${i}`, 'tests/test_parser.py': `x${i}` } });
  }
  commits.push({ message: 'docs: readme', files: { 'README.md': 'r' } });
  commits.push({ message: 'chore: touch two unrelated', files: { 'src/api/routes.ts': 'z', 'lib/tokens.py': 'z' } });
  return commits;
}

test('finds the two clusters, ignores lockfiles, extracts keywords and samples', () => {
  const { root } = makeRepo({ files: { 'README.md': '0' }, commits: history() });
  const r = footprints(root);
  assert.equal(r.ok, true);
  assert.equal(r.commitsScanned, 13);
  assert.equal(r.clusters.length, 2);
  assert.deepEqual(r.clusters[0].files, ['src/api/routes.ts', 'src/api/schema.ts']);
  assert.equal(r.clusters[0].commits, 6);
  assert.ok(r.clusters[0].keywords.includes('endpoint'));
  assert.ok(!r.clusters[0].keywords.includes('feat'));
  assert.equal(r.clusters[0].samples.length, 3);
  assert.deepEqual(r.clusters[1].files, ['lib/parser.py', 'lib/tokens.py', 'tests/test_parser.py']);
  assert.ok(!JSON.stringify(r.clusters).includes('package-lock.json'));
  assert.equal(r.hotspots[0].dir, 'src');
});

test('handles a repo without history and the CLI flag', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a' } });
  const r = footprints(root);
  assert.deepEqual(r.clusters, []);
  assert.equal(footprints(tmpDir()).commitsScanned, 0);
  const cli = runScript('footprints', ['--root', root, '--json', '--max-commits', '5']);
  assert.equal(cli.json.ok, true);
});
