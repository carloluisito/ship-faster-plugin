import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node tests/eval-report.mjs <result.json> [<result.json> ...]');
  process.exit(2);
}

const rows = [];
const unmatched = [];
const totals = { passed: 0, total: 0, cost: 0, seconds: 0, partial: false };
for (const file of files) {
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const cases = result.cases || [];
  if (!cases.length) unmatched.push(basename(file).replace(/^latest-/, '').replace(/\.json$/, ''));
  for (const c of cases) {
    const runs = c.arms?.with || [];
    for (const [i, run] of runs.entries()) {
      const failed = (run.graders || []).filter((g) => !g.passed).map((g) => g.name);
      rows.push({
        case: runs.length > 1 ? `${c.name} #${i + 1}` : c.name,
        score: run.score == null ? '-' : run.score.toFixed(2),
        cost: (run.costUsd || 0).toFixed(2),
        seconds: String(run.durationSeconds ?? '-'),
        note: run.error ? String(run.error).split('\n')[0].slice(0, 70) : failed.length ? `failed: ${failed.join(', ')}` : 'ok',
      });
    }
  }
  const a = result.aggregates || {};
  totals.passed += a.casesPassed || 0;
  totals.total += a.casesTotal || 0;
  totals.cost += result.costUsd || 0;
  totals.seconds += result.durationSeconds || 0;
  totals.partial = totals.partial || Boolean(result.partial);
}

const widths = { case: 20, score: 5, cost: 5, seconds: 7 };
const line = (r) => `${r.case.padEnd(widths.case)} ${r.score.padStart(widths.score)} ${r.cost.padStart(widths.cost)} ${r.seconds.padStart(widths.seconds)}  ${r.note}`;
console.log(line({ case: 'case', score: 'score', cost: 'usd', seconds: 'time', note: '' }));
for (const r of rows) console.log(line(r));
console.log(`\n${totals.passed}/${totals.total} cases pass, ${totals.cost.toFixed(2)} USD, ${Math.round(totals.seconds)} s${totals.partial ? ' (partial: cost ceiling hit)' : ''}`);
for (const pattern of unmatched) console.log(`no case matches ${pattern}`);
if (unmatched.length) process.exit(1);
