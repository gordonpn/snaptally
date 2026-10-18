import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { runBackfill } from "../scripts/backfill/pipeline.ts";
import type { BackfillOptions } from "../scripts/backfill/types.ts";

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
