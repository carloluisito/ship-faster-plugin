import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
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

  validateHooks(pluginDir, errors);
  validateSkills(pluginDir, errors, warnings);
  validateAgents(pluginDir, errors);
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

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return data;
}

function validateSkills(pluginDir, errors, warnings) {
  const dir = join(pluginDir, 'skills');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const skillDir = join(dir, name);
    if (!statSync(skillDir).isDirectory()) continue;
    const file = join(skillDir, 'SKILL.md');
    if (!existsSync(file)) { errors.push(`skills/${name}: SKILL.md missing`); continue; }
    const text = readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    if (!fm) { errors.push(`skills/${name}: no frontmatter`); continue; }
    if (fm.name !== name) errors.push(`skills/${name}: frontmatter name "${fm.name}" must equal directory name`);
    if (!fm.description) errors.push(`skills/${name}: description missing`);
    if (text.split(/\r?\n/).length > 500) errors.push(`skills/${name}: SKILL.md over 500 lines`);
    const combined = (fm.description || '') + (fm.when_to_use || '');
    if (combined.length > 1536) errors.push(`skills/${name}: description + when_to_use over 1536 characters`);
    for (const link of text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)) {
      const target = link[1].replace(/\$\{CLAUDE_SKILL_DIR\}\/?/, '').replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/?/, '');
      const base = link[1].includes('CLAUDE_PLUGIN_ROOT') ? pluginDir : skillDir;
      if (!existsSync(resolve(base, target))) warnings.push(`skills/${name}: link target missing: ${link[1]}`);
    }
  }
}

function validateAgents(pluginDir, errors) {
  const dir = join(pluginDir, 'agents');
  if (!existsSync(dir)) return;
  const models = new Set(['haiku', 'sonnet', 'opus', 'fable', 'inherit']);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const fm = frontmatter(readFileSync(join(dir, file), 'utf8'));
    const name = file.replace(/\.md$/, '');
    if (!fm) { errors.push(`agents/${file}: no frontmatter`); continue; }
    if (fm.name !== name) errors.push(`agents/${file}: frontmatter name "${fm.name}" must equal file name`);
    if (!fm.description) errors.push(`agents/${file}: description missing`);
    if (fm.model && !models.has(fm.model) && !/^claude-/.test(fm.model)) errors.push(`agents/${file}: unknown model ${fm.model}`);
    if (fm.name && fm.name.includes(':')) errors.push(`agents/${file}: name may not contain ":"`);
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
