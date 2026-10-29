#!/usr/bin/env node
// Local copy of the pre-merge "Tests catch bugs" check: mutates only the lines this branch changed
// with gremlins and counts what the same-package tests kill. Usage (from the repo root):
//   node ~/.claude/skills/pr-test-playbook/scripts/mutate.js [baseRef] [buildTags]
// Optional 3rd arg limits the run to changed files whose path contains it. Defaults: baseRef=origin/development, buildTags=acceptance,e2e. Needs gremlins in PATH or ~/go/bin.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.argv[2] || 'origin/development';
const tags = process.argv[3] || 'acceptance,e2e';
const home = os.homedir();
const exe = process.platform === 'win32' ? 'gremlins.exe' : 'gremlins';
const gremlins = fs.existsSync(path.join(home, 'go', 'bin', exe)) ? path.join(home, 'go', 'bin', exe) : exe;

// Added or changed lines of every non-test, non-tests/ Go file.
const diff = cp.execSync(`git diff -U0 ${base} -- "*.go"`, { maxBuffer: 1 << 28 }).toString();
const changed = {};
let file = null;
for (const line of diff.split('\n')) {
  let m = line.match(/^\+\+\+ b\/(.+)$/);
  if (m) { file = m[1]; continue; }
  m = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
  if (m && file) {
    const start = +m[1], len = m[2] === undefined ? 1 : +m[2];
    if (len === 0) continue;
    (changed[file] = changed[file] || []).push([start, start + len - 1]);
  }
}
const prod = Object.keys(changed).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go') && !/^tests?\//.test(f) && fs.existsSync(f));
const only = process.argv[4];
const byDir = {};
for (const f of prod.filter((x) => !only || x.includes(only))) (byDir[path.dirname(f)] = byDir[path.dirname(f)] || []).push(f);

const inRange = (f, line) => (changed[f] || []).some(([a, b]) => line >= a && line <= b);
const totals = { KILLED: 0, LIVED: 0, 'NOT COVERED': 0, 'TIMED OUT': 0 };
const survivors = [];

for (const [dir, files] of Object.entries(byDir)) {
  const keep = new Set(files.map((f) => path.basename(f)));
  const excludes = ['-E', '_test\\.go$'];
  for (const g of fs.readdirSync(dir)) if (g.endsWith('.go') && !keep.has(g)) excludes.push('-E', `(^|[\\\\/])${g.replace(/\./g, '\\.')}$`);
  const out = path.join(os.tmpdir(), `gremlins-${process.pid}-${Object.keys(byDir).indexOf(dir)}.json`);
  console.log(`\n== ${dir}: ${[...keep].join(', ')}`);
  cp.spawnSync(gremlins, ['unleash', './' + dir, '-t', tags, '--workers', '4', '--timeout-coefficient', '10', ...excludes, '-o', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!fs.existsSync(out)) { console.log('   no result file (gremlins failed)'); continue; }
  const res = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const f of res.files || []) {
    const full = path.posix.join(dir.replace(/\\/g, '/'), f.file_name);
    for (const mu of f.mutations || []) {
      if (!inRange(full, mu.line)) continue;
      if (totals[mu.status] === undefined) continue;
      totals[mu.status]++;
      if (mu.status !== 'KILLED') survivors.push(`${mu.status.padEnd(11)} ${mu.type} ${full}:${mu.line}:${mu.column}`);
    }
  }
}

const k = totals.KILLED, all = k + totals.LIVED + totals['NOT COVERED'] + totals['TIMED OUT'];
console.log('\n--- mutants on changed lines ---');
console.log(totals);
console.log(`killed ${k} of ${all} = ${all ? ((100 * k) / all).toFixed(1) : '100.0'}%  (bot needs 80%+, aim for 100%)`);
if (survivors.length) console.log('\nSurvivors / uncovered (add an in-package test that fails when the line is flipped):\n' + survivors.join('\n'));
process.exitCode = all && (100 * k) / all < 80 ? 1 : 0;
