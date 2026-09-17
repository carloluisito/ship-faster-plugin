#!/usr/bin/env bash
# Runs the skill evals with the same flags as .github/workflows/evals.yml.
# usage: tests/evals.sh [case ...]
#   each case is a name or a glob such as 'kickoff*'; commas also separate names.
#   The harness takes one glob per run, so several cases mean one run each.
#   EVAL_MAX_COST  hard cost ceiling in USD for each run (default 10)
#   EVAL_RUNS      override every case's run count (default: each case's own setting)
#   EVAL_KEEP_TEMP set to 1 to keep the per-case workspaces and traces under /tmp
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
plugin=plugins/ship-faster
results="$root/$plugin/evals/results"
mkdir -p "$results"

for tool in claude bwrap socat node git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing: $tool (evals need the claude CLI, bubblewrap, socat, node, and git)"; exit 2; }
done
if [ -d "$HOME/.docker" ] && find "$HOME/.docker" -maxdepth 2 -type l | grep -q .; then
  echo "warning: $HOME/.docker holds symlinks; the sandbox refuses to start with them (run as a user without Docker Desktop integration)"
fi

patterns=()
for arg in "$@"; do
  arg=${arg#\{}
  arg=${arg%\}}
  IFS=',' read -r -a parts <<< "$arg"
  for part in "${parts[@]}"; do
    [ -n "$part" ] && patterns+=("$part")
  done
done
[ ${#patterns[@]} -eq 0 ] && patterns=("")

cd "$root" || exit 1
status=0
files=()
for pattern in "${patterns[@]}"; do
  label=${pattern:-all}
  out="$results/latest-${label//[^A-Za-z0-9_-]/_}.json"
  args=(plugin eval "$plugin" --trust-plugin --scaffold --ablation none --no-publish
    --allow-tools Bash Write Edit --model claude-sonnet-5 --judge-model claude-haiku-4-5
    --threshold 0.8 --max-cost-usd "${EVAL_MAX_COST:-10}" --json "$out")
  [ -n "${EVAL_RUNS:-}" ] && args+=(--runs "$EVAL_RUNS")
  [ "${EVAL_KEEP_TEMP:-0}" = 1 ] && args+=(--keep-temp)
  [ -n "$pattern" ] && args+=(--case "$pattern")
  rm -f "$out"
  echo "== $label"
  claude "${args[@]}"
  code=$?
  [ $code -gt $status ] && status=$code
  [ -f "$out" ] && files+=("$out")
done
if [ ${#files[@]} -gt 0 ]; then
  node "$here/eval-report.mjs" "${files[@]}" || [ $status -gt 0 ] || status=2
fi
exit $status
