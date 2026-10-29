# The pre-merge bot (dhaam-deployment `pre-merge/go/testreport`)

It runs on every PR and posts a report plus a Summary PDF ("Pre-merge check: FAILED/PASSED"). The PDF has
the checks table, an agentic review with numbered rejection reasons, "Missing test cases" (each with level,
input, expected output and target file), untested mutants, vulns, DB lines no DB test runs, and a
"How to reproduce locally" section.

Keep the PDF and any text taken from it out of the repo.

## Checks and what passes them

| Check | Fails when | Fix |
|---|---|---|
| go.mod tidy / verify | tidy changes files; checksum mismatch | `go mod tidy`; `go mod verify` |
| go vet | any vet error | fix |
| Tests | any test fails, **including pre-existing failures on the base** | fix in a separate PR first, or tell the user |
| Test input/output | a case in an added or changed test file lacks `input:`/`expected:`/`actual:` t.Logf lines | three Logf calls per case |
| Story end-to-end test | no passing acceptance/e2e test whose name contains the story id | `TestUS1234_...EndToEnd` with `//go:build acceptance` |
| Story coverage | an AC the repo implements has no test, or a test contradicts it | tag cases `AC-n`/`US-n`, expected values from the story |
| Database tests for changed SQL | a changed repository/SQL line runs in no test against `TEST_DATABASE_URL` | integration tests with a real DB |
| Table setup for tests | the bot can't build tables from schema/migrations | keep migrations numbered and runnable in order |
| Security issues in changed code | gosec high on changed lines (G115, G201/G202 SQL concat, G304, …) | fix the code |
| Secrets in commits | gitleaks finding | remove and rewrite the commit |
| Bug-finding linters (new code) | new errcheck/staticcheck/nilerr/… finding | fix |
| Story in PR title/branch | no `US####`/`DE###` (or `chore:`) | rename |
| Tests catch bugs (mutation) | < 80% of mutants in changed code killed by **same-package** tests | in-package tests |
| Concurrency | data race or order-dependent failure in `-race -count=5 -shuffle=on` | fix sharing |
| Benchmarks | ≥ 20% slower or more allocs vs base; near-zero time is flagged | real work in benchmarks |
| Code coverage, vulnerable deps, nil panics, licenses, speed | INFO, but listed as suggestions | fix anyway (user wants zero suggestions) |

## Blocker codes used in the agentic review

- **B2**: a "functional" test bypasses the real router/gRPC server. Only repositories may be faked.
- **B3**: no end-to-end/acceptance test for the story.
- **B4**: a test that proves nothing: `assert.True(t, true)`, placeholders, logging the case name as
  input, identical values that hide swapped arguments.
- **B5**: a changed test was weakened: lost nil-result or exact-error checks, loosened mock args, fewer
  enum/boundary values, or now checks only the last call.
- **B6**: a loop over cases without `t.Run`.
- **B7**: the assertion checks a fake's copy of production logic (SQL re-implemented in a fake, a copied
  merge function) instead of the real code.
- **B8**: a test asserts an outcome the story contradicts, or sets up no real conflict for the AC it claims.

## Lessons from US1122 / PR #86 (first run: 11 of 39 criteria, 0 of 19 mutants)

- Tests written from the code instead of the story asserted the wrong outcomes (duplicate rule, manager
  with no stores, store-vs-marketplace conflicts). Read the AC text first.
- All SQL behaviour was only tested through fakes, so the DB check failed and the agentic review rejected it (B7).
- All tests lived in `tests/`, so the mutation score was 0%. In-package tests took it to 186/186.
- 567 cases logged no input/expected/actual. `logsplit` + `logcheck` fixed that in one pass.
- Health benchmarks were empty loops, and health tests asserted `true`. Placeholder files the PR touches count too.
- `nilerr`, G115 (`int` → `int16` DTO fields) and a `nil, nil` return were flagged on changed lines.

## Lessons from US1122 / dh-catalog-service PR #105 (reports 1-3)

- **A touched file is judged whole.** Editing an old test (even only to add input/expected/actual logs) puts the
  entire file under B6 (hand-written `t.Run` blocks instead of a table) and M2 (no `t.Parallel`). Convert every
  test function the PR touches to a table with `t.Run` + `t.Parallel()` at both levels.
- **Every changed non-test line needs an in-package test that fails when the line is flipped.** New retry, undo,
  logging and wiring code added while fixing a review is itself mutated by the next run. Before pushing, walk each
  added line and name the test that kills `==`/`!=`, `<`/`<=`, `*`/`/`.
- **Make time and wiring testable instead of timing the test.** Inject the sleep (`sleep func(time.Duration)` field,
  nil means `time.Sleep`) and assert the exact durations (50ms, 100ms, none after the last attempt). Extract startup
  code in `di.go` into small functions (`initX(cfg, logger)`, `closeX`, `xOptions`) and test those directly; a test
  of the whole container needs real infrastructure and does not count.
- **Role gates on every write path.** A tax/price/status change that checks only store and tenant lets a customer
  (role 4) write. Test customer and unknown roles on every route that writes, and expect 403.
- **5xx bodies carry the generic localized message**, never the dependency's wording. Assert the generic message
  (`Something went wrong ...` / `Error interno del servidor`) and that the raw text is absent. A bot-suggested
  expected value can be wrong: run it, and assert what the code really does when that is the safer behaviour.
- **Never invent TC ids**, even in a quick table refactor. Unnumbered new cases get `[TCNEWnn]`, continuing after the
  highest placeholder in use, and are listed for the user.
- **NilAway on test helpers:** a helper that can return nil (`needDB`) makes every caller flagged. Return the value
  and guard it at the call site (`if db == nil { return }`).
- **Dependencies:** after each bump read the advisory's fixed version, not just "latest at the time"; `go get
  module@fixed` then `go mod tidy`. Modules pinned back because they need a shared-repo update are reported to the
  user, never silently left.
- **The feature needs an acceptance criterion in Rally before the PR.** With none, the bot reports "0 criteria
  tested", the e2e test "does not validate the story", and every tax/charge criterion as other-repo (B11). Tag
  tests with the real `US-n`, and put `[this-pr] US-n` and `[other-repo: <repo>] AC-n` tags in the PR description.
  Drafting the criterion is allowed; saving it in Rally only with the user's go-ahead.
- **Mutation "lived" can be bot noise.** Flip the line by hand and run the package test: if it fails, add a stricter
  dedicated test (exact error type/message, call counts, `AssertNotCalled`) and note the doubt to the user.
- **Each push re-reviews all changed lines**, so fix the whole previous report, then self-review the new lines
  against this file before pushing. Items that cannot be fixed in code (missing criterion, other repos, numbering
  deployed migrations, repo-wide nil panics, coverage) are listed for the user, never hidden.

## Lessons from US1122 / dh-user-profile PR #229 (reports 1-2)

- **The whole repo's tests count, old folders too.** The Tests check runs `go test ./...`, so a stale test in `test/ut`
  that already fails on the base blocks the PR. Run every package (`./app/... ./tests/... ./test/...`) before pushing,
  fix stale fakes/fixtures (e.g. a fake that errors on the first call instead of the second), and tell the user when
  the fix is a production change (here the OTP signup-to-login conversion that another commit had dropped).
- **A case tag is a claim (B8).** `AC-n` only when the assertions check that criterion's text. Page size, bind
  errors, error masking, SQL escaping and parser tests get the sub-story tag (`US-5`, `US-12`) or no tag. A name that
  says "outlet user" or "merchant" must call the code with that role, otherwise rename it to what it does.
- **Never change an old test's input to make it pass (B5).** Keep the input, then either fix the code to honour the
  name (here: an outlet-role account with no outlet gets 403) or rename the test to the behaviour that is now true and
  add a separate test for the old claim. A removed fallback is stated in the PR description.
- **Every test function a PR touches needs input/expected/actual logs**, even when only a fixture line changed, and
  its subtests need `t.Parallel()` (M2). Grep `git diff` for changed `func Test` bodies before pushing.
- **Unit tests must not check a fake's behaviour (B7).** Ordering, search, paging, concurrency and counts belong in DB
  tests. A unit test over a fake asserts only what the usecase decides: the resolved store/role and the request it
  forwards. Move such cases to `tests/integrationTesting` and keep their TC ids (update the Rally precondition).
- **DB tests must reach every changed repository line**: each `case` of a search switch (email, phone, id, name), each
  fallback such as `actor = &ActorInfo{}`, each branch that builds a condition. Create tables from the repo's real
  migration (`sql/migrations/*.sql`, `migrations/*.sql`); the activity log's `entity_id` is a UUID.
- **Search text is literal.** Escape `\`, `%`, `_` before wrapping in `%...%` (`likePattern`), and test `50%`, `_`, `\`.
- **Count with `COUNT(DISTINCT id)`** when a LEFT JOIN can repeat rows; test a duplicated row.
- **Role matrix on every list endpoint:** admin, manager with assignments, manager with none (empty / 403), manager
  without `X-User-Id` (400), merchant (own store), outlet user (fixed to its parent store; an outlet-role account with no
  outlet gets 403/404), customer and agent (403). Apply it in the handler, with an in-package handler test.
- **Hide other tenants:** another tenant's resource answers exactly like an unknown one (404), except for managers.
- **Paging cases:** limit 1/2/3/5 over every page, and a list larger than the 200 cap (250 rows: 200 + 50).
- **Logs hold values, not pointers.** Marshal requests with a `show(v)` JSON helper so `Filters:0xc000...` and `*int64`
  never appear; a body with `"7"` must print as a string. No temp-dir names or random ids in `input:`.
- **NilAway on a global test DB:** guard the receiver in the helper (`if t == nil || t.DB == nil { panic(...) }`).
- **Production lines changed to fix a base failure still need an in-package test** (mutation counts them).
- **PR description tags (B11):** the bot asks for `[this-pr] AC-17, AC-18, ...` and `[other-repo: <repo>] AC-n` lines
  for every criterion. Write the text for the user to paste; do not edit the PR body without being asked.
- **Run the race check locally:** gcc lives in `C:\Users\dhaam\tools\winlibs\mingw64\bin`; prepend it to PATH and run
  `CGO_ENABLED=1 go test -race -count=5 -shuffle=on ./...`. The local `.env` `DATABASE_URL` works as
  `TEST_DATABASE_URL` (a throwaway database is created and dropped per run).
- **Keep Rally names equal to the code.** A renamed case needs a Rally rename in the same round; a deleted case is an
  orphan to list for the user; a changed outcome needs the TC's input/expected text updated.

## Checks seen in later reports (added automatically)

- **Bug-finding linters (new code)** fails on `nilerr` in production code (`return nil` while `err != nil`) and lists more
  in test code. Run the bot's `golangci-lint` command on every change (finalcheck.js `lint`); test code counts for new lines.
- **Mutation testing** runs only after every test passes; `scripts/mutate.js` (gremlins) reproduces it locally.
- **Reproduce commands in every report:** tests, test-data (changed tests without logs), concurrency
  (`-race -count=5 -shuffle=on`), benchmarks, db-tests (`test-db.sh up`, coverage), govulncheck, gosec, gitleaks,
  golangci-lint, nilaway, osv-scanner licenses. finalcheck.js runs the local ones; the rest are INFO.

## Lessons from US1122 / dh-user-profile PR #229 (mutation round, added automatically)

- **Mutation = same-package tests only.** A repository method tested only from `tests/` scores "NOT COVERED". Test it in
  its own package over a scripted fake driver (`database.NewFromSQLX` + a `database/sql/driver` connector that returns the
  rows or error the case scripts and records the SQL and args). Test services and handlers the same way with fake interfaces.
- **gremlins does not count `switch` case conditions as covered**: write `if` chains, so each condition sits in a covered block.
- **Equivalent mutants can never be killed** (`limit > cap` vs `>=` at exactly the cap, `offset < 0` vs `<= 0`): restructure with
  `min`/`max` instead of chasing them.
- **A mutant that times out can hide a hang**: run with `--timeout-coefficient 10` and treat TIMED OUT as not killed.
- **Same case text under two TC ids is a Rally collision**: name the layer in the text ("the store list SQL ...", "the outlet
  query refuses ...") so ids and texts stay unique; the `names` check finds them.
- **Rows scripted with `MaxOpenConns(1)`** make a leaked open rows set hang the next query: always close rows.
