import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tests/eval-report.mjs <result.json>');
  process.exit(2);
}
const result = JSON.parse(readFileSync(file, 'utf8'));
const rows = [];
for (const c of result.cases || []) {
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
const widths = { case: 16, score: 5, cost: 5, seconds: 7 };
const line = (r) => `${r.case.padEnd(widths.case)} ${r.score.padStart(widths.score)} ${r.cost.padStart(widths.cost)} ${r.seconds.padStart(widths.seconds)}  ${r.note}`;
console.log(line({ case: 'case', score: 'score', cost: 'usd', seconds: 'time', note: '' }));
for (const r of rows) console.log(line(r));
const a = result.aggregates || {};
console.log(`\n${a.casesPassed ?? '?'}/${a.casesTotal ?? '?'} cases pass, overall ${a.overallScore == null ? '?' : a.overallScore.toFixed(2)}, ${(result.costUsd || 0).toFixed(2)} USD, ${result.durationSeconds ?? '?'} s${result.partial ? ' (partial: cost ceiling hit)' : ''}`);
