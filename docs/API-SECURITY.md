# API validation and throttling

`POST /api/transactions` reads at most 16,384 bytes before parsing JSON, including
requests with absent or inaccurate `Content-Length`. Oversized payloads return
413. ID, merchant, and card fields have raw string limits of 128, 200, and 100
characters. Category fields have 64-character limits and must match the intake
configuration. Currency is USD or CAD (case insensitive), defaulting to USD.
Gross amounts must be finite, nonzero, and at most 1,000,000 in magnitude.
Existing negative expense credits remain supported; negative Income is rejected.
Reimbursement is bounded by gross amount for expenses and must be zero for credits.

Explicit legacy queued categories remain accepted: `Income / Reimbursement` and
`Guilt-Free / Coffee`. No broad unknown-category allowance is added. Existing
historical database rows are not rewritten. GET searches cap raw input at 100 characters and the trimmed, escaped pattern at
48 UTF-8 bytes, reserving two bytes for SQL wildcards. Percent, underscore, and
backslash are treated literally. Bucket filters
are bounded to 64 characters without hiding historical categories from reads.

## Rate limits

Pages middleware protects transactions and merchants on every hostname, including
preview `pages.dev` URLs. All requests from one Cloudflare-provided IPv4 address or IPv6 /64 share
a 120-request fixed minute window; failed authentication has a stricter 20-request
window. The 21st failed authentication attempt and 121st overall request return
429 with `Retry-After`. A valid token can still be used after failed-auth throttling
provided the overall quota has not been exhausted. Clients sharing an IP share
limits. Do not use these limits as a replacement for edge DDoS or WAF protections.

Counters use atomic D1 UPSERT statements through the existing DB binding, rather
than the Workers rate-limit binding that the current Wrangler Pages configuration
does not support. Each request adds a cleanup and counter query to D1; failed auth
adds a second counter query. Counters contain minute-scoped SHA-256 client hashes,
never raw IP addresses or tokens. At most 10,000 counter keys are retained, cleanup
removes up to 100 expired keys per request, and saturation rejects new clients
with 429. The missing trusted-IP local development fallback shares one bucket.
Forwarded-for headers do not select a bucket.

D1 failures or missing migrations fail closed with 503 and `Retry-After: 60`.
Missing bearer-token configuration returns 500. Authentication logs include method,
pathname, and Cloudflare ray ID, excluding the query string and credentials.
The outbox honors server backoff for 429 and 503 with `Retry-After`, preserving the
server retry budget and queued records during throttling or guard outages. The
queue-wide deadline is persisted in localStorage (with an in-memory fallback) and
blocks automatic syncs and new entries until expiry. Explicit forced manual retries
can override it. Invalid or past HTTP dates fall back to 60 seconds.

## Deployment and recovery

Migration `0007_api_rate_limits.sql` must be applied before serving the new code.
The deploy workflow applies merged migrations to production and the separate
preview database only on main pushes. PR migrations are tested against a fresh
local database on every run, so edits to an existing filename are reapplied. PRs
that add, change, or remove migrations skip shared-database preview deployment
until merge. Abandoned PR migrations never reach the shared preview database. The migration
is additive and does not depend on the monthly budget schema migration.

For local development, apply migrations with `pnpm db:migrate:local` before
starting Pages. For a manual deployment, apply the appropriate database migrations
first (`wrangler d1 migrations apply budget-db --remote` for production, or
`wrangler d1 migrations apply budget-db-preview --remote --env preview` for preview).
No remote database changes are performed by tests.

If all API requests return 503 after deployment, inspect structured logs, restore
D1 availability, and verify migration 0007 exists in the deployment's bound DB.
Queued transactions remain pending. Do not disable the guard to mask schema errors.
Cloudflare Access on preview deployments remains an optional additional control
configured in the account dashboard, not a requirement of this application guard.

References:

- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/d1/sql-api/sql-statements/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
