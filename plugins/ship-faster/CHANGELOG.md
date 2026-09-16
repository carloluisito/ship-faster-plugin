# Changelog

All notable changes to this plugin are documented here. The format follows Keep a Changelog and
versions follow semver.

## [Unreleased]

### Added
- SessionStart hook: wiki location, stale page count, active plan, overdue health audit, onboard suggestion.
- PreToolUse guard: denies force pushes and direct pushes to protected branches, `--no-verify`, and risky `git add -A`.
- PostToolUse drift marker and UserPromptSubmit report: pages covering edited files are recorded and reported once per session.
- SessionEnd cleanup of session records.
- Scripts: detect, footprints, stale, index, lint, checks, plan, with a shared zero-dependency library.
- Optional `.claude/ship-faster.json` configuration.

### Fixed
- The guard no longer waves through `git push origin main --tags`: pushing tags alongside a branch is still checked against the protected branches.
- Hooks exit as soon as they have read their input, instead of lingering when the caller leaves the input pipe open.
- A wiki whose pages were verified at many different commits no longer makes session start slow: the staleness check now reads the history once instead of once per commit.
- The guard waits at most two seconds for `git status` before it gives up and allows the command.
- Multi-line CI steps are read as one command, so a step split across lines with `\` or `&&` no longer turns into fragments that fail when run as checks.
- A preflight run still reports every check when its log file cannot be written.
