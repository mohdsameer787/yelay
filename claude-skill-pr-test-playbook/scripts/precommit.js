#!/usr/bin/env node
// Fast gate to run before EVERY commit (and by the optional git hook): build, vet, tidy, repo hygiene, bot linters, all tests.
// Slow steps (verify, gosec, nilaway, race, mutation) stay in finalcheck.js; run that at the end of test work.
// Usage (repo root):  node ~/.claude/skills/pr-test-playbook/scripts/precommit.js [baseRef]
const cp = require('child_process');
const path = require('path');
const base = process.argv[2] || 'origin/development';
const steps = 'build,vet,tidy,logs,names,reports,comments,sql,lint,tests';
const r = cp.spawnSync('node', [path.join(__dirname, 'finalcheck.js'), base, steps], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
