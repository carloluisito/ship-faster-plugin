---
paths: ["plugins/ship-faster/evals/**"]
---
# Evals rules
- Save `scaffold.sh` as UTF-8 without a BOM, with `#!/usr/bin/env bash` as the first bytes. (docs/wiki/gotchas.md g-20260916-scaffold-bom)
- Give every skill an eval case with `prompt.md` and at least one `graders/*.md`; the validator fails without them. (docs/wiki/recipes/add-a-skill.md)
- Never run `claude plugin eval` as a PR gate; it spends real model credit. (docs/wiki/testing.md)
- Write an `input_match` around JSON escaping: `\S*` or `[^ ]+` where the command quotes a path, never a literal quote. (docs/wiki/gotchas.md g-20260917-grader-json-escape)
