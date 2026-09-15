import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCRIPTS } from './helpers.mjs';
import { parseArgs, flagList, emit } from '../scripts/lib/cli.mjs';

test('parseArgs handles values, equals, booleans, repeats, positionals and --', () => {
  const r = parseArgs(['run', '--json', '--root', '/x', '--changed=a', '--changed', 'b', '--', '--not-a-flag']);
  assert.deepEqual(r._, ['run', '--not-a-flag']);
  assert.equal(r.flags.json, true);
  assert.equal(r.flags.root, '/x');
  assert.deepEqual(r.flags.changed, ['a', 'b']);
  assert.deepEqual(flagList(r.flags, 'changed'), ['a', 'b']);
  assert.deepEqual(flagList(r.flags, 'root'), ['/x']);
  assert.deepEqual(flagList(r.flags, 'missing'), []);
});

test('emit prints JSON and exit 0 even when ok is false under --json', () => {
  const out = capture(() => emit({ ok: false, error: 'boom' }, { json: true }));
  assert.deepEqual(JSON.parse(out.text), { ok: false, error: 'boom' });
  assert.equal(out.exitCode, 0);
});

test('emit prints summary lines and exit 1 when ok is false without --json', () => {
  const ok = capture(() => emit({ ok: true, summary: ['a', 'b'] }, {}));
  assert.equal(ok.text, 'a\nb\n');
  assert.equal(ok.exitCode, 0);
  const bad = capture(() => emit({ ok: false, error: 'boom' }, {}));
  assert.equal(bad.text, 'error: boom\n');
  assert.equal(bad.exitCode, 1);
});

test('readStdinJson returns parsed input, and null for garbage or nothing', () => {
  const mod = pathToFileURL(join(SCRIPTS, 'lib', 'cli.mjs')).href;
  const script = `import { readStdinJson } from '${mod}'; const v = await readStdinJson(500); console.log(JSON.stringify(v));`;
  const run = (input) => spawnSync(process.execPath, ['--input-type=module', '-e', script], { input, encoding: 'utf8' }).stdout.trim();
  assert.equal(run('{"a":1}'), '{"a":1}');
  assert.equal(run('not json'), 'null');
  assert.equal(run(''), 'null');
});

function capture(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  const origCode = process.exitCode;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  const exitCode = process.exitCode;
  process.exitCode = origCode;
  return { text: chunks.join(''), exitCode };
}
