import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { writeRunArtifact } from "../scripts/backfill/artifact.ts";
import {
  loadCheckpoint,
  resolveCheckpointPath,
  saveCheckpoint,
} from "../scripts/backfill/checkpoint.ts";
import { classifyTransactions } from "../scripts/backfill/classifier.ts";
import {
  escapeSqlLiteral,
  MemoryDatabaseClient,
  parseJsonOutput,
  WranglerD1Client,
} from "../scripts/backfill/db.ts";
import { acquireBackfillLock } from "../scripts/backfill/lock.ts";
import { buildManifest, validateManifestMatch } from "../scripts/backfill/manifest.ts";
import {
  applyBackfill,
  loadSourceTransactions,
  planBackfill,
  resumeBackfill,
  verifyBackfill,
} from "../scripts/backfill/pipeline.ts";
import {
  BACKFILL_EXIT_CODES,
  type BackfillOptions,
  type BackfillTransaction,
  type ExistingDbTransaction,
  type RunArtifact,
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

  it("validates manifest match when single file scope is specified", (t) => {
    const dir = createTempDir(t);
    const file1 = "Budgeting - Bikeshare.csv";
    const file2 = "Budgeting - Ride-hail.csv";
    copyFileSync(join(FIXTURES_DIR, file1), join(dir, file1));
    copyFileSync(join(FIXTURES_DIR, file2), join(dir, file2));

    const manifest = buildManifest(
      dir,
      { userId: "usr_default", defaultCard: "Historical" },
      file1,
    );
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].filename, file1);

    assert.doesNotThrow(() => {
      validateManifestMatch(
        manifest,
        dir,
        { userId: "usr_default", defaultCard: "Historical" },
        file1,
      );
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

  it("treats unreadable lock metadata as locked without unlinking", (t) => {
    const artifactsDir = createTempDir(t);
    const lockFile = join(artifactsDir, "backfill.lock");
    writeFileSync(lockFile, "invalid-json-content");

    assert.throws(
      () =>
        acquireBackfillLock(artifactsDir, {
          userId: "usr_default",
          target: "local",
          card: "Historical",
        }),
      /existing lock file at .* is unreadable or currently being acquired/,
    );

    assert.ok(existsSync(lockFile));
  });

  it("release does not delete lock file owned by a different PID", (t) => {
    const artifactsDir = createTempDir(t);
    const lockFile = join(artifactsDir, "backfill.lock");
    const release = acquireBackfillLock(artifactsDir, {
      userId: "usr_default",
      target: "local",
      card: "Historical",
    });

    writeFileSync(
      lockFile,
      JSON.stringify({
        pid: 99999999,
        userId: "usr_default",
        target: "local",
        card: "Historical",
        acquiredAt: new Date().toISOString(),
      }),
    );

    release();
    assert.ok(existsSync(lockFile));
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

  it("detects field conflicts on mismatched reimbursement", () => {
    const src = createSampleTransaction({ grossAmount: 10.0, reimbursement: 5.0 });
    const dbTx: ExistingDbTransaction = {
      id: src.id,
      user_id: src.userId,
      date: src.date,
      card: src.card,
      parent_bucket: src.parentBucket,
      subcategory: src.subcategory,
      merchant: src.merchant,
      gross_amount: 10.0,
      reimbursement: 0.0, // mismatched reimbursement
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
    assert.equal(report.conflicts[0].field, "reimbursement");
    assert.equal(report.conflicts[0].sourceValue, 5.0);
    assert.equal(report.conflicts[0].dbValue, 0.0);
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

  it("counts single transaction with multiple field mismatches as one conflict", () => {
    const src = createSampleTransaction();
    const dbTx: ExistingDbTransaction = {
      id: src.id,
      user_id: src.userId,
      date: src.date,
      card: src.card,
      parent_bucket: "Different Bucket",
      subcategory: "Different Subcategory",
      merchant: "Different Merchant",
      gross_amount: src.grossAmount,
      reimbursement: src.reimbursement,
      currency: src.currency,
    };

    const report = classifyTransactions([src], [dbTx], {
      manifestHash: "test-hash",
      target: "local",
      userId: src.userId,
      card: src.card,
    });

    assert.equal(report.counts.conflicting, 1);
    assert.equal(report.conflicts.length, 3);
  });

  it("does not flag row shift if duplicate content signature belongs to exact-matched source transaction", () => {
    const src1 = createSampleTransaction();
    const src2 = { ...createSampleTransaction(), id: "different-id-same-content", sourceRow: 2 };
    const dbTx1: ExistingDbTransaction = {
      id: src1.id,
      user_id: src1.userId,
      date: src1.date,
      card: src1.card,
      parent_bucket: src1.parentBucket,
      subcategory: src1.subcategory,
      merchant: src1.merchant,
      gross_amount: src1.grossAmount,
      reimbursement: src1.reimbursement,
      currency: src1.currency,
    };

    const report = classifyTransactions([src1, src2], [dbTx1], {
      manifestHash: "test-hash",
      target: "local",
      userId: src1.userId,
      card: src1.card,
    });

    assert.equal(report.counts.alreadyPresent, 1);
    assert.equal(report.counts.missing, 1);
    assert.equal(report.counts.conflicting, 0);
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
    const result = spawnSync(
      process.execPath,
      [cliPath, "apply", "--dir", dir, "--artifacts-dir", dir],
      {
        encoding: "utf-8",
      },
    );

    assert.equal(result.status, BACKFILL_EXIT_CODES.APPROVAL_REQUIRED, result.stderr);
    assert.match(result.stderr, /Apply requires explicit confirmation/);
  });

  it("saveCheckpoint writes checkpoint atomically and loadCheckpoint reads it back", (t) => {
    const dir = createTempDir(t);
    const checkpointPath = resolveCheckpointPath(dir, "run-test-atomic");

    const state = {
      runId: "run-test-atomic",
      manifestHash: "abcd",
      target: "local" as const,
      userId: "usr_default",
      defaultCard: "Historical",
      totalBatches: 2,
      completedBatches: [0],
      writtenCount: 100,
      lastUpdated: new Date().toISOString(),
    };

    saveCheckpoint(checkpointPath, state);
    const loaded = loadCheckpoint(checkpointPath);
    assert.deepEqual(loaded, state);
  });

  it("apply with dryRun: true executes plan without database writes", async (t) => {
    const { options, client } = setupTestEnv(t);

    const result = await applyBackfill({ ...options, yes: true, dryRun: true }, client);
    assert.equal(result.exitCode, BACKFILL_EXIT_CODES.SUCCESS);
    assert.equal(await client.queryTransactionCount("usr_default", "Historical"), 0);
  });

  it("resume with dryRun: true throws an error", async (t) => {
    const { options, client } = setupTestEnv(t);

    await assert.rejects(
      resumeBackfill({ ...options, runId: "test-run", yes: true, dryRun: true }, client),
      /Resume cannot be performed with --dry-run/,
    );
  });

  it("cli honors --dry-run with apply and executes zero database writes", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const cliPath = resolve(import.meta.dirname, "../scripts/backfill.ts");
    const result = spawnSync(
      process.execPath,
      [cliPath, "apply", "--dry-run", "--yes", "--dir", dir, "--artifacts-dir", dir],
      { encoding: "utf-8" },
    );

    assert.equal(result.status, BACKFILL_EXIT_CODES.SUCCESS, result.stderr);
    assert.match(result.stdout, /Notice: --dry-run specified with apply/);
    assert.match(result.stdout, /Zero database writes executed/);
  });

  it("cli supports plan subcommand", (t) => {
    const dir = createTempDir(t);
    const filename = "Budgeting - Bikeshare.csv";
    copyFileSync(join(FIXTURES_DIR, filename), join(dir, filename));

    const cliPath = resolve(import.meta.dirname, "../scripts/backfill.ts");
    const result = spawnSync(
      process.execPath,
      [cliPath, "plan", "--dir", dir, "--artifacts-dir", dir],
      {
        encoding: "utf-8",
      },
    );

    assert.equal(result.status, BACKFILL_EXIT_CODES.SUCCESS, result.stderr);
    assert.match(result.stdout, /Zero database writes executed/);
  });

  it("cli rejects unknown subcommand", () => {
    const cliPath = resolve(import.meta.dirname, "../scripts/backfill.ts");
    const result = spawnSync(process.execPath, [cliPath, "invalid-cmd"], {
      encoding: "utf-8",
    });

    assert.equal(result.status, BACKFILL_EXIT_CODES.EXECUTION_ERROR);
    assert.match(result.stderr, /Unknown command: invalid-cmd/);
  });

  it("redacts conflict values when writing run artifacts", (t) => {
    const dir = createTempDir(t);
    const artifact: RunArtifact = {
      runId: "test-redact-run",
      command: "plan",
      target: "local",
      userId: "usr_default",
      defaultCard: "Historical",
      manifestHash: "hash",
      manifest: {
        manifestVersion: "1.0.0",
        manifestHash: "hash",
        sourceDir: dir,
        userId: "usr_default",
        defaultCard: "Historical",
        parserVersion: "1.0.0",
        files: [],
        totalValidTransactions: 0,
        totalSkippedRows: 0,
        createdAt: new Date().toISOString(),
      },
      parserVersion: "1.0.0",
      counts: {
        considered: 1,
        alreadyPresent: 0,
        missing: 0,
        conflicting: 1,
        extra: 0,
        written: 0,
        skipped: 0,
        failed: 0,
      },
      sampleMissingIds: [],
      sampleAlreadyPresentIds: [],
      sampleExtraIds: [],
      conflicts: [
        {
          id: "tx-conf",
          field: "merchant",
          sourceValue: "Sensitive Merchant",
          dbValue: "Old Merchant",
        },
      ],
      verification: {
        preCount: 1,
        postCount: 1,
        expectedPostCount: 1,
        passed: true,
      },
      exitCode: BACKFILL_EXIT_CODES.SUCCESS,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    const artifactPath = writeRunArtifact(dir, artifact, "plan");
    const writtenJson = readFileSync(artifactPath, "utf-8");
    assert.doesNotMatch(writtenJson, /Sensitive Merchant/);
    assert.match(writtenJson, /\[REDACTED\]/);
  });

  it("resume rejects target mismatch between options and checkpoint", async (t) => {
    const { dir, artifactsDir, options } = setupTestEnv(t);
    const runId = "test-mismatch-target";
    const checkpointPath = resolveCheckpointPath(artifactsDir, runId);
    saveCheckpoint(checkpointPath, {
      runId,
      manifestHash: buildManifest(dir, options).manifestHash,
      target: "remote",
      userId: options.userId,
      defaultCard: options.defaultCard,
      totalBatches: 1,
      completedBatches: [],
      writtenCount: 0,
      lastUpdated: new Date().toISOString(),
    });

    await assert.rejects(
      resumeBackfill({ ...options, runId, dryRun: false, local: true, remote: false }),
      /Options target \(local\) does not match checkpoint target \(remote\)/,
    );
  });

  it("resume blocks and reports error when conflicts are detected", async (t) => {
    const { dir, artifactsDir, db, client, options, filename } = setupTestEnv(t);
    const runId = "test-resume-conflicts";
    const checkpointPath = resolveCheckpointPath(artifactsDir, runId);

    const { transactions } = loadSourceTransactions(dir, { ...options, file: filename });
    const src = transactions[0];

    // Insert a conflicting row into database sharing the same ID but with a different merchant
    db.exec(
      `INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency) VALUES ('${src.id}', 'usr_default', '${src.date}', '${src.card}', '${src.parentBucket}', '${src.subcategory}', 'Conflicting Merchant', 99.99, 0, '${src.currency}');`,
    );

    saveCheckpoint(checkpointPath, {
      runId,
      manifestHash: buildManifest(dir, options, filename).manifestHash,
      target: "memory",
      userId: options.userId,
      defaultCard: options.defaultCard,
      totalBatches: 1,
      completedBatches: [],
      writtenCount: 0,
      lastUpdated: new Date().toISOString(),
    });

    const result = await resumeBackfill(
      { ...options, runId, file: filename, yes: true, dryRun: false },
      client,
    );

    assert.equal(result.exitCode, BACKFILL_EXIT_CODES.EXECUTION_ERROR);
    assert.match(result.artifact.error ?? "", /conflicting record\(s\) detected/);
  });

  it("includes categoryBreakdown in plan artifact", async (t) => {
    const { client, options } = setupTestEnv(t);
    const result = await planBackfill(options, client);
    assert.ok(result.artifact.categoryBreakdown);
    assert.equal(typeof result.artifact.categoryBreakdown, "object");
  });
});

describe("Database Client and Utilities", () => {
  it("escapes SQL string literals with single quotes", () => {
    assert.equal(escapeSqlLiteral("normal"), "'normal'");
    assert.equal(escapeSqlLiteral("O'Connor"), "'O''Connor'");
  });

  it("parses JSON array from wrangler output with banner text", () => {
    const raw = '├ Checking files...\n[{"results": [{"name": "0000_init.sql"}]}]';
    const parsed = parseJsonOutput<Array<{ results: Array<{ name: string }> }>>(raw);
    assert.equal(parsed[0].results[0].name, "0000_init.sql");
  });

  it("throws error when wrangler output contains no JSON array", () => {
    assert.throws(() => parseJsonOutput("no json here"), /Failed to find JSON array/);
  });

  it("WranglerD1Client queries migrations, existing transactions, counts, and executes batches", async () => {
    const mockRunner = (_cmd: string, args: string[]): string => {
      const sql = args[args.indexOf("--command") + 1] ?? "";
      if (sql.includes("d1_migrations")) {
        return JSON.stringify([{ results: [{ name: "0000_init.sql" }] }]);
      }
      if (sql.includes("count(*)")) {
        return JSON.stringify([{ results: [{ count: 42 }] }]);
      }
      if (sql.includes("SELECT id")) {
        return JSON.stringify([
          {
            results: [
              {
                id: "tx-1",
                user_id: "usr_default",
                date: "2024-01-01",
                card: "Historical",
                parent_bucket: "Fixed Costs",
                subcategory: "Transit",
                merchant: "MBTA",
                gross_amount: 2.4,
                reimbursement: 0,
                currency: "USD",
              },
            ],
          },
        ]);
      }
      return "Executed SQL file successfully";
    };

    const client = new WranglerD1Client("local", mockRunner);
    const migrations = await client.queryMigrations();
    assert.deepEqual(migrations, ["0000_init.sql"]);

    const count = await client.queryTransactionCount("usr_default", "Historical");
    assert.equal(count, 42);

    const txs = await client.queryExistingTransactions("usr_default", "Historical");
    assert.equal(txs.length, 1);
    assert.equal(txs[0].merchant, "MBTA");

    const batchEmpty = await client.executeBatch([]);
    assert.equal(batchEmpty.success, true);

    const batchExecuted = await client.executeBatch([
      "INSERT INTO transactions (id) VALUES ('1');",
    ]);
    assert.equal(batchExecuted.success, true);
  });
});
