#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.email eval@example.com
git config user.name eval
mkdir -p src/routes src/lib tests scripts .github/workflows
cat > package.json <<'EOF'
{
  "name": "tiny-api",
  "version": "0.3.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test tests/",
    "lint": "node scripts/lint.js"
  }
}
EOF
cat > README.md <<'EOF'
# tiny-api

An in-memory users API used as a fixture. `npm start` serves it on port 3000; `npm test` runs the node:test suite.
EOF
cat > .gitignore <<'EOF'
node_modules/
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
  if (req.method === 'POST' && url.pathname === '/users') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => json(res, 201, db.create(JSON.parse(body || '{}'))));
    return;
  }
  json(res, 404, { error: 'no route' });
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
EOF
cat > src/index.js <<'EOF'
import { createServer } from 'node:http';
import { handleUsers } from './routes/users.js';

const port = Number(process.env.PORT || 3000);
export const server = createServer((req, res) => handleUsers(req, res, new URL(req.url, 'http://localhost')));
if (process.argv[1] && process.argv[1].endsWith('index.js')) server.listen(port, () => console.error(`listening on ${port}`));
EOF
cat > tests/users.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/lib/db.js';

test('create then get', () => {
  const row = db.create({ name: 'Ada' });
  assert.equal(db.get(row.id).name, 'Ada');
  assert.equal(db.get(999), null);
});
EOF
cat > scripts/lint.js <<'EOF'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
let bad = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && /console\.log\(/.test(readFileSync(p, 'utf8'))) { console.error(`console.log in ${p}`); bad++; }
  }
}
walk('src');
process.exit(bad ? 1 : 0);
EOF
cat > .github/workflows/ci.yml <<'EOF'
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npm run lint
EOF
git add package.json README.md .gitignore src/index.js src/lib/db.js
git commit -q -m "feat: http server skeleton"
git add src/routes/users.js tests/users.test.js
git commit -q -m "feat(users): list and get endpoints"
printf '\n// 404 for unknown ids\n' >> src/routes/users.js
printf '\n// covers missing ids\n' >> tests/users.test.js
git add src/routes/users.js tests/users.test.js
git commit -q -m "fix(users): return 404 for a missing id"
printf '\n// create endpoint\n' >> src/routes/users.js
printf '\n// covers create\n' >> tests/users.test.js
printf '\n// nextId starts at 1\n' >> src/lib/db.js
git add src/routes/users.js tests/users.test.js src/lib/db.js
git commit -q -m "feat(users): create endpoint"
git add scripts/lint.js .github/workflows/ci.yml
git commit -q -m "chore: lint script and ci"
printf '\n// validate name\n' >> src/routes/users.js
printf '\n// covers validation\n' >> tests/users.test.js
git add src/routes/users.js tests/users.test.js
git commit -q -m "feat(users): reject an empty name"