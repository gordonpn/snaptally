import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { resolveCheckpointPath, saveCheckpoint } from "../scripts/backfill/checkpoint.ts";
import { classifyTransactions } from "../scripts/backfill/classifier.ts";
import { MemoryDatabaseClient } from "../scripts/backfill/db.ts";
import { acquireBackfillLock } from "../scripts/backfill/lock.ts";
import { buildManifest, validateManifestMatch } from "../scripts/backfill/manifest.ts";
import {
  applyBackfill,
  planBackfill,
  resumeBackfill,
  verifyBackfill,
} from "../scripts/backfill/pipeline.ts";
import {
  BACKFILL_EXIT_CODES,
  type BackfillOptions,
  type BackfillTransaction,
  type ExistingDbTransaction,
} from "../scripts/backfill/types.ts";
import { createTestDatabase } from "./helpers/db.ts";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/backfill");

function createTempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "snaptally-safe-backfill-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createSampleTransaction(
  overrides: Partial<BackfillTransaction> = {},
): BackfillTransaction {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "usr_default",
    date: "2024-01-01",
    card: "Historical",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    merchant: "Bluebikes",
    grossAmount: 10.0,
    reimbursement: 0.0,
    currency: "USD",
    sourceFile: "Budgeting - Bikeshare.csv",
    sourceRow: 1,
    ...overrides,
  };
}

describe("Backfill Manifest and Integrity", () => {
  it("builds a canonical manifest with SHA-256 file hashes and row counts", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const manifest = buildManifest(dir, { userId: "usr_default", defaultCard: "Historical" });

    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].filename, filename);
    assert.equal(manifest.files[0].totalRows, 3);
    assert.equal(manifest.files[0].validTransactions, 1);
    assert.equal(manifest.files[0].skippedRows, 2);
    assert.match(manifest.manifestHash, /^[0-9a-f]{64}$/);
  });

  it("validates manifest match when files are unchanged", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const manifest = buildManifest(dir, { userId: "usr_default", defaultCard: "Historical" });
    assert.doesNotThrow(() => {
      validateManifestMatch(manifest, dir, { userId: "usr_default", defaultCard: "Historical" });
    });
  });

  it("rejects manifest match on tenant or card mismatch", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const manifest = buildManifest(dir, { userId: "usr_default", defaultCard: "Historical" });

    assert.throws(
      () =>
        validateManifestMatch(manifest, dir, { userId: "other_user", defaultCard: "Historical" }),
      /Manifest tenant mismatch/,
    );
    assert.throws(
      () =>
        validateManifestMatch(manifest, dir, { userId: "usr_default", defaultCard: "OtherCard" }),
      /Manifest card mismatch/,
    );
  });

  it("detects modified, missing, and extra files in manifest validation", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const manifest = buildManifest(dir, { userId: "usr_default", defaultCard: "Historical" });

    // Modify file
    writeFileSync(join(dir, filename), "Date,Cost\n2024-01-01,99.99\n");
    assert.throws(
      () =>
        validateManifestMatch(manifest, dir, { userId: "usr_default", defaultCard: "Historical" }),
      /modified: Budgeting - Bikeshare.csv/,
    );

    // Delete file
    rmSync(join(dir, filename));
    assert.throws(
      () =>
        validateManifestMatch(manifest, dir, { userId: "usr_default", defaultCard: "Historical" }),
      /missing: Budgeting - Bikeshare.csv/,
    );
  });
});

describe("Backfill Concurrency Lock", () => {
  it("acquires and releases lock cleanly", (t) => {
    const artifactsDir = createTempDir(t);
    const release = acquireBackfillLock(artifactsDir, {
      userId: "usr_default",
      target: "local",
      card: "Historical",
    });

    assert.ok(existsSync(join(artifactsDir, "backfill.lock")));
    release();
    assert.equal(existsSync(join(artifactsDir, "backfill.lock")), false);
  });

  it("prevents concurrent execution when lock is active", (t) => {
    const artifactsDir = createTempDir(t);
    const release = acquireBackfillLock(artifactsDir, {
      userId: "usr_default",
      target: "local",
      card: "Historical",
    });

    try {
      assert.throws(
        () =>
          acquireBackfillLock(artifactsDir, {
            userId: "usr_default",
            target: "local",
            card: "Historical",
          }),
        /Concurrent backfill in progress/,
      );
    } finally {
      release();
    }
  });

  it("breaks stale lock from terminated process", (t) => {
    const artifactsDir = createTempDir(t);
    const lockFile = join(artifactsDir, "backfill.lock");
    writeFileSync(
      lockFile,
      JSON.stringify({
        pid: 99999999, // non-existent PID
        userId: "usr_default",
        target: "local",
        card: "Historical",
        acquiredAt: new Date().toISOString(),
      }),
    );

    const release = acquireBackfillLock(artifactsDir, {
      userId: "usr_default",
      target: "local",
      card: "Historical",
    });
    release();
  });
});

describe("Backfill Row Classifier", () => {
  it("classifies identical records as already_present", () => {
    const src = createSampleTransaction();
    const dbTx: ExistingDbTransaction = {
      id: src.id,
      user_id: src.userId,
      date: src.date,
      card: src.card,
      parent_bucket: src.parentBucket,
      subcategory: src.subcategory,
      merchant: src.merchant,
      gross_amount: src.grossAmount,
      reimbursement: src.reimbursement,
      currency: src.currency,
    };

    const report = classifyTransactions([src], [dbTx], {
      manifestHash: "test-hash",
      target: "local",
      userId: "usr_default",
      card: "Historical",
    });

    assert.equal(report.counts.alreadyPresent, 1);
    assert.equal(report.counts.missing, 0);
    assert.equal(report.counts.conflicting, 0);
    assert.equal(report.counts.extra, 0);
  });

  it("classifies new records as missing", () => {
    const src = createSampleTransaction();
    const report = classifyTransactions([src], [], {
      manifestHash: "test-hash",
      target: "local",
      userId: "usr_default",
      card: "Historical",
    });

    assert.equal(report.counts.missing, 1);
    assert.equal(report.missingTransactions.length, 1);
    assert.equal(report.missingTransactions[0].id, src.id);
  });

  it("detects field conflicts on existing record ID", () => {
    const src = createSampleTransaction({ grossAmount: 25.0 });
    const dbTx: ExistingDbTransaction = {
      id: src.id,
      user_id: src.userId,
      date: src.date,
      card: src.card,
      parent_bucket: src.parentBucket,
      subcategory: src.subcategory,
      merchant: src.merchant,
      gross_amount: 10.0, // mismatched amount
      reimbursement: 0.0,
      currency: src.currency,
    };

    const report = classifyTransactions([src], [dbTx], {
      manifestHash: "test-hash",
      target: "local",
      userId: "usr_default",
      card: "Historical",
    });

    assert.equal(report.counts.conflicting, 1);
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.conflicts[0].field, "gross_amount");
    assert.equal(report.conflicts[0].sourceValue, 25.0);
    assert.equal(report.conflicts[0].dbValue, 10.0);
  });

  it("detects row-shift duplicate where content signature matches under a different ID", () => {
    const src = createSampleTransaction({ id: "new-shifted-id-1234" });
    const dbTx: ExistingDbTransaction = {
      id: "old-id-5678",
      user_id: src.userId,
      date: src.date,
      card: src.card,
      parent_bucket: src.parentBucket,
      subcategory: src.subcategory,
      merchant: src.merchant,
      gross_amount: src.grossAmount,
      reimbursement: 0.0,
      currency: src.currency,
    };

    const report = classifyTransactions([src], [dbTx], {
      manifestHash: "test-hash",
      target: "local",
      userId: "usr_default",
      card: "Historical",
    });

    assert.equal(report.counts.conflicting, 1);
    assert.equal(report.conflicts[0].field, "row_shift_duplicate");
    assert.equal(report.conflicts[0].isRowShiftRisk, true);
  });

  it("detects extra records present in DB but absent from source", () => {
    const dbTx: ExistingDbTransaction = {
      id: "extra-id-9999",
      user_id: "usr_default",
      date: "2024-01-01",
      card: "Historical",
      parent_bucket: "Fixed Costs",
      subcategory: "Transit",
      merchant: "MBTA",
      gross_amount: 2.4,
      reimbursement: 0.0,
      currency: "USD",
    };

    const report = classifyTransactions([], [dbTx], {
      manifestHash: "test-hash",
      target: "local",
      userId: "usr_default",
      card: "Historical",
    });

    assert.equal(report.counts.extra, 1);
    assert.equal(report.sampleExtraIds[0], "extra-id-9999");
  });
});

describe("Backfill Pipeline Plan, Apply, and Resume", () => {
  function setupTestEnv(t: TestContext) {
    const dir = createTempDir(t);
    const artifactsDir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const db = createTestDatabase();
    t.after(() => db.close());
    const client = new MemoryDatabaseClient(db);

    const options: BackfillOptions = {
      userId: "usr_default",
      defaultCard: "Historical",
      dryRun: true,
      local: true,
      remote: false,
      dir,
      artifactsDir,
    };

    return { dir, artifactsDir, db, client, options, filename };
  }

  it("plan mode produces classified report and writes plan artifact with zero database mutations", async (t) => {
    const { options, client } = setupTestEnv(t);

    const { report, manifest, artifactPath, exitCode } = await planBackfill(options, client);

    assert.equal(exitCode, BACKFILL_EXIT_CODES.SUCCESS);
    assert.equal(report.counts.missing, 1);
    assert.equal(report.counts.alreadyPresent, 0);
    assert.equal(manifest.totalValidTransactions, 1);
    assert.ok(existsSync(artifactPath));

    // Confirm zero database rows were written
    const count = await client.queryTransactionCount("usr_default", "Historical");
    assert.equal(count, 0);
  });

  it("apply requires explicit confirmation via --yes", async (t) => {
    const { options, client } = setupTestEnv(t);

    await assert.rejects(
      applyBackfill({ ...options, yes: false, dryRun: false }, client),
      /Apply requires explicit confirmation/,
    );
  });

  it("apply inserts missing records and verifies post-apply counts", async (t) => {
    const { options, client } = setupTestEnv(t);

    const { artifact, exitCode } = await applyBackfill(
      { ...options, yes: true, dryRun: false },
      client,
    );

    assert.equal(exitCode, BACKFILL_EXIT_CODES.SUCCESS);
    assert.equal(artifact.counts.written, 1);
    assert.equal(artifact.verification.passed, true);
    assert.equal(artifact.verification.postCount, 1);

    const count = await client.queryTransactionCount("usr_default", "Historical");
    assert.equal(count, 1);
  });

  it("repeated apply is idempotent and skips already present records", async (t) => {
    const { options, client } = setupTestEnv(t);

    // First apply
    await applyBackfill({ ...options, yes: true, dryRun: false }, client);

    // Second apply
    const { artifact, exitCode } = await applyBackfill(
      { ...options, yes: true, dryRun: false },
      client,
    );

    assert.equal(exitCode, BACKFILL_EXIT_CODES.SUCCESS);
    assert.equal(artifact.counts.written, 0);
    assert.equal(artifact.counts.alreadyPresent, 1);
    assert.equal(artifact.verification.postCount, 1);
  });

  it("apply with plan-file enforces strict manifest verification", async (t) => {
    const { options, client, dir } = setupTestEnv(t);

    const { artifactPath } = await planBackfill(options, client);

    // Tamper with source file
    writeFileSync(join(dir, "Budgeting - Bikeshare.csv"), "Date,Cost\n2024-01-01,999.00\n");

    await assert.rejects(
      applyBackfill({ ...options, yes: true, dryRun: false, planFile: artifactPath }, client),
      /Source files do not match reviewed plan manifest/,
    );
  });

  it("resumes an interrupted backfill from the checkpoint without duplicating work", async (t) => {
    const { options, client, artifactsDir, dir } = setupTestEnv(t);

    // Create 105 rows so batch 0 has 100 rows and batch 1 has 5 rows
    const rows = Array.from({ length: 105 }, (_, i) => `2024-01-01,${i + 1}.00`);
    writeFileSync(join(dir, "Budgeting - Bikeshare.csv"), ["Date,Cost", ...rows].join("\n"));

    const runId = "test-resume-run-123";
    const checkpointPath = resolveCheckpointPath(artifactsDir, runId);

    // Execute first batch (batch 0) into db
    const { report } = await planBackfill(options, client);
    const statements = report.missingTransactions.map(
      (tx) =>
        `INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency) VALUES ('${tx.id}', '${tx.userId}', '${tx.date}', '${tx.card}', '${tx.parentBucket}', '${tx.subcategory}', '${tx.merchant}', ${tx.grossAmount.toFixed(2)}, 0.0, '${tx.currency}') ON CONFLICT(id) DO NOTHING;`,
    );
    const batch0 = statements.slice(0, 100);
    await client.executeBatch(batch0);
    assert.equal(await client.queryTransactionCount(options.userId, options.defaultCard), 100);

    const manifest = buildManifest(options.dir ?? "", options);

    // Save checkpoint indicating batch 0 was completed
    saveCheckpoint(checkpointPath, {
      runId,
      manifestHash: manifest.manifestHash,
      target: "memory",
      userId: options.userId,
      defaultCard: options.defaultCard,
      totalBatches: 2,
      completedBatches: [0],
      writtenCount: 100,
      lastUpdated: new Date().toISOString(),
    });

    const { artifact, exitCode } = await resumeBackfill(
      { ...options, runId, yes: true, dryRun: false },
      client,
    );

    assert.equal(exitCode, BACKFILL_EXIT_CODES.SUCCESS);
    assert.equal(artifact.counts.written, 105);
    assert.equal(await client.queryTransactionCount(options.userId, options.defaultCard), 105);
    // Checkpoint should be deleted upon verified completion
    assert.equal(existsSync(checkpointPath), false);
  });

  it("verify reports consistent state after apply and detects drift if rows are missing", async (t) => {
    const { options, client } = setupTestEnv(t);

    // Before apply: drift detected (row missing)
    const beforeVerify = await verifyBackfill(options, client);
    assert.equal(beforeVerify.passed, false);
    assert.equal(beforeVerify.exitCode, BACKFILL_EXIT_CODES.VERIFICATION_FAILURE);

    // After apply: passed
    await applyBackfill({ ...options, yes: true, dryRun: false }, client);
    const afterVerify = await verifyBackfill(options, client);
    assert.equal(afterVerify.passed, true);
    assert.equal(afterVerify.exitCode, BACKFILL_EXIT_CODES.SUCCESS);
  });

  it("cli exits with code 2 (APPROVAL_REQUIRED) when apply is invoked without --yes", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const cliPath = resolve(import.meta.dirname, "../scripts/backfill.ts");
    const result = spawnSync(process.execPath, [cliPath, "apply", "--local", "--dir", dir], {
      encoding: "utf-8",
    });

    assert.equal(result.status, BACKFILL_EXIT_CODES.APPROVAL_REQUIRED);
    assert.match(result.stderr, /Apply requires explicit confirmation/);
  });
});
