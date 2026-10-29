#!/usr/bin/env node
// Opt-in: installs a git pre-commit hook in the current repo that runs precommit.js, so a commit on red is impossible.
// Usage (repo root):  node ~/.claude/skills/pr-test-playbook/scripts/install-hook.js [baseRef]
// Hooks live in the shared .git/hooks of the repo (all its worktrees); delete .git/hooks/pre-commit to undo.
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'origin/development';
const hooks = cp.execSync('git rev-parse --git-path hooks', { encoding: 'utf8' }).trim();
const script = path.join(__dirname, 'precommit.js').split(path.sep).join('/');
const file = path.join(hooks, 'pre-commit');
const body = [
  '#!/bin/sh',
  '# installed by pr-test-playbook',
  `node "${script}" ${base} || { echo "pre-commit checks failed: fix them, then commit again"; exit 1; }`,
  '',
].join('\n');
fs.writeFileSync(file, body, { mode: 0o755 });
console.log('installed', file);
