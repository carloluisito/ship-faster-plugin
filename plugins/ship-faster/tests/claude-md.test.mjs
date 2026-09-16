import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { backupDir } from '../scripts/lib/state.mjs';
import { END, START, backupClaudeMd, sections, splice, spliceFile } from '../scripts/claude-md.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const EXISTING = `# Acme

Intro line.

${START}
## What this is
Old managed text.
${END}

## Rules
- Never call the API without a timeout.

## Deploy
\`\`\`
## not a heading
\`\`\`
Run the deploy script.
`;

test('sections finds the title, every H2 outside fences, line ranges, and the managed block', () => {
  const s = sections(EXISTING);
  assert.equal(s.title, 'Acme');
  assert.deepEqual(s.sections.map((x) => x.heading), ['What this is', 'Rules', 'Deploy']);
  assert.deepEqual(s.sections.map((x) => x.managed), [true, false, false]);
  assert.deepEqual(s.managed, { start: 5, end: 8 });
  assert.equal(s.sections[1].start, 10);
  assert.equal(s.sections[1].text, '## Rules\n- Never call the API without a timeout.');
  assert.equal(s.sections[1].lines, 2);
  assert.equal(s.sections[2].end, 17);
  assert.equal(s.lines, 17);
  assert.deepEqual(sections('no headings here\n').sections, []);
  assert.equal(sections('no headings here\n').title, null);
});

test('splice replaces only the text between the markers', () => {
  const r = splice(EXISTING, '## What this is\nNew managed text.\n\n## Stack\n- Node\n');
  assert.equal(r.replaced, true);
  assert.equal(r.managedLines, 5);
  assert.ok(r.content.startsWith('# Acme\n\nIntro line.\n\n' + START + '\n## What this is\nNew managed text.\n\n## Stack\n- Node\n' + END + '\n\n## Rules\n'));
  assert.match(r.content, /## Deploy\n```\n## not a heading\n```\nRun the deploy script\.\n$/);
  assert.ok(!r.content.includes('Old managed text'));
});

test('splice inserts after the H1 when there are no markers, and builds a new file from nothing', () => {
  const inserted = splice('# Acme\n\n## Rules\n- Keep it.\n', '## What this is\nText.');
  assert.equal(inserted.replaced, false);
  assert.equal(inserted.content, `# Acme\n\n${START}\n## What this is\nText.\n${END}\n\n## Rules\n- Keep it.\n`);
  const noH1 = splice('## Rules\n- Keep it.\n', '## What this is\nText.');
  assert.equal(noH1.content, `${START}\n## What this is\nText.\n${END}\n\n## Rules\n- Keep it.\n`);
  const fresh = splice(null, '## What this is\nText.', { projectName: 'New Thing' });
  assert.equal(fresh.content, `# New Thing\n\n${START}\n## What this is\nText.\n${END}\n\n## Rules\n`);
  assert.equal(fresh.lines, 8);
});

test('spliceFile writes, reports budgets, refuses an oversized block unless forced, and supports dry runs', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const block = '## What this is\nA thing.\n';
  const created = spliceFile(root, block, { config: DEFAULTS, projectName: 'Thing' });
  assert.deepEqual([created.ok, created.created, created.written, created.replaced], [true, true, true, false]);
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), `# Thing\n\n${START}\n## What this is\nA thing.\n${END}\n\n## Rules\n`);
  const again = spliceFile(root, '## What this is\nAnother.\n', { config: DEFAULTS });
  assert.deepEqual([again.created, again.replaced], [false, true]);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /^# Thing\n/);
  const big = Array.from({ length: 95 }, (_, i) => `line ${i}`).join('\n');
  const refused = spliceFile(root, big, { config: DEFAULTS });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /managed block is 95 lines, limit 90/);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /Another\./);
  const forced = spliceFile(root, big, { config: DEFAULTS, force: true });
  assert.equal(forced.ok, true);
  assert.deepEqual(forced.warnings, ['managed block is 95 lines, limit 90']);
  const dry = spliceFile(root, '## What this is\nDry.\n', { config: DEFAULTS, dryRun: true });
  assert.equal(dry.written, false);
  assert.match(dry.content, /Dry\./);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /line 94/);
  const tight = spliceFile(root, '## What this is\nDry.\n', { config: { ...DEFAULTS, claudeMdMaxLines: 5 } });
  assert.equal(tight.ok, false);
  assert.match(tight.error, /limit 5/);
});

test('backup copies CLAUDE.md into the project backup directory, and the CLI covers sections, splice, and backup', () => {
  const { root } = makeRepo({ files: { 'CLAUDE.md': EXISTING } });
  const b = backupClaudeMd(root);
  assert.equal(b.ok, true);
  assert.ok(existsSync(b.backup));
  assert.equal(readdirSync(backupDir(root)).length, 1);
  assert.equal(readFileSync(b.backup, 'utf8'), EXISTING);
  assert.equal(backupClaudeMd(tmpDir('sf-empty-')).backup, null);

  const s = runScript('claude-md', ['sections', '--root', root, '--json']);
  assert.equal(s.json.exists, true);
  assert.deepEqual(s.json.sections.map((x) => x.heading), ['What this is', 'Rules', 'Deploy']);
  const blockFile = join(tmpDir(), 'block.md');
  writeFileSync(blockFile, '## What this is\nFrom the CLI.\n');
  const sp = runScript('claude-md', ['splice', '--block', blockFile, '--root', root, '--json']);
  assert.equal(sp.json.ok, true);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /From the CLI\./);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /## Rules\n- Never call the API without a timeout\./);
  const missing = runScript('claude-md', ['splice', '--root', root, '--json']);
  assert.equal(missing.json.ok, false);
  const none = runScript('claude-md', ['sections', '--root', tmpDir('sf-none-'), '--json']);
  assert.deepEqual([none.json.ok, none.json.exists, none.json.sections], [true, false, []]);
  const bk = runScript('claude-md', ['backup', '--root', root, '--json']);
  assert.equal(bk.json.ok, true);
  assert.equal(readdirSync(backupDir(root)).length, 2);
});
