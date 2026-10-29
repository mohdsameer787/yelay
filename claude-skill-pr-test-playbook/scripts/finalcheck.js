#!/usr/bin/env node
// Runs the pre-merge bot's checks locally, in the bot's own words and flags, so a PR never meets its blockers first.
// Usage (repo root):  node ~/.claude/skills/pr-test-playbook/scripts/finalcheck.js [baseRef] [steps]
//   baseRef  default origin/development
//   steps    comma list, default "build,vet,tidy,verify,logs,names,commit,reports,comments,sql,lint,gosec,nilaway,tests,race,mutation"
// TEST_DATABASE_URL is taken from the environment, else DATABASE_URL of .env (a throwaway database is made per run).
// Windows: gcc for -race lives in ~/tools/winlibs/mingw64/bin (added to PATH here when present).
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.argv[2] || 'origin/development';
const steps = (process.argv[3] || 'build,vet,tidy,verify,logs,names,commit,reports,comments,sql,lint,gosec,nilaway,tests,race,mutation').split(',');
const tags = 'acceptance,e2e';
const home = os.homedir();
const exe = (n) => (process.platform === 'win32' ? n + '.exe' : n);
const goBin = (n) => (fs.existsSync(path.join(home, 'go', 'bin', exe(n))) ? path.join(home, 'go', 'bin', exe(n)) : exe(n));

const env = { ...process.env };
const gcc = path.join(home, 'tools', 'winlibs', 'mingw64', 'bin');
if (fs.existsSync(gcc)) env.PATH = gcc + path.delimiter + env.PATH;
env.CGO_ENABLED = '1';
if (!env.TEST_DATABASE_URL && fs.existsSync('.env')) {
  const m = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.*)$/m);
  if (m) env.TEST_DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '');
}

const run = (cmd, args, opts = {}) => cp.spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 1 << 29, ...opts });
const results = [];
const report = (name, ok, detail) => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n' + detail.split('\n').slice(0, 25).join('\n') : ''}`); };

// Added or changed lines per file, to keep tool findings to this branch's own lines.
function changedLines() {
  const d = run('git', ['diff', '-U0', base, '--', '*.go']).stdout;
  const ch = {};
  let f = null;
  for (const l of d.split('\n')) {
    let m = l.match(/^\+\+\+ b\/(.+)$/);
    if (m) { f = m[1]; continue; }
    m = l.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (m && f) { const s = +m[1], n = m[2] === undefined ? 1 : +m[2]; if (n) (ch[f] = ch[f] || []).push([s, s + n - 1]); }
  }
  return ch;
}
const onChanged = (ch, file, line) => (ch[file.replace(/\\/g, '/')] || []).some(([a, b]) => line >= a && line <= b);
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');

// ---- Repo-hygiene checks: bot rows "Test input/output" and "Story in PR title/branch", plus the user's own conventions ----
const sh = (c, a) => run(c, a).stdout.trim();
function changedFiles() {
  const names = new Set(sh('git', ['diff', '--name-only', base]).split('\n').filter(Boolean));
  for (const f of sh('git', ['ls-files', '-o', '--exclude-standard']).split('\n').filter(Boolean)) names.add(f);
  return [...names];
}
// Line numbers added or changed in a file; null for an untracked file (every line counts).
function addedLines(file) {
  if (sh('git', ['ls-files', file]) === '') return null;
  const d = run('git', ['diff', '-U0', base, '--', file]).stdout;
  const out = [];
  for (const l of d.split('\n')) {
    const m = l.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (m) { const s = +m[1], n = m[2] === undefined ? 1 : +m[2]; for (let i = 0; i < n; i++) out.push(s + i); }
  }
  return out;
}
// Index of the brace that closes the one at src[open]; skips strings, runes and comments.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"') { for (i++; i < src.length && src[i] !== '"' && src[i] !== '\n'; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') { const e = src.indexOf('`', i + 1); if (e < 0) return -1; i = e; continue; }
    if (c === "'") { for (i++; i < src.length && src[i] !== "'" && src[i] !== '\n'; i++) if (src[i] === '\\') i++; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const LOGS = [/t\.Logf\(\s*"input/, /t\.Logf\(\s*"expected/, /t\.Logf\(\s*"actual/];
const hasLogs = (s) => LOGS.every((r) => r.test(s));

if (steps.includes('verify')) { const r = run('go', ['mod', 'verify']); report('go mod verify', r.status === 0, r.stdout + r.stderr); }

if (steps.includes('logs')) {
  // Every case in an added or changed test logs input, expected and actual (three separate t.Logf calls).
  const bad = [];
  for (const f of changedFiles().filter((x) => x.endsWith('_test.go') && fs.existsSync(x))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const lines = addedLines(f);
    const touched = (a, b) => lines === null || lines.some((l) => l >= a && l <= b);
    const helpers = [];
    const funcs = [];
    const re = /^func (?:\([^)]*\) )?(\w+)\(([^)]*)\)[^{\n]*\{/gm;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1, close = matchBrace(src, open);
      if (close < 0) continue;
      const body = src.slice(open, close + 1);
      funcs.push({ name: m[1], start: lineOf(src, m.index), end: lineOf(src, close), body, open, isTest: /^Test(?!Main$)/.test(m[1]) });
      if (!/^Test/.test(m[1]) && LOGS[0].test(body)) helpers.push(m[1]);
    }
    const viaHelper = (s) => helpers.some((h) => s.includes(h + '('));
    for (const fn of funcs.filter((x) => x.isTest && touched(x.start, x.end))) {
      const runs = [];
      const rr = /t\.Run\(/g;
      let x;
      while ((x = rr.exec(fn.body))) {
        const fo = fn.body.indexOf('{', fn.body.indexOf('func(t *testing.T)', x.index));
        if (fo < 0) continue;
        const inner = fn.body.slice(fo, matchBrace(fn.body, fo) + 1);
        if (!/t\.Run\(/.test(inner.slice(1))) runs.push({ inner, line: lineOf(src, fn.open + fo) });
      }
      if (runs.length) {
        for (const r of runs) if (!hasLogs(r.inner) && !viaHelper(r.inner)) bad.push(`${f}:${r.line} ${fn.name}: a case lacks input/expected/actual t.Logf`);
      } else if (!hasLogs(fn.body) && !viaHelper(fn.body)) bad.push(`${f}:${fn.start} ${fn.name}: no input/expected/actual t.Logf`);
    }
  }
  report('every case in added/changed tests logs input, expected and actual', bad.length === 0, bad.join('\n'));
}

if (steps.includes('names')) {
  // Case names carry unique [TCnnnn]/[TCNEWnn] ids; the same id or the same text twice would collide in Rally.
  const files = sh('git', ['ls-files', '-co', '--exclude-standard', '*_test.go']).split('\n').filter(Boolean);
  const byId = {}, byText = {};
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /"\[(TC(?:NEW)?\d+)\] ([^"\\]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const text = m[2].trim();
      (byId[m[1]] = byId[m[1]] || new Set()).add(text);
      (byText[text] = byText[text] || new Set()).add(m[1]);
    }
  }
  const bad = [];
  for (const [id, t] of Object.entries(byId)) if (t.size > 1) bad.push(`${id} is used for different cases: ${[...t].join(' | ')}`);
  for (const [text, ids] of Object.entries(byText)) if (ids.size > 1) bad.push(`"${text}" appears under ${[...ids].join(', ')}`);
  report('case names: unique ids and texts', bad.length === 0, bad.join('\n'));
  const placeholders = Object.keys(byId).filter((k) => k.startsWith('TCNEW'));
  if (placeholders.length) console.log(`NOTE  ${placeholders.length} [TCNEWnn] placeholders remain: list them for Rally (never invent ids)`);
}

if (steps.includes('commit')) {
  const bad = [];
  const branch = sh('git', ['branch', '--show-current']);
  if (!/^(feature|bugfix)\/(US|DE)\d+-|^chore\//.test(branch)) bad.push(`branch "${branch}" must be feature/US1234-..., bugfix/DE123-... or chore/...`);
  const n = +sh('git', ['rev-list', '--count', `${base}..HEAD`]);
  if (n > 1) bad.push(`${n} commits on top of ${base}: squash into one`);
  if (/co-authored-by/i.test(sh('git', ['log', '--format=%B', `${base}..HEAD`]))) bad.push('a commit message has a Co-Authored-By trailer');
  const first = sh('git', ['log', '-1', '--format=%s']);
  if (n >= 1 && !/^((US|DE)\d+: |chore: )/.test(first)) bad.push(`commit title "${first}" must start with US1234: , DE123: or chore: `);
  report('git: branch name, one commit, title, no co-author', bad.length === 0, bad.join('\n'));
}

if (steps.includes('reports')) {
  // Reports and tool output never go in a commit.
  const bad = changedFiles().filter((f) => /\.(pdf|html|out|prof)$|(^|\/)(test-data|gosec|changes|coverage|cover|report)[^/]*\.(json|diff|out|txt)$/i.test(f));
  report('no report or tool output in the change set', bad.length === 0, bad.join('\n'));
}

if (steps.includes('comments')) {
  // Code comments are 1-2 lines: no block of 3+ consecutive comment lines among added lines.
  const bad = [];
  for (const f of changedFiles().filter((x) => /\.(go|sql)$/.test(x) && fs.existsSync(x))) {
    const isSql = f.endsWith('.sql');
    const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const added = addedLines(f);
    const set = added === null ? null : new Set(added);
    let streak = 0;
    for (let i = 0; i < src.length; i++) {
      const isComment = isSql ? /^\s*--/.test(src[i]) : /^\s*\/\//.test(src[i]);
      if (isComment && (set === null || set.has(i + 1))) { streak++; if (streak === 3) bad.push(`${f}:${i - 1} comment block longer than 2 lines`); } else streak = 0;
    }
  }
  report('code comments are at most 2 lines', bad.length === 0, bad.join('\n'));
}

if (steps.includes('sql')) {
  // SQL lives in sql/ folders loaded by the SQLLoader: no SQL strings in added non-test Go lines.
  const bad = [];
  const kw = /"[^"]*\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i;
  for (const f of changedFiles().filter((x) => x.endsWith('.go') && !x.endsWith('_test.go') && fs.existsSync(x))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const added = addedLines(f);
    const set = added === null ? null : new Set(added);
    src.forEach((l, i) => { if ((set === null || set.has(i + 1)) && kw.test(l)) bad.push(`${f}:${i + 1} inline SQL: move it to a .sql file`); });
  }
  report('no inline SQL in added Go lines', bad.length === 0, bad.join('\n'));
}

if (steps.includes('build')) { const r = run('go', ['build', './...']); report('go build', r.status === 0, r.stderr); }
if (steps.includes('vet')) { const r = run('go', ['vet', '-tags', tags, './...']); report('go vet', r.status === 0, r.stderr); }
if (steps.includes('tidy')) {
  const before = run('git', ['status', '--porcelain', 'go.mod', 'go.sum']).stdout;
  run('go', ['mod', 'tidy']);
  const after = run('git', ['status', '--porcelain', 'go.mod', 'go.sum']).stdout;
  report('go mod tidy leaves go.mod/go.sum unchanged', before === after, before === after ? '' : 'go mod tidy changed go.mod or go.sum');
}
if (steps.includes('lint')) {
  const r = run(goBin('golangci-lint'), ['run', '--default=none', '-E', 'errcheck,staticcheck,bodyclose,sqlclosecheck,rowserrcheck,noctx,contextcheck,nilerr,errorlint', `--build-tags=${tags}`, `--new-from-rev=${base}`, './...']);
  report('golangci-lint (bot linters, new code incl. tests)', r.status === 0, r.stdout + r.stderr);
}
if (steps.includes('gosec')) {
  const out = path.join(os.tmpdir(), `gosec-${process.pid}.json`);
  run(goBin('gosec'), ['-quiet', '-fmt=json', `-out=${out}`, '-tags', tags, './...']);
  const ch = changedLines();
  let hits = [];
  try { hits = JSON.parse(fs.readFileSync(out, 'utf8')).Issues.filter((i) => i.severity === 'HIGH' && onChanged(ch, rel(i.file), +String(i.line).split('-')[0])); } catch (e) { hits = [{ details: 'gosec produced no report', file: '', line: 0, rule_id: '' }]; }
  report('gosec: no HIGH finding on changed lines', hits.length === 0, hits.map((h) => `${h.rule_id} ${rel(h.file)}:${h.line} ${h.details}`).join('\n'));
}
if (steps.includes('nilaway')) {
  const mod = run('go', ['list', '-m']).stdout.trim();
  const r = run(goBin('nilaway'), [`-include-pkgs=${mod}`, './...']);
  const ch = changedLines();
  const hits = (r.stdout + r.stderr).split('\n').filter((l) => {
    const m = l.match(/^(?:.*?)([\w./\\:-]+\.go):(\d+):\d+: /);
    return m && onChanged(ch, rel(path.resolve(m[1])), +m[2]);
  });
  report('nilaway: no possible nil panic on changed lines', hits.length === 0, hits.join('\n'));
}
if (steps.includes('tests')) {
  const r = run('go', ['test', '-count=1', '-timeout', '900s', '-tags', tags, './...']);
  const bad = (r.stdout + r.stderr).split('\n').filter((l) => /^(FAIL|--- FAIL|panic:)/.test(l));
  report('go test ./... (every package, incl. test/ut)', r.status === 0, bad.join('\n'));
}
if (steps.includes('race')) {
  const pk = run('go', ['list', './...']).stdout.split('\n').filter(Boolean);
  const slow = pk.filter((p) => /\/test\/ut$/.test(p));
  const fast = pk.filter((p) => !/\/test\/ut$/.test(p));
  let r = run('go', ['test', '-race', '-count=3', '-shuffle=on', '-timeout', '900s', '-tags', tags, ...fast]);
  let bad = (r.stdout + r.stderr).split('\n').filter((l) => /^(FAIL|--- FAIL|panic:)|DATA RACE/.test(l));
  if (slow.length) { const r2 = run('go', ['test', '-race', '-count=1', '-shuffle=on', '-timeout', '900s', '-tags', tags, ...slow]); bad = bad.concat((r2.stdout + r2.stderr).split('\n').filter((l) => /^(FAIL|--- FAIL|panic:)|DATA RACE/.test(l))); r = { status: r.status || r2.status }; }
  report('go test -race -shuffle=on (test/ut once: it is slow under -race)', r.status === 0 && bad.length === 0, bad.join('\n'));
}
if (steps.includes('mutation')) {
  const r = cp.spawnSync('node', [path.join(__dirname, 'mutate.js'), base, tags], { env, encoding: 'utf8', maxBuffer: 1 << 29 });
  console.log(r.stdout);
  report('mutation: 80%+ of mutants on changed lines killed by same-package tests', r.status === 0, '');
}

console.log('\n' + results.map(([n, ok]) => `${ok ? 'PASS' : 'FAIL'}  ${n}`).join('\n'));
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
