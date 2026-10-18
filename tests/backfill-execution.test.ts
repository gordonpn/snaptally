import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { executeD1Batch, runBackfill } from "../scripts/backfill/pipeline.ts";
import type { BackfillOptions } from "../scripts/backfill/types.ts";
import { createTestDatabase } from "./helpers/db.ts";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/backfill");

function createOptions(overrides: Partial<BackfillOptions> = {}): BackfillOptions {
  return {
    userId: "usr_default",
    defaultCard: "Historical",
    dryRun: true,
    local: false,
    remote: false,
    dir: FIXTURES_DIR,
    ...overrides,
  };
}

function createDirectory(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "snaptally-backfill-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createBikeshareFile(t: TestContext, count: number): string {
  const dir = createDirectory(t);
  const rows = Array.from({ length: count }, (_, index) => `2024-01-01,${index + 1}.00`);
  writeFileSync(join(dir, "Budgeting - Bikeshare.csv"), ["Date,Cost", ...rows].join("\n"));
  return dir;
}

function interceptWrangler(
  t: TestContext,
  execute: (args: readonly string[], sql: string) => string,
): void {
  t.mock.method(
    childProcess,
    "execFileSync",
    (command: string, args: readonly string[]): string => {
      assert.equal(command, "pnpm");
      const file = args[args.length - 1];
      assert.ok(file);
      return execute(args, readFileSync(file, "utf-8"));
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

describe("Backfill file discovery", () => {
  it("rejects a missing input directory", async (t) => {
    const options = createOptions({ dir: join(createDirectory(t), "missing") });

    await assert.rejects(runBackfill(options), /Sheet directory not found/);
  });

  it("allows an existing empty directory", async (t) => {
    const options = createOptions({ dir: createDirectory(t) });

    const summary = await runBackfill(options);

    assert.deepEqual(summary, {
      sheets: [],
      totalValid: 0,
      totalSkipped: 0,
      totalUsd: 0,
      totalCad: 0,
      categoryBreakdown: {},
    });
  });

  it("excludes overview sheets, unmatched CSVs, and non-CSV files", async (t) => {
    const dir = createDirectory(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));
    for (const ignored of ["Budgeting - General.csv", "unmatched.csv", "not-a-sheet.txt"]) {
      writeFileSync(join(dir, ignored), "Ignored input");
    }

    const summary = await runBackfill(createOptions({ dir }));

    assert.deepEqual(summary, {
      sheets: [
        {
          file: filename,
          totalRows: 3,
          validTransactions: 1,
          skippedRows: 2,
          usdCount: 1,
          cadCount: 0,
        },
      ],
      totalValid: 1,
      totalSkipped: 2,
      totalUsd: 1,
      totalCad: 0,
      categoryBreakdown: { "Fixed Costs -> Transit": 1 },
    });
  });
});

describe("Backfill execution", () => {
  for (const target of ["local", "remote"] as const) {
    it(`selects the ${target} target and deletes its temporary SQL file`, (t) => {
      const statement = readFileSync(
        resolve(import.meta.dirname, "../queries/insert_transaction.sql"),
        "utf-8",
      );
      let tempFile = "";
      interceptWrangler(t, (args, sql) => {
        const file = args[6];
        assert.ok(file);
        tempFile = file;
        assert.deepEqual(args, [
          "wrangler",
          "d1",
          "execute",
          "budget-db",
          `--${target}`,
          "--file",
          file,
        ]);
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.equal(sql, statement);
        return "batch completed";
      });

      const result = executeD1Batch([statement], target === "local", target === "remote");

      assert.deepEqual(result, { success: true, stdout: "batch completed" });
      assert.notEqual(tempFile, "");
      assert.equal(existsSync(tempFile), false);
    });
  }

  it("propagates execution failures and deletes its temporary SQL file", (t) => {
    let tempFile = "";
    interceptWrangler(t, (args) => {
      const file = args[6];
      assert.ok(file);
      tempFile = file;
      throw new Error("Wrangler failed");
    });

    assert.throws(() => executeD1Batch([""], true, false), /Wrangler failed/);

    assert.notEqual(tempFile, "");
    assert.equal(existsSync(tempFile), false);
  });

  it("never executes writes during dry-run, without a target, or with no transactions", async (t) => {
    interceptWrangler(t, () => assert.fail("Unexpected database execution"));
    const cases = [
      createOptions({ local: true }),
      createOptions({ remote: true }),
      createOptions({ dryRun: false }),
      createOptions({ local: true, dryRun: false, dir: createDirectory(t) }),
    ];

    const summaries = await Promise.all(cases.map(runBackfill));

    assert.deepEqual(
      summaries.map((summary) => summary.totalValid),
      [19, 19, 19, 0],
    );
  });

  it("inserts batches of 100 and reruns without changing persisted records", async (t) => {
    const dir = createBikeshareFile(t, 101);
    const db = createTestDatabase();
    t.after(() => db.close());
    const batchSizes: number[] = [];
    interceptWrangler(t, (_args, sql) => {
      batchSizes.push(sql.split("\n").length);
      db.exec(sql);
      return "batch completed";
    });
    const options = createOptions({ dir, local: true, dryRun: false });
    const select = db.prepare(
      readFileSync(
        resolve(import.meta.dirname, "../queries/select_recent_transactions.sql"),
        "utf-8",
      ),
    );

    const firstSummary = await runBackfill(options);
    const firstRecords = select.all(200);
    const secondSummary = await runBackfill(options);
    const secondRecords = select.all(200);

    assert.deepEqual(batchSizes, [100, 1, 100, 1]);
    assert.equal(firstSummary.totalValid, 101);
    assert.deepEqual(secondSummary, firstSummary);
    assert.deepEqual(secondRecords, firstRecords);
    assert.deepEqual(
      firstRecords.map(({ id, created_at, ...record }) => {
        assert.equal(typeof id, "string");
        assert.equal(typeof created_at, "string");
        return { ...record };
      }),
      Array.from({ length: 101 }, (_, index) => ({
        date: "2024-01-01",
        card: "Historical",
        parent_bucket: "Fixed Costs",
        subcategory: "Transit",
        merchant: "Bluebikes",
        gross_amount: 101 - index,
        reimbursement: 0,
        net_spend: 101 - index,
        currency: "USD",
      })),
    );
  });

  it("stops before later batches when execution fails", async (t) => {
    const options = createOptions({ dir: createBikeshareFile(t, 101), local: true, dryRun: false });
    let calls = 0;
    interceptWrangler(t, () => {
      calls++;
      throw new Error("Batch rejected");
    });

    await assert.rejects(runBackfill(options), /Batch rejected/);

    assert.equal(calls, 1);
  });

  it("enforces the migrated database's tenant foreign key", async (t) => {
    const db = createTestDatabase();
    t.after(() => db.close());
    interceptWrangler(t, (_args, sql) => {
      db.exec(sql);
      return "batch completed";
    });
    const options = createOptions({ userId: "missing-tenant", local: true, dryRun: false });

    await assert.rejects(runBackfill(options), /FOREIGN KEY constraint failed/);

    const selectSql = readFileSync(
      resolve(import.meta.dirname, "../queries/select_recent_transactions.sql"),
      "utf-8",
    );
    assert.deepEqual(db.prepare(selectSql).all(200), []);
  });
});
