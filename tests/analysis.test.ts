import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  handleGet as handleGetCategories,
  onRequestGet as onRequestGetCategories,
} from "../functions/api/analysis/categories.ts";
import {
  handleGet as handleGetMonthly,
  onRequestGet as onRequestGetMonthly,
} from "../functions/api/analysis/monthly.ts";
import {
  buildCategoryBreakdown,
  buildMonthlyAnalysis,
  type CategoryBreakdownResponse,
  getDaysRemainingInMonth,
  type MonthlyAnalysisResponse,
  roundCents,
} from "../functions/api/analysis-helpers.ts";
import { logger } from "../functions/api/logger.ts";
import insertTransactionQuery from "../queries/insert_transaction.sql";
import { createTestDatabase } from "./helpers/db.ts";

const VALID_TOKEN = "test-analysis-token";

function createD1Adapter() {
  const sqlite = createTestDatabase();
  const db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      let args: unknown[] = [];
      const prepared = {
        bind(...values: unknown[]) {
          args = values;
          return prepared;
        },
        async all() {
          return { results: stmt.all(...(args as [])) };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

function authRequest(url: string, token: string | undefined = VALID_TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  return new Request(url, { headers });
}

function insertTx(
  sqlite: ReturnType<typeof createTestDatabase>,
  tx: {
    id: string;
    date: string;
    card?: string;
    parent_bucket: string;
    subcategory: string;
    merchant?: string;
    gross_amount: number;
    reimbursement?: number;
    currency?: string;
  },
) {
  sqlite
    .prepare(insertTransactionQuery)
    .run(
      tx.id,
      tx.date,
      tx.card ?? "Amex Gold",
      tx.parent_bucket,
      tx.subcategory,
      tx.merchant ?? "Test Merchant",
      tx.gross_amount,
      tx.reimbursement ?? 0,
      tx.currency ?? "USD",
    );
}

function insertBudget(
  sqlite: ReturnType<typeof createTestDatabase>,
  budget: {
    id: string;
    year_month: string;
    parent_bucket: string;
    subcategory: string;
    target_amount: number;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO monthly_budgets (id, year_month, parent_bucket, subcategory, target_amount)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      budget.id,
      budget.year_month,
      budget.parent_bucket,
      budget.subcategory,
      budget.target_amount,
    );
}

describe("analysis auth and parameter validation", () => {
  it("rejects unauthenticated requests to monthly and categories endpoints with HTTP 401", async () => {
    let dbAccessed = false;
    const mockDb = {
      prepare() {
        dbAccessed = true;
        throw new Error("DB should not be accessed");
      },
    } as unknown as D1Database;

    for (const handler of [handleGetMonthly, handleGetCategories]) {
      const missingAuth = await handler(
        new Request("https://example.com/api/analysis/monthly"),
        mockDb,
        VALID_TOKEN,
      );
      assert.equal(missingAuth.status, 401);
      assert.deepEqual(await missingAuth.json(), { error: "Unauthorized" });

      const invalidAuth = await handler(
        authRequest("https://example.com/api/analysis/monthly", "wrong-token"),
        mockDb,
        VALID_TOKEN,
      );
      assert.equal(invalidAuth.status, 401);
      assert.deepEqual(await invalidAuth.json(), { error: "Unauthorized" });
    }
    assert.equal(dbAccessed, false);
  });

  it("rejects invalid month parameters with HTTP 400", async () => {
    const mockDb = {} as D1Database;
    for (const month of ["", "2026-00", "2026-13", "2026-9", "2026-09-01", "invalid"]) {
      const monthlyRes = await handleGetMonthly(
        authRequest(`https://example.com/api/analysis/monthly?month=${encodeURIComponent(month)}`),
        mockDb,
        VALID_TOKEN,
      );
      assert.equal(monthlyRes.status, 400, `monthly rejected ${month}`);

      const categoryRes = await handleGetCategories(
        authRequest(
          `https://example.com/api/analysis/categories?month=${encodeURIComponent(month)}&bucket=Guilt-Free`,
        ),
        mockDb,
        VALID_TOKEN,
      );
      assert.equal(categoryRes.status, 400, `categories rejected ${month}`);
    }
  });

  it("rejects missing or invalid bucket parameters on /api/analysis/categories with HTTP 400", async () => {
    const mockDb = {} as D1Database;
    const urls = [
      "https://example.com/api/analysis/categories?month=2026-09",
      "https://example.com/api/analysis/categories?month=2026-09&bucket=",
      "https://example.com/api/analysis/categories?month=2026-09&bucket=Income",
      "https://example.com/api/analysis/categories?month=2026-09&bucket=Unknown",
      "https://example.com/api/analysis/categories?month=2026-09&bucket=__proto__",
      "https://example.com/api/analysis/categories?month=2026-09&bucket=constructor",
    ];
    for (const url of urls) {
      const response = await handleGetCategories(authRequest(url), mockDb, VALID_TOKEN);
      assert.equal(response.status, 400, url);
    }
  });
});

describe("GET /api/analysis/monthly", () => {
  it("aggregates monthly net spend, maps Savings -> Investments, filters USD, and separates Income from unknown pairs", async () => {
    const { db, sqlite } = createD1Adapter();
    try {
      // Fixed Costs: Rent ($2000) + Groceries ($300) = $2300
      insertTx(sqlite, {
        id: "tx-rent",
        date: "2026-09-01",
        parent_bucket: "Fixed Costs",
        subcategory: "Rent",
        gross_amount: 2000,
      });
      insertTx(sqlite, {
        id: "tx-groceries",
        date: "2026-09-10",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        gross_amount: 300,
      });
      // Investments: stored as Savings -> Investments ($500) + Investments -> Investments ($250) = $750
      insertTx(sqlite, {
        id: "tx-savings-inv",
        date: "2026-09-05",
        parent_bucket: "Savings",
        subcategory: "Investments",
        gross_amount: 500,
      });
      insertTx(sqlite, {
        id: "tx-direct-inv",
        date: "2026-09-15",
        parent_bucket: "Investments",
        subcategory: "Investments",
        gross_amount: 250,
      });
      // Savings (non-Investments): Emergency Fund ($200)
      insertTx(sqlite, {
        id: "tx-emergency",
        date: "2026-09-08",
        parent_bucket: "Savings",
        subcategory: "Emergency Fund",
        gross_amount: 200,
      });
      // Guilt-Free: Dining $100 gross - $40 reimbursement = $60 net; Shopping credit -$10 = $50 total
      insertTx(sqlite, {
        id: "tx-dining-reimb",
        date: "2026-09-12",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 100,
        reimbursement: 40,
      });
      insertTx(sqlite, {
        id: "tx-shopping-credit",
        date: "2026-09-14",
        parent_bucket: "Guilt-Free",
        subcategory: "Shopping",
        gross_amount: -10,
      });
      // Income rows: excluded from CSP buckets, recorded in excluded_income
      insertTx(sqlite, {
        id: "tx-salary",
        date: "2026-09-01",
        parent_bucket: "Income",
        subcategory: "Salary",
        gross_amount: 6000,
      });
      insertTx(sqlite, {
        id: "tx-income-legacy",
        date: "2026-09-11",
        parent_bucket: "Income",
        subcategory: "Reimbursement",
        gross_amount: 120,
      });
      // Unknown historical category pair: surfaced separately, NOT treated as Income
      insertTx(sqlite, {
        id: "tx-unknown-hist",
        date: "2026-09-16",
        parent_bucket: "Variable",
        subcategory: "Coffee",
        gross_amount: 18.5,
      });
      // CAD transaction in same month: must be excluded from USD totals
      insertTx(sqlite, {
        id: "tx-cad",
        date: "2026-09-18",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 999,
        currency: "CAD",
      });
      // Adjacent month transactions: must be excluded
      insertTx(sqlite, {
        id: "tx-aug",
        date: "2026-08-31",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 500,
      });
      insertTx(sqlite, {
        id: "tx-oct",
        date: "2026-10-01",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 500,
      });

      // Budgets for 2026-09
      insertBudget(sqlite, {
        id: "b-rent",
        year_month: "2026-09",
        parent_bucket: "Fixed Costs",
        subcategory: "Rent",
        target_amount: 2000,
      });
      insertBudget(sqlite, {
        id: "b-groceries",
        year_month: "2026-09",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        target_amount: 500,
      });
      insertBudget(sqlite, {
        id: "b-inv",
        year_month: "2026-09",
        parent_bucket: "Investments",
        subcategory: "Investments",
        target_amount: 750,
      });
      insertBudget(sqlite, {
        id: "b-guilt-free",
        year_month: "2026-09",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        target_amount: 1000,
      });
      // Explicit zero target for Savings -> Emergency Fund
      insertBudget(sqlite, {
        id: "b-savings-zero",
        year_month: "2026-09",
        parent_bucket: "Savings",
        subcategory: "Emergency Fund",
        target_amount: 0,
      });
      // Out-of-taxonomy budget row ignored cleanly
      insertBudget(sqlite, {
        id: "b-unknown",
        year_month: "2026-09",
        parent_bucket: "Variable",
        subcategory: "Coffee",
        target_amount: 99,
      });

      const response = await handleGetMonthly(
        authRequest("https://example.com/api/analysis/monthly?month=2026-09"),
        db,
        VALID_TOKEN,
        new Date("2026-09-21T12:00:00Z"),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as MonthlyAnalysisResponse;

      assert.equal(body.month, "2026-09");
      assert.equal(body.currency, "USD");
      assert.equal(body.total_net_spend, 3300);
      assert.equal(body.total_target_amount, 4250);

      assert.deepEqual(body.buckets, [
        {
          parent_bucket: "Fixed Costs",
          net_spend: 2300,
          target_amount: 2500,
          variance: 200,
          utilization_percent: 92,
          transaction_count: 2,
        },
        {
          parent_bucket: "Investments",
          net_spend: 750,
          target_amount: 750,
          variance: 0,
          utilization_percent: 100,
          transaction_count: 2,
        },
        {
          parent_bucket: "Savings",
          net_spend: 200,
          target_amount: 0,
          variance: -200,
          utilization_percent: null,
          transaction_count: 1,
        },
        {
          parent_bucket: "Guilt-Free",
          net_spend: 50,
          target_amount: 1000,
          variance: 950,
          utilization_percent: 5,
          transaction_count: 2,
        },
      ]);

      assert.deepEqual(body.guilt_free_pacing, {
        target_amount: 1000,
        net_spend: 50,
        remaining_allowance: 950,
        days_in_month: 30,
        days_remaining: 10,
        daily_burn_rate: 95,
      });

      assert.deepEqual(body.excluded_income, {
        net_spend: 6120,
        transaction_count: 2,
      });

      assert.deepEqual(body.unrecognized_categories, [
        {
          parent_bucket: "Variable",
          subcategory: "Coffee",
          net_spend: 18.5,
          transaction_count: 1,
        },
      ]);

      // Verify stored Savings -> Investments transaction row was never mutated in D1
      const storedRow = sqlite
        .prepare("SELECT parent_bucket, subcategory FROM transactions WHERE id = ?")
        .get("tx-savings-inv") as { parent_bucket: string; subcategory: string };
      assert.deepEqual({ ...storedRow }, { parent_bucket: "Savings", subcategory: "Investments" });
    } finally {
      sqlite.close();
    }
  });

  it("defaults omitted month to current UTC month and handles empty months cleanly", async () => {
    const { db, sqlite } = createD1Adapter();
    try {
      const response = await handleGetMonthly(
        authRequest("https://example.com/api/analysis/monthly"),
        db,
        VALID_TOKEN,
        new Date("2026-10-01T00:00:00Z"),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as MonthlyAnalysisResponse;
      assert.equal(body.month, "2026-10");
      assert.equal(body.total_net_spend, 0);
      assert.equal(body.total_target_amount, 0);
      assert.deepEqual(body.excluded_income, { net_spend: 0, transaction_count: 0 });
      assert.deepEqual(body.unrecognized_categories, []);
      assert.deepEqual(body.guilt_free_pacing, {
        target_amount: 0,
        net_spend: 0,
        remaining_allowance: 0,
        days_in_month: 31,
        days_remaining: 31,
        daily_burn_rate: 0,
      });
      for (const bucket of body.buckets) {
        assert.equal(bucket.net_spend, 0);
        assert.equal(bucket.target_amount, 0);
        assert.equal(bucket.variance, 0);
        assert.equal(bucket.utilization_percent, null);
        assert.equal(bucket.transaction_count, 0);
      }
    } finally {
      sqlite.close();
    }
  });

  it("computes daily guilt-free allowance across month boundaries, leap years, and elapsed months", async () => {
    const { db, sqlite } = createD1Adapter();
    try {
      insertBudget(sqlite, {
        id: "b-sep-gf",
        year_month: "2026-09",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        target_amount: 1000,
      });
      insertTx(sqlite, {
        id: "tx-sep-gf",
        date: "2026-09-10",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 400,
      });

      // Active month with 10 days remaining: (1000 - 400) / 10 = 60.00
      const activeRes = await handleGetMonthly(
        authRequest("https://example.com/api/analysis/monthly?month=2026-09"),
        db,
        VALID_TOKEN,
        new Date("2026-09-21T23:59:59Z"),
      );
      const activeBody = (await activeRes.json()) as MonthlyAnalysisResponse;
      assert.deepEqual(activeBody.guilt_free_pacing, {
        target_amount: 1000,
        net_spend: 400,
        remaining_allowance: 600,
        days_in_month: 30,
        days_remaining: 10,
        daily_burn_rate: 60,
      });

      // Last day of month: 1 day remaining
      const lastDayRes = await handleGetMonthly(
        authRequest("https://example.com/api/analysis/monthly?month=2026-09"),
        db,
        VALID_TOKEN,
        new Date("2026-09-30T23:59:59Z"),
      );
      const lastDayBody = (await lastDayRes.json()) as MonthlyAnalysisResponse;
      assert.equal(lastDayBody.guilt_free_pacing.days_remaining, 1);
      assert.equal(lastDayBody.guilt_free_pacing.daily_burn_rate, 600);

      // Elapsed past month: no remaining days means no daily rate.
      const elapsedRes = await handleGetMonthly(
        authRequest("https://example.com/api/analysis/monthly?month=2026-09"),
        db,
        VALID_TOKEN,
        new Date("2026-10-01T00:00:00Z"),
      );
      const elapsedBody = (await elapsedRes.json()) as MonthlyAnalysisResponse;
      assert.equal(elapsedBody.guilt_free_pacing.days_remaining, 0);
      assert.equal(elapsedBody.guilt_free_pacing.daily_burn_rate, null);

      // Leap year February and year rollover future month
      assert.deepEqual(getDaysRemainingInMonth("0000-02", new Date("2026-11-26T00:00:00Z")), {
        daysInMonth: 29,
        daysRemaining: 0,
      });
      assert.deepEqual(getDaysRemainingInMonth("2024-02", new Date("2024-02-28T00:00:00Z")), {
        daysInMonth: 29,
        daysRemaining: 2,
      });
      assert.deepEqual(getDaysRemainingInMonth("2025-02", new Date("2025-02-01T00:00:00Z")), {
        daysInMonth: 28,
        daysRemaining: 28,
      });
      assert.deepEqual(getDaysRemainingInMonth("2027-01", new Date("2026-12-20T00:00:00Z")), {
        daysInMonth: 31,
        daysRemaining: 31,
      });
    } finally {
      sqlite.close();
    }
  });
});

describe("GET /api/analysis/categories", () => {
  it("returns subcategory breakdown with targets, excludes Savings -> Investments from Savings, and maps it to Investments", async () => {
    const { db, sqlite } = createD1Adapter();
    try {
      insertTx(sqlite, {
        id: "tx-dining",
        date: "2026-09-05",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 150,
        reimbursement: 30,
      });
      insertTx(sqlite, {
        id: "tx-coffee",
        date: "2026-09-06",
        parent_bucket: "Guilt-Free",
        subcategory: "Coffee & Snacks",
        gross_amount: 25,
      });
      // Unrecognized Guilt-Free legacy subcategory
      insertTx(sqlite, {
        id: "tx-legacy-coffee",
        date: "2026-09-07",
        parent_bucket: "Guilt-Free",
        subcategory: "Coffee",
        gross_amount: 12,
      });
      // CAD row in Guilt-Free excluded
      insertTx(sqlite, {
        id: "tx-gf-cad",
        date: "2026-09-08",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        gross_amount: 200,
        currency: "CAD",
      });
      // Savings -> Investments & Savings -> Emergency Fund
      insertTx(sqlite, {
        id: "tx-sav-inv",
        date: "2026-09-09",
        parent_bucket: "Savings",
        subcategory: "Investments",
        gross_amount: 400,
      });
      insertTx(sqlite, {
        id: "tx-inv-direct",
        date: "2026-09-10",
        parent_bucket: "Investments",
        subcategory: "Investments",
        gross_amount: 100,
      });
      insertTx(sqlite, {
        id: "tx-sav-emerg",
        date: "2026-09-11",
        parent_bucket: "Savings",
        subcategory: "Emergency Fund",
        gross_amount: 300,
      });

      // Budgets including a subcategory with 0 spend (Takeout)
      insertBudget(sqlite, {
        id: "b-dining",
        year_month: "2026-09",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        target_amount: 200,
      });
      insertBudget(sqlite, {
        id: "b-takeout",
        year_month: "2026-09",
        parent_bucket: "Guilt-Free",
        subcategory: "Takeout",
        target_amount: 100,
      });
      insertBudget(sqlite, {
        id: "b-inv",
        year_month: "2026-09",
        parent_bucket: "Investments",
        subcategory: "Investments",
        target_amount: 1000,
      });

      const gfRes = await handleGetCategories(
        authRequest("https://example.com/api/analysis/categories?month=2026-09&bucket=Guilt-Free"),
        db,
        VALID_TOKEN,
      );
      assert.equal(gfRes.status, 200);
      const gfBody = (await gfRes.json()) as CategoryBreakdownResponse;
      assert.equal(gfBody.bucket, "Guilt-Free");
      assert.equal(gfBody.net_spend, 145);
      assert.equal(gfBody.target_amount, 300);
      assert.equal(gfBody.variance, 155);
      assert.equal(gfBody.utilization_percent, 48.33);
      assert.equal(gfBody.transaction_count, 2);
      assert.deepEqual(gfBody.categories, [
        {
          parent_bucket: "Guilt-Free",
          subcategory: "Dining",
          net_spend: 120,
          target_amount: 200,
          variance: 80,
          utilization_percent: 60,
          transaction_count: 1,
        },
        {
          parent_bucket: "Guilt-Free",
          subcategory: "Coffee & Snacks",
          net_spend: 25,
          target_amount: 0,
          variance: -25,
          utilization_percent: null,
          transaction_count: 1,
        },
        {
          parent_bucket: "Guilt-Free",
          subcategory: "Takeout",
          net_spend: 0,
          target_amount: 100,
          variance: 100,
          utilization_percent: 0,
          transaction_count: 0,
        },
      ]);
      assert.deepEqual(gfBody.unrecognized_categories, [
        {
          parent_bucket: "Guilt-Free",
          subcategory: "Coffee",
          net_spend: 12,
          transaction_count: 1,
        },
      ]);

      // Investments merges Savings -> Investments and Investments -> Investments
      const invRes = await handleGetCategories(
        authRequest("https://example.com/api/analysis/categories?month=2026-09&bucket=Investments"),
        db,
        VALID_TOKEN,
      );
      assert.equal(invRes.status, 200);
      const invBody = (await invRes.json()) as CategoryBreakdownResponse;
      assert.equal(invBody.net_spend, 500);
      assert.equal(invBody.target_amount, 1000);
      assert.equal(invBody.utilization_percent, 50);
      assert.deepEqual(invBody.categories, [
        {
          parent_bucket: "Investments",
          subcategory: "Investments",
          net_spend: 500,
          target_amount: 1000,
          variance: 500,
          utilization_percent: 50,
          transaction_count: 2,
        },
      ]);

      // Savings excludes Savings -> Investments
      const savRes = await handleGetCategories(
        authRequest("https://example.com/api/analysis/categories?month=2026-09&bucket=Savings"),
        db,
        VALID_TOKEN,
      );
      assert.equal(savRes.status, 200);
      const savBody = (await savRes.json()) as CategoryBreakdownResponse;
      assert.equal(savBody.net_spend, 300);
      assert.deepEqual(savBody.categories, [
        {
          parent_bucket: "Savings",
          subcategory: "Emergency Fund",
          net_spend: 300,
          target_amount: 0,
          variance: -300,
          utilization_percent: null,
          transaction_count: 1,
        },
      ]);
    } finally {
      sqlite.close();
    }
  });
});

describe("analysis helpers, null DB results, entrypoints, and error handling", () => {
  it("merges duplicate unrecognized rows and rounds negative/zero currency cleanly", () => {
    assert.equal(roundCents(-0.001), 0);
    assert.equal(roundCents(-12.345), -12.35);

    const monthly = buildMonthlyAnalysis({
      month: "2026-09",
      transactionRows: [
        { parent_bucket: "Legacy", subcategory: "Misc", net_spend: 10.1, transaction_count: 1 },
        { parent_bucket: "Legacy", subcategory: "Misc", net_spend: 20.2, transaction_count: 2 },
      ],
      budgetRows: [],
      now: new Date("2026-09-21T00:00:00Z"),
    });
    assert.deepEqual(monthly.unrecognized_categories, [
      { parent_bucket: "Legacy", subcategory: "Misc", net_spend: 30.3, transaction_count: 3 },
    ]);

    const breakdown = buildCategoryBreakdown({
      month: "2026-09",
      bucket: "Fixed Costs",
      transactionRows: [
        { parent_bucket: "Income", subcategory: "Salary", net_spend: 1000, transaction_count: 1 },
        {
          parent_bucket: "Fixed Costs",
          subcategory: "Rent",
          net_spend: 1200,
          transaction_count: 1,
        },
      ],
      budgetRows: [],
    });
    assert.equal(breakdown.net_spend, 1200);
    assert.equal(breakdown.categories.length, 1);
  });

  it("handles null D1 result sets and delegates via onRequestGet entrypoints", async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return { results: null };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const monthlyRes = await onRequestGetMonthly({
      request: authRequest("https://example.com/api/analysis/monthly?month=2026-09"),
      env: { DB: mockDb, API_BEARER_TOKEN: VALID_TOKEN },
    } as unknown as Parameters<typeof onRequestGetMonthly>[0]);
    assert.equal(monthlyRes.status, 200);
    const monthlyBody = (await monthlyRes.json()) as MonthlyAnalysisResponse;
    assert.equal(monthlyBody.total_net_spend, 0);

    const catRes = await onRequestGetCategories({
      request: authRequest(
        "https://example.com/api/analysis/categories?month=2026-09&bucket=Savings",
      ),
      env: { DB: mockDb, API_BEARER_TOKEN: VALID_TOKEN },
    } as unknown as Parameters<typeof onRequestGetCategories>[0]);
    assert.equal(catRes.status, 200);
    const catBody = (await catRes.json()) as CategoryBreakdownResponse;
    assert.deepEqual(catBody.categories, []);
  });

  it("returns HTTP 500 when D1 queries fail", async () => {
    const errorSpy = mock.method(logger, "error", () => {});
    const failingDb = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                throw new Error("D1 unavailable");
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    try {
      const monthlyRes = await handleGetMonthly(
        authRequest("https://example.com/api/analysis/monthly?month=2026-09"),
        failingDb,
        VALID_TOKEN,
      );
      assert.equal(monthlyRes.status, 500);
      assert.deepEqual(await monthlyRes.json(), {
        error: "Database error during monthly analysis retrieval",
      });

      const catRes = await handleGetCategories(
        authRequest("https://example.com/api/analysis/categories?month=2026-09&bucket=Guilt-Free"),
        failingDb,
        VALID_TOKEN,
      );
      assert.equal(catRes.status, 500);
      assert.deepEqual(await catRes.json(), {
        error: "Database error during category breakdown retrieval",
      });
    } finally {
      errorSpy.mock.restore();
    }
  });
});
