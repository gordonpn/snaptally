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
  ]
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

The output will provide the production deployment URL (e.g. `https://snaptally.pages.dev`).

### 5.2 Automated CI/CD Deployment via GitHub Actions

To enable automated deployment on every commit merged into `main`, configure a GitHub Actions deployment workflow.

#### Required Repository Secrets
In your GitHub repository settings under **Settings** > **Secrets and variables** > **Actions**, add:
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Cloudflare Pages: Edit` and `D1: Edit` permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.

#### Workflow Definition (`.github/workflows/deploy.yml`)
```yaml
name: deploy

on:
  push:
    branches:
      - main

permissions:
  contents: read
  deployments: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build static assets
        run: pnpm build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy ./dist --project-name=snaptally
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

Execute the following checks against your live production domain (`https://snaptally.pages.dev`):

### 6.1 Unauthorized Request Rejection
```bash
curl -i https://snaptally.pages.dev/api/transactions
```
- **Expected Status**: `HTTP/1.1 401 Unauthorized`
- **Expected Payload**: `{"error":"Unauthorized"}`

### 6.2 Authenticated Query Verification
```bash
curl -i -H "Authorization: Bearer <YOUR_SECRET_TOKEN>" \
  https://snaptally.pages.dev/api/transactions?limit=1
```
- **Expected Status**: `HTTP/1.1 200 OK`
- **Expected Payload**: `{"transactions":[]}`

### 6.3 Authenticated Transaction Insertion
```bash
curl -i -X POST https://snaptally.pages.dev/api/transactions \
  -H "Authorization: Bearer <YOUR_SECRET_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-10-01",
    "card": "Amex Gold",
    "parent_bucket": "Guilt-Free",
    "subcategory": "Coffee",
    "merchant": "George Howell",
    "gross_amount": 4.50,
    "reimbursement": 0.00
  }'
```
- **Expected Status**: `HTTP/1.1 201 Created`
- **Expected Payload**: `{"ok":true,"id":"<UUID>"}`

### 6.4 Client PWA Verification
1. Open `https://snaptally.pages.dev` in Safari on iOS or Chrome on Android.
2. In Safari, tap Share > **Add to Home Screen**.
3. Launch SnapTally from the home screen (verify standalone full-screen presentation without browser URL bars).
4. Tap the **Settings** gear icon in the header.
5. Paste your configured `API_BEARER_TOKEN` and save.
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
| Keypad layout bouncing on iOS | Missing viewport meta tags | Ensure `Layout.astro` contains `viewport-fit=cover` and viewport styling `h-dvh overflow-hidden select-none`. |
