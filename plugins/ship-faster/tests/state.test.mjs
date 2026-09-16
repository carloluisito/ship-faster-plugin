import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, cleanupAll } from './helpers.mjs';
import * as s from '../scripts/lib/state.mjs';

after(cleanupAll);
let data;
beforeEach(() => { data = tmpDir('sf-data-'); process.env.CLAUDE_PLUGIN_DATA = data; });

test('dataDir prefers CLAUDE_PLUGIN_DATA, ignores an unexpanded placeholder, falls back to the config dir', () => {
  assert.equal(s.dataDir(), data);
  process.env.CLAUDE_PLUGIN_DATA = '${CLAUDE_PLUGIN_DATA}';
  process.env.CLAUDE_CONFIG_DIR = join(data, 'cfg');
  assert.equal(s.dataDir(), join(data, 'cfg', 'plugins', 'data', 'ship-faster'));
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.match(s.dataDir().replace(/\\/g, '/'), /\/\.claude\/plugins\/data\/ship-faster$/);
});

test('projectHash is stable, 16 hex, and distinct per root', () => {
  const a = s.projectHash('/tmp/one');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, s.projectHash('/tmp/one'));
  assert.notEqual(a, s.projectHash('/tmp/two'));
});

test('projectDir writes project.json once; json helpers round-trip and tolerate corruption', () => {
  const root = tmpDir();
  const dir = s.projectDir(root);
  assert.ok(existsSync(join(dir, 'project.json')));
  const meta = s.readJson(join(dir, 'project.json'));
  assert.equal(meta.root.replace(/\\/g, '/'), root.replace(/\\/g, '/'));
  const f = join(dir, 'x.json');
  s.writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(s.readJson(f), { a: 1 });
  writeFileSync(f, '{ corrupt');
  assert.deepEqual(s.readJson(f, { fallback: true }), { fallback: true });
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
  assert.ok(existsSync(s.preflightDir(root)));
  assert.ok(existsSync(s.backupDir(root)));
});

test('sessions save, load, sanitize ids, and prune by age within a deadline', () => {
  const root = tmpDir();
  s.saveSession(root, 'abc-123', { pages: { 'a.md': { files: ['x'], reported: false } } });
  assert.deepEqual(s.loadSession(root, 'abc-123').pages['a.md'].files, ['x']);
  assert.deepEqual(s.loadSession(root, 'missing'), {});
  assert.match(s.sessionFile(root, '../evil/../id'), /sessions[\\/][A-Za-z0-9_-]+\.json$/);
  const old = s.sessionFile(root, 'old');
  s.saveSession(root, 'old', {});
  const past = new Date(Date.now() - 10 * 86400_000);
  utimesSync(old, past, past);
  const { removed } = s.pruneSessions(root, { maxAgeDays: 7 });
  assert.equal(removed, 1);
  assert.ok(!existsSync(old));
  assert.ok(existsSync(s.sessionFile(root, 'abc-123')));
});

test('session helpers never throw on blocked data directory', () => {
  const tmp = tmpDir();
  const blocked = join(tmp, 'blocked');
  writeFileSync(blocked, '');
  process.env.CLAUDE_PLUGIN_DATA = join(tmp, 'blocked', 'sub');
  assert.equal(s.writeJsonAtomic(join(s.dataDir(), 'x.json'), { a: 1 }), false);
  assert.equal(s.saveSession('/r', 'sid', {}), false);
  assert.deepEqual(s.loadSession('/r', 'sid'), {});
  assert.deepEqual(s.pruneSessions('/r'), { removed: 0 });
  assert.equal(s.updateSession('/r', 'sid', () => {}), false);
});

test('updateSession creates a page when the record is missing', () => {
  const root = tmpDir();
  const ok = s.updateSession(root, 'sid1', (record) => {
    record.pages = record.pages || {};
    record.pages['a.md'] = { files: ['x'], reported: false };
  });
  assert.equal(ok, true);
  assert.deepEqual(s.loadSession(root, 'sid1'), { pages: { 'a.md': { files: ['x'], reported: false } } });
});

test('updateSession merges a concurrent write from another process instead of overwriting it', () => {
  const root = tmpDir();
  s.saveSession(root, 'sid1', { pages: { 'a.md': { files: ['x'], reported: false } } });
  const ok = s.updateSession(root, 'sid1', (record) => {
    s.saveSession(root, 'sid1', {
      pages: {
        'b.md': { files: ['y'], reported: false },
        'a.md': { files: ['x', 'z'], reported: true },
      },
    });
    record.pages = record.pages || {};
    record.pages['c.md'] = { files: ['q'], reported: false };
  });
  assert.equal(ok, true);
  const final = s.loadSession(root, 'sid1');
  assert.deepEqual(final.pages['a.md'], { files: ['x', 'z'], reported: true });
  assert.deepEqual(final.pages['b.md'], { files: ['y'], reported: false });
  assert.deepEqual(final.pages['c.md'], { files: ['q'], reported: false });
});

test('writeJsonAtomic returns false and cleans up when rename fails on directory target', () => {
  const dir = tmpDir();
  const asdir = join(dir, 'asdir.json');
  mkdirSync(asdir);
  const result = s.writeJsonAtomic(asdir, { a: 1 });
  assert.equal(result, false);
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
});
