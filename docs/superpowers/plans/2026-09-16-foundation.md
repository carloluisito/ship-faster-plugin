# ship-faster Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the installable `ship-faster` plugin skeleton: manifests, the shared Node libraries, the seven CLI scripts, the five hooks, tests, validator, benchmark, and CI. Plans 2 (Knowledge skills) and 3 (Shipping skills) consume exactly the interfaces defined here.

**Architecture:** A one-plugin marketplace repository. All logic is plain ESM Node under `plugins/ship-faster/scripts/`, split into small `lib/` modules (frontmatter, glob, git, config, state, wiki, cli) and thin CLI entry points. Hooks are CLI scripts that read the event JSON on stdin and follow the documented output contract per event. Tests build temporary git repositories and drive scripts as child processes.

**Tech Stack:** Node 20+ (ESM `.mjs`, `node:test`, `node:assert/strict`, `node:child_process`, `node:crypto`, `node:fs`), git CLI. Zero npm dependencies. GitHub Actions for CI.

**Spec:** `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` (sections 3, 5, 8, 9, 10, 11, 12 are implemented by this plan).

## Global Constraints

- Node 20 or newer; every script is ESM (`.mjs`) with `import` only. No `package.json` dependencies, no `node_modules`.
- Scripts print JSON when `--json` is passed and exit 0 whenever a JSON document was produced (`ok: true|false`, `error` when false). Without `--json`, print `summary` lines and exit 0 when ok, 1 otherwise. `lint` exits 1 on any lint error in both modes.
- Hooks always exit 0. They wrap the whole body in try/catch, print nothing on any error, and never call `process.exit` with a non-zero code.
- Hooks are registered as `node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-<name>.mjs"` with per-hook `timeout` in seconds: session-start 10, ship-guard 5, drift-marker 5, prompt-report 5, session-end 5.
- Hook output contracts: SessionStart and UserPromptSubmit print plain text to stdout; PreToolUse prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`; PostToolUse and SessionEnd print nothing.
- State only under the data directory: `process.env.CLAUDE_PLUGIN_DATA` when set and not containing `${`, else `$CLAUDE_CONFIG_DIR/plugins/data/ship-faster`, else `~/.claude/plugins/data/ship-faster`. Layout: `projects/<hash16>/{project.json, sessions/, wiki-cache.json, remote-head.json, health.json, preflight/, backup/}`. All JSON writes are atomic (temp file then rename).
- Every git invocation goes through `lib/git.mjs` with a timeout (default 2000 ms).
- Paths inside JSON output and wiki frontmatter always use `/` separators, relative to the repository root.
- Budgets: session-start under 1.5 s on a 30-page wiki; ship-guard makes no git call unless the command contains `git push` or `git add`; drift-marker under 150 ms median with no git call after the first per session; prompt-report under 100 ms median.
- Code comments: none that restate the code. Only non-obvious constraints get a one-line comment.
- Line endings LF (`.gitattributes` enforces). Commit messages: conventional (`feat:`, `test:`, `chore:`, `docs:`), stage files by name, never `git add -A`, end every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Test command from the repo root: `node plugins/ship-faster/tests/run.mjs` (all) or `node --test plugins/ship-faster/tests/<name>.test.mjs` (one file).

---

## File structure

```
.claude-plugin/marketplace.json            catalog, one entry → ./plugins/ship-faster
.gitattributes                             * text=auto eol=lf
LICENSE                                    MIT
README.md                                  install + pointer into the plugin
.github/workflows/ci.yml                   validate + tests, ubuntu/windows × node 20/22
plugins/ship-faster/
  .claude-plugin/plugin.json               plugin manifest
  hooks/hooks.json                         five hook registrations
  scripts/lib/cli.mjs                      parseArgs, readStdinJson, emit, runMain
  scripts/lib/fm.mjs                       frontmatter parse/serialize/update (YAML subset)
  scripts/lib/glob.mjs                     gitignore-style glob → RegExp
  scripts/lib/git.mjs                      git runner + helpers
  scripts/lib/config.mjs                   DEFAULTS + loadConfig
  scripts/lib/state.mjs                    data dir, project hash, atomic JSON, sessions
  scripts/lib/wiki.mjs                     page loading + wiki cache
  scripts/detect.mjs                       repository facts
  scripts/footprints.mjs                   co-change clusters
  scripts/stale.mjs                        page freshness
  scripts/index.mjs                        index.md generator
  scripts/lint.mjs                         wiki/CLAUDE.md/rules lint
  scripts/checks.mjs                       resolve + run checks
  scripts/plan.mjs                         plan find/stale/set-status
  scripts/hook-session-start.mjs
  scripts/hook-ship-guard.mjs
  scripts/hook-drift-marker.mjs
  scripts/hook-prompt-report.mjs
  scripts/hook-session-end.mjs
  tests/helpers.mjs                        temp repos, script runner
  tests/run.mjs                            runs every tests/*.test.mjs
  tests/validate.mjs                       plugin structure validator
  tests/bench.mjs                          hook latency benchmark
  tests/<module>.test.mjs                  one test file per module
  README.md  CHANGELOG.md
```

`evals/` and `.github/workflows/evals.yml` from the spec arrive with the skills in plan 3; there is
nothing to evaluate before a skill exists.

Interfaces are listed per task under **Interfaces**. Later tasks import exactly those names.

---

### Task 1: Repository scaffolding, manifests, test runner

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `.gitattributes`
- Create: `LICENSE`
- Create: `README.md`
- Create: `plugins/ship-faster/.claude-plugin/plugin.json`
- Create: `plugins/ship-faster/README.md`
- Create: `plugins/ship-faster/CHANGELOG.md`
- Create: `plugins/ship-faster/tests/run.mjs`
- Create: `plugins/ship-faster/tests/helpers.mjs`
- Create: `plugins/ship-faster/tests/validate.mjs`
- Test: `plugins/ship-faster/tests/validate.test.mjs`

**Interfaces:**
- Produces `tests/helpers.mjs`:
  - `PLUGIN_ROOT: string` absolute path of `plugins/ship-faster`
  - `SCRIPTS: string` absolute path of `plugins/ship-faster/scripts`
  - `tmpDir(prefix = 'sf-') → string` fresh directory under `os.tmpdir()`, registered for removal by `cleanupAll()`
  - `makeRepo({ files = {}, commits = [], branch = 'main' } = {}) → { root, git(args) }` where `files` is `{ 'rel/path': 'content' }` written before the first commit, `commits` is an array of `{ message, files }` applied in order (each writes its files then commits), `git(args: string[]) → string` returns trimmed stdout
  - `runScript(name, args = [], { cwd, stdin, env } = {}) → { code, stdout, stderr, json }` spawns `node scripts/<name>.mjs` synchronously; `json` is the parsed stdout when it parses, else `null`
  - `cleanupAll()` removes every temp dir; call from `after()` in each test file
- Produces `tests/validate.mjs` exporting `validate(repoRoot) → { errors: string[], warnings: string[] }` and running as a CLI (exit 1 on errors) when executed directly.

- [ ] **Step 1: Write the manifests and repo files**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "ship-faster",
  "owner": { "name": "carloluisito", "url": "https://github.com/carloluisito" },
  "description": "Repo-aware shipping for Claude Code: a router CLAUDE.md, a verified wiki, and preflight, ship, release, and health skills built on it.",
  "plugins": [
    {
      "name": "ship-faster",
      "source": "./plugins/ship-faster",
      "version": "0.1.0",
      "description": "Generates a router CLAUDE.md and a verified, freshness-tracked wiki for any repository, then ships with repo-aware preflight, review, PR, release, and maintenance skills.",
      "author": { "name": "carloluisito", "url": "https://github.com/carloluisito" },
      "keywords": ["claude-md", "docs", "wiki", "preflight", "ship", "release", "hooks", "skills"]
    }
  ]
}
```

`plugins/ship-faster/.claude-plugin/plugin.json`:

```json
{
  "name": "ship-faster",
  "version": "0.1.0",
  "description": "Generates a router CLAUDE.md and a verified, freshness-tracked wiki for any repository, then ships with repo-aware preflight, review, PR, release, and maintenance skills.",
  "author": { "name": "carloluisito", "url": "https://github.com/carloluisito" },
  "homepage": "https://github.com/carloluisito/ship-faster-plugin",
  "repository": "https://github.com/carloluisito/ship-faster-plugin",
  "license": "MIT",
  "keywords": ["claude-md", "docs", "wiki", "preflight", "ship", "release", "hooks", "skills"]
}
```

`.gitattributes`:

```
* text=auto eol=lf
```

`LICENSE`: the MIT license text with `Copyright (c) 2026 carloluisito`.

`README.md` (root):

```markdown
# ship-faster

A Claude Code plugin that makes an agent effective in any repository within one session and
keeps it effective as the repository changes. Design: `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md`.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

From a local checkout, add the marketplace by its absolute path instead of the GitHub slug.
Restart Claude Code after installing: hooks register at session start.

The plugin itself lives in [`plugins/ship-faster`](./plugins/ship-faster/README.md).

## Develop

```
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
claude plugin validate --strict plugins/ship-faster
```

## License

MIT
```

`plugins/ship-faster/README.md` starts as:

```markdown
# ship-faster

Router CLAUDE.md, verified wiki, and a repo-aware shipping workflow for Claude Code.

Sections on skills, hooks, stored data, and failure behaviour are added as each lands.
```

`plugins/ship-faster/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to this plugin are documented here. The format follows Keep a Changelog and
versions follow semver.

## [Unreleased]
```

- [ ] **Step 2: Write the test helpers**

`plugins/ship-faster/tests/helpers.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCRIPTS = join(PLUGIN_ROOT, 'scripts');

const created = [];

export function tmpDir(prefix = 'sf-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupAll() {
  for (const dir of created.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function makeRepo({ files = {}, commits = [], branch = 'main' } = {}) {
  const root = tmpDir('sf-repo-');
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: gitEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(['init', '-q', '-b', branch]);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  if (Object.keys(files).length) {
    writeFiles(root, files);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'initial']);
  }
  for (const c of commits) {
    writeFiles(root, c.files || {});
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', c.message]);
  }
  return { root, git };
}

function gitEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
}

export function runScript(name, args = [], { cwd, stdin, env } = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`), ...args], {
    cwd: cwd || process.cwd(),
    input: stdin === undefined ? undefined : (typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
```

Test fixtures use `git add -A` deliberately: the guard rule about `git add -A` applies to the agent's own shell, not to test setup.

- [ ] **Step 3: Write the test runner**

`plugins/ship-faster/tests/run.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(here, f));
if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

- [ ] **Step 4: Write the failing validator test**

`plugins/ship-faster/tests/validate.test.mjs`:

```js
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: FAIL, `Cannot find module './validate.mjs'`.

- [ ] **Step 6: Write the validator**

`plugins/ship-faster/tests/validate.mjs`:

```js
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node plugins/ship-faster/tests/run.mjs`
Expected: both tests PASS. Also run `node plugins/ship-faster/tests/validate.mjs` and expect `validate: ok`.

- [ ] **Step 8: Run the official validator**

Run: `claude plugin validate --strict plugins/ship-faster`
Expected: validation passed. If it reports an unrecognised manifest field, remove that field and re-run.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin/marketplace.json .gitattributes LICENSE README.md plugins/ship-faster/.claude-plugin/plugin.json plugins/ship-faster/README.md plugins/ship-faster/CHANGELOG.md plugins/ship-faster/tests/run.mjs plugins/ship-faster/tests/helpers.mjs plugins/ship-faster/tests/validate.mjs plugins/ship-faster/tests/validate.test.mjs
git commit -m "chore: scaffold ship-faster marketplace, plugin manifest, test runner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `lib/cli.mjs` argument parsing, stdin JSON, output contract

**Files:**
- Create: `plugins/ship-faster/scripts/lib/cli.mjs`
- Test: `plugins/ship-faster/tests/cli.test.mjs`

**Interfaces:**
- Produces:
  - `parseArgs(argv: string[]) → { _: string[], flags: Record<string, string | true | Array<string|true>> }`. Supports `--key value`, `--key=value`, bare `--flag` (true), repeated keys collect into an array, `--` ends flag parsing.
  - `flagList(flags, key) → string[]` normalises a flag to an array (missing → `[]`, single → `[value]`).
  - `readStdinJson(timeoutMs = 1500) → Promise<object | null>`; `null` on TTY, empty, timeout, or invalid JSON.
  - `emit(result, flags)`: with `flags.json` prints `JSON.stringify(result)` and sets `process.exitCode = 0`; otherwise prints `result.summary` (string or string[]) or `ok` / `error: <error>`, and sets exit code 0 when `result.ok !== false`, else 1.
  - `fail(error: string, flags, extra = {}) → void` calls `emit({ ok: false, error, ...extra }, flags)`.
  - `runMain(fn: (positional: string[], flags) => result | Promise<result>)`: parses `process.argv.slice(2)`, awaits `fn`, emits its return value; a thrown error becomes `{ ok: false, error }` through `emit`.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/cli.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCRIPTS } from './helpers.mjs';
import { parseArgs, flagList, emit } from '../scripts/lib/cli.mjs';

test('parseArgs handles values, equals, booleans, repeats, positionals and --', () => {
  const r = parseArgs(['run', '--json', '--root', '/x', '--changed=a', '--changed', 'b', '--', '--not-a-flag']);
  assert.deepEqual(r._, ['run', '--not-a-flag']);
  assert.equal(r.flags.json, true);
  assert.equal(r.flags.root, '/x');
  assert.deepEqual(r.flags.changed, ['a', 'b']);
  assert.deepEqual(flagList(r.flags, 'changed'), ['a', 'b']);
  assert.deepEqual(flagList(r.flags, 'root'), ['/x']);
  assert.deepEqual(flagList(r.flags, 'missing'), []);
});

test('emit prints JSON and exit 0 even when ok is false under --json', () => {
  const out = capture(() => emit({ ok: false, error: 'boom' }, { json: true }));
  assert.deepEqual(JSON.parse(out.text), { ok: false, error: 'boom' });
  assert.equal(out.exitCode, 0);
});

test('emit prints summary lines and exit 1 when ok is false without --json', () => {
  const ok = capture(() => emit({ ok: true, summary: ['a', 'b'] }, {}));
  assert.equal(ok.text, 'a\nb\n');
  assert.equal(ok.exitCode, 0);
  const bad = capture(() => emit({ ok: false, error: 'boom' }, {}));
  assert.equal(bad.text, 'error: boom\n');
  assert.equal(bad.exitCode, 1);
});

test('readStdinJson returns parsed input, and null for garbage or nothing', () => {
  const mod = pathToFileURL(join(SCRIPTS, 'lib', 'cli.mjs')).href;
  const script = `import { readStdinJson } from '${mod}'; const v = await readStdinJson(500); console.log(JSON.stringify(v));`;
  const run = (input) => spawnSync(process.execPath, ['--input-type=module', '-e', script], { input, encoding: 'utf8' }).stdout.trim();
  assert.equal(run('{"a":1}'), '{"a":1}');
  assert.equal(run('not json'), 'null');
  assert.equal(run(''), 'null');
});

function capture(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  const origCode = process.exitCode;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  const exitCode = process.exitCode;
  process.exitCode = origCode;
  return { text: chunks.join(''), exitCode };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/cli.test.mjs`
Expected: FAIL, cannot find `../scripts/lib/cli.mjs`.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/lib/cli.mjs`:

```js
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { setFlag(out.flags, a.slice(2, eq), a.slice(eq + 1)); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { setFlag(out.flags, key, next); i++; }
    else setFlag(out.flags, key, true);
  }
  return out;
}

function setFlag(flags, key, value) {
  flags[key] = key in flags ? [].concat(flags[key], value) : value;
}

export function flagList(flags, key) {
  if (!(key in flags)) return [];
  return [].concat(flags[key]).map(String);
}

export function readStdinJson(timeoutMs = 1500) {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(safeParse(data)), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => finish(safeParse(data)));
    process.stdin.on('error', () => finish(null));
  });
}

function safeParse(text) {
  if (!text || !text.trim()) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

export function emit(result, flags = {}) {
  const ok = result.ok !== false;
  if (flags.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = 0;
    return;
  }
  const lines = result.summary !== undefined ? [].concat(result.summary) : [ok ? 'ok' : `error: ${result.error}`];
  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = ok ? 0 : 1;
}

export function fail(error, flags = {}, extra = {}) {
  emit({ ok: false, error, ...extra }, flags);
}

export function runMain(fn) {
  const { _, flags } = parseArgs(process.argv.slice(2));
  Promise.resolve()
    .then(() => fn(_, flags))
    .then((result) => { if (result) emit(result, flags); })
    .catch((e) => fail(String((e && e.message) || e), flags));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/cli.test.mjs`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/lib/cli.mjs plugins/ship-faster/tests/cli.test.mjs
git commit -m "feat: cli helpers for argument parsing, stdin json, output contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `lib/fm.mjs` frontmatter parser and serializer

**Files:**
- Create: `plugins/ship-faster/scripts/lib/fm.mjs`
- Test: `plugins/ship-faster/tests/fm.test.mjs`

**Interfaces:**
- Produces:
  - `parseFrontmatter(text: string) → { data: object | null, body: string, raw: string | null, errors: Array<{ line: number, message: string }> }`. `data` is `null` when the text has no leading `---` block. `line` numbers are 1-based within the whole file. On a parse error, `data` still contains every key parsed successfully.
  - `serializeFrontmatter(data: object) → string` produces `---\n<yaml>\n---\n`, keys in insertion order.
  - `updateFrontmatter(text: string, patch: object) → string` merges `patch` into existing frontmatter (existing key order kept, new keys appended, a key whose patch value is `undefined` is removed) and returns the full file text with the body untouched. Text without frontmatter gets one prepended.
- Supported YAML subset: top-level `key: scalar`; `key: [a, "b c", 'd']`; block list of scalars; block list of flat maps (`- name: x` then indented `run: y`); `#` comment lines; blank lines. Scalars: double- or single-quoted strings, unquoted strings, integers, `true`/`false`, `null`. A `YYYY-MM-DD` value stays a string. Anything else is an error naming the line.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/fm.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter, updateFrontmatter } from '../scripts/lib/fm.mjs';

const PAGE = `---
title: Commands
summary: Verified dev, test, and build commands with durations.
read_when: You need to run, test, build, or debug the environment.
covers: ["package.json", ".github/workflows/**", 'scripts/**']
verified: 9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6
updated: 2026-09-16
# the checks preflight runs, in order
checks:
  - name: typecheck
    run: npx tsc --noEmit
    timeout: 300
  - name: test
    run: npm test
    timeout: 900
tags:
  - docs
  - "two words"
---
# Commands

Body text.
`;

test('parses scalars, inline lists, block lists, lists of maps, comments', () => {
  const { data, body, errors } = parseFrontmatter(PAGE);
  assert.deepEqual(errors, []);
  assert.equal(data.title, 'Commands');
  assert.equal(data.read_when, 'You need to run, test, build, or debug the environment.');
  assert.deepEqual(data.covers, ['package.json', '.github/workflows/**', 'scripts/**']);
  assert.equal(data.updated, '2026-09-16');
  assert.deepEqual(data.checks, [
    { name: 'typecheck', run: 'npx tsc --noEmit', timeout: 300 },
    { name: 'test', run: 'npm test', timeout: 900 },
  ]);
  assert.deepEqual(data.tags, ['docs', 'two words']);
  assert.equal(body, '# Commands\n\nBody text.\n');
});

test('handles CRLF input and text without frontmatter', () => {
  const crlf = parseFrontmatter('---\r\ntitle: X\r\n---\r\nbody\r\n');
  assert.equal(crlf.data.title, 'X');
  assert.equal(crlf.body, 'body\r\n');
  const none = parseFrontmatter('# Just a doc\n');
  assert.equal(none.data, null);
  assert.equal(none.body, '# Just a doc\n');
});

test('scalars: quotes, escapes, booleans, numbers, null, trailing comments', () => {
  const { data, errors } = parseFrontmatter(`---
a: "quoted: with colon"
b: 'single'
c: "esc \\" quote"
d: true
e: 42
f: null
g: plain value # trailing comment
h: -7
---
`);
  assert.deepEqual(errors, []);
  assert.deepEqual(data, { a: 'quoted: with colon', b: 'single', c: 'esc " quote', d: true, e: 42, f: null, g: 'plain value', h: -7 });
});

test('reports errors with line numbers and keeps the good keys', () => {
  const { data, errors } = parseFrontmatter(`---
title: ok
nested:
  child: value
---
`);
  assert.equal(data.title, 'ok');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 4);
  assert.match(errors[0].message, /nested map/);
});

test('serialize then parse round-trips and quotes only when needed', () => {
  const data = {
    title: 'Commands: verified',
    covers: ['package.json', 'a b', 'c,d'],
    verified: 'abc123',
    n: 3,
    flag: false,
    checks: [{ name: 'test', run: 'npm test', timeout: 900 }],
  };
  const text = serializeFrontmatter(data);
  assert.match(text, /^---\n/);
  assert.match(text, /\ntitle: "Commands: verified"\n/);
  assert.match(text, /\ncovers: \[package\.json, "a b", "c,d"\]\n/);
  assert.match(text, /\nchecks:\n  - name: test\n    run: npm test\n    timeout: 900\n/);
  assert.deepEqual(parseFrontmatter(text + 'body').data, data);
});

test('updateFrontmatter keeps order and body, appends new keys, removes undefined', () => {
  const out = updateFrontmatter(PAGE, { verified: 'newsha', updated: '2026-10-01', tags: undefined, extra: 'x' });
  const { data, body } = parseFrontmatter(out);
  assert.deepEqual(Object.keys(data), ['title', 'summary', 'read_when', 'covers', 'verified', 'updated', 'checks', 'extra']);
  assert.equal(data.verified, 'newsha');
  assert.equal(data.extra, 'x');
  assert.equal(body, '# Commands\n\nBody text.\n');
  const fresh = updateFrontmatter('just body\n', { title: 'T' });
  assert.equal(fresh, '---\ntitle: T\n---\njust body\n');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/fm.test.mjs`
Expected: FAIL, cannot find `../scripts/lib/fm.mjs`.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/lib/fm.mjs`:

```js
const OPEN = /^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/;

export function parseFrontmatter(text) {
  const m = OPEN.exec(text);
  if (!m) return { data: null, body: text, raw: null, errors: [] };
  const raw = m[1];
  const body = text.slice(m[0].length);
  const lines = raw.split(/\r?\n/);
  const data = {};
  const errors = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNo = i + 2;
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) { errors.push({ line: lineNo, message: `expected "key: value", got "${line}"` }); i++; continue; }
    const key = kv[1];
    const rest = (kv[2] || '').trim();
    if (rest === '') {
      const block = parseBlock(lines, i + 1, lineNo + 1, errors);
      if (block.value !== undefined) data[key] = block.value;
      i = block.next;
      continue;
    }
    if (rest.startsWith('[')) {
      const list = parseInlineList(rest, lineNo, errors);
      if (list !== undefined) data[key] = list;
    } else {
      data[key] = parseScalar(rest);
    }
    i++;
  }
  return { data, body, raw, errors };
}

function parseBlock(lines, start, startLineNo, errors) {
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || !/^\s+/.test(lines[i])) {
    return { value: null, next: i };
  }
  const first = lines[i];
  if (!/^\s+-\s/.test(first) && !/^\s+-$/.test(first)) {
    errors.push({ line: startLineNo + (i - start), message: 'nested map is not supported; use a block list or an inline list' });
    while (i < lines.length && /^\s+/.test(lines[i])) i++;
    return { value: undefined, next: i };
  }
  const indent = first.match(/^\s*/)[0].length;
  const items = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const lead = line.match(/^\s*/)[0].length;
    if (lead < indent) break;
    if (lead === indent && /^\s*-(\s|$)/.test(line)) {
      const rest = line.slice(indent + 1).trim();
      const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(rest);
      if (kv) {
        const obj = {};
        obj[kv[1]] = parseScalar((kv[2] || '').trim());
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) { i++; continue; }
          const ll = l.match(/^\s*/)[0].length;
          if (ll <= indent) break;
          const kv2 = /^\s+([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(l);
          if (!kv2) { errors.push({ line: startLineNo + (i - start), message: `expected "key: value" inside list item, got "${l.trim()}"` }); i++; continue; }
          obj[kv2[1]] = parseScalar((kv2[2] || '').trim());
          i++;
        }
        items.push(obj);
        continue;
      }
      items.push(parseScalar(rest));
      i++;
      continue;
    }
    errors.push({ line: startLineNo + (i - start), message: `unexpected line in block list: "${line.trim()}"` });
    i++;
  }
  const kinds = new Set(items.map((x) => (x && typeof x === 'object' ? 'map' : 'scalar')));
  if (kinds.size > 1) errors.push({ line: startLineNo, message: 'block list mixes scalars and maps' });
  return { value: items, next: i };
}

function parseInlineList(rest, lineNo, errors) {
  const close = rest.lastIndexOf(']');
  if (close === -1) { errors.push({ line: lineNo, message: 'inline list is missing "]"' }); return undefined; }
  const inner = rest.slice(1, close);
  const items = [];
  let cur = '';
  let quote = null;
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && k + 1 < inner.length) { cur += inner[++k]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || items.length) items.push(cur);
  return items.map((s) => s.trim()).filter((s) => s !== '').map((s) => parseScalar(s));
}

function parseScalar(raw) {
  let s = raw;
  if (s.startsWith('"')) {
    const end = s.lastIndexOf('"');
    return s.slice(1, end).replace(/\\(["\\])/g, '$1');
  }
  if (s.startsWith("'")) {
    const end = s.lastIndexOf("'");
    return s.slice(1, end).replace(/''/g, "'");
  }
  const hash = s.indexOf(' #');
  if (hash !== -1) s = s.slice(0, hash).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

const NEEDS_QUOTES = /[:#,\[\]{}"'\\]|^\s|\s$|^$|^-?\d+$|^(true|false|null|~)$/;

function scalarToYaml(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

export function serializeFrontmatter(data) {
  const out = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length && value.every((x) => x && typeof x === 'object')) {
        out.push(`${key}:`);
        for (const item of value) {
          const entries = Object.entries(item).filter(([, v]) => v !== undefined);
          entries.forEach(([k, v], idx) => out.push(`${idx === 0 ? '  - ' : '    '}${k}: ${scalarToYaml(v)}`));
        }
      } else {
        out.push(`${key}: [${value.map(scalarToYaml).join(', ')}]`);
      }
      continue;
    }
    out.push(`${key}: ${scalarToYaml(value)}`);
  }
  out.push('---');
  return out.join('\n') + '\n';
}

export function updateFrontmatter(text, patch) {
  const parsed = parseFrontmatter(text);
  const merged = {};
  for (const [k, v] of Object.entries(parsed.data || {})) {
    if (k in patch) { if (patch[k] !== undefined) merged[k] = patch[k]; }
    else merged[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in merged) && v !== undefined && !(parsed.data && k in parsed.data)) merged[k] = v;
  }
  return serializeFrontmatter(merged) + parsed.body;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/fm.test.mjs`
Expected: 6 tests PASS. If the round-trip test fails on `covers`, check that `NEEDS_QUOTES` quotes `a b` and `c,d` but not `package.json`.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/lib/fm.mjs plugins/ship-faster/tests/fm.test.mjs
git commit -m "feat: frontmatter parser and serializer for the wiki yaml subset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `lib/glob.mjs` gitignore-style glob matcher

**Files:**
- Create: `plugins/ship-faster/scripts/lib/glob.mjs`
- Test: `plugins/ship-faster/tests/glob.test.mjs`

**Interfaces:**
- Produces:
  - `normalizePath(p: string) → string`: backslashes to `/`, strips a leading `./`, collapses duplicate slashes.
  - `compileGlob(pattern: string) → RegExp` (cached per pattern).
  - `matchGlob(pattern: string, path: string) → boolean`.
  - `anyMatch(patterns: string[], path: string) → boolean`.
  - `filterPaths(patterns: string[], paths: string[]) → string[]` (paths matching any pattern, order preserved).
- Semantics: a pattern with no `/` matches its basename at any depth; a leading `/` or any inner `/` anchors the pattern to the repository root; a trailing `/` means "anything under a directory with this name"; `**` matches across directories, `*` and `?` never cross `/`; `{a,b}` is alternation (one level, no nesting).

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/glob.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, matchGlob, anyMatch, filterPaths } from '../scripts/lib/glob.mjs';

const TABLE = [
  ['*.md', 'README.md', true],
  ['*.md', 'docs/a.md', true],
  ['/README.md', 'docs/README.md', false],
  ['/README.md', 'README.md', true],
  ['README*', 'README.md', true],
  ['package.json', 'packages/a/package.json', true],
  ['src/**', 'src/a/b.ts', true],
  ['src/**', 'src/a.ts', true],
  ['src/**', 'lib/a.ts', false],
  ['src/**', 'src', false],
  ['**/*.test.mjs', 'a/b/c.test.mjs', true],
  ['**/*.test.mjs', 'c.test.mjs', true],
  ['src/**/*.{ts,tsx}', 'src/x/y.tsx', true],
  ['src/**/*.{ts,tsx}', 'src/y.ts', true],
  ['src/**/*.{ts,tsx}', 'src/y.js', false],
  ['docs/', 'docs/a/b.md', true],
  ['docs/', 'x/docs/a.md', true],
  ['docs/', 'docsx/a.md', false],
  ['.github/workflows/**', '.github/workflows/ci.yml', true],
  ['?.md', 'a.md', true],
  ['?.md', 'ab.md', false],
  ['a/*', 'a/b', true],
  ['a/*', 'a/b/c', false],
  ['a/**/b', 'a/b', true],
  ['a/**/b', 'a/x/y/b', true],
  ['*.log', 'logs/x.log', true],
  ['file.with.dots', 'file.with.dots', true],
  ['file.with.dots', 'filexwithxdots', false],
];

test('glob table', () => {
  for (const [pattern, path, expected] of TABLE) {
    assert.equal(matchGlob(pattern, path), expected, `${pattern} vs ${path}`);
  }
});

test('normalizePath handles windows separators and ./ prefixes', () => {
  assert.equal(normalizePath('.\\src\\a.ts'), 'src/a.ts');
  assert.equal(normalizePath('./a//b/c.md'), 'a/b/c.md');
  assert.equal(matchGlob('src/**', 'src\\x\\y.ts'), true);
});

test('anyMatch and filterPaths', () => {
  assert.equal(anyMatch(['docs/**', '*.json'], 'package.json'), true);
  assert.equal(anyMatch(['docs/**', '*.json'], 'src/a.ts'), false);
  assert.deepEqual(filterPaths(['src/**'], ['src/a.ts', 'README.md', 'src/b/c.ts']), ['src/a.ts', 'src/b/c.ts']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/glob.test.mjs`
Expected: FAIL, cannot find `../scripts/lib/glob.mjs`.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/lib/glob.mjs`:

```js
const cache = new Map();

export function normalizePath(p) {
  let s = String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

export function compileGlob(pattern) {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let pat = normalizePath(pattern.trim());
  let dirOnly = false;
  if (pat.endsWith('/')) { dirOnly = true; pat = pat.slice(0, -1); }
  let anchored = false;
  if (pat.startsWith('/')) { anchored = true; pat = pat.slice(1); }
  if (pat.includes('/')) anchored = true;
  const body = globToRegexSource(pat);
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = dirOnly ? '/.+$' : '$';
  const re = new RegExp(prefix + body + suffix);
  cache.set(pattern, re);
  return re;
}

function globToRegexSource(pat) {
  let out = '';
  let i = 0;
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === '*') {
      if (pat[i + 1] === '*') {
        const before = i === 0 || pat[i - 1] === '/';
        const after = i + 2 >= pat.length || pat[i + 2] === '/';
        if (before && after) {
          if (i + 2 >= pat.length) { out += '.*'; i += 2; continue; }
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i++;
      continue;
    }
    if (ch === '?') { out += '[^/]'; i++; continue; }
    if (ch === '{') {
      const close = pat.indexOf('}', i);
      if (close !== -1) {
        const alts = pat.slice(i + 1, close).split(',').map((a) => globToRegexSource(a));
        out += `(?:${alts.join('|')})`;
        i = close + 1;
        continue;
      }
    }
    out += /[.+^$()|[\]\\{}]/.test(ch) ? `\\${ch}` : ch;
    i++;
  }
  return out;
}

export function matchGlob(pattern, path) {
  return compileGlob(pattern).test(normalizePath(path));
}

export function anyMatch(patterns, path) {
  const p = normalizePath(path);
  return (patterns || []).some((g) => compileGlob(g).test(p));
}

export function filterPaths(patterns, paths) {
  return paths.filter((p) => anyMatch(patterns, p));
}
```

Note on `src/**`: the trailing `**` becomes `.*` after the literal `src/`, so `src/a.ts` matches and bare `src` does not, which is what `covers` needs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/glob.test.mjs`
Expected: 3 tests PASS. If `a/**/b` vs `a/b` fails, the `(?:.*/)?` branch for an inner `**/` is wrong.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/lib/glob.mjs plugins/ship-faster/tests/glob.test.mjs
git commit -m "feat: gitignore-style glob matcher for covers and rules paths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `lib/git.mjs` git runner and helpers

**Files:**
- Create: `plugins/ship-faster/scripts/lib/git.mjs`
- Test: `plugins/ship-faster/tests/git.test.mjs`

**Interfaces:**
- Produces (all synchronous, all take `cwd` and never throw):
  - `git(args: string[], { cwd, timeoutMs = 2000 } = {}) → { ok: boolean, stdout: string, stderr: string, code: number | null }`; `ok` is false on non-zero exit, timeout, or a missing `git` binary.
  - `isRepo(cwd) → boolean`
  - `repoRoot(cwd) → string | null` with `/` separators
  - `head(cwd) → string | null` (40-hex, null when there are no commits)
  - `commitExists(cwd, sha) → boolean`
  - `currentBranch(cwd) → string | null` (null when detached)
  - `defaultBranch(cwd) → string | null`: `refs/remotes/origin/HEAD` target, else `main` if that branch exists, else `master`, else null. No network.
  - `changedSince(cwd, sha) → string[] | null` (`git diff --name-only <sha> HEAD`, null on failure)
  - `dirtyFiles(cwd) → Array<{ path: string, status: string }>` from `git status --porcelain=v1 -z --untracked-files=all`; renames report the new path.
  - `trackedFiles(cwd) → string[]`
  - `log(cwd, { n = 500 } = {}) → Array<{ sha: string, subject: string, files: string[] }>` newest first.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/git.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, tmpDir, cleanupAll } from './helpers.mjs';
import * as g from '../scripts/lib/git.mjs';

after(cleanupAll);

const norm = (p) => realpathSync(p).replace(/\\/g, '/').toLowerCase();

test('isRepo, repoRoot, head, commitExists, currentBranch, defaultBranch', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  assert.equal(g.isRepo(root), true);
  assert.equal(g.isRepo(tmpDir()), false);
  assert.equal(norm(g.repoRoot(join(root))), norm(root));
  const sha = g.head(root);
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(g.commitExists(root, sha), true);
  assert.equal(g.commitExists(root, 'deadbeef'), false);
  assert.equal(g.currentBranch(root), 'main');
  assert.equal(g.defaultBranch(root), 'main');
  git(['checkout', '-q', sha]);
  assert.equal(g.currentBranch(root), null);
});

test('changedSince, dirtyFiles, trackedFiles, log', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n', 'src/b.ts': 'b\n' } });
  const first = g.head(root);
  writeFileSync(join(root, 'src', 'b.ts'), 'b2\n');
  writeFileSync(join(root, 'c.md'), 'c\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: change b and add c']);
  assert.deepEqual(g.changedSince(root, first).sort(), ['c.md', 'src/b.ts']);
  assert.equal(g.changedSince(root, 'deadbeef'), null);
  writeFileSync(join(root, 'a.txt'), 'a2\n');
  writeFileSync(join(root, 'new.txt'), 'n\n');
  const dirty = g.dirtyFiles(root).map((d) => d.path).sort();
  assert.deepEqual(dirty, ['a.txt', 'new.txt']);
  assert.deepEqual(g.trackedFiles(root).sort(), ['a.txt', 'c.md', 'src/b.ts']);
  const log = g.log(root, { n: 10 });
  assert.equal(log.length, 2);
  assert.equal(log[0].subject, 'feat: change b and add c');
  assert.deepEqual(log[0].files.sort(), ['c.md', 'src/b.ts']);
  assert.deepEqual(log[1].files.sort(), ['a.txt', 'src/b.ts']);
});

test('git() reports failure without throwing', () => {
  const r = g.git(['rev-parse', 'HEAD'], { cwd: tmpDir() });
  assert.equal(r.ok, false);
  assert.equal(g.head(tmpDir()), null);
  assert.equal(g.defaultBranch(tmpDir()), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/git.test.mjs`
Expected: FAIL, cannot find `../scripts/lib/git.mjs`.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/lib/git.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { normalizePath } from './glob.mjs';

export function git(args, { cwd, timeoutMs = 2000 } = {}) {
  try {
    const r = spawnSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      windowsHide: true,
    });
    if (r.error) return { ok: false, stdout: '', stderr: String(r.error.message || r.error), code: null };
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '', code: r.status };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String((e && e.message) || e), code: null };
  }
}

function out(args, cwd, timeoutMs) {
  const r = git(args, { cwd, timeoutMs });
  return r.ok ? r.stdout.trim() : null;
}

export function isRepo(cwd) {
  return out(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

export function repoRoot(cwd) {
  const v = out(['rev-parse', '--show-toplevel'], cwd);
  return v ? normalizePath(v) : null;
}

export function head(cwd) {
  const v = out(['rev-parse', '--verify', '-q', 'HEAD'], cwd);
  return v && /^[0-9a-f]{40}$/.test(v) ? v : null;
}

export function commitExists(cwd, sha) {
  if (!sha || !/^[0-9a-f]{4,40}$/i.test(sha)) return false;
  return git(['cat-file', '-e', `${sha}^{commit}`], { cwd }).ok;
}

export function currentBranch(cwd) {
  const v = out(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return v && v !== 'HEAD' ? v : null;
}

function branchExists(cwd, name) {
  return git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd }).ok;
}

export function defaultBranch(cwd) {
  const ref = out(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], cwd);
  if (ref) return ref.replace(/^refs\/remotes\/origin\//, '');
  if (!isRepo(cwd)) return null;
  if (branchExists(cwd, 'main')) return 'main';
  if (branchExists(cwd, 'master')) return 'master';
  return null;
}

function splitZ(s) {
  return s.split('\0').filter((x) => x.length > 0);
}

export function changedSince(cwd, sha) {
  if (!commitExists(cwd, sha)) return null;
  const r = git(['diff', '--name-only', '-z', sha, 'HEAD'], { cwd, timeoutMs: 5000 });
  if (!r.ok) return null;
  return splitZ(r.stdout).map(normalizePath);
}

export function dirtyFiles(cwd) {
  const r = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, timeoutMs: 5000 });
  if (!r.ok) return [];
  const parts = splitZ(r.stdout);
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status[0] === 'R' || status[0] === 'C') i++;
    result.push({ path: normalizePath(path), status: status.trim() || '??' });
  }
  return result;
}

export function trackedFiles(cwd) {
  const r = git(['ls-files', '-z'], { cwd, timeoutMs: 5000 });
  return r.ok ? splitZ(r.stdout).map(normalizePath) : [];
}

export function log(cwd, { n = 500 } = {}) {
  const r = git(['log', `-n${n}`, '--no-merges', '--pretty=format:__C__%H%x1f%s', '--name-only'], { cwd, timeoutMs: 10000 });
  if (!r.ok) return [];
  const commits = [];
  let cur = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('__C__')) {
      const [sha, subject] = line.slice(5).split('\x1f');
      cur = { sha, subject: subject || '', files: [] };
      commits.push(cur);
    } else if (cur && line.trim()) {
      cur.files.push(normalizePath(line.trim()));
    }
  }
  return commits;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/git.test.mjs`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/lib/git.mjs plugins/ship-faster/tests/git.test.mjs
git commit -m "feat: git helpers with timeouts for repo facts, diffs, status, log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `lib/config.mjs` and `lib/state.mjs`

**Files:**
- Create: `plugins/ship-faster/scripts/lib/config.mjs`
- Create: `plugins/ship-faster/scripts/lib/state.mjs`
- Test: `plugins/ship-faster/tests/config.test.mjs`
- Test: `plugins/ship-faster/tests/state.test.mjs`

**Interfaces:**
- `config.mjs` produces:
  - `DEFAULTS` (frozen): `{ wikiDir: 'docs/wiki', plansDir: 'docs/plans', rulesDir: '.claude/rules', defaultBranch: 'auto', protectedBranches: ['main', 'master'], guard: { forcePush: 'deny', pushProtected: 'deny', noVerify: 'deny', addAll: 'deny' }, healthCadenceDays: 14, pageMaxLines: 200, claudeMdMaxLines: 150, rulesFileMaxLines: 25, checkTimeoutSeconds: 600 }`
  - `loadConfig(root: string) → { config, errors: string[], file: string | null }`: reads `<root>/.claude/ship-faster.json` when present, merges over `DEFAULTS` (guard merged per key), validates types (guard values in `deny|ask|allow`, numeric fields positive integers, `protectedBranches` an array of strings, directory fields non-empty strings without `..`). Invalid values are reported in `errors` and the default is kept. Invalid JSON → one error, all defaults.
- `state.mjs` produces:
  - `dataDir() → string`
  - `projectHash(root: string) → string` 16 hex chars, SHA-256 of the normalized root (lower-cased on win32)
  - `projectDir(root) → string` created on demand, with `project.json` `{ root, createdAt }` written once
  - `readJson(file, fallback = null) → any`
  - `writeJsonAtomic(file, value) → void`
  - `sessionFile(root, sid) → string`, `loadSession(root, sid) → object`, `saveSession(root, sid, data) → void`
  - `pruneSessions(root, { maxAgeDays = 7, deadlineMs = 1000 } = {}) → { removed: number }`
  - `preflightDir(root) → string`, `backupDir(root) → string` (both created on demand)

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/config.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS, loadConfig } from '../scripts/lib/config.mjs';

after(cleanupAll);

function withConfig(json) {
  const root = tmpDir();
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'ship-faster.json'), json);
  return root;
}

test('defaults when no file', () => {
  const { config, errors, file } = loadConfig(tmpDir());
  assert.deepEqual(config, DEFAULTS);
  assert.deepEqual(errors, []);
  assert.equal(file, null);
});

test('merges valid overrides, including a partial guard', () => {
  const root = withConfig(JSON.stringify({ wikiDir: 'wiki', guard: { addAll: 'allow' }, protectedBranches: ['main', 'release'] }));
  const { config, errors } = loadConfig(root);
  assert.deepEqual(errors, []);
  assert.equal(config.wikiDir, 'wiki');
  assert.equal(config.guard.addAll, 'allow');
  assert.equal(config.guard.forcePush, 'deny');
  assert.deepEqual(config.protectedBranches, ['main', 'release']);
  assert.equal(config.pageMaxLines, 200);
});

test('reports invalid values and keeps defaults for them', () => {
  const root = withConfig(JSON.stringify({ guard: { noVerify: 'maybe' }, pageMaxLines: -5, wikiDir: '../x', protectedBranches: 'main' }));
  const { config, errors } = loadConfig(root);
  assert.equal(config.guard.noVerify, 'deny');
  assert.equal(config.pageMaxLines, 200);
  assert.equal(config.wikiDir, 'docs/wiki');
  assert.deepEqual(config.protectedBranches, ['main', 'master']);
  assert.equal(errors.length, 4);
});

test('invalid json yields one error and defaults', () => {
  const { config, errors } = loadConfig(withConfig('{ not json'));
  assert.deepEqual(config, DEFAULTS);
  assert.equal(errors.length, 1);
});
```

`plugins/ship-faster/tests/state.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, cleanupAll } from './helpers.mjs';
import * as s from '../scripts/lib/state.mjs';

after(cleanupAll);
let data;
beforeEach(() => { data = tmpDir('sf-data-'); process.env.CLAUDE_PLUGIN_DATA = data; });

test('dataDir prefers CLAUDE_PLUGIN_DATA, ignores an unexpanded placeholder, falls back to the config dir', () => {
  assert.equal(s.dataDir(), data);
  process.env.CLAUDE_PLUGIN_DATA = '${CLAUDE_PLUGIN_DATA}';
  process.env.CLAUDE_CONFIG_DIR = join(data, 'cfg');
  assert.equal(s.dataDir(), join(data, 'cfg', 'plugins', 'data', 'ship-faster'));
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.match(s.dataDir().replace(/\\/g, '/'), /\/\.claude\/plugins\/data\/ship-faster$/);
});

test('projectHash is stable, 16 hex, and distinct per root', () => {
  const a = s.projectHash('/tmp/one');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, s.projectHash('/tmp/one'));
  assert.notEqual(a, s.projectHash('/tmp/two'));
});

test('projectDir writes project.json once; json helpers round-trip and tolerate corruption', () => {
  const root = tmpDir();
  const dir = s.projectDir(root);
  assert.ok(existsSync(join(dir, 'project.json')));
  const meta = s.readJson(join(dir, 'project.json'));
  assert.equal(meta.root.replace(/\\/g, '/'), root.replace(/\\/g, '/'));
  const f = join(dir, 'x.json');
  s.writeJsonAtomic(f, { a: 1 });
  assert.deepEqual(s.readJson(f), { a: 1 });
  writeFileSync(f, '{ corrupt');
  assert.deepEqual(s.readJson(f, { fallback: true }), { fallback: true });
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
});

test('sessions save, load, sanitize ids, and prune by age within a deadline', () => {
  const root = tmpDir();
  s.saveSession(root, 'abc-123', { pages: { 'a.md': { files: ['x'], reported: false } } });
  assert.deepEqual(s.loadSession(root, 'abc-123').pages['a.md'].files, ['x']);
  assert.deepEqual(s.loadSession(root, 'missing'), {});
  assert.match(s.sessionFile(root, '../evil/../id'), /sessions[\\/][A-Za-z0-9_-]+\.json$/);
  const old = s.sessionFile(root, 'old');
  s.saveSession(root, 'old', {});
  const past = new Date(Date.now() - 10 * 86400_000);
  utimesSync(old, past, past);
  const { removed } = s.pruneSessions(root, { maxAgeDays: 7 });
  assert.equal(removed, 1);
  assert.ok(!existsSync(old));
  assert.ok(existsSync(s.sessionFile(root, 'abc-123')));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/config.test.mjs plugins/ship-faster/tests/state.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `config.mjs`**

```js
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  wikiDir: 'docs/wiki',
  plansDir: 'docs/plans',
  rulesDir: '.claude/rules',
  defaultBranch: 'auto',
  protectedBranches: ['main', 'master'],
  guard: Object.freeze({ forcePush: 'deny', pushProtected: 'deny', noVerify: 'deny', addAll: 'deny' }),
  healthCadenceDays: 14,
  pageMaxLines: 200,
  claudeMdMaxLines: 150,
  rulesFileMaxLines: 25,
  checkTimeoutSeconds: 600,
});

const DIR_KEYS = ['wikiDir', 'plansDir', 'rulesDir'];
const INT_KEYS = ['healthCadenceDays', 'pageMaxLines', 'claudeMdMaxLines', 'rulesFileMaxLines', 'checkTimeoutSeconds'];
const GUARD_VALUES = new Set(['deny', 'ask', 'allow']);

export function loadConfig(root) {
  const file = join(root, '.claude', 'ship-faster.json');
  const config = { ...DEFAULTS, protectedBranches: [...DEFAULTS.protectedBranches], guard: { ...DEFAULTS.guard } };
  const errors = [];
  if (!existsSync(file)) return { config, errors, file: null };
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { config, errors: [`invalid JSON in ${file}: ${e.message}`], file }; }
  if (!raw || typeof raw !== 'object') return { config, errors: ['config must be a JSON object'], file };

  for (const key of DIR_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (typeof v === 'string' && v.trim() && !v.split(/[\\/]/).includes('..')) config[key] = v.replace(/\\/g, '/').replace(/\/+$/, '');
    else errors.push(`${key} must be a relative directory without "..", got ${JSON.stringify(v)}`);
  }
  for (const key of INT_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (Number.isInteger(v) && v > 0) config[key] = v;
    else errors.push(`${key} must be a positive integer, got ${JSON.stringify(v)}`);
  }
  if ('defaultBranch' in raw) {
    if (typeof raw.defaultBranch === 'string' && raw.defaultBranch.trim()) config.defaultBranch = raw.defaultBranch.trim();
    else errors.push('defaultBranch must be a non-empty string');
  }
  if ('protectedBranches' in raw) {
    const v = raw.protectedBranches;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim())) config.protectedBranches = v.map((x) => x.trim());
    else errors.push('protectedBranches must be an array of branch names');
  }
  if ('guard' in raw) {
    if (raw.guard && typeof raw.guard === 'object') {
      for (const [k, v] of Object.entries(raw.guard)) {
        if (!(k in DEFAULTS.guard)) { errors.push(`guard.${k} is not a known rule`); continue; }
        if (GUARD_VALUES.has(v)) config.guard[k] = v;
        else errors.push(`guard.${k} must be deny, ask, or allow, got ${JSON.stringify(v)}`);
      }
    } else errors.push('guard must be an object');
  }
  return { config, errors, file };
}
```

- [ ] **Step 4: Write `state.mjs`**

```js
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { normalizePath } from './glob.mjs';

export function dataDir() {
  const env = process.env.CLAUDE_PLUGIN_DATA;
  if (env && env.trim() && !env.includes('${')) return env;
  const cfg = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()
    ? process.env.CLAUDE_CONFIG_DIR
    : join(homedir(), '.claude');
  return join(cfg, 'plugins', 'data', 'ship-faster');
}

export function projectHash(root) {
  let key = normalizePath(root).replace(/\/+$/, '');
  if (process.platform === 'win32') key = key.toLowerCase();
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function projectDir(root) {
  const dir = join(dataDir(), 'projects', projectHash(root));
  mkdirSync(dir, { recursive: true });
  const meta = join(dir, 'project.json');
  if (!existsSync(meta)) writeJsonAtomic(meta, { root: normalizePath(root), createdAt: new Date().toISOString() });
  return dir;
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  try {
    renameSync(tmp, file);
  } catch {
    // Windows refuses to rename over a file another process has open; replace it explicitly once.
    try { unlinkSync(file); } catch {}
    try { renameSync(tmp, file); } catch { try { unlinkSync(tmp); } catch {} }
  }
}

function safeId(sid) {
  const clean = String(sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return clean || 'default';
}

export function sessionFile(root, sid) {
  return join(projectDir(root), 'sessions', `${safeId(sid)}.json`);
}

export function loadSession(root, sid) {
  const v = readJson(sessionFile(root, sid), {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function saveSession(root, sid, data) {
  writeJsonAtomic(sessionFile(root, sid), data);
}

export function pruneSessions(root, { maxAgeDays = 7, deadlineMs = 1000 } = {}) {
  const dir = join(projectDir(root), 'sessions');
  const started = Date.now();
  const cutoff = started - maxAgeDays * 86400_000;
  let removed = 0;
  if (!existsSync(dir)) return { removed };
  for (const name of readdirSync(dir)) {
    if (Date.now() - started > deadlineMs) break;
    const file = join(dir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) { rmSync(file, { force: true }); removed++; }
    } catch {}
  }
  return { removed };
}

export function preflightDir(root) {
  const dir = join(projectDir(root), 'preflight');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function backupDir(root) {
  const dir = join(projectDir(root), 'backup');
  mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/config.test.mjs plugins/ship-faster/tests/state.test.mjs`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/lib/config.mjs plugins/ship-faster/scripts/lib/state.mjs plugins/ship-faster/tests/config.test.mjs plugins/ship-faster/tests/state.test.mjs
git commit -m "feat: config loading with validation and atomic plugin state storage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `lib/wiki.mjs` page loading and wiki cache

**Files:**
- Create: `plugins/ship-faster/scripts/lib/wiki.mjs`
- Test: `plugins/ship-faster/tests/wiki.test.mjs`

**Interfaces:**
- Consumes: `parseFrontmatter` (Task 3), `normalizePath` (Task 4), `projectDir`, `readJson`, `writeJsonAtomic` (Task 6), `loadConfig` (Task 6).
- Produces:
  - `REQUIRED_FIELDS = ['title', 'summary', 'read_when', 'covers', 'verified', 'updated']`
  - `wikiDir(root, config) → string` absolute
  - `relPath(root, file) → string` repository-relative with `/`
  - `listPages(root, config) → string[]` absolute paths of every `.md` under the wiki dir, recursive, sorted, excluding `index.md` at the wiki root
  - `loadPage(root, file) → { file, rel, data, body, errors, lines }` where `lines` is the total line count of the file and `errors` are frontmatter errors
  - `loadWiki(root, config) → { dir, exists, pages: Page[] }`
  - `loadWikiCache(root, config) → { builtAt, pages: Array<{ rel, file, mtimeMs, title, covers, verified }> }`: reads `<projectDir>/wiki-cache.json`; if the page list or any `mtimeMs` differs from disk, rebuilds from `loadWiki` and rewrites the cache. Pages with no frontmatter are cached with `covers: []`.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/wiki.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { projectDir } from '../scripts/lib/state.mjs';
import { listPages, loadPage, loadWiki, loadWikiCache, relPath, wikiDir } from '../scripts/lib/wiki.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

function page(title, covers) {
  return `---\ntitle: ${title}\nsummary: s\nread_when: r\ncovers: [${covers.map((c) => `"${c}"`).join(', ')}]\nverified: abc\nupdated: 2026-09-16\n---\n# ${title}\n`;
}

function makeWiki() {
  const root = tmpDir();
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  writeFileSync(join(w, 'index.md'), '# index\n');
  writeFileSync(join(w, 'a.md'), page('A', ['src/**']));
  writeFileSync(join(w, 'recipes', 'b.md'), page('B', ['package.json']));
  writeFileSync(join(w, 'nofm.md'), '# no frontmatter\n');
  return { root, w };
}

test('listPages excludes index.md, is sorted, and recurses', () => {
  const { root, w } = makeWiki();
  assert.equal(wikiDir(root, DEFAULTS), w);
  const rels = listPages(root, DEFAULTS).map((f) => relPath(root, f));
  assert.deepEqual(rels, ['docs/wiki/a.md', 'docs/wiki/nofm.md', 'docs/wiki/recipes/b.md']);
});

test('loadPage and loadWiki parse frontmatter and count lines', () => {
  const { root, w } = makeWiki();
  const p = loadPage(root, join(w, 'a.md'));
  assert.equal(p.rel, 'docs/wiki/a.md');
  assert.deepEqual(p.data.covers, ['src/**']);
  assert.equal(p.lines, 9);
  const none = loadPage(root, join(w, 'nofm.md'));
  assert.equal(none.data, null);
  const wiki = loadWiki(root, DEFAULTS);
  assert.equal(wiki.exists, true);
  assert.equal(wiki.pages.length, 3);
  assert.equal(loadWiki(tmpDir(), DEFAULTS).exists, false);
});

test('loadWikiCache builds once, reuses when unchanged, rebuilds on mtime change', () => {
  const { root, w } = makeWiki();
  const first = loadWikiCache(root, DEFAULTS);
  assert.deepEqual(first.pages.map((p) => p.rel), ['docs/wiki/a.md', 'docs/wiki/nofm.md', 'docs/wiki/recipes/b.md']);
  assert.deepEqual(first.pages[0].covers, ['src/**']);
  assert.deepEqual(first.pages[1].covers, []);
  const cacheFile = join(projectDir(root), 'wiki-cache.json');
  const second = loadWikiCache(root, DEFAULTS);
  assert.equal(second.builtAt, first.builtAt);
  writeFileSync(join(w, 'a.md'), page('A', ['lib/**']));
  const future = new Date(Date.now() + 5000);
  utimesSync(join(w, 'a.md'), future, future);
  const third = loadWikiCache(root, DEFAULTS);
  assert.deepEqual(third.pages[0].covers, ['lib/**']);
  assert.notEqual(third.builtAt, first.builtAt);
  assert.deepEqual(JSON.parse(readFileSync(cacheFile, 'utf8')).pages[0].covers, ['lib/**']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/wiki.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/lib/wiki.mjs`:

```js
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseFrontmatter } from './fm.mjs';
import { normalizePath } from './glob.mjs';
import { projectDir, readJson, writeJsonAtomic } from './state.mjs';

export const REQUIRED_FIELDS = ['title', 'summary', 'read_when', 'covers', 'verified', 'updated'];

export function wikiDir(root, config) {
  return join(root, ...config.wikiDir.split('/'));
}

export function relPath(root, file) {
  return normalizePath(relative(root, file));
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function listPages(root, config) {
  const dir = wikiDir(root, config);
  if (!existsSync(dir)) return [];
  const index = join(dir, 'index.md');
  return walk(dir, []).filter((f) => f !== index).sort((a, b) => relPath(root, a).localeCompare(relPath(root, b)));
}

export function loadPage(root, file) {
  const text = readFileSync(file, 'utf8');
  const { data, body, errors } = parseFrontmatter(text);
  const lines = text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
  return { file, rel: relPath(root, file), data, body, errors, lines };
}

export function loadWiki(root, config) {
  const dir = wikiDir(root, config);
  const exists = existsSync(join(dir, 'index.md')) || existsSync(dir);
  return { dir, exists, pages: listPages(root, config).map((f) => loadPage(root, f)) };
}

function snapshot(root, config) {
  return listPages(root, config).map((file) => ({ file, rel: relPath(root, file), mtimeMs: statSync(file).mtimeMs }));
}

export function loadWikiCache(root, config) {
  const cacheFile = join(projectDir(root), 'wiki-cache.json');
  const current = snapshot(root, config);
  const cached = readJson(cacheFile, null);
  if (cached && Array.isArray(cached.pages) && cached.pages.length === current.length) {
    const same = cached.pages.every((p, i) => p.rel === current[i].rel && p.mtimeMs === current[i].mtimeMs);
    if (same) return cached;
  }
  const pages = current.map(({ file, rel, mtimeMs }) => {
    const { data } = loadPage(root, file);
    return {
      rel,
      file,
      mtimeMs,
      title: data && typeof data.title === 'string' ? data.title : rel,
      covers: data && Array.isArray(data.covers) ? data.covers.map(String) : [],
      verified: data && data.verified ? String(data.verified) : null,
    };
  });
  const built = { builtAt: new Date().toISOString(), pages };
  writeJsonAtomic(cacheFile, built);
  return built;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/wiki.test.mjs`
Expected: 3 tests PASS. If the "reuses when unchanged" assertion fails because `builtAt` differs, the cache comparison is not reading `mtimeMs` as a number; check `statSync(...).mtimeMs` is stored unrounded.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/lib/wiki.mjs plugins/ship-faster/tests/wiki.test.mjs
git commit -m "feat: wiki page loader with mtime-validated cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `detect.mjs` repository facts

**Files:**
- Create: `plugins/ship-faster/scripts/lib/root.mjs`
- Create: `plugins/ship-faster/scripts/detect.mjs`
- Test: `plugins/ship-faster/tests/detect.test.mjs`

**Interfaces:**
- Consumes: `runMain` (Task 2), `loadConfig` (Task 6), `git.*` (Task 5), `normalizePath` (Task 4).
- `root.mjs` produces `resolveRoot(flags, cwd = process.cwd()) → string`: `flags.root` when given, else `repoRoot(cwd)`, else `cwd`. Every CLI script in later tasks uses it.
- `detect.mjs` produces `detect(root: string) → DetectResult` and runs as a CLI (`node scripts/detect.mjs [--root <dir>] [--json]`).

`DetectResult`:

```
{
  ok: true,
  root: string,
  git: { isRepo: boolean, defaultBranch: string|null, head: string|null, currentBranch: string|null, trackedFiles: number, sizeClass: 'small'|'medium'|'large' },
  stacks: Array<{ kind: 'node'|'dotnet'|'python'|'go'|'rust'|'java', manifests: string[], packageManager?: 'npm'|'pnpm'|'yarn'|'bun', buildTool?: 'gradle'|'maven' }>,
  ci: Array<{ path: string, kind: 'github'|'gitlab'|'azure'|'jenkins'|'circle'|'bitbucket' }>,
  scripts: Record<string, string>,          // package.json scripts, node only
  testFrameworks: string[],                 // vitest, jest, mocha, ava, playwright, cypress, pytest, go-test, cargo-test, dotnet-test, junit
  lintTools: string[],                      // eslint, biome, prettier, ruff, golangci-lint, clippy, dotnet-format
  typecheck: string[],                      // tsc, mypy, pyright
  entryPoints: string[],
  topDirs: Array<{ dir: string, files: number }>,   // top 12, '.' for root files
  workspaces: Array<{ name: string, path: string, kind: string }>,
  existing: { claudeMd: boolean, wiki: boolean, rules: boolean, plans: boolean, config: boolean, agentsMd: boolean, readme: boolean },
  suggestedChecks: Array<{ name: string, run: string, timeout: number, source: 'detect' }>,
  summary: string[]
}
```

Size class: under 300 files small, under 3,000 medium, otherwise large. Without git, files are found by walking the tree, skipping `.git`, `node_modules`, `dist`, `build`, `target`, `bin`, `obj`, `vendor`, `.venv`, `venv`, `__pycache__`, capped at 20,000 files.

Suggested checks, in the order typecheck, lint, test, build, timeout 600 unless noted:

| Stack | Checks |
|---|---|
| node | `typecheck`: `<pm-exec> tsc --noEmit` when any `tsconfig*.json` at root; `lint`: `<pm-run> lint` when the script exists; `test`: `npm test` / `pnpm test` / `yarn test` / `bun run test` when the script exists; `build`: `<pm-run> build` when the script exists. `<pm-exec>` is `npx`, `pnpm exec`, `yarn`, `bunx`; `<pm-run>` is `npm run`, `pnpm run`, `yarn`, `bun run`. |
| dotnet | `build`: `dotnet build --no-restore`; `format`: `dotnet format --verify-no-changes` when `.editorconfig` exists; `test`: `dotnet test --no-build` |
| python | `typecheck`: `mypy .` when `[tool.mypy]` in pyproject or `mypy.ini`/`setup.cfg` mentions mypy; `pyright` when `pyrightconfig.json` or `[tool.pyright]`; `lint`: `ruff check .` when `[tool.ruff]` or `ruff.toml`; `test`: `pytest` when `[tool.pytest` in pyproject, `pytest.ini`, `conftest.py`, or a `tests/` directory exists |
| go | `vet`: `go vet ./...`; `lint`: `golangci-lint run` when `.golangci.yml`/`.golangci.yaml`; `test`: `go test ./...`; `build`: `go build ./...` |
| rust | `check`: `cargo check`; `lint`: `cargo clippy -- -D warnings` when `clippy.toml` exists; `test`: `cargo test` |
| java | gradle: `check`: `./gradlew check` (or `gradle check` when no wrapper); maven: `verify`: `mvn -q verify` |

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/detect.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { detect } from '../scripts/detect.mjs';

after(cleanupAll);

test('node repo with pnpm, tsconfig, scripts, github ci, existing CLAUDE.md', () => {
  const { root } = makeRepo({ files: {
    'package.json': JSON.stringify({ name: 'x', main: 'dist/index.js', scripts: { lint: 'eslint .', test: 'vitest run', build: 'tsc -p .' }, devDependencies: { vitest: '1', eslint: '9', typescript: '5' } }),
    'pnpm-lock.yaml': '',
    'tsconfig.json': '{}',
    'src/index.ts': 'export {}\n',
    'src/api/users.ts': 'export {}\n',
    '.github/workflows/ci.yml': 'on: push\n',
    'CLAUDE.md': '# x\n',
    'README.md': '# x\n',
  } });
  const r = detect(root);
  assert.equal(r.ok, true);
  assert.equal(r.git.isRepo, true);
  assert.equal(r.git.sizeClass, 'small');
  assert.deepEqual(r.stacks.map((s) => s.kind), ['node']);
  assert.equal(r.stacks[0].packageManager, 'pnpm');
  assert.deepEqual(r.ci, [{ path: '.github/workflows/ci.yml', kind: 'github' }]);
  assert.deepEqual(r.testFrameworks, ['vitest']);
  assert.deepEqual(r.lintTools, ['eslint']);
  assert.deepEqual(r.typecheck, ['tsc']);
  assert.ok(r.entryPoints.includes('src/index.ts'));
  assert.equal(r.existing.claudeMd, true);
  assert.equal(r.existing.wiki, false);
  assert.equal(r.existing.readme, true);
  assert.deepEqual(r.suggestedChecks.map((c) => [c.name, c.run]), [
    ['typecheck', 'pnpm exec tsc --noEmit'],
    ['lint', 'pnpm run lint'],
    ['test', 'pnpm test'],
    ['build', 'pnpm run build'],
  ]);
  assert.equal(r.topDirs.find((d) => d.dir === 'src').files, 2);
  assert.equal(r.topDirs.find((d) => d.dir === '.').files, 5);
});

test('dotnet, python, go, rust, java are detected with their checks', () => {
  const cases = [
    [{ 'App.sln': '', 'src/App/App.csproj': '<Project/>', '.editorconfig': '' }, 'dotnet', ['build', 'format', 'test']],
    [{ 'pyproject.toml': '[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n', 'app/main.py': '' }, 'python', ['typecheck', 'lint', 'test']],
    [{ 'go.mod': 'module x\n', 'main.go': 'package main\n', '.golangci.yml': '' }, 'go', ['vet', 'lint', 'test', 'build']],
    [{ 'Cargo.toml': '[package]\nname="x"\n', 'src/main.rs': '', 'clippy.toml': '' }, 'rust', ['check', 'lint', 'test']],
    [{ 'build.gradle': '', 'gradlew': '' }, 'java', ['check']],
    [{ 'pom.xml': '<project/>' }, 'java', ['verify']],
  ];
  for (const [files, kind, checks] of cases) {
    const r = detect(makeRepo({ files }).root);
    assert.deepEqual(r.stacks.map((s) => s.kind), [kind], kind);
    assert.deepEqual(r.suggestedChecks.map((c) => c.name), checks, kind);
  }
});

test('pnpm workspaces become workspaces entries', () => {
  const { root } = makeRepo({ files: {
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'pnpm-lock.yaml': '',
    'packages/a/package.json': JSON.stringify({ name: '@m/a' }),
    'packages/b/package.json': JSON.stringify({ name: '@m/b' }),
  } });
  const r = detect(root);
  assert.deepEqual(r.workspaces.map((w) => [w.name, w.path]), [['@m/a', 'packages/a'], ['@m/b', 'packages/b']]);
});

test('works without git and via the CLI', () => {
  const root = tmpDir();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"nogit","scripts":{"test":"node --test"}}');
  writeFileSync(join(root, 'src', 'index.js'), '');
  const r = detect(root);
  assert.equal(r.git.isRepo, false);
  assert.equal(r.git.trackedFiles, 2);
  assert.deepEqual(r.suggestedChecks.map((c) => c.run), ['npm test']);
  const cli = runScript('detect', ['--root', root, '--json']);
  assert.equal(cli.code, 0);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.stacks[0].kind, 'node');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/detect.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `lib/root.mjs`**

```js
import { repoRoot } from './git.mjs';
import { normalizePath } from './glob.mjs';

export function resolveRoot(flags = {}, cwd = process.cwd()) {
  if (typeof flags.root === 'string' && flags.root.trim()) return normalizePath(flags.root);
  return repoRoot(cwd) || normalizePath(cwd);
}
```

- [ ] **Step 4: Write `detect.mjs`**

```js
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__']);
const CI_FILES = [
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, 'github'],
  [/^\.gitlab-ci\.yml$/, 'gitlab'],
  [/^azure-pipelines\.yml$/, 'azure'],
  [/^Jenkinsfile$/, 'jenkins'],
  [/^\.circleci\/config\.yml$/, 'circle'],
  [/^bitbucket-pipelines\.yml$/, 'bitbucket'],
];

function walkFiles(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < 20000) {
    const rel = stack.pop();
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(r); }
      else if (e.isFile()) out.push(r);
    }
  }
  return out.sort();
}

function readText(root, rel) {
  try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
}

function readJson(root, rel) {
  try { return JSON.parse(readText(root, rel)); } catch { return null; }
}

export function detect(root) {
  root = normalizePath(root);
  const { config } = loadConfig(root);
  const isRepo = git.isRepo(root);
  const files = isRepo ? git.trackedFiles(root) : walkFiles(root);
  const has = (rel) => files.includes(rel);
  const any = (re) => files.some((f) => re.test(f));
  const list = (re) => files.filter((f) => re.test(f));

  const stacks = [];
  const scripts = {};
  const testFrameworks = [];
  const lintTools = [];
  const typecheck = [];
  const entryPoints = [];
  const workspaces = [];
  const checks = [];
  const push = (name, run, timeout = 600) => checks.push({ name, run, timeout, source: 'detect' });

  const pkg = has('package.json') ? readJson(root, 'package.json') : null;
  if (pkg) {
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : (has('bun.lockb') || has('bun.lock')) ? 'bun' : 'npm';
    stacks.push({ kind: 'node', manifests: ['package.json'], packageManager: pm });
    Object.assign(scripts, pkg.scripts || {});
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const [dep, name] of [['vitest', 'vitest'], ['jest', 'jest'], ['mocha', 'mocha'], ['ava', 'ava'], ['@playwright/test', 'playwright'], ['cypress', 'cypress']]) {
      if (dep in deps) testFrameworks.push(name);
    }
    for (const [dep, name] of [['eslint', 'eslint'], ['@biomejs/biome', 'biome'], ['prettier', 'prettier']]) {
      if (dep in deps) lintTools.push(name);
    }
    const hasTs = any(/^tsconfig[^/]*\.json$/);
    if (hasTs) typecheck.push('tsc');
    for (const c of [pkg.main, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {}))]) {
      if (typeof c === 'string' && has(normalizePath(c))) entryPoints.push(normalizePath(c));
    }
    for (const c of ['src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.mjs', 'src/main.ts', 'src/main.tsx', 'src/main.js', 'index.js', 'index.ts', 'server.js', 'app.js']) {
      if (has(c)) entryPoints.push(c);
    }
    const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm];
    const run = { npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn', bun: 'bun run' }[pm];
    const testCmd = { npm: 'npm test', pnpm: 'pnpm test', yarn: 'yarn test', bun: 'bun run test' }[pm];
    if (hasTs) push('typecheck', `${exec} tsc --noEmit`);
    if (scripts.lint) push('lint', `${run} lint`);
    if (scripts.test) push('test', testCmd, 900);
    if (scripts.build) push('build', `${run} build`);
    detectNodeWorkspaces(root, pkg, files, workspaces);
  }

  const dotnetManifests = list(/(^|\/)[^/]+\.(sln|csproj|fsproj)$/).slice(0, 20);
  if (dotnetManifests.length) {
    stacks.push({ kind: 'dotnet', manifests: dotnetManifests });
    testFrameworks.push('dotnet-test');
    push('build', 'dotnet build --no-restore');
    if (has('.editorconfig')) { lintTools.push('dotnet-format'); push('format', 'dotnet format --verify-no-changes'); }
    push('test', 'dotnet test --no-build', 900);
  }

  const pyManifests = ['pyproject.toml', 'setup.py', 'setup.cfg', ...list(/^requirements[^/]*\.txt$/)].filter(has);
  if (pyManifests.length) {
    stacks.push({ kind: 'python', manifests: pyManifests });
    const py = (readText(root, 'pyproject.toml') || '') + (readText(root, 'setup.cfg') || '');
    if (/\[tool\.mypy\]/.test(py) || has('mypy.ini')) { typecheck.push('mypy'); push('typecheck', 'mypy .'); }
    if (/\[tool\.pyright\]/.test(py) || has('pyrightconfig.json')) { typecheck.push('pyright'); push('typecheck', 'pyright'); }
    if (/\[tool\.ruff/.test(py) || has('ruff.toml')) { lintTools.push('ruff'); push('lint', 'ruff check .'); }
    if (/\[tool\.pytest/.test(py) || has('pytest.ini') || has('conftest.py') || any(/^tests\//)) { testFrameworks.push('pytest'); push('test', 'pytest', 900); }
    for (const c of ['__main__.py', 'main.py', 'app.py', 'manage.py', ...list(/^[^/]+\/(main|app|__main__)\.py$/)]) if (has(c)) entryPoints.push(c);
  }

  if (has('go.mod')) {
    stacks.push({ kind: 'go', manifests: ['go.mod', ...(has('go.work') ? ['go.work'] : [])] });
    testFrameworks.push('go-test');
    push('vet', 'go vet ./...');
    if (has('.golangci.yml') || has('.golangci.yaml')) { lintTools.push('golangci-lint'); push('lint', 'golangci-lint run'); }
    push('test', 'go test ./...', 900);
    push('build', 'go build ./...');
    for (const c of ['main.go', ...list(/^cmd\/[^/]+\/main\.go$/)]) if (has(c)) entryPoints.push(c);
    const work = readText(root, 'go.work');
    if (work) for (const m of work.matchAll(/^\s*\.\/([^\s]+)/gm)) workspaces.push({ name: m[1], path: m[1], kind: 'go' });
  }

  if (has('Cargo.toml')) {
    stacks.push({ kind: 'rust', manifests: ['Cargo.toml'] });
    testFrameworks.push('cargo-test');
    push('check', 'cargo check');
    if (has('clippy.toml')) { lintTools.push('clippy'); push('lint', 'cargo clippy -- -D warnings'); }
    push('test', 'cargo test', 900);
    for (const c of ['src/main.rs', 'src/lib.rs']) if (has(c)) entryPoints.push(c);
    const cargo = readText(root, 'Cargo.toml') || '';
    const members = /\[workspace\][\s\S]*?members\s*=\s*\[([^\]]*)\]/.exec(cargo);
    if (members) for (const m of members[1].matchAll(/"([^"]+)"/g)) workspaces.push({ name: m[1], path: m[1], kind: 'rust' });
  }

  if (any(/^build\.gradle(\.kts)?$/)) {
    stacks.push({ kind: 'java', manifests: list(/^build\.gradle(\.kts)?$/), buildTool: 'gradle' });
    testFrameworks.push('junit');
    push('check', has('gradlew') ? './gradlew check' : 'gradle check', 900);
  } else if (has('pom.xml')) {
    stacks.push({ kind: 'java', manifests: ['pom.xml'], buildTool: 'maven' });
    testFrameworks.push('junit');
    push('verify', 'mvn -q verify', 900);
  }

  const ci = [];
  for (const f of files) for (const [re, kind] of CI_FILES) if (re.test(f)) ci.push({ path: f, kind });

  const counts = new Map();
  for (const f of files) {
    const dir = f.includes('/') ? f.split('/')[0] : '.';
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  const topDirs = [...counts.entries()].map(([dir, n]) => ({ dir, files: n })).sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir)).slice(0, 12);

  const wikiIndex = `${config.wikiDir}/index.md`;
  const existing = {
    claudeMd: has('CLAUDE.md') || existsSync(join(root, 'CLAUDE.md')),
    wiki: existsSync(join(root, wikiIndex)),
    rules: existsSync(join(root, config.rulesDir)) && readdirSync(join(root, config.rulesDir)).some((n) => n.endsWith('.md')),
    plans: existsSync(join(root, config.plansDir)),
    config: existsSync(join(root, '.claude', 'ship-faster.json')),
    agentsMd: existsSync(join(root, 'AGENTS.md')),
    readme: any(/^README(\.[^/]+)?$/i),
  };

  const n = files.length;
  const sizeClass = n < 300 ? 'small' : n < 3000 ? 'medium' : 'large';
  const result = {
    ok: true,
    root,
    git: { isRepo, defaultBranch: isRepo ? git.defaultBranch(root) : null, head: isRepo ? git.head(root) : null, currentBranch: isRepo ? git.currentBranch(root) : null, trackedFiles: n, sizeClass },
    stacks, ci, scripts, testFrameworks, lintTools, typecheck,
    entryPoints: [...new Set(entryPoints)],
    topDirs, workspaces, existing,
    suggestedChecks: checks,
  };
  result.summary = [
    `${stacks.map((s) => s.kind).join('+') || 'unknown stack'}, ${n} files (${sizeClass}), ${ci.length} CI file(s)`,
    `checks: ${checks.map((c) => c.run).join(' | ') || 'none detected'}`,
  ];
  return result;
}

function detectNodeWorkspaces(root, pkg, files, workspaces) {
  let patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && Array.isArray(pkg.workspaces.packages) ? pkg.workspaces.packages : []);
  const pnpmWs = readText(root, 'pnpm-workspace.yaml');
  if (pnpmWs) for (const m of pnpmWs.matchAll(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/gm)) patterns.push(m[1]);
  patterns = patterns.filter((p) => !p.startsWith('!'));
  if (!patterns.length) return;
  const pkgFiles = files.filter((f) => f.endsWith('/package.json'));
  for (const f of pkgFiles) {
    const dir = f.slice(0, -'/package.json'.length);
    const matches = patterns.some((p) => {
      const re = new RegExp('^' + p.replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return re.test(dir);
    });
    if (!matches) continue;
    const sub = readJson(root, f);
    workspaces.push({ name: (sub && sub.name) || basename(dir), path: dir, kind: 'node' });
  }
  workspaces.sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/detect.mjs')) {
  runMain((_, flags) => detect(resolveRoot(flags)));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/detect.test.mjs`
Expected: 4 tests PASS. If the python case reports `test` before `lint`, the push order in the python block is wrong: typecheck, lint, test.

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/lib/root.mjs plugins/ship-faster/scripts/detect.mjs plugins/ship-faster/tests/detect.test.mjs
git commit -m "feat: detect stacks, ci, scripts, workspaces, and suggested checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `footprints.mjs` co-change clusters

**Files:**
- Create: `plugins/ship-faster/scripts/footprints.mjs`
- Test: `plugins/ship-faster/tests/footprints.test.mjs`

**Interfaces:**
- Consumes: `git.log` (Task 5), `runMain` (Task 2), `resolveRoot` (Task 8).
- Produces `footprints(root, { maxCommits = 500, minPair = 3, minJaccard = 0.3, maxClusters = 20 } = {}) → { ok, commitsScanned, clusters: Array<{ files: string[], commits: number, keywords: string[], samples: string[] }>, hotspots: Array<{ dir: string, commits: number }>, summary: string[] }` and the CLI `node scripts/footprints.mjs [--root <dir>] [--max-commits n] [--json]`.
- Algorithm: take the last `maxCommits` non-merge commits touching 2 to 30 files, after dropping lockfiles and changelogs (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Cargo.lock`, `go.sum`, `poetry.lock`, `CHANGELOG.md`). Count per-file commits and per-pair co-occurrences. Union pairs with count ≥ `minPair` and Jaccard ≥ `minJaccard`. Clusters are groups of 2 or more files, scored by the number of commits touching at least two of their files, sorted by that score, capped at `maxClusters`. Keywords: from the subjects of those commits, strip a conventional prefix (`type(scope)!:`), lower-case, split on non-letters, drop words under 3 letters and stopwords, keep the 6 most frequent. Samples: first 3 distinct subjects. Hotspots: commits per top-level directory (`.` for root files), top 10.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/footprints.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { footprints } from '../scripts/footprints.mjs';

after(cleanupAll);

function history() {
  const commits = [];
  for (let i = 0; i < 6; i++) {
    commits.push({ message: `feat(api): add endpoint ${i}`, files: { 'src/api/routes.ts': `r${i}`, 'src/api/schema.ts': `s${i}`, 'package-lock.json': `${i}` } });
  }
  for (let i = 0; i < 4; i++) {
    commits.push({ message: `fix: repair parser case ${i}`, files: { 'lib/parser.py': `p${i}`, 'lib/tokens.py': `t${i}`, 'tests/test_parser.py': `x${i}` } });
  }
  commits.push({ message: 'docs: readme', files: { 'README.md': 'r' } });
  commits.push({ message: 'chore: touch two unrelated', files: { 'src/api/routes.ts': 'z', 'lib/tokens.py': 'z' } });
  return commits;
}

test('finds the two clusters, ignores lockfiles, extracts keywords and samples', () => {
  const { root } = makeRepo({ files: { 'README.md': '0' }, commits: history() });
  const r = footprints(root);
  assert.equal(r.ok, true);
  assert.equal(r.commitsScanned, 13);
  assert.equal(r.clusters.length, 2);
  assert.deepEqual(r.clusters[0].files, ['src/api/routes.ts', 'src/api/schema.ts']);
  assert.equal(r.clusters[0].commits, 6);
  assert.ok(r.clusters[0].keywords.includes('endpoint'));
  assert.ok(!r.clusters[0].keywords.includes('feat'));
  assert.equal(r.clusters[0].samples.length, 3);
  assert.deepEqual(r.clusters[1].files, ['lib/parser.py', 'lib/tokens.py', 'tests/test_parser.py']);
  assert.ok(!JSON.stringify(r.clusters).includes('package-lock.json'));
  assert.equal(r.hotspots[0].dir, 'src');
});

test('handles a repo without history and the CLI flag', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a' } });
  const r = footprints(root);
  assert.deepEqual(r.clusters, []);
  assert.equal(footprints(tmpDir()).commitsScanned, 0);
  const cli = runScript('footprints', ['--root', root, '--json', '--max-commits', '5']);
  assert.equal(cli.json.ok, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/footprints.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/footprints.mjs`:

```js
import { runMain } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';

const IGNORED = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'go.sum', 'poetry.lock', 'CHANGELOG.md']);
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'add', 'added', 'adds', 'fix', 'fixed', 'fixes', 'update', 'updated', 'updates', 'remove', 'removed', 'use', 'when', 'that', 'this', 'not', 'now', 'via', 'per', 'some', 'more', 'also', 'make', 'made']);

export function footprints(root, { maxCommits = 500, minPair = 3, minJaccard = 0.3, maxClusters = 20 } = {}) {
  const commits = git.isRepo(root) ? git.log(root, { n: maxCommits }) : [];
  const usable = commits
    .map((c) => ({ ...c, files: c.files.filter((f) => !IGNORED.has(f.split('/').pop())) }))
    .filter((c) => c.files.length >= 2 && c.files.length <= 30);

  const fileCount = new Map();
  const pairCount = new Map();
  for (const c of usable) {
    const files = [...new Set(c.files)].sort();
    for (const f of files) fileCount.set(f, (fileCount.get(f) || 0) + 1);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}\n${files[j]}`;
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  }

  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  for (const [key, count] of pairCount) {
    if (count < minPair) continue;
    const [a, b] = key.split('\n');
    const jaccard = count / (fileCount.get(a) + fileCount.get(b) - count);
    if (jaccard >= minJaccard) union(a, b);
  }

  const groups = new Map();
  for (const f of parent.keys()) {
    const r = find(f);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(f);
  }

  const clusters = [];
  for (const files of groups.values()) {
    if (files.length < 2) continue;
    const set = new Set(files);
    const touching = usable.filter((c) => c.files.filter((f) => set.has(f)).length >= 2);
    clusters.push({
      files: files.sort(),
      commits: touching.length,
      keywords: keywords(touching.map((c) => c.subject)),
      samples: [...new Set(touching.map((c) => c.subject))].slice(0, 3),
    });
  }
  clusters.sort((a, b) => b.commits - a.commits || a.files[0].localeCompare(b.files[0]));

  const dirCount = new Map();
  for (const c of commits) {
    const files = c.files.filter((f) => !IGNORED.has(f.split('/').pop()));
    for (const dir of new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] : '.')))) {
      dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
    }
  }
  const hotspots = [...dirCount.entries()].map(([dir, n]) => ({ dir, commits: n })).sort((a, b) => b.commits - a.commits || a.dir.localeCompare(b.dir)).slice(0, 10);

  const top = clusters.slice(0, maxClusters);
  return {
    ok: true,
    commitsScanned: commits.length,
    clusters: top,
    hotspots,
    summary: [`${commits.length} commits scanned, ${top.length} co-change cluster(s)`, ...top.slice(0, 5).map((c) => `${c.commits}× ${c.files.join(', ')}`)],
  };
}

function keywords(subjects) {
  const freq = new Map();
  for (const s of subjects) {
    const stripped = s.replace(/^\w+(\([^)]*\))?!?:\s*/, '').toLowerCase();
    for (const w of stripped.split(/[^a-z]+/)) {
      if (w.length < 3 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([w]) => w);
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/footprints.mjs')) {
  runMain((_, flags) => footprints(resolveRoot(flags), { maxCommits: flags['max-commits'] ? Number(flags['max-commits']) : 500 }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/footprints.test.mjs`
Expected: 2 tests PASS. If `commitsScanned` is 12 rather than 13, `makeRepo` skipped the initial commit; confirm the test passes `files` so the initial commit exists.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/footprints.mjs plugins/ship-faster/tests/footprints.test.mjs
git commit -m "feat: co-change footprints from git history for recipe candidates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `stale.mjs` page freshness

**Files:**
- Create: `plugins/ship-faster/scripts/stale.mjs`
- Test: `plugins/ship-faster/tests/stale.test.mjs`

**Interfaces:**
- Consumes: `loadWiki`, `REQUIRED_FIELDS` (Task 7), `filterPaths` (Task 4), `git.isRepo/head/commitExists/changedSince/dirtyFiles` (Task 5), `loadSession` (Task 6), `loadConfig` (Task 6), `runMain`, `flagList` (Task 2), `resolveRoot` (Task 8).
- Produces `stale(root, { config, session = null, changed = [] } = {}) → { ok: true, exists: boolean, head: string|null, pages: Array<{ rel, status, verified, changed: string[], reason }>, counts: { fresh, stale, dirty, unverifiable, invalid }, summary: string[] }` and the CLI `node scripts/stale.mjs [--root <dir>] [--session <sid>] [--changed <file>]... [--json]`.
- Status rules, first match wins: `invalid` (no frontmatter, parse errors, a missing required field, or `covers` not a non-empty array); `unverifiable` (`verified` is `unverified`, not a repo, or the sha is not in history); `stale` (a covered file appears in `git diff --name-only <verified> HEAD`); `dirty` (a covered file is uncommitted, in the H3 session record for `--session`, or passed with `--changed`); else `fresh`. `changed` lists the matched files, capped at 50. `git diff` runs once per distinct sha and is skipped when the sha equals HEAD.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/stale.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { saveSession } from '../scripts/lib/state.mjs';
import { stale } from '../scripts/stale.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const page = (title, covers, verified, extra = {}) =>
  serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified, updated: '2026-09-16', ...extra }) + `# ${title}\n`;

test('classifies fresh, stale, dirty, unverifiable, invalid and merges session records', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b', 'docs/c.md': 'c', 'ops/d.txt': 'd' } });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'change b']);
  const headSha = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'fresh.md'), page('Fresh', ['src/**'], headSha));
  writeFileSync(join(w, 'stale.md'), page('Stale', ['lib/**'], first));
  writeFileSync(join(w, 'dirty.md'), page('Dirty', ['docs/c.md'], headSha));
  writeFileSync(join(w, 'unver.md'), page('Unver', ['src/**'], 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));
  writeFileSync(join(w, 'invalid.md'), '---\ntitle: Invalid\n---\nno covers\n');
  writeFileSync(join(w, 'session.md'), page('Session', ['ops/**'], headSha));
  writeFileSync(join(root, 'docs', 'c.md'), 'c2');
  saveSession(root, 'sid1', { pages: { 'docs/wiki/session.md': { files: ['ops/d.txt'], reported: false } } });

  const r = stale(root, { config: DEFAULTS, session: 'sid1' });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['fresh.md'].status, 'fresh');
  assert.equal(by['stale.md'].status, 'stale');
  assert.deepEqual(by['stale.md'].changed, ['lib/b.ts']);
  assert.equal(by['dirty.md'].status, 'dirty');
  assert.deepEqual(by['dirty.md'].changed, ['docs/c.md']);
  assert.equal(by['unver.md'].status, 'unverifiable');
  assert.equal(by['invalid.md'].status, 'invalid');
  assert.equal(by['session.md'].status, 'dirty');
  assert.deepEqual(r.counts, { fresh: 1, stale: 1, dirty: 2, unverifiable: 1, invalid: 1 });
  assert.equal(r.head, headSha);
  assert.match(r.summary[0], /6 pages/);

  const cli = runScript('stale', ['--root', root, '--json', '--changed', 'src/a.ts']);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.pages.find((p) => p.rel.endsWith('fresh.md')).status, 'dirty');
});

test('no wiki and no git are reported, not thrown', () => {
  const none = stale(tmpDir(), { config: DEFAULTS });
  assert.equal(none.exists, false);
  assert.deepEqual(none.pages, []);
  const root = tmpDir();
  mkdirSync(join(root, 'docs', 'wiki'), { recursive: true });
  writeFileSync(join(root, 'docs', 'wiki', 'p.md'), page('P', ['src/**'], 'abc'));
  const r = stale(root, { config: DEFAULTS });
  assert.equal(r.pages[0].status, 'unverifiable');
  assert.match(r.pages[0].reason, /not a git repository/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/stale.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/stale.mjs`:

```js
import { flagList, runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { filterPaths, normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { loadSession } from './lib/state.mjs';
import { REQUIRED_FIELDS, loadWiki } from './lib/wiki.mjs';

const EMPTY = () => ({ fresh: 0, stale: 0, dirty: 0, unverifiable: 0, invalid: 0 });

export function stale(root, { config, session = null, changed = [] } = {}) {
  config = config || loadConfig(root).config;
  const wiki = loadWiki(root, config);
  if (!wiki.exists || wiki.pages.length === 0) {
    return { ok: true, exists: wiki.exists, head: null, pages: [], counts: EMPTY(), summary: [wiki.exists ? 'wiki has no pages' : 'no wiki'] };
  }
  const isRepo = git.isRepo(root);
  const head = isRepo ? git.head(root) : null;
  const dirty = isRepo ? git.dirtyFiles(root).map((d) => d.path) : [];
  const extra = [...changed.map(normalizePath)];
  if (session) {
    const rec = loadSession(root, session);
    for (const entry of Object.values(rec.pages || {})) for (const f of entry.files || []) extra.push(normalizePath(f));
  }
  const uncommitted = [...new Set([...dirty, ...extra])];
  const diffCache = new Map();
  const changedSince = (sha) => {
    if (!diffCache.has(sha)) diffCache.set(sha, sha === head ? [] : git.changedSince(root, sha));
    return diffCache.get(sha);
  };

  const pages = wiki.pages.map((p) => {
    const rel = p.rel;
    const data = p.data;
    if (!data || p.errors.length) return { rel, status: 'invalid', verified: null, changed: [], reason: !data ? 'no frontmatter' : p.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ') };
    const missing = REQUIRED_FIELDS.filter((k) => !(k in data));
    if (missing.length) return { rel, status: 'invalid', verified: null, changed: [], reason: `missing ${missing.join(', ')}` };
    if (!Array.isArray(data.covers) || data.covers.length === 0) return { rel, status: 'invalid', verified: null, changed: [], reason: 'covers must be a non-empty list' };
    const covers = data.covers.map(String);
    const verified = String(data.verified);
    if (!isRepo) return { rel, status: 'unverifiable', verified, changed: [], reason: 'not a git repository' };
    if (verified === 'unverified' || !git.commitExists(root, verified)) return { rel, status: 'unverifiable', verified, changed: [], reason: verified === 'unverified' ? 'never verified' : 'verified commit is not in history' };
    const diff = changedSince(verified);
    if (diff === null) return { rel, status: 'unverifiable', verified, changed: [], reason: 'git diff failed' };
    const matched = filterPaths(covers, diff);
    if (matched.length) return { rel, status: 'stale', verified, changed: matched.slice(0, 50), reason: `${matched.length} covered file(s) changed since ${verified.slice(0, 7)}` };
    const dirtyMatched = filterPaths(covers, uncommitted);
    if (dirtyMatched.length) return { rel, status: 'dirty', verified, changed: dirtyMatched.slice(0, 50), reason: `${dirtyMatched.length} covered file(s) changed in the working tree or this session` };
    return { rel, status: 'fresh', verified, changed: [], reason: '' };
  });

  const counts = EMPTY();
  for (const p of pages) counts[p.status]++;
  const name = (p) => p.rel.split('/').pop().replace(/\.md$/, '');
  const list = (status) => pages.filter((p) => p.status === status).map(name);
  const parts = [`${counts.fresh} fresh`];
  for (const s of ['stale', 'dirty', 'unverifiable', 'invalid']) if (counts[s]) parts.push(`${counts[s]} ${s} (${list(s).join(', ')})`);
  return { ok: true, exists: true, head, pages, counts, summary: [`${pages.length} pages: ${parts.join(', ')}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/stale.mjs')) {
  runMain((_, flags) => stale(resolveRoot(flags), { session: typeof flags.session === 'string' ? flags.session : null, changed: flagList(flags, 'changed') }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/stale.test.mjs`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/stale.mjs plugins/ship-faster/tests/stale.test.mjs
git commit -m "feat: compute wiki page freshness from covers globs and verified commits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `index.mjs` index generator

**Files:**
- Create: `plugins/ship-faster/scripts/index.mjs`
- Test: `plugins/ship-faster/tests/index.test.mjs`

**Interfaces:**
- Consumes: `loadWiki`, `wikiDir` (Task 7), `loadConfig` (Task 6), `runMain` (Task 2), `resolveRoot` (Task 8).
- Produces `buildIndex(root, config) → { ok: true, path: string, content: string, current: string|null, changed: boolean, pages: number }` (pure, no write) and `writeIndex(root, config) → same shape plus `written: boolean`` (writes only when changed). CLI: `node scripts/index.mjs [--root <dir>] [--check] [--json]`; `--check` never writes and returns `ok: false, error: 'index.md is out of date'` when `changed`.
- Output format (byte-stable, LF, no timestamps):

```
<!-- Generated by ship-faster. Do not edit: run /ship-faster:sync-docs to regenerate. -->
# Wiki index

| Page | Read when | Summary |
|---|---|---|
| [Architecture](architecture.md) | You are changing how components fit together. | Components, data flow, decisions. |

## Recipes

| Recipe | Read when | Summary |
|---|---|---|
| [Add an endpoint](recipes/add-endpoint.md) | … | … |

## Packages

| Package | Read when | Summary |
|---|---|---|
```

Rows sorted by path. Pages under `recipes/` and `packages/` go to their own tables; a table is omitted when empty. A page without frontmatter is listed with its file name as title and `(no frontmatter)` as read-when. Pipe characters in cells are escaped as `\|`. Links are relative to the wiki directory.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/index.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir, runScript, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { buildIndex, writeIndex } from '../scripts/index.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const page = (title, summary, read_when) => serializeFrontmatter({ title, summary, read_when, covers: ['x'], verified: 'abc', updated: '2026-09-16' }) + '# x\n';

function wiki() {
  const root = tmpDir();
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  mkdirSync(join(w, 'packages'), { recursive: true });
  writeFileSync(join(w, 'commands.md'), page('Commands', 'Verified | commands.', 'You need to run anything.'));
  writeFileSync(join(w, 'architecture.md'), page('Architecture', 'Components.', 'Changing structure.'));
  writeFileSync(join(w, 'recipes', 'add-endpoint.md'), page('Add an endpoint', 'Steps.', 'Adding an API route.'));
  writeFileSync(join(w, 'nofm.md'), '# plain\n');
  return { root, w };
}

test('builds grouped, sorted, escaped tables and is byte-stable', () => {
  const { root, w } = wiki();
  const a = buildIndex(root, DEFAULTS);
  assert.equal(a.changed, true);
  assert.equal(a.current, null);
  assert.match(a.content, /^<!-- Generated by ship-faster\./);
  const lines = a.content.split('\n');
  const main = lines.filter((l) => l.startsWith('| ['));
  assert.deepEqual(main.map((l) => l.slice(0, l.indexOf(']'))), ['| [Architecture', '| [Commands', '| [nofm', '| [Add an endpoint']);
  assert.ok(a.content.includes('| [Commands](commands.md) | You need to run anything. | Verified \\| commands. |'));
  assert.ok(a.content.includes('| [nofm](nofm.md) | (no frontmatter) |  |'));
  assert.ok(a.content.includes('## Recipes'));
  assert.ok(!a.content.includes('## Packages'));
  const w1 = writeIndex(root, DEFAULTS);
  assert.equal(w1.written, true);
  assert.equal(readFileSync(join(w, 'index.md'), 'utf8'), a.content);
  const w2 = writeIndex(root, DEFAULTS);
  assert.equal(w2.written, false);
  assert.equal(w2.changed, false);
});

test('--check reports an out-of-date index without writing', () => {
  const { root, w } = wiki();
  writeIndex(root, DEFAULTS);
  writeFileSync(join(w, 'commands.md'), page('Commands', 'New summary.', 'You need to run anything.'));
  const cli = runScript('index', ['--root', root, '--check', '--json']);
  assert.equal(cli.json.ok, false);
  assert.match(cli.json.error, /out of date/);
  assert.ok(!readFileSync(join(w, 'index.md'), 'utf8').includes('New summary.'));
  const fix = runScript('index', ['--root', root, '--json']);
  assert.equal(fix.json.written, true);
  assert.equal(runScript('index', ['--root', root, '--check', '--json']).json.ok, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/index.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/index.mjs`:

```js
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { loadWiki, wikiDir } from './lib/wiki.mjs';

const HEADER = '<!-- Generated by ship-faster. Do not edit: run /ship-faster:sync-docs to regenerate. -->\n# Wiki index\n';

const cell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

function table(label, rows) {
  if (!rows.length) return '';
  const out = [`| ${label} | Read when | Summary |`, '|---|---|---|'];
  for (const r of rows) out.push(`| [${cell(r.title)}](${r.link}) | ${cell(r.readWhen)} | ${cell(r.summary)} |`);
  return out.join('\n') + '\n';
}

export function buildIndex(root, config) {
  config = config || loadConfig(root).config;
  const wiki = loadWiki(root, config);
  const prefix = config.wikiDir.replace(/\/+$/, '') + '/';
  const rows = wiki.pages.map((p) => {
    const link = p.rel.startsWith(prefix) ? p.rel.slice(prefix.length) : p.rel;
    const d = p.data || {};
    return {
      link,
      title: d.title || link.split('/').pop().replace(/\.md$/, ''),
      readWhen: p.data ? d.read_when || '' : '(no frontmatter)',
      summary: p.data ? d.summary || '' : '',
      group: link.startsWith('recipes/') ? 'recipes' : link.startsWith('packages/') ? 'packages' : 'main',
    };
  }).sort((a, b) => a.link.localeCompare(b.link));
  let content = HEADER + '\n' + table('Page', rows.filter((r) => r.group === 'main'));
  const recipes = table('Recipe', rows.filter((r) => r.group === 'recipes'));
  if (recipes) content += '\n## Recipes\n\n' + recipes;
  const packages = table('Package', rows.filter((r) => r.group === 'packages'));
  if (packages) content += '\n## Packages\n\n' + packages;
  const path = join(wikiDir(root, config), 'index.md');
  const current = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
  return { ok: true, path: normalizePath(path), content, current, changed: current !== content, pages: rows.length };
}

export function writeIndex(root, config) {
  const r = buildIndex(root, config);
  if (r.changed) writeFileSync(r.path, r.content);
  return { ...r, written: r.changed, summary: [r.changed ? `index.md written (${r.pages} pages)` : `index.md up to date (${r.pages} pages)`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/index.mjs')) {
  runMain((_, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    if (flags.check) {
      const r = buildIndex(root, config);
      return r.changed ? { ...r, ok: false, error: 'index.md is out of date', content: undefined } : { ...r, content: undefined, summary: ['index.md up to date'] };
    }
    const r = writeIndex(root, config);
    return { ...r, content: undefined, current: undefined };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/index.test.mjs`
Expected: 2 tests PASS. If the main-table ordering assertion fails, the sort must be on `link` (path), not on title.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/index.mjs plugins/ship-faster/tests/index.test.mjs
git commit -m "feat: generate a byte-stable wiki index from page frontmatter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `lint.mjs` wiki, CLAUDE.md, and rules lint

**Files:**
- Create: `plugins/ship-faster/scripts/lib/files.mjs`
- Modify: `plugins/ship-faster/scripts/detect.mjs` (replace its private `walkFiles` with `listRepoFiles` from `lib/files.mjs`; behaviour unchanged, detect tests must still pass)
- Create: `plugins/ship-faster/scripts/lint.mjs`
- Test: `plugins/ship-faster/tests/lint.test.mjs`

**Interfaces:**
- `files.mjs` produces `listRepoFiles(root) → string[]` (tracked files when a git repo, else a walk skipping `.git`, `node_modules`, `dist`, `build`, `target`, `bin`, `obj`, `vendor`, `.venv`, `venv`, `__pycache__`, capped at 20,000, sorted, `/` separators) and `SKIP_DIRS`.
- `lint.mjs` produces `lint(root, { config } = {}) → { ok: boolean, errors: Finding[], warnings: Finding[], summary: string[] }` with `Finding = { file: string, line: number|null, rule: string, message: string }`, and the CLI `node scripts/lint.mjs [--root <dir>] [--json]` exiting 1 when `errors.length > 0` in both output modes.

Rules:

| Rule | Level | Applies to | Condition |
|---|---|---|---|
| `frontmatter-missing` | error | wiki pages except `index.md` | no frontmatter |
| `frontmatter-invalid` | error | pages, plans, rules | parser error (line reported) |
| `frontmatter-required` | error | pages | a `REQUIRED_FIELDS` key missing |
| `covers-empty` | error | pages | `covers` not a non-empty array |
| `covers-no-match` | error | pages | a `covers` glob matches no repository file |
| `page-too-long` | error | pages | lines > `pageMaxLines` |
| `index-too-long` | error | `index.md` | lines > 80 |
| `index-stale` | error | `index.md` | differs from `buildIndex` output, or missing while pages exist |
| `claude-md-too-long` | error | `CLAUDE.md` | lines > `claudeMdMaxLines` |
| `rules-too-long` | error | `<rulesDir>/*.md` | lines > `rulesFileMaxLines` |
| `rules-no-paths` | warning | rules files | frontmatter lacks a non-empty `paths` list |
| `link-missing` | error | pages, CLAUDE.md, rules | a relative markdown link target (anchor stripped) does not exist |
| `checks-shape` | error | `commands.md` | `checks` present but not a list of maps with non-empty string `run` |
| `duplicate-title` | error | pages | two pages share a `title` |
| `secret` | error | pages, CLAUDE.md, rules | a line matches a secret pattern |
| `path-missing` | warning | pages, CLAUDE.md | a backticked token that looks like a repo path does not exist |
| `script-missing` | warning | pages, CLAUDE.md | `npm run X`, `pnpm run X`, or `yarn run X` where `X` is not in `package.json` scripts |
| `verified-missing` | warning | pages | `verified` is not `unverified` and not a commit in history |

A path-like token: inside single backticks, contains `/`, no whitespace, no `*?{}<>$`, not a URL, at most 120 characters, and its first segment is an existing top-level entry of the repository. Secret patterns: `AKIA[0-9A-Z]{16}`; `\bsk-[A-Za-z0-9]{20,}`; `\bghp_[A-Za-z0-9]{30,}`; `\bgithub_pat_[A-Za-z0-9_]{30,}`; `\bxox[baprs]-[A-Za-z0-9-]{10,}`; `\bAIza[0-9A-Za-z_-]{30,}`; a JWT `\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`; and `\b(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*["']?([^\s"'<${*]{8,})` whose captured value is not a placeholder word (`your`, `example`, `changeme`, `redacted`, `xxxx`).

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/lint.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { writeIndex } from '../scripts/index.mjs';
import { lint } from '../scripts/lint.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const fm = (o) => serializeFrontmatter({ summary: 's', read_when: 'r', updated: '2026-09-16', ...o });

function goodRepo() {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'CLAUDE.md': '# p\n\nSee `src/a.ts` and run `npm run test`.\n' } });
  const sha = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  writeFileSync(join(w, 'commands.md'), fm({ title: 'Commands', covers: ['package.json'], verified: sha, checks: [{ name: 'test', run: 'npm test', timeout: 60 }] }) + '# Commands\n\nRun `npm run test`.\n');
  writeFileSync(join(w, 'architecture.md'), fm({ title: 'Architecture', covers: ['src/**'], verified: sha }) + '# A\n\nSee [commands](commands.md) and `src/a.ts`.\n');
  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'api.md'), '---\npaths: ["src/**"]\n---\n- Never block the event loop (g-20260916-loop).\n');
  writeIndex(root, DEFAULTS);
  return { root, w, sha };
}

const rules = (r) => [...r.errors, ...r.warnings].map((f) => f.rule).sort();

test('a good wiki lints clean', () => {
  const { root } = goodRepo();
  const r = lint(root, { config: DEFAULTS });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
});

test('every error rule fires', () => {
  const { root, w, sha } = goodRepo();
  writeFileSync(join(w, 'nofm.md'), '# no frontmatter\n');
  writeFileSync(join(w, 'bad.md'), fm({ title: 'Architecture', covers: [], verified: sha }) + '# dup title and empty covers\n[missing](nope.md)\n');
  writeFileSync(join(w, 'nomatch.md'), fm({ title: 'NoMatch', covers: ['nothing/**'], verified: sha }) + 'x\n');
  writeFileSync(join(w, 'long.md'), fm({ title: 'Long', covers: ['src/**'], verified: sha }) + 'line\n'.repeat(250));
  writeFileSync(join(w, 'secret.md'), fm({ title: 'Secret', covers: ['src/**'], verified: sha }) + 'token = ghp_' + 'a'.repeat(36) + '\n');
  writeFileSync(join(w, 'commands.md'), fm({ title: 'Commands', covers: ['package.json'], verified: sha, checks: [{ name: 'test' }] }) + '# C\n');
  writeFileSync(join(root, 'CLAUDE.md'), 'x\n'.repeat(160));
  writeFileSync(join(root, '.claude', 'rules', 'long.md'), '---\npaths: ["src/**"]\n---\n' + 'rule\n'.repeat(30));
  writeFileSync(join(root, '.claude', 'rules', 'nopaths.md'), '- always\n');
  const r = lint(root, { config: DEFAULTS });
  const got = new Set(r.errors.map((e) => e.rule));
  for (const rule of ['frontmatter-missing', 'covers-empty', 'covers-no-match', 'page-too-long', 'index-stale', 'claude-md-too-long', 'rules-too-long', 'link-missing', 'checks-shape', 'duplicate-title', 'secret']) {
    assert.ok(got.has(rule), `expected ${rule}, got ${[...got].join(', ')}`);
  }
  assert.ok(r.warnings.some((x) => x.rule === 'rules-no-paths'));
  assert.equal(r.ok, false);
  const secret = r.errors.find((e) => e.rule === 'secret');
  assert.equal(secret.line, 9);
  const cli = runScript('lint', ['--root', root, '--json']);
  assert.equal(cli.code, 1);
  assert.equal(cli.json.ok, false);
  assert.equal(runScript('lint', ['--root', root]).code, 1);
});

test('warnings: missing path, missing script, verified not in history; index-too-long', () => {
  const { root, w, sha } = goodRepo();
  writeFileSync(join(w, 'architecture.md'), fm({ title: 'Architecture', covers: ['src/**'], verified: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }) + '# A\n\nSee `src/missing.ts`, `https://x/y`, and run `npm run nope`. Globs like `src/**` are fine.\n');
  writeIndex(root, DEFAULTS);
  const r = lint(root, { config: DEFAULTS });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((x) => x.rule).sort(), ['path-missing', 'script-missing', 'verified-missing']);
  for (let i = 0; i < 90; i++) writeFileSync(join(w, `p${String(i).padStart(2, '0')}.md`), fm({ title: `P${i}`, covers: ['src/**'], verified: sha }) + 'x\n');
  writeIndex(root, DEFAULTS);
  assert.ok(lint(root, { config: DEFAULTS }).errors.some((e) => e.rule === 'index-too-long'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/lint.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `lib/files.mjs` and switch `detect.mjs` to it**

`plugins/ship-faster/scripts/lib/files.mjs`:

```js
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRepo, trackedFiles } from './git.mjs';

export const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'bin', 'obj', 'vendor', '.venv', 'venv', '__pycache__']);

export function listRepoFiles(root) {
  if (isRepo(root)) return trackedFiles(root);
  const out = [];
  const stack = [''];
  while (stack.length && out.length < 20000) {
    const rel = stack.pop();
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(r); }
      else if (e.isFile()) out.push(r);
    }
  }
  return out.sort();
}
```

In `detect.mjs`: delete `SKIP_DIRS` and `walkFiles`, add `import { listRepoFiles } from './lib/files.mjs';`, and replace `const files = isRepo ? git.trackedFiles(root) : walkFiles(root);` with `const files = listRepoFiles(root);`. Run `node --test plugins/ship-faster/tests/detect.test.mjs` and expect it to still pass.

- [ ] **Step 4: Write `lint.mjs`**

`plugins/ship-faster/scripts/lint.mjs`:

```js
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { listRepoFiles } from './lib/files.mjs';
import { parseFrontmatter } from './lib/fm.mjs';
import * as git from './lib/git.mjs';
import { compileGlob, normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { REQUIRED_FIELDS, loadWiki, relPath, wikiDir } from './lib/wiki.mjs';
import { buildIndex } from './index.mjs';

const SECRETS = [
  /AKIA[0-9A-Z]{16}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];
const ASSIGN = /\b(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*["']?([^\s"'<${*]{8,})/i;
const PLACEHOLDER = /^(your|example|changeme|redacted|xxxx)/i;

export function lint(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const errors = [];
  const warnings = [];
  const err = (file, line, rule, message) => errors.push({ file, line, rule, message });
  const warn = (file, line, rule, message) => warnings.push({ file, line, rule, message });
  const files = listRepoFiles(root);
  const topLevel = new Set(files.map((f) => f.split('/')[0]));
  const pkgScripts = readScripts(root);
  const isRepo = git.isRepo(root);

  const wiki = loadWiki(root, config);
  const titles = new Map();
  for (const p of wiki.pages) {
    const text = readFileSync(p.file, 'utf8');
    if (!p.data) { err(p.rel, 1, 'frontmatter-missing', 'page has no frontmatter'); }
    for (const e of p.errors) err(p.rel, e.line, 'frontmatter-invalid', e.message);
    if (p.data) {
      for (const k of REQUIRED_FIELDS) if (!(k in p.data)) err(p.rel, 1, 'frontmatter-required', `missing ${k}`);
      if (!Array.isArray(p.data.covers) || p.data.covers.length === 0) err(p.rel, 1, 'covers-empty', 'covers must be a non-empty list');
      else for (const g of p.data.covers) {
        const re = compileGlob(String(g));
        if (!files.some((f) => re.test(f))) err(p.rel, 1, 'covers-no-match', `covers glob matches no file: ${g}`);
      }
      if (typeof p.data.title === 'string') {
        if (titles.has(p.data.title)) err(p.rel, 1, 'duplicate-title', `title also used by ${titles.get(p.data.title)}`);
        else titles.set(p.data.title, p.rel);
      }
      if (typeof p.data.verified === 'string' && p.data.verified !== 'unverified' && isRepo && !git.commitExists(root, p.data.verified)) {
        warn(p.rel, 1, 'verified-missing', `verified commit ${p.data.verified.slice(0, 7)} is not in history`);
      }
      if (p.rel.endsWith('/commands.md') && 'checks' in p.data) {
        const c = p.data.checks;
        const okShape = Array.isArray(c) && c.every((x) => x && typeof x === 'object' && typeof x.run === 'string' && x.run.trim());
        if (!okShape) err(p.rel, 1, 'checks-shape', 'checks must be a list of maps with a non-empty run');
      }
    }
    if (p.lines > config.pageMaxLines) err(p.rel, null, 'page-too-long', `${p.lines} lines, limit ${config.pageMaxLines}`);
    scanBody(root, p.file, p.rel, text, { err, warn, topLevel, files, pkgScripts, paths: true });
  }

  const wdir = wikiDir(root, config);
  const indexFile = join(wdir, 'index.md');
  if (wiki.pages.length) {
    const built = buildIndex(root, config);
    if (built.changed) err(relPath(root, indexFile), null, 'index-stale', 'index.md differs from the generated index');
    if (existsSync(indexFile) && countLines(readFileSync(indexFile, 'utf8')) > 80) err(relPath(root, indexFile), null, 'index-too-long', 'index over 80 lines');
  }

  const claude = join(root, 'CLAUDE.md');
  if (existsSync(claude)) {
    const text = readFileSync(claude, 'utf8');
    const n = countLines(text);
    if (n > config.claudeMdMaxLines) err('CLAUDE.md', null, 'claude-md-too-long', `${n} lines, limit ${config.claudeMdMaxLines}`);
    scanBody(root, claude, 'CLAUDE.md', text, { err, warn, topLevel, files, pkgScripts, paths: true });
  }

  const rulesDir = join(root, ...config.rulesDir.split('/'));
  if (existsSync(rulesDir)) {
    for (const name of readdirSync(rulesDir).filter((f) => f.endsWith('.md'))) {
      const file = join(rulesDir, name);
      const rel = relPath(root, file);
      const text = readFileSync(file, 'utf8');
      const { data, errors: fmErrors } = parseFrontmatter(text);
      for (const e of fmErrors) err(rel, e.line, 'frontmatter-invalid', e.message);
      if (!data || !Array.isArray(data.paths) || data.paths.length === 0) warn(rel, 1, 'rules-no-paths', 'rules file has no paths list and will load in every session');
      const n = countLines(text);
      if (n > config.rulesFileMaxLines) err(rel, null, 'rules-too-long', `${n} lines, limit ${config.rulesFileMaxLines}`);
      scanBody(root, file, rel, text, { err, warn, topLevel, files, pkgScripts, paths: false });
    }
  }

  const summary = [`${errors.length} error(s), ${warnings.length} warning(s)`, ...errors.slice(0, 20).map((e) => `${e.file}${e.line ? ':' + e.line : ''} ${e.rule}: ${e.message}`)];
  return { ok: errors.length === 0, errors, warnings, summary };
}

function countLines(text) {
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function readScripts(root) {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || null; } catch { return null; }
}

function scanBody(root, file, rel, text, { err, warn, topLevel, files, pkgScripts, paths }) {
  const lines = text.split(/\r?\n/);
  const fileSet = new Set(files);
  let inFence = false;
  lines.forEach((line, i) => {
    const no = i + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;
    for (const re of SECRETS) if (re.test(line)) { err(rel, no, 'secret', 'line matches a credential pattern'); return; }
    const a = ASSIGN.exec(line);
    if (a && !PLACEHOLDER.test(a[2])) { err(rel, no, 'secret', `${a[1]} assignment with a literal value`); return; }
    for (const m of line.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target) continue;
      if (!existsSync(resolve(dirname(file), target))) err(rel, no, 'link-missing', `link target not found: ${m[1]}`);
    }
    if (inFence) return;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const tok = m[1].trim();
      const script = /^(?:npm|pnpm|yarn) run ([\w:.-]+)/.exec(tok);
      if (script && pkgScripts && !(script[1] in pkgScripts)) warn(rel, no, 'script-missing', `package.json has no script "${script[1]}"`);
      if (!paths) continue;
      if (!tok.includes('/') || /\s|[*?{}<>$]|^https?:|^\.\.?$/.test(tok) || tok.length > 120 || tok.startsWith('-')) continue;
      const p = normalizePath(tok).replace(/^\.\//, '').replace(/\/$/, '');
      if (!topLevel.has(p.split('/')[0])) continue;
      if (fileSet.has(p) || existsSync(join(root, p))) continue;
      warn(rel, no, 'path-missing', `path does not exist: ${tok}`);
    }
  });
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/lint.mjs')) {
  runMain((_, flags) => {
    const r = lint(resolveRoot(flags));
    process.on('exit', () => { if (r.errors.length) process.exitCode = 1; });
    return r;
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/lint.test.mjs plugins/ship-faster/tests/detect.test.mjs`
Expected: all PASS. The `secret` finding is on line 9: the fixture's `fm()` emits six keys (`summary`, `read_when`, `updated`, `title`, `covers`, `verified`) between two `---` delimiters, so the body starts on line 9. If the reported line differs, the serializer is not preserving insertion order.

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/lib/files.mjs plugins/ship-faster/scripts/detect.mjs plugins/ship-faster/scripts/lint.mjs plugins/ship-faster/tests/lint.test.mjs
git commit -m "feat: lint wiki pages, CLAUDE.md, and rules for budget, links, covers, secrets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `checks.mjs` resolve and run checks

**Files:**
- Create: `plugins/ship-faster/scripts/checks.mjs`
- Test: `plugins/ship-faster/tests/checks.test.mjs`

**Interfaces:**
- Consumes: `detect` (Task 8), `loadWiki`, `wikiDir` (Task 7), `loadConfig` (Task 6), `preflightDir`, `writeJsonAtomic`, `readJson` (Task 6), `git.head` (Task 5), `runMain` (Task 2), `resolveRoot` (Task 8).
- Produces:
  - `resolveChecks(root, { config } = {}) → { ok: true, source: 'wiki'|'ci'|'detect'|'none', checks: Check[], excluded: Array<{ name, run, why }> }` with `Check = { name: string, run: string, timeout: number, source: string }`.
  - `runChecks(root, { config, checks, continueOnFail = false } = {}) → { ok: true, passed: boolean, source, at: string, head: string|null, checks: Array<{ name, run, status: 'pass'|'fail'|'timeout'|'skipped', exitCode: number|null, durationMs: number, tail: string, log: string|null }>, lastJson: string, summary: string[] }`.
  - CLI: `node scripts/checks.mjs resolve [--root <dir>] [--json]` and `node scripts/checks.mjs run [--root <dir>] [--continue] [--json]`.
- Resolution order: `commands.md` `checks` (source `wiki`) → CI files (source `ci`) → `detect().suggestedChecks` (source `detect`) → none. CI extraction reads `run:` (GitHub), `script:` list items (GitLab), and `script:`/`bash:`/`pwsh:` values (Azure). Block scalars (`run: |`) contribute one check per non-empty line. Excluded, with a reason: install steps (`npm ci|install|i`, `pnpm install`, `yarn install`, `pip install`, `poetry install`, `dotnet restore`, `go mod download`, `cargo fetch`, `bundle install`), anything containing `${{`, commands or step names matching `deploy|publish|release|push|upload|docker (build|push)|terraform apply|kubectl apply|aws s3`, and pure `echo` lines. Duplicates by command text are dropped.
- Execution: sequential, `shell: true`, `cwd: root`, `NO_COLOR=1` and `FORCE_COLOR=0` in the environment, per-check `timeout` seconds (`config.checkTimeoutSeconds` when a check has none). Combined stdout+stderr is written to `<preflightDir>/<at>-<name>.log`; `tail` is the last 60 lines capped at 4,096 characters. The first non-pass stops the run and marks the rest `skipped`, unless `continueOnFail`. The result is written to `<preflightDir>/last.json`, and log files from all but the ten most recent `at` stamps are deleted.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/checks.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { preflightDir } from '../scripts/lib/state.mjs';
import { resolveChecks, runChecks } from '../scripts/checks.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const CI = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Test
        run: npm test
      - run: |
          npm run lint
          npm run build
      - run: echo done
      - run: npx vitest --shard=\${{ matrix.shard }}
      - name: Deploy
        run: npm run deploy
      - run: gh release create v1
`;

test('resolve prefers wiki checks, then ci, then detect', () => {
  const { root } = makeRepo({ files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }), '.github/workflows/ci.yml': CI } });
  const ci = resolveChecks(root, { config: DEFAULTS });
  assert.equal(ci.source, 'ci');
  assert.deepEqual(ci.checks.map((c) => [c.name, c.run]), [['Test', 'npm test'], ['check-3', 'npm run lint'], ['check-4', 'npm run build']]);
  assert.deepEqual(ci.excluded.map((e) => e.run), ['npm ci', 'echo done', 'npx vitest --shard=${{ matrix.shard }}', 'npm run deploy', 'gh release create v1']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'commands.md'), serializeFrontmatter({ title: 'Commands', summary: 's', read_when: 'r', covers: ['package.json'], verified: 'abc', updated: '2026-09-16', checks: [{ name: 'unit', run: 'node -e 0', timeout: 30 }] }) + '# C\n');
  const wiki = resolveChecks(root, { config: DEFAULTS });
  assert.equal(wiki.source, 'wiki');
  assert.deepEqual(wiki.checks, [{ name: 'unit', run: 'node -e 0', timeout: 30, source: 'wiki' }]);
  const plain = resolveChecks(makeRepo({ files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }) } }).root, { config: DEFAULTS });
  assert.equal(plain.source, 'detect');
  assert.deepEqual(plain.checks.map((c) => c.run), ['npm test']);
  assert.equal(resolveChecks(makeRepo({ files: { 'a.txt': '' } }).root, { config: DEFAULTS }).source, 'none');
});

test('run stops at the first failure, records tails and logs, writes last.json', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const checks = [
    { name: 'ok', run: 'node -e "process.exit(0)"', timeout: 30, source: 'test' },
    { name: 'bad', run: 'node -e "console.log(12345); console.error(\'oops\'); process.exit(3)"', timeout: 30, source: 'test' },
    { name: 'never', run: 'node -e "process.exit(0)"', timeout: 30, source: 'test' },
  ];
  const r = runChecks(root, { config: DEFAULTS, checks });
  assert.equal(r.passed, false);
  assert.deepEqual(r.checks.map((c) => c.status), ['pass', 'fail', 'skipped']);
  assert.equal(r.checks[1].exitCode, 3);
  assert.match(r.checks[1].tail, /12345/);
  assert.match(r.checks[1].tail, /oops/);
  assert.ok(existsSync(r.checks[1].log));
  assert.equal(r.checks[2].log, null);
  const last = JSON.parse(readFileSync(join(preflightDir(root), 'last.json'), 'utf8'));
  assert.equal(last.passed, false);
  assert.equal(last.checks.length, 3);
  assert.match(r.summary[0], /FAIL at bad/);
  const all = runChecks(root, { config: DEFAULTS, checks, continueOnFail: true });
  assert.deepEqual(all.checks.map((c) => c.status), ['pass', 'fail', 'pass']);
});

test('timeouts are reported and old logs are pruned to ten runs', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const slow = [{ name: 'slow', run: 'node -e "setTimeout(function(){}, 5000)"', timeout: 1, source: 'test' }];
  const r = runChecks(root, { config: DEFAULTS, checks: slow });
  assert.equal(r.checks[0].status, 'timeout');
  assert.equal(r.passed, false);
  const fast = [{ name: 'f', run: 'node -e 0', timeout: 30, source: 'test' }];
  for (let i = 0; i < 12; i++) runChecks(root, { config: DEFAULTS, checks: fast });
  const stamps = new Set(readdirSync(preflightDir(root)).filter((n) => n.endsWith('.log')).map((n) => n.split('-f.log')[0]));
  assert.ok(stamps.size <= 10, `expected at most 10 runs of logs, got ${stamps.size}`);
});

test('cli resolve and run', () => {
  const { root } = makeRepo({ files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }) } });
  const res = runScript('checks', ['resolve', '--root', root, '--json']);
  assert.equal(res.json.source, 'detect');
  const run = runScript('checks', ['run', '--root', root, '--json']);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.passed, true);
  assert.equal(run.code, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/checks.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`plugins/ship-faster/scripts/checks.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { preflightDir, writeJsonAtomic } from './lib/state.mjs';
import { loadWiki } from './lib/wiki.mjs';
import { detect } from './detect.mjs';

const INSTALL = /^(npm (ci|install|i)\b|pnpm (install|i)\b|yarn( install)?$|pip3? install|poetry install|dotnet restore|go mod download|cargo fetch|bundle install)/;
const UNSAFE = /deploy|publish|release|\bpush\b|upload|docker (build|push)|terraform apply|kubectl apply|aws s3/i;

function classify(run, stepName) {
  if (run.includes('${{')) return 'uses a CI expression that cannot be resolved locally';
  if (INSTALL.test(run)) return 'install step';
  if (/^echo\b/.test(run)) return 'echo only';
  if (UNSAFE.test(run) || (stepName && UNSAFE.test(stepName))) return 'deploy-like command is never run locally';
  return null;
}

function extractCi(root, ciFiles) {
  const found = [];
  for (const { path } of ciFiles) {
    let text;
    try { text = readFileSync(join(root, path), 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    let stepName = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nm = /^\s*-?\s*name:\s*(.+)$/.exec(line);
      if (nm) { stepName = nm[1].trim().replace(/^["']|["']$/g, ''); continue; }
      const m = /^(\s*)(?:-\s*)?(run|script|bash|pwsh):\s*(.*)$/.exec(line);
      if (!m) continue;
      const indent = m[1].length;
      const value = m[3].trim();
      if (value === '' || /^[|>][-+]?$/.test(value)) {
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j];
          if (!l.trim()) continue;
          if (l.match(/^\s*/)[0].length <= indent) break;
          const item = l.trim().replace(/^-\s*/, '');
          if (item) found.push({ run: item, stepName });
          i = j;
        }
      } else {
        found.push({ run: value.replace(/^["']|["']$/g, ''), stepName });
      }
      stepName = null;
    }
  }
  return found;
}

export function resolveChecks(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const timeout = config.checkTimeoutSeconds;
  const wiki = loadWiki(root, config);
  const commands = wiki.pages.find((p) => p.rel.endsWith('/commands.md') && p.data && Array.isArray(p.data.checks));
  if (commands) {
    const valid = commands.data.checks.filter((c) => c && typeof c.run === 'string' && c.run.trim());
    if (valid.length) {
      return { ok: true, source: 'wiki', excluded: [], checks: valid.map((c, i) => ({ name: String(c.name || `check-${i + 1}`), run: c.run.trim(), timeout: Number.isInteger(c.timeout) && c.timeout > 0 ? c.timeout : timeout, source: 'wiki' })) };
    }
  }
  const facts = detect(root);
  const excluded = [];
  const checks = [];
  const seen = new Set();
  extractCi(root, facts.ci).forEach((c, i) => {
    if (seen.has(c.run)) return;
    seen.add(c.run);
    const why = classify(c.run, c.stepName);
    const name = c.stepName || `check-${i + 1}`;
    if (why) excluded.push({ name, run: c.run, why });
    else checks.push({ name, run: c.run, timeout, source: 'ci' });
  });
  if (checks.length) return { ok: true, source: 'ci', checks, excluded };
  if (facts.suggestedChecks.length) return { ok: true, source: 'detect', checks: facts.suggestedChecks.map((c) => ({ ...c, timeout: c.timeout || timeout })), excluded };
  return { ok: true, source: 'none', checks: [], excluded };
}

function tailOf(text, lines = 60, max = 4096) {
  const t = text.split(/\r?\n/).slice(-lines).join('\n');
  return t.length > max ? t.slice(-max) : t;
}

function prune(dir, keep = 10) {
  const logs = readdirSync(dir).filter((n) => n.endsWith('.log'));
  const stamps = [...new Set(logs.map((n) => n.slice(0, 24)))].sort();
  for (const s of stamps.slice(0, Math.max(0, stamps.length - keep))) {
    for (const n of logs) if (n.startsWith(s)) rmSync(join(dir, n), { force: true });
  }
}

export function runChecks(root, { config, checks, continueOnFail = false } = {}) {
  config = config || loadConfig(root).config;
  let source = 'given';
  if (!checks) { const r = resolveChecks(root, { config }); checks = r.checks; source = r.source; }
  const dir = preflightDir(root);
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];
  let stop = false;
  let totalMs = 0;
  for (const c of checks) {
    if (stop) { results.push({ name: c.name, run: c.run, status: 'skipped', exitCode: null, durationMs: 0, tail: '', log: null }); continue; }
    const started = Date.now();
    const r = spawnSync(c.run, { shell: true, cwd: root, encoding: 'utf8', timeout: (c.timeout || config.checkTimeoutSeconds) * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, windowsHide: true });
    const durationMs = Date.now() - started;
    totalMs += durationMs;
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
    const status = timedOut ? 'timeout' : r.status === 0 ? 'pass' : 'fail';
    const log = join(dir, `${at}-${c.name.replace(/[^\w.-]+/g, '_')}.log`);
    writeFileSync(log, `$ ${c.run}\n${output}`);
    results.push({ name: c.name, run: c.run, status, exitCode: r.status ?? null, durationMs, tail: status === 'pass' ? '' : tailOf(output), log: normalizePath(log) });
    if (status !== 'pass' && !continueOnFail) stop = true;
  }
  const passed = results.every((r) => r.status === 'pass');
  const first = results.find((r) => r.status !== 'pass' && r.status !== 'skipped');
  const result = {
    ok: true,
    passed,
    source,
    at,
    head: git.head(root),
    checks: results,
    lastJson: normalizePath(join(dir, 'last.json')),
    summary: [passed ? `preflight: PASS (${results.length} checks, ${(totalMs / 1000).toFixed(1)}s)` : `preflight: FAIL at ${first ? first.name : '?'} (${first ? first.status + (first.exitCode !== null ? ' exit ' + first.exitCode : '') : ''}, ${(totalMs / 1000).toFixed(1)}s)${first && first.log ? ` log: ${first.log}` : ''}`],
  };
  writeJsonAtomic(join(dir, 'last.json'), result);
  prune(dir);
  return result;
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/checks.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const cmd = positional[0] || 'resolve';
    if (cmd === 'resolve') {
      const r = resolveChecks(root, { config });
      return { ...r, summary: [`${r.checks.length} check(s) from ${r.source}`, ...r.checks.map((c) => `${c.name}: ${c.run}`), ...r.excluded.map((e) => `excluded ${e.run} (${e.why})`)] };
    }
    if (cmd === 'run') return runChecks(root, { config, continueOnFail: Boolean(flags.continue) });
    return { ok: false, error: `unknown command ${cmd}; use resolve or run` };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/checks.test.mjs`
Expected: 4 tests PASS. The timeout test takes about one second. If the CI test's `check-3`/`check-4` names differ, the index `i` in `extractCi(...).forEach` counts every extracted command including excluded ones; that is intended and the fixture expects it.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/scripts/checks.mjs plugins/ship-faster/tests/checks.test.mjs
git commit -m "feat: resolve checks from wiki, ci, or detection and run them with logs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `plan.mjs` plan files

**Files:**
- Modify: `plugins/ship-faster/scripts/lib/git.mjs` (export `branchExists`, add `isMerged`)
- Create: `plugins/ship-faster/scripts/plan.mjs`
- Test: `plugins/ship-faster/tests/plan.test.mjs`

**Interfaces:**
- `git.mjs` additions: `export function branchExists(cwd, name) → boolean` (the existing private helper, exported) and `export function isMerged(cwd, branch, into) → boolean` (`git merge-base --is-ancestor <branch> <into>`).
- `plan.mjs` produces:
  - `listPlans(root, { config }) → Array<{ file, rel, data, errors }>` from `<plansDir>/*.md` (non-recursive, sorted by file name).
  - `findPlan(root, { config, branch }) → { ok: true, plan: { file, rel, data } | null }`: the newest plan (by `created`, then file name) whose `branch` equals the argument and whose `status` is `active` or absent.
  - `stalePlans(root, { config, days = 30 }) → { ok: true, plans: Array<{ rel, branch, created, reason: 'branch merged' | 'branch gone' }> }`: active plans created more than `days` ago whose branch is merged into the default branch or no longer exists.
  - `setPlanStatus(root, fileOrRel, status) → { ok: true, rel, status }`; `status` must be `active`, `shipped`, or `abandoned`, else `{ ok: false, error }`.
  - CLI: `node scripts/plan.mjs find --branch <name>`, `node scripts/plan.mjs stale [--days n]`, `node scripts/plan.mjs set-status <file> <status>`, all with `[--root] [--json]`.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/plan.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, cleanupAll } from './helpers.mjs';
import { parseFrontmatter, serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { branchExists, isMerged } from '../scripts/lib/git.mjs';
import { findPlan, stalePlans, setPlanStatus } from '../scripts/plan.mjs';

after(cleanupAll);

const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const plan = (title, branch, created, status = 'active') => serializeFrontmatter({ title, branch, status, created, pages: ['architecture'] }) + `# ${title}\n\n## Goal\n`;

test('findPlan picks the newest active plan for a branch; set-status rewrites frontmatter', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  const dir = join(root, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-09-01-old.md'), plan('Old', 'feat/x', '2026-09-01'));
  writeFileSync(join(dir, '2026-09-10-new.md'), plan('New', 'feat/x', '2026-09-10'));
  writeFileSync(join(dir, '2026-09-12-shipped.md'), plan('Shipped', 'feat/x', '2026-09-12', 'shipped'));
  writeFileSync(join(dir, '2026-09-12-other.md'), plan('Other', 'feat/y', '2026-09-12'));
  const found = findPlan(root, { config: DEFAULTS, branch: 'feat/x' });
  assert.equal(found.plan.data.title, 'New');
  assert.equal(findPlan(root, { config: DEFAULTS, branch: 'feat/none' }).plan, null);
  const set = setPlanStatus(root, 'docs/plans/2026-09-10-new.md', 'shipped');
  assert.equal(set.ok, true);
  assert.equal(parseFrontmatter(readFileSync(join(dir, '2026-09-10-new.md'), 'utf8')).data.status, 'shipped');
  assert.equal(findPlan(root, { config: DEFAULTS, branch: 'feat/x' }).plan.data.title, 'Old');
  assert.equal(setPlanStatus(root, 'docs/plans/2026-09-10-new.md', 'bogus').ok, false);
  const cli = runScript('plan', ['find', '--branch', 'feat/y', '--root', root, '--json']);
  assert.equal(cli.json.plan.data.title, 'Other');
});

test('stalePlans flags merged and missing branches older than the window', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': '' } });
  git(['checkout', '-q', '-b', 'feat/merged']);
  writeFileSync(join(root, 'b.txt'), 'b');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'b']);
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--no-ff', '-m', 'merge', 'feat/merged']);
  git(['checkout', '-q', '-b', 'feat/open']);
  writeFileSync(join(root, 'c.txt'), 'c');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'c']);
  git(['checkout', '-q', 'main']);
  assert.equal(branchExists(root, 'feat/open'), true);
  assert.equal(isMerged(root, 'feat/merged', 'main'), true);
  assert.equal(isMerged(root, 'feat/open', 'main'), false);
  const dir = join(root, 'docs', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.md'), plan('Merged old', 'feat/merged', daysAgo(45)));
  writeFileSync(join(dir, 'b.md'), plan('Gone old', 'feat/gone', daysAgo(45)));
  writeFileSync(join(dir, 'c.md'), plan('Open old', 'feat/open', daysAgo(45)));
  writeFileSync(join(dir, 'd.md'), plan('Merged recent', 'feat/merged', daysAgo(2)));
  writeFileSync(join(dir, 'e.md'), plan('Shipped old', 'feat/merged', daysAgo(45), 'shipped'));
  const r = stalePlans(root, { config: DEFAULTS });
  assert.deepEqual(r.plans.map((p) => [p.rel.split('/').pop(), p.reason]), [['a.md', 'branch merged'], ['b.md', 'branch gone']]);
  assert.deepEqual(stalePlans(root, { config: DEFAULTS, days: 1 }).plans.map((p) => p.rel.split('/').pop()), ['a.md', 'b.md', 'd.md']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/plan.test.mjs`
Expected: FAIL, `branchExists` is not exported / module not found.

- [ ] **Step 3: Extend `lib/git.mjs`**

Change the private `function branchExists` to `export function branchExists(cwd, name)` and add:

```js
export function isMerged(cwd, branch, into) {
  if (!branchExists(cwd, branch) || !into) return false;
  return git(['merge-base', '--is-ancestor', branch, into], { cwd }).ok;
}
```

- [ ] **Step 4: Write `plan.mjs`**

`plugins/ship-faster/scripts/plan.mjs`:

```js
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { parseFrontmatter, updateFrontmatter } from './lib/fm.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { relPath } from './lib/wiki.mjs';

const STATUSES = new Set(['active', 'shipped', 'abandoned']);

function plansDir(root, config) {
  return join(root, ...config.plansDir.split('/'));
}

export function listPlans(root, { config } = {}) {
  config = config || loadConfig(root).config;
  const dir = plansDir(root, config);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => {
    const file = join(dir, n);
    const { data, errors } = parseFrontmatter(readFileSync(file, 'utf8'));
    return { file, rel: relPath(root, file), data: data || {}, errors };
  });
}

const isActive = (p) => !p.data.status || p.data.status === 'active';

export function findPlan(root, { config, branch } = {}) {
  config = config || loadConfig(root).config;
  const matches = listPlans(root, { config }).filter((p) => isActive(p) && p.data.branch === branch);
  matches.sort((a, b) => String(b.data.created || '').localeCompare(String(a.data.created || '')) || b.rel.localeCompare(a.rel));
  const plan = matches[0] ? { file: matches[0].file, rel: matches[0].rel, data: matches[0].data } : null;
  return { ok: true, plan, summary: [plan ? `plan for ${branch}: ${plan.rel}` : `no active plan for ${branch}`] };
}

export function stalePlans(root, { config, days = 30 } = {}) {
  config = config || loadConfig(root).config;
  const cutoff = Date.now() - days * 86400_000;
  const base = git.isRepo(root) ? git.defaultBranch(root) : null;
  const plans = [];
  for (const p of listPlans(root, { config })) {
    if (!isActive(p) || !p.data.branch || !p.data.created) continue;
    const created = Date.parse(String(p.data.created));
    if (Number.isNaN(created) || created > cutoff) continue;
    const branch = String(p.data.branch);
    let reason = null;
    if (!git.branchExists(root, branch)) reason = 'branch gone';
    else if (base && git.isMerged(root, branch, base)) reason = 'branch merged';
    if (reason) plans.push({ rel: p.rel, branch, created: String(p.data.created), reason });
  }
  return { ok: true, plans, summary: [`${plans.length} stale plan(s)`, ...plans.map((p) => `${p.rel}: ${p.reason}`)] };
}

export function setPlanStatus(root, fileOrRel, status) {
  if (!STATUSES.has(status)) return { ok: false, error: `status must be one of ${[...STATUSES].join(', ')}` };
  const file = isAbsolute(fileOrRel) ? fileOrRel : join(root, ...normalizePath(fileOrRel).split('/'));
  if (!existsSync(file)) return { ok: false, error: `plan not found: ${fileOrRel}` };
  writeFileSync(file, updateFrontmatter(readFileSync(file, 'utf8'), { status }));
  const rel = relPath(root, file);
  return { ok: true, rel, status, summary: [`${rel}: status ${status}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/plan.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const [cmd, a, b] = positional;
    if (cmd === 'find') return typeof flags.branch === 'string' ? findPlan(root, { config, branch: flags.branch }) : { ok: false, error: 'find requires --branch <name>' };
    if (cmd === 'stale') return stalePlans(root, { config, days: flags.days ? Number(flags.days) : 30 });
    if (cmd === 'set-status') return a && b ? setPlanStatus(root, a, b) : { ok: false, error: 'set-status requires <file> <status>' };
    return { ok: false, error: `unknown command ${cmd}; use find, stale, or set-status` };
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/plan.test.mjs plugins/ship-faster/tests/git.test.mjs`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/lib/git.mjs plugins/ship-faster/scripts/plan.mjs plugins/ship-faster/tests/plan.test.mjs
git commit -m "feat: find, expire, and update plan files by branch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: `hooks/hooks.json` and `hook-session-start.mjs`

**Files:**
- Create: `plugins/ship-faster/hooks/hooks.json` (SessionStart entry only; Tasks 16 and 17 add the others so the validator stays green at every commit)
- Create: `plugins/ship-faster/scripts/hook-session-start.mjs`
- Test: `plugins/ship-faster/tests/hook-session-start.test.mjs`

**Interfaces:**
- Consumes: `readStdinJson` (Task 2), `loadConfig` (Task 6), `git.repoRoot/isRepo/trackedFiles/currentBranch` (Task 5), `listPages` (Task 7), `stale` (Task 10), `findPlan` (Task 14), `projectDir`, `readJson` (Task 6).
- Produces the SessionStart hook. Input: `{ session_id, cwd, hook_event_name, source }`. Output: zero to three plain-text lines on stdout, total under 600 characters, exit 0 always.
- Behaviour:
  - Wiki present (an `index.md` or any page under `wikiDir`): line 1 on every source: `ship-faster: wiki at <wikiDir>/index.md (<n> pages). <All pages fresh. | Stale: <k> (<up to four names>[, …]) → /ship-faster:sync-docs.>[ Rules: <rulesDir> (<m> files).]`. On `startup` and `resume` only: line 2 `ship-faster: active plan for branch <branch>: <rel>` when `findPlan` finds one for the current branch; line 3 `ship-faster: health audit <has not run | last ran N days ago> → /ship-faster:health` when overdue. Overdue means `health.json.lastRun` is older than `healthCadenceDays`, or there is no `health.json` and `project.json.createdAt` is older than `healthCadenceDays`.
  - No wiki: on `startup` only, when there is no `CLAUDE.md` and the repo has at least 20 tracked files: `ship-faster: no CLAUDE.md or <wikiDir> here (<n> tracked files). /ship-faster:onboard generates them.`
  - Anything else, or any error: no output.

- [ ] **Step 1: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact|fork",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-session-start.mjs\"", "timeout": 10 }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

`plugins/ship-faster/tests/hook-session-start.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { projectDir, writeJsonAtomic } from '../scripts/lib/state.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const hook = (input, cwd) => runScript('hook-session-start', [], { cwd, stdin: input, env: { CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA } });
const page = (title, covers, verified) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified, updated: '2026-09-16' }) + `# ${title}\n`;

function bigRepo(extra = {}) {
  const files = { ...extra };
  for (let i = 0; i < 25; i++) files[`src/f${i}.ts`] = `${i}`;
  return makeRepo({ files });
}

test('silent for a small repo without a wiki, suggests onboard for a bigger one on startup only', () => {
  const small = makeRepo({ files: { 'a.txt': '' } });
  const r1 = hook({ session_id: 's', cwd: small.root, source: 'startup' }, small.root);
  assert.equal(r1.code, 0);
  assert.equal(r1.stdout, '');
  const big = bigRepo();
  const r2 = hook({ session_id: 's', cwd: big.root, source: 'startup' }, big.root);
  assert.match(r2.stdout, /no CLAUDE\.md or docs\/wiki here \(25 tracked files\)\. \/ship-faster:onboard/);
  assert.equal(hook({ session_id: 's', cwd: big.root, source: 'compact' }, big.root).stdout, '');
  const withClaude = bigRepo({ 'CLAUDE.md': '# x\n' });
  assert.equal(hook({ session_id: 's', cwd: withClaude.root, source: 'startup' }, withClaude.root).stdout, '');
});

test('reports wiki, stale pages, rules, plan, and overdue health; compact gets only line one', () => {
  const { root, git } = bigRepo({ 'lib/x.ts': 'x' });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'x.ts'), 'x2');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'x']);
  const head = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'feat/sso']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'commands.md'), page('Commands', ['lib/**'], first));
  writeFileSync(join(w, 'testing.md'), page('Testing', ['src/**'], head));
  mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(root, '.claude', 'rules', 'api.md'), '---\npaths: ["src/**"]\n---\n- rule\n');
  mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
  writeFileSync(join(root, 'docs', 'plans', '2026-09-16-sso.md'), serializeFrontmatter({ title: 'SSO', branch: 'feat/sso', status: 'active', created: '2026-09-16' }) + '# SSO\n');
  writeJsonAtomic(join(projectDir(root), 'health.json'), { lastRun: new Date(Date.now() - 21 * 86400_000).toISOString() });

  const r = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 3, r.stdout);
  assert.match(lines[0], /^ship-faster: wiki at docs\/wiki\/index\.md \(2 pages\)\. Stale: 1 \(commands\) → \/ship-faster:sync-docs\. Rules: \.claude\/rules \(1 files\)\.$/);
  assert.equal(lines[1], 'ship-faster: active plan for branch feat/sso: docs/plans/2026-09-16-sso.md');
  assert.equal(lines[2], 'ship-faster: health audit last ran 21 days ago → /ship-faster:health');
  assert.ok(r.stdout.length <= 600);
  const compact = hook({ session_id: 's', cwd: root, source: 'compact' }, root);
  assert.equal(compact.stdout.trim().split('\n').length, 1);
  assert.match(compact.stdout, /wiki at/);
});

test('fresh project without health.json gets no health line; garbage input exits 0 silently', () => {
  const { root } = bigRepo();
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  const r = hook({ session_id: 's', cwd: root, source: 'startup' }, root);
  assert.match(r.stdout, /All pages fresh|0 pages/);
  assert.ok(!r.stdout.includes('health'));
  assert.equal(hook('not json', root).code, 0);
  assert.equal(hook('not json', root).stdout, '');
  const gone = hook({ session_id: 's', cwd: join(root, 'does-not-exist'), source: 'startup' }, root);
  assert.equal(gone.code, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/hook-session-start.test.mjs`
Expected: FAIL, the script does not exist (`runScript` returns a non-zero code / empty json).

- [ ] **Step 4: Write the hook**

`plugins/ship-faster/scripts/hook-session-start.mjs`:

```js
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { projectDir, readJson } from './lib/state.mjs';
import { listPages } from './lib/wiki.mjs';
import { findPlan } from './plan.mjs';
import { stale } from './stale.mjs';

const MAX = 600;

async function main() {
  const input = await readStdinJson(1000);
  if (!input) return;
  const cwd = typeof input.cwd === 'string' && existsSync(input.cwd) ? input.cwd : process.cwd();
  const source = typeof input.source === 'string' ? input.source : 'startup';
  const root = git.repoRoot(cwd) || normalizePath(cwd);
  const { config } = loadConfig(root);
  const lines = [];
  const pages = listPages(root, config);
  const hasWiki = pages.length > 0 || existsSync(join(root, ...config.wikiDir.split('/'), 'index.md'));

  if (hasWiki) {
    const s = stale(root, { config });
    const notFresh = s.pages.filter((p) => p.status !== 'fresh').map((p) => p.rel.split('/').pop().replace(/\.md$/, ''));
    let line = `ship-faster: wiki at ${config.wikiDir}/index.md (${pages.length} pages).`;
    line += notFresh.length ? ` Stale: ${notFresh.length} (${notFresh.slice(0, 4).join(', ')}${notFresh.length > 4 ? ', …' : ''}) → /ship-faster:sync-docs.` : ' All pages fresh.';
    const rulesDir = join(root, ...config.rulesDir.split('/'));
    const rules = existsSync(rulesDir) ? readdirSync(rulesDir).filter((n) => n.endsWith('.md')).length : 0;
    if (rules) line += ` Rules: ${config.rulesDir} (${rules} files).`;
    lines.push(line);
    if (source === 'startup' || source === 'resume') {
      const branch = git.currentBranch(root);
      if (branch) {
        const { plan } = findPlan(root, { config, branch });
        if (plan) lines.push(`ship-faster: active plan for branch ${branch}: ${plan.rel}`);
      }
      const health = healthLine(root, config);
      if (health) lines.push(health);
    }
  } else if (source === 'startup' && !existsSync(join(root, 'CLAUDE.md')) && git.isRepo(root)) {
    const n = git.trackedFiles(root).length;
    if (n >= 20) lines.push(`ship-faster: no CLAUDE.md or ${config.wikiDir} here (${n} tracked files). /ship-faster:onboard generates them.`);
  }

  let text = lines.join('\n');
  if (text.length > MAX) text = text.slice(0, MAX - 1) + '…';
  if (text) process.stdout.write(text + '\n');
}

function healthLine(root, config) {
  const dir = projectDir(root);
  const day = 86400_000;
  const health = readJson(join(dir, 'health.json'), null);
  if (health && health.lastRun) {
    const days = Math.floor((Date.now() - Date.parse(health.lastRun)) / day);
    return days > config.healthCadenceDays ? `ship-faster: health audit last ran ${days} days ago → /ship-faster:health` : null;
  }
  const meta = readJson(join(dir, 'project.json'), null);
  const created = meta && meta.createdAt ? Date.parse(meta.createdAt) : Date.now();
  return Date.now() - created > config.healthCadenceDays * day ? 'ship-faster: health audit has not run → /ship-faster:health' : null;
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/hook-session-start.test.mjs plugins/ship-faster/tests/validate.test.mjs`
Expected: all PASS, including the validator now that `hooks.json` references an existing script.

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/hooks/hooks.json plugins/ship-faster/scripts/hook-session-start.mjs plugins/ship-faster/tests/hook-session-start.test.mjs
git commit -m "feat: session-start hook reports wiki, stale pages, active plan, health

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: `hook-ship-guard.mjs` PreToolUse guard

**Files:**
- Modify: `plugins/ship-faster/hooks/hooks.json` (add the PreToolUse entry)
- Create: `plugins/ship-faster/scripts/lib/shell.mjs`
- Create: `plugins/ship-faster/scripts/hook-ship-guard.mjs`
- Test: `plugins/ship-faster/tests/shell.test.mjs`
- Test: `plugins/ship-faster/tests/hook-ship-guard.test.mjs`

**Interfaces:**
- `shell.mjs` produces `splitSegments(command: string) → string[]` (split on `&&`, `||`, `;`, `|`, and newlines outside quotes) and `tokenize(segment: string) → string[]` (whitespace split outside quotes, quotes removed, backslash escapes honoured outside single quotes).
- `hook-ship-guard.mjs` also exports `evaluate(command, { root, config, gitApi }) → { decision: 'deny'|'ask'|null, reason: string|null, rule: string|null }` so the logic is unit-testable without spawning; `gitApi` defaults to `lib/git.mjs` and provides `currentBranch(root)`, `defaultBranch(root)`, `isTag(root, name)`, `dirtyFiles(root)`. Output on deny/ask: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"<deny|ask>","permissionDecisionReason":"<reason>"}}`. Exit 0 always; nothing printed otherwise.
- Rules (per segment; the most restrictive decision across segments wins, `deny` over `ask`):
  - Locate the `git` token (skip leading `VAR=value` assignments); skip global options `-C <dir>`, `-c <kv>`, `--git-dir=…`, `--work-tree=…`.
  - `push`: skip entirely when `-n` or `--dry-run` is present. Force = `-f`, `--force`, `--force-with-lease[=…]`, `--force-if-includes`, a combined short flag containing `f`, or a refspec starting with `+`. Refspecs are the positional arguments after the remote; the destination is the part after `:` or the whole refspec, minus `refs/heads/`; no refspec means the current branch (detached → skip). Skip when `--tags` is present or when every destination is an existing tag. Protected = `config.protectedBranches` plus the resolved default branch. A protected destination with force → rule `forcePush`; without → `pushProtected`. The decision is the configured level unless `allow`.
  - `commit`: `--no-verify`, `-n`, or a combined short flag containing `n` → rule `noVerify`. `merge`: `--no-verify` → `noVerify`.
  - `add`: `-A`, `--all`, `.`, `:/`, or a combined short flag containing `A` → collect `dirtyFiles`; risky = paths matching `(^|/)\.env(\..*)?$`, `\.(pem|key|p12|pfx)$`, `credential`, `secret` (case-insensitive), `(^|/)node_modules/`, `(^|/)(dist|build)/`, `\.log$`, or size over 5 MB. Risky paths present → rule `addAll` with the first five listed; none → allow. `dirtyFiles` failing or timing out → allow.
- Reasons (exact prefixes, so tests and users can grep them): `ship-faster guard: force push to protected branch "<b>" is blocked. …`, `ship-faster guard: direct push to protected branch "<b>" is blocked. Push the feature branch and open a PR with /ship-faster:ship. …`, `ship-faster guard: --no-verify skips the repository's hooks and is blocked. …`, `ship-faster guard: "git add <flag>" would stage risky paths (<list>). Stage files by name. …`. Each ends with `Override: guard.<rule> in .claude/ship-faster.json.`

- [ ] **Step 1: Add the hook registration**

In `hooks/hooks.json`, add under `hooks`:

```json
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-ship-guard.mjs\"", "timeout": 5 }
    ]
  }
]
```

- [ ] **Step 2: Write the failing tests**

`plugins/ship-faster/tests/shell.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSegments, tokenize } from '../scripts/lib/shell.mjs';

test('splitSegments respects quotes and all separators', () => {
  assert.deepEqual(splitSegments('npm test && git push origin main'), ['npm test', 'git push origin main']);
  assert.deepEqual(splitSegments('echo "a && b"; git status | cat'), ['echo "a && b"', 'git status', 'cat']);
  assert.deepEqual(splitSegments("git commit -m 'x; y' || true\ngit push"), ["git commit -m 'x; y'", 'true', 'git push']);
});

test('tokenize strips quotes and honours escapes', () => {
  assert.deepEqual(tokenize('git commit -m "hello world" -n'), ['git', 'commit', '-m', 'hello world', '-n']);
  assert.deepEqual(tokenize("echo 'git push origin main'"), ['echo', 'git push origin main']);
  assert.deepEqual(tokenize('git add file\\ name.txt'), ['git', 'add', 'file name.txt']);
});
```

`plugins/ship-faster/tests/hook-ship-guard.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { evaluate } from '../scripts/hook-ship-guard.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const fakeGit = (over = {}) => ({ currentBranch: () => 'feat/x', defaultBranch: () => 'main', isTag: () => false, dirtyFiles: () => [], ...over });
const ev = (cmd, over, config = DEFAULTS) => evaluate(cmd, { root: '/r', config, gitApi: fakeGit(over) });

test('push rules', () => {
  assert.equal(ev('ls -la').decision, null);
  assert.equal(ev('git status').decision, null);
  assert.equal(ev('git push origin main').rule, 'pushProtected');
  assert.equal(ev('git push origin main').decision, 'deny');
  assert.match(ev('git push origin main').reason, /^ship-faster guard: direct push to protected branch "main"/);
  assert.equal(ev('git push origin HEAD:main').rule, 'pushProtected');
  assert.equal(ev('git push origin refs/heads/main').rule, 'pushProtected');
  assert.equal(ev('git push').decision, null);
  assert.equal(ev('git push', { currentBranch: () => 'main' }).rule, 'pushProtected');
  assert.equal(ev('git push', { currentBranch: () => null }).decision, null);
  assert.equal(ev('git push --force origin feat/x').decision, null);
  assert.equal(ev('git push -f origin main').rule, 'forcePush');
  assert.equal(ev('git push --force-with-lease=main origin main').rule, 'forcePush');
  assert.equal(ev('git push origin +main').rule, 'forcePush');
  assert.equal(ev('git push -uf origin main').rule, 'forcePush');
  assert.equal(ev('git push -n origin main').decision, null);
  assert.equal(ev('git push origin --tags').decision, null);
  assert.equal(ev('git push origin v1.2.3', { isTag: (_, n) => n === 'v1.2.3' }).decision, null);
  assert.equal(ev('git push origin release', {}, { ...DEFAULTS, protectedBranches: ['release'] }).rule, 'pushProtected');
  assert.equal(ev('git push origin develop', { defaultBranch: () => 'develop' }).rule, 'pushProtected');
  assert.equal(ev('git -C sub push origin main').rule, 'pushProtected');
  assert.equal(ev('GIT_TRACE=1 git push origin main').rule, 'pushProtected');
});

test('no-verify and add rules, quoting, chaining, and config levels', () => {
  assert.equal(ev('git commit -n -m x').rule, 'noVerify');
  assert.equal(ev('git commit --no-verify -m x').rule, 'noVerify');
  assert.equal(ev('git commit -anm x').rule, 'noVerify');
  assert.equal(ev('git commit -am x').decision, null);
  assert.equal(ev('git merge --no-verify feat').rule, 'noVerify');
  assert.equal(ev('echo "git push origin main"').decision, null);
  assert.equal(ev('npm test && git push origin main').rule, 'pushProtected');
  const risky = { dirtyFiles: () => [{ path: '.env', status: '??' }, { path: 'src/a.ts', status: 'M' }] };
  assert.equal(ev('git add -A', risky).rule, 'addAll');
  assert.match(ev('git add .', risky).reason, /\.env/);
  assert.equal(ev('git add -Av', risky).rule, 'addAll');
  assert.equal(ev('git add -A', { dirtyFiles: () => [{ path: 'src/a.ts', status: 'M' }] }).decision, null);
  assert.equal(ev('git add src/a.ts', risky).decision, null);
  assert.equal(ev('git add -A', { dirtyFiles: () => { throw new Error('slow'); } }).decision, null);
  const allow = { ...DEFAULTS, guard: { ...DEFAULTS.guard, pushProtected: 'allow' } };
  assert.equal(ev('git push origin main', {}, allow).decision, null);
  const ask = { ...DEFAULTS, guard: { ...DEFAULTS.guard, pushProtected: 'ask' } };
  assert.equal(ev('git push origin main', {}, ask).decision, 'ask');
  assert.equal(ev('git push origin main && git commit -n -m x', {}, ask).decision, 'deny');
});

test('hook process: real repo, json output shape, silence for other tools and bad input', () => {
  const { root } = makeRepo({ files: { 'a.txt': '' } });
  writeFileSync(join(root, '.env'), 'SECRET=1');
  const run = (input) => runScript('hook-ship-guard', [], { cwd: root, stdin: input, env: { CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA } });
  const deny = run({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
  assert.equal(deny.code, 0);
  assert.equal(deny.json.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(deny.json.hookSpecificOutput.permissionDecision, 'deny');
  const add = run({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'git add -A' } });
  assert.match(add.json.hookSpecificOutput.permissionDecisionReason, /\.env/);
  assert.equal(run({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'git push origin feat/y' } }).stdout, '');
  assert.equal(run({ session_id: 's', cwd: root, tool_name: 'Edit', tool_input: { file_path: 'x' } }).stdout, '');
  assert.equal(run('garbage').stdout, '');
  assert.equal(run('garbage').code, 0);
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'ship-faster.json'), JSON.stringify({ guard: { pushProtected: 'allow' } }));
  assert.equal(run({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'git push origin main' } }).stdout, '');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/shell.test.mjs plugins/ship-faster/tests/hook-ship-guard.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `lib/shell.mjs`**

```js
export function splitSegments(command) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(command);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '\n' || ch === ';') { out.push(cur); cur = ''; continue; }
    if ((ch === '&' || ch === '|') && s[i + 1] === ch) { out.push(cur); cur = ''; i++; continue; }
    if (ch === '|') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function tokenize(segment) {
  const tokens = [];
  let cur = '';
  let has = false;
  let quote = null;
  const s = String(segment);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      cur += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has || cur) { tokens.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
    has = true;
  }
  if (has || cur) tokens.push(cur);
  return tokens;
}
```

- [ ] **Step 5: Write the hook**

`plugins/ship-faster/scripts/hook-ship-guard.mjs`:

```js
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as gitLib from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { splitSegments, tokenize } from './lib/shell.mjs';

const RISKY = [/(^|\/)\.env(\..*)?$/, /\.(pem|key|p12|pfx)$/i, /credential/i, /secret/i, /(^|\/)node_modules\//, /(^|\/)(dist|build)\//, /\.log$/];
const OVERRIDE = (rule) => ` Override: guard.${rule} in .claude/ship-faster.json.`;

const defaultGitApi = {
  currentBranch: (root) => gitLib.currentBranch(root),
  defaultBranch: (root) => gitLib.defaultBranch(root),
  isTag: (root, name) => gitLib.git(['show-ref', '--verify', '--quiet', `refs/tags/${name}`], { cwd: root }).ok,
  dirtyFiles: (root) => gitLib.dirtyFiles(root),
};

function gitInvocation(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (tokens[i] !== 'git') return null;
  i++;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C' || tokens[i] === '-c') i += 2;
    else i += 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1) };
}

const shortHas = (tok, letter) => /^-[A-Za-z]+$/.test(tok) && tok.includes(letter);

function checkPush(args, ctx) {
  if (args.includes('-n') || args.includes('--dry-run')) return null;
  if (args.includes('--tags')) return null;
  let force = args.some((a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes' || shortHas(a, 'f'));
  const positional = args.filter((a) => !a.startsWith('-'));
  const refspecs = positional.slice(1);
  let targets;
  if (refspecs.length) {
    targets = refspecs.map((r) => {
      let spec = r;
      if (spec.startsWith('+')) { force = true; spec = spec.slice(1); }
      const dst = spec.includes(':') ? spec.split(':')[1] : spec;
      return dst.replace(/^refs\/heads\//, '');
    }).filter(Boolean);
    if (targets.every((t) => ctx.gitApi.isTag(ctx.root, t))) return null;
  } else {
    const cur = ctx.gitApi.currentBranch(ctx.root);
    if (!cur) return null;
    targets = [cur];
  }
  const protectedSet = new Set(ctx.config.protectedBranches);
  const def = ctx.gitApi.defaultBranch(ctx.root);
  if (def) protectedSet.add(def);
  const hit = targets.find((t) => protectedSet.has(t) && !ctx.gitApi.isTag(ctx.root, t));
  if (!hit) return null;
  if (force) return { rule: 'forcePush', reason: `ship-faster guard: force push to protected branch "${hit}" is blocked. Push a feature branch and open a PR with /ship-faster:ship.${OVERRIDE('forcePush')}` };
  return { rule: 'pushProtected', reason: `ship-faster guard: direct push to protected branch "${hit}" is blocked. Push the feature branch and open a PR with /ship-faster:ship.${OVERRIDE('pushProtected')}` };
}

function checkAdd(args, ctx) {
  const flag = args.find((a) => a === '-A' || a === '--all' || a === '.' || a === ':/' || shortHas(a, 'A'));
  if (!flag) return null;
  let dirty;
  try { dirty = ctx.gitApi.dirtyFiles(ctx.root); } catch { return null; }
  if (!Array.isArray(dirty)) return null;
  const risky = dirty.map((d) => d.path).filter((p) => RISKY.some((re) => re.test(p)) || isLarge(ctx.root, p));
  if (!risky.length) return null;
  const list = risky.slice(0, 5).join(', ') + (risky.length > 5 ? `, +${risky.length - 5} more` : '');
  return { rule: 'addAll', reason: `ship-faster guard: "git add ${flag}" would stage risky paths (${list}). Stage files by name.${OVERRIDE('addAll')}` };
}

function isLarge(root, p) {
  try { return statSync(join(root, p)).size > 5 * 1024 * 1024; } catch { return false; }
}

export function evaluate(command, { root, config, gitApi = defaultGitApi }) {
  const ctx = { root, config, gitApi };
  let best = { decision: null, reason: null, rule: null };
  const rank = { deny: 2, ask: 1 };
  for (const segment of splitSegments(command)) {
    const inv = gitInvocation(tokenize(segment));
    if (!inv) continue;
    let finding = null;
    if (inv.sub === 'push') finding = checkPush(inv.args, ctx);
    else if (inv.sub === 'commit' && inv.args.some((a) => a === '--no-verify' || a === '-n' || shortHas(a, 'n'))) finding = { rule: 'noVerify' };
    else if (inv.sub === 'merge' && inv.args.includes('--no-verify')) finding = { rule: 'noVerify' };
    else if (inv.sub === 'add') finding = checkAdd(inv.args, ctx);
    if (!finding) continue;
    if (finding.rule === 'noVerify' && !finding.reason) finding.reason = `ship-faster guard: --no-verify skips the repository's hooks and is blocked. Fix what the hook reports instead.${OVERRIDE('noVerify')}`;
    const level = config.guard[finding.rule];
    if (level !== 'deny' && level !== 'ask') continue;
    if ((rank[level] || 0) > (rank[best.decision] || 0)) best = { decision: level, reason: finding.reason, rule: finding.rule };
  }
  return best;
}

async function main() {
  const input = await readStdinJson(1000);
  if (!input || input.tool_name !== 'Bash') return;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || !/\bgit\b/.test(command)) return;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = gitLib.repoRoot(cwd) || normalizePath(cwd);
  const { config } = loadConfig(root);
  const result = evaluate(command, { root, config });
  if (!result.decision) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: result.decision, permissionDecisionReason: result.reason } }) + '\n');
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/hook-ship-guard.mjs')) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/shell.test.mjs plugins/ship-faster/tests/hook-ship-guard.test.mjs plugins/ship-faster/tests/validate.test.mjs`
Expected: all PASS. If `git -C sub push origin main` is not detected, the global-option skip loop is consuming the wrong number of tokens.

- [ ] **Step 7: Commit**

```bash
git add plugins/ship-faster/hooks/hooks.json plugins/ship-faster/scripts/lib/shell.mjs plugins/ship-faster/scripts/hook-ship-guard.mjs plugins/ship-faster/tests/shell.test.mjs plugins/ship-faster/tests/hook-ship-guard.test.mjs
git commit -m "feat: ship-guard hook denies protected pushes, --no-verify, risky git add -A

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: `hook-drift-marker.mjs`, `hook-prompt-report.mjs`, `hook-session-end.mjs`

**Files:**
- Modify: `plugins/ship-faster/hooks/hooks.json` (add PostToolUse, UserPromptSubmit, SessionEnd entries)
- Modify: `plugins/ship-faster/scripts/lib/root.mjs` (add `resolveRootCached`)
- Create: `plugins/ship-faster/scripts/hook-drift-marker.mjs`
- Create: `plugins/ship-faster/scripts/hook-prompt-report.mjs`
- Create: `plugins/ship-faster/scripts/hook-session-end.mjs`
- Test: `plugins/ship-faster/tests/hook-drift.test.mjs`

**Interfaces:**
- `root.mjs` addition: `resolveRootCached(cwd) → string`. Looks up `<dataDir>/cwd-cache/<hash16(cwd)>.json` (`{ root, at }`); when present, younger than one day, and `<root>/.git` still exists, returns `root` without any git call; otherwise resolves through `repoRoot(cwd) || cwd` and writes the cache. This is what keeps the per-edit hooks free of git calls.
- Session record shape (written by H3, read by H5, `stale --session`, and later by `sync-docs`): `{ pages: { '<page rel>': { files: string[], reported: boolean } }, updatedAt: string }`. `files` is capped at 200 entries per page.
- `hook-drift-marker.mjs`: PostToolUse. Input `{ session_id, cwd, tool_name, tool_input: { file_path | notebook_path } }`. Records covered-page hits. Prints nothing. Skips files under `wikiDir`, `plansDir`, `rulesDir`, files outside the repository, and tools other than `Edit|Write|MultiEdit|NotebookEdit`.
- `hook-prompt-report.mjs`: UserPromptSubmit. Prints one line for pages recorded but not yet reported, marks them reported: `ship-faster: edits this session touched files covered by <a.md>, <b.md> and 3 more, not yet re-verified. If the changes alter what those pages claim, update them or run /ship-faster:sync-docs before shipping.` Page names are the `rel` paths; the line is capped at 400 characters by dropping names from the end and appending `and N more`.
- `hook-session-end.mjs`: SessionEnd. Deletes the session's file and prunes sessions older than 7 days with a 700 ms deadline. Prints nothing.

- [ ] **Step 1: Register the hooks**

Add to `hooks/hooks.json` under `hooks`:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write|MultiEdit|NotebookEdit",
    "hooks": [
      { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-drift-marker.mjs\"", "timeout": 5 }
    ]
  }
],
"UserPromptSubmit": [
  {
    "hooks": [
      { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-prompt-report.mjs\"", "timeout": 5 }
    ]
  }
],
"SessionEnd": [
  {
    "hooks": [
      { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-session-end.mjs\"", "timeout": 5 }
    ]
  }
]
```

- [ ] **Step 2: Write the failing tests**

`plugins/ship-faster/tests/hook-drift.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { loadSession, saveSession, sessionFile } from '../scripts/lib/state.mjs';
import { resolveRootCached } from '../scripts/lib/root.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const env = () => ({ CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA });
const page = (title, covers) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers, verified: 'abc', updated: '2026-09-16' }) + `# ${title}\n`;

function repo(extraPages = 0) {
  const { root } = makeRepo({ files: { 'src/api/users.ts': '', 'tests/a.test.ts': '', 'README.md': '' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(join(w, 'recipes'), { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'recipes', 'add-endpoint.md'), page('Add endpoint', ['src/api/**']));
  writeFileSync(join(w, 'testing.md'), page('Testing', ['tests/**']));
  for (let i = 0; i < extraPages; i++) writeFileSync(join(w, `extra-${String(i).padStart(2, '0')}.md`), page(`Extra ${i}`, ['src/**']));
  return root;
}

const edit = (root, file, tool = 'Edit', sid = 'sid1') =>
  runScript('hook-drift-marker', [], { cwd: root, stdin: { session_id: sid, cwd: root, tool_name: tool, tool_input: tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file } }, env: env() });
const report = (root, sid = 'sid1') => runScript('hook-prompt-report', [], { cwd: root, stdin: { session_id: sid, cwd: root, prompt: 'hi' }, env: env() });
const end = (root, sid = 'sid1') => runScript('hook-session-end', [], { cwd: root, stdin: { session_id: sid, cwd: root, reason: 'other' }, env: env() });

test('drift-marker records covered hits silently and ignores the rest', () => {
  const root = repo();
  const r = edit(root, join(root, 'src', 'api', 'users.ts'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  let s = loadSession(root, 'sid1');
  assert.deepEqual(s.pages['docs/wiki/recipes/add-endpoint.md'], { files: ['src/api/users.ts'], reported: false });
  edit(root, 'src/api/users.ts');
  assert.deepEqual(loadSession(root, 'sid1').pages['docs/wiki/recipes/add-endpoint.md'].files, ['src/api/users.ts']);
  edit(root, join(root, 'docs', 'wiki', 'testing.md'));
  edit(root, join(root, 'README.md'));
  edit(root, join(root, 'tests', 'a.test.ts'), 'Read');
  edit(root, join(tmpDir(), 'outside.ts'));
  s = loadSession(root, 'sid1');
  assert.deepEqual(Object.keys(s.pages), ['docs/wiki/recipes/add-endpoint.md']);
  edit(root, join(root, 'tests', 'a.test.ts'), 'NotebookEdit');
  assert.ok(loadSession(root, 'sid1').pages['docs/wiki/testing.md']);
});

test('prompt-report prints once per page, then stays silent, and caps the line', () => {
  const root = repo();
  assert.equal(report(root).stdout, '');
  edit(root, 'src/api/users.ts');
  const first = report(root);
  assert.match(first.stdout, /^ship-faster: edits this session touched files covered by docs\/wiki\/recipes\/add-endpoint\.md, not yet re-verified\. .*\/ship-faster:sync-docs before shipping\.\n$/);
  assert.equal(report(root).stdout, '');
  assert.equal(loadSession(root, 'sid1').pages['docs/wiki/recipes/add-endpoint.md'].reported, true);
  edit(root, 'tests/a.test.ts');
  const second = report(root);
  assert.match(second.stdout, /docs\/wiki\/testing\.md/);
  assert.ok(!second.stdout.includes('add-endpoint'));
  const big = repo(12);
  edit(big, 'src/api/users.ts');
  const capped = report(big);
  assert.ok(capped.stdout.length <= 401, `line is ${capped.stdout.length} chars`);
  assert.match(capped.stdout, /and \d+ more/);
});

test('session-end removes the session file and prunes old ones; cwd cache avoids repeated git calls', () => {
  const root = repo();
  edit(root, 'src/api/users.ts');
  const old = sessionFile(root, 'old');
  saveSession(root, 'old', {});
  const past = new Date(Date.now() - 10 * 86400_000);
  utimesSync(old, past, past);
  const r = end(root);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(!existsSync(sessionFile(root, 'sid1')));
  assert.ok(!existsSync(old));
  const sub = join(root, 'src');
  const norm = (p) => realpathSync(p).replace(/\\/g, '/').toLowerCase();
  assert.equal(norm(resolveRootCached(sub)), norm(root));
  assert.ok(existsSync(join(process.env.CLAUDE_PLUGIN_DATA, 'cwd-cache')));
  assert.equal(runScript('hook-drift-marker', [], { cwd: root, stdin: 'garbage', env: env() }).code, 0);
  assert.equal(runScript('hook-prompt-report', [], { cwd: root, stdin: '', env: env() }).code, 0);
  assert.equal(runScript('hook-session-end', [], { cwd: root, stdin: 'garbage', env: env() }).code, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/hook-drift.test.mjs`
Expected: FAIL, `resolveRootCached` is not exported / scripts missing.

- [ ] **Step 4: Extend `lib/root.mjs`**

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './git.mjs';
import { normalizePath } from './glob.mjs';
import { dataDir, projectHash, readJson, writeJsonAtomic } from './state.mjs';

export function resolveRoot(flags = {}, cwd = process.cwd()) {
  if (typeof flags.root === 'string' && flags.root.trim()) return normalizePath(flags.root);
  return repoRoot(cwd) || normalizePath(cwd);
}

export function resolveRootCached(cwd = process.cwd()) {
  const file = join(dataDir(), 'cwd-cache', `${projectHash(cwd)}.json`);
  const cached = readJson(file, null);
  if (cached && typeof cached.root === 'string' && Date.now() - Date.parse(cached.at) < 86400_000 && existsSync(join(cached.root, '.git'))) {
    return cached.root;
  }
  const root = repoRoot(cwd) || normalizePath(cwd);
  writeJsonAtomic(file, { root, at: new Date().toISOString() });
  return root;
}
```

- [ ] **Step 5: Write `hook-drift-marker.mjs`**

```js
import { isAbsolute, join, relative } from 'node:path';
import { readStdinJson } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { anyMatch, normalizePath } from './lib/glob.mjs';
import { resolveRootCached } from './lib/root.mjs';
import { loadSession, saveSession } from './lib/state.mjs';
import { loadWikiCache } from './lib/wiki.mjs';

const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

async function main() {
  const input = await readStdinJson(1000);
  if (!input || !TOOLS.has(input.tool_name)) return;
  const ti = input.tool_input || {};
  const file = typeof ti.file_path === 'string' ? ti.file_path : typeof ti.notebook_path === 'string' ? ti.notebook_path : null;
  if (!file) return;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = resolveRootCached(cwd);
  const abs = isAbsolute(file) ? file : join(cwd, file);
  const rel = normalizePath(relative(root, abs));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return;
  const { config } = loadConfig(root);
  for (const dir of [config.wikiDir, config.plansDir, config.rulesDir]) if (rel.startsWith(dir.replace(/\/+$/, '') + '/')) return;
  const cache = loadWikiCache(root, config);
  const hits = cache.pages.filter((p) => p.covers.length && anyMatch(p.covers, rel));
  if (!hits.length) return;
  const sid = input.session_id || 'default';
  const session = loadSession(root, sid);
  session.pages = session.pages || {};
  for (const p of hits) {
    const entry = session.pages[p.rel] || { files: [], reported: false };
    if (!entry.files.includes(rel) && entry.files.length < 200) entry.files.push(rel);
    session.pages[p.rel] = entry;
  }
  session.updatedAt = new Date().toISOString();
  saveSession(root, sid, session);
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
```

- [ ] **Step 6: Write `hook-prompt-report.mjs`**

```js
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
```

- [ ] **Step 7: Write `hook-session-end.mjs`**

```js
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test plugins/ship-faster/tests/hook-drift.test.mjs plugins/ship-faster/tests/validate.test.mjs`
Expected: all PASS. If the "outside.ts" edit is recorded, the `rel.startsWith('..')` check is not running on the normalized path.

- [ ] **Step 9: Commit**

```bash
git add plugins/ship-faster/hooks/hooks.json plugins/ship-faster/scripts/lib/root.mjs plugins/ship-faster/scripts/hook-drift-marker.mjs plugins/ship-faster/scripts/hook-prompt-report.mjs plugins/ship-faster/scripts/hook-session-end.mjs plugins/ship-faster/tests/hook-drift.test.mjs
git commit -m "feat: record covered-page edits per session and report them on the next prompt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Benchmark, CI, README, CHANGELOG, end-to-end verification

**Files:**
- Create: `plugins/ship-faster/tests/bench.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `plugins/ship-faster/README.md`
- Modify: `plugins/ship-faster/CHANGELOG.md`

**Interfaces:**
- `bench.mjs` prints median wall time over 20 runs for `hook-ship-guard` (command `git status`), `hook-drift-marker` (edit of a covered file), and `hook-prompt-report`, plus one `hook-session-start` run, against a fixture repo with 30 pages, next to the budgets from the spec (150 ms, 150 ms, 100 ms, 1,500 ms). Exit 0 always; it is informational.
- `.github/workflows/evals.yml` is not part of this plan: the eval suite arrives with the skills in plan 3.

- [ ] **Step 1: Write the benchmark**

`plugins/ship-faster/tests/bench.mjs`:

```js
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, tmpDir, cleanupAll, SCRIPTS } from './helpers.mjs';
import { serializeFrontmatter } from '../scripts/lib/fm.mjs';

process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-bench-data-');
const files = {};
for (let i = 0; i < 40; i++) files[`src/mod${i}/index.ts`] = `${i}`;
const { root } = makeRepo({ files });
const w = join(root, 'docs', 'wiki');
mkdirSync(w, { recursive: true });
writeFileSync(join(w, 'index.md'), '# i\n');
for (let i = 0; i < 30; i++) {
  writeFileSync(join(w, `page-${String(i).padStart(2, '0')}.md`), serializeFrontmatter({ title: `Page ${i}`, summary: 's', read_when: 'r', covers: [`src/mod${i}/**`], verified: 'unverified', updated: '2026-09-16' }) + '# p\n');
}

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
  ['hook-session-start', run('hook-session-start', { ...base, source: 'startup' }), 1500],
];
console.log('hook                  median ms   budget ms');
for (const [name, ms, budget] of rows) console.log(`${name.padEnd(22)}${ms.toFixed(0).padStart(9)}${String(budget).padStart(12)}${ms > budget ? '   OVER' : ''}`);
console.log('Node startup dominates; a figure over budget on a loaded machine is not a failure by itself.');
cleanupAll();
```

- [ ] **Step 2: Run the benchmark**

Run: `node plugins/ship-faster/tests/bench.mjs`
Expected: a four-row table. Record the numbers for the README. If `hook-drift-marker` is far above budget, confirm it makes no git call after the first run (add a temporary `console.error` in `lib/git.mjs`'s `git()` and run twice; remove it afterwards).

- [ ] **Step 3: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: node plugins/ship-faster/tests/validate.mjs
      - run: node plugins/ship-faster/tests/run.mjs

  official-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @anthropic-ai/claude-code
      - run: claude plugin validate --strict plugins/ship-faster
      - run: claude plugin validate --strict .
```

If `official-validate` fails in Actions for a reason other than a validation finding (for example the CLI demanding credentials), add `continue-on-error: true` to that job and record in the README that the official validator is advisory in CI and blocking locally.

- [ ] **Step 4: Write the plugin README**

Replace `plugins/ship-faster/README.md` with:

```markdown
# ship-faster

Router CLAUDE.md, verified wiki, and a repo-aware shipping workflow for Claude Code.

This release ships the foundation: five hooks and the scripts the skills are built on. The
skills (`onboard`, `sync-docs`, `lesson`, `kickoff`, `preflight`, `ship`, `release`, `health`,
`review`) land in the next two releases; the design is in
`docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` at the repository root.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

Requires `node` (20 or newer) and `git` on your PATH. Restart Claude Code after installing:
hooks register when a session starts.

## Hooks

| Event | Script | What it does | Cost |
|---|---|---|---|
| SessionStart | `hook-session-start.mjs` | Prints where the wiki is, how many pages are stale, the active plan for the branch, and whether the health audit is overdue. Suggests `/ship-faster:onboard` in a repo with 20+ files and no CLAUDE.md. | one `git diff` per distinct verified commit; under 1.5 s on 30 pages |
| PreToolUse (Bash) | `hook-ship-guard.mjs` | Denies force pushes and direct pushes to protected branches, `--no-verify`, and `git add -A` when it would stage secrets, build output, or files over 5 MB. | no git call unless the command contains `git push` or `git add` |
| PostToolUse (Edit, Write, MultiEdit, NotebookEdit) | `hook-drift-marker.mjs` | Records which wiki pages cover the file you edited. Prints nothing. | no git call after the first per working directory |
| UserPromptSubmit | `hook-prompt-report.mjs` | Once per page per session, tells Claude which pages the session's edits touched and are not yet re-verified. | one small file read |
| SessionEnd | `hook-session-end.mjs` | Deletes the session record and prunes records older than 7 days. | one directory prune |

Every hook exits 0 on every error path and prints nothing when it has nothing to say. A deny
from the guard names the alternative and the config key that overrides it.

## Configuration

Optional `.claude/ship-faster.json` in the repository. Every key is optional:

```json
{
  "wikiDir": "docs/wiki",
  "plansDir": "docs/plans",
  "rulesDir": ".claude/rules",
  "defaultBranch": "auto",
  "protectedBranches": ["main", "master"],
  "guard": { "forcePush": "deny", "pushProtected": "deny", "noVerify": "deny", "addAll": "deny" },
  "healthCadenceDays": 14,
  "pageMaxLines": 200,
  "claudeMdMaxLines": 150,
  "rulesFileMaxLines": 25,
  "checkTimeoutSeconds": 600
}
```

Guard values are `deny`, `ask`, or `allow`. Defaults never use `ask`: a hook `deny` is
documented to hold under bypass-permissions mode, while `ask` there is not documented.

## What is stored, and where

Under the plugin data directory Claude Code provides (`~/.claude/plugins/data/ship-faster/`, or
the same path under `CLAUDE_CONFIG_DIR`):

```
projects/<hash16>/project.json        { root, createdAt }
projects/<hash16>/sessions/<id>.json  pages touched this session
projects/<hash16>/wiki-cache.json     page covers and verified commits, keyed by mtime
projects/<hash16>/preflight/          check logs, last 10 runs
projects/<hash16>/health.json         last health run
cwd-cache/<hash16>.json               working directory → repository root
```

Nothing here contains file contents, prompts, or secrets, and nothing leaves your machine.
`/plugin uninstall ship-faster` deletes this directory; pass `--keep-data` to keep it.

## Scripts

Every script under `scripts/` runs standalone with `--json`:

```
node scripts/detect.mjs        stacks, CI files, scripts, workspaces, suggested checks
node scripts/footprints.mjs    files that change together, from git history
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable
node scripts/index.mjs         regenerate docs/wiki/index.md (--check to only compare)
node scripts/lint.mjs          budgets, links, covers, checks shape, secrets
node scripts/checks.mjs        resolve | run the repository's checks
node scripts/plan.mjs          find --branch | stale | set-status
```

## Development

```
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
node plugins/ship-faster/tests/bench.mjs
claude plugin validate --strict plugins/ship-faster
```

## License

MIT
```

Then run `claude plugin details ship-faster` after the plugin is installed locally (Step 7) and add the reported projected token cost as one sentence under **Hooks**.

- [ ] **Step 5: Update the CHANGELOG**

Under `## [Unreleased]` in `plugins/ship-faster/CHANGELOG.md`:

```markdown
### Added
- SessionStart hook: wiki location, stale page count, active plan, overdue health audit, onboard suggestion.
- PreToolUse guard: denies force pushes and direct pushes to protected branches, `--no-verify`, and risky `git add -A`.
- PostToolUse drift marker and UserPromptSubmit report: pages covering edited files are recorded and reported once per session.
- SessionEnd cleanup of session records.
- Scripts: detect, footprints, stale, index, lint, checks, plan, with a shared zero-dependency library.
- Optional `.claude/ship-faster.json` configuration.
```

- [ ] **Step 6: Run everything**

```bash
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
claude plugin validate --strict plugins/ship-faster
claude plugin validate --strict .
```

Expected: `validate: ok`, every test passing, both official validations passing. Fix anything reported before continuing.

- [ ] **Step 7: Install locally and confirm the hooks fire**

```bash
claude plugin marketplace add "<absolute path to this repository>"
claude plugin install ship-faster@ship-faster
claude plugin details ship-faster
```

Then start a new Claude Code session in a repository with more than 20 files and no CLAUDE.md and confirm the first assistant turn has the `ship-faster: no CLAUDE.md or docs/wiki here` context (ask Claude what context it received from ship-faster). In the same session, ask Claude to run `git push origin main` with nothing to push and confirm the guard's deny reason appears. This installs into the real Claude Code configuration on this machine; that is the intended dogfooding, and `claude plugin uninstall ship-faster` reverses it.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/ci.yml plugins/ship-faster/tests/bench.mjs plugins/ship-faster/README.md plugins/ship-faster/CHANGELOG.md
git commit -m "chore: benchmark, ci workflow, plugin readme and changelog for the foundation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Plan self-review notes

- Spec coverage for this plan: section 3 (layout, Tasks 1 and 18), section 5 (data, Task 6), section 8 (hooks, Tasks 15 to 17), section 9 (scripts, Tasks 2 to 14), section 10 (failure behaviour, every hook's `catch` and every script's `ok` field), section 11 (tests, validator, bench, CI; evals deferred to plan 3 because there are no skills to evaluate yet), section 12 (manifests and install, Tasks 1 and 18).
- Names used across tasks: `parseArgs`, `flagList`, `readStdinJson`, `emit`, `fail`, `runMain` (Task 2); `parseFrontmatter`, `serializeFrontmatter`, `updateFrontmatter` (Task 3); `normalizePath`, `compileGlob`, `matchGlob`, `anyMatch`, `filterPaths` (Task 4); `git`, `isRepo`, `repoRoot`, `head`, `commitExists`, `currentBranch`, `defaultBranch`, `changedSince`, `dirtyFiles`, `trackedFiles`, `log`, `branchExists`, `isMerged` (Tasks 5 and 14); `DEFAULTS`, `loadConfig` (Task 6); `dataDir`, `projectHash`, `projectDir`, `readJson`, `writeJsonAtomic`, `sessionFile`, `loadSession`, `saveSession`, `pruneSessions`, `preflightDir`, `backupDir` (Task 6); `REQUIRED_FIELDS`, `wikiDir`, `relPath`, `listPages`, `loadPage`, `loadWiki`, `loadWikiCache` (Task 7); `resolveRoot`, `resolveRootCached` (Tasks 8 and 17); `listRepoFiles`, `SKIP_DIRS` (Task 12); `detect`, `footprints`, `stale`, `buildIndex`, `writeIndex`, `lint`, `resolveChecks`, `runChecks`, `listPlans`, `findPlan`, `stalePlans`, `setPlanStatus`, `splitSegments`, `tokenize`, `evaluate`.
