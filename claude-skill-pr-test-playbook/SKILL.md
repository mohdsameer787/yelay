---
name: pr-test-playbook
description: Conventions for writing tests in dhaam Go services so the pre-merge bot (dhaam-deployment pre-merge check) passes in one go with no required or suggested items. Use every time you write, add, fix or change test cases (even a single test), when a pre-merge report/summary PDF failed, before pushing a PR, or when creating Rally test cases for tests. Covers naming with Rally ids, t.Logf input/expected/actual, test layers, database tests, mutation-proof tests, static-check rules, benchmarks, Rally TC creation, and the commit/push rules.
---

# PR test playbook (dhaam Go services)

Goal: the pre-merge check returns PASS with nothing required and nothing suggested. Apply every convention
below whenever tests are written or changed. Write tests and code that already satisfy the bot's checks, then **run the
local checks of section 13** (`scripts/finalcheck.js`) before every commit.

References: `reference/premerge-report.md` (what each bot check fails on, blocker codes B2–B8, lessons from
PR #86) and `reference/rally.md` (Rally TC conventions).

## 0. Before writing anything

1. Ask for the Rally ids (global CLAUDE.md): story `US####` or defect `DE###` for the branch and PR. Test
   case ids come from Rally. Write `[TCNEWnn]` placeholders until real TCs exist. Never invent ids.
2. Read the story's acceptance criteria (AC-n) and sub-stories (US-n). Expected values in tests must match
   the story text word for word: messages, status codes, which rule wins. A test that asserts the opposite of
   an AC is a blocker (B8). If the code disagrees with the story, ask the user which one to change, then save
   the decision to memory.
3. If a pre-merge report/summary PDF exists, fix **every** row in it: required, suggested and INFO,
   including "Missing test cases" (each gives level, input, expected output and target file), untested
   mutants, nil panics, vulnerabilities and slow benchmarks.
4. Work in the repo's worktree (`C:\teamcharlie\worktrees\<repo>`). Files are often CRLF, so prefer the
   Edit tool and check that each edit applied.

## 1. Naming

- Branch `feature/US1234-short-description` / `bugfix/DE123-...`; PR title `US1234: Short description`.
- Test function `TestUS1234_<What>` (flows `TestUS1234_Flow_...`, concurrency `TestUS1234_Concurrent...`,
  end-to-end `TestUS1234_...EndToEnd`).
- Case name `"[TC567] AC-12 manager assigned to store 100 may use it"`: the TC id, then the AC or US tag it
  proves, then the outcome in plain words. The bot maps criteria to tests through these tags.
- Case names must be unique in the repo and among the story's existing Rally TCs. Add the route, entity or
  layer to tell cases apart (e.g. "the charge service counts ...", "GET /charges/stats returns ...").
- Dynamic names (`"... "+itoa(v)`) are one TC. Prefer fixed names per case.
- **Tag only what the case asserts (B8).** `AC-n` when the assertions check that criterion; use the sub-story tag
  (`US-5`, `US-12`) for paging, bind errors, error masking and tenant rules, and no tag for parsers or helpers. A
  name that mentions a role must call the code with that role.

## 2. Every test case

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        got, err := svc.Do(ctx, tc.in)
        t.Logf("input: %s", testsupport.Show(tc.in))
        t.Logf("expected: status=%d err=%q", tc.wantStatus, tc.wantErr)
        t.Logf("actual: status=%d err=%v", got.Status, err)
        // assertions
    })
}
```

- **Three separate `t.Logf` calls** that start with `input:`, `expected:` and `actual:`. Never put all
  three in one call. Log the real call and data (method, route, headers, body, ids, rows seeded), never the
  case name. Log values, not pointers: use a JSON helper (`testsupport.Show(v)`) for structs and pointers,
  because `0xc000…` in output is a finding.
- Table loops always use `t.Run` (B6). Both levels call `t.Parallel()` unless the test shares state.
- **Every test function the PR touches gets the three logs and `t.Parallel()` in its subtests**, even if only a
  fixture line changed (grep the diff for changed `func Test` bodies, including `test/ut`). Requests are logged with a
  `show(v)` JSON helper, never `%+v` of a struct with pointers; no temp paths or random ids in `input:`.
- **Do not change an old test's input to make it pass (B5).** Fix the code to honour the name, or rename the test to
  what is now true and add a separate test for the old claim. Fix tests that already fail on the base (`go test ./...`
  must be green, including `test/ut`).
- B6 also fails a test that checks several cases one after another in one body (e.g. 4 requests in a single
  subtest). Make each a table row with its own `[TC]` name. Check every test in a touched file, even ones the
  story didn't change, because any test in the PR diff counts as changed.
- At least 5 scenarios per behaviour: happy path, boundary values, every error branch, permission denied,
  and tenant isolation where data is read.
- Use distinct values (tenant 1 vs 2, store 100 vs 200, rate 10 vs 18) so swapped arguments fail (B4).
- Error rows assert the **exact** error (`errors.Is` or the exact message) **and** a nil/zero result.
  Never use `assert.True(t, true)`, placeholders or empty tests, and that includes files the PR only
  touches (B4).
- Never weaken a changed test (B5). Keep exact errors, nil-result checks, strict mock args and every
  enum/boundary value. If an expectation must change, the new value must come from the story.
- Assert on production code, never on a fake's copy of it (B7). If a fake re-implements SQL or merge
  logic, move that case to a DB test or call the real function.
- A unit test over a fake asserts only what the usecase decides (resolved store/role, the forwarded request). Ordering,
  search, paging, counts and concurrency go to DB tests (B7).
- Mocks embed a nil interface so unexpected calls panic; no `mock.Anything` where the argument matters.
- Code comments 1–2 lines max, test banners included.

## 3. Layers and where they live

| Layer | Folder | Rule |
|---|---|---|
| Shared fakes, builders, rig, DB helper | `tests/testsupport` | deterministic data, fixed clock, goroutine-safe fakes |
| Unit | `tests/unitTesting/us1234_*_test.go` | one module, fakes at the edges |
| **In-package unit** | next to the code (`app/.../us1234_*_test.go`) | **required for the mutation score**: the bot counts only same-package tests |
| Functional | `tests/functionalTesting` | real router (echo) / real gRPC server (bufconn), only repositories faked (B2) |
| Database | `tests/integrationTesting` | real SQL on `TEST_DATABASE_URL` (section 4) |
| End-to-end / acceptance | `tests/endToEndTesting` with `//go:build acceptance` (or e2e) | real HTTP server; the test name contains the story id (B3) |
| Benchmarks | `tests/benchMarkTesting` | section 7 |

- Functional tests cover every new or changed route and gRPC method. That includes the permission check
  on each write (create, update, delete, assign, duplicate, exempt) and cross-tenant headers
  (`X-Tenant-Id: 2` sees nothing and changes nothing).
- gRPC behaviour (e.g. checkout `CalculateOrderTax`) is tested through the real gRPC handler → usecase →
  service chain, not by calling the service directly.
- Match the package name of existing test dirs (e.g. order-api uses `package tests`).
- dh-shared keeps tests in-package (bufconn fake server).

## 4. Database tests (required when the PR touches SQL or repository code)

The bot fails "Database tests for changed SQL" if any changed line under `app/repository/` or
`sql/**.sql` is not executed against a real Postgres. sqlmock and fake repos do not count.

- Setup, env var, running and troubleshooting: `reference/test-database.md`. Set `TEST_DATABASE_URL` before
  a local run, or every DB test skips.
- `tests/testsupport/testdb.go`: `OpenTestDB()` reads `TEST_DATABASE_URL`, returns `(nil, nil)` when it is
  unset, and otherwise creates a uniquely named database. It applies the repo's migrations **in production
  order**, plus small stub tables for schemas other services own (auth, user_settings, geo, profiles,
  orders). `Close()` drops the database.
- One `TestMain` per package opens it once. `needDB(t)` calls `t.Skipf` with a clear message when the URL
  is unset. CI always sets it.
- Each test builds its own "world": unique tenant/store/outlet ids from an `atomic.Int64` sequence, so
  `t.Parallel()` tests never see each other's rows. Include a second tenant for isolation checks.
- Cover every changed query and repository method: list and count (filters, search, sort, paging), tenant
  isolation, status toggles, duplicate checks, joins and conflict rules, exemptions, and id resolution.
- Error branches that need a failing DB (`DATABASE_ERROR "Failed to …"`) go **in-package** with a
  `*sql.DB` pointed at a closed port (e.g. `postgres://x@127.0.0.1:1/x?connect_timeout=1`). They count for
  mutation and need no Postgres.
- A new constraint comes with a migration, its rollback, and a pre-deploy check query in
  `migrations/DEPLOY_PRECONDITIONS.md` (e.g. find existing duplicates before adding a unique index).
- Search with LIKE: use `strpos(lower(col), lower($n)) > 0`, so `%`/`_` in user input are not wildcards.
  If the query builder only takes `col ILIKE $n`, escape the text instead (`\`, `%`, `_`) and test `50%`, `_` and `\`.
- Reach **every** changed line: each `case` of a search switch (email, phone, id, name), nil-guard fallbacks such as
  `actor = &ActorInfo{}` and each condition branch. Use `COUNT(DISTINCT id)` over joins that can repeat rows and test a
  duplicated row. Build tables from the repo's real migrations (`sql/migrations`, `migrations`).
- Local run: `TEST_DATABASE_URL` can be the `DATABASE_URL` from `.env`; race run needs gcc from
  `C:SERSDHAAM	OOLSWINLIBSMINGW64IN` ON PATH WITH `CGO_ENABLED=1`.
- SQL lives in `sql/<domain>/*.sql` loaded by the SQLLoader. No inline SQL in Go.

## 5. Mutation-proof tests ("Tests catch bugs", needs 80%; aim for 100%)

The bot mutates every changed non-test line (`==`↔`!=`, `<`↔`<=`, `+`↔`-`, removed conditions) and counts
only tests **in the same package**; tests under `tests/` don't count. For every changed handler, DTO,
domain, service, usecase and repository file, add in-package `us1234_*_test.go` cases that would fail if
any one of those operators flipped. That means testing both sides of every condition and every boundary
value exactly.

## 6. Code rules the static checks enforce (on changed lines)

- golangci (errcheck, staticcheck, bodyclose, sqlclosecheck, rowserrcheck, noctx, contextcheck, nilerr,
  errorlint): return the error (never `return nil` when `err != nil`), check every `Close`/`Rows.Err`, pass
  `ctx` through, and use `errors.Is/As`.
- gosec **G115** (integer overflow conversion): make DTO enum fields the target type (`int16`) instead of
  converting, or bound-check first.
- NilAway: guard every value that can be nil before dereferencing (`else if x != nil`). Never return
  `nil, nil` from a constructor or client call. Return an error.
- Vulnerable dependencies: upgrade modules whose vulnerable code is called (grpc, x/net, x/crypto, …). If an
  upgrade breaks a shared module (e.g. OTel log needs dh-shared), tell the user.
- No internal error text to clients: the default branch of error mapping returns the generic
  internal-server message, never SQL or driver text.
- Don't log whole query results or PII.
- Cap page sizes (`MaxPageSize = 100`) and clamp page/limit (`max(page,1)`).
- No secrets in commits. `go.mod`/`go.sum` stay tidy.

## 7. Benchmarks

- Benchmarks do real work through the real code (router, service, repo). Empty or near-zero loops are
  flagged.
- Use `b.ReportAllocs()`, `b.ResetTimer()` (or `for b.Loop()`), and check the result inside the loop.
- Add benchmarks for list/search queries the PR changes. A DB benchmark skips when `TEST_DATABASE_URL` is
  unset.
- The bot fails a benchmark 20% or more slower than base, or with 20% more allocations.

## 8. Concurrency

The bot runs `-race -count=5 -shuffle=on`. Shared fakes need a mutex, and tests must not depend on order or
on another test's rows.

## 9. Rally test cases

Follow `reference/rally.md`. New cases use `[TCNEWnn]` placeholders. Real TCs are created in Rally (via the
browser only when the user allows it), and the ids are then put into the code. Each TC's input and expected
result are the case's `input:` and `expected:` log text.

## 10. Commit and push

- One squashed commit per PR: `git commit --amend` + `git push --force-with-lease`. Short message
  (`US1234: Short description`), no Co-Authored-By. Commit and push only when the user says so.
- **Never commit reports or tool output** (test JSON, coverage, PDFs, payloads). Stage explicitly. Check
  `git diff --cached --name-only` for anything that is not code, SQL, migrations or go.mod/go.sum.
- Keep unrelated fixes out of the PR unless the user asks.
- Ask before committing or pushing in a repo other than the one in scope.
- Squashing a pushed branch means `git reset --soft` + recommit + `git push --force-with-lease`; the harness blocks
  history rewrites until the user says so in chat ("squash and force push"). Make a normal commit first, then ask.

## 11. Final checklist (review before calling the work done)

- [ ] every case has three Logf lines (input, expected, actual) with real data, no pointers
- [ ] every loop uses `t.Run`; `t.Parallel()`; at least 5 scenarios; distinct values
- [ ] every AC the repo implements has a test whose expected value matches the story text
- [ ] no existing test weakened; no assertion on a fake copy of production logic
- [ ] functional tests through the real router/gRPC for every changed route/method, including permission and tenant checks
- [ ] an e2e/acceptance test named with the story id
- [ ] DB tests cover every changed SQL file and repository method
- [ ] in-package tests cover both sides of every changed condition
- [ ] no nilerr, no unchecked errors, no unsafe int conversions, no nil derefs, no leaked SQL text
- [ ] benchmarks do real work
- [ ] case names unique; `[TCNEW…]` placeholders listed for the user, or real ids in place
- [ ] `go test ./...` is green in every package incl. `test/ut`; race run done locally
- [ ] case tags match what the case asserts; renamed/removed cases updated or listed for Rally
- [ ] role matrix on list endpoints (admin, manager with/without stores, merchant, outlet, customer); other tenant = 404
- [ ] PR description scope tags text handed to the user (`[this-pr]` / `[other-repo: x]`)
- [ ] one commit, no reports staged, short message, no co-author

Then tell the user what is left that only they can do: Rally TCs to create or close, and anything that
needs another repo.

## 12. Added after PR #105 (see reference/premerge-report.md, last section)

- [ ] every test function the PR touches is a table with `t.Run` + `t.Parallel()`
- [ ] every added non-test line (retries, undo, logging, wiring) has an in-package test that fails if it is flipped
- [ ] sleeps are injectable and asserted by value; `di.go` startup pieces are small tested functions
- [ ] every write route is tested for a customer/unknown role (403) and for a missing tenant header
- [ ] 5xx tests assert the generic localized message and the absence of dependency text
- [ ] no invented TC ids; placeholders continue from the highest `[TCNEWnn]`
- [ ] the story has a criterion for the feature, tests carry its `US-n`, the PR description carries scope tags

## 13. Final local checks (mandatory before every commit and at the end of any test work)

Run from the repo root, from the repo's own worktree, with the PR's base branch as the argument:

```
node ~/.claude/skills/pr-test-playbook/scripts/finalcheck.js origin/development
```

It runs the pre-merge bot's checks in the bot's own words and flags and prints PASS/FAIL per step:

| Step | What it is | Blocks the PR when |
|---|---|---|
| build, vet, tidy | `go build`, `go vet -tags acceptance,e2e`, `go mod tidy` leaves go.mod/go.sum unchanged | any error or diff |
| lint | `golangci-lint run --default=none -E errcheck,staticcheck,bodyclose,sqlclosecheck,rowserrcheck,noctx,contextcheck,nilerr,errorlint --build-tags=acceptance,e2e --new-from-rev=<base>` | any issue on new lines (**tests count too**; `nilerr` = returns nil while err != nil) |
| gosec | HIGH findings on changed lines | any |
| nilaway | possible nil panic on changed lines (the bot only reports it, fix anyway) | listed as a suggestion |
| tests | `go test ./...` in **every** package, including old folders like `test/ut` | any failure, even one that fails on the base |
| race | `-race -shuffle=on`, count 3 (test/ut once, it is ~160 s under -race) | data race, order dependence |
| mutation | `gremlins` (installed in `~/go/bin`) on the lines this branch changed, same-package tests only | under 80% of mutants killed (aim for 100%); survivors and uncovered lines are listed |

- `scripts/mutate.js` is the mutation step alone: `node ~/.claude/skills/pr-test-playbook/scripts/mutate.js origin/development`.
  Gremlins' own `-D <ref>` flag skips every mutant on Windows (path mismatch), so the script runs it per package and filters
  to the changed lines itself. A survivor means no same-package test fails when that line is flipped: add one in the package.
- Steps can be picked: `finalcheck.js origin/development lint,mutation`.
- Needs a Postgres for the DB tests: `TEST_DATABASE_URL` or the `.env` `DATABASE_URL`. The race run needs gcc
  (`~/tools/winlibs/mingw64/bin`, added to PATH by the script).
- Fix every FAIL before committing. Never commit on red. Report any FAIL that cannot be fixed in code to the user.
- Also walk section 11 (final checklist) and read the conventions in `reference/premerge-report.md` against the diff.

## 14. The playbook upgrades itself (automatic, every session)

Whenever a pre-merge summary or report (PDF or pasted text) is given in any session, before fixing anything:

1. Read every check row, blocker code (B-n, M-n), finding, "missing test" kind and reproduce command in it.
2. Compare each with this file and `reference/premerge-report.md`. If one is missing, add it now: the rule in
   `SKILL.md` or the lessons file, and a step in `scripts/finalcheck.js` when it can run locally (the report's
   "How to reproduce locally" section lists the exact commands).
3. Do this without being asked, and end the reply with a short list: "Added to the playbook: ..." (or "nothing new").
4. A report that is only an example (the user says it is not about this PR) still upgrades the playbook.

## 15. Gate before every commit, and the checks that came from memory

- **Before every commit run `node ~/.claude/skills/pr-test-playbook/scripts/precommit.js <base>`** (about a minute: build, vet,
  tidy, hygiene checks, bot linters, all tests). Fix every FAIL, then commit. `scripts/install-hook.js` installs it as a git
  pre-commit hook (opt-in, shared by the repo's worktrees). At the end of test work also run `finalcheck.js` in full.
- The hygiene checks in `finalcheck.js` encode the user's standing conventions, so they can not be forgotten:

| Step | Rule it enforces |
|---|---|
| `logs` | every case in an added/changed test logs `input:`, `expected:` and `actual:` (bot row "Test input/output") |
| `names` | `[TCnnnn]`/`[TCNEWnn]` ids and case texts are unique (same text under two ids collides in Rally); lists `TCNEW` placeholders for Rally |
| `commit` | branch `feature/US1234-...`, `bugfix/DE123-...` or `chore/...`; one commit on top of the base; title `US1234: ...`; no Co-Authored-By |
| `reports` | no PDF, html, coverage, gosec, test-data or diff output in the change set |
| `comments` | code and SQL comments are at most 2 lines |
| `sql` | no SQL strings in added Go lines: SQL lives in `sql/` files (named `@params` for conditions such as the manager scope) |
| `verify` | `go mod verify` (slow on Windows, a few minutes) |

- A new rule from the user or from a report becomes a step in `finalcheck.js` the same session (section 14).
