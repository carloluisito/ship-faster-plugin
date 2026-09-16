import { rmSync } from 'node:fs';
import { readStdinJson } from './lib/cli.mjs';
import { resolveRootCached } from './lib/root.mjs';
import { pruneSessions, sessionFile } from './lib/state.mjs';

async function main() {
  const input = (await readStdinJson(800)) || {};
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = resolveRootCached(cwd);
  if (input.session_id) rmSync(sessionFile(root, input.session_id), { force: true });
  pruneSessions(root, { maxAgeDays: 7, deadlineMs: 700 });
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
