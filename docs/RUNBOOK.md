# SnapTally Operational Runbook

This runbook documents the step-by-step procedures for provisioning, deploying, verifying, and maintaining SnapTally in production on Cloudflare Pages and Cloudflare D1.

---

## 1. Architecture Overview

SnapTally operates as a serverless edge application on Cloudflare:

- **Frontend Host**: Cloudflare Pages serving pre-rendered static assets from `./dist` (Astro static output, Tailwind CSS, DaisyUI, Alpine.js).
- **Edge Compute**: Cloudflare Pages Functions running on `workerd` isolates in `./functions/api/`.
- **Database**: Cloudflare D1 (serverless SQLite) bound to Pages Functions under the environment variable `DB`.
- **Authentication**: Pre-shared Bearer token stored in the client and validated against the secret environment variable `API_BEARER_TOKEN`.

---

## 2. Prerequisites

Before running deployment commands, ensure the following prerequisites are met:

1. **Toolchain**:
   - Node.js >= 22.18.0
   - pnpm >= 10.0.0
2. **Cloudflare Authentication**:
   Verify that Wrangler is authenticated against your Cloudflare account:
   ```bash
   pnpm wrangler whoami
   ```
   If not logged in, authenticate via:
   ```bash
   pnpm wrangler login
   ```
   Note your Cloudflare `Account ID` from the command output.

---

## 3. Remote Database Provisioning (Cloudflare D1)

SnapTally requires a production Cloudflare D1 database named `budget-db`.

### 3.1 Create Remote D1 Database

Execute the following command to create the remote database:

```bash
pnpm wrangler d1 create budget-db
```

Output example:
```text
Created database 'budget-db' with ID 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
```

### 3.2 Update Project Configuration

Copy the returned `database_id` into [wrangler.jsonc](../wrangler.jsonc), replacing the dummy placeholder:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "snaptally",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2026-09-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "budget-db",
      "database_id": "YOUR_ACTUAL_DATABASE_ID_HERE",
      "migrations_dir": "migrations"
    }
  ],
  "env": {
    "preview": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "budget-db-preview",
          "database_id": "YOUR_PREVIEW_DATABASE_ID_HERE",
          "migrations_dir": "migrations"
        }
      ]
    }
  }
}
```

### 3.3 Apply Migrations to Production D1

Apply the database schema migrations sequentially to the remote database:

```bash
pnpm wrangler d1 migrations apply budget-db --remote
```

Confirm that all migrations (`0000_init.sql`, `0001_expanded_schema.sql`, and `0002_multi_tenant_schema.sql`) report successful execution.

### 3.4 Verify Remote Schema and Seed Data

Verify that the `users`, `user_tokens`, and `transactions` tables exist, and that the default user was seeded:

```bash
pnpm wrangler d1 execute budget-db --remote --command "SELECT * FROM users;"
```

Expected output:
```text
┌─────────────┬──────────────┬─────────────────────┐
│ id          │ name         │ created_at          │
├─────────────┼──────────────┼─────────────────────┤
│ usr_default │ Default User │ 2026-10-01 00:00:00 │
└─────────────┴──────────────┴─────────────────────┘
```

---

## 4. Cloudflare Pages Setup and Configuration

### 4.1 Create Cloudflare Pages Project

Create the Pages project with `main` as the production branch:

```bash
pnpm wrangler pages project create snaptally --production-branch main
```

### 4.2 Configure Database Binding

Bind the production D1 database to the Pages project:

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** > **snaptally** > **Settings** > **Functions**.
3. Under **D1 Database Bindings**, click **Add binding**:
   - Variable name: `DB`
   - D1 database: `budget-db`
4. Click **Save**.

### 4.3 Configure Production Secrets

Set the pre-shared secret token for API authorization:

```bash
pnpm wrangler pages secret put API_BEARER_TOKEN --project-name snaptally
```
When prompted, enter a secure, randomly generated alphanumeric token (minimum 32 characters).

### 4.4 Custom Subdomain Configuration (tally.gordon-pn.com)

SnapTally is served in production on the custom subdomain `https://tally.gordon-pn.com`.

#### 1. Add Custom Domain to Cloudflare Pages Project

The recommended method is via the Cloudflare Dashboard to avoid storing credentials in shell history or process arguments:

1. Navigate to **Workers & Pages** > **snaptally** > **Custom domains**.
2. Click **Set up a custom domain**.
3. Enter `tally.gordon-pn.com` and click **Continue**.

Alternatively, when provisioning via the Cloudflare API, supply the API token through standard input to curl config rather than command-line arguments to prevent credential exposure in shell history or process tables:

```bash
printf "header = \"Authorization: Bearer %s\"\n" "$CLOUDFLARE_API_TOKEN" | curl --config - \
  --request POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/snaptally/domains" \
  --header "Content-Type: application/json" \
  --data '{"name": "tally.gordon-pn.com"}'
```

#### 2. Configure DNS CNAME Record

In the `gordon-pn.com` Cloudflare DNS zone, establish a proxied CNAME record pointing to the Pages project:

- **Type**: `CNAME`
- **Name**: `tally`
- **Target**: `snaptally-5wq.pages.dev`
- **Proxy Status**: Proxied (Orange cloud enabled)
- **TTL**: Auto

#### 3. SSL/TLS Provisioning and Always Use HTTPS Configuration

Cloudflare provisions an edge SSL/TLS certificate (Google Trust Services / Cloudflare Universal SSL) supporting TLS 1.3.

To prevent cleartext transmission of API bearer tokens over HTTP, explicitly enable **Always Use HTTPS** in Cloudflare zone settings:

1. In the Cloudflare Dashboard, open the `gordon-pn.com` zone.
2. Navigate to **SSL/TLS** > **Edge Certificates**.
3. Toggle **Always Use HTTPS** to **On**.

Alternatively, enable the setting via the Cloudflare API:

```bash
printf "header = \"Authorization: Bearer %s\"\n" "$CLOUDFLARE_API_TOKEN" | curl --config - \
  --request PATCH \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/settings/always_use_https" \
  --header "Content-Type: application/json" \
  --data '{"value": "on"}'
```

Verify domain resolution, certificate negotiation, and HTTPS redirection:

```bash
# Verify DNS CNAME resolution to Cloudflare edge IPs
dig tally.gordon-pn.com +short

# Verify TLS negotiation and HTTP/2 response
curl -svo /dev/null https://tally.gordon-pn.com 2>&1 | grep -E "SSL connection|HTTP/"

# Verify HTTP to HTTPS redirect
curl -sI http://tally.gordon-pn.com | grep -E "HTTP/|location:"
```

#### 4. Client Origin Isolation and Migration Considerations

Browser storage mechanisms (`localStorage`, `IndexedDB`, and Service Worker cache) are strictly isolated by origin (`scheme://host:port`):

- **Offline Outbox**: Transactions queued in IndexedDB on the previous Pages origin (`https://snaptally-5wq.pages.dev`) cannot be accessed by `https://tally.gordon-pn.com`. Operators and users should ensure the app is online on the previous origin so all queued transactions synchronize before migrating.
- **Client Authentication**: The `API_BEARER_TOKEN` stored in `localStorage` does not transfer across origins. When accessing `https://tally.gordon-pn.com` for the first time, open **Settings** (gear icon) and configure the API bearer token.
- **Old Origin Access**: If unsynced offline records remain on `https://snaptally-5wq.pages.dev`, users can navigate back to that origin to sync them.

---

## 5. Deployment Procedures

### 5.1 Manual Deployment via CLI

To build and deploy directly from your local terminal:

```bash
# 1. Build static assets
pnpm build

# 2. Deploy to Cloudflare Pages
pnpm wrangler pages deploy ./dist --project-name snaptally
```

The output will provide the production deployment URL (e.g. `https://snaptally-5wq.pages.dev`).

### 5.2 Automated CI/CD Deployment via GitHub Actions

To enable automated production deployments on merges to `main` and automated preview deployments with pull request comment links (for same-repository, non-Dependabot pull requests), configure a GitHub Actions deployment workflow.

#### Required Repository Secrets
In your GitHub repository settings under **Settings** > **Secrets and variables** > **Actions**, add:
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Account > Cloudflare Pages: Edit`, `Account > D1: Edit`, and `User > Memberships: Read` permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.

#### Workflow Definition (`.github/workflows/deploy.yml`)
```yaml
name: deploy

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: pages-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: false

jobs:
  deploy:
    name: runner / deploy
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      deployments: write
    if: |
      github.event_name == 'push' ||
      (github.event_name == 'pull_request' &&
       github.event.pull_request.head.repo.full_name == github.repository &&
       github.actor != 'dependabot[bot]')
    outputs:
      alias-url: ${{ steps.wrangler.outputs.pages-deployment-alias-url }}
      deployment-url: ${{ steps.wrangler.outputs.deployment-url }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Check Cloudflare credentials
        id: check-credentials
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: ./.github/scripts/check-cloudflare-credentials.sh

      - name: Setup pnpm
        if: steps.check-credentials.outputs.configured == 'true'
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node.js
        if: steps.check-credentials.outputs.configured == 'true'
        uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        if: steps.check-credentials.outputs.configured == 'true'
        run: pnpm install --frozen-lockfile

      - name: Build static assets
        if: steps.check-credentials.outputs.configured == 'true'
        run: pnpm build

      - name: Deploy to Cloudflare Pages
        id: wrangler
        if: steps.check-credentials.outputs.configured == 'true'
        uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd # v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy ./dist --project-name=snaptally --branch=${{ github.head_ref || github.ref_name }}
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}

  preview-comment:
    name: runner / preview-comment
    needs: deploy
    if: github.event_name == 'pull_request' && (needs.deploy.outputs.deployment-url != '' || needs.deploy.outputs.alias-url != '')
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Comment preview URL on pull request
        uses: actions/github-script@v8
        env:
          ALIAS_URL: ${{ needs.deploy.outputs.alias-url }}
          DEPLOYMENT_URL: ${{ needs.deploy.outputs.deployment-url }}
        with:
          script: |
            const { default: commentPreview } = await import('${{ github.workspace }}/.github/scripts/comment-preview.js');
            await commentPreview({ github, context });
```

### 5.3 Continuous Integration and Code Coverage

Pull requests and commits to `main` trigger automated unit tests and code coverage analysis via `.github/workflows/coverage.yml`.

#### Codecov Configuration and Secret
SnapTally uses Codecov to host visual coverage breakdowns and post line-by-line pull request diff analysis:

- Repository secret: `CODECOV_TOKEN` (configured under **Settings** > **Secrets and variables** > **Actions**). Obtain from the repository dashboard on [Codecov](https://app.codecov.io/).
- Workflow configuration: In `.github/workflows/coverage.yml`, `codecov/codecov-action@v5` uploads `coverage/lcov.info` with `fail_ci_if_error: false`.
- Threshold configuration: [codecov.yml](../codecov.yml) enforces an 80% coverage threshold matching `--test-coverage-lines=80`.

---

## 6. Post-Deployment Smoke Tests

Execute the following checks against your live production domain (`https://tally.gordon-pn.com`):

### 6.1 Unauthorized Request Rejection
```bash
curl -i --http2 https://tally.gordon-pn.com/api/transactions
```
- **Expected Status**: `HTTP/2 401 Unauthorized` (or `HTTP/1.1 401 Unauthorized`)
- **Expected Payload**: `{"error":"Unauthorized"}`

### 6.2 Authenticated Query Verification
Verify that an authenticated read request succeeds:
```bash
curl -i --http2 -H "Authorization: Bearer <YOUR_SECRET_TOKEN>" \
  https://tally.gordon-pn.com/api/transactions?limit=1
```
- **Expected Status**: `HTTP/2 200 OK` (or `HTTP/1.1 200 OK`)
- **Expected Payload**: `{"transactions":[...]}` (empty array `[]` on an empty database or array of recent transaction objects)

### 6.3 Authenticated Transaction Insertion and Cleanup
Use an explicit identifier (`id: "smoke-test-tx-01"`) so repeated runs do not accumulate unindexed records, and remove the test record afterward to avoid polluting production data:

```bash
# 1. Insert synthetic smoke test record
curl -i --http2 -X POST https://tally.gordon-pn.com/api/transactions \
  -H "Authorization: Bearer <YOUR_SECRET_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "smoke-test-tx-01",
    "date": "2026-10-01",
    "card": "Amex Gold",
    "parent_bucket": "Guilt-Free",
    "subcategory": "Coffee",
    "merchant": "George Howell",
    "gross_amount": 4.50,
    "reimbursement": 0.00
  }'
```
- **Expected Status**: `HTTP/2 201 Created` (or `HTTP/1.1 201 Created`)
- **Expected Payload**: `{"ok":true,"id":"smoke-test-tx-01"}`

```bash
# 2. Clean up synthetic record from production database
pnpm wrangler d1 execute budget-db --remote \
  --command "DELETE FROM transactions WHERE id = 'smoke-test-tx-01';"
```

### 6.4 Client PWA Verification
1. Open `https://tally.gordon-pn.com` in Safari on iOS or Chrome on Android.
2. In Safari, tap Share > **Add to Home Screen**.
3. Launch SnapTally from the home screen (verify standalone full-screen presentation without browser URL bars).
4. Tap the **Settings** gear icon in the header.
5. Paste your configured `API_BEARER_TOKEN` and save (required due to origin isolation when migrating from `snaptally-5wq.pages.dev`).
6. Verify the status indicator turns green.
7. Enter a test transaction using the ATM keypad and tap **Save Expense**.
8. Open the **Recent Transactions** feed to confirm the record was persisted.

---

## 7. Diagnostics and Troubleshooting

### 7.1 Real-Time Function Log Streaming
Stream live execution logs from Cloudflare Pages Functions:
```bash
pnpm wrangler pages deployment tail --project-name snaptally
```

### 7.2 Database Backups and Export
To export the complete remote database schema and data:
```bash
pnpm wrangler d1 export budget-db --remote --output ./backup.sql
```

### 7.3 Applying Future Migrations
When adding new migrations in `migrations/`:
1. Test locally: `pnpm db:migrate:local`
2. Test automated unit tests: `pnpm test`
3. Apply to production:
   ```bash
   pnpm wrangler d1 migrations apply budget-db --remote
   ```

### 7.4 Common Failure Modes

| Symptom | Root Cause | Remediation |
| :--- | :--- | :--- |
| `HTTP 401 Unauthorized` | Missing or mismatched Bearer token | Verify client token matches `API_BEARER_TOKEN` in Pages secret settings. |
| `HTTP 500` on database calls | Missing `DB` binding | Ensure Cloudflare Pages Functions settings have `DB` bound to `budget-db`. |
| Migration failed on `BEGIN` | Explicit transaction statements in D1 SQL | Remove manual `BEGIN TRANSACTION` and `COMMIT` statements; D1 manages batches automatically. |
| Keypad layout bouncing on iOS | Missing viewport meta tags | Ensure `Layout.astro` contains `viewport-fit=cover` and styling includes `overscroll-none`. |
| Custom domain returns HTTP 403 or CNAME error | CNAME target mismatch or missing DNS record | Ensure DNS CNAME for `tally.gordon-pn.com` points to `snaptally-5wq.pages.dev` with proxy enabled. |

---

## 8. Historical Google Sheets Backfill

`scripts/backfill.ts` ingests the exported `Budgeting - *.csv` sheets into D1. The CSV exports contain personal financial data and are never committed; place them in `data/sheets/` (gitignored). `Budgeting - General.csv` is an overview page and is skipped.
`just test` uses synthetic fixtures and requires no personal exports. `just typecheck` validates the API and backfill scripts and tests separately for their Cloudflare and Node.js environments.

### 8.1 Procedure

Always validate locally before touching production:

```bash
# 1. Parse and categorize every sheet without writing to D1
just backfill-dry-run

# 2. Ingest into the local D1 simulation
just db-migrate-local
just backfill-local
```

Only after the local results are reviewed and the source sheets are final, ingest into production:

```bash
node scripts/backfill.ts --remote
```

Additional flags: `--file <path>` ingests a single sheet, `--dir <path>` overrides the sheet directory, and `--user-id <id>` scopes rows to a tenant (defaults to `usr_default`).
Unknown flags, missing option values, and simultaneous `--local` and `--remote` targets are rejected. Explicit `--dry-run` prevents writes even when one target flag is present.
Missing input files or directories fail with a nonzero exit status. An existing empty directory reports zero transactions; unmatched files and the overview sheet are ignored during directory imports.

### 8.2 Ingestion Rules

- Amounts are stored in the currency recorded in the sheet (`USD` or `CAD`) without conversion.
- Zero-amount rows are spreadsheet formula anchors and are skipped.
- Invalid calendar dates, malformed decimal amounts, and amounts that round to zero are skipped.
- Unterminated CSV quotes stop the import before any database writes.
- Temporary SQL files are readable only by the current user and are removed after Wrangler succeeds or fails.
- Row IDs are deterministic hashes of the source file, row position, date, gross amount, and currency, so re-running an unchanged export inserts nothing new (`ON CONFLICT(id) DO NOTHING`). Editing a row's amount or date changes its ID. Inserting or deleting a nonempty row shifts the row positions of subsequent entries, producing new IDs on re-run. Before re-ingesting a modified sheet, roll back the backfilled entries for that tenant using section 8.4.
- `Salary.csv` entries above 1,000 map to `Income -> Salary`; smaller entries map to `Income -> Reimbursement`.

### 8.3 Verification Queries

Scope verification queries to the tenant (`user_id`) and card (`card`) specified during the import (defaulting to `usr_default` and `Historical`). Replace `--local` with `--remote` when verifying production:

```bash
# Verify record counts and date coverage (adjust user_id and card to match backfill options)
pnpm wrangler d1 execute budget-db --local \
  --command "SELECT count(*), min(date), max(date) FROM transactions WHERE user_id = 'usr_default' AND card = 'Historical';"

# Verify distribution across categories and currencies
pnpm wrangler d1 execute budget-db --local \
  --command "SELECT currency, parent_bucket, subcategory, count(*) FROM transactions WHERE user_id = 'usr_default' AND card = 'Historical' GROUP BY 1, 2, 3 ORDER BY 1, 2, 4 DESC;"
```

### 8.4 Rollback

Backfilled rows are scoped to the imported tenant (`user_id`) and default card `Historical` (unless `--default-card` was overridden). Always include both `user_id` and `card` in the deletion predicate to avoid deleting other tenants' data or live intake transactions:

```bash
# Roll back historical backfill for a specific tenant and card (replace --local with --remote if rolling back production)
pnpm wrangler d1 execute budget-db --local \
  --command "DELETE FROM transactions WHERE user_id = 'usr_default' AND card = 'Historical';"
```
