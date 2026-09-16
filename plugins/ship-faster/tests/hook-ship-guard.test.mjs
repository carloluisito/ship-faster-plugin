import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runScript, tmpDir, cleanupAll } from './helpers.mjs';
import { DEFAULTS } from '../scripts/lib/config.mjs';
import { evaluate, needsEvaluation } from '../scripts/hook-ship-guard.mjs';

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

test('wrapper prefixes and value-consuming push options do not defeat detection', () => {
  assert.equal(ev('time git push origin main').rule, 'pushProtected');
  assert.equal(ev('sudo -u root git push origin main').rule, 'pushProtected');
  assert.equal(ev('echo git push origin main').decision, null);
  assert.equal(ev('git push -o ci.skip origin', { currentBranch: () => 'main' }).rule, 'pushProtected');
  assert.equal(ev('git push -o ci.skip origin feat/x').decision, null);
  assert.equal(ev('git push origin HEAD', { currentBranch: () => 'main' }).rule, 'pushProtected');
});

test('command substitution inside quotes is still parsed as a git invocation', () => {
  assert.equal(ev('echo "$(git push origin main)"').rule, 'pushProtected');
});

test('git add --dry-run is never denied', () => {
  const risky = { dirtyFiles: () => [{ path: '.env', status: '??' }] };
  assert.equal(ev('git add -A -n', risky).decision, null);
  assert.equal(ev('git add -A', risky).rule, 'addAll');
});

test('an allow level makes no git calls, and isTag is cached per target', () => {
  const throwing = () => { throw new Error('must not be called'); };
  const allowAll = { ...DEFAULTS, guard: { forcePush: 'allow', pushProtected: 'allow', noVerify: 'allow', addAll: 'allow' } };
  const noGit = { currentBranch: throwing, defaultBranch: throwing, isTag: throwing, dirtyFiles: throwing };
  assert.equal(evaluate('git push origin main', { root: '/r', config: allowAll, gitApi: noGit }).decision, null);
  assert.equal(evaluate('git add -A', { root: '/r', config: allowAll, gitApi: noGit }).decision, null);

  const mixed = { ...DEFAULTS, guard: { ...DEFAULTS.guard, forcePush: 'allow' } };
  assert.equal(ev('git push -f origin main', {}, mixed).rule, 'pushProtected');

  let calls = 0;
  assert.equal(ev('git push origin main', { isTag: () => { calls++; return false; } }).rule, 'pushProtected');
  assert.equal(calls, 1);
});

test('--repo option supplies the remote so all positionals are refspecs', () => {
  assert.equal(ev('git push --repo origin main').rule, 'pushProtected');
  assert.equal(ev('git push --repo=origin main').rule, 'pushProtected');
  assert.equal(ev('git push --repo origin feat/x').decision, null);
});

test('git add dry-run also matches a combined short flag', () => {
  const risky = { dirtyFiles: () => [{ path: '.env', status: '??' }] };
  assert.equal(ev('git add -nA', risky).decision, null);
});

test('env and sudo -g are detected regardless of prefix order', () => {
  assert.equal(ev('env GIT_TRACE=1 git push origin main').rule, 'pushProtected');
  assert.equal(ev('sudo -g wheel git push origin main').rule, 'pushProtected');
  assert.equal(ev('echo git push origin main').decision, null);
});

test('needsEvaluation is true only for push, add, commit, or merge invocations', () => {
  assert.equal(needsEvaluation('git status'), false);
  assert.equal(needsEvaluation('git log --oneline'), false);
  assert.equal(needsEvaluation('npm test'), false);
  assert.equal(needsEvaluation('echo git push'), false);
  assert.equal(needsEvaluation('git push origin main'), true);
  assert.equal(needsEvaluation('git add -A'), true);
  assert.equal(needsEvaluation('git commit -n -m x'), true);
  assert.equal(needsEvaluation('git merge --no-verify x'), true);
  assert.equal(needsEvaluation('time git push origin main'), true);
  assert.equal(needsEvaluation('echo "$(git push origin main)"'), true);
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
