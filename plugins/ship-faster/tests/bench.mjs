import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, tmpDir, cleanupAll, SCRIPTS } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';

process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-bench-data-');
const files = {};
for (let i = 0; i < 40; i++) files[`src/mod${i}/index.ts`] = `${i}`;
const { root, git } = makeRepo({ files });
const first = git(['rev-parse', 'HEAD']);
const w = join(root, 'docs', 'wiki');
mkdirSync(w, { recursive: true });
writeFileSync(join(w, 'index.md'), '# i\n');
for (let i = 0; i < 30; i++) {
  writeFileSync(join(w, `page-${String(i).padStart(2, '0')}.md`), serializeFrontmatter({ title: `Page ${i}`, summary: 's', read_when: 'r', covers: [`src/mod${i}/**`], verified: first, updated: '2026-09-16' }) + '# p\n');
}
git(['add', '-A']);
git(['commit', '-q', '-m', 'wiki']);

function run(script, input) {
  const started = process.hrtime.bigint();
  spawnSync(process.execPath, [join(SCRIPTS, `${script}.mjs`)], { cwd: root, input: JSON.stringify(input), encoding: 'utf8', env: process.env });
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function median(script, input, n = 20) {
  const times = [];
  for (let i = 0; i < n; i++) times.push(run(script, input));
  times.sort((a, b) => a - b);
  return times[Math.floor(n / 2)];
}

const base = { session_id: 'bench', cwd: root };
const rows = [
  ['hook-ship-guard', median('hook-ship-guard', { ...base, tool_name: 'Bash', tool_input: { command: 'git status' } }), 150],
  ['hook-drift-marker', median('hook-drift-marker', { ...base, tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'mod3', 'index.ts') } }), 150],
  ['hook-prompt-report', median('hook-prompt-report', { ...base, prompt: 'x' }), 100],
  ['hook-session-start', median('hook-session-start', { ...base, source: 'startup' }, 5), 1500],
];
console.log('hook                  median ms   budget ms');
for (const [name, ms, budget] of rows) console.log(`${name.padEnd(22)}${ms.toFixed(0).padStart(9)}${String(budget).padStart(12)}${ms > budget ? '   OVER' : ''}`);
console.log('Node startup dominates; a figure over budget on a loaded machine is not a failure by itself.');
cleanupAll();
