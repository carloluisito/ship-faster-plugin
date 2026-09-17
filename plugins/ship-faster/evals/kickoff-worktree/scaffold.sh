#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
cat > .gitignore <<'EOF'
scaffold.sh
.bash_profile
.bashrc
.claude
.eval-artifacts
.gitconfig
.gitmodules
.idea
.mcp.json
.profile
.ripgreprc
.vscode
.zprofile
.zshrc
EOF
mkdir -p src/routes src/lib tests docs/wiki/recipes
cat > package.json <<'EOF'
{ "name": "tiny-api", "version": "0.3.0", "type": "module", "scripts": { "test": "node --test tests/*.test.js" } }
EOF
cat > src/lib/db.js <<'EOF'
const rows = new Map();
let nextId = 1;
export function list() { return [...rows.values()]; }
export function get(id) { return rows.get(Number(id)) || null; }
export function create(user) { const row = { id: nextId++, ...user }; rows.set(row.id, row); return row; }
EOF
cat > src/routes/users.js <<'EOF'
import * as db from '../lib/db.js';

export function handleUsers(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/users') return json(res, 200, db.list());
  const m = /^\/users\/(\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && m) {
    const row = db.get(m[1]);
    return row ? json(res, 200, row) : json(res, 404, { error: 'not found' });
  }
  json(res, 404, { error: 'no route' });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
EOF
cat > tests/users.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/lib/db.js';
test('create then get', () => {
  const row = db.create({ name: 'Ada' });
  assert.equal(db.get(row.id).name, 'Ada');
});
EOF
cat > docs/wiki/layout.md <<'EOF'
---
title: Layout
summary: Where routes, storage, and tests live.
read_when: You need to find where something lives or decide where a new file belongs.
covers: ["package.json", "src/**"]
verified: unverified
updated: 2026-01-01
---
# Layout

## Map
| Directory | Responsibility |
|---|---|
| `src/routes/` | one module per resource, exporting handle<Resource>(req, res, url) |
| `src/lib/` | storage and helpers |
| `tests/` | node:test suites, one file per resource |

## Entry points
| Entry | Starts | File |
|---|---|---|
| server | the HTTP server on PORT | `src/index.js` |

## Where things go
| Adding a… | Put it in | Named like | Register in |
|---|---|---|---|
| route | `src/routes/` | `<resource>.js` | `src/index.js` |
EOF
cat > docs/wiki/testing.md <<'EOF'
---
title: Testing
summary: node:test suites under tests/, run with npm test.
read_when: You are adding or fixing a test.
covers: ["tests/**", "package.json"]
verified: unverified
updated: 2026-01-01
---
# Testing

## Layout
| Kind | Location | Runner | Command |
|---|---|---|---|
| unit | `tests/` | node:test | `npm test` |

## Adding a test
1. Create `tests/<resource>.test.js` importing from `../src/`.
2. Use `assert` from `node:assert/strict`.
3. Run `node --test tests/<resource>.test.js`.

## Fixtures and mocks
| Need | Use | Defined in |
|---|---|---|
| storage | the in-memory map | `src/lib/db.js` |

## Not runnable locally
- none
EOF
cat > docs/wiki/commands.md <<'EOF'
---
title: Commands
summary: Verified commands.
read_when: You need to run the tests.
covers: ["package.json"]
verified: unverified
updated: 2026-01-01
checks:
  - name: test
    run: npm test
    timeout: 120
---
# Commands

## Setup
| Step | Command | Notes |
|---|---|---|
| Install | `npm install` | no dependencies |

## Everyday
| Purpose | Command | Duration | Status |
|---|---|---|---|
| Tests | `npm test` | 1s | pass |

## Checks
1. `npm test`

## Known slow or flaky
- none
EOF
cat > docs/wiki/gotchas.md <<'EOF'
---
title: Gotchas
summary: Constraints learned the hard way.
read_when: Before touching src/routes.
covers: ["src/routes/**"]
verified: unverified
updated: 2026-01-01
---
# Gotchas

### Route order decides the match <!-- id: g-20260101-route-order -->
Symptom: a new route returns 404 although its handler exists.
Cause: handleUsers matches routes top to bottom and the catch-all 404 sits last; a regex route added after it never runs.
Rule: Add new route branches above the final json(res, 404) call in src/routes/users.js.
Evidence: src/routes/users.js:9, 2026-01-01.
EOF
cat > docs/wiki/recipes/add-endpoint.md <<'EOF'
---
title: Add an endpoint
summary: Add a route branch, its storage call, and its test.
read_when: You need to add an HTTP endpoint.
covers: ["src/routes/**", "tests/**"]
verified: unverified
updated: 2026-01-01
---
# Add an endpoint

## Steps
1. Add the storage function to `src/lib/db.js` if the resource needs one.
2. Add a branch to `handleUsers` in `src/routes/users.js` above the final 404.
3. Add a test in `tests/users.test.js` covering the success and the 404 case.
4. Run `npm test`.

## Files
| File | Change |
|---|---|
| `src/lib/db.js` | storage function |
| `src/routes/users.js` | route branch |
| `tests/users.test.js` | test |

## Test
`node --test tests/users.test.js`

## Docs
Update `docs/wiki/layout.md` if a new directory appears.
EOF
cat > docs/wiki/index.md <<'EOF'
<!-- Generated by ship-faster. Do not edit: run /ship-faster:sync-docs to regenerate. -->
# Wiki index

| Page | Read when | Summary |
|---|---|---|
| [Commands](commands.md) | You need to run the tests. | Verified commands. |
| [Gotchas](gotchas.md) | Before touching src/routes. | Constraints learned the hard way. |
| [Layout](layout.md) | You need to find where something lives or decide where a new file belongs. | Where routes, storage, and tests live. |
| [Testing](testing.md) | You are adding or fixing a test. | node:test suites under tests/, run with npm test. |

## Recipes

| Recipe | Read when | Summary |
|---|---|---|
| [Add an endpoint](recipes/add-endpoint.md) | You need to add an HTTP endpoint. | Add a route branch, its storage call, and its test. |
EOF
git add package.json .gitignore src/lib/db.js src/routes/users.js tests/users.test.js docs/wiki
git commit -q -m "feat: users api with wiki"
