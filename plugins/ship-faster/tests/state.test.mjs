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

test('loadAllSessions unions every session record of the project', () => {
  const root = tmpDir('sf-root-');
  s.saveSession(root, 'one', { pages: { 'docs/wiki/a.md': { files: ['src/a.ts'], reported: false } } });
  s.saveSession(root, 'two', { pages: { 'docs/wiki/a.md': { files: ['src/b.ts'], reported: true }, 'docs/wiki/c.md': { files: ['lib/c.ts'], reported: false } } });
  writeFileSync(join(s.projectDir(root), 'sessions', 'junk.json'), 'not json');
  const all = s.loadAllSessions(root);
  assert.deepEqual(Object.keys(all.pages).sort(), ['docs/wiki/a.md', 'docs/wiki/c.md']);
  assert.deepEqual(all.pages['docs/wiki/a.md'].files.sort(), ['src/a.ts', 'src/b.ts']);
  assert.equal(all.pages['docs/wiki/a.md'].reported, true);
  assert.equal(all.pages['docs/wiki/c.md'].reported, false);
  assert.deepEqual(s.loadAllSessions(tmpDir('sf-empty-')).pages, {});
});

test('markSessionStart stamps the record and liveSessions lists other recent sessions only', () => {
  const root = tmpDir('sf-root-');
  assert.equal(s.markSessionStart(root, 'one', { branch: 'main', cwd: root }), true);
  const rec = s.loadSession(root, 'one');
  assert.equal(rec.branch, 'main');
  assert.equal(rec.cwd, root);
  assert.ok(Date.parse(rec.startedAt) > 0);
  assert.ok(Date.parse(rec.updatedAt) > 0);
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  s.writeJsonAtomic(s.sessionFile(root, 'stale'), { startedAt: old, updatedAt: old, branch: 'feat/old', pages: {} });
  s.writeJsonAtomic(s.sessionFile(root, 'two'), { startedAt: new Date().toISOString(), branch: 'feat/two', pages: {} });
  const threeHours = new Date(Date.now() - 3 * 3600_000).toISOString();
  s.writeJsonAtomic(s.sessionFile(root, 'idle'), { startedAt: threeHours, updatedAt: threeHours, branch: 'feat/idle', pages: {} });
  const live = s.liveSessions(root, { exceptSid: 'one' });
  assert.deepEqual(live.map((x) => x.sid).sort(), ['two']);
  assert.equal(live[0].branch, 'feat/two');
  assert.deepEqual(s.liveSessions(root, { exceptSid: 'two' }).map((x) => x.sid), ['one']);
  assert.deepEqual(s.liveSessions(root, { exceptSid: 'one', maxAgeHours: 48 }).map((x) => x.sid).sort(), ['idle', 'stale', 'two']);
  assert.deepEqual(s.liveSessions(tmpDir('sf-empty-'), { exceptSid: 'x' }), []);
  s.markSessionStart(root, 'one', { branch: 'feat/renamed', cwd: root });
  assert.equal(s.loadSession(root, 'one').startedAt, rec.startedAt);
  assert.equal(s.loadSession(root, 'one').branch, 'feat/renamed');
});

test('recordEdit keeps the newest claim per path, merges concurrent writers, caps the list, and dropClaims removes paths', () => {
  const root = tmpDir('sf-root-');
  const t = (m) => new Date(Date.UTC(2026, 8, 18, 10, m)).toISOString();
  assert.equal(s.recordEdit(root, 'one', 'src/a.js', { tool: 'Edit', at: t(1) }), true);
  s.recordEdit(root, 'one', 'src/a.js', { tool: 'Write', at: t(3) });
  s.recordEdit(root, 'one', 'src/b.js', { tool: 'Edit', at: t(2) });
  s.recordEdit(root, 'two', 'src/b.js', { tool: 'MultiEdit', at: t(4) });
  const byId = Object.fromEntries(s.loadEdits(root).map((e) => [e.sid, e]));
  assert.deepEqual(byId.one.files, { 'src/a.js': { at: t(3), tool: 'Write' }, 'src/b.js': { at: t(2), tool: 'Edit' } });
  assert.equal(byId.one.updatedAt, t(3));
  assert.deepEqual(Object.keys(byId.two.files), ['src/b.js']);

  const file = s.editsFile(root, 'one');
  s.writeJsonAtomic(file, { sid: 'one', updatedAt: t(5), files: { ...byId.one.files, 'src/c.js': { at: t(5), tool: 'Edit' } } });
  s.recordEdit(root, 'one', 'src/d.js', { tool: 'Edit', at: t(6) });
  assert.deepEqual(Object.keys(s.loadEdits(root).find((e) => e.sid === 'one').files).sort(), ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']);

  const full = Array.from({ length: 1000 }, (_, k) => [`f${k}.js`, { at: new Date(Date.UTC(2026, 0, 1, 0, 0, k)).toISOString(), tool: 'Edit' }]);
  s.writeJsonAtomic(s.editsFile(root, 'many'), { files: Object.fromEntries(full) });
  s.recordEdit(root, 'many', 'newest.js', { at: t(7) });
  const many = s.loadEdits(root).find((e) => e.sid === 'many').files;
  assert.equal(Object.keys(many).length, 1000);
  assert.ok(many['newest.js']);
  assert.equal(many['f0.js'], undefined);

  assert.equal(s.dropClaims(root, ['src/b.js'], { sid: 'two' }), 1);
  assert.ok(s.loadEdits(root).find((e) => e.sid === 'one').files['src/b.js']);
  assert.equal(s.dropClaims(root, ['src/a.js', 'src/b.js', 'nope.js']), 2);
  assert.deepEqual(Object.keys(s.loadEdits(root).find((e) => e.sid === 'one').files).sort(), ['src/c.js', 'src/d.js']);
  s.writeJsonAtomic(s.editsFile(root, 'broken'), [1, 2]);
  assert.deepEqual(s.loadEdits(root).find((e) => e.sid === 'broken').files, {});
  assert.deepEqual(s.loadEdits(tmpDir('sf-empty-')), []);
});

test('sessionRecords reports branch and last activity; pruneSessions also removes old claim files', () => {
  const root = tmpDir('sf-root-');
  const started = '2026-09-18T08:00:00.000Z';
  const updated = '2026-09-18T09:30:00.000Z';
  s.writeJsonAtomic(s.sessionFile(root, 'one'), { startedAt: started, updatedAt: updated, branch: 'feat/one' });
  s.writeJsonAtomic(s.sessionFile(root, 'two'), { pages: {} });
  s.writeJsonAtomic(s.sessionFile(root, 'bad'), 'text');
  assert.deepEqual(s.sessionRecords(root).sort((a, b) => a.sid.localeCompare(b.sid)), [
    { sid: 'one', branch: 'feat/one', lastActive: updated },
    { sid: 'two', branch: null, lastActive: null },
  ]);
  s.recordEdit(root, 'gone', 'a.js');
  const old = (Date.now() - 8 * 86400_000) / 1000;
  utimesSync(s.editsFile(root, 'gone'), old, old);
  s.recordEdit(root, 'kept', 'a.js');
  s.pruneSessions(root, { maxAgeDays: 7 });
  assert.deepEqual(s.loadEdits(root).map((e) => e.sid), ['kept']);
});
