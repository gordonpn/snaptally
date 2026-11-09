import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ALL_ADAPTERS } from "./adapters.ts";
import { writeRunArtifact } from "./artifact.ts";
import {
  deleteCheckpoint,
  loadCheckpoint,
  resolveCheckpointPath,
  saveCheckpoint,
} from "./checkpoint.ts";
import { classifyTransactions } from "./classifier.ts";
import { parseCsv } from "./csv.ts";
import { type BackfillDatabaseClient, OfflineDatabaseClient, WranglerD1Client } from "./db.ts";
import { acquireBackfillLock } from "./lock.ts";
import { BACKFILL_PARSER_VERSION, buildManifest, validateManifestMatch } from "./manifest.ts";
import {
  BACKFILL_EXIT_CODES,
  type BackfillExitCode,
  type BackfillManifest,
  type BackfillOptions,
  type BackfillSummary,
  type BackfillTarget,
  type BackfillTransaction,
  type CheckpointState,
  type ClassificationReport,
  type RunArtifact,
  type SheetSummary,
} from "./types.ts";

export function escapeSql(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

export function generateInsertSql(tx: BackfillTransaction): string {
  return `INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency) VALUES (${escapeSql(tx.id)}, ${escapeSql(tx.userId)}, ${escapeSql(tx.date)}, ${escapeSql(tx.card)}, ${escapeSql(tx.parentBucket)}, ${escapeSql(tx.subcategory)}, ${escapeSql(tx.merchant)}, ${tx.grossAmount.toFixed(2)}, ${tx.reimbursement.toFixed(2)}, ${escapeSql(tx.currency)}) ON CONFLICT(id) DO NOTHING;`;
}

export function executeD1Batch(
  statements: string[],
  isLocal: boolean,
  isRemote: boolean,
): { success: boolean; stdout: string } {
  if (statements.length === 0) {
    return { success: true, stdout: "" };
  }

  const batchSql = statements.join("\n");
  const tempFile = join(
    tmpdir(),
    `snaptally-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(tempFile, batchSql, { encoding: "utf-8", mode: 0o600, flag: "wx" });

  try {
    const args = ["wrangler", "d1", "execute", "budget-db"];
    if (isLocal) {
      args.push("--local");
    } else if (isRemote) {
      args.push("--remote");
    }
    args.push("--file", tempFile);

    const stdout = execFileSync("pnpm", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return { success: true, stdout };
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}

export function resolveTargetDir(baseDir: string): string {
  const resolved = resolve(baseDir);
  if (!existsSync(resolved)) {
    return resolved;
  }

  const directCsvs = readdirSync(resolved).filter(
    (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
  );
  if (directCsvs.length > 0) {
    return resolved;
  }

  const entries = readdirSync(resolved, { withFileTypes: true });
  const dateDirs = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    const candidatePath = join(resolved, dateDir, "01_CURRENT_BUDGETS");
    if (existsSync(candidatePath)) {
      const budgetCsvs = readdirSync(candidatePath).filter(
        (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
      );
      if (budgetCsvs.length > 0) {
        return candidatePath;
      }
    }

    const directDatePath = join(resolved, dateDir);
    const dateCsvs = readdirSync(directDatePath).filter(
      (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
    );
    if (dateCsvs.length > 0) {
      return directDatePath;
    }
  }

  const subCurrentBudgets = join(resolved, "01_CURRENT_BUDGETS");
  if (existsSync(subCurrentBudgets)) {
    const budgetCsvs = readdirSync(subCurrentBudgets).filter(
      (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
    );
    if (budgetCsvs.length > 0) {
      return subCurrentBudgets;
    }
  }

  return resolved;
}

function resolveFilePath(dir: string, file: string): string {
  if (isAbsolute(file)) {
    return file;
  }
  const fromCwd = resolve(file);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  return join(dir, file);
}

export function loadSourceTransactions(
  targetDir: string,
  options: BackfillOptions,
): { transactions: BackfillTransaction[]; sheets: SheetSummary[] } {
  let filePaths: string[] = [];

  if (options.file) {
    const resolvedPath = resolveFilePath(targetDir, options.file);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Specified file not found: ${options.file}`);
    }
    filePaths = [resolvedPath];
  } else {
    if (!existsSync(targetDir)) {
      throw new Error(`Sheet directory not found: ${targetDir}`);
    }
    filePaths = readdirSync(targetDir)
      .filter((f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"))
      .sort()
      .map((f) => join(targetDir, f));
  }

  const sheets: SheetSummary[] = [];
  const transactions: BackfillTransaction[] = [];

  for (const filePath of filePaths) {
    const filename = basename(filePath);
    const adapter = ALL_ADAPTERS.find((a) => a.match(filename));

    if (!adapter) {
      if (options.file) {
        throw new Error(`No adapter found for file: ${filename}`);
      }
      continue;
    }

    const content = readFileSync(filePath, "utf-8");
    const rows = parseCsv(content);
    const parsed = adapter.parse(rows, filename, options);

    const totalRows = Math.max(0, rows.length - 1);
    const validCount = parsed.length;
    const skippedCount = totalRows - validCount;
    const usdCount = parsed.filter((t) => t.currency === "USD").length;
    const cadCount = parsed.filter((t) => t.currency === "CAD").length;

    sheets.push({
      file: filename,
      totalRows,
      validTransactions: validCount,
      skippedRows: skippedCount,
      usdCount,
      cadCount,
    });

    transactions.push(...parsed);
  }

  return { transactions, sheets };
}

function resolveDbClient(
  options: BackfillOptions,
  injectedClient?: BackfillDatabaseClient,
): BackfillDatabaseClient {
  if (injectedClient) {
    return injectedClient;
  }
  if (!options.local && !options.remote) {
    return new OfflineDatabaseClient();
  }
  const target = options.remote ? "remote" : "local";
  return new WranglerD1Client(target);
}

function getArtifactsDirectory(options: BackfillOptions): string {
  return resolve(options.artifactsDir ?? ".backfill-runs");
}

function generateRunId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${dateStr}-${rand}`;
}

/**
 * Plans a backfill without mutating the database.
 * Computes source manifest, queries database baseline, classifies records,
 * and writes a machine-readable plan artifact.
 */
export async function planBackfill(
  options: BackfillOptions,
  dbClient?: BackfillDatabaseClient,
): Promise<{
  report: ClassificationReport;
  manifest: BackfillManifest;
  artifact: RunArtifact;
  artifactPath: string;
  exitCode: BackfillExitCode;
}> {
  const targetDir = resolveTargetDir(options.dir ?? "data/sheets");
  const manifest = buildManifest(targetDir, options, options.file);
  const { transactions } = loadSourceTransactions(targetDir, options);

  const client = resolveDbClient(options, dbClient);
  const migrations = await client.queryMigrations();
  if (migrations.length === 0) {
    throw new Error(
      `Database migrations query returned zero migrations. Ensure migrations are applied to ${client.target} D1.`,
    );
  }

  const existingDbTxs = await client.queryExistingTransactions(options.userId, options.defaultCard);
  const report = classifyTransactions(transactions, existingDbTxs, {
    manifestHash: manifest.manifestHash,
    target: client.target,
    userId: options.userId,
    card: options.defaultCard,
  });

  const runId = options.runId ?? generateRunId();
  const artifactsDir = getArtifactsDirectory(options);

  const exitCode: BackfillExitCode =
    report.counts.conflicting > 0
      ? BACKFILL_EXIT_CODES.APPROVAL_REQUIRED
      : BACKFILL_EXIT_CODES.SUCCESS;

  const artifact: RunArtifact = {
    runId,
    command: "plan",
    target: client.target,
    userId: options.userId,
    defaultCard: options.defaultCard,
    manifestHash: manifest.manifestHash,
    manifest,
    parserVersion: BACKFILL_PARSER_VERSION,
    counts: {
      considered: report.counts.totalSource,
      alreadyPresent: report.counts.alreadyPresent,
      missing: report.counts.missing,
      conflicting: report.counts.conflicting,
      extra: report.counts.extra,
      written: 0,
      skipped: report.counts.alreadyPresent,
      failed: 0,
    },
    sampleMissingIds: report.sampleMissingIds,
    sampleAlreadyPresentIds: report.sampleAlreadyPresentIds,
    sampleExtraIds: report.sampleExtraIds,
    categoryBreakdown: report.categoryBreakdown,
    conflicts: report.conflicts,
    verification: {
      preCount: report.counts.totalDb,
      postCount: report.counts.totalDb,
      expectedPostCount: report.counts.totalDb + report.counts.missing,
      passed: exitCode === BACKFILL_EXIT_CODES.SUCCESS,
    },
    exitCode,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const artifactPath = writeRunArtifact(artifactsDir, artifact, "plan");

  return { report, manifest, artifact, artifactPath, exitCode };
}

/**
 * Executes approved missing transaction insertions into the target database.
 * Protected by manifest validation, scope assertion, concurrency lock,
 * and pre/post verification checks.
 */
export async function applyBackfill(
  options: BackfillOptions,
  dbClient?: BackfillDatabaseClient,
): Promise<{
  artifact: RunArtifact;
  artifactPath: string;
  exitCode: BackfillExitCode;
}> {
  if (options.dryRun) {
    return planBackfill(options, dbClient);
  }

  if (!options.yes) {
    throw new Error(
      "Apply requires explicit confirmation. Supply --yes to approve database writes.",
    );
  }

  const artifactsDir = getArtifactsDirectory(options);
  const targetDir = resolveTargetDir(options.dir ?? "data/sheets");
  const target: BackfillTarget = dbClient?.target ?? (options.remote ? "remote" : "local");

  const releaseLock = acquireBackfillLock(artifactsDir, {
    userId: options.userId,
    target,
    card: options.defaultCard,
  });

  const runId = options.runId ?? generateRunId();
  const startTime = new Date().toISOString();

  try {
    const currentManifest = buildManifest(targetDir, options, options.file);

    if (options.planFile) {
      const planContent = readFileSync(resolve(options.planFile), "utf-8");
      const planData = JSON.parse(planContent) as RunArtifact;
      validateManifestMatch(planData.manifest, targetDir, options, options.file);
    }

    const client = resolveDbClient(options, dbClient);
    const migrations = await client.queryMigrations();
    if (migrations.length === 0) {
      throw new Error(`Database migrations check failed on target: ${target}`);
    }

    const { transactions } = loadSourceTransactions(targetDir, options);
    const preExisting = await client.queryExistingTransactions(options.userId, options.defaultCard);
    const preCount = preExisting.length;

    const report = classifyTransactions(transactions, preExisting, {
      manifestHash: currentManifest.manifestHash,
      target,
      userId: options.userId,
      card: options.defaultCard,
    });

    if (report.counts.conflicting > 0) {
      throw new Error(
        `Apply blocked: ${report.counts.conflicting} conflicting records detected. Review plan output before execution.`,
      );
    }

    const missingTxs = report.missingTransactions;
    const batchSize = 100;
    const statements = missingTxs.map(generateInsertSql);
    const totalBatches = Math.ceil(statements.length / batchSize);
    const completedBatches: number[] = [];
    const checkpointPath = resolveCheckpointPath(artifactsDir, runId);

    let writtenCount = 0;

    for (let i = 0; i < statements.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize);
      const chunk = statements.slice(i, i + batchSize);

      await client.executeBatch(chunk);
      writtenCount += chunk.length;
      completedBatches.push(batchIndex);

      const checkpointState: CheckpointState = {
        runId,
        manifestHash: currentManifest.manifestHash,
        target,
        userId: options.userId,
        defaultCard: options.defaultCard,
        totalBatches,
        completedBatches,
        writtenCount,
        lastUpdated: new Date().toISOString(),
      };
      saveCheckpoint(checkpointPath, checkpointState);
    }

    // Post-apply verification
    const postCount = await client.queryTransactionCount(options.userId, options.defaultCard);
    const expectedPostCount = preCount + missingTxs.length;
    const verificationPassed = postCount === expectedPostCount;

    if (verificationPassed) {
      deleteCheckpoint(checkpointPath);
    }

    const exitCode: BackfillExitCode = verificationPassed
      ? BACKFILL_EXIT_CODES.SUCCESS
      : BACKFILL_EXIT_CODES.VERIFICATION_FAILURE;

    const artifact: RunArtifact = {
      runId,
      command: "apply",
      target,
      userId: options.userId,
      defaultCard: options.defaultCard,
      manifestHash: currentManifest.manifestHash,
      manifest: currentManifest,
      parserVersion: BACKFILL_PARSER_VERSION,
      counts: {
        considered: transactions.length,
        alreadyPresent: report.counts.alreadyPresent,
        missing: missingTxs.length,
        conflicting: 0,
        extra: report.counts.extra,
        written: writtenCount,
        skipped: report.counts.alreadyPresent,
        failed: verificationPassed ? 0 : missingTxs.length - (postCount - preCount),
      },
      sampleMissingIds: report.sampleMissingIds,
      sampleAlreadyPresentIds: report.sampleAlreadyPresentIds,
      sampleExtraIds: report.sampleExtraIds,
      categoryBreakdown: report.categoryBreakdown,
      conflicts: [],
      verification: {
        preCount,
        postCount,
        expectedPostCount,
        passed: verificationPassed,
      },
      exitCode,
      createdAt: startTime,
      completedAt: new Date().toISOString(),
    };

    const artifactPath = writeRunArtifact(artifactsDir, artifact, "apply");
    return { artifact, artifactPath, exitCode };
  } finally {
    releaseLock();
  }
}

/**
 * Resumes an interrupted backfill from the last saved checkpoint.
 */
export async function resumeBackfill(
  options: BackfillOptions,
  dbClient?: BackfillDatabaseClient,
): Promise<{
  artifact: RunArtifact;
  artifactPath: string;
  exitCode: BackfillExitCode;
}> {
  if (options.dryRun) {
    throw new Error("Resume cannot be performed with --dry-run. Use plan to preview instead.");
  }

  const artifactsDir = getArtifactsDirectory(options);
  if (!options.runId) {
    throw new Error("Resume requires specifying a --run-id.");
  }

  const checkpointPath = resolveCheckpointPath(artifactsDir, options.runId);
  const checkpoint = loadCheckpoint(checkpointPath);
  if (!checkpoint) {
    throw new Error(`Checkpoint not found for run ID: ${options.runId}`);
  }

  const targetDir = resolveTargetDir(options.dir ?? "data/sheets");
  const currentManifest = buildManifest(targetDir, options, options.file);

  if (checkpoint.manifestHash !== currentManifest.manifestHash) {
    throw new Error(
      `Checkpoint manifest hash (${checkpoint.manifestHash.slice(0, 8)}) does not match current source manifest (${currentManifest.manifestHash.slice(0, 8)}). Cannot safely resume.`,
    );
  }

  const target = checkpoint.target;
  const optionsTarget = options.remote ? "remote" : options.local ? "local" : undefined;
  if (!dbClient && optionsTarget && optionsTarget !== target) {
    throw new Error(
      `Options target (${optionsTarget}) does not match checkpoint target (${target}). Cannot safely resume.`,
    );
  }

  const releaseLock = acquireBackfillLock(artifactsDir, {
    userId: checkpoint.userId,
    target,
    card: checkpoint.defaultCard,
  });

  try {
    const client =
      dbClient ??
      (target === "memory"
        ? new OfflineDatabaseClient()
        : new WranglerD1Client(target === "remote" ? "remote" : "local"));
    const { transactions } = loadSourceTransactions(targetDir, options);
    const preExisting = await client.queryExistingTransactions(options.userId, options.defaultCard);
    const preCount = preExisting.length;

    const report = classifyTransactions(transactions, preExisting, {
      manifestHash: currentManifest.manifestHash,
      target,
      userId: checkpoint.userId,
      card: checkpoint.defaultCard,
    });

    if (report.counts.conflicting > 0) {
      const artifact: RunArtifact = {
        runId: checkpoint.runId,
        command: "resume",
        target,
        userId: checkpoint.userId,
        defaultCard: checkpoint.defaultCard,
        manifestHash: currentManifest.manifestHash,
        manifest: currentManifest,
        parserVersion: BACKFILL_PARSER_VERSION,
        counts: {
          considered: transactions.length,
          alreadyPresent: report.counts.alreadyPresent,
          missing: report.missingTransactions.length,
          conflicting: report.counts.conflicting,
          extra: report.counts.extra,
          written: checkpoint.writtenCount,
          skipped: report.counts.alreadyPresent,
          failed: report.missingTransactions.length,
        },
        sampleMissingIds: report.sampleMissingIds,
        sampleAlreadyPresentIds: report.sampleAlreadyPresentIds,
        sampleExtraIds: report.sampleExtraIds,
        categoryBreakdown: report.categoryBreakdown,
        conflicts: report.conflicts,
        verification: {
          preCount,
          postCount: preCount,
          expectedPostCount: preCount,
          passed: false,
        },
        exitCode: BACKFILL_EXIT_CODES.EXECUTION_ERROR,
        createdAt: checkpoint.lastUpdated,
        completedAt: new Date().toISOString(),
        error: `Cannot resume: ${report.counts.conflicting} conflicting record(s) detected.`,
      };
      const artifactPath = writeRunArtifact(artifactsDir, artifact, "resume");
      return { artifact, artifactPath, exitCode: BACKFILL_EXIT_CODES.EXECUTION_ERROR };
    }

    const missingTxs = report.missingTransactions;
    const batchSize = 100;
    const statements = missingTxs.map(generateInsertSql);

    let writtenCount = checkpoint.writtenCount;
    const completedBatches: number[] = [];

    for (let i = 0; i < statements.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize);
      const chunk = statements.slice(i, i + batchSize);

      await client.executeBatch(chunk);
      writtenCount += chunk.length;
      completedBatches.push(batchIndex);

      saveCheckpoint(checkpointPath, {
        ...checkpoint,
        completedBatches,
        writtenCount,
        lastUpdated: new Date().toISOString(),
      });
    }

    const postCount = await client.queryTransactionCount(options.userId, options.defaultCard);
    const expectedPostCount = preCount + missingTxs.length;
    const verificationPassed = postCount === expectedPostCount;

    if (verificationPassed) {
      deleteCheckpoint(checkpointPath);
    }

    const exitCode: BackfillExitCode = verificationPassed
      ? BACKFILL_EXIT_CODES.SUCCESS
      : BACKFILL_EXIT_CODES.VERIFICATION_FAILURE;

    const artifact: RunArtifact = {
      runId: checkpoint.runId,
      command: "resume",
      target,
      userId: checkpoint.userId,
      defaultCard: checkpoint.defaultCard,
      manifestHash: currentManifest.manifestHash,
      manifest: currentManifest,
      parserVersion: BACKFILL_PARSER_VERSION,
      counts: {
        considered: transactions.length,
        alreadyPresent: report.counts.alreadyPresent,
        missing: missingTxs.length,
        conflicting: 0,
        extra: report.counts.extra,
        written: writtenCount,
        skipped: report.counts.alreadyPresent,
        failed: verificationPassed ? 0 : missingTxs.length - (postCount - preCount),
      },
      sampleMissingIds: report.sampleMissingIds,
      sampleAlreadyPresentIds: report.sampleAlreadyPresentIds,
      sampleExtraIds: report.sampleExtraIds,
      categoryBreakdown: report.categoryBreakdown,
      conflicts: [],
      verification: {
        preCount,
        postCount,
        expectedPostCount,
        passed: verificationPassed,
      },
      exitCode,
      createdAt: checkpoint.lastUpdated,
      completedAt: new Date().toISOString(),
    };

    const artifactPath = writeRunArtifact(artifactsDir, artifact, "resume");
    return { artifact, artifactPath, exitCode };
  } finally {
    releaseLock();
  }
}

/**
 * Read-only verification check comparing target database against source manifest.
 */
export async function verifyBackfill(
  options: BackfillOptions,
  dbClient?: BackfillDatabaseClient,
): Promise<{
  passed: boolean;
  report: ClassificationReport;
  exitCode: BackfillExitCode;
}> {
  const targetDir = resolveTargetDir(options.dir ?? "data/sheets");
  const manifest = buildManifest(targetDir, options, options.file);
  const { transactions } = loadSourceTransactions(targetDir, options);

  const client = resolveDbClient(options, dbClient);
  const existingDbTxs = await client.queryExistingTransactions(options.userId, options.defaultCard);

  const report = classifyTransactions(transactions, existingDbTxs, {
    manifestHash: manifest.manifestHash,
    target: client.target,
    userId: options.userId,
    card: options.defaultCard,
  });

  const isConsistent = report.counts.missing === 0 && report.counts.conflicting === 0;
  const exitCode: BackfillExitCode = isConsistent
    ? BACKFILL_EXIT_CODES.SUCCESS
    : BACKFILL_EXIT_CODES.VERIFICATION_FAILURE;

  return { passed: isConsistent, report, exitCode };
}

/**
 * Backward-compatible runBackfill wrapper for existing scripts and tests.
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
  const targetDir = resolveTargetDir(options.dir ?? "data/sheets");
  const { transactions, sheets } = loadSourceTransactions(targetDir, options);

  const categoryBreakdown: Record<string, number> = {};
  for (const tx of transactions) {
    const key = `${tx.parentBucket} -> ${tx.subcategory}`;
    categoryBreakdown[key] = (categoryBreakdown[key] || 0) + 1;
  }

  const summary: BackfillSummary = {
    sheets,
    totalValid: transactions.length,
    totalSkipped: sheets.reduce((acc, s) => acc + s.skippedRows, 0),
    totalUsd: transactions.filter((t) => t.currency === "USD").length,
    totalCad: transactions.filter((t) => t.currency === "CAD").length,
    categoryBreakdown,
  };

  if ((options.local || options.remote) && !options.dryRun && transactions.length > 0) {
    const batchSize = 100;
    const statements = transactions.map(generateInsertSql);

    for (let i = 0; i < statements.length; i += batchSize) {
      const chunk = statements.slice(i, i + batchSize);
      executeD1Batch(chunk, options.local, options.remote);
    }
  }

  return summary;
}
