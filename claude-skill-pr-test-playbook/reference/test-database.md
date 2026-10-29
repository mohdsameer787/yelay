# Test database setup guide (Go services)

Database tests run real SQL on a throwaway Postgres database. Without a reachable server they skip, so
a green local run proves nothing about the SQL until this is set up. CI always sets `TEST_DATABASE_URL`.

## 1. What you need

- A running Postgres (local 18 works) that your user can `CREATE DATABASE` on. The tests never touch the
  database in the URL: they create a uniquely named one next to it and drop it in `Close()`.
- `TEST_DATABASE_URL` pointing at the server, e.g. `postgres://user:pass@localhost:5432/postgres?sslmode=disable`.
  Use the `postgres` maintenance database, not the service's own database.

## 2. Where the URL comes from

`config.TestDatabaseURL()` reads `TEST_DATABASE_URL` from the environment, else from the module's `.env`.
Empty means the database tests are skipped.

Bash (derive it from the service's `.env` `DATABASE_URL`, swapping the database name for `postgres`):

```bash
u=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
export TEST_DATABASE_URL=$(echo "$u" | sed -E 's#/[a-zA-Z0-9_]+\?#/postgres?#')
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgres://user:pass@localhost:5432/postgres?sslmode=disable"
```

Never paste the URL, user or password into a report, commit, PR or chat.

## 3. What `OpenTestDB()` does

1. Returns `(nil, nil)` when the URL is unset, and `ErrDatabaseUnreachable` when the server does not
   answer within 10 s. Callers `t.Skipf` on both.
2. Creates a unique database, enables `pgcrypto`, and creates stub schemas and tables for what other
   services own (`auth.users`, `geo.outlets`, `orders.*`, `payments.*`, `user_settings.*`, `profiles.*`).
3. Applies the repo's migrations in production order (`taxMigrations` in `tests/testsupport/testdb.go`).
4. `Close()` drops the database. The bot checks that nothing is left behind, so never skip `Close()`.

One `TestMain` per package opens it once. Each test builds its own world with unique tenant, store and
outlet ids so `t.Parallel()` tests never see each other's rows.

## 4. Adding a migration or a stub table

- New migration: append its filename to `taxMigrations`, in production order, with its rollback and a
  pre-deploy check in `migrations/DEPLOY_PRECONDITIONS.md`.
- New table owned by another service: add a minimal `CREATE TABLE` (only the columns the SQL reads) to
  `foreignTables`. Do not copy the other service's whole schema.
- Never edit a stub to make a test pass. If the real SQL needs a column, add that column to the stub.

## 5. Running

```bash
go test -tags acceptance,e2e ./tests/integrationTesting/...        # database tests only
go test -tags acceptance,e2e ./...                                 # everything, as the bot does
```

Check that the database tests ran: `go test -v -run TestUS1234_DB ./tests/integrationTesting/ | grep -c SKIP`
must be `0`.

## 6. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| every DB test `SKIP` | URL unset or server down. Export `TEST_DATABASE_URL`, start Postgres. |
| `permission denied to create database` | Use a role with `CREATEDB`. |
| `relation ... does not exist` | A migration is missing from `taxMigrations`, or a foreign table is missing from `foreignTables`. |
| `database ... is being accessed by other users` on close | A pool was not closed. Close every `*sql.DB` before `Close()`. |
| leftover databases named like the test prefix | A run was killed. Drop them: `DROP DATABASE name;` on the maintenance database. |
| DB tests pass locally, bot says lines uncovered | The changed repository line has no test that executes it. Add one per changed query, error branches excepted. |
