import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';
import { validate } from './validate.mjs';

const REPO_ROOT = resolve(PLUGIN_ROOT, '..', '..');

test('the real repository validates with no errors', () => {
  const { errors } = validate(REPO_ROOT);
  assert.deepEqual(errors, []);
});

test('a version mismatch between manifests is an error', () => {
  const { errors } = validate(REPO_ROOT, {
    marketplace: { name: 'ship-faster', plugins: [{ name: 'ship-faster', source: './plugins/ship-faster', version: '9.9.9' }] },
  });
  assert.ok(errors.some((e) => e.includes('version')), errors.join('\n'));
});
