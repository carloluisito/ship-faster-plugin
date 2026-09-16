# ship-faster Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the knowledge layer of `ship-faster`: the `onboard`, `sync-docs`, and `lesson` skills, the `repo-analyst` and `doc-verifier` agents, the templates they render, the eval cases that exercise them, and a dogfood run of `onboard` on this repository.

**Architecture:** Skills are markdown procedures (`SKILL.md`) that call the Foundation's zero-dependency Node scripts through Bash and fan out to read-only agents through the Agent tool. Three script changes keep every deterministic step out of the model's hands: `page.mjs` stamps `verified`/`updated` frontmatter, `claude-md.mjs` parses and splices the managed block of CLAUDE.md, and `stale.mjs` learns branch scope (`--since`) and treats a covered change committed together with the page as verified, so pages do not go stale the moment `ship` commits them. Templates give the model the exact skeleton of every generated file; the validator enforces the frontmatter contracts the spec and the Claude Code docs define.

**Tech Stack:** Node 20+ ESM (`.mjs`, `node:test`, `node:fs`, `node:child_process`), git CLI, Claude Code plugin format (SKILL.md, agents/*.md, evals/*/prompt.md + graders/*.md + case.yaml). Zero npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` (sections 4, 6 S1–S3, 7 G1–G2, 11 eval suite, 13 build order item 2). The Foundation plan `docs/superpowers/plans/2026-09-16-foundation.md` is merged; its interfaces are consumed, never re-implemented.

## Verified platform facts (2026-09-16, Claude Code 2.1.273)

These were checked against the current docs and the installed CLI before this plan was written. Implementers rely on them as stated.

- SKILL.md frontmatter fields in use: `name`, `description`, `when_to_use` (appended to the description in the skill listing; the two share a 1,536-character cap), `disable-model-invocation`, `argument-hint`, `allowed-tools`, `context: fork`, `agent`, `background`. In a plugin skill `name` sets the last segment of `/ship-faster:<name>`.
- `` !`command` `` lines run before the skill body reaches the model, under the Bash tool's 2-minute timeout; a non-zero exit aborts the whole invocation, so every such line ends in `|| true`. Output is inserted as plain text.
- A slash-only skill (`disable-model-invocation: true`) can still be invoked by a user prompt that starts with `/ship-faster:<name>`, including in `claude -p`, and a plugin loaded with `--plugin-dir` for one session needs no install. Verified by a probe run.
- Agent frontmatter: `name`, `description`, `model` (`haiku`, `sonnet`, `opus`, `inherit`, or a full id), `tools` as a comma-separated string, `maxTurns`. A skill or an Agent call refers to a plugin agent by its namespaced name `ship-faster:<agent>`.
- Eval case: `evals/<case>/prompt.md` (frontmatter `max_turns` up to 200, `timeout_seconds` up to 3600, `allowed_tools`, `runs`, `tags`, `description`) plus `graders/*.md` (frontmatter `type`, `weight`, optional `arm`; body is the rubric for `type: llm`). Fixtures come from `evals/<case>/case.yaml` with `schema_version: "1.1"`, `name`, and `context.scaffold_script` naming a Bash script in the case directory that runs in the empty workspace when the run passes `--scaffold`. Grader types: `regex` (`target`, `pattern`, `flags`, `match`), `tool_used` (`tool`, `input_match`, `min`, `max`), `tool_order`, `file_exists` (`path`, `exists`; only files created during the run count), `llm` (`focus`), `baseline`. File contents are graded through `target: { source: file, path: <path> }`. `Bash`, `Write`, and `Edit` need an operator grant (`--allow-tools`) and a sandbox backend; native Windows has none, so eval runs happen in CI (ubuntu with bubblewrap and socat), and locally only the case format is checked.
- `claude plugin validate --strict <dir>` treats warnings as errors and validates the manifest plus the skills, agents, and hooks it discovers. `claude --plugin-dir plugins/ship-faster plugin details ship-faster` prints the component inventory and the projected token cost without installing. `claude plugin tag plugins/ship-faster --dry-run` resolves the enclosing marketplace entry and would create `ship-faster--v0.1.0`.
- Path-scoped rules use a `paths:` frontmatter list; a rules file without it loads into every session.

## Global Constraints

- Node 20 or newer; every script is ESM (`.mjs`) with `import` only. No `package.json` dependencies, no `node_modules`.
- Scripts print JSON when `--json` is passed and exit 0 whenever a JSON document was produced (`ok: true|false`, `error` when false). Without `--json`, print `summary` lines and exit 0 when ok, 1 otherwise. `lint` exits 1 on any lint error in both modes.
- Every git invocation goes through `lib/git.mjs` with a timeout.
- Paths inside JSON output and wiki frontmatter always use `/` separators, relative to the repository root.
- Budgets (spec 4.1, 4.2, 4.3): CLAUDE.md 150 lines with a 90-line managed block; wiki page 200 lines; index 80 lines; rules file 25 lines; per-package CLAUDE.md 30 lines; SKILL.md 500 lines; skill `description` + `when_to_use` under 1,536 characters.
- Skill preprocessing lines use the form `` !`node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs" --json || true` `` and always end in `|| true`.
- Skills reference their own files as `${CLAUDE_SKILL_DIR}/<file>` and shared scripts as `${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs`; templates as `${CLAUDE_PLUGIN_ROOT}/templates/<file>`.
- Slash-only skills (`onboard`) set `disable-model-invocation: true`. Model-invocable skills (`sync-docs`, `lesson`) carry `when_to_use`.
- Agents pin `model`, list `tools`, and set `maxTurns`. Agents that need no shell get no Bash tool (D19). G1 and G2 never write.
- Skill and agent prose is written for the model that will execute it: imperative, specific, no motivational filler, no restating the spec's rationale. Each SKILL.md states what to run, what to read, what to write, and what to report.
- Code comments: none that restate the code. Only a non-obvious constraint gets a one-line comment.
- Line endings LF (`.gitattributes` enforces). Commit messages: conventional (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). Stage files by name, never `git add -A`. End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commit mechanics in the worktree shell: heredocs and `for` loops do not work there. Create files with the Write tool. Write each commit message to a file outside the repository (your scratchpad directory) with the Write tool and commit with `git commit -F <that file>`. Never type a ``-style escape inside a tool call; it becomes a raw control byte.
- Test commands from the repo root: `node plugins/ship-faster/tests/run.mjs` (all) or `node --test plugins/ship-faster/tests/<name>.test.mjs` (one file). Validation: `node plugins/ship-faster/tests/validate.mjs` and `claude plugin validate --strict plugins/ship-faster`. Both validators must pass before every commit that touches `plugins/ship-faster/`.
- Work happens in a git worktree created with `EnterWorktree`; the branch merges to `main` locally at the end.

---

## File structure

```
plugins/ship-faster/
  scripts/lib/git.mjs                      + commitsSince, changedBetween; logTopo combined diffs; mergeBase hex filter
  scripts/lib/state.mjs                    + loadAllSessions
  scripts/lib/cli.mjs                      stdin keeps an error listener after settling
  scripts/checks.mjs                       sequence-item continuation join fix
  scripts/stale.mjs                        alongside rule; --since <ref>; --session all; inScope; uncovered
  scripts/detect.mjs                       + config, dataDir, --brief
  scripts/page.mjs                         verify | touch: stamp verified/updated on wiki pages
  scripts/claude-md.mjs                    sections | splice | backup for CLAUDE.md
  templates/claude-md.md                   router CLAUDE.md skeleton with managed markers
  templates/package-claude-md.md           per-package CLAUDE.md skeleton (monorepos)
  templates/plan.md                        kickoff plan skeleton (consumed by plan 3)
  templates/rules-file.md                  .claude/rules/<area>.md skeleton
  templates/gotcha-entry.md                one gotchas.md entry
  templates/pages/<page>.md                one skeleton per wiki page type (11 files)
  agents/repo-analyst.md                   G1
  agents/doc-verifier.md                   G2
  skills/lesson/SKILL.md                   S3
  skills/sync-docs/SKILL.md                S2
  skills/onboard/SKILL.md                  S1
  skills/onboard/reference/areas.md        analyst briefs per area
  skills/onboard/reference/pages.md        page drafting rules
  skills/onboard/reference/report.md       report shape
  evals/onboard/{prompt.md,case.yaml,scaffold.sh,graders/*.md}
  evals/sync-docs/{prompt.md,case.yaml,scaffold.sh,graders/*.md}
  evals/lesson/{prompt.md,case.yaml,scaffold.sh,graders/*.md}
  tests/page.test.mjs, tests/claude-md.test.mjs, tests/templates.test.mjs
  tests/validate.mjs                       + skill, agent, eval, template rules
  tests/validate.test.mjs                  + rules exercised on fixtures
  tests/bench.mjs                          distinct-sha fixture
  README.md, CHANGELOG.md
CLAUDE.md, docs/wiki/**, .claude/rules/**  dogfood output for this repository
.github/workflows/ci.yml                   + lint and index check of this repository's wiki
```

Interfaces are listed per task under **Interfaces**. Later tasks import exactly those names.

---

### Task 1: Cleanup commit for the Foundation's parked follow-ups

**Files:**
- Modify: `plugins/ship-faster/scripts/checks.mjs`
- Modify: `plugins/ship-faster/scripts/lib/cli.mjs`
- Modify: `plugins/ship-faster/scripts/lib/git.mjs`
- Modify: `plugins/ship-faster/scripts/stale.mjs`
- Modify: `plugins/ship-faster/tests/bench.mjs`
- Modify: `plugins/ship-faster/CHANGELOG.md`
- Test: `plugins/ship-faster/tests/checks.test.mjs`, `tests/cli.test.mjs`, `tests/git.test.mjs`, `tests/stale.test.mjs`

**Interfaces:**
- Consumes: `resolveChecks`, `runChecks` (checks.mjs); `readStdinJson` (lib/cli.mjs); `logTopo`, `mergeBase` (lib/git.mjs); `stale` (stale.mjs); `makeRepo`, `runScript`, `tmpDir`, `cleanupAll`, `SCRIPTS` (tests/helpers.mjs).
- Produces: unchanged signatures. `logTopo` now lists the files a merge commit changed relative to every parent (`--diff-merges=combined`), `mergeBase` ignores arguments that are not hex shas, `batchChangedSince` in stale.mjs only runs from three distinct shas.

The six parked items and their fixes:

| Item | Fix |
|---|---|
| CI extractor joins a YAML sequence item with its `- ` marker after a trailing operator | strip the marker before joining a continued line |
| `readStdinJson`'s `removeAllListeners()` also drops the stdin error handler | re-add a no-op `error` listener after tearing down |
| bench has no distinct-sha fixture for the batched staleness path | verify each of the 30 pages at its own commit |
| batching may cost more than two diffs at exactly two shas | batch only from three distinct shas |
| `logTopo` under-reports evil merges | `--diff-merges=combined` (verified: lists only files the merge changed relative to every parent; a clean merge lists nothing, `first-parent` would over-report the side branch) |
| `mergeBase` does not hex-filter shas | filter to `/^[0-9a-f]{4,40}$/i` before calling git |

- [ ] **Step 1: Write the failing tests**

Append to `plugins/ship-faster/tests/checks.test.mjs`:

```js
test('a sequence item continued with a trailing operator joins without its dash', () => {
  const GITLAB = `test:
  script:
    - npm run lint &&
    - npm run build
    - npm test
`;
  const r = resolveChecks(makeRepo({ files: { '.gitlab-ci.yml': GITLAB } }).root, { config: DEFAULTS });
  assert.equal(r.source, 'ci');
  assert.deepEqual(r.checks.map((c) => c.run), ['npm run lint && npm run build', 'npm test']);
});
```

Append to `plugins/ship-faster/tests/cli.test.mjs` (before the `capture` helper):

```js
test('readStdinJson keeps an error listener on stdin after it settles', () => {
  const mod = pathToFileURL(join(SCRIPTS, 'lib', 'cli.mjs')).href;
  const script = `import { readStdinJson } from '${mod}'; await readStdinJson(200); console.log(process.stdin.listenerCount('error'));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: '{}', encoding: 'utf8' });
  assert.ok(Number(r.stdout.trim()) >= 1, `expected an error listener after settling, got "${r.stdout.trim()}"`);
});
```

Append to `plugins/ship-faster/tests/git.test.mjs`:

```js
test('logTopo lists the files an evil merge introduced and nothing for a clean merge', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 's.txt'), 's\n');
  git(['add', 's.txt']);
  git(['commit', '-q', '-m', 'side']);
  git(['checkout', '-q', 'main']);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'b']);
  git(['merge', '-q', '--no-ff', '-m', 'clean merge', 'side']);
  const clean = g.logTopo(root, `${first}..HEAD`).find((c) => c.parents.length === 2);
  assert.deepEqual(clean.files, []);
  writeFileSync(join(root, 'a.txt'), 'evil\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '--amend', '--no-edit']);
  const evil = g.logTopo(root, `${first}..HEAD`).find((c) => c.parents.length === 2);
  assert.deepEqual(evil.files, ['a.txt']);
});

test('mergeBase ignores arguments that are not hex shas', () => {
  const { root } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  assert.equal(g.mergeBase(root, [first, '--help']), first);
  assert.equal(g.mergeBase(root, [first, 'unverified']), first);
  assert.equal(g.mergeBase(root, ['unverified', 'not a sha']), null);
});
```

Append to `plugins/ship-faster/tests/stale.test.mjs`:

```js
test('a change introduced by the merge commit itself counts as changed since a page verified before it', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a', 'lib/b.ts': 'b' } });
  const first = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 's.txt'), 's');
  git(['add', 's.txt']);
  git(['commit', '-q', '-m', 'side']);
  const side = git(['rev-parse', 'HEAD']);
  git(['checkout', '-q', 'main']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', 'lib/b.ts']);
  git(['commit', '-q', '-m', 'b']);
  const b = git(['rev-parse', 'HEAD']);
  git(['merge', '-q', '--no-ff', '-m', 'merge side', 'side']);
  writeFileSync(join(root, 'a.txt'), 'evil');
  git(['add', 'a.txt']);
  git(['commit', '-q', '--amend', '--no-edit']);

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'from-side.md'), page('From side', ['a.txt'], side));
  writeFileSync(join(w, 'from-b.md'), page('From b', ['a.txt'], b));
  writeFileSync(join(w, 'from-first.md'), page('From first', ['s.txt'], first));

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['from-side.md'].status, 'stale');
  assert.deepEqual(by['from-side.md'].changed, ['a.txt']);
  assert.equal(by['from-b.md'].status, 'stale');
  assert.deepEqual(by['from-b.md'].changed, ['a.txt']);
  assert.equal(by['from-first.md'].status, 'stale');
  assert.deepEqual(by['from-first.md'].changed, ['s.txt']);
});

test('exactly two distinct verified shas classify exactly', () => {
  const { root, git } = makeRepo({ files: { 'a/f.ts': 'a1' } });
  const c1 = git(['rev-parse', 'HEAD']);
  mkdirSync(join(root, 'b'), { recursive: true });
  writeFileSync(join(root, 'b', 'f.ts'), 'b');
  git(['add', 'b/f.ts']);
  git(['commit', '-q', '-m', 'b']);
  const c2 = git(['rev-parse', 'HEAD']);
  mkdirSync(join(root, 'c'), { recursive: true });
  writeFileSync(join(root, 'c', 'f.ts'), 'c');
  git(['add', 'c/f.ts']);
  git(['commit', '-q', '-m', 'c']);

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'a.md'), page('A', ['a/**'], c1));
  writeFileSync(join(w, 'b.md'), page('B', ['b/**'], c1));
  writeFileSync(join(w, 'c.md'), page('C', ['c/**'], c2));
  writeFileSync(join(w, 'd.md'), page('D', ['b/**'], c2));

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['a.md'].status, 'fresh');
  assert.equal(by['b.md'].status, 'stale');
  assert.deepEqual(by['b.md'].changed, ['b/f.ts']);
  assert.equal(by['c.md'].status, 'stale');
  assert.deepEqual(by['c.md'].changed, ['c/f.ts']);
  assert.equal(by['d.md'].status, 'fresh');
});
```

- [ ] **Step 2: Run the four test files to verify the new tests fail**

Run: `node --test plugins/ship-faster/tests/checks.test.mjs plugins/ship-faster/tests/cli.test.mjs plugins/ship-faster/tests/git.test.mjs plugins/ship-faster/tests/stale.test.mjs`
Expected: the five new tests fail (`npm run lint && - npm run build`, listener count `0`, evil merge `files` `[]`, `mergeBase` with `--help` `null`, `from-side.md` `fresh`); everything else passes.

- [ ] **Step 3: Fix checks.mjs**

In `extractCi`, inside the block-scalar loop, replace

```js
          const text = l.trim();
          if (previous && CONTINUED.test(previous.run)) { previous.run = `${previous.run.replace(/\\$/, '').trimEnd()} ${text}`; continue; }
          const item = sequence ? text.replace(/^-\s+/, '') : text;
          if (!item) continue;
          previous = { run: item, stepName };
          found.push(previous);
```

with

```js
          const text = l.trim();
          const item = sequence ? text.replace(/^-\s+/, '') : text;
          if (!item) continue;
          if (previous && CONTINUED.test(previous.run)) { previous.run = `${previous.run.replace(/\\$/, '').trimEnd()} ${item}`; continue; }
          previous = { run: item, stepName };
          found.push(previous);
```

- [ ] **Step 4: Fix lib/cli.mjs**

In `readStdinJson`'s `finish`, replace the `try` block with:

```js
      try {
        process.stdin.pause();
        process.stdin.removeAllListeners();
        process.stdin.on('error', () => {});
        if (typeof process.stdin.unref === 'function') process.stdin.unref();
      } catch {}
```

- [ ] **Step 5: Fix lib/git.mjs**

Replace `logTopo` and `mergeBase` with:

```js
export function logTopo(cwd, range, { n = 2000 } = {}) {
  // combined diffs list only what a merge commit changed relative to every parent: an evil merge
  // shows its files, a clean merge shows nothing its side commits do not already report.
  const r = git(['log', '--topo-order', `-n${n}`, '--diff-merges=combined', '--pretty=format:__C__%H%x1f%P', '--name-only', range], { cwd, timeoutMs: 10000 });
  return r.ok ? parseLog(r.stdout, (parents) => ({ parents: parents.split(' ').filter(Boolean) })) : [];
}

const SHA = /^[0-9a-f]{4,40}$/i;

export function mergeBase(cwd, shas) {
  const valid = (Array.isArray(shas) ? shas : []).map(String).filter((s) => SHA.test(s));
  if (valid.length === 0) return null;
  const v = out(['merge-base', '--octopus', ...valid], cwd, 5000);
  return v && /^[0-9a-f]{40}$/.test(v) ? v : null;
}
```

- [ ] **Step 6: Fix stale.mjs**

In `batchChangedSince`, replace `if (shas.length < 2) return resolved;` with:

```js
  // Two shas cost two direct diffs; walking the history only pays off from three.
  if (shas.length < 3) return resolved;
```

- [ ] **Step 7: Give the benchmark a distinct-sha fixture**

In `plugins/ship-faster/tests/bench.mjs`, replace everything from `const first = git(['rev-parse', 'HEAD']);` through `git(['commit', '-q', '-m', 'wiki']);` with:

```js
const shas = [];
for (let i = 0; i < 30; i++) {
  writeFileSync(join(root, 'src', `mod${i}`, 'index.ts'), `${i} touched`);
  git(['add', `src/mod${i}/index.ts`]);
  git(['commit', '-q', '-m', `touch mod${i}`]);
  shas.push(git(['rev-parse', 'HEAD']));
}
const w = join(root, 'docs', 'wiki');
mkdirSync(w, { recursive: true });
writeFileSync(join(w, 'index.md'), '# i\n');
for (let i = 0; i < 30; i++) {
  writeFileSync(join(w, `page-${String(i).padStart(2, '0')}.md`), serializeFrontmatter({ title: `Page ${i}`, summary: 's', read_when: 'r', covers: [`src/mod${i}/**`], verified: shas[i], updated: '2026-09-16' }) + '# p\n');
}
git(['add', 'docs']);
git(['commit', '-q', '-m', 'wiki']);
```

- [ ] **Step 8: Run the whole suite and the benchmark**

Run: `node plugins/ship-faster/tests/run.mjs`
Expected: every test passes, including the five new ones.

Run: `node plugins/ship-faster/tests/bench.mjs`
Expected: four rows; `hook-session-start` stays under its 1,500 ms budget with 30 distinct verified shas.

- [ ] **Step 9: Record the fixes in the CHANGELOG**

Append these bullets under `### Fixed` in `plugins/ship-faster/CHANGELOG.md` (the `[Unreleased]` section):

```markdown
- CI steps written as a YAML sequence where one item ends with `&&`, `|`, or `\` join into one command without carrying the next item's `- ` marker.
- A hook's stdin keeps an error handler after its input has been read, so a late pipe error cannot crash the process.
- Wiki freshness reads the history in one pass only when three or more pages were verified at different commits; at two, the two direct diffs are cheaper.
- Files changed by a merge commit itself (an "evil merge") now count as changed since a page's verified commit.
- The one-pass freshness check ignores malformed `verified` values instead of failing for every page.
```

- [ ] **Step 10: Commit**

```bash
git add plugins/ship-faster/scripts/checks.mjs plugins/ship-faster/scripts/lib/cli.mjs plugins/ship-faster/scripts/lib/git.mjs plugins/ship-faster/scripts/stale.mjs plugins/ship-faster/tests/bench.mjs plugins/ship-faster/tests/checks.test.mjs plugins/ship-faster/tests/cli.test.mjs plugins/ship-faster/tests/git.test.mjs plugins/ship-faster/tests/stale.test.mjs plugins/ship-faster/CHANGELOG.md
git commit -F <message file>
```

Message file content:

```
fix: close the foundation review's parked items

Join continued CI sequence items without their dash, keep an stdin error
listener after a hook settles, count evil-merge changes in the one-pass
freshness check, ignore non-hex shas in mergeBase, batch only from three
distinct shas, and bench with a distinct-sha wiki.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 2: `stale` treats a covered change committed together with the page as verified

**Files:**
- Modify: `plugins/ship-faster/scripts/lib/git.mjs`
- Modify: `plugins/ship-faster/scripts/stale.mjs`
- Test: `plugins/ship-faster/tests/git.test.mjs`, `plugins/ship-faster/tests/stale.test.mjs`

**Interfaces:**
- Consumes: `git()`, `logTopo`, `changedSince`, `dirtyFiles` (lib/git.mjs); `loadWiki` (lib/wiki.mjs); `filterPaths`.
- Produces:
  - `commitsSince(cwd, sha, { n = 2000 }) → { commits: [{ sha, parents, files }], truncated: boolean } | null` in lib/git.mjs. `null` when git fails or the sha is not a commit.
  - `stale()` output shape is unchanged. Semantics change: a commit that modified the page file itself does not make that page stale, whatever else it touched; an uncommitted change to a covered file does not make a page `dirty` while the page itself has a tracked, uncommitted modification. Untracked (new) pages are still classified normally.

Why: `ship` runs `sync-docs` before it commits, so the page is verified at the parent commit and then committed together with the code it describes. Under a plain `git diff <verified> HEAD` rule every such page is stale the moment the commit lands, and a freshness signal that fires after every ship is ignored. Cost if wrong: a page edited cosmetically in the same commit as a covered change hides that drift until the next `sync-docs --scope all`, which `release` runs.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/ship-faster/tests/git.test.mjs`:

```js
test('commitsSince lists commits after a sha with their files, null for a bad sha, truncated at n', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  const first = g.head(root);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git(['add', 'b.txt']);
  git(['commit', '-q', '-m', 'b']);
  writeFileSync(join(root, 'c.txt'), 'c\n');
  git(['add', 'c.txt']);
  git(['commit', '-q', '-m', 'c']);
  const r = g.commitsSince(root, first);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.commits.map((c) => c.files), [['c.txt'], ['b.txt']]);
  assert.deepEqual(r.commits[1].parents, [first]);
  assert.deepEqual(g.commitsSince(root, g.head(root)), { commits: [], truncated: false });
  assert.equal(g.commitsSince(root, 'deadbeef'), null);
  assert.equal(g.commitsSince(root, 'unverified'), null);
  assert.equal(g.commitsSince(root, first, { n: 1 }).truncated, true);
});
```

Append to `plugins/ship-faster/tests/stale.test.mjs`:

```js
test('a covered change committed together with the page keeps the page fresh; committed without it makes the page stale', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  const verifiedAt = git(['rev-parse', 'HEAD']);
  writeFileSync(join(w, 'together.md'), page('Together', ['src/**'], verifiedAt));
  writeFileSync(join(w, 'alone.md'), page('Alone', ['lib/**'], verifiedAt));
  writeFileSync(join(root, 'src', 'a.ts'), 'a2');
  git(['add', 'docs/wiki/index.md', 'docs/wiki/together.md', 'docs/wiki/alone.md', 'src/a.ts']);
  git(['commit', '-q', '-m', 'ship: code and docs together']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', 'lib/b.ts']);
  git(['commit', '-q', '-m', 'change b without touching its page']);

  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['together.md'].status, 'fresh');
  assert.equal(by['alone.md'].status, 'stale');
  assert.deepEqual(by['alone.md'].changed, ['lib/b.ts']);

  writeFileSync(join(root, 'src', 'a.ts'), 'a3');
  git(['add', 'src/a.ts']);
  git(['commit', '-q', '-m', 'change a later without the page']);
  const later = stale(root, { config: DEFAULTS });
  assert.equal(later.pages.find((p) => p.rel.endsWith('together.md')).status, 'stale');
});

test('the alongside rule also holds on the one-pass path with three distinct verified shas', () => {
  const { root, git } = makeRepo({ files: { 'a/f.ts': 'a', 'b/f.ts': 'b', 'c/f.ts': 'c' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  const shas = [];
  for (const dir of ['a', 'b', 'c']) {
    shas.push(git(['rev-parse', 'HEAD']));
    writeFileSync(join(w, `${dir}.md`), page(dir.toUpperCase(), [`${dir}/**`], shas[shas.length - 1]));
    writeFileSync(join(root, dir, 'f.ts'), `${dir}2`);
    git(['add', `docs/wiki/${dir}.md`, `${dir}/f.ts`]);
    git(['commit', '-q', '-m', `${dir} with page`]);
  }
  writeFileSync(join(root, 'c', 'f.ts'), 'c3');
  git(['add', 'c/f.ts']);
  git(['commit', '-q', '-m', 'c alone']);
  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['a.md'].status, 'fresh');
  assert.equal(by['b.md'].status, 'fresh');
  assert.equal(by['c.md'].status, 'stale');
  assert.deepEqual(by['c.md'].changed, ['c/f.ts']);
});

test('a tracked page with uncommitted edits is not dirty for covered working-tree changes; an untracked page still is', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b' } });
  const headSha = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'tracked.md'), page('Tracked', ['src/**'], headSha));
  git(['add', 'docs/wiki/index.md', 'docs/wiki/tracked.md']);
  git(['commit', '-q', '-m', 'wiki']);
  const committed = git(['rev-parse', 'HEAD']);
  writeFileSync(join(w, 'tracked.md'), page('Tracked', ['src/**'], committed) + 'Edited alongside.\n');
  writeFileSync(join(w, 'new.md'), page('New', ['lib/**'], committed));
  writeFileSync(join(root, 'src', 'a.ts'), 'a2');
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  const r = stale(root, { config: DEFAULTS });
  const by = Object.fromEntries(r.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.equal(by['tracked.md'].status, 'fresh');
  assert.equal(by['new.md'].status, 'dirty');
  assert.deepEqual(by['new.md'].changed, ['lib/b.ts']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/git.test.mjs plugins/ship-faster/tests/stale.test.mjs`
Expected: `g.commitsSince is not a function`; `together.md` is `stale` instead of `fresh`; `a.md` is `stale`; `tracked.md` is `dirty`.

- [ ] **Step 3: Add `commitsSince` to lib/git.mjs**

After `logTopo`:

```js
export function commitsSince(cwd, sha, { n = 2000 } = {}) {
  if (!commitExists(cwd, sha)) return null;
  const r = git(['log', '--topo-order', `-n${n}`, '--diff-merges=combined', '--pretty=format:__C__%H%x1f%P', '--name-only', `${sha}..HEAD`], { cwd, timeoutMs: 10000 });
  if (!r.ok) return null;
  const commits = parseLog(r.stdout, (parents) => ({ parents: parents.split(' ').filter(Boolean) }));
  return { commits, truncated: commits.length >= n };
}
```

- [ ] **Step 4: Apply the alongside rule in stale.mjs**

Replace `filesAfter` and `batchChangedSince` with:

```js
function reachableFrom(commits, index, sha) {
  const reachable = new Set();
  const stack = [sha];
  while (stack.length) {
    const cur = stack.pop();
    if (reachable.has(cur) || !index.has(cur)) continue;
    reachable.add(cur);
    for (const parent of commits[index.get(cur)].parents) stack.push(parent);
  }
  return reachable;
}

function unionExcluding(commits, skip, pageRel) {
  const files = new Set();
  for (const c of commits) {
    if (skip(c) || c.files.includes(pageRel)) continue;
    for (const f of c.files) files.add(f);
  }
  return [...files];
}

function batchHistory(root, shas) {
  const resolved = new Map();
  // Two shas cost two direct log calls; walking the history once only pays off from three.
  if (shas.length < 3) return resolved;
  const base = git.mergeBase(root, shas);
  if (!base) return resolved;
  const commits = git.logTopo(root, `${base}..HEAD`, { n: LOG_LIMIT });
  if (!commits.length || commits.length >= LOG_LIMIT) return resolved;
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  for (const sha of shas) {
    if (sha !== base && !index.has(sha)) continue;
    const reachable = reachableFrom(commits, index, sha);
    resolved.set(sha, (pageRel) => unionExcluding(commits, (c) => reachable.has(c.sha), pageRel));
  }
  return resolved;
}
```

Inside `stale()`, replace the `batched`, `commitExistsCache`, `commitExists`, `diffCache`, and `changedSince` declarations with:

```js
  const dirtyEntries = isRepo ? git.dirtyFiles(root) : [];
  const dirtyStatus = new Map(dirtyEntries.map((d) => [d.path, d.status]));
  const dirty = dirtyEntries.map((d) => d.path);
```

(replacing the earlier `const dirty = ...` line), and:

```js
  const batched = isRepo ? batchHistory(root, verifiedShas(wiki.pages, head)) : new Map();
  // merge-base resolved every sha it was given, so a batched sha needs no existence check of its own.
  const commitExistsCache = new Map([...batched.keys()].map((sha) => [sha, true]));
  const commitExists = (sha) => {
    if (!commitExistsCache.has(sha)) commitExistsCache.set(sha, sha === head ? true : git.commitExists(root, sha));
    return commitExistsCache.get(sha);
  };
  const historyCache = new Map();
  const changedSince = (sha, pageRel) => {
    if (sha === head) return [];
    if (batched.has(sha)) return batched.get(sha)(pageRel);
    if (!historyCache.has(sha)) historyCache.set(sha, git.commitsSince(root, sha, { n: LOG_LIMIT }));
    const history = historyCache.get(sha);
    if (history === null) return null;
    // A history too long to walk falls back to the plain diff, which cannot apply the alongside rule.
    if (history.truncated) return git.changedSince(root, sha);
    return unionExcluding(history.commits, () => false, pageRel);
  };
  const editedAlongside = (rel) => dirtyStatus.has(rel) && dirtyStatus.get(rel) !== '??';
```

Then in the page classification, change `const diff = changedSince(verified);` to `const diff = changedSince(verified, rel);` and change the dirty check to:

```js
    const dirtyMatched = editedAlongside(rel) ? [] : filterPaths(covers, uncommitted);
```

Note: the old `dirty` variable declared earlier (`const dirty = isRepo ? git.dirtyFiles(root).map((d) => d.path) : [];`) is replaced by the three lines above; make sure `dirtyFiles` is called once.

- [ ] **Step 5: Run the whole suite**

Run: `node plugins/ship-faster/tests/run.mjs`
Expected: all pass. The existing `stale`, `hook-session-start`, and `bench` fixtures keep their expectations: their stale pages are stale through commits that never touched a page, and their dirty pages are untracked.

- [ ] **Step 6: Record the change**

Append under `### Changed` in `plugins/ship-faster/CHANGELOG.md` (create the heading under `[Unreleased]` if absent):

```markdown
- A wiki page committed together with the covered files it describes stays fresh: only commits that change covered files without touching the page make it stale, and a page with uncommitted edits of its own is not marked dirty by covered working-tree changes. Pages no longer go stale the moment `ship` commits them.
```

Add the same sentence, shortened, to the `stale.mjs` line of the Scripts block in `plugins/ship-faster/README.md`:

```
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable; a page committed together with the covered change stays fresh
```

- [ ] **Step 7: Commit**

```bash
git add plugins/ship-faster/scripts/lib/git.mjs plugins/ship-faster/scripts/stale.mjs plugins/ship-faster/tests/git.test.mjs plugins/ship-faster/tests/stale.test.mjs plugins/ship-faster/CHANGELOG.md plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: a page committed with the change it describes stays fresh

Commits that touch the page itself no longer count toward its staleness,
and a tracked page with uncommitted edits is not marked dirty by covered
working-tree changes. Without this every page re-verified by ship went
stale the moment ship committed it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 3: `stale --since`, `--session all`, `inScope`, `uncovered`

**Files:**
- Modify: `plugins/ship-faster/scripts/lib/git.mjs`
- Modify: `plugins/ship-faster/scripts/lib/state.mjs`
- Modify: `plugins/ship-faster/scripts/stale.mjs`
- Test: `plugins/ship-faster/tests/git.test.mjs`, `tests/state.test.mjs`, `tests/stale.test.mjs`

**Interfaces:**
- Consumes: `git()`, `splitZ` (lib/git.mjs); `projectDir`, `readJson` (lib/state.mjs); `filterPaths`, `anyMatch`, `normalizePath` (lib/glob.mjs).
- Produces:
  - `changedBetween(cwd, ref) → string[] | null` in lib/git.mjs: files in `git diff --name-only ref...HEAD`; `null` when the ref is empty, starts with `-`, or cannot be resolved.
  - `loadAllSessions(root) → { pages: { [rel]: { files: string[], reported: boolean } } }` in lib/state.mjs: union of every session record of the project; unreadable records are skipped.
  - `stale(root, { config, session, changed, since })`: `session` may be `'all'`; `since` is a ref. Every page result gains `inScope: boolean`. The result gains `since: null | { ref, files, error }` and `uncovered: string[]` (capped at 50).
  - CLI flags `--since <ref>` and `--session all` on `stale.mjs`.

Scope rule for `inScope`: `fresh` pages are never in scope. Without `--since`, every non-fresh page is in scope. With `--since <ref>`, `invalid` and `unverifiable` pages are in scope (they cannot be scoped and must be surfaced), and a `stale` or `dirty` page is in scope only when one of its `covers` matches a file in the branch diff (`ref...HEAD`), the working tree, the `--changed` list, or the session record. When the ref cannot be diffed, `since.error` is set and the no-`--since` rule applies.

`uncovered`: files in scope (branch diff plus uncommitted when `--since` is given, uncommitted only otherwise) that no page's `covers` matches, excluding `CLAUDE.md` and anything under the wiki, plans, or rules directories. `sync-docs` uses it to find new behaviour with no covering page.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/ship-faster/tests/git.test.mjs`:

```js
test('changedBetween lists the branch diff against the merge base and null for a bad ref', () => {
  const { root, git } = makeRepo({ files: { 'a.txt': 'a\n' } });
  writeFileSync(join(root, 'main.txt'), 'm\n');
  git(['add', 'main.txt']);
  git(['commit', '-q', '-m', 'main moves']);
  git(['checkout', '-q', '-b', 'feat', 'HEAD~1']);
  writeFileSync(join(root, 'feat.txt'), 'f\n');
  git(['add', 'feat.txt']);
  git(['commit', '-q', '-m', 'feat']);
  assert.deepEqual(g.changedBetween(root, 'main'), ['feat.txt']);
  assert.equal(g.changedBetween(root, 'no-such-ref'), null);
  assert.equal(g.changedBetween(root, '--output=/tmp/x'), null);
  assert.equal(g.changedBetween(root, ''), null);
});
```

Append to `plugins/ship-faster/tests/state.test.mjs`:

```js
test('loadAllSessions unions every session record of the project', () => {
  const root = tmpDir('sf-root-');
  s.saveSession(root, 'one', { pages: { 'docs/wiki/a.md': { files: ['src/a.ts'], reported: false } } });
  s.saveSession(root, 'two', { pages: { 'docs/wiki/a.md': { files: ['src/b.ts'], reported: true }, 'docs/wiki/c.md': { files: ['lib/c.ts'], reported: false } } });
  writeFileSync(join(s.projectDir(root), 'sessions', 'junk.json'), 'not json');
  const all = s.loadAllSessions(root);
  assert.deepEqual(Object.keys(all.pages).sort(), ['docs/wiki/a.md', 'docs/wiki/c.md']);
  assert.deepEqual(all.pages['docs/wiki/a.md'].files.sort(), ['src/a.ts', 'src/b.ts']);
  assert.equal(all.pages['docs/wiki/a.md'].reported, true);
  assert.equal(all.pages['docs/wiki/c.md'].reported, false);
  assert.deepEqual(s.loadAllSessions(tmpDir('sf-empty-')).pages, {});
});
```

Append to `plugins/ship-faster/tests/stale.test.mjs`:

```js
test('--since scopes non-fresh pages to the branch diff, the working tree, and session records, and lists uncovered files', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a', 'lib/b.ts': 'b', 'ops/d.txt': 'd', 'etc/e.txt': 'e', 'new/n.ts': 'n' } });
  const first = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'lib', 'b.ts'), 'b2');
  git(['add', 'lib/b.ts']);
  git(['commit', '-q', '-m', 'main change']);
  git(['checkout', '-q', '-b', 'feat']);
  writeFileSync(join(root, 'src', 'a.ts'), 'a2');
  writeFileSync(join(root, 'new', 'n.ts'), 'n2');
  git(['add', 'src/a.ts', 'new/n.ts']);
  git(['commit', '-q', '-m', 'feat change']);
  const headSha = git(['rev-parse', 'HEAD']);

  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'a.md'), page('A', ['src/**'], first));
  writeFileSync(join(w, 'b.md'), page('B', ['lib/**'], first));
  writeFileSync(join(w, 'd.md'), page('D', ['ops/**'], headSha));
  writeFileSync(join(w, 'e.md'), page('E', ['etc/**'], headSha));
  writeFileSync(join(w, 'inv.md'), '---\ntitle: Invalid\n---\nno covers\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# x\n');
  saveSession(root, 'sid9', { pages: { 'docs/wiki/d.md': { files: ['ops/d.txt'], reported: false } } });

  const scoped = stale(root, { config: DEFAULTS, session: 'all', since: 'main' });
  const by = Object.fromEntries(scoped.pages.map((p) => [p.rel.replace('docs/wiki/', ''), p]));
  assert.deepEqual([by['a.md'].status, by['a.md'].inScope], ['stale', true]);
  assert.deepEqual([by['b.md'].status, by['b.md'].inScope], ['stale', false]);
  assert.deepEqual([by['d.md'].status, by['d.md'].inScope], ['dirty', true]);
  assert.deepEqual([by['e.md'].status, by['e.md'].inScope], ['fresh', false]);
  assert.deepEqual([by['inv.md'].status, by['inv.md'].inScope], ['invalid', true]);
  assert.deepEqual(scoped.since, { ref: 'main', files: 2, error: null });
  assert.deepEqual(scoped.uncovered, ['new/n.ts']);
  assert.match(scoped.summary[0], /in scope/);

  const unscoped = stale(root, { config: DEFAULTS, session: 'all' });
  assert.equal(unscoped.pages.find((p) => p.rel.endsWith('b.md')).inScope, true);
  assert.equal(unscoped.pages.find((p) => p.rel.endsWith('e.md')).inScope, false);
  assert.equal(unscoped.since, null);
  assert.deepEqual(unscoped.uncovered, []);

  const bad = stale(root, { config: DEFAULTS, since: 'no-such-ref' });
  assert.equal(bad.since.error, 'cannot diff against no-such-ref');
  assert.equal(bad.pages.find((p) => p.rel.endsWith('b.md')).inScope, true);

  const cli = runScript('stale', ['--root', root, '--json', '--session', 'all', '--since', 'main']);
  assert.equal(cli.json.pages.find((p) => p.rel.endsWith('d.md')).inScope, true);
  assert.equal(cli.json.pages.find((p) => p.rel.endsWith('b.md')).inScope, false);
  assert.deepEqual(cli.json.uncovered, ['new/n.ts']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test plugins/ship-faster/tests/git.test.mjs plugins/ship-faster/tests/state.test.mjs plugins/ship-faster/tests/stale.test.mjs`
Expected: `g.changedBetween is not a function`, `s.loadAllSessions is not a function`, `inScope` undefined.

- [ ] **Step 3: Add `changedBetween` to lib/git.mjs**

After `changedSince`:

```js
export function changedBetween(cwd, ref) {
  const r0 = String(ref || '');
  if (!r0 || r0.startsWith('-')) return null;
  const r = git(['diff', '--name-only', '-z', `${r0}...HEAD`], { cwd, timeoutMs: 5000 });
  if (!r.ok) return null;
  return splitZ(r.stdout).map(normalizePath);
}
```

- [ ] **Step 4: Add `loadAllSessions` to lib/state.mjs**

After `updateSession`:

```js
export function loadAllSessions(root) {
  const merged = { pages: {} };
  let names = [];
  const dir = join(projectDir(root), 'sessions');
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return merged; }
  for (const name of names) {
    const rec = readJson(join(dir, name), null);
    if (!rec || typeof rec !== 'object' || !rec.pages || typeof rec.pages !== 'object') continue;
    for (const [rel, entry] of Object.entries(rec.pages)) {
      const cur = merged.pages[rel] || { files: [], reported: false };
      for (const f of (entry && entry.files) || []) if (!cur.files.includes(f) && cur.files.length < 200) cur.files.push(f);
      cur.reported = cur.reported || Boolean(entry && entry.reported);
      merged.pages[rel] = cur;
    }
  }
  return merged;
}
```

- [ ] **Step 5: Add scope handling to stale.mjs**

Change the state import to `import { loadAllSessions, loadSession } from './lib/state.mjs';` and the glob import to `import { anyMatch, filterPaths, normalizePath } from './lib/glob.mjs';`. Change the `stale` signature to `export function stale(root, { config, session = null, changed = [], since = null } = {})` and the early return for a missing wiki to include `since: null, uncovered: []`.

Replace the session-record block with:

```js
  if (session) {
    const rec = session === 'all' ? loadAllSessions(root) : loadSession(root, session);
    for (const entry of Object.values(rec.pages || {})) for (const f of entry.files || []) extra.push(normalizePath(f));
  }
  const uncommitted = [...new Set([...dirty, ...extra])];
  let scope = null;
  let scopeFiles = null;
  if (since) {
    const branch = isRepo ? git.changedBetween(root, since) : null;
    scope = { ref: since, files: branch ? branch.length : 0, error: branch ? null : (isRepo ? `cannot diff against ${since}` : 'not a git repository') };
    if (branch) scopeFiles = [...new Set([...branch, ...uncommitted])];
  }
```

After the page classification (`const classified = wiki.pages.map(...)`, rename the existing `pages` map result to `classified`), add:

```js
  const coversOf = new Map(wiki.pages.map((p) => [p.rel, p.data && Array.isArray(p.data.covers) ? p.data.covers.map(String) : []]));
  const pages = classified.map((r) => {
    let inScope;
    if (r.status === 'fresh') inScope = false;
    else if (!scopeFiles || r.status === 'invalid' || r.status === 'unverifiable') inScope = true;
    else inScope = filterPaths(coversOf.get(r.rel), scopeFiles).length > 0;
    return { ...r, inScope };
  });
  const allCovers = [...coversOf.values()].flat();
  const generated = [config.wikiDir, config.plansDir, config.rulesDir].map((d) => d.replace(/\/+$/, '') + '/');
  const uncovered = (scopeFiles || uncommitted)
    .filter((f) => f !== 'CLAUDE.md' && !generated.some((d) => f.startsWith(d)) && !anyMatch(allCovers, f))
    .sort()
    .slice(0, 50);
```

Extend the summary and the return value:

```js
  const summary = [`${pages.length} pages: ${parts.join(', ')}`];
  if (scope) summary[0] += scope.error ? `; --since ${scope.ref} ignored (${scope.error})` : `; ${pages.filter((p) => p.inScope).length} in scope of ${scope.ref}`;
  if (uncovered.length) summary.push(`${uncovered.length} changed file(s) no page covers: ${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}`);
  return { ok: true, exists: true, head, since: scope, uncovered, pages, counts, summary };
```

Replace the CLI block at the bottom with:

```js
if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/stale.mjs')) {
  runMain((_, flags) => stale(resolveRoot(flags), {
    session: typeof flags.session === 'string' ? flags.session : null,
    changed: flagList(flags, 'changed'),
    since: typeof flags.since === 'string' ? flags.since : null,
  }));
}
```

- [ ] **Step 6: Run the suite**

Run: `node plugins/ship-faster/tests/run.mjs`
Expected: all pass. `hook-session-start` ignores the new fields.

- [ ] **Step 7: Update the README's script list**

In `plugins/ship-faster/README.md`, replace the `stale.mjs` line with:

```
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable (--since <ref> marks pages in a branch's scope, --session all merges every session record; a page committed together with the covered change stays fresh)
```

- [ ] **Step 8: Commit**

```bash
git add plugins/ship-faster/scripts/lib/git.mjs plugins/ship-faster/scripts/lib/state.mjs plugins/ship-faster/scripts/stale.mjs plugins/ship-faster/tests/git.test.mjs plugins/ship-faster/tests/state.test.mjs plugins/ship-faster/tests/stale.test.mjs plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: scope staleness to a branch diff and list changed files no page covers

stale --since <ref> marks which non-fresh pages a branch's changes, the
working tree, and session records put in scope, --session all merges every
session record, and uncovered lists changed files without a covering page
so sync-docs can find new behaviour.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 4: `detect --brief`, `config`, and `dataDir`

**Files:**
- Modify: `plugins/ship-faster/scripts/detect.mjs`
- Test: `plugins/ship-faster/tests/detect.test.mjs`

**Interfaces:**
- Consumes: `projectDir` (lib/state.mjs), `loadConfig`.
- Produces: `detect(root)` output gains `config` (the resolved config object) and `dataDir` (the project's state directory, `/`-separated). `detect(root, { brief: true })` returns only `ok`, `root`, `git`, `stacks`, `ci`, `existing`, `config`, `dataDir`, `summary`. CLI flag `--brief`. Skills that only need orientation (`lesson`, `sync-docs`) inject the brief form to keep their recurring context cost small.

- [ ] **Step 1: Write the failing test**

Append to `plugins/ship-faster/tests/detect.test.mjs` (add `import { projectHash } from '../scripts/lib/state.mjs';` to the imports):

```js
test('detect reports the resolved config and the project data directory, and --brief drops the long lists', () => {
  process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-');
  const { root } = makeRepo({ files: { '.claude/ship-faster.json': JSON.stringify({ wikiDir: 'wiki', pageMaxLines: 120 }), 'package.json': JSON.stringify({ scripts: { test: 'node -e 0' } }), 'src/index.js': '' } });
  const r = detect(root);
  assert.equal(r.config.wikiDir, 'wiki');
  assert.equal(r.config.pageMaxLines, 120);
  assert.equal(r.config.rulesDir, '.claude/rules');
  assert.ok(r.dataDir.endsWith(`/projects/${projectHash(root)}`), r.dataDir);
  assert.ok(!r.dataDir.includes('\\'));
  const brief = detect(root, { brief: true });
  assert.deepEqual(Object.keys(brief).sort(), ['ci', 'config', 'dataDir', 'existing', 'git', 'ok', 'root', 'stacks', 'summary']);
  assert.equal(brief.git.head, r.git.head);
  const cli = runScript('detect', ['--root', root, '--brief', '--json']);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.scripts, undefined);
  assert.equal(cli.json.config.wikiDir, 'wiki');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/ship-faster/tests/detect.test.mjs`
Expected: `r.config` is undefined.

- [ ] **Step 3: Implement**

Add `import { projectDir } from './lib/state.mjs';` to detect.mjs. Change the signature to `export function detect(root, { brief = false } = {})`. In the result object add, after `existing`:

```js
    topDirs, workspaces, existing,
    config,
    dataDir: normalizePath(projectDir(root)),
    suggestedChecks: checks,
```

Before `return result;` add:

```js
  if (brief) {
    const { ok, root: r, git: g, stacks: s, ci: c, existing: e, config: cfg, dataDir, summary } = result;
    return { ok, root: r, git: g, stacks: s, ci: c, existing: e, config: cfg, dataDir, summary };
  }
```

Change the CLI block to `runMain((_, flags) => detect(resolveRoot(flags), { brief: Boolean(flags.brief) }));`.

- [ ] **Step 4: Run the suite**

Run: `node plugins/ship-faster/tests/run.mjs`
Expected: all pass.

- [ ] **Step 5: Update the README's script list**

Replace the `detect.mjs` line in `plugins/ship-faster/README.md`:

```
node scripts/detect.mjs        stacks, CI files, scripts, workspaces, suggested checks, resolved config, data dir (--brief for orientation only)
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/detect.mjs plugins/ship-faster/tests/detect.test.mjs plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: detect exposes the resolved config and data dir, with a --brief form for skills

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 5: `page.mjs` stamps `verified` and `updated`

**Files:**
- Create: `plugins/ship-faster/scripts/page.mjs`
- Test: `plugins/ship-faster/tests/page.test.mjs`

**Interfaces:**
- Consumes: `parseFrontmatter`, `updateFrontmatter` (lib/fm.mjs); `head`, `isRepo` (lib/git.mjs); `relPath`, `wikiDir` (lib/wiki.mjs); `loadConfig`; `resolveRoot`; `runMain`; `normalizePath`.
- Produces:
  - `today() → 'yyyy-mm-dd'` (UTC).
  - `verifyPages(root, rels, { config, sha, date }) → { ok, error?, sha, date, pages: [{ rel, ok, verified?, updated?, error? }], summary }`: sets `verified` to `sha` (default HEAD, `unverified` outside git) and `updated` to `date` (default today) on each page. Rejects paths outside the wiki directory, `index.md`, missing files, and pages with missing or invalid frontmatter; `ok` is false when any page was rejected, but valid pages in the same call are still updated.
  - `touchPages(root, rels, { config, date })`: same, but only `updated` changes.
  - CLI: `node scripts/page.mjs verify <rel>... [--sha <sha>] [--date <yyyy-mm-dd>] --json`, `node scripts/page.mjs touch <rel>... [--date <yyyy-mm-dd>] --json`.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/page.test.mjs`:

```js
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { parseFrontmatter, serializeFrontmatter } from '../scripts/lib/fm.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { today, touchPages, verifyPages } from '../scripts/page.mjs';

after(cleanupAll);
beforeEach(() => { process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-'); });

const page = (title, extra = {}) => serializeFrontmatter({ title, summary: 's', read_when: 'r', covers: ['src/**'], verified: 'unverified', updated: '2020-01-01', ...extra }) + `# ${title}\n\nBody.\n`;
const fm = (file) => parseFrontmatter(readFileSync(file, 'utf8')).data;

test('today is a UTC yyyy-mm-dd string', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today(), new Date().toISOString().slice(0, 10));
});

test('verify stamps HEAD and today, keeps the body and the other fields, and handles many pages at once', () => {
  const { root, git } = makeRepo({ files: { 'src/a.ts': 'a' } });
  const head = git(['rev-parse', 'HEAD']);
  const w = join(root, 'docs', 'wiki', 'recipes');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(root, 'docs', 'wiki', 'commands.md'), page('Commands', { checks: [{ name: 'test', run: 'npm test', timeout: 60 }] }));
  writeFileSync(join(w, 'add-endpoint.md'), page('Add endpoint'));
  const r = verifyPages(root, ['docs/wiki/commands.md', 'docs/wiki/recipes/add-endpoint.md'], { config: DEFAULTS });
  assert.equal(r.ok, true);
  assert.equal(r.sha, head);
  assert.equal(r.date, today());
  assert.deepEqual(r.pages.map((p) => [p.rel, p.ok]), [['docs/wiki/commands.md', true], ['docs/wiki/recipes/add-endpoint.md', true]]);
  const commands = fm(join(root, 'docs', 'wiki', 'commands.md'));
  assert.equal(commands.verified, head);
  assert.equal(commands.updated, today());
  assert.deepEqual(commands.checks, [{ name: 'test', run: 'npm test', timeout: 60 }]);
  assert.deepEqual(commands.covers, ['src/**']);
  assert.match(readFileSync(join(root, 'docs', 'wiki', 'commands.md'), 'utf8'), /\n# Commands\n\nBody\.\n$/);
  assert.equal(fm(join(w, 'add-endpoint.md')).verified, head);
});

test('verify accepts explicit sha and date, and touch changes only updated', () => {
  const { root } = makeRepo({ files: { 'src/a.ts': 'a' } });
  const file = join(root, 'docs', 'wiki', 'testing.md');
  mkdirSync(join(root, 'docs', 'wiki'), { recursive: true });
  writeFileSync(file, page('Testing', { verified: 'aaaa' }));
  verifyPages(root, ['docs/wiki/testing.md'], { config: DEFAULTS, sha: 'bbbb', date: '2026-01-02' });
  assert.deepEqual([fm(file).verified, fm(file).updated], ['bbbb', '2026-01-02']);
  const t = touchPages(root, ['docs/wiki/testing.md'], { config: DEFAULTS, date: '2026-03-04' });
  assert.equal(t.ok, true);
  assert.deepEqual([fm(file).verified, fm(file).updated], ['bbbb', '2026-03-04']);
});

test('verify rejects paths outside the wiki, index.md, missing pages, and broken frontmatter but still updates the valid ones', () => {
  const { root } = makeRepo({ files: { 'src/a.ts': 'a', 'README.md': '# r\n' } });
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'index.md'), '# i\n');
  writeFileSync(join(w, 'good.md'), page('Good'));
  writeFileSync(join(w, 'broken.md'), '---\ntitle: [oops\n---\nbody\n');
  const r = verifyPages(root, ['README.md', 'docs/wiki/index.md', 'docs/wiki/missing.md', 'docs/wiki/broken.md', 'docs/wiki/good.md'], { config: DEFAULTS });
  assert.equal(r.ok, false);
  assert.match(r.error, /4 page\(s\) not updated/);
  assert.deepEqual(r.pages.map((p) => p.ok), [false, false, false, false, true]);
  assert.match(r.pages[0].error, /not inside docs\/wiki/);
  assert.match(r.pages[1].error, /index\.md/);
  assert.match(r.pages[2].error, /not found/);
  assert.match(r.pages[3].error, /frontmatter/);
  assert.notEqual(fm(join(w, 'good.md')).verified, 'unverified');
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# r\n');
});

test('outside git the sha is unverified; the CLI runs verify and touch', () => {
  const root = tmpDir('sf-nogit-');
  const w = join(root, 'docs', 'wiki');
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, 'p.md'), page('P'));
  const r = verifyPages(root, ['docs/wiki/p.md'], { config: DEFAULTS });
  assert.equal(r.sha, 'unverified');
  const { root: repo, git } = makeRepo({ files: { 'src/a.ts': 'a' } });
  mkdirSync(join(repo, 'docs', 'wiki'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'wiki', 'q.md'), page('Q'));
  const cli = runScript('page', ['verify', 'docs/wiki/q.md', '--root', repo, '--json']);
  assert.equal(cli.code, 0);
  assert.equal(cli.json.ok, true);
  assert.equal(cli.json.sha, git(['rev-parse', 'HEAD']));
  const touched = runScript('page', ['touch', 'docs/wiki/q.md', '--date', '2026-05-06', '--root', repo, '--json']);
  assert.equal(touched.json.ok, true);
  assert.equal(fm(join(repo, 'docs', 'wiki', 'q.md')).updated, '2026-05-06');
  const none = runScript('page', ['verify', '--root', repo, '--json']);
  assert.equal(none.json.ok, false);
  assert.match(none.json.error, /at least one page/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/ship-faster/tests/page.test.mjs`
Expected: FAIL, `Cannot find module '.../scripts/page.mjs'`.

- [ ] **Step 3: Write page.mjs**

`plugins/ship-faster/scripts/page.mjs`:

```js
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { parseFrontmatter, updateFrontmatter } from './lib/fm.mjs';
import * as git from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { relPath, wikiDir } from './lib/wiki.mjs';

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function stamp(root, rels, patchFor, { config } = {}) {
  config = config || loadConfig(root).config;
  const wiki = normalizePath(resolve(wikiDir(root, config)));
  const pages = [];
  for (const given of rels) {
    const file = isAbsolute(given) ? given : join(root, ...normalizePath(given).split('/'));
    const abs = normalizePath(resolve(file));
    if (!abs.startsWith(wiki + '/')) { pages.push({ rel: given, ok: false, error: `not inside ${config.wikiDir}` }); continue; }
    const rel = relPath(root, file);
    if (rel.endsWith('/index.md')) { pages.push({ rel, ok: false, error: 'index.md is generated and has no frontmatter' }); continue; }
    if (!existsSync(file)) { pages.push({ rel, ok: false, error: 'not found' }); continue; }
    const text = readFileSync(file, 'utf8');
    const { data, errors } = parseFrontmatter(text);
    if (!data || errors.length) { pages.push({ rel, ok: false, error: 'frontmatter missing or invalid' }); continue; }
    const patch = patchFor();
    writeFileSync(file, updateFrontmatter(text, patch));
    pages.push({ rel, ok: true, ...patch });
  }
  const failed = pages.filter((p) => !p.ok);
  return { ok: failed.length === 0, error: failed.length ? `${failed.length} page(s) not updated` : undefined, pages };
}

export function verifyPages(root, rels, { config, sha, date } = {}) {
  sha = sha || (git.isRepo(root) ? git.head(root) : null) || 'unverified';
  date = date || today();
  const r = stamp(root, rels, () => ({ verified: sha, updated: date }), { config });
  return { ...r, sha, date, summary: r.pages.map((p) => (p.ok ? `${p.rel}: verified ${sha.slice(0, 7)}, updated ${date}` : `${p.rel}: ${p.error}`)) };
}

export function touchPages(root, rels, { config, date } = {}) {
  date = date || today();
  const r = stamp(root, rels, () => ({ updated: date }), { config });
  return { ...r, date, summary: r.pages.map((p) => (p.ok ? `${p.rel}: updated ${date}` : `${p.rel}: ${p.error}`)) };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/page.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const [cmd, ...rels] = positional;
    if (cmd !== 'verify' && cmd !== 'touch') return { ok: false, error: `unknown command ${cmd}; use verify or touch` };
    if (!rels.length) return { ok: false, error: `${cmd} needs at least one page path` };
    const date = typeof flags.date === 'string' ? flags.date : undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '--date must be yyyy-mm-dd' };
    if (cmd === 'touch') return touchPages(root, rels, { config, date });
    const sha = typeof flags.sha === 'string' ? flags.sha : undefined;
    if (sha && sha !== 'unverified' && !/^[0-9a-f]{4,40}$/i.test(sha)) return { ok: false, error: '--sha must be a hex commit or unverified' };
    return verifyPages(root, rels, { config, sha, date });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/ship-faster/tests/page.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the script to the README list**

In `plugins/ship-faster/README.md`, add after the `plan.mjs` line in the Scripts block:

```
node scripts/page.mjs          verify <page>... | touch <page>...: stamp verified (HEAD) and updated (today) on wiki pages
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/page.mjs plugins/ship-faster/tests/page.test.mjs plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: page script stamps verified and updated on wiki pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 6: `claude-md.mjs` parses sections and splices the managed block

**Files:**
- Create: `plugins/ship-faster/scripts/claude-md.mjs`
- Test: `plugins/ship-faster/tests/claude-md.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`; `backupDir` (lib/state.mjs); `resolveRoot`; `runMain`; `normalizePath`.
- Produces:
  - `START`, `END`: the marker comments `<!-- ship-faster:managed:start -->` and `<!-- ship-faster:managed:end -->`. `MANAGED_MAX = 90`.
  - `sections(text) → { title, sections: [{ heading, start, end, lines, managed, text }], managed: { start, end } | null, lines }`: H1 title and every H2 section (1-based inclusive line ranges), ignoring headings inside code fences; `managed` is set when a section starts inside the markers.
  - `splice(existing, block, { projectName }) → { content, managedLines, lines, replaced }`: pure. `existing` is the current CLAUDE.md text or `null`. With markers present, only the text between them is replaced. Without markers, the block is inserted after the H1 (or at the top). With `null`, a new file `# <projectName>` + block + `## Rules` is produced.
  - `spliceFile(root, block, { config, projectName, force, dryRun }) → { ok, error?, path, created, replaced, lines, managedLines, written, warnings, content?, summary }`: writes CLAUDE.md unless the managed block exceeds 90 lines or the file would exceed `config.claudeMdMaxLines` (then `ok: false`, nothing written, unless `force`). `dryRun` returns `content` without writing.
  - `backupClaudeMd(root) → { ok, backup: path | null, summary }`: copies CLAUDE.md to the project's backup directory with a timestamp suffix.
  - CLI: `node scripts/claude-md.mjs sections --json`, `node scripts/claude-md.mjs splice --block <file> [--name <project>] [--dry-run] [--force] --json`, `node scripts/claude-md.mjs backup --json`.

- [ ] **Step 1: Write the failing tests**

`plugins/ship-faster/tests/claude-md.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/ship-faster/tests/claude-md.test.mjs`
Expected: FAIL, `Cannot find module '.../scripts/claude-md.mjs'`.

- [ ] **Step 3: Write claude-md.mjs**

`plugins/ship-faster/scripts/claude-md.mjs`:

```js
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runMain } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { normalizePath } from './lib/glob.mjs';
import { resolveRoot } from './lib/root.mjs';
import { backupDir } from './lib/state.mjs';

export const START = '<!-- ship-faster:managed:start -->';
export const END = '<!-- ship-faster:managed:end -->';
export const MANAGED_MAX = 90;

const lf = (text) => String(text).replace(/\r\n/g, '\n');

function countLines(text) {
  const t = lf(text);
  return t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
}

export function sections(text) {
  const lines = lf(text).split('\n');
  const total = countLines(text);
  const out = [];
  let managed = null;
  let title = null;
  let inFence = false;
  let cur = null;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const trimmed = line.trim();
    if (trimmed === START) managed = { start: i + 1, end: null };
    else if (trimmed === END && managed && managed.end === null) managed.end = i + 1;
    if (inFence) return;
    const h1 = /^# (.+)$/.exec(line);
    if (h1 && title === null) { title = h1[1].trim(); return; }
    const h2 = /^## (.+)$/.exec(line);
    if (!h2) return;
    if (cur) cur.end = i;
    cur = { heading: h2[1].trim(), start: i + 1, end: total, lines: 0, managed: false, text: '' };
    out.push(cur);
  });
  for (const s of out) {
    s.text = lines.slice(s.start - 1, s.end).join('\n').replace(/\n+$/, '');
    s.lines = s.text === '' ? 0 : s.text.split('\n').length;
    s.managed = Boolean(managed && managed.end && s.start > managed.start && s.start < managed.end);
  }
  if (managed && managed.end === null) managed = null;
  return { title, sections: out, managed, lines: countLines(text) };
}

export function splice(existing, block, { projectName = 'Project' } = {}) {
  const body = lf(block).replace(/^\n+|\n+$/g, '');
  const managedLines = body === '' ? 0 : body.split('\n').length;
  const managedBlock = `${START}\n${body}\n${END}`;
  let content;
  let replaced = false;
  if (existing === null || existing === undefined) {
    content = `# ${projectName}\n\n${managedBlock}\n\n## Rules\n`;
  } else {
    const text = lf(existing);
    const s = text.indexOf(START);
    const e = text.indexOf(END, s === -1 ? 0 : s);
    if (s !== -1 && e !== -1) {
      content = text.slice(0, s) + managedBlock + text.slice(e + END.length);
      replaced = true;
    } else {
      const lines = text.split('\n');
      const h1 = lines.findIndex((l) => /^# /.test(l));
      lines.splice(h1 === -1 ? 0 : h1 + 1, 0, '', managedBlock, '');
      content = lines.join('\n');
    }
  }
  content = content.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  if (!content.endsWith('\n')) content += '\n';
  return { content, managedLines, lines: countLines(content), replaced };
}

export function spliceFile(root, block, { config, projectName, force = false, dryRun = false } = {}) {
  config = config || loadConfig(root).config;
  const file = join(root, 'CLAUDE.md');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const name = projectName || (existing !== null && sections(existing).title) || basename(normalizePath(root).replace(/\/+$/, '')) || 'Project';
  const r = splice(existing, block, { projectName: name });
  const warnings = [];
  if (r.managedLines > MANAGED_MAX) warnings.push(`managed block is ${r.managedLines} lines, limit ${MANAGED_MAX}`);
  if (r.lines > config.claudeMdMaxLines) warnings.push(`CLAUDE.md would be ${r.lines} lines, limit ${config.claudeMdMaxLines}`);
  const base = { path: 'CLAUDE.md', created: existing === null, replaced: r.replaced, lines: r.lines, managedLines: r.managedLines, warnings };
  if (warnings.length && !force) return { ok: false, error: warnings.join('; '), ...base, written: false };
  if (!dryRun) writeFileSync(file, r.content);
  const verb = dryRun ? 'would write' : 'wrote';
  return { ok: true, ...base, written: !dryRun, content: dryRun ? r.content : undefined, summary: [`${verb} CLAUDE.md: ${r.lines} lines, managed block ${r.managedLines} lines${r.replaced ? ' (replaced)' : existing === null ? ' (created)' : ' (inserted)'}`, ...warnings] };
}

export function backupClaudeMd(root) {
  const file = join(root, 'CLAUDE.md');
  if (!existsSync(file)) return { ok: true, backup: null, summary: ['no CLAUDE.md to back up'] };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(backupDir(root), `CLAUDE.md.${stamp}.${process.pid}`);
  copyFileSync(file, dest);
  const backup = normalizePath(dest);
  return { ok: true, backup, summary: [`backed up CLAUDE.md to ${backup}`] };
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/claude-md.mjs')) {
  runMain((positional, flags) => {
    const root = resolveRoot(flags);
    const { config } = loadConfig(root);
    const [cmd] = positional;
    if (cmd === 'sections') {
      const file = join(root, 'CLAUDE.md');
      if (!existsSync(file)) return { ok: true, exists: false, title: null, sections: [], managed: null, lines: 0, summary: ['no CLAUDE.md'] };
      const s = sections(readFileSync(file, 'utf8'));
      return { ok: true, exists: true, ...s, summary: [`${s.sections.length} section(s), ${s.lines} lines${s.managed ? ', managed block present' : ''}`, ...s.sections.map((x) => `${x.heading}: ${x.lines} lines${x.managed ? ' (managed)' : ''}`)] };
    }
    if (cmd === 'splice') {
      if (typeof flags.block !== 'string') return { ok: false, error: 'splice requires --block <file>' };
      if (!existsSync(flags.block)) return { ok: false, error: `block file not found: ${flags.block}` };
      return spliceFile(root, readFileSync(flags.block, 'utf8'), { config, projectName: typeof flags.name === 'string' ? flags.name : undefined, force: Boolean(flags.force), dryRun: Boolean(flags['dry-run']) });
    }
    if (cmd === 'backup') return backupClaudeMd(root);
    return { ok: false, error: `unknown command ${cmd}; use sections, splice, or backup` };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/ship-faster/tests/claude-md.test.mjs`
Expected: PASS (5 tests). If the `sections` line-number assertions fail, print `sections(EXISTING)` and check the fixture's line count before touching the implementation: `EXISTING` is 17 lines, markers on lines 5 and 8, `## Rules` on line 10.

- [ ] **Step 5: Add the script to the README list**

In `plugins/ship-faster/README.md`, add after the `page.mjs` line:

```
node scripts/claude-md.mjs     sections | splice --block <file> | backup: read, regenerate, and back up CLAUDE.md's managed block
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ship-faster/scripts/claude-md.mjs plugins/ship-faster/tests/claude-md.test.mjs plugins/ship-faster/README.md
git commit -F <message file>
```

Message:

```
feat: claude-md script parses sections and splices the managed block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 7: Templates

**Files:**
- Create: `plugins/ship-faster/templates/claude-md.md`
- Create: `plugins/ship-faster/templates/package-claude-md.md`
- Create: `plugins/ship-faster/templates/plan.md`
- Create: `plugins/ship-faster/templates/rules-file.md`
- Create: `plugins/ship-faster/templates/gotcha-entry.md`
- Create: `plugins/ship-faster/templates/pages/overview.md`, `architecture.md`, `layout.md`, `commands.md`, `conventions.md`, `testing.md`, `gotchas.md`, `dependencies.md`, `ops.md`, `recipe.md`, `package.md`
- Test: `plugins/ship-faster/tests/templates.test.mjs`

**Interfaces:**
- Consumes: `parseFrontmatter` (lib/fm.mjs), `REQUIRED_FIELDS` (lib/wiki.mjs), `START`/`END` (claude-md.mjs).
- Produces: static files. Placeholders are `{{name}}`; author guidance is in `<!-- -->` comments that the skill deletes when it fills the template. Skills read templates at `${CLAUDE_PLUGIN_ROOT}/templates/<file>`. Task 8's validator requires every file listed here to exist.

Required sections per page type (spec 4.2), which the test asserts:

| Template | H2 sections in order |
|---|---|
| overview | What it is, Users, Vocabulary, Boundaries |
| architecture | Components, Data flow, Boundaries, Decisions |
| layout | Map, Entry points, Where things go |
| commands | Setup, Everyday, Checks, Known slow or flaky |
| conventions | Follow, Avoid, Style |
| testing | Layout, Adding a test, Fixtures and mocks, Not runnable locally |
| gotchas | (none required; entries are H3) |
| dependencies | Key deps, Pinned, Upgrading |
| ops | Environments, CI, Deploy, Release, Secrets by name |
| recipe | Steps, Files, Test, Docs |
| package | What, Commands, Read next |

- [ ] **Step 1: Write the failing test**

`plugins/ship-faster/tests/templates.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './helpers.mjs';
import { parseFrontmatter } from '../scripts/lib/fm.mjs';
import { REQUIRED_FIELDS } from '../scripts/lib/wiki.mjs';
import { END, START } from '../scripts/claude-md.mjs';

const T = join(PLUGIN_ROOT, 'templates');
const read = (rel) => readFileSync(join(T, rel), 'utf8');
const countLines = (text) => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
const h2s = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());

const PAGES = {
  overview: ['What it is', 'Users', 'Vocabulary', 'Boundaries'],
  architecture: ['Components', 'Data flow', 'Boundaries', 'Decisions'],
  layout: ['Map', 'Entry points', 'Where things go'],
  commands: ['Setup', 'Everyday', 'Checks', 'Known slow or flaky'],
  conventions: ['Follow', 'Avoid', 'Style'],
  testing: ['Layout', 'Adding a test', 'Fixtures and mocks', 'Not runnable locally'],
  gotchas: [],
  dependencies: ['Key deps', 'Pinned', 'Upgrading'],
  ops: ['Environments', 'CI', 'Deploy', 'Release', 'Secrets by name'],
  recipe: ['Steps', 'Files', 'Test', 'Docs'],
  package: ['What', 'Commands', 'Read next'],
};

test('every template file exists', () => {
  for (const f of ['claude-md.md', 'package-claude-md.md', 'plan.md', 'rules-file.md', 'gotcha-entry.md', ...Object.keys(PAGES).map((p) => `pages/${p}.md`)]) {
    assert.ok(existsSync(join(T, f)), `missing templates/${f}`);
  }
});

test('page templates carry the required frontmatter and the required sections in order, under budget', () => {
  for (const [name, expected] of Object.entries(PAGES)) {
    const text = read(`pages/${name}.md`);
    const { data, errors } = parseFrontmatter(text);
    assert.ok(data, `${name}: no frontmatter`);
    assert.deepEqual(errors, [], `${name}: ${JSON.stringify(errors)}`);
    for (const k of REQUIRED_FIELDS) assert.ok(k in data, `${name}: missing ${k}`);
    assert.ok(Array.isArray(data.covers) && data.covers.length > 0, `${name}: covers must be a non-empty list`);
    const found = h2s(text);
    for (const h of expected) assert.ok(found.includes(h), `${name}: missing section "${h}" (found ${found.join(', ')})`);
    assert.deepEqual(found.filter((h) => expected.includes(h)), expected, `${name}: sections out of order`);
    assert.ok(countLines(text) <= 60, `${name}: template is ${countLines(text)} lines`);
  }
  const commands = parseFrontmatter(read('pages/commands.md')).data;
  assert.ok(Array.isArray(commands.checks) && commands.checks.every((c) => typeof c.run === 'string'), 'commands template needs a checks list');
  assert.match(read('pages/gotchas.md'), /^### /m);
});

test('the CLAUDE.md template has the managed markers, the six managed sections, and a Rules section', () => {
  const text = read('claude-md.md');
  assert.ok(text.includes(START) && text.includes(END));
  const inside = text.slice(text.indexOf(START), text.indexOf(END));
  assert.deepEqual(h2s(inside).map((h) => h.replace(/\s*\(.*\)$/, '')), ['What this is', 'Stack', 'Layout', 'Commands', 'Read next', 'Keeping docs true']);
  assert.ok(h2s(text.slice(text.indexOf(END))).includes('Rules'));
  assert.ok(countLines(inside) <= 60, 'managed skeleton must leave room under the 90-line cap');
  assert.ok(!text.includes('@docs/') && !/^@/m.test(text), 'CLAUDE.md never imports wiki pages');
});

test('plan, rules, package CLAUDE.md, and gotcha entry templates have the right shape', () => {
  const plan = parseFrontmatter(read('plan.md'));
  for (const k of ['title', 'branch', 'status', 'created', 'pages']) assert.ok(k in plan.data, `plan: missing ${k}`);
  assert.equal(plan.data.status, 'active');
  assert.deepEqual(h2s(read('plan.md')), ['Goal', 'Scope', 'Touchpoints', 'Tests to add', 'Docs impact', 'Risks', 'Verification']);
  const rules = parseFrontmatter(read('rules-file.md'));
  assert.ok(Array.isArray(rules.data.paths) && rules.data.paths.length > 0, 'rules file needs a paths list');
  assert.ok(countLines(read('rules-file.md')) <= 25);
  assert.ok(countLines(read('package-claude-md.md')) <= 30);
  assert.deepEqual(h2s(read('package-claude-md.md')), ['What this is', 'Commands', 'Read next']);
  const entry = read('gotcha-entry.md');
  for (const label of ['Symptom:', 'Cause:', 'Rule:', 'Evidence:']) assert.ok(entry.includes(label), `gotcha entry: missing ${label}`);
  assert.match(entry, /<!-- id: g-\{\{yyyymmdd\}\}-\{\{slug\}\} -->/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/ship-faster/tests/templates.test.mjs`
Expected: FAIL on `missing templates/claude-md.md`.

- [ ] **Step 3: Write the templates**

`plugins/ship-faster/templates/claude-md.md`:

```markdown
# {{project_name}}

<!-- ship-faster:managed:start -->
## What this is
{{purpose: one sentence on what the software does}}
{{users: one sentence on who uses it}}
{{shape: one sentence on the shape of the system}}

## Stack
- {{language and version}}
- {{framework}}
- {{package manager}}
- {{database or storage}}
- {{infra or runtime}}
- {{anything unusual}}

## Layout
| Directory | Responsibility | Entry point |
|---|---|---|
| `{{dir}}/` | {{one clause}} | `{{file}}` |

## Commands (verified {{yyyy-mm-dd}} at {{short_sha}})
| Purpose | Command | Duration |
|---|---|---|
| {{purpose}} | `{{command}}` | {{n}}s |
| {{deploy or publish}} | `{{command}}` | not run |

## Read next
| When you need to… | Open |
|---|---|
| {{task or question}} | `{{wiki_dir}}/{{page}}.md` |
| {{task shape}} | `{{wiki_dir}}/recipes/{{task}}.md` |

`{{wiki_dir}}/index.md` lists every page.

## Keeping docs true
Pages under `{{wiki_dir}}/` carry `covers` globs and a `verified` commit; `/ship-faster:sync-docs` refreshes stale pages and `/ship-faster:ship` runs it before every PR.
Record non-obvious causes with `/ship-faster:lesson` right after learning them.
<!-- ship-faster:managed:end -->

## Rules
- {{imperative sentence, one per line; hand-written, preserved across regeneration}}
```

`plugins/ship-faster/templates/package-claude-md.md`:

```markdown
# {{package_name}}

<!-- Per-package CLAUDE.md for monorepos: 30 lines maximum. The root CLAUDE.md stays the router. -->

## What this is
{{one or two sentences: what this package is and who depends on it}}

## Commands
| Purpose | Command | Duration |
|---|---|---|
| {{purpose}} | `{{command run from this directory}}` | {{n}}s |

## Read next
| When you need to… | Open |
|---|---|
| {{task}} | `{{path from repo root to the most relevant page}}` |
| {{task}} | `{{second page}}` |
| {{task}} | `{{third page}}` |
```

`plugins/ship-faster/templates/plan.md`:

````markdown
---
title: {{Feature title}}
branch: {{type}}/{{slug}}
status: active
created: {{yyyy-mm-dd}}
pages: [{{page}}, {{recipes/task}}]
---
# {{Feature title}}

## Goal
{{One paragraph: the outcome, who it is for, how you will know it works.}}

## Scope
{{The complete feature. Nothing deferred. Bullet what is in; bullet what is explicitly out and why.}}

## Touchpoints
<!-- Ordered. Every path confirmed to exist, or marked (new). -->
1. `{{path}}` — {{what changes}}
2. `{{path}}` (new) — {{what it holds}}

## Tests to add
<!-- Framework and location from testing.md. -->
- `{{test path}}`: {{behaviour under test}}

## Docs impact
<!-- Pages whose covers the touchpoints hit, and what claim changes. -->
- `{{wiki_dir}}/{{page}}.md`: {{claim that changes}}

## Risks
<!-- Quote the gotchas that apply, by id. -->
- {{risk}} (see `{{wiki_dir}}/gotchas.md` g-{{yyyymmdd}}-{{slug}})

## Verification
```
{{command that proves it works}}
```
````

`plugins/ship-faster/templates/rules-file.md`:

```markdown
---
paths: [{{glob}}, {{glob}}]
---
# {{Area}} rules
<!-- 25 lines maximum. One imperative rule per line, each pointing at the gotcha id or page that explains it. -->
- {{Imperative rule.}} ({{wiki_dir}}/gotchas.md g-{{yyyymmdd}}-{{slug}})
- {{Imperative rule.}} ({{wiki_dir}}/conventions.md)
```

`plugins/ship-faster/templates/gotcha-entry.md`:

```markdown
### {{Short title}} <!-- id: g-{{yyyymmdd}}-{{slug}} -->
Symptom: {{what you see}}
Cause: {{why it happens; the part that is not visible locally}}
Rule: {{the imperative sentence that prevents it}}
Evidence: {{commit sha or path:line}}, {{yyyy-mm-dd}}.
```

`plugins/ship-faster/templates/pages/overview.md`:

```markdown
---
title: Overview
summary: {{One sentence: what the product is and who it serves.}}
read_when: You are new to the repository or need the domain vocabulary and system boundaries.
covers: ["README*", "{{root manifest}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Overview

## What it is
{{Two or three sentences. Purpose, not implementation.}}

## Users
{{Who uses it and through what surface (UI, API, CLI, library).}}

## Vocabulary
| Term | Meaning | Where it lives |
|---|---|---|
| {{term}} | {{one clause}} | `{{path}}` |

## Boundaries
{{What this system owns, what it calls, what calls it. Name external systems and the files that talk to them.}}
```

`plugins/ship-faster/templates/pages/architecture.md`:

```markdown
---
title: Architecture
summary: {{One sentence: the main components and how data moves between them.}}
read_when: You are changing how components interact, adding a component, or need the reason behind a structural decision.
covers: ["{{src}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Architecture

## Components
| Component | Responsibility | Code |
|---|---|---|
| {{name}} | {{one clause}} | `{{path}}` |

## Data flow
{{Numbered steps from input to output, naming the file that handles each step.}}

## Boundaries
{{Which components may call which. What must never call what, and why.}}

## Decisions
<!-- One entry per decision. /ship-faster:lesson appends here when a lesson is classified as a decision. -->
### {{Decision title}} <!-- id: d-{{yyyymmdd}}-{{slug}} -->
Decision: {{what was chosen}}
Why: {{the reason a reader could not infer}}
Alternatives: {{what was rejected and why}}
Evidence: {{commit or path:line}}, {{yyyy-mm-dd}}.
```

`plugins/ship-faster/templates/pages/layout.md`:

```markdown
---
title: Layout
summary: {{One sentence: where things live and where new things go.}}
read_when: You need to find where something lives or decide where a new file belongs.
covers: ["{{root manifest}}", "{{src}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Layout

## Map
| Directory | Responsibility |
|---|---|
| `{{dir}}/` | {{one clause}} |

## Entry points
| Entry | Starts | File |
|---|---|---|
| {{name}} | {{what it starts}} | `{{path}}` |

## Where things go
| Adding a… | Put it in | Named like | Register in |
|---|---|---|---|
| {{kind of thing}} | `{{dir}}/` | `{{pattern}}` | `{{file or "nothing"}}` |
```

`plugins/ship-faster/templates/pages/commands.md`:

```markdown
---
title: Commands
summary: {{One sentence: verified dev, test, and build commands with durations.}}
read_when: You need to run, test, build, or debug the environment, or preflight needs the check list.
covers: ["{{root manifest}}", "{{ci files}}", "{{scripts dir}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
checks:
  - name: {{check name}}
    run: {{command}}
    timeout: {{seconds}}
---
# Commands

## Setup
<!-- Tool versions, install command, env vars by name (never values), ports. -->
| Step | Command | Notes |
|---|---|---|
| {{step}} | `{{command}}` | {{note}} |

## Everyday
<!-- Only commands that passed when run. Deploy, publish, and release commands are listed with status "not run". -->
| Purpose | Command | Duration | Status |
|---|---|---|---|
| {{purpose}} | `{{command}}` | {{n}}s | pass |
| {{deploy}} | `{{command}}` | — | not run |

## Checks
<!-- The ordered list preflight runs; mirrors the checks frontmatter. -->
1. `{{command}}` — {{what it proves}}, about {{n}}s

## Known slow or flaky
- {{command or test}}: {{why, and what to do about it}}
```

`plugins/ship-faster/templates/pages/conventions.md`:

```markdown
---
title: Conventions
summary: {{One sentence: the patterns to follow and avoid in this codebase.}}
read_when: You are writing or reviewing code and need the naming, error handling, or style rules this repository actually follows.
covers: ["{{lint config}}", "{{src}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Conventions

## Follow
<!-- Each rule with one example path that shows it. /ship-faster:lesson appends conventions here. -->
- {{Imperative rule.}} Example: `{{path:line}}`

## Avoid
- {{Pattern to avoid}} — {{why}}. Instead: {{what to do}}.

## Style
| Aspect | Rule | Enforced by |
|---|---|---|
| {{naming, imports, errors, logging}} | {{rule}} | {{tool or "review"}} |
```

`plugins/ship-faster/templates/pages/testing.md`:

```markdown
---
title: Testing
summary: {{One sentence: how tests are organised and how to add one.}}
read_when: You are adding or fixing a test, need a fixture or mock, or a test cannot run locally.
covers: ["{{test dir}}/**", "{{test config}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Testing

## Layout
| Kind | Location | Runner | Command |
|---|---|---|---|
| {{unit, integration, e2e}} | `{{dir}}/` | {{framework}} | `{{command}}` |

## Adding a test
1. {{Where the file goes and how it is named.}}
2. {{What to import and the assertion style.}}
3. {{How to run just that test.}}

## Fixtures and mocks
| Need | Use | Defined in |
|---|---|---|
| {{a database, a fake clock, an HTTP stub}} | {{helper}} | `{{path}}` |

## Not runnable locally
- {{test or suite}}: {{why, and where it does run}}
```

`plugins/ship-faster/templates/pages/gotchas.md`:

```markdown
---
title: Gotchas
summary: {{One sentence: hard-won constraints, each with symptom, cause, rule, and evidence.}}
read_when: Something behaves in a way the code does not explain, or before touching the areas listed in covers.
covers: ["{{union of the paths the entries cite}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Gotchas

<!-- One entry per constraint. Newest last. Split into gotchas-<area>.md when this page passes 200 lines. -->

### {{Short title}} <!-- id: g-{{yyyymmdd}}-{{slug}} -->
Symptom: {{what you see}}
Cause: {{why it happens; the part that is not visible locally}}
Rule: {{the imperative sentence that prevents it}}
Evidence: {{commit sha or path:line}}, {{yyyy-mm-dd}}.
```

`plugins/ship-faster/templates/pages/dependencies.md`:

```markdown
---
title: Dependencies
summary: {{One sentence: the key dependencies, why each is there, and what is pinned.}}
read_when: You are adding, upgrading, or removing a dependency.
covers: ["{{lockfile}}", "{{root manifest}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Dependencies

## Key deps
| Dependency | Why it is here | Used from |
|---|---|---|
| {{name}} | {{one clause}} | `{{path}}` |

## Pinned
| Dependency | Pinned to | Reason |
|---|---|---|
| {{name}} | {{version}} | {{why}} |

## Upgrading
{{The command that checks for updates, the order to upgrade in, and what to run afterwards.}}
```

`plugins/ship-faster/templates/pages/ops.md`:

```markdown
---
title: Ops
summary: {{One sentence: environments, CI, deploy and release process, and secret names.}}
read_when: You are changing CI, preparing a release, or need to know how and where the software runs.
covers: ["{{ci files}}", "{{infra dir}}/**", "{{deploy scripts}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# Ops

## Environments
| Environment | Where | How it is configured |
|---|---|---|
| {{local, staging, production}} | {{host or platform}} | {{config source}} |

## CI
{{Pipeline file, the jobs in order, what each gates, typical duration.}}

## Deploy
<!-- Documented, never run by this plugin. -->
{{Who or what deploys, the trigger, the command or workflow, rollback.}}

## Release
{{Versioning scheme, where the version lives, tag format, changelog location.}}

## Secrets by name
<!-- Names only. Never values. -->
| Name | Used by | Provided through |
|---|---|---|
| {{ENV_VAR}} | `{{path}}` | {{secret store or CI variable}} |
```

`plugins/ship-faster/templates/pages/recipe.md`:

```markdown
---
title: {{Task title, imperative: Add an endpoint}}
summary: {{One sentence: what this recipe produces.}}
read_when: You need to {{task in one clause}}.
covers: ["{{the files the steps touch}}"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# {{Task title}}

## Steps
1. {{Ordered step naming the file and what to change.}}
2. {{Next step.}}

## Files
| File | Change |
|---|---|
| `{{path}}` | {{what changes}} |

## Test
{{The test to add, where, and the command that runs it.}}

## Docs
{{The page to update afterwards, and the claim that changes.}}
```

`plugins/ship-faster/templates/pages/package.md`:

```markdown
---
title: {{Package name}}
summary: {{One sentence: what this workspace package is.}}
read_when: You are working inside {{package path}}.
covers: ["{{package path}}/**"]
verified: {{sha}}
updated: {{yyyy-mm-dd}}
---
# {{Package name}}

## What
{{Purpose, public surface, who depends on it.}}

## Commands
| Purpose | Command (from the package directory) | Duration |
|---|---|---|
| {{purpose}} | `{{command}}` | {{n}}s |

## Read next
| When you need to… | Open |
|---|---|
| {{task}} | `{{page path}}` |
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test plugins/ship-faster/tests/templates.test.mjs`
Expected: PASS (4 tests). Also run `node plugins/ship-faster/tests/validate.mjs` and `claude plugin validate --strict plugins/ship-faster`; expected both pass (templates are not components).

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/templates plugins/ship-faster/tests/templates.test.mjs
git commit -F <message file>
```

Message:

```
feat: templates for CLAUDE.md, wiki pages, plans, rules files, and gotcha entries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---
### Task 8: Validator rules for skills, agents, evals, and templates

**Files:**
- Modify: `plugins/ship-faster/tests/validate.mjs`
- Test: `plugins/ship-faster/tests/validate.test.mjs`

**Interfaces:**
- Consumes: `parseFrontmatter` (scripts/lib/fm.mjs).
- Produces: `validate(repoRoot, overrides)` unchanged in signature. New error rules (every one is an `error`, never a warning):
  - Skills: unknown frontmatter field; missing `when_to_use` on a skill whose `disable-model-invocation` is not `true`; a `` !`…` `` line that does not end in `` || true` ``; a `${CLAUDE_PLUGIN_ROOT}/...` or `${CLAUDE_SKILL_DIR}/...` reference whose target does not exist; a bare `ship-faster:<name>` reference naming neither an agent file nor a skill; a `/ship-faster:<name>` invocation naming a skill outside the spec's nine names (`onboard`, `sync-docs`, `lesson`, `kickoff`, `preflight`, `ship`, `release`, `health`, `review`) or an existing skill directory; `context` present but not `fork`; `context: fork` without `agent: ship-faster:<existing agent>`; `background` present but not `true`/`false`; no `allowed-tools`. The marker comments (`ship-faster:managed:start`) are not references.
  - Agents: unknown frontmatter field; `tools` missing or containing a name outside the known tool list; `maxTurns` missing or not a positive integer; unknown `model`.
  - Evals: a skill directory without `evals/<skill>/prompt.md`; unknown `prompt.md` frontmatter key; `max_turns` not an integer in 1..200; `timeout_seconds` not an integer in 1..3600; `allowed_tools` not a list; empty prompt body; no `graders/*.md`; grader `type` outside `regex|tool_used|tool_order|file_exists|llm|baseline`; `weight` not a positive number; `arm` outside `with-only|both`; an `llm` grader with an empty body; a `regex` grader without `pattern` and `target`; a `tool_used` grader without `tool`; a `file_exists` grader without `path`; a `case.yaml` without `schema_version: "1.1"` or `name:`; a `scaffold_script` file that does not exist.
  - Templates: any file from the list in Task 7 missing.

Frontmatter in graders uses inline flow maps for `target` (`target: { source: file, path: docs/wiki/commands.md }`) because `fm.mjs` rejects nested block maps; `case.yaml` is nested YAML and is checked with regexes only.

- [ ] **Step 1: Write the failing tests**

Replace `plugins/ship-faster/tests/validate.test.mjs` with:

```js
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
```

Note for the `noGraders` case: `fixture` skips entries whose content is `undefined`; add that guard (`if (content === undefined) continue;`) to the `fixture` helper loop.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: the rule tests fail (no errors reported where errors are expected). The real-repository test passes.

- [ ] **Step 3: Extend validate.mjs**

Replace `plugins/ship-faster/tests/validate.mjs` with:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: PASS (7 tests). The real repository still validates because it has no skills, agents, or evals yet and the templates exist.

Run: `node plugins/ship-faster/tests/run.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/tests/validate.mjs plugins/ship-faster/tests/validate.test.mjs
git commit -F <message file>
```

Message:

```
test: validator enforces skill, agent, eval, and template contracts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 9: Agents `repo-analyst` (G1) and `doc-verifier` (G2)

**Files:**
- Create: `plugins/ship-faster/agents/repo-analyst.md`
- Create: `plugins/ship-faster/agents/doc-verifier.md`

**Interfaces:**
- Consumes: nothing from the scripts; both agents are read-only and receive their input in the prompt.
- Produces: the two agent names `ship-faster:repo-analyst` and `ship-faster:doc-verifier` that the skills call through the Agent tool, and the JSON contracts below, which the skills parse from the agent's final message.

- [ ] **Step 1: Write repo-analyst.md**

`plugins/ship-faster/agents/repo-analyst.md`:

````markdown
---
name: repo-analyst
description: Read-only analyst for the onboard skill. Given one area of a repository (stack and commands, layout and entry points, tests, conventions, architecture and data flow, ops and CI, dependencies) plus detect and footprints output, returns evidence-backed facts, suggested covers globs, recipe candidates, and open questions as JSON. Never edits files.
model: haiku
tools: Read, Glob, Grep
maxTurns: 30
---

You analyse one area of a repository for the ship-faster onboard skill. You read files. You never write, and you never run anything.

## Input

The prompt gives you:

- `area`: one of `stack-and-commands`, `layout-and-entry-points`, `tests`, `conventions`, `architecture-and-data-flow`, `ops-and-ci`, `dependencies`, or a top-level directory name for a large repository.
- `brief`: what to find for that area and which wiki page it feeds.
- `detect`: JSON facts about the repository (stacks, scripts, CI files, workspaces, top directories, entry point candidates).
- `footprints`: JSON co-change clusters from git history (files that change together, with commit keywords and sample subjects).

## Method

1. Start from the files `detect` and the brief name. Open manifests, configs, and entry points before anything else.
2. For every fact, find the line that proves it and record `path:line` (1-based). A fact without a line you have read is not a fact; drop it.
3. Prefer facts that change what someone does: which command runs what, where a kind of file goes, what a module owns, which pattern is followed. Do not restate code.
4. Suggest `covers` globs (gitignore style, relative to the repository root) for the page this area feeds: the manifests, directories, and configs whose change would make the page's claims wrong. Every glob must match at least one file you saw.
5. Turn footprint clusters that fit this area into recipe candidates: a task name in the imperative, the ordered files, and the steps a person follows.
6. Anything you could not settle from files becomes an open question, phrased so a maintainer can answer it in one line.

## Limits

- Read at most 40 files. Prefer breadth over depth: headers, exports, configs.
- Stop at 25 facts. Keep the strongest evidence.
- Do not guess versions, ports, or environment variables you have not seen in a file.
- Do not run commands and do not infer that a command works; report it as a candidate with its source line.

## Output

Return only one fenced JSON block, nothing before or after it:

```json
{
  "area": "tests",
  "facts": [
    { "claim": "Unit tests run with node:test from tests/*.test.mjs", "evidence": ["package.json:7", "tests/run.mjs:3"], "confidence": "high" }
  ],
  "suggestedCovers": ["tests/**", "package.json"],
  "recipeCandidates": [
    { "task": "Add a script test", "files": ["tests/<name>.test.mjs", "tests/helpers.mjs"], "steps": ["Create tests/<name>.test.mjs importing makeRepo from helpers.mjs", "Run node --test tests/<name>.test.mjs"] }
  ],
  "openQuestions": ["Is the e2e suite in e2e/ run anywhere? No workflow references it."]
}
```

`confidence` is `high` when the line states it outright, `medium` when it follows from two or more lines, `low` when it is the most likely reading of one line. Keep every string under 200 characters.
````

- [ ] **Step 2: Write doc-verifier.md**

`plugins/ship-faster/agents/doc-verifier.md`:

````markdown
---
name: doc-verifier
description: Read-only verifier for wiki pages written by onboard and sync-docs. Given one page path, checks every path, command, name, number, and behavioural claim against the repository and returns the false and unverifiable claims as JSON with file line numbers and evidence. Never edits files.
model: sonnet
tools: Read, Glob, Grep
maxTurns: 25
---

You verify one wiki page against the repository it describes. You read. You never write and never run commands.

## Input

- `page`: the page path, relative to the repository root.
- `changed` (optional): files that changed since the page was verified. Check the claims that mention them first.

## Method

1. Read the page. `line` in your output is the file line number, counting the frontmatter.
2. For each claim, decide what would make it false and look there:
   - A path in backticks or in a table: the file or directory exists (Glob).
   - A command: the script, binary, target, or config it needs exists (`package.json` scripts, a Makefile target, a CI step, a dotfile). You cannot run it; never mark a command false because you did not run it.
   - A name (function, class, env var, flag, route, table): it appears in code (Grep).
   - A behavioural claim ("X calls Y before Z", "retries three times"): the code says so at a line you can cite.
   - A number (port, timeout, count, version): matches a line in a manifest or config.
3. A claim is `false` when the repository contradicts it at a line you can cite. It is `unverifiable` when nothing in the repository can settle it (an external system, a deployment fact, a historical reason). A claim that holds is not reported.
4. Check the frontmatter too: every `covers` glob must match at least one file; `summary` and `read_when` must describe this page.
5. Read at most 40 files. Prefer Grep to opening large files.

## Output

Return only one fenced JSON block:

```json
{
  "page": "docs/wiki/commands.md",
  "false": [
    { "line": 23, "claim": "`npm run lint` runs eslint", "why": "package.json has no lint script", "evidence": "package.json:6-11" }
  ],
  "unverifiable": [
    { "line": 31, "claim": "Deploys run from GitHub Actions on tag push" }
  ]
}
```

Use empty arrays when nothing is wrong. Keep `claim` to the shortest quote that identifies the sentence.
````

- [ ] **Step 3: Validate**

Run: `node plugins/ship-faster/tests/validate.mjs` and `claude plugin validate --strict plugins/ship-faster`
Expected: both pass.

Run: `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/ship-faster/agents/repo-analyst.md plugins/ship-faster/agents/doc-verifier.md
git commit -F <message file>
```

Message:

```
feat: repo-analyst and doc-verifier agents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 10: Skill `lesson` (S3) with its eval case

**Files:**
- Create: `plugins/ship-faster/skills/lesson/SKILL.md`
- Create: `plugins/ship-faster/evals/lesson/prompt.md`
- Create: `plugins/ship-faster/evals/lesson/case.yaml`
- Create: `plugins/ship-faster/evals/lesson/scaffold.sh`
- Create: `plugins/ship-faster/evals/lesson/graders/skill-fired.md`, `gotchas-created.md`, `entry-shape.md`, `entry-id.md`, `rules-file.md`, `quality.md`

**Interfaces:**
- Consumes: `detect.mjs --brief --json` (Task 4), `page.mjs touch` (Task 5), `index.mjs`, `lint.mjs`, templates `gotcha-entry.md`, `pages/gotchas.md`, `pages/architecture.md`, `rules-file.md` (Task 7).
- Produces: `/ship-faster:lesson`, model-invocable. Writes one entry into `gotchas.md`, `architecture.md`, or `conventions.md`, optionally one line into `<rulesDir>/<area>.md`.

- [ ] **Step 1: Write SKILL.md**

`plugins/ship-faster/skills/lesson/SKILL.md`:

````markdown
---
name: lesson
description: Record a non-obvious cause, decision, or convention in the wiki the moment it is learned, as symptom, cause, rule, and evidence, plus a path-scoped rule when the lesson has a clear file scope.
when_to_use: Use right after fixing a bug whose cause was not visible in the code you edited, after choosing between approaches for a reason a reader could not infer from the code, or after discovering a constraint imposed by something outside the repository (a provider, an upstream interceptor, an environment). Also when the user says "remember this", "add a gotcha", or "write that down".
argument-hint: "[what was learned, in one sentence]"
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(node *), Bash(git *)
---

# Record a lesson

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Lesson given as argument (may be empty): $ARGUMENTS

From the facts: `<wikiDir>` = `config.wikiDir`, `<rulesDir>` = `config.rulesDir`, `<head>` = `git.head`, and `existing.wiki` says whether a wiki exists.

## 1. Draft the entry

Fill the template at `${CLAUDE_PLUGIN_ROOT}/templates/gotcha-entry.md` from the conversation or the argument:

- **Symptom**: what was observed, in the words a future reader would search for (the error message, the wrong value, the flaky behaviour).
- **Cause**: the part that was not visible in the code being edited: the upstream interceptor, the provider limit, the ordering constraint, the environment difference.
- **Rule**: one imperative sentence that prevents it next time.
- **Evidence**: `path:line` of the fix or of the constraint, or `<head>` shortened to 7 characters, and today's date.
- **Id**: `g-<yyyymmdd>-<slug>`, slug = 2 to 4 lowercase words joined by hyphens.

Delete the template's comment. Every line must be specific to this repository. A rule that would be true in any repository is not a lesson; say so and stop.

## 2. Classify

- **Gotcha** (default): a trap, a constraint, a cause that will bite again. Destination `<wikiDir>/gotchas.md`.
- **Decision**: a choice between approaches made for a reason a reader could not infer. Destination: the `## Decisions` section of `<wikiDir>/architecture.md`, in the form shown in `${CLAUDE_PLUGIN_ROOT}/templates/pages/architecture.md` (id `d-<yyyymmdd>-<slug>`; fields Decision, Why, Alternatives, Evidence).
- **Convention**: a pattern to follow or avoid from now on. Destination: `## Follow` or `## Avoid` in `<wikiDir>/conventions.md`, one bullet with an example path.

## 3. Show, then write

Print the entry and its destination, then write it. Do not wait for confirmation unless the user asked to review first.

- Destination page exists: append the entry at the end of the right section with one blank line before it. For every file cited in Evidence, add it to the page's `covers` list when no existing glob matches it (edit the frontmatter list in place, keeping the inline `[...]` form).
- `gotchas.md` missing: create it from `${CLAUDE_PLUGIN_ROOT}/templates/pages/gotchas.md`. `covers` = the files cited in Evidence. `verified` = `<head>`, or `unverified` when `git.isRepo` is false. `updated` = today. Replace every `{{placeholder}}` and delete the comment lines.
- No wiki at all (`existing.wiki` false): still create `<wikiDir>/gotchas.md` as above, run step 6, and say that `/ship-faster:onboard` builds the rest of the wiki.
- `architecture.md` or `conventions.md` missing for a decision or a convention: record it in `gotchas.md` instead and say so.

Then bump the page's `updated` date without touching `verified`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" touch <wikiDir>/<page>.md --json
```

## 4. Path-scoped rule

If the rule applies when editing particular files (Evidence names them, or the rule mentions a directory or a file kind), add one line to `<rulesDir>/<area>.md`. `<area>` is the top-level directory of the evidence path, or a short kebab-case name for the concern when the rule spans directories.

- File exists: append `- <Rule sentence> (<wikiDir>/gotchas.md <id>)`. Add a glob to `paths:` when no existing one matches the evidence file. Keep the file at 25 lines or fewer; when a line would exceed that, split the file by sub-directory into two files with narrower `paths`.
- File missing: create it from `${CLAUDE_PLUGIN_ROOT}/templates/rules-file.md` with `paths:` set to globs matching the evidence files (for example `["src/api/**"]`), the heading `# <Area> rules`, and this one rule line. Delete the template comment.

A rule with no file scope (a process rule, a habit) gets no rules file; it lives in the page only.

## 5. Budget

If `gotchas.md` now exceeds 200 lines, split it: move the entries of the largest area into `<wikiDir>/gotchas-<area>.md` (frontmatter copied, `title: Gotchas: <area>`, `covers` = the union of the moved entries' evidence files, `read_when` naming the area), keep the rest in `gotchas.md`, and update rules-file references that point at moved ids.

## 6. Index and lint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/index.mjs" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

Fix every lint error (a `covers` glob matching no tracked file, a page over budget, a broken link, a credential-looking string) and run lint again until `errors` is empty.

## 7. Report

Three lines: the entry id and page; the rules-file line, or "no path scope"; the lint result.
````

- [ ] **Step 2: Write the eval case**

`plugins/ship-faster/evals/lesson/prompt.md`:

```markdown
---
description: lesson records a gotcha with symptom, cause, rule, evidence, and a path-scoped rule
tags: [lesson, knowledge]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
---
I just fixed a bug in src/client.js. The retry loop re-sent every request on a 401 because TOKEN_TTL is read as seconds in src/client.js but config/env.js writes it in milliseconds, so every token looked expired the moment it was issued. The fix on line 12 of src/client.js divides by 1000. Make sure nobody hits this again.
```

`plugins/ship-faster/evals/lesson/case.yaml`:

```yaml
schema_version: "1.1"
name: lesson
context:
  scaffold_script: scaffold.sh
```

`plugins/ship-faster/evals/lesson/scaffold.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
mkdir -p src config docs/wiki
cat > package.json <<'EOF'
{ "name": "token-client", "version": "1.0.0", "scripts": { "test": "node --test" } }
EOF
cat > config/env.js <<'EOF'
export const env = {
  tokenTtl: Number(process.env.TOKEN_TTL || 900) * 1000,
  apiBase: process.env.API_BASE || 'http://localhost:8080',
};
EOF
cat > src/client.js <<'EOF'
import { env } from '../config/env.js';

let token = null;
let issuedAt = 0;

export async function request(path, init = {}) {
  if (!token || expired()) token = await refresh();
  const res = await fetch(env.apiBase + path, { ...init, headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) { token = await refresh(); return request(path, init); }
  return res;
}

function expired() { return Date.now() - issuedAt > env.tokenTtl / 1000 * 1000; }

async function refresh() {
  issuedAt = Date.now();
  return 'token-' + issuedAt;
}
EOF
cat > docs/wiki/overview.md <<'EOF'
---
title: Overview
summary: A small HTTP client that refreshes a bearer token when it expires.
read_when: You are new to the repository.
covers: ["package.json", "src/**"]
verified: unverified
updated: 2026-01-01
---
# Overview

## What it is
A client library that wraps fetch with bearer-token refresh.

## Users
Internal services.

## Vocabulary
| Term | Meaning | Where it lives |
|---|---|---|
| TTL | seconds a token stays valid | `config/env.js` |

## Boundaries
Talks to the auth API only through `src/client.js`.
EOF
cat > docs/wiki/index.md <<'EOF'
<!-- Generated by ship-faster. Do not edit: run /ship-faster:sync-docs to regenerate. -->
# Wiki index

| Page | Read when | Summary |
|---|---|---|
| [Overview](overview.md) | You are new to the repository. | A small HTTP client that refreshes a bearer token when it expires. |
EOF
git add package.json config/env.js src/client.js docs/wiki/overview.md docs/wiki/index.md
git commit -q -m "feat: token client with refresh"
sha=$(git rev-parse HEAD)
sed -i "s/^verified: unverified$/verified: $sha/" docs/wiki/overview.md
git add docs/wiki/overview.md
git commit -q -m "docs: verify overview"
```

Graders:

`graders/skill-fired.md`:

```markdown
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:ship-faster:)?lesson"'
---
```

`graders/gotchas-created.md`:

```markdown
---
type: file_exists
path: docs/wiki/gotchas.md
---
```

`graders/entry-shape.md`:

```markdown
---
type: regex
pattern: 'Symptom:[\s\S]*Cause:[\s\S]*Rule:[\s\S]*Evidence:'
target: { source: file, path: docs/wiki/gotchas.md }
---
```

`graders/entry-id.md`:

```markdown
---
type: regex
pattern: '<!-- id: g-\d{8}-[a-z0-9-]+ -->'
target: { source: file, path: docs/wiki/gotchas.md }
---
```

`graders/rules-file.md`:

```markdown
---
type: file_exists
path: .claude/rules/*.md
---
```

`graders/quality.md`:

```markdown
---
type: llm
weight: 2
focus: { source: file, path: docs/wiki/gotchas.md }
---
PASS when all of the following hold in the gotchas page:
- The page has frontmatter with title, summary, read_when, a non-empty covers list that includes src/client.js or a glob matching it, verified, and updated.
- There is exactly one gotcha entry, and it names the TOKEN_TTL unit mismatch (seconds read in src/client.js versus milliseconds written by config/env.js) as the cause, not merely "retries on 401" as the cause.
- The Rule line is a single imperative sentence a developer can follow (for example, keep TOKEN_TTL in one unit or convert at one boundary).
- The Evidence line cites src/client.js:12 or config/env.js with a date.
FAIL when the entry is generic, when the cause restates the symptom, when Evidence has no file reference, or when the page has no frontmatter.
```

- [ ] **Step 3: Validate**

Run: `node plugins/ship-faster/tests/validate.mjs` and `claude plugin validate --strict plugins/ship-faster`
Expected: both pass. If validate reports a `ship-faster:<name>` reference error, the SKILL.md mentions an agent or skill that does not exist yet; fix the text.

Run: `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/ship-faster/skills/lesson/SKILL.md plugins/ship-faster/evals/lesson
git commit -F <message file>
```

Message:

```
feat: lesson skill records gotchas, decisions, and conventions with path-scoped rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 11: Skill `sync-docs` (S2) with its eval case

**Files:**
- Create: `plugins/ship-faster/skills/sync-docs/SKILL.md`
- Create: `plugins/ship-faster/evals/sync-docs/prompt.md`, `case.yaml`, `scaffold.sh`
- Create: `plugins/ship-faster/evals/sync-docs/graders/skill-fired.md`, `command-updated.md`, `restamped.md`, `quality.md`

**Interfaces:**
- Consumes: `detect.mjs --brief`, `stale.mjs --session all [--since <ref>]` with `inScope` and `uncovered` (Task 3), `page.mjs verify`, `index.mjs`, `lint.mjs`, the `ship-faster:doc-verifier` agent, `templates/pages/recipe.md`.
- Produces: `/ship-faster:sync-docs [--scope all|diff|session] [--since <ref>]`, model-invocable. `ship` (plan 3) invokes it with `--scope diff`; `release` with `--scope all`.

- [ ] **Step 1: Write SKILL.md**

`plugins/ship-faster/skills/sync-docs/SKILL.md`:

````markdown
---
name: sync-docs
description: Bring stale wiki pages back to true by re-checking their claims against the code that changed, re-verify them at HEAD, and add coverage for new behaviour no page describes.
when_to_use: Use after changing behaviour that a docs/wiki page describes, before claiming a feature done, when session-start or a prompt note reports stale pages, or when the user asks to update, refresh, or verify the docs. Pass --scope diff when only the current branch's changes matter.
argument-hint: "[--scope all|diff|session] [--since <base-branch>]"
allowed-tools: Read, Glob, Grep, Write, Edit, Agent, Bash(node *), Bash(git *)
---

# Sync docs

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Arguments: $ARGUMENTS

`<wikiDir>` = `config.wikiDir`. `<base>` = the `--since` argument, else `git.defaultBranch`. No wiki (`existing.wiki` false): stop and say `/ship-faster:onboard` creates it.

## 1. Classify pages

Scope defaults to `all`.

| Scope | Run | Act on |
|---|---|---|
| `all` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --session all --json` | every page with `inScope: true` |
| `diff` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --session all --since <base> --json` | every page with `inScope: true` |
| `session` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs" --session all --json` | pages with status `dirty` |

If `since.error` is set, say so and use the `all` rule. Nothing to act on and `uncovered` empty: report "all pages fresh" with the counts and stop.

## 2. Re-verify each page in scope

Order: `invalid`, `unverifiable`, `stale`, `dirty`. For each page:

1. Read the page. Read the files in its `changed` list (up to 50). For an `unverifiable` page treat every claim as suspect and read the files its `covers` globs name.
2. Go claim by claim: paths, commands, names, numbers, behaviour. A claim that still holds stays. A claim that changed is rewritten to what the code does now. A claim about something that no longer exists is deleted.
3. `invalid` page: repair the frontmatter first. Required fields are `title`, `summary`, `read_when`, `covers`, `verified`, `updated`; `covers` is a non-empty inline list of globs that match tracked files.
4. Keep the page under 200 lines. Cut restated code before cutting rules or steps.
5. Record whether you edited the page or only confirmed it.

## 3. Cover new behaviour

`uncovered` lists changed files no page covers. Skip lockfiles, generated output, fixtures, and pure test data. For each remaining file decide:

- It belongs to an existing page's topic: add the claim to that page and extend its `covers` with a glob matching the file.
- It is a repeatable task shape (a new kind of handler, a migration, a provider adapter): create `<wikiDir>/recipes/<task>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/pages/recipe.md` with the ordered steps, the files, the test, and the docs page to update; `covers` = the files the recipe touches.
- Otherwise leave it and say so in the report.

Never create a page whose body is under 15 lines.

## 4. Verify the edits

For every page you edited or created, launch the `ship-faster:doc-verifier` agent once, all in one message so they run in parallel. Prompt: `page: <path>` and `changed: <the files you read>`. Fix every `false` claim it returns (rewrite or delete). For each `unverifiable` claim, delete it or move it under a final line `Unverified: ...` at the bottom of the page.

## 5. Stamp, index, lint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" verify <every page you edited, created, or confirmed> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/index.mjs" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

`page verify` sets `verified` to HEAD and `updated` to today. Fix every lint error and re-run lint until `errors` is empty.

## 6. Report

One table: page, status before, action (`confirmed`, `updated`, `created`, `frontmatter repaired`, or `left stale: <reason>`), then one line naming uncovered files you left alone. Never call a page true unless you read the changed files behind it.
````

- [ ] **Step 2: Write the eval case**

`plugins/ship-faster/evals/sync-docs/prompt.md`:

```markdown
---
description: sync-docs re-verifies a stale commands page after the test command changed
tags: [sync-docs, knowledge]
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
---
I moved the tests into tests/ and changed the npm test script to `node --test tests/`; that commit is already on this branch. Before I ship, make sure the wiki still tells the truth about the commands.
```

`plugins/ship-faster/evals/sync-docs/case.yaml`:

```yaml
schema_version: "1.1"
name: sync-docs
context:
  scaffold_script: scaffold.sh
```

`plugins/ship-faster/evals/sync-docs/scaffold.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
mkdir -p src docs/wiki
cat > package.json <<'EOF'
{ "name": "adder", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
EOF
cat > src/add.js <<'EOF'
export function add(a, b) { return a + b; }
EOF
cat > add.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './src/add.js';
test('adds', () => { assert.equal(add(1, 2), 3); });
EOF
cat > docs/wiki/commands.md <<'EOF'
---
title: Commands
summary: Verified test command.
read_when: You need to run the tests.
covers: ["package.json"]
verified: unverified
updated: 2026-01-01
checks:
  - name: test
    run: npm test
    timeout: 120
---
# Commands

## Setup
| Step | Command | Notes |
|---|---|---|
| Install | `npm install` | no dependencies today |

## Everyday
| Purpose | Command | Duration | Status |
|---|---|---|---|
| Run the tests | `node --test` | 1s | pass |

## Checks
1. `node --test` — runs every *.test.js file in the repository root, about 1s

## Known slow or flaky
- none
EOF
cat > docs/wiki/overview.md <<'EOF'
---
title: Overview
summary: A one-function library.
read_when: You are new to the repository.
covers: ["src/**"]
verified: unverified
updated: 2026-01-01
---
# Overview

## What it is
Exports add(a, b).

## Users
Nobody yet.

## Vocabulary
| Term | Meaning | Where it lives |
|---|---|---|
| add | sums two numbers | `src/add.js` |

## Boundaries
No external calls.
EOF
cat > docs/wiki/index.md <<'EOF'
<!-- Generated by ship-faster. Do not edit: run /ship-faster:sync-docs to regenerate. -->
# Wiki index

| Page | Read when | Summary |
|---|---|---|
| [Commands](commands.md) | You need to run the tests. | Verified test command. |
| [Overview](overview.md) | You are new to the repository. | A one-function library. |
EOF
git add package.json src/add.js add.test.js docs/wiki
git commit -q -m "feat: adder with docs"
sha=$(git rev-parse HEAD)
sed -i "s/^verified: unverified$/verified: $sha/" docs/wiki/commands.md docs/wiki/overview.md
git add docs/wiki/commands.md docs/wiki/overview.md
git commit -q -m "docs: verify pages"
mkdir -p tests
git mv add.test.js tests/add.test.js
sed -i "s#'./src/add.js'#'../src/add.js'#" tests/add.test.js
sed -i 's#"test": "node --test"#"test": "node --test tests/"#' package.json
git add package.json tests/add.test.js
git commit -q -m "test: move tests into tests/"
```

Graders:

`graders/skill-fired.md`:

```markdown
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:ship-faster:)?sync-docs"'
---
```

`graders/command-updated.md`:

```markdown
---
type: regex
pattern: 'node --test tests/'
target: { source: file, path: docs/wiki/commands.md }
---
```

`graders/restamped.md`:

```markdown
---
type: tool_used
tool: Bash
input_match: 'page\.mjs.*verify'
---
```

`graders/quality.md`:

```markdown
---
type: llm
weight: 2
focus: { source: file, path: docs/wiki/commands.md }
---
PASS when the commands page now says the tests run from the tests/ directory (the command is `node --test tests/` or `npm test` described as running tests/), no line still claims that test files live in the repository root, the frontmatter `verified` value is a 40-character hexadecimal commit sha, and the checks list still contains a test check with a non-empty run command.
FAIL when the page still describes `node --test` over root-level *.test.js files, when frontmatter is missing or malformed, or when the page was deleted instead of updated.
```

- [ ] **Step 3: Validate**

Run: `node plugins/ship-faster/tests/validate.mjs`, `claude plugin validate --strict plugins/ship-faster`, `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/ship-faster/skills/sync-docs/SKILL.md plugins/ship-faster/evals/sync-docs
git commit -F <message file>
```

Message:

```
feat: sync-docs skill re-verifies stale pages and covers new behaviour

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 12: Skill `onboard` (S1) with reference files and its eval case

**Files:**
- Create: `plugins/ship-faster/skills/onboard/SKILL.md`
- Create: `plugins/ship-faster/skills/onboard/reference/areas.md`
- Create: `plugins/ship-faster/skills/onboard/reference/pages.md`
- Create: `plugins/ship-faster/skills/onboard/reference/report.md`
- Create: `plugins/ship-faster/evals/onboard/prompt.md`, `case.yaml`, `scaffold.sh`
- Create: `plugins/ship-faster/evals/onboard/graders/claude-md-created.md`, `claude-md-shape.md`, `index-created.md`, `commands-page.md`, `commands-verified.md`, `checks-ran.md`, `quality.md`

**Interfaces:**
- Consumes: `detect.mjs --json` (full), `footprints.mjs`, `checks.mjs resolve|run --continue`, `claude-md.mjs backup|sections|splice`, `page.mjs verify`, `index.mjs`, `lint.mjs`, both agents, every template.
- Produces: `/ship-faster:onboard [--force]`, slash-only. Writes CLAUDE.md, `<wikiDir>/**`, `<rulesDir>/*.md`, and per-package CLAUDE.md files in monorepos.

- [ ] **Step 1: Write SKILL.md**

`plugins/ship-faster/skills/onboard/SKILL.md`:

````markdown
---
name: onboard
description: Generate a router CLAUDE.md, a verified wiki under docs/wiki, and path-scoped rules for the current repository by analysing it, running its commands, and verifying every page against the code.
disable-model-invocation: true
argument-hint: "[--force]"
allowed-tools: Read, Glob, Grep, Write, Edit, Agent, Bash(node *), Bash(git *)
---

# Onboard this repository

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --json || true`

Arguments: $ARGUMENTS

Shorthands: `<wikiDir>` = `config.wikiDir`, `<rulesDir>` = `config.rulesDir`, `<head>` = `git.head`, `<dataDir>` = `dataDir`, all from the facts above. Templates live under `${CLAUDE_PLUGIN_ROOT}/templates/`. Read `${CLAUDE_SKILL_DIR}/reference/pages.md` before step 6 and `${CLAUDE_SKILL_DIR}/reference/report.md` before step 12. Work through the steps in order; do not skip the verification steps to save time.

## 1. Preconditions

- `existing.wiki` is true and the arguments do not contain `--force`: stop. Say the wiki exists, that `/ship-faster:sync-docs` refreshes it, and that `--force` regenerates everything.
- `git.isRepo` is false: continue with reduced features: skip step 3, write `verified: unverified` on every page, and omit durations.
- `git.trackedFiles` under 20 and `existing.readme` false: ask the user for one paragraph describing the project. When you cannot ask (a non-interactive run), derive the paragraph from the manifests and say so in the report. Then follow the small-repository rule in reference/pages.md.

## 2. Existing CLAUDE.md

When `existing.claudeMd` is true:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" backup --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" sections --json
```

Classify every section that is not inside the managed block:

| Kind | Test | Destination |
|---|---|---|
| rule | imperative constraints (never, always, must, do not) | kept verbatim under `## Rules` |
| commands | commands, with or without descriptions | candidates for step 5; the section is removed once they are in `commands.md` |
| depth | explanations of architecture, layout, testing, history | moved into the matching page in step 6; the section is removed |
| stale | anything step 7 shows to be false | dropped and listed in the report |

Keep the classification for step 10 and the report. Do not edit CLAUDE.md yet.

## 3. Footprints

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/footprints.mjs" --json
```

Keep `clusters` and `hotspots`. A cluster with a clear task shape (its keywords and sample subjects describe one kind of change) becomes a recipe in step 6.

## 4. Analysis fan-out

Read `${CLAUDE_SKILL_DIR}/reference/areas.md`. Launch one `ship-faster:repo-analyst` agent per area, all in a single message so they run in parallel. Each prompt contains `area: <name>`, `brief: <the row's brief>`, `detect:` followed by the full detect JSON, and `footprints:` followed by the footprints JSON. When `git.sizeClass` is `large`, also launch one analyst per entry of `topDirs` with more than 50 files, brief "architecture and data flow of <dir> only".

Parse the JSON block each analyst returns. Drop any fact whose evidence path does not exist (check with Glob). Keep the `openQuestions` for the report.

## 5. Verify commands

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" resolve --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks.mjs" run --continue --json
```

Every resolved check is executed; keep `status`, `durationMs`, and `log` per check. Commands the analysts found that are not checks (dev server, watch, migrate, generate) are listed with status `not run`. Deploy, publish, and release commands are never run and are listed with status `not run`. Only a command with status `pass` may appear as verified in `commands.md` or in CLAUDE.md. A failing check is still listed, with status `fail` and its log path, so a reader knows it exists.

The `checks:` frontmatter of `commands.md` lists the passing checks in run order; `timeout` is twice the measured duration in seconds, minimum 60.

## 6. Draft pages

Follow `${CLAUDE_SKILL_DIR}/reference/pages.md`. For each page that has content, copy `${CLAUDE_PLUGIN_ROOT}/templates/pages/<page>.md`, replace every `{{placeholder}}`, delete the template comments, and write it to `<wikiDir>/<page>.md`. Set `verified: unverified` and `updated` to today; step 9 stamps the real sha. `covers` comes from the analysts' `suggestedCovers`, trimmed to globs that match tracked files.

Write one recipe per footprint cluster or analyst recipe candidate with a clear task shape to `<wikiDir>/recipes/<task>.md`, at most eight.

Monorepo (`workspaces` has two or more entries and `git.sizeClass` is not `small`): one `<wikiDir>/packages/<name>.md` per workspace from `templates/pages/package.md`, and in step 10 a per-package `CLAUDE.md` in each workspace directory from `templates/package-claude-md.md`, 30 lines maximum.

## 7. Verify pages

Launch one `ship-faster:doc-verifier` agent per page you wrote, all in one message. Prompt: `page: <path>`. For every `false` claim: fix it or delete it. For every `unverifiable` claim: delete it, or keep it under a final line `Unverified: <claim>` when a reader needs the pointer. One pass only.

Sections of an existing CLAUDE.md whose claims the verifier marks false are classified `stale` and dropped in step 10.

## 8. Rules files

For each area with at least one path-scoped rule (a `gotchas.md` entry or a `conventions.md` rule whose evidence names files under one directory), write `<rulesDir>/<area>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/rules-file.md`: `paths:` globs matching those files, one imperative line per rule pointing at the gotcha id or the page, 25 lines maximum. Never write a rules file without `paths`.

## 9. Stamp and index

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" verify <every page written> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/index.mjs" --json
```

## 10. CLAUDE.md

Build the managed block from `${CLAUDE_PLUGIN_ROOT}/templates/claude-md.md`: the text between the two marker comments, placeholders replaced, comments deleted, within the budgets in reference/pages.md. Write it to `<dataDir>/claude-md-block.md`; if that directory is unwritable, write it to `<wikiDir>/.claude-md-block.tmp` and delete the file after the splice. Then:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-md.mjs" splice --block <that file> --name "<project name>" --dry-run --json
```

If a CLAUDE.md existed, show the old and the new file as a diff in your response. Then run the same command without `--dry-run`. Afterwards, with an existing file: remove the sections classified `commands`, `depth`, or `stale` in step 2 and keep the `rule` sections under `## Rules` verbatim. With a new file: put the rules found in an old `## Rules` section, plus at most five rules drawn from `gotchas.md`, under `## Rules` as imperative sentences.

Monorepos: write the per-package CLAUDE.md files now.

## 11. Lint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

Fix every error (a page over 200 lines, CLAUDE.md over 150, a `covers` glob matching no file, a link to a missing file, a credential-looking string, a rules file over 25 lines, an out-of-date index) and run lint again until `errors` is empty. Warnings go in the report.

## 12. Report

Follow `${CLAUDE_SKILL_DIR}/reference/report.md`.
````

- [ ] **Step 2: Write the reference files**

`plugins/ship-faster/skills/onboard/reference/areas.md`:

```markdown
# Analyst areas

Launch one `ship-faster:repo-analyst` per row. Each prompt is `area: <name>`, `brief: <text>`, `detect: <json>`, `footprints: <json>`.

| Area | Brief | Feeds |
|---|---|---|
| stack-and-commands | Languages and versions, frameworks, package manager, every script or task-runner target with what it does, env vars by name, ports, tool versions pinned in files (.nvmrc, global.json, .tool-versions). Say which commands are long-running (servers, watchers). | overview (Stack), commands |
| layout-and-entry-points | What each top-level directory owns, the process entry points and what starts them, where a new file of each kind goes and how it is named, generated outputs that must not be edited. | layout, CLAUDE.md Layout |
| tests | Test frameworks, where each kind of test lives, how one test is run alone, fixtures and factories, mocks and fakes, coverage config, tests that need services or credentials. | testing |
| conventions | Naming (files, exports, types, tests), module boundaries, error handling, logging, lint and format config and what it enforces, patterns repeated across the codebase, patterns explicitly avoided (comments, lint rules, ADRs). | conventions, rules files |
| architecture-and-data-flow | Components and what each owns, how a request or job moves through them, persistence and external systems, boundaries (what may call what), decisions recorded in ADRs, comments, or commit messages with their reasons. | architecture, overview (Boundaries) |
| ops-and-ci | CI workflows and what each job gates, environments, how deploys happen (never run them), release and versioning process, tag format, secret names (never values), monitoring. | ops, commands (Checks) |
| dependencies | Key runtime and dev dependencies with why each is there, pinned versions with a visible reason, lockfile, upgrade tooling, private registries. | dependencies |

Large repositories (`git.sizeClass` `large`): one extra `architecture-and-data-flow` analyst per top-level directory with more than 50 files, brief "architecture and data flow of <dir> only".

When two analysts disagree, keep the fact with the higher confidence and the more specific evidence, and put the other in the report's open questions.
```

`plugins/ship-faster/skills/onboard/reference/pages.md`:

```markdown
# Drafting pages

## Budgets
- Page: 200 lines. Recipe: 60 lines. Index: generated, never edited by hand.
- CLAUDE.md: 150 lines; managed block 90 lines; What this is 3 lines; Stack 6 bullets; Layout 12 rows; Commands 12 rows; Read next one row per page and recipe.
- Rules file: 25 lines. Per-package CLAUDE.md: 30 lines.

## What goes where
| Page | Write it when | Source |
|---|---|---|
| overview | always | stack and architecture analysts, README |
| architecture | two or more components exist | architecture analyst |
| layout | always | layout analyst, `topDirs` |
| commands | always | step 5 results, stack analyst |
| conventions | any convention with an example path | conventions analyst |
| testing | a test framework or test directory exists | tests analyst |
| gotchas | at least one entry with symptom, cause, rule, and evidence in the analysts' facts or the old CLAUDE.md | any analyst |
| dependencies | a manifest declares dependencies | dependencies analyst |
| ops | CI, deploy, or release facts exist | ops analyst |
| recipes/<task> | a footprint cluster or recipe candidate with a clear task shape | footprints, analysts |
| packages/<name> | monorepo rule in SKILL.md step 6 | `workspaces` |

A page with no verified content is not written. Never pad a page to justify it.

## Frontmatter
- `title`: the template's title; the task name for a recipe; the package name for a package page.
- `summary`: one sentence under 120 characters, specific to this repository.
- `read_when`: one sentence starting with "You".
- `covers`: gitignore-style globs relative to the root, inline list, each matching at least one tracked file. Prefer the manifests, configs, and directories whose change would falsify the page. Never `**` alone.
- `verified`: `unverified` while drafting; step 9 stamps HEAD.
- `updated`: today, `yyyy-mm-dd`.
- `commands.md` also carries `checks:` (name, run, timeout) for every passing check, in run order.

## Content rules
- Recipes beat prose. Every step names a file.
- A command appears only if it passed in step 5, with its measured duration. A failing check appears with status `fail` and its log path. Long-running, deploy, publish, and release commands appear with status `not run`.
- Paths, names, and numbers come from analyst evidence. No claim without a file behind it.
- Tables over paragraphs. No file trees. No restated code.
- Over budget: cut restated code first, then prose; never rules or steps. Split a recipe rather than shortening its steps.
- Secrets: names only, never values. A line that looks like a credential fails lint.

## Small repository (fewer than 20 tracked files)
Write CLAUDE.md, overview, architecture (from the manifests and the user's paragraph), commands, conventions, and the index. Recipes arrive later through sync-docs.

## CLAUDE.md managed block
Six sections in this order, from `templates/claude-md.md`: What this is; Stack; Layout; Commands (verified <date> at <short sha>); Read next; Keeping docs true. The Read next table has one row per page and recipe, phrased "When you need to…", pointing at a path. Never `@import` a page. Text outside the markers is preserved by the splice; `## Rules` holds imperative sentences only.
```

`plugins/ship-faster/skills/onboard/reference/report.md`:

```markdown
# Onboard report

Print, in this order, under 60 lines, no prose between sections:

1. **Pages written**: table of page, lines, covers count, verifier findings fixed (false / unverifiable).
2. **Commands**: table of check, status (`pass`, `fail`, `timeout`, `not run`), duration, source (`wiki`, `ci`, `detect`), log path for failures.
3. **CLAUDE.md**: created or updated; total lines; managed block lines; sections migrated from the old file (heading → destination page); sections dropped as stale (heading → the verifier finding); rules kept.
4. **Rules files**: path and rule count per file.
5. **Recipes**: name and the footprint cluster or candidate it came from.
6. **Open questions**: merged from the analysts, deduplicated, at most ten.
7. **Suggested first lesson**: when an analyst surfaced a constraint (an ordering rule, an environment difference, a provider limit) that landed on no page, one line: "Run `/ship-faster:lesson` with: <the constraint>". Otherwise "none".
8. **Lint**: `0 errors, N warnings`, warnings listed.
```

- [ ] **Step 3: Write the eval case**

`plugins/ship-faster/evals/onboard/prompt.md`:

```markdown
---
description: onboard generates CLAUDE.md, a verified wiki, and rules for a small Node repository
tags: [onboard, knowledge]
max_turns: 150
timeout_seconds: 3000
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
---
/ship-faster:onboard
```

`plugins/ship-faster/evals/onboard/case.yaml`:

```yaml
schema_version: "1.1"
name: onboard
context:
  scaffold_script: scaffold.sh
```

`plugins/ship-faster/evals/onboard/scaffold.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
mkdir -p src/routes src/lib tests scripts .github/workflows
cat > package.json <<'EOF'
{
  "name": "tiny-api",
  "version": "0.3.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test tests/",
    "lint": "node scripts/lint.js"
  }
}
EOF
cat > README.md <<'EOF'
# tiny-api

An in-memory users API used as a fixture. `npm start` serves it on port 3000; `npm test` runs the node:test suite.
EOF
cat > .gitignore <<'EOF'
node_modules/
EOF
cat > src/lib/db.js <<'EOF'
const rows = new Map();
let nextId = 1;
export function list() { return [...rows.values()]; }
export function get(id) { return rows.get(Number(id)) || null; }
export function create(user) { const row = { id: nextId++, ...user }; rows.set(row.id, row); return row; }
EOF
cat > src/routes/users.js <<'EOF'
import * as db from '../lib/db.js';

export function handleUsers(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/users') return json(res, 200, db.list());
  const m = /^\/users\/(\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && m) {
    const row = db.get(m[1]);
    return row ? json(res, 200, row) : json(res, 404, { error: 'not found' });
  }
  if (req.method === 'POST' && url.pathname === '/users') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => json(res, 201, db.create(JSON.parse(body || '{}'))));
    return;
  }
  json(res, 404, { error: 'no route' });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
EOF
cat > src/index.js <<'EOF'
import { createServer } from 'node:http';
import { handleUsers } from './routes/users.js';

const port = Number(process.env.PORT || 3000);
export const server = createServer((req, res) => handleUsers(req, res, new URL(req.url, 'http://localhost')));
if (process.argv[1] && process.argv[1].endsWith('index.js')) server.listen(port, () => console.error(`listening on ${port}`));
EOF
cat > tests/users.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/lib/db.js';

test('create then get', () => {
  const row = db.create({ name: 'Ada' });
  assert.equal(db.get(row.id).name, 'Ada');
  assert.equal(db.get(999), null);
});
EOF
cat > scripts/lint.js <<'EOF'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
let bad = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && /console\.log\(/.test(readFileSync(p, 'utf8'))) { console.error(`console.log in ${p}`); bad++; }
  }
}
walk('src');
process.exit(bad ? 1 : 0);
EOF
cat > .github/workflows/ci.yml <<'EOF'
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npm run lint
EOF
git add package.json README.md .gitignore src/index.js src/lib/db.js
git commit -q -m "feat: http server skeleton"
git add src/routes/users.js tests/users.test.js
git commit -q -m "feat(users): list and get endpoints"
printf '\n// 404 for unknown ids\n' >> src/routes/users.js
printf '\n// covers missing ids\n' >> tests/users.test.js
git add src/routes/users.js tests/users.test.js
git commit -q -m "fix(users): return 404 for a missing id"
printf '\n// create endpoint\n' >> src/routes/users.js
printf '\n// covers create\n' >> tests/users.test.js
printf '\n// nextId starts at 1\n' >> src/lib/db.js
git add src/routes/users.js tests/users.test.js src/lib/db.js
git commit -q -m "feat(users): create endpoint"
git add scripts/lint.js .github/workflows/ci.yml
git commit -q -m "chore: lint script and ci"
printf '\n// validate name\n' >> src/routes/users.js
printf '\n// covers validation\n' >> tests/users.test.js
git add src/routes/users.js tests/users.test.js
git commit -q -m "feat(users): reject an empty name"
```

Graders:

`graders/claude-md-created.md`:

```markdown
---
type: file_exists
path: CLAUDE.md
---
```

`graders/claude-md-shape.md`:

```markdown
---
type: regex
pattern: 'ship-faster:managed:start[\s\S]*## Read next[\s\S]*ship-faster:managed:end[\s\S]*## Rules'
target: { source: file, path: CLAUDE.md }
---
```

`graders/index-created.md`:

```markdown
---
type: file_exists
path: docs/wiki/index.md
---
```

`graders/commands-page.md`:

```markdown
---
type: regex
pattern: '^checks:\s*$'
flags: m
target: { source: file, path: docs/wiki/commands.md }
---
```

`graders/commands-verified.md`:

```markdown
---
type: regex
pattern: '^verified: [0-9a-f]{40}\s*$'
flags: m
target: { source: file, path: docs/wiki/commands.md }
---
```

`graders/checks-ran.md`:

```markdown
---
type: tool_used
tool: Bash
input_match: 'checks\.mjs.*\brun\b'
---
```

`graders/quality.md`:

```markdown
---
type: llm
weight: 3
focus: { source: file, path: CLAUDE.md }
---
PASS when all of the following hold for CLAUDE.md:
- It is under 150 lines and has a managed block between the ship-faster marker comments with these sections in order: What this is, Stack, Layout, Commands, Read next, Keeping docs true.
- The Commands table lists `npm test` and `npm run lint` with a duration, and does not list `npm start` as a verified command (it is a server; it may appear as "not run").
- The Layout section names `src/routes`, `src/lib`, and `tests` with what each owns, without a file tree.
- The Read next table points at paths under docs/wiki/ and includes at least one recipe for the users endpoints.
- No wiki page is imported with an @ prefix.
FAIL when any section is missing, when a command that was not run is presented as verified, or when the file exceeds 150 lines.
```

- [ ] **Step 4: Validate**

Run: `node plugins/ship-faster/tests/validate.mjs`, `claude plugin validate --strict plugins/ship-faster`, `node --test plugins/ship-faster/tests/validate.test.mjs`
Expected: all pass. `wc -l plugins/ship-faster/skills/onboard/SKILL.md` under 500.

- [ ] **Step 5: Commit**

```bash
git add plugins/ship-faster/skills/onboard plugins/ship-faster/evals/onboard
git commit -F <message file>
```

Message:

```
feat: onboard skill generates CLAUDE.md, the wiki, and rules with analyst and verifier fan-out

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 13: Eval format check, README, CHANGELOG

**Files:**
- Modify: `plugins/ship-faster/README.md`
- Modify: `plugins/ship-faster/CHANGELOG.md`
- Modify: `README.md` (repository root)

**Interfaces:**
- Consumes: the three eval cases, `claude plugin eval`.
- Produces: documentation only. The evals workflow (`.github/workflows/evals.yml`) arrives in plan 3.

- [ ] **Step 1: Check that the eval suite loads**

Native Windows has no sandbox backend, so a run that grants `Bash` is refused per case without spending model credit on the agent, while case loading and grader parsing still happen. Run from the repository root:

```bash
claude plugin eval plugins/ship-faster --ablation none --runs 1 --allow-tools Bash --no-publish --trust-plugin --max-cost-usd 2 --json <scratchpad>/eval-format.json
```

Expected: the command lists the three cases (`lesson`, `onboard`, `sync-docs`) and either refuses the runs for lack of a sandbox (each with a run error and score 0, exit 1) or runs them briefly against an empty workspace (no `--scaffold`). What matters is that no case reports a load or schema error: look for `unknown`, `invalid`, or `schema` in the output and in `<scratchpad>/eval-format.json`. Fix any case file it rejects and re-run. If the CLI runs the cases for real, that is bounded by `--max-cost-usd 2`; stop after the first case with `Ctrl+C` equivalent (TaskStop) once loading is confirmed.

On a Linux machine with `bubblewrap` and `socat`, the real run is:

```bash
claude plugin eval plugins/ship-faster --ablation none --runs 1 --scaffold --allow-tools Bash Write Edit --no-publish --trust-plugin --max-cost-usd 20
```

- [ ] **Step 2: Rewrite the plugin README**

Replace `plugins/ship-faster/README.md` with:

````markdown
# ship-faster

Router CLAUDE.md, verified wiki, and a repo-aware shipping workflow for Claude Code.

This release ships the knowledge layer on top of the foundation: `onboard`, `sync-docs`, and `lesson`, the `repo-analyst` and `doc-verifier` agents, and the hooks and scripts they run on. The shipping skills (`kickoff`, `preflight`, `ship`, `release`, `health`, `review`) land in the next release. The design is in `docs/superpowers/specs/2026-09-16-ship-faster-plugin-design.md` at the repository root.

## Install

```
/plugin marketplace add carloluisito/ship-faster-plugin
/plugin install ship-faster@ship-faster
```

Requires `node` (20 or newer) and `git` on your PATH. Restart Claude Code after installing: hooks register when a session starts.

## Skills

| Skill | Invoke | What it does |
|---|---|---|
| `onboard` | `/ship-faster:onboard [--force]` | Analyses the repository with parallel read-only agents, runs its checks, writes a wiki under `docs/wiki/` (one topic per page, each with `covers` globs and a `verified` commit), verifies every page against the code, writes path-scoped rules under `.claude/rules/`, and generates or updates the managed block of `CLAUDE.md`. Hand-written text outside the markers is preserved; an existing CLAUDE.md is backed up first. Slash-only. |
| `sync-docs` | `/ship-faster:sync-docs [--scope all\|diff\|session] [--since <branch>]` | Re-checks every claim of each stale, dirty, invalid, or unverifiable page against the files that changed, fixes or deletes what no longer holds, adds coverage for changed files no page covers, verifies the edits with the doc-verifier agent, and re-stamps `verified` at HEAD. Claude may invoke it on its own after changing behaviour a page describes. |
| `lesson` | `/ship-faster:lesson [sentence]` | Records a non-obvious cause, decision, or convention right after it is learned: symptom, cause, rule, evidence into `gotchas.md` (or the Decisions section of `architecture.md`, or `conventions.md`), plus one line in `.claude/rules/<area>.md` when the rule has a file scope. Claude may invoke it on its own after fixing a bug whose cause was not visible in the code it edited. |

Every skill runs the plugin's scripts for the deterministic parts (classification, stamping, indexing, lint) and asks the model only for judgement. A page is never called true unless the changed files behind it were read.

## Agents

| Agent | Model | Tools | Role |
|---|---|---|---|
| `repo-analyst` | haiku | Read, Glob, Grep | One per area during onboard; returns evidence-backed facts, `covers` suggestions, recipe candidates, and open questions as JSON. |
| `doc-verifier` | sonnet | Read, Glob, Grep | One per written page; returns the false and unverifiable claims with line numbers. |

Neither agent can write or run commands.

## What gets generated in your repository

- `CLAUDE.md`: under 150 lines, a managed block of at most 90 lines between `<!-- ship-faster:managed:start -->` and `<!-- ship-faster:managed:end -->`, and a hand-written `## Rules` section that regeneration never touches.
- `docs/wiki/`: `index.md` (generated), `overview.md`, `architecture.md`, `layout.md`, `commands.md` (with the `checks` list preflight runs), `conventions.md`, `testing.md`, `gotchas.md`, `dependencies.md`, `ops.md`, `recipes/<task>.md`, and `packages/<name>.md` in monorepos. Each page is under 200 lines and carries `title`, `summary`, `read_when`, `covers`, `verified`, and `updated`.
- `.claude/rules/<area>.md`: at most 25 lines each, with a `paths:` list so Claude Code loads them only when a matching file is read.

A page is stale when a covered file changed in a commit that did not also touch the page; a page committed together with the change it describes stays fresh.

## Hooks

| Event | Script | What it does | Cost |
|---|---|---|---|
| SessionStart | `hook-session-start.mjs` | Prints where the wiki is, how many pages are stale, the active plan for the branch, and whether the health audit is overdue. Suggests `/ship-faster:onboard` in a repo with 20+ files and no CLAUDE.md. | one `git log` per distinct verified commit, or one pass over the history from three; under 1.5 s on 30 pages |
| PreToolUse (Bash) | `hook-ship-guard.mjs` | Denies force pushes and direct pushes to protected branches, `--no-verify`, and `git add -A` when it would stage secrets, build output, or files over 5 MB. | no git call unless the command contains a `git push`, `git add`, `git commit`, or `git merge`; the repository root is resolved once per working directory and cached for a day |
| PostToolUse (Edit, Write, MultiEdit, NotebookEdit) | `hook-drift-marker.mjs` | Records which wiki pages cover the file you edited. Prints nothing. | no git call after the first per working directory |
| UserPromptSubmit | `hook-prompt-report.mjs` | Once per page per session, tells Claude which pages the session's edits touched and are not yet re-verified. | one small file read |
| SessionEnd | `hook-session-end.mjs` | Deletes the session record and prunes records older than 7 days. | one directory prune |

Every hook exits 0 on every error path and prints nothing when it has nothing to say. A deny from the guard names the alternative and the config key that overrides it.

Projected token cost: see the sentence added in Task 14.

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

Guard values are `deny`, `ask`, or `allow`. Defaults never use `ask`: a hook `deny` is documented to hold under bypass-permissions mode, while `ask` there is not documented.

## What is stored, and where

Under the plugin data directory Claude Code provides (`~/.claude/plugins/data/ship-faster/`, or the same path under `CLAUDE_CONFIG_DIR`):

```
projects/<hash16>/project.json        { root, createdAt }
projects/<hash16>/sessions/<id>.json  pages touched this session
projects/<hash16>/wiki-cache.json     page covers and verified commits, keyed by mtime
projects/<hash16>/preflight/          check logs, last 10 runs
projects/<hash16>/backup/             copy of CLAUDE.md taken before onboard rewrites it
projects/<hash16>/health.json         last health run
cwd-cache/<hash16>.json               working directory → repository root
```

Everything here is metadata except `preflight/*.log`, which holds the output of the check commands your repository defines, pruned to the ten most recent runs, and `backup/`, which holds your pre-onboard CLAUDE.md. Nothing leaves your machine. `/plugin uninstall ship-faster` deletes this directory; pass `--keep-data` to keep it.

## Scripts

Every script under `scripts/` runs standalone with `--json`:

```
node scripts/detect.mjs        stacks, CI files, scripts, workspaces, suggested checks, resolved config, data dir (--brief for orientation only)
node scripts/footprints.mjs    files that change together, from git history
node scripts/stale.mjs         which wiki pages are stale, dirty, or unverifiable (--since <ref> marks pages in a branch's scope, --session all merges every session record)
node scripts/index.mjs         regenerate docs/wiki/index.md (--check to only compare)
node scripts/lint.mjs          budgets, links, covers, checks shape, secrets
node scripts/checks.mjs        resolve | run the repository's checks
node scripts/plan.mjs          find --branch | stale | set-status
node scripts/page.mjs          verify <page>... | touch <page>...: stamp verified (HEAD) and updated (today)
node scripts/claude-md.mjs     sections | splice --block <file> | backup: read, regenerate, and back up CLAUDE.md's managed block
```

## Evals

`evals/<skill>/` holds one case per skill: a prompt, a `case.yaml` naming a scaffold script that builds a fixture repository, and graders (deterministic checks plus one rubric a judge model scores). Runs spend real model credit and need a sandbox backend for `Bash`, so they run in CI on Linux, never as a PR gate:

```
claude plugin eval plugins/ship-faster --ablation none --runs 1 --scaffold --allow-tools Bash Write Edit --no-publish --trust-plugin --max-cost-usd 20
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
````

- [ ] **Step 3: Update the CHANGELOG**

Under `## [Unreleased]` → `### Added` in `plugins/ship-faster/CHANGELOG.md`, append:

```markdown
- `onboard` skill: analyses the repository with parallel `repo-analyst` agents, runs its checks, writes the wiki, verifies every page with `doc-verifier`, writes path-scoped rules, and generates or updates the managed block of CLAUDE.md (existing file backed up first).
- `sync-docs` skill: re-verifies stale, dirty, invalid, and unverifiable pages against the changed files, covers changed files no page describes, and re-stamps `verified` at HEAD; `--scope diff --since <branch>` limits it to a branch's changes.
- `lesson` skill: records a gotcha, decision, or convention with symptom, cause, rule, and evidence, plus a path-scoped rule line.
- Agents `repo-analyst` (haiku, read-only) and `doc-verifier` (sonnet, read-only).
- Templates for CLAUDE.md, per-package CLAUDE.md, every wiki page type, recipes, plans, rules files, and gotcha entries.
- Scripts `page.mjs` (stamp `verified`/`updated`) and `claude-md.mjs` (sections, splice, backup); `stale.mjs --since` and `--session all`; `detect.mjs --brief`, `config`, and `dataDir`.
- Eval cases for `onboard`, `sync-docs`, and `lesson` under `evals/`, with scaffold scripts that build fixture repositories.
```

- [ ] **Step 4: Update the root README**

In the repository root `README.md`, after the Install section add:

```markdown
## What you get

`/ship-faster:onboard` writes a router `CLAUDE.md`, a verified wiki under `docs/wiki/`, and path-scoped rules under `.claude/rules/`. `/ship-faster:sync-docs` keeps the wiki true as the code changes, and `/ship-faster:lesson` records what was learned the moment it is learned. This repository is onboarded with its own plugin: read [`CLAUDE.md`](./CLAUDE.md) and [`docs/wiki/index.md`](./docs/wiki/index.md).
```

(The two links resolve after Task 14; that task's lint step confirms it.)

- [ ] **Step 5: Validate and commit**

Run: `node plugins/ship-faster/tests/validate.mjs`, `node plugins/ship-faster/tests/run.mjs`, `claude plugin validate --strict plugins/ship-faster`
Expected: all pass.

```bash
git add plugins/ship-faster/README.md plugins/ship-faster/CHANGELOG.md README.md
git commit -F <message file>
```

Message:

```
docs: describe the knowledge skills, agents, generated files, and evals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 14: Dogfood `onboard` on this repository, CI lint, final verification

**Files:**
- Create: `CLAUDE.md`, `docs/wiki/**`, `.claude/rules/*.md` (generated by the skill, then reviewed)
- Modify: `.github/workflows/ci.yml`
- Modify: `plugins/ship-faster/README.md` (token-cost sentence)
- Modify: `plugins/ship-faster/skills/onboard/SKILL.md` and reference files when the run exposes a defect in the procedure

**Interfaces:**
- Consumes: the whole plugin, loaded for one session with `--plugin-dir` (no install into the user's configuration).
- Produces: this repository's own CLAUDE.md, wiki, and rules; CI gates on `lint.mjs` and `index.mjs --check` for them.

This task is run by the orchestrator, not delegated: judging the generated pages needs knowledge of the repository, and defects found here feed back into the skill text.

- [ ] **Step 1: Run the real skill in this worktree**

From the worktree root, with the plugin's state redirected to the scratchpad so nothing lands in the user's plugin data:

```bash
CLAUDE_PLUGIN_DATA="<scratchpad>/dogfood-data" claude -p --plugin-dir plugins/ship-faster --model opus --permission-mode acceptEdits --allowedTools "Read" "Glob" "Grep" "Write" "Edit" "Agent" "Skill" "Bash(node *)" "Bash(git *)" "Bash(claude plugin validate *)" --strict-mcp-config --max-budget-usd 30 --output-format json "/ship-faster:onboard" > "<scratchpad>/dogfood.json"
```

Run it in the background (it can take 20 to 30 minutes) and wait for completion. `opus` is the main-session model here: the analysts and verifiers pin their own models, and the orchestration and drafting need a strong writer without paying the default model's rate. Record from `dogfood.json`: `total_cost_usd`, `num_turns`, `subagent_stats.spawned`, `duration_ms`, and the `result` text (the report).

If the run ends without writing CLAUDE.md, read `result` and `permission_denials` in the JSON: a denied tool means the allow list above is missing a pattern the skill needed (add it and re-run); a stopped skill means a precondition fired (check `existing.wiki`). If the plugin agents could not be spawned by name, fall back to executing the SKILL.md procedure in this session with general-purpose agents given the agent files' bodies as their prompts, and record that as a finding against the plugin.

- [ ] **Step 2: Review the output against the spec**

Check, and fix by hand where the skill fell short (every fix is also a finding about the skill text; apply the corresponding change to `SKILL.md` or its reference files in the same commit):

- `CLAUDE.md`: under 150 lines; managed block under 90; six managed sections; a Commands table listing only commands that passed (`node plugins/ship-faster/tests/validate.mjs`, `node plugins/ship-faster/tests/run.mjs`, `claude plugin validate --strict plugins/ship-faster`, `claude plugin validate --strict .`) with durations, and no `@` imports; a Read next row per page and recipe; `## Rules` with imperative sentences (expect the plugin's own rules: scripts exit 0 with JSON, hooks never fail, stage files by name, no `git add -A`, every commit carries the Co-Authored-By trailer, LF endings).
- `docs/wiki/`: `index.md` generated; `overview`, `architecture`, `layout`, `commands` (with `checks:`), `conventions`, `testing`, `dependencies` (this plugin has none: the page should either be absent or state that fact in under 20 lines; absent is correct), `ops` (CI only), recipes for the shapes the history shows (a new script with its test file, a new hook, a new lib module). Every page under 200 lines, every `covers` matching tracked files, `verified` equal to the worktree HEAD.
- `.claude/rules/`: at least a rules file for `plugins/ship-faster/scripts/**` (exit-0 JSON contract, git through `lib/git.mjs`, `/` paths) and for `plugins/ship-faster/tests/**` (temp repos, `CLAUDE_PLUGIN_DATA` isolation). Each with `paths:`, under 25 lines.
- No claim you know to be false. Read every page in full.

Then run:

```bash
node plugins/ship-faster/scripts/lint.mjs
node plugins/ship-faster/scripts/index.mjs --check
node plugins/ship-faster/scripts/stale.mjs
```

Expected: `0 error(s)`, `index.md up to date`, every page `fresh`.

- [ ] **Step 3: Add the wiki gates to CI**

In `.github/workflows/ci.yml`, in the `test` job after the `run.mjs` step:

```yaml
      - run: node plugins/ship-faster/scripts/lint.mjs
      - run: node plugins/ship-faster/scripts/index.mjs --check
```

- [ ] **Step 4: Record the projected token cost**

```bash
claude --plugin-dir plugins/ship-faster plugin details ship-faster
```

Replace the placeholder line `Projected token cost: see the sentence added in Task 14.` in `plugins/ship-faster/README.md` with one sentence quoting the reported always-on figure, for example: `Projected token cost, from \`claude plugin details ship-faster\`: about N tokens added to every session for the skill listing; hooks add none.` Use the actual number.

- [ ] **Step 5: Full verification**

```bash
node plugins/ship-faster/tests/validate.mjs
node plugins/ship-faster/tests/run.mjs
node plugins/ship-faster/tests/bench.mjs
claude plugin validate --strict plugins/ship-faster
claude plugin validate --strict .
node plugins/ship-faster/scripts/lint.mjs
node plugins/ship-faster/scripts/index.mjs --check
```

Expected: everything passes; bench within budget.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/wiki .claude/rules .github/workflows/ci.yml plugins/ship-faster/README.md
git add plugins/ship-faster/skills/onboard   # only if the run changed the skill text
git commit -F <message file>
```

Message:

```
docs: onboard this repository with its own plugin

CLAUDE.md, docs/wiki, and .claude/rules generated by /ship-faster:onboard
running from --plugin-dir, reviewed by hand; CI now lints the wiki and
checks the index. Run: <cost> USD, <turns> turns, <agents> agents.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

## Plan self-review notes

- Spec coverage: 4.1 CLAUDE.md (Tasks 6, 7, 12, 14), 4.2 wiki pages and frontmatter (Tasks 5, 7, 12), 4.3 rules files (Tasks 7, 10, 12), 4.5 config (consumed via detect, Task 4), 4.6 monorepos (Tasks 7, 12), 5 data directory (backup dir used by Task 6), 6 S1–S3 (Tasks 12, 11, 10), 7 G1–G2 (Task 9), 9.5 stale (Tasks 2, 3), 11 validator and evals (Tasks 8, 10–13), 12 README (Tasks 13, 14), 13 build order item 2 (dogfood, Task 14). `.github/workflows/evals.yml` and the remaining skills are plan 3.
- Names used across tasks: `commitsSince`, `changedBetween`, `mergeBase`, `logTopo` (Tasks 1–3); `loadAllSessions` (Task 3); `stale` with `inScope`, `since`, `uncovered` (Task 3); `detect(root, { brief })`, `config`, `dataDir` (Task 4); `today`, `verifyPages`, `touchPages` (Task 5); `START`, `END`, `MANAGED_MAX`, `sections`, `splice`, `spliceFile`, `backupClaudeMd` (Task 6); the template file list (Tasks 7, 8); `ship-faster:repo-analyst`, `ship-faster:doc-verifier` (Tasks 9–12); `/ship-faster:onboard`, `/ship-faster:sync-docs`, `/ship-faster:lesson` (Tasks 10–14).
- Rulings made while writing this plan, each with its cost if wrong:
  - R-K1 Alongside rule for staleness (Task 2): a page committed with the covered change stays fresh. Cost if wrong: cosmetic page edits in the same commit hide drift until the next full sync.
  - R-K2 Evals run in CI only; locally the format is checked with a Bash grant that the Windows runner refuses. Cost if wrong: an eval defect surfaces on the first CI run instead of now.
  - R-K3 Slash-only skills are exercised in evals through a prompt that starts with the slash command; their graders check outcomes, not a Skill tool call. Cost if wrong: one eval case reports 0 and the prompt is rewritten.
  - R-K4 The dogfood runs the real skill through `claude -p --plugin-dir` with `opus` as the main model and a 30 USD ceiling, state redirected to the scratchpad. Cost if wrong: one run's credit and a fallback to executing the procedure inline.
  - R-K5 `detect --brief` for model-invocable skills to keep their recurring context small. Cost if wrong: a skill lacks a fact and runs `detect` once more.
  - R-K6 Skill references are validated against the spec's nine skill names so a skill may point at one a later task creates. Cost if wrong: a typo that spells another valid skill name passes validation.
