# Monthly category budget targets

Migration `0006_monthly_budgets_schema.sql` creates `monthly_budgets` without
inserting any financial targets or changing existing transactions. Apply it through
the existing D1 migration workflow. It can also be applied to an empty SQLite
schema because it has no dependencies on other tables.

Each target has a stable `id`, a calendar month in `YYYY-MM` format, a
`parent_bucket`, a `subcategory`, and a nonnegative finite `target_amount`.
Zero is a valid explicit target. The combination of month, bucket, and subcategory
is unique, so a category can have different targets in different months, and the
same subcategory name can belong to different buckets. The unique index begins
with `year_month` to support a monthly target lookup. `created_at` defaults to the
insertion timestamp.

The table follows the current single-user budgeting scope in issue #104. It does
not provide tenant isolation. Before enabling budgets for multiple users, add a
user association and include it in the uniqueness and query contracts.

## Local example targets

`seeds/monthly_budgets_demo.sql` is an optional local fixture with deterministic
IDs and a fixed January 2000 month. It provides one zero-value placeholder for
each of the four CSP analysis buckets: `Fixed Costs`, `Savings`, `Investments`,
and `Guilt-Free`. These are examples, not actual budgets or spending advice.
Rerunning the fixture leaves existing targets unchanged.

After applying migrations to the local database, load the fixture explicitly:

```sh
pnpm wrangler d1 migrations apply budget-db --local
pnpm wrangler d1 execute budget-db --local --file=seeds/monthly_budgets_demo.sql
```

Never run the demo seed against production. No deployment workflow or migration
loads it. To configure real budgets, choose the intended month and category
amounts explicitly; do not copy zero-value demo rows into an active month.

## Contracts for downstream analysis

- Targets use USD reporting amounts. This initial table has no currency dimension.
  Transactions retain their original USD or CAD currency. Aggregation in #42 must
  filter to USD or use an explicit, documented CAD-to-USD conversion before
  comparing spend with these targets. Never sum raw USD and CAD values together.
  Currency normalization remains part of #63.
- `src/config/budget-profile.ts` defines the four-bucket analysis profile, derived
  from intake. `toAnalysisCategory` maps `Savings -> Investments` transactions to
  `Investments -> Investments` without mutating stored rows. Other recognized
  spending categories retain their pair; Income and unknown categories return
  `null` and must be excluded or surfaced separately by analysis callers.
- Writers must call `isMonthlyBudgetTarget` before persisting real targets. It
  requires an analysis bucket/subcategory pair, an exact `YYYY-MM` month (01–12),
  and a finite nonnegative numeric USD `target_amount`. It rejects the intake
  alias `Savings -> Investments`; targets use `Investments -> Investments` so
  investments cannot have two target identities. SQL strings remain unconstrained
  for historical compatibility; this helper does not install API validation.
- `CSP_BENCHMARKS` supplies percentage ranges of net take-home pay: Fixed Costs
  50–60%, Investments 10% or more, Savings 5–10%, and Guilt-Free 20–35%.
  These are reference metadata, not actual configured budgets, and must not be
  inserted as dollar targets. `CATEGORY_CARD_PREFERENCES` has one entry per
  analysis category with `preferred_card: null` (no hint). Callers must supply
  the owner's actual preferences rather than assume a wallet.

```ts
import { isMonthlyBudgetTarget, toAnalysisCategory } from "../src/config/budget-profile.ts";

const category = toAnalysisCategory({ parent_bucket: "Savings", subcategory: "Investments" });
// category: { parent_bucket: "Investments", subcategory: "Investments" }
const target = { year_month: "2026-11", ...category, target_amount: 250 };
if (!isMonthlyBudgetTarget(target)) throw new Error("Invalid monthly budget target");
// Persist target with an application-generated ID through a parameterized writer.
```

- No budget CRUD API, pacing computation, alerts, FX conversion, or UI is included
  here. This schema is the foundation for #42, #44, and #36.
