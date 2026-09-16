import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/fm.mjs';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SKILL_FIELDS = new Set(['name', 'description', 'when_to_use', 'disable-model-invocation', 'user-invocable', 'allowed-tools', 'disallowed-tools', 'argument-hint', 'arguments', 'model', 'context', 'agent', 'background', 'hooks', 'paths', 'effort', 'shell', 'metadata', 'license', 'compatibility']);
const AGENT_FIELDS = new Set(['name', 'description', 'model', 'tools', 'disallowedTools', 'maxTurns', 'permissionMode', 'skills', 'hooks', 'memory', 'background', 'isolation', 'color', 'effort', 'mcpServers', 'initialPrompt', 'omitClaudeMd']);
const MODELS = new Set(['haiku', 'sonnet', 'opus', 'fable', 'inherit']);
const TOOLS = new Set(['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'TodoWrite', 'LS']);
const PROMPT_FIELDS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env', 'expected_outcome']);
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);
const SKILL_NAMES = new Set(['onboard', 'sync-docs', 'lesson', 'kickoff', 'preflight', 'ship', 'release', 'health', 'review']);
const TEMPLATES = ['claude-md.md', 'package-claude-md.md', 'plan.md', 'rules-file.md', 'gotcha-entry.md', ...['overview', 'architecture', 'layout', 'commands', 'conventions', 'testing', 'gotchas', 'dependencies', 'ops', 'recipe', 'package'].map((p) => `pages/${p}.md`)];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function fm(text) {
  const { data, errors } = parseFrontmatter(text);
  return { data, errors };
}

function dirs(path) {
  return existsSync(path) ? readdirSync(path).filter((n) => statSync(join(path, n)).isDirectory()) : [];
}

export function validate(repoRoot, overrides = {}) {
  const errors = [];
  const warnings = [];
  const pluginDir = join(repoRoot, 'plugins', 'ship-faster');
  const marketplaceFile = join(repoRoot, '.claude-plugin', 'marketplace.json');
  const pluginFile = join(pluginDir, '.claude-plugin', 'plugin.json');

  let marketplace = overrides.marketplace;
  let plugin = overrides.plugin;
  try { marketplace = marketplace || readJson(marketplaceFile); } catch (e) { errors.push(`marketplace.json unreadable: ${e.message}`); }
  try { plugin = plugin || readJson(pluginFile); } catch (e) { errors.push(`plugin.json unreadable: ${e.message}`); }
  if (!marketplace || !plugin) return { errors, warnings };

  if (marketplace.name !== 'ship-faster') errors.push(`marketplace name must be ship-faster, got ${marketplace.name}`);
  if (plugin.name !== 'ship-faster') errors.push(`plugin name must be ship-faster, got ${plugin.name}`);
  if (!SEMVER.test(plugin.version || '')) errors.push(`plugin version is not semver: ${plugin.version}`);
  const entry = (marketplace.plugins || []).find((p) => p.name === 'ship-faster');
  if (!entry) errors.push('marketplace.json has no entry named ship-faster');
  else {
    if (entry.source !== './plugins/ship-faster') errors.push(`marketplace source must be ./plugins/ship-faster, got ${entry.source}`);
    if (entry.version !== plugin.version) errors.push(`version mismatch: marketplace ${entry.version} vs plugin ${plugin.version}`);
  }
  if (!existsSync(pluginDir)) errors.push('plugins/ship-faster directory missing');
  for (const f of ['README.md', 'CHANGELOG.md']) {
    if (!existsSync(join(pluginDir, f))) errors.push(`plugins/ship-faster/${f} missing`);
  }

  const agents = new Set(existsSync(join(pluginDir, 'agents')) ? readdirSync(join(pluginDir, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : []);
  const skills = new Set(dirs(join(pluginDir, 'skills')));
  validateHooks(pluginDir, errors);
  validateSkills(pluginDir, errors, warnings, { agents, skills });
  validateAgents(pluginDir, errors);
  validateEvals(pluginDir, errors, skills);
  for (const t of TEMPLATES) if (!existsSync(join(pluginDir, 'templates', t))) errors.push(`templates/${t} missing`);
  return { errors, warnings };
}

function validateHooks(pluginDir, errors) {
  const file = join(pluginDir, 'hooks', 'hooks.json');
  if (!existsSync(file)) return;
  let doc;
  try { doc = readJson(file); } catch (e) { errors.push(`hooks.json unreadable: ${e.message}`); return; }
  for (const [event, groups] of Object.entries(doc.hooks || {})) {
    for (const group of groups) {
      for (const hook of group.hooks || []) {
        if (hook.type !== 'command') { errors.push(`${event}: hook type must be command`); continue; }
        const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/(scripts\/[\w.-]+\.mjs)/.exec(hook.command || '');
        if (!m) { errors.push(`${event}: command must reference \${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs: ${hook.command}`); continue; }
        if (!existsSync(join(pluginDir, m[1]))) errors.push(`${event}: script missing: ${m[1]}`);
        if (typeof hook.timeout !== 'number') errors.push(`${event}: hook needs a numeric timeout`);
      }
    }
  }
}

function checkReferences(pluginDir, baseDir, text, label, errors, { agents, skills }) {
  for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
    if (!existsSync(join(pluginDir, m[1]))) errors.push(`${label}: \${CLAUDE_PLUGIN_ROOT}/${m[1]} does not exist`);
  }
  for (const m of text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([\w./-]+)/g)) {
    if (!existsSync(join(baseDir, m[1]))) errors.push(`${label}: \${CLAUDE_SKILL_DIR}/${m[1]} does not exist`);
  }
  // `/ship-faster:<name>` is a skill invocation; a bare `ship-faster:<name>` is an agent (or skill) reference.
  // Skill names come from the spec so a skill may point at one that a later task creates.
  for (const m of text.matchAll(/(\/?)ship-faster:([a-z][\w-]*)\b(?!:)/g)) {
    const [, slash, name] = m;
    const isSkill = SKILL_NAMES.has(name) || skills.has(name);
    if (slash && !isSkill) errors.push(`${label}: /ship-faster:${name} names no skill`);
    if (!slash && !agents.has(name) && !isSkill) errors.push(`${label}: ship-faster:${name} names no agent or skill`);
  }
}

function validateSkills(pluginDir, errors, warnings, refs) {
  const dir = join(pluginDir, 'skills');
  for (const name of dirs(dir)) {
    const skillDir = join(dir, name);
    const file = join(skillDir, 'SKILL.md');
    const label = `skills/${name}`;
    if (!existsSync(file)) { errors.push(`${label}: SKILL.md missing`); continue; }
    const text = readFileSync(file, 'utf8');
    const { data, errors: fmErrors } = fm(text);
    if (!data) { errors.push(`${label}: no frontmatter`); continue; }
    for (const e of fmErrors) errors.push(`${label}: frontmatter line ${e.line}: ${e.message}`);
    for (const key of Object.keys(data)) if (!SKILL_FIELDS.has(key)) errors.push(`${label}: unknown frontmatter field "${key}"`);
    if (data.name !== name) errors.push(`${label}: frontmatter name "${data.name}" must equal directory name`);
    if (!data.description) errors.push(`${label}: description missing`);
    if (data['disable-model-invocation'] !== true && !data.when_to_use) errors.push(`${label}: model-invocable skill needs when_to_use`);
    if (!data['allowed-tools']) errors.push(`${label}: allowed-tools missing`);
    if (text.split(/\r?\n/).length > 500) errors.push(`${label}: SKILL.md over 500 lines`);
    const combined = String(data.description || '') + String(data.when_to_use || '');
    if (combined.length > 1536) errors.push(`${label}: description + when_to_use over 1536 characters`);
    if ('context' in data && data.context !== 'fork') errors.push(`${label}: context must be fork`);
    if (data.context === 'fork') {
      const m = /^ship-faster:([\w-]+)$/.exec(String(data.agent || ''));
      if (!m || !refs.agents.has(m[1])) errors.push(`${label}: agent must be ship-faster:<agent> naming an existing agent, got ${data.agent}`);
    }
    if ('background' in data && typeof data.background !== 'boolean') errors.push(`${label}: background must be true or false`);
    for (const line of text.split(/\r?\n/)) {
      if (/!`/.test(line) && !/\|\| true`\s*$/.test(line)) errors.push(`${label}: preprocessing line must end in || true: ${line.trim()}`);
    }
    checkReferences(pluginDir, skillDir, text, label, errors, refs);
    for (const link of text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)) {
      if (link[1].includes('${')) continue;
      if (!existsSync(resolve(skillDir, link[1]))) warnings.push(`${label}: link target missing: ${link[1]}`);
    }
  }
}

function validateAgents(pluginDir, errors) {
  const dir = join(pluginDir, 'agents');
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const label = `agents/${file}`;
    const name = file.replace(/\.md$/, '');
    const text = readFileSync(join(dir, file), 'utf8');
    const { data, errors: fmErrors } = fm(text);
    if (!data) { errors.push(`${label}: no frontmatter`); continue; }
    for (const e of fmErrors) errors.push(`${label}: frontmatter line ${e.line}: ${e.message}`);
    for (const key of Object.keys(data)) if (!AGENT_FIELDS.has(key)) errors.push(`${label}: unknown frontmatter field "${key}"`);
    if (data.name !== name) errors.push(`${label}: frontmatter name "${data.name}" must equal file name`);
    if (String(data.name || '').includes(':')) errors.push(`${label}: name may not contain ":"`);
    if (!data.description) errors.push(`${label}: description missing`);
    if (!data.model || (!MODELS.has(data.model) && !/^claude-/.test(String(data.model)))) errors.push(`${label}: unknown model ${data.model}`);
    if (typeof data.tools !== 'string' || !data.tools.trim()) errors.push(`${label}: tools must be a comma-separated string`);
    else for (const t of data.tools.split(',').map((s) => s.trim())) if (!TOOLS.has(t)) errors.push(`${label}: unknown tool ${t}`);
    if (!Number.isInteger(data.maxTurns) || data.maxTurns <= 0) errors.push(`${label}: maxTurns must be a positive integer`);
  }
}

function validateEvals(pluginDir, errors, skills) {
  const dir = join(pluginDir, 'evals');
  for (const skill of skills) {
    if (!existsSync(join(dir, skill, 'prompt.md'))) errors.push(`evals/${skill}/prompt.md missing: every skill needs an eval case`);
  }
  for (const name of dirs(dir)) {
    if (name === 'results' || name === 'mocks') continue;
    const caseDir = join(dir, name);
    const label = `evals/${name}`;
    const promptFile = join(caseDir, 'prompt.md');
    if (!existsSync(promptFile)) { errors.push(`${label}: prompt.md missing`); continue; }
    const text = readFileSync(promptFile, 'utf8');
    const { data, body, errors: fmErrors } = parseFrontmatter(text);
    if (!data) errors.push(`${label}: prompt.md has no frontmatter`);
    for (const e of fmErrors) errors.push(`${label}: prompt.md frontmatter line ${e.line}: ${e.message}`);
    if (data) {
      for (const key of Object.keys(data)) if (!PROMPT_FIELDS.has(key)) errors.push(`${label}: unknown prompt.md field "${key}"`);
      if ('max_turns' in data && !(Number.isInteger(data.max_turns) && data.max_turns >= 1 && data.max_turns <= 200)) errors.push(`${label}: max_turns must be an integer from 1 to 200`);
      if ('timeout_seconds' in data && !(Number.isInteger(data.timeout_seconds) && data.timeout_seconds >= 1 && data.timeout_seconds <= 3600)) errors.push(`${label}: timeout_seconds must be an integer from 1 to 3600`);
      if ('allowed_tools' in data && !Array.isArray(data.allowed_tools)) errors.push(`${label}: allowed_tools must be a list`);
    }
    if (!String(body || '').trim()) errors.push(`${label}: prompt body is empty`);
    const gradersDir = join(caseDir, 'graders');
    const graders = existsSync(gradersDir) ? readdirSync(gradersDir).filter((f) => f.endsWith('.md')) : [];
    if (!graders.length) errors.push(`${label}: no graders/*.md`);
    for (const g of graders) {
      const glabel = `${label}/graders/${g}`;
      const { data: gd, body: gbody, errors: gErrors } = parseFrontmatter(readFileSync(join(gradersDir, g), 'utf8'));
      if (!gd) { errors.push(`${glabel}: no frontmatter`); continue; }
      for (const e of gErrors) errors.push(`${glabel}: frontmatter line ${e.line}: ${e.message}`);
      if (!GRADER_TYPES.has(gd.type)) errors.push(`${glabel}: grader type ${gd.type} is not one of ${[...GRADER_TYPES].join(', ')}`);
      if ('weight' in gd && !(typeof gd.weight === 'number' && gd.weight > 0)) errors.push(`${glabel}: weight must be a positive number`);
      if ('arm' in gd && gd.arm !== 'with-only' && gd.arm !== 'both') errors.push(`${glabel}: arm must be with-only or both`);
      if (gd.type === 'llm' && !String(gbody || '').trim()) errors.push(`${glabel}: llm grader has no criteria body`);
      if (gd.type === 'regex' && (!gd.pattern || !gd.target)) errors.push(`${glabel}: regex grader needs pattern and target`);
      if (gd.type === 'tool_used' && !gd.tool) errors.push(`${glabel}: tool_used grader needs tool`);
      if (gd.type === 'file_exists' && !gd.path) errors.push(`${glabel}: file_exists grader needs path`);
    }
    const caseFile = join(caseDir, 'case.yaml');
    if (existsSync(caseFile)) {
      const yaml = readFileSync(caseFile, 'utf8');
      if (!/^schema_version:\s*"1\.1"\s*$/m.test(yaml)) errors.push(`${label}: case.yaml needs schema_version: "1.1"`);
      if (!/^name:\s*\S/m.test(yaml)) errors.push(`${label}: case.yaml needs name`);
      const s = /^\s+scaffold_script:\s*(\S+)\s*$/m.exec(yaml);
      if (s && !existsSync(join(caseDir, s[1]))) errors.push(`${label}: scaffold_script ${s[1]} does not exist in the case directory`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const { errors, warnings } = validate(repoRoot);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : 'validate: ok');
  process.exit(errors.length ? 1 : 0);
}
