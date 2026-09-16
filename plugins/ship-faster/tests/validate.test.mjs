import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PLUGIN_ROOT, tmpDir, cleanupAll } from './helpers.mjs';
import { validate } from './validate.mjs';

const REPO_ROOT = resolve(PLUGIN_ROOT, '..', '..');
after(cleanupAll);

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

function fixture(files) {
  const root = tmpDir('sf-validate-');
  const plugin = join(root, 'plugins', 'ship-faster');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'ship-faster', plugins: [{ name: 'ship-faster', source: './plugins/ship-faster', version: '0.1.0' }] }));
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ship-faster', version: '0.1.0' }));
  writeFileSync(join(plugin, 'README.md'), '# r\n');
  writeFileSync(join(plugin, 'CHANGELOG.md'), '# c\n');
  cpSync(join(PLUGIN_ROOT, 'templates'), join(plugin, 'templates'), { recursive: true });
  mkdirSync(join(plugin, 'scripts'), { recursive: true });
  writeFileSync(join(plugin, 'scripts', 'detect.mjs'), '');
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const abs = join(plugin, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, plugin, errors: validate(root).errors };
}

const GOOD_SKILL = `---
name: good
description: A good skill.
when_to_use: When testing.
allowed-tools: Read, Bash(node *)
---
# Good

!\`node "\${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --json || true\`

Read \${CLAUDE_PLUGIN_ROOT}/templates/claude-md.md then launch ship-faster:analyst.
`;
const GOOD_AGENT = `---
name: analyst
description: An agent.
model: haiku
tools: Read, Glob, Grep
maxTurns: 10
---
Body.
`;
const GOOD_PROMPT = `---
description: case
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Skill]
---
Do the thing.
`;
const GOOD_GRADER = `---
type: llm
weight: 1
---
PASS when the thing was done.
`;
const BASE = {
  'skills/good/SKILL.md': GOOD_SKILL,
  'agents/analyst.md': GOOD_AGENT,
  'evals/good/prompt.md': GOOD_PROMPT,
  'evals/good/graders/criteria.md': GOOD_GRADER,
};

test('a well-formed fixture plugin validates', () => {
  assert.deepEqual(fixture(BASE).errors, []);
});

test('skill rules: unknown field, missing when_to_use, preprocessing without || true, missing references, bad fork', () => {
  const unknown = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('allowed-tools:', 'bogus: 1\nallowed-tools:') }).errors;
  assert.ok(unknown.some((e) => /unknown frontmatter field "bogus"/.test(e)), unknown.join('\n'));
  const noWhen = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('when_to_use: When testing.\n', '') }).errors;
  assert.ok(noWhen.some((e) => /when_to_use/.test(e)), noWhen.join('\n'));
  const slashOnly = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('when_to_use: When testing.\n', 'disable-model-invocation: true\n') }).errors;
  assert.deepEqual(slashOnly, []);
  const noTrue = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace(' || true`', '`') }).errors;
  assert.ok(noTrue.some((e) => /\|\| true/.test(e)), noTrue.join('\n'));
  const missingScript = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('scripts/detect.mjs', 'scripts/nope.mjs') }).errors;
  assert.ok(missingScript.some((e) => /scripts\/nope\.mjs/.test(e)), missingScript.join('\n'));
  const missingTemplate = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('templates/claude-md.md', 'templates/nope.md') }).errors;
  assert.ok(missingTemplate.some((e) => /templates\/nope\.md/.test(e)), missingTemplate.join('\n'));
  const missingAgent = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('ship-faster:analyst', 'ship-faster:ghost') }).errors;
  assert.ok(missingAgent.some((e) => /ship-faster:ghost/.test(e)), missingAgent.join('\n'));
  const skillRef = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('ship-faster:analyst', '/ship-faster:good and /ship-faster:onboard') }).errors;
  assert.deepEqual(skillRef, []);
  const badSkillRef = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('ship-faster:analyst', '/ship-faster:onbaord') }).errors;
  assert.ok(badSkillRef.some((e) => /\/ship-faster:onbaord names no skill/.test(e)), badSkillRef.join('\n'));
  const marker = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('ship-faster:analyst', 'ship-faster:analyst; markers ship-faster:managed:start') }).errors;
  assert.deepEqual(marker, []);
  const badFork = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('allowed-tools:', 'context: fork\nagent: analyst\nallowed-tools:') }).errors;
  assert.ok(badFork.some((e) => /agent must be ship-faster:<agent>/.test(e)), badFork.join('\n'));
  const goodFork = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('allowed-tools:', 'context: fork\nagent: ship-faster:analyst\nbackground: false\nallowed-tools:') }).errors;
  assert.deepEqual(goodFork, []);
  const noTools = fixture({ ...BASE, 'skills/good/SKILL.md': GOOD_SKILL.replace('allowed-tools: Read, Bash(node *)\n', '') }).errors;
  assert.ok(noTools.some((e) => /allowed-tools/.test(e)), noTools.join('\n'));
});

test('agent rules: unknown field, unknown tool, missing maxTurns, unknown model', () => {
  const unknown = fixture({ ...BASE, 'agents/analyst.md': GOOD_AGENT.replace('maxTurns: 10', 'maxTurns: 10\ncolour: red') }).errors;
  assert.ok(unknown.some((e) => /unknown frontmatter field "colour"/.test(e)), unknown.join('\n'));
  const badTool = fixture({ ...BASE, 'agents/analyst.md': GOOD_AGENT.replace('tools: Read, Glob, Grep', 'tools: Read, Telepathy') }).errors;
  assert.ok(badTool.some((e) => /unknown tool Telepathy/.test(e)), badTool.join('\n'));
  const noTurns = fixture({ ...BASE, 'agents/analyst.md': GOOD_AGENT.replace('maxTurns: 10\n', '') }).errors;
  assert.ok(noTurns.some((e) => /maxTurns/.test(e)), noTurns.join('\n'));
  const badModel = fixture({ ...BASE, 'agents/analyst.md': GOOD_AGENT.replace('model: haiku', 'model: gpt-9') }).errors;
  assert.ok(badModel.some((e) => /unknown model gpt-9/.test(e)), badModel.join('\n'));
});

test('eval rules: case per skill, prompt fields, grader shape, case.yaml and scaffold', () => {
  const noCase = fixture({ ...BASE, 'skills/other/SKILL.md': GOOD_SKILL.replace('name: good', 'name: other'), 'evals/other/graders/criteria.md': GOOD_GRADER }).errors;
  assert.ok(noCase.some((e) => /evals\/other\/prompt\.md/.test(e)), noCase.join('\n'));
  const badKey = fixture({ ...BASE, 'evals/good/prompt.md': GOOD_PROMPT.replace('description: case', 'scaffold_script: x.sh\ndescription: case') }).errors;
  assert.ok(badKey.some((e) => /unknown prompt\.md field "scaffold_script"/.test(e)), badKey.join('\n'));
  const badTurns = fixture({ ...BASE, 'evals/good/prompt.md': GOOD_PROMPT.replace('max_turns: 20', 'max_turns: 500') }).errors;
  assert.ok(badTurns.some((e) => /max_turns/.test(e)), badTurns.join('\n'));
  const emptyBody = fixture({ ...BASE, 'evals/good/prompt.md': GOOD_PROMPT.replace('Do the thing.\n', '') }).errors;
  assert.ok(emptyBody.some((e) => /prompt body is empty/.test(e)), emptyBody.join('\n'));
  const noGraders = fixture({ ...BASE, 'evals/good/graders/criteria.md': undefined, 'evals/good/graders/.keep': '' }).errors;
  assert.ok(noGraders.some((e) => /no graders/.test(e)), noGraders.join('\n'));
  const badType = fixture({ ...BASE, 'evals/good/graders/criteria.md': GOOD_GRADER.replace('type: llm', 'type: vibes') }).errors;
  assert.ok(badType.some((e) => /grader type vibes/.test(e)), badType.join('\n'));
  const emptyLlm = fixture({ ...BASE, 'evals/good/graders/criteria.md': '---\ntype: llm\n---\n' }).errors;
  assert.ok(emptyLlm.some((e) => /llm grader has no criteria/.test(e)), emptyLlm.join('\n'));
  const regexNoTarget = fixture({ ...BASE, 'evals/good/graders/shape.md': '---\ntype: regex\npattern: x\n---\n' }).errors;
  assert.ok(regexNoTarget.some((e) => /regex grader needs pattern and target/.test(e)), regexNoTarget.join('\n'));
  const goodRegex = fixture({ ...BASE, 'evals/good/graders/shape.md': '---\ntype: regex\npattern: "^# "\nflags: m\ntarget: { source: file, path: CLAUDE.md }\n---\n' }).errors;
  assert.deepEqual(goodRegex, []);
  const goodTool = fixture({ ...BASE, 'evals/good/graders/fired.md': '---\ntype: tool_used\ntool: Skill\ninput_match: good\n---\n' }).errors;
  assert.deepEqual(goodTool, []);
  const badArm = fixture({ ...BASE, 'evals/good/graders/criteria.md': GOOD_GRADER.replace('weight: 1', 'weight: 1\narm: left') }).errors;
  assert.ok(badArm.some((e) => /arm/.test(e)), badArm.join('\n'));
  const badCase = fixture({ ...BASE, 'evals/good/case.yaml': 'name: good\ncontext:\n  scaffold_script: scaffold.sh\n' }).errors;
  assert.ok(badCase.some((e) => /schema_version/.test(e)), badCase.join('\n'));
  assert.ok(badCase.some((e) => /scaffold\.sh/.test(e)), badCase.join('\n'));
  const goodCase = fixture({ ...BASE, 'evals/good/case.yaml': 'schema_version: "1.1"\nname: good\ncontext:\n  scaffold_script: scaffold.sh\n', 'evals/good/scaffold.sh': '#!/usr/bin/env bash\n' }).errors;
  assert.deepEqual(goodCase, []);
});

test('a missing template is an error', () => {
  const f = fixture(BASE);
  rmSync(join(f.plugin, 'templates', 'pages', 'ops.md'));
  const { errors } = validate(f.root);
  assert.ok(errors.some((e) => /templates\/pages\/ops\.md/.test(e)), errors.join('\n'));
});
