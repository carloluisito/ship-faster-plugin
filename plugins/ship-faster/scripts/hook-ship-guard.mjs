import { readStdinJson } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as gitLib from './lib/git.mjs';
import { normalizePath } from './lib/glob.mjs';
import { isLarge, riskyReason } from './lib/risky.mjs';
import { resolveRootCached } from './lib/root.mjs';
import { splitSegments, tokenize } from './lib/shell.mjs';

const OVERRIDE = (rule) => ` Override: guard.${rule} in .claude/ship-faster.json.`;
const WRAPPERS = new Set(['sudo', 'time', 'nice', 'env', 'command', 'exec', 'nohup', 'stdbuf']);
const VALUE_OPTS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

const defaultGitApi = {
  currentBranch: (root) => gitLib.currentBranch(root),
  defaultBranch: (root) => gitLib.defaultBranch(root),
  isTag: (root, name) => gitLib.git(['show-ref', '--verify', '--quiet', `refs/tags/${name}`], { cwd: root }).ok,
  dirtyFiles: (root) => gitLib.dirtyFiles(root, { timeoutMs: 2000 }),
};

function gitInvocation(tokens) {
  let i = 0;
  while (i < tokens.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) { i++; continue; }
    if (WRAPPERS.has(tokens[i])) {
      const wrapper = tokens[i];
      i++;
      while (i < tokens.length && tokens[i].startsWith('-')) {
        const flag = tokens[i];
        i++;
        if ((wrapper === 'sudo' && (flag === '-u' || flag === '-g')) || (wrapper === 'nice' && flag === '-n')) i++;
      }
      continue;
    }
    break;
  }
  if (tokens[i] !== 'git') return null;
  i++;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C' || tokens[i] === '-c') i += 2;
    else i += 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1) };
}

const shortHas = (tok, letter) => /^-[A-Za-z]+$/.test(tok) && tok.includes(letter);

function positionalArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) { if (VALUE_OPTS.has(a)) i++; continue; }
    out.push(a);
  }
  return out;
}

function checkPush(args, ctx) {
  if (args.includes('--dry-run') || args.some((a) => a === '-n' || shortHas(a, 'n'))) return null;
  if (args.includes('--no-verify')) return { rule: 'noVerify' };
  let force = args.some((a) => a === '-f' || a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes' || shortHas(a, 'f'));
  const hasTags = args.includes('--tags');
  const hasRepo = args.some((a) => a === '--repo' || a.startsWith('--repo='));
  const positional = positionalArgs(args);
  const refspecs = hasRepo ? positional : positional.slice(1);
  if (hasTags && refspecs.length === 0) return null;
  if (refspecs.some((r) => r.startsWith('+'))) force = true;

  const rule = force && ctx.config.guard.forcePush !== 'allow' ? 'forcePush' : 'pushProtected';
  if (ctx.config.guard[rule] === 'allow') return null;

  const tagCache = new Map();
  const isTag = (t) => {
    if (!tagCache.has(t)) tagCache.set(t, ctx.gitApi.isTag(ctx.root, t));
    return tagCache.get(t);
  };

  let targets;
  if (refspecs.length) {
    targets = refspecs.map((r) => {
      const spec = r.startsWith('+') ? r.slice(1) : r;
      let dst = spec.includes(':') ? spec.split(':')[1] : spec;
      dst = dst.replace(/^refs\/heads\//, '');
      if (dst === 'HEAD' || dst === '@') dst = ctx.gitApi.currentBranch(ctx.root);
      return dst;
    }).filter(Boolean);
    if (targets.length && targets.every(isTag)) return null;
  } else {
    const cur = ctx.gitApi.currentBranch(ctx.root);
    if (!cur) return null;
    targets = [cur];
  }
  const protectedSet = new Set(ctx.config.protectedBranches);
  const def = ctx.gitApi.defaultBranch(ctx.root);
  if (def) protectedSet.add(def);
  const hit = targets.find((t) => protectedSet.has(t) && !isTag(t));
  if (!hit) return null;
  if (rule === 'forcePush') return { rule: 'forcePush', reason: `ship-faster guard: force push to protected branch "${hit}" is blocked. Push a feature branch and open a PR with /ship-faster:ship.${OVERRIDE('forcePush')}` };
  return { rule: 'pushProtected', reason: `ship-faster guard: direct push to protected branch "${hit}" is blocked. Push the feature branch and open a PR with /ship-faster:ship.${OVERRIDE('pushProtected')}` };
}

function checkAdd(args, ctx) {
  if (args.includes('-n') || args.includes('--dry-run') || args.some((a) => shortHas(a, 'n'))) return null;
  const flag = args.find((a) => a === '-A' || a === '--all' || a === '.' || a === ':/' || shortHas(a, 'A'));
  if (!flag) return null;
  if (ctx.config.guard.addAll === 'allow') return null;
  let dirty;
  try { dirty = ctx.gitApi.dirtyFiles(ctx.root); } catch { return null; }
  if (!Array.isArray(dirty)) return null;
  const risky = dirty.map((d) => d.path).filter((p) => riskyReason(p) !== null || isLarge(ctx.root, p));
  if (!risky.length) return null;
  const list = risky.slice(0, 5).join(', ') + (risky.length > 5 ? `, +${risky.length - 5} more` : '');
  return { rule: 'addAll', reason: `ship-faster guard: "git add ${flag}" would stage risky paths (${list}). Stage files by name.${OVERRIDE('addAll')}` };
}

const EVAL_SUBCOMMANDS = new Set(['push', 'add', 'commit', 'merge']);

export function needsEvaluation(command) {
  for (const segment of splitSegments(command)) {
    const inv = gitInvocation(tokenize(segment));
    if (inv && EVAL_SUBCOMMANDS.has(inv.sub)) return true;
  }
  return false;
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
  if (typeof command !== 'string' || !needsEvaluation(command)) return;
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = resolveRootCached(cwd);
  const { config } = loadConfig(root);
  const result = evaluate(command, { root, config });
  if (!result.decision) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: result.decision, permissionDecisionReason: result.reason } }) + '\n');
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/hook-ship-guard.mjs')) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}
