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
  clusters.sort((a, b) => b.commits - a.commits || (a.files[0] < b.files[0] ? -1 : a.files[0] > b.files[0] ? 1 : 0));

  const dirCount = new Map();
  for (const c of commits) {
    const files = c.files.filter((f) => !IGNORED.has(f.split('/').pop()));
    for (const dir of new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] : '.')))) {
      dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
    }
  }
  const hotspots = [...dirCount.entries()].map(([dir, n]) => ({ dir, commits: n })).sort((a, b) => b.commits - a.commits || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)).slice(0, 10);

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
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, 6).map(([w]) => w);
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith('/scripts/footprints.mjs')) {
  runMain((_, flags) => footprints(resolveRoot(flags), { maxCommits: flags['max-commits'] ? Number(flags['max-commits']) : 500 }));
}
