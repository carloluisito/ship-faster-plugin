import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(here, f));
if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}
const data = mkdtempSync(join(tmpdir(), 'sf-run-data-'));
process.env.CLAUDE_PLUGIN_DATA = data;
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
try { rmSync(data, { recursive: true, force: true }); } catch {}
process.exit(r.status ?? 1);
