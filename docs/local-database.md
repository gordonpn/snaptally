# Local development database

All fixtures are synthetic, opt-in and local only. Never apply either seed SQL
file to production. There are no credentials or authentication tokens in them.
The helper accepts only `seed` or `reset`; remote/environment/path flags fail
before any filesystem changes or Wrangler invocation.

```sh
just db-seed-local
# Equivalent: node scripts/local-fixtures.mjs seed
pnpm build
pnpm wrangler pages dev ./dist --persist-to "$PWD/.wrangler/dev-fixtures"
```

Use the project's normal local bearer-token configuration to call
`GET /api/merchants`. Trader Joe's, George Howell and Whole Foods appear alongside
other demo merchants. Transactions span December 1999 and January 2000, including
multiple buckets, a reimbursement and a refund. Query January 2000 for monthly
views; fixtures deliberately do not move with the current date. Use page sizes
below eight to exercise pagination. Stable IDs and `ON CONFLICT DO NOTHING` make
repeated seeding safe. Existing fixture rows are preserved until a reset.

The helper first applies every migration, then `seeds/dev_seed.sql` and the
existing issue #104 `seeds/monthly_budgets_demo.sql`. Budget placeholders have
zero targets for January 2000. These values are synthetic examples, not spending
recommendations. Transaction and budget fixture timestamps are explicit and fixed; the migration's
existing default user retains its migration-created timestamp.

```sh
# Destructive only within the dedicated owned fixture directory:
just db-reset-local
```

### Stop-server policy, locking, and recovery

Stop any active fixture-backed local Pages server (`Ctrl-C` / `SIGTERM`) before
running `just db-seed-local` or `just db-reset-local`. `scripts/local-fixtures.mjs`
refuses both `seed` and `reset` if an active `wrangler pages dev` or `workerd`
process with this checkout's absolute `.wrangler/dev-fixtures` path is detected.
Use the absolute persistence path shown above. Relative process arguments cannot
identify a checkout reliably, so the guard ignores them rather than blocking
unrelated checkouts; the explicit stop-server requirement still applies.

The helper acquires an exclusive lock at `.wrangler/dev-fixtures.lock` before
inspecting or modifying fixture state, rejecting overlapping `seed` or `reset`
invocations before fixture state changes occur. Interrupted commands leave the
lock in place rather than racing to remove another command's replacement lock.
After confirming that all fixture commands and fixture-backed servers have
stopped, remove `.wrangler/dev-fixtures.lock` manually before retrying. Inspect
the lock's recorded `pid`, `command`, and `acquiredAt` fields to identify its
owner before recovery; unreadable metadata is not permission to remove a live
lock. This lock only coordinates
`scripts/local-fixtures.mjs` commands; it does not lock out unrelated SQLite
users (`sqlite3`, manual `wrangler d1 execute`, or a running Pages server), so
always stop the local server first.

Reset replaces only `.wrangler/dev-fixtures`, reapplies migrations, and restores
fixtures. The helper requires its ownership marker before touching a nonempty
directory and rejects symlink state or lock paths. It refuses unfamiliar state
instead of deleting it. Normal Wrangler state (`.wrangler/state`), E2E state,
and remote D1 are separate. Do not store valuable data in the disposable fixture
directory or manually change its marker.

Migrations, `seeds/dev_seed.sql`, and `seeds/monthly_budgets_demo.sql` run
inside a staging directory under `.wrangler/` and are swapped into
`.wrangler/dev-fixtures` only after every step succeeds. If the second seed
fails, the helper exits non-zero without reporting success,
discards the staging directory, and leaves `.wrangler/dev-fixtures` unchanged
(or absent on an initial seed). To recover from a failed run, interrupted swap,
or manually half-seeded database, stop any fixture-backed server and re-run
`just db-seed-local` (idempotent repair) or `just db-reset-local` (clean
rebuild). A forcibly terminated process can leave an owned staging or backup
directory; after manual lock recovery, the next command cleans owned temporary
state and restores an interrupted backup before reseeding. Unowned temporary
directories are preserved. Process scanning is a best-effort guard, not a
substitute for stopping every fixture-backed server and other SQLite user.

Use `--persist-to .wrangler/dev-fixtures` for manual local queries too; the
existing `db-list-local` recipe targets Wrangler's normal state instead.

Just uses the repository's hyphenated recipe convention: `db-seed-local` and
`db-reset-local` correspond to the issue's `db:seed:local`/`db:reset:local` names.

## SQL checks

`just db-lint` runs the same SQL checks included in `pnpm run lint`.
Node's built-in SQLite applies sorted migrations and seeds to an in-memory
database, then compiles all queries with `EXPLAIN QUERY PLAN` and bound null
parameters. No external database or SQL lint dependency is needed.

`scripts/sql-lint.json` declares scanned directories, uppercase statement-keyword
rules, and representative index probes. Functions and identifiers keep existing
SQLite conventions (for example `strftime`, `substr`, and the column `key`).
Comment/string contents are ignored. SELECT projections and INSERT statements
require explicit column lists; `COUNT(*)` is allowed. These small lexical rules
cover the project's unquoted identifiers; this is not a general SQL formatter.

Index probes protect tenant/date lookup, merchant lookup, and rate-limit expiry.
They do not require every query to use an index: aggregate autocomplete and
optional search filters may legitimately scan. Add workload-specific probes when
changing access patterns, and inspect query plans with realistic data before
claiming performance improvements. Lint cannot prove production performance.
