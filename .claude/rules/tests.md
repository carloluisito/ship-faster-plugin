---
paths: ["plugins/ship-faster/tests/**"]
---
# Tests rules
- In a test file that reaches `scripts/lib/state.mjs`, set `process.env.CLAUDE_PLUGIN_DATA = tmpDir('sf-data-')` in `beforeEach`. (docs/wiki/gotchas.md g-20260916-plugin-data)
- Register `after(cleanupAll)` in every test file that creates temp directories. (docs/wiki/testing.md)
- Build git fixtures with `makeRepo` and run scripts as subprocesses with `runScript` from `helpers.mjs`. (docs/wiki/testing.md)
- Name test files `<module>.test.mjs`; `run.mjs` runs only that pattern. (docs/wiki/testing.md)
