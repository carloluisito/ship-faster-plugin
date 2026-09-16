# Audit areas

One `ship-faster:health-auditor` per row; the brief is the row's text.

| Area | Brief |
|---|---|
| dependencies | Outdated dependencies by major and minor, and vulnerable ones. Use only installed tools: `npm outdated --json` and `npm audit --json` (or the pnpm/yarn forms) for Node; `dotnet list package --outdated` and `--vulnerable` for .NET; `pip list --outdated --format=json` and `pip-audit -f json` for Python; `cargo outdated --format json` and `cargo audit --json` for Rust; `go list -m -u -json all` and `govulncheck ./...` for Go. Report a missing tool as one finding. Effort S for patch and minor bumps (mark them safe), M for majors, L when a major touches a framework. |
| tests | Skipped or ignored tests (`scan.skippedTests` plus anything the test framework's own markers show), the slowest checks from the last preflight (`scan.slowChecks`), flaky markers (retry decorators, `flaky`, `retries:` in test configs). Effort S to un-skip a test with a known fix, M otherwise. |
| docs | `scan.docs` counts (stale, dirty, unverifiable, invalid pages; lint errors; pages over budget) and `scan.staleRecipes`. Fix for stale or dirty pages is `/ship-faster:sync-docs --scope all` (safe). Fix for a stale recipe is to delete or refresh it (M). |
| hygiene | Script only unless a tool shows more: `scan.todos` (markers older than 90 days by blame) and `scan.largeFiles` (tracked files over 1 MB). Effort S per marker to resolve or delete; M to move a large file to LFS or out of the repository. |
| ci | Failing workflows among the last ten runs: `gh run list --json name,conclusion,status,headBranch,createdAt -L 10` when `gh` is installed and the repository has a GitHub remote; otherwise one finding that CI status was not checked. Effort M per failing workflow. |
| plans | Script only: `scan.plans` (active plans whose branch is merged or gone for 30 days). Fix: archive with `plan.mjs set-status <rel> abandoned` (safe). Effort S. |
