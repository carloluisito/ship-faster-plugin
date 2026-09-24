import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { backupDir } from '../scripts/lib/state.mjs';
import { END, START, backupClaudeMd, refreshWorkflow, refreshWorkflowFile, sections, splice, spliceFile, workflowSection } from '../scripts/claude-md.mjs';

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

test('splice never touches hand-written text outside the markers and refuses unbalanced markers', () => {
  const rules = '## Rules\n- rule one.\n\n\n\n- rule two after three blank lines.\n';
  const withMarkers = `# Acme\n\n${START}\nold\n${END}\n\n${rules}`;
  const r = splice(withMarkers, '## What this is\nNew.');
  assert.ok(r.content.endsWith(rules), r.content);
  const noMarkers = `# Acme\n\n\n${rules}`;
  const inserted = splice(noMarkers, '## What this is\nNew.');
  assert.equal(inserted.content, `# Acme\n\n${START}\n## What this is\nNew.\n${END}\n\n${rules}`);
  const twoStarts = `# Acme\n${START}\na\n${START}\nb\n${END}\n`;
  assert.match(splice(twoStarts, 'x').error, /2 start and 1 end/);
  const endFirst = `# Acme\n${END}\nb\n${START}\n`;
  assert.match(splice(endFirst, 'x').error, /marker/);
  const { root } = makeRepo({ files: { 'CLAUDE.md': twoStarts } });
  const f = spliceFile(root, 'x', { config: DEFAULTS });
  assert.equal(f.ok, false);
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), twoStarts);
});

test('sections ignores headings inside ~~~ fences too', () => {
  const s = sections('# T\n\n~~~\n## not a heading\n~~~\n\n## Real\n');
  assert.deepEqual(s.sections.map((x) => x.heading), ['Real']);
});

test('spliceFile keeps CRLF line endings and hand-written text byte for byte', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const rules = '## Rules\r\n- keep me.\r\n\r\n\r\n- and me.\r\n';
  const existing = `# Acme\r\n\r\n${START}\r\nold\r\n${END}\r\n\r\n${rules}`;
  writeFileSync(join(root, 'CLAUDE.md'), existing);
  const r = spliceFile(root, '## What this is\nNew.\n', { config: DEFAULTS });
  assert.equal(r.ok, true);
  const out = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.ok(!/(?<!\r)\n/.test(out), 'every newline is CRLF');
  assert.ok(out.endsWith(rules), out);
  assert.ok(out.includes('New.\r\n'));
});

test('workflowSection renders the template section with the wiki directory and nothing left to fill', () => {
  const s = workflowSection('wiki');
  assert.match(s, /^## Workflow\n/);
  for (const skill of ['`ship-faster:preflight`', '`ship-faster:review`', '`ship-faster:sync-docs`', '`ship-faster:lesson`', '`/ship-faster:kickoff`', '`/ship-faster:ship`', '`/ship-faster:release`', '`/ship-faster:health`']) assert.ok(s.includes(skill), skill);
  assert.ok(s.includes('Pages under `wiki/`'));
  assert.ok(!s.includes('{{') && !s.includes(END) && !/\n$/.test(s));
});

test('refreshWorkflow replaces Keeping docs true, rewrites an old Workflow, inserts a missing one, and is idempotent', () => {
  const section = '## Workflow\nnew text';
  const block = (body) => `# A\n\n${START}\n## Read next\nx\n${body}${END}\n\n## Rules\n- r\n## Workflow\nhand-written, outside the block\n`;
  const want = block(`\n${section}\n`);

  const legacy = refreshWorkflow(block('\n## Keeping docs true\nold 1\nold 2\n'), section);
  assert.equal(legacy.status, 'missing');
  assert.equal(legacy.content, want);
  assert.deepEqual(refreshWorkflow(want, section), { status: 'current', changed: false, content: want });

  const old = refreshWorkflow(block('\n## Workflow\nold text\nmore\n'), section);
  assert.equal(old.status, 'outdated');
  assert.equal(old.content, want);

  const both = refreshWorkflow(block('\n## Workflow\nold\n\n## Keeping docs true\nlegacy\n'), section);
  assert.equal(both.status, 'outdated');
  assert.equal(both.content, want);

  assert.equal(refreshWorkflow(block(''), section).content, want);
  assert.equal(refreshWorkflow(block('\n'), section).content, want);

  const middle = refreshWorkflow(block('\n## Workflow\nold\n\n## Extra\nkeep\n'), section);
  assert.equal(middle.content, block(`\n${section}\n\n## Extra\nkeep\n`));

  const crlf = refreshWorkflow(want.replace(/\n/g, '\r\n'), section);
  assert.equal(crlf.status, 'current');
  assert.equal(refreshWorkflow('# A\n## Workflow\nx\n', section).status, 'unmanaged');
  assert.equal(refreshWorkflow(`${START}\n${START}\n${END}\n`, section).status, 'unmanaged');
});

test('refreshWorkflowFile writes the template section, keeps CRLF, warns over budget, and the CLI dry-runs', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const file = join(root, 'CLAUDE.md');
  assert.equal(refreshWorkflowFile(root, { config: DEFAULTS }).status, 'no-claude-md');
  const before = `# Acme\r\n\r\n${START}\r\n## Read next\r\nx\r\n\r\n## Keeping docs true\r\nold\r\n${END}\r\n\r\n## Rules\r\n- keep me.\r\n`;
  writeFileSync(file, before);
  const dry = runScript('claude-md', ['workflow', '--dry-run', '--json'], { cwd: root, env: { CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA } });
  assert.equal(dry.json.status, 'missing');
  assert.equal(dry.json.written, false);
  assert.equal(readFileSync(file, 'utf8'), before);
  const r = refreshWorkflowFile(root, { config: DEFAULTS });
  assert.equal(r.written, true);
  const out = readFileSync(file, 'utf8');
  assert.ok(!/(?<!\r)\n/.test(out), 'every newline is CRLF');
  assert.ok(out.includes(workflowSection('docs/wiki').replace(/\n/g, '\r\n')));
  assert.ok(out.endsWith('## Rules\r\n- keep me.\r\n') && !out.includes('Keeping docs true'));
  assert.equal(refreshWorkflowFile(root, { config: DEFAULTS }).status, 'current');
  const filler = Array.from({ length: 90 }, (_, i) => `line ${i}`).join('\n');
  writeFileSync(file, `# A\n\n${START}\n${filler}\n${END}\n`);
  const big = refreshWorkflowFile(root, { config: DEFAULTS });
  assert.equal(big.written, true);
  assert.match(big.warnings.join('; '), /managed block is \d+ lines, limit 90/);
});
