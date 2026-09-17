import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { loadEdits, loadSession, projectHash, readJson, saveSession, sessionFile, writeJsonAtomic } from '../scripts/lib/state.mjs';
import { resolveRootCached } from '../scripts/lib/root.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const env = () => ({ CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA });
const page = (title, covers) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified: 'abc', updated: '2026-09-16' }) + `# ${title}\n`;

function repo(extraPages = 0) {
  const { root } = makeRepo({ files: { 'src/api/users.ts': '', 'tests/a.test.ts': '', 'README.md': '' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'recipes', 'add-endpoint.md'), page('Add endpoint', ['src/api/**']));
  writeFileSync(join(w, 'testing.md'), page('Testing', ['tests/**']));
  for (let i = 0; i < extraPages; i++) writeFileSync(join(w, `extra-${String(i).padStart(2, '0')}.md`), page(`Extra ${i}`, ['src/**']));
  return root;
}

const edit = (root, file, tool = 'Edit', sid = 'sid1') =>
  runScript('hook-drift-marker', [], { cwd: root, stdin: { session_id: sid, cwd: root, tool_name: tool, tool_input: tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file } }, env: env() });
const report = (root, sid = 'sid1') => runScript('hook-prompt-report', [], { cwd: root, stdin: { session_id: sid, cwd: root, prompt: 'hi' }, env: env() });
const end = (root, sid = 'sid1') => runScript('hook-session-end', [], { cwd: root, stdin: { session_id: sid, cwd: root, reason: 'other' }, env: env() });

test('drift-marker records covered hits silently and ignores the rest', () => {
  const root = repo();
  const r = edit(root, join(root, 'src', 'api', 'users.ts'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  let s = loadSession(root, 'sid1');
  assert.deepEqual(s.pages['docs/wiki/recipes/add-endpoint.md'], { files: ['src/api/users.ts'], reported: false });
  edit(root, 'src/api/users.ts');
  assert.deepEqual(loadSession(root, 'sid1').pages['docs/wiki/recipes/add-endpoint.md'].files, ['src/api/users.ts']);
  edit(root, join(root, 'docs', 'wiki', 'testing.md'));
  edit(root, join(root, 'README.md'));
  edit(root, join(root, 'tests', 'a.test.ts'), 'Read');
  edit(root, join(tmpDir(), 'outside.ts'));
  s = loadSession(root, 'sid1');
  assert.deepEqual(Object.keys(s.pages), ['docs/wiki/recipes/add-endpoint.md']);
  edit(root, join(root, 'tests', 'a.test.ts'), 'NotebookEdit');
  assert.ok(loadSession(root, 'sid1').pages['docs/wiki/testing.md']);
});

test('prompt-report prints once per page, then stays silent, and caps the line', () => {
  const root = repo();
  assert.equal(report(root).stdout, '');
  edit(root, 'src/api/users.ts');
  const first = report(root);
  assert.match(first.stdout, /^ship-faster: edits this session touched files covered by docs\/wiki\/recipes\/add-endpoint\.md, not yet re-verified\. .*\/ship-faster:sync-docs before shipping\.\n$/);
  assert.equal(report(root).stdout, '');
  assert.equal(loadSession(root, 'sid1').pages['docs/wiki/recipes/add-endpoint.md'].reported, true);
  edit(root, 'tests/a.test.ts');
  const second = report(root);
  assert.match(second.stdout, /docs\/wiki\/testing\.md/);
  assert.ok(!second.stdout.includes('add-endpoint'));
  const big = repo(12);
  edit(big, 'src/api/users.ts');
  const capped = report(big);
  assert.ok(capped.stdout.length <= 401, `line is ${capped.stdout.length} chars`);
  assert.match(capped.stdout, /and \d+ more/);
});

test('a report with nothing pending leaves the session file alone', () => {
  const root = repo();
  edit(root, 'src/api/users.ts');
  assert.match(report(root).stdout, /add-endpoint/);
  const file = sessionFile(root, 'sid1');
  const past = new Date(Date.now() - 60_000);
  utimesSync(file, past, past);
  const before = statSync(file).mtimeMs;
  assert.equal(report(root).stdout, '');
  assert.equal(statSync(file).mtimeMs, before);
});

test('prompt-report refreshes a session record older than thirty minutes and leaves a fresh one alone', () => {
  const root = repo();
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  writeJsonAtomic(sessionFile(root, 'sid1'), { startedAt: old, updatedAt: old, branch: 'main', pages: {} });
  assert.equal(report(root).stdout, '');
  const refreshed = readJson(sessionFile(root, 'sid1'), null);
  assert.ok(Date.now() - Date.parse(refreshed.updatedAt) < 60_000);
  assert.equal(refreshed.startedAt, old);
  const file = sessionFile(root, 'sid1');
  const before = statSync(file).mtimeMs;
  assert.equal(report(root).stdout, '');
  assert.equal(statSync(file).mtimeMs, before);
});

test('prompt-report never creates a session record on its own', () => {
  const root = repo();
  assert.equal(report(root).stdout, '');
  assert.equal(existsSync(sessionFile(root, 'sid1')), false);
});

test('resolveRootCached trusts a cached root for a day outside a repository', () => {
  const dir = tmpDir();
  const first = resolveRootCached(dir);
  const cache = join(process.env.CLAUDE_PLUGIN_DATA, 'cwd-cache', `${projectHash(dir)}.json`);
  assert.ok(existsSync(cache));
  assert.equal(resolveRootCached(dir), first);
  writeJsonAtomic(cache, { root: '/somewhere/without/a/dot-git', at: new Date().toISOString() });
  assert.equal(resolveRootCached(dir), '/somewhere/without/a/dot-git');
});

test('session-end removes the session file and prunes old ones; cwd cache avoids repeated git calls', () => {
  const root = repo();
  edit(root, 'src/api/users.ts');
  const old = sessionFile(root, 'old');
  saveSession(root, 'old', {});
  const past = new Date(Date.now() - 10 * 86400_000);
  utimesSync(old, past, past);
  const r = end(root);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(!existsSync(sessionFile(root, 'sid1')));
  assert.ok(!existsSync(old));
  const sub = join(root, 'src');
  const norm = (p) => realpathSync(p).replace(/\\/g, '/').toLowerCase();
  assert.equal(norm(resolveRootCached(sub)), norm(root));
  assert.ok(existsSync(join(process.env.CLAUDE_PLUGIN_DATA, 'cwd-cache')));
  assert.equal(runScript('hook-drift-marker', [], { cwd: root, stdin: 'garbage', env: env() }).code, 0);
  assert.equal(runScript('hook-prompt-report', [], { cwd: root, stdin: '', env: env() }).code, 0);
  assert.equal(runScript('hook-session-end', [], { cwd: root, stdin: 'garbage', env: env() }).code, 0);
});

test('drift-marker claims every file the session edits inside the repository, wiki files included, and the claims outlive the session', () => {
  const root = repo();
  edit(root, join(root, 'README.md'));
  edit(root, 'src/api/users.ts', 'Write');
  edit(root, join(root, 'docs', 'wiki', 'testing.md'), 'MultiEdit');
  edit(root, join(root, 'tests', 'a.test.ts'), 'NotebookEdit');
  edit(root, join(root, 'src', 'api', 'read-only.ts'), 'Read');
  edit(root, join(tmpDir(), 'outside.ts'));
  runScript('hook-drift-marker', [], { cwd: root, stdin: { cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, 'anonymous.txt') } }, env: env() });
  const records = loadEdits(root);
  assert.deepEqual(records.map((e) => e.sid), ['sid1']);
  const claims = records[0].files;
  assert.deepEqual(Object.keys(claims).sort(), ['README.md', 'docs/wiki/testing.md', 'src/api/users.ts', 'tests/a.test.ts']);
  assert.equal(claims['src/api/users.ts'].tool, 'Write');
  assert.ok(Date.now() - Date.parse(claims['README.md'].at) < 60_000);
  end(root);
  assert.deepEqual(loadEdits(root).map((e) => e.sid), ['sid1']);
});
