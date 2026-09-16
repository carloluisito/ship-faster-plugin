import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readStdinJson } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { resolveRootCached } from './lib/root.mjs';
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
  const root = resolveRootCached(cwd);
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
    const rules = existsSync(rulesDir) && statSync(rulesDir).isDirectory() ? readdirSync(rulesDir).filter((n) => n.endsWith('.md')).length : 0;
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

  const text = capOutput(lines, MAX);
  if (text) process.stdout.write(text + '\n');
}

function capOutput(lines, max) {
  const arr = lines.slice();
  while (arr.length > 1 && arr.join('\n').length > max) arr.pop();
  let text = arr.join('\n');
  if (text.length > max) {
    const cut = text.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    text = (sp > 0 ? cut.slice(0, sp) : cut) + '…';
  }
  return text;
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
