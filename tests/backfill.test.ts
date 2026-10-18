import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_ADAPTERS,
  bikeshareAdapter,
  bostonFoodAdapter,
  bostonHousingAdapter,
  canadaFoodAdapter,
  cleanAmount,
  cleanDate,
  datingAdapter,
  flightExpensesAdapter,
  hydroQcAdapter,
  mentalTherapyAdapter,
  montrealGasAdapter,
  rideHailAdapter,
  salaryAdapter,
  stuffAdapter,
  utilitiesAdapter,
} from "../scripts/backfill/adapters.ts";
import { parseCsv } from "../scripts/backfill/csv.ts";
import { generateDeterministicId } from "../scripts/backfill/idempotency.ts";
import { executeD1Batch, generateInsertSql, runBackfill } from "../scripts/backfill/pipeline.ts";
import type { BackfillOptions, BackfillTransaction } from "../scripts/backfill/types.ts";

describe("CSV Parser (parseCsv)", () => {
  it("parses simple unquoted comma-separated values", () => {
    const csv = "Date,Cost,Merchant\n2026-09-25,18.50,George Howell";
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      ["Date", "Cost", "Merchant"],
      ["2026-09-25", "18.50", "George Howell"],
    ]);
  });

  it("handles quoted fields containing embedded commas", () => {
    const csv = 'Date,Cost,Merchant\n2026-09-25,"1,250.00","Trader Joe\'s, Store #12"';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      ["Date", "Cost", "Merchant"],
      ["2026-09-25", "1,250.00", "Trader Joe's, Store #12"],
    ]);
  });

  it("handles escaped quotes within quoted fields", () => {
    const csv = 'Date,Cost,Merchant\n2026-09-25,10.00,"The ""Famous"" Cafe"';
    const result = parseCsv(csv);
    assert.deepStrictEqual(result, [
      ["Date", "Cost", "Merchant"],
      ["2026-09-25", "10.00", 'The "Famous" Cafe'],
    ]);
  });

  it("handles Windows CRLF and trailing empty lines gracefully", () => {
    const csv = "Date,Cost\r\n2026-09-25,10.00\r\n\r\n2026-09-26,20.00\r\n\r\n";
    const result = parseCsv(csv);
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result[1], ["2026-09-25", "10.00"]);
    assert.deepStrictEqual(result[2], ["2026-09-26", "20.00"]);
  });
});

describe("Helper Functions", () => {
  describe("cleanAmount", () => {
    it("parses standard positive numbers", () => {
      assert.strictEqual(cleanAmount("25.50"), 25.5);
      assert.strictEqual(cleanAmount("100"), 100);
      assert.strictEqual(cleanAmount("3.13"), 3.13);
    });

    it("strips dollar signs and commas", () => {
      assert.strictEqual(cleanAmount("$1,250.00"), 1250);
      assert.strictEqual(cleanAmount("$10.50"), 10.5);
    });

    it("parses negative amounts and accounting parentheses", () => {
      assert.strictEqual(cleanAmount("-7.00"), -7);
      assert.strictEqual(cleanAmount("(15.50)"), -15.5);
    });

    it("returns null for zero, empty, or non-finite values", () => {
      assert.strictEqual(cleanAmount("0.00"), null);
      assert.strictEqual(cleanAmount("0"), null);
      assert.strictEqual(cleanAmount(""), null);
      assert.strictEqual(cleanAmount(undefined), null);
      assert.strictEqual(cleanAmount("#N/A"), null);
      assert.strictEqual(cleanAmount("#DIV/0!"), null);
    });
  });

  describe("cleanDate", () => {
    it("accepts valid ISO YYYY-MM-DD dates", () => {
      assert.strictEqual(cleanDate("2026-09-25"), "2026-09-25");
      assert.strictEqual(cleanDate(" 2024-01-01 "), "2024-01-01");
    });

    it("rejects non-ISO dates, formulas, and text", () => {
      assert.strictEqual(cleanDate("09/25/2026"), null);
      assert.strictEqual(cleanDate("invalid"), null);
      assert.strictEqual(cleanDate(""), null);
      assert.strictEqual(cleanDate(undefined), null);
    });
  });

  describe("generateDeterministicId", () => {
    it("generates deterministic RFC 4122 v4 formatted UUIDs", () => {
      const id1 = generateDeterministicId("usr_default|2026-09-25|Amex|Uber|15.00|USD");
      const id2 = generateDeterministicId("usr_default|2026-09-25|Amex|Uber|15.00|USD");
      const id3 = generateDeterministicId("usr_default|2026-09-25|Amex|Lyft|15.00|USD");

      assert.strictEqual(id1, id2);
      assert.notStrictEqual(id1, id3);
      assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe("generateInsertSql", () => {
    it("escapes single quotes and produces valid SQL", () => {
      const tx: BackfillTransaction = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        userId: "usr_default",
        date: "2026-09-25",
        card: "Amex Gold",
        parentBucket: "Fixed Costs",
        subcategory: "Groceries",
        merchant: "Trader Joe's",
        grossAmount: 42.5,
        reimbursement: 0.0,
        currency: "USD",
        sourceFile: "Budgeting - Boston food expenses.csv",
        sourceRow: 5,
      };

      const sql = generateInsertSql(tx);
      assert.ok(sql.startsWith("INSERT INTO transactions"));
      assert.ok(sql.includes("'Trader Joe''s'"));
      assert.ok(sql.includes("42.50"));
      assert.ok(sql.includes("'USD'"));
      assert.ok(sql.endsWith("ON CONFLICT(id) DO NOTHING;"));
    });
  });
});

describe("Sheet Adapters", () => {
  const options: BackfillOptions = {
    userId: "usr_test",
    defaultCard: "Historical",
    dryRun: true,
    local: false,
    remote: false,
  };

  it("bikeshareAdapter: assigns Bluebikes, Fixed Costs, Transit, USD", () => {
    const rows = [
      ["Date", "Cost (US$)", "", "Average"],
      ["2024-08-02", "3.13", "", ""],
      ["2024-08-03", "0.00", "", ""], // Should be skipped
    ];
    const txs = bikeshareAdapter.parse(rows, "Budgeting - Bikeshare.csv", options);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].merchant, "Bluebikes");
    assert.strictEqual(txs[0].parentBucket, "Fixed Costs");
    assert.strictEqual(txs[0].subcategory, "Transit");
    assert.strictEqual(txs[0].grossAmount, 3.13);
    assert.strictEqual(txs[0].currency, "USD");
  });

  it("bostonFoodAdapter: normalizes merchants and categorizes dining vs groceries", () => {
    const rows = [
      ["Date", "Cost", "Merchant"],
      ["2024-06-20", "18.54", "Shake Shack"],
      ["2024-06-25", "15.44", "Stop & Shop"],
    ];
    const txs = bostonFoodAdapter.parse(rows, "Budgeting - Boston food expenses.csv", options);
    assert.strictEqual(txs.length, 2);

    assert.strictEqual(txs[0].merchant, "Shake Shack");
    assert.strictEqual(txs[0].parentBucket, "Guilt-Free");
    assert.strictEqual(txs[0].subcategory, "Takeout");
    assert.strictEqual(txs[0].currency, "USD");

    assert.strictEqual(txs[1].merchant, "Stop & Shop");
    assert.strictEqual(txs[1].parentBucket, "Fixed Costs");
    assert.strictEqual(txs[1].subcategory, "Groceries");
  });

  it("bostonHousingAdapter: parses USD vs CAD and sets Fixed Costs Rent", () => {
    const rows = [
      ["Check-in Date", "Check-out Date", "Nights", "Cost CAD", "Cost CAD/night", "Cost USD"],
      ["2024-06-20", "2024-06-21", "1", "128.11", "128.11", ""],
      ["2024-07-24", "2024-08-07", "14", "", "", "700.00"],
      ["2024-11-01", "2024-11-01", "0", "", "", ""], // Empty row should be skipped
    ];
    const txs = bostonHousingAdapter.parse(
      rows,
      "Budgeting - Boston housing expenses.csv",
      options,
    );
    assert.strictEqual(txs.length, 2);

    assert.strictEqual(txs[0].grossAmount, 128.11);
    assert.strictEqual(txs[0].currency, "CAD");
    assert.strictEqual(txs[0].subcategory, "Rent");

    assert.strictEqual(txs[1].grossAmount, 700.0);
    assert.strictEqual(txs[1].currency, "USD");
    assert.strictEqual(txs[1].subcategory, "Rent");
  });

  it("canadaFoodAdapter: preserves CAD currency without conversion", () => {
    const rows = [
      ["Dates", "Cost (CA$)", "Merchant"],
      ["2024-01-06", "2.29", "Adonis"],
    ];
    const txs = canadaFoodAdapter.parse(rows, "Budgeting - Canada food expenses.csv", options);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].currency, "CAD");
    assert.strictEqual(txs[0].parentBucket, "Fixed Costs");
    assert.strictEqual(txs[0].subcategory, "Groceries");
  });

  it("flightExpensesAdapter: sets Airlines, Savings, Travel Fund, CAD and skips 0", () => {
    const rows = [
      ["Flight Date", "Cost"],
      ["2024-07-03", "150.80"],
      ["2024-09-01", "0.00"], // Skipped
    ];
    const txs = flightExpensesAdapter.parse(rows, "Budgeting - Flight expenses.csv", options);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].merchant, "Airlines");
    assert.strictEqual(txs[0].parentBucket, "Savings");
    assert.strictEqual(txs[0].subcategory, "Travel Fund");
    assert.strictEqual(txs[0].currency, "CAD");
  });

  it("hydroQcAdapter: sets Hydro-Québec, Fixed Costs, Utilities, CAD", () => {
    const rows = [
      ["Date", "Cost (CA$)"],
      ["2023-06-16", "44.30"],
    ];
    const txs = hydroQcAdapter.parse(rows, "Budgeting - Hydro QC.csv", options);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].merchant, "Hydro-Québec");
    assert.strictEqual(txs[0].subcategory, "Utilities");
    assert.strictEqual(txs[0].currency, "CAD");
  });

  it("mentalTherapyAdapter: sets Therapy, Fixed Costs, Healthcare, USD and skips 0 placeholders", () => {
    const rows = [
      ["Date", "Cost"],
      ["2024-08-01", "40.00"],
      ["2024-10-01", "0.00"], // Formula placeholder
    ];
    const txs = mentalTherapyAdapter.parse(rows, "Budgeting - Mental therapy.csv", options);
    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].merchant, "Therapy");
    assert.strictEqual(txs[0].parentBucket, "Fixed Costs");
    assert.strictEqual(txs[0].subcategory, "Healthcare");
    assert.strictEqual(txs[0].currency, "USD");
  });

  it("montrealGasAdapter: sets Gas Station, Transit, CAD and fixes 2014 date typo", () => {
    const rows = [
      ["Dates", "Cost (CA$)"],
      ["2014-11-02", "94.16"],
      ["2024-11-05", "42.13"],
    ];
    const txs = montrealGasAdapter.parse(rows, "Budgeting - Montreal gas expenses.csv", options);
    assert.strictEqual(txs.length, 2);
    assert.strictEqual(txs[0].date, "2024-11-02"); // Corrected
    assert.strictEqual(txs[0].merchant, "Gas Station");
    assert.strictEqual(txs[0].currency, "CAD");
  });

  it("rideHailAdapter: handles USD/CAD columns and negative credits", () => {
    const rows = [
      ["Date", "Cost (US$)", "Cost (CA$)", "Service"],
      ["2024-06-20", "9.21", "", "Uber"],
      ["2024-06-21", "", "47.88", "Uber"],
      ["2026-01-19", "-7.00", "", "Lyft"],
    ];
    const txs = rideHailAdapter.parse(rows, "Budgeting - Ride-hail.csv", options);
    assert.strictEqual(txs.length, 3);

    assert.strictEqual(txs[0].currency, "USD");
    assert.strictEqual(txs[0].grossAmount, 9.21);

    assert.strictEqual(txs[1].currency, "CAD");
    assert.strictEqual(txs[1].grossAmount, 47.88);

    assert.strictEqual(txs[2].currency, "USD");
    assert.strictEqual(txs[2].grossAmount, -7.0);
    assert.strictEqual(txs[2].merchant, "Lyft");
  });

  it("salaryAdapter: splits Salary (> 1000) vs Reimbursement (<= 1000)", () => {
    const rows = [
      ["Date", "Amount"],
      ["2024-04-30", "6921.10"],
      ["2024-05-13", "55.53"],
      ["2024-08-12", "50.00"],
    ];
    const txs = salaryAdapter.parse(rows, "Budgeting - Salary.csv", options);
    assert.strictEqual(txs.length, 3);

    assert.strictEqual(txs[0].parentBucket, "Income");
    assert.strictEqual(txs[0].subcategory, "Salary");
    assert.strictEqual(txs[0].grossAmount, 6921.1);

    assert.strictEqual(txs[1].parentBucket, "Income");
    assert.strictEqual(txs[1].subcategory, "Reimbursement");
    assert.strictEqual(txs[1].grossAmount, 55.53);

    assert.strictEqual(txs[2].parentBucket, "Income");
    assert.strictEqual(txs[2].subcategory, "Reimbursement");
    assert.strictEqual(txs[2].grossAmount, 50.0);
  });

  it("stuffAdapter: normalizes climbing gyms into Fitness and handles USD/CAD", () => {
    const rows = [
      ["Date", "Cost (US$)", "Cost (CA$)", "Unified US$", "Merchant", "Description"],
      ["2025-03-14", "4.24", "", "4.24", "Amazon", "Mouse pad"],
      ["2025-05-18", "", "69.00", "48.74", "Uniqlo", "Clothes"],
      ["2025-07-16", "24.00", "", "24.00", "CRG", "T-shirt"],
      ["2025-06-13", "", "60.90", "43.02", "Progression Gym", "Pass"],
    ];
    const txs = stuffAdapter.parse(rows, "Budgeting - Stuff.csv", options);
    assert.strictEqual(txs.length, 4);

    assert.strictEqual(txs[0].currency, "USD");
    assert.strictEqual(txs[0].parentBucket, "Guilt-Free");
    assert.strictEqual(txs[0].subcategory, "Shopping");

    assert.strictEqual(txs[1].currency, "CAD");
    assert.strictEqual(txs[1].parentBucket, "Guilt-Free");
    assert.strictEqual(txs[1].subcategory, "Shopping");

    assert.strictEqual(txs[2].parentBucket, "Fixed Costs");
    assert.strictEqual(txs[2].subcategory, "Fitness");

    assert.strictEqual(txs[3].currency, "CAD");
    assert.strictEqual(txs[3].parentBucket, "Fixed Costs");
    assert.strictEqual(txs[3].subcategory, "Fitness");
  });

  it("datingAdapter: keeps known merchant rules and falls back to Guilt-Free Dining in USD", () => {
    const rows = [
      ["Date", "Cost", "Merchant"],
      ["2024-09-14", "12.40", "Starbucks"],
      ["2024-09-21", "88.00", "Pammy's"],
      ["2024-09-28", "0.00", "Placeholder"],
    ];

    const txs = datingAdapter.parse(rows, "Budgeting - Dating.csv", options);

    assert.strictEqual(txs.length, 2);
    assert.strictEqual(txs[0].merchant, "Starbucks");
    assert.strictEqual(txs[0].subcategory, "Coffee & Snacks");
    assert.strictEqual(txs[1].merchant, "Pammy's");
    assert.strictEqual(txs[1].parentBucket, "Guilt-Free");
    assert.strictEqual(txs[1].subcategory, "Dining");
    assert.strictEqual(txs[1].currency, "USD");
  });

  it("utilitiesAdapter: sets Fixed Costs Utilities and preserves utility provider name", () => {
    const rows = [
      ["Date", "Cost (US$)", "Merchant"],
      ["2025-08-15", "51.49", "Eversource"],
      ["2025-09-05", "14.72", "National Grid"],
    ];
    const txs = utilitiesAdapter.parse(rows, "Budgeting - Utilities.csv", options);
    assert.strictEqual(txs.length, 2);
    assert.strictEqual(txs[0].merchant, "Eversource");
    assert.strictEqual(txs[0].subcategory, "Utilities");
    assert.strictEqual(txs[1].merchant, "National Grid");
    assert.strictEqual(txs[1].subcategory, "Utilities");
  });

  it("covers all 13 sheet adapters in ALL_ADAPTERS registry", () => {
    assert.strictEqual(ALL_ADAPTERS.length, 13);
  });
});

describe("Pipeline Ingestion (runBackfill)", () => {
  it("runs dry-run across all 13 sheets and produces exact metrics without DB writes", async () => {
    const summary = await runBackfill({
      userId: "usr_default",
      defaultCard: "Historical",
      dryRun: true,
      local: false,
      remote: false,
      dir: "data/sheets",
    });

    assert.strictEqual(summary.sheets.length, 13);
    assert.strictEqual(summary.totalValid, 1680);
    assert.strictEqual(summary.totalUsd, 1355);
    assert.strictEqual(summary.totalCad, 325);
    assert.strictEqual(summary.totalSkipped, 35);

    // Verify key categories exist in breakdown
    assert.ok(summary.categoryBreakdown["Fixed Costs -> Transit"] > 0);
    assert.ok(summary.categoryBreakdown["Fixed Costs -> Fitness"] > 0);
    assert.ok(summary.categoryBreakdown["Fixed Costs -> Healthcare"] > 0);
    assert.ok(summary.categoryBreakdown["Income -> Salary"] > 0);
    assert.ok(summary.categoryBreakdown["Income -> Reimbursement"] > 0);
  });

  it("generateInsertSql: generates escaped SQL statement with ON CONFLICT DO NOTHING", () => {
    const tx = {
      id: "test-id-123",
      userId: "usr_default",
      date: "2024-05-01",
      card: "Historical",
      parentBucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Trader Joe's",
      grossAmount: 42.5,
      reimbursement: 0,
      currency: "USD",
      sourceFile: "test.csv",
      sourceRow: 2,
    };
    const sql = generateInsertSql(tx);
    assert.ok(sql.includes("'Trader Joe''s'"));
    assert.ok(sql.includes("42.50"));
    assert.ok(sql.includes("ON CONFLICT(id) DO NOTHING;"));
  });

  it("executeD1Batch: returns early success for empty statement array", () => {
    const result = executeD1Batch([], true, false);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.stdout, "");
  });

  it("runBackfill: processes a single file when options.file is provided", async () => {
    const summary = await runBackfill({
      userId: "usr_default",
      defaultCard: "Historical",
      dryRun: true,
      local: false,
      remote: false,
      file: "data/sheets/Budgeting - Bikeshare.csv",
    });

    assert.strictEqual(summary.sheets.length, 1);
    assert.strictEqual(summary.sheets[0].file, "Budgeting - Bikeshare.csv");
    assert.strictEqual(summary.totalValid, 8);
    assert.strictEqual(summary.totalSkipped, 4);
  });

  it("runBackfill: throws error when single file does not exist", async () => {
    await assert.rejects(async () => {
      await runBackfill({
        userId: "usr_default",
        defaultCard: "Historical",
        dryRun: true,
        local: false,
        remote: false,
        file: "non-existent-file.csv",
      });
    }, /Specified file not found/);
  });

  it("runBackfill: throws error when single file has no matching adapter", async () => {
    await assert.rejects(async () => {
      await runBackfill({
        userId: "usr_default",
        defaultCard: "Historical",
        dryRun: true,
        local: false,
        remote: false,
        file: "package.json",
      });
    }, /No adapter found for file/);
  });
});
