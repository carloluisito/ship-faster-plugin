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
