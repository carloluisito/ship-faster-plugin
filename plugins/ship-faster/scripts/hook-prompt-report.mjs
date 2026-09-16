import { readStdinJson } from './lib/cli.mjs';
import { resolveRootCached } from './lib/root.mjs';
import { loadSession, saveSession } from './lib/state.mjs';

const MAX = 400;
const TAIL = ', not yet re-verified. If the changes alter what those pages claim, update them or run /ship-faster:sync-docs before shipping.';
const HEAD = 'ship-faster: edits this session touched files covered by ';

function compose(names) {
  for (let keep = names.length; keep >= 1; keep--) {
    const shown = names.slice(0, keep);
    const rest = names.length - keep;
    const list = shown.join(', ') + (rest ? ` and ${rest} more` : '');
    const line = HEAD + list + TAIL;
    if (line.length <= MAX) return line;
  }
  return HEAD + `${names.length} pages` + TAIL;
}

async function main() {
  const input = await readStdinJson(1000);
  if (!input) return;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = resolveRootCached(cwd);
  const sid = input.session_id || 'default';
  const session = loadSession(root, sid);
  const pages = session.pages || {};
  const pending = Object.keys(pages).filter((rel) => !pages[rel].reported).sort();
  if (!pending.length) return;
  for (const rel of pending) pages[rel].reported = true;
  saveSession(root, sid, session);
  process.stdout.write(compose(pending) + '\n');
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
