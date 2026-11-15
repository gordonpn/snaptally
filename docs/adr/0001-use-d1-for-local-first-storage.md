# ADR 0001: Use Cloudflare D1 for Local-First Storage and Edge Analytics

- Status: Accepted
- Date: 2026-09-25

## Context

SnapTally provides a personal finance intake and budgeting application designed for rapid point-of-sale logging. The core interaction requires sub-5-second checkout entry on mobile devices with an offline-first client queue.

The system requires a durable relational datastore that:
1. Integrates natively with Cloudflare Pages Functions edge runtime without external TCP network connection overhead.
2. Supports standard SQL with transactions, indexing, and parameterized queries for merchant autocomplete, budgeting, and spend aggregations.
3. Operates within free-tier or low-cost serverless resource limits without persistent container or virtual machine hosting costs.

Traditional external relational databases (e.g., hosted PostgreSQL or MySQL) introduce connection pool latency over external networks, requiring connection management proxies or specialized serverless database adapters.

## Decision

- Use Cloudflare D1 (serverless SQLite at the edge) as the primary relational system of record.
- Bind the database directly to Pages Functions execution context (`c.env.DB`), avoiding external network drivers and connection pooling overhead.
- Couple edge D1 storage with a client-side local outbox in native IndexedDB for optimistic local saves and resilient background sync during intermittent connectivity.
- Execute aggregation queries and monthly budget rollups directly in D1 SQL rather than transferring raw transaction logs to client browsers.

## Consequences

- Direct binding to Pages Functions eliminates external database connection latency and external credential management.
- Parameterized SQL execution runs directly within the Cloudflare edge network with high read throughput.
- D1’s free plan limits each database to 500 MB and allows 100,000 rows written per day; index updates can contribute additional rows written. Paid plans have higher database size limits. Monitor actual storage and row usage against the selected plan’s limits. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- Schema migrations must be managed through Wrangler migration files (`wrangler d1 migrations apply`).

## Reconsideration Triggers

- Reconsider D1 if transactional write volume exceeds daily edge limits.
- Reconsider D1 if required database features (such as advanced full-text search extensions or foreign table extensions) are unsupported by Cloudflare D1.
- Reconsider D1 if total storage requirements approach database plan ceilings.
