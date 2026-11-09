import { parseArgs } from "node:util";
import {
  applyBackfill,
  planBackfill,
  resumeBackfill,
  runBackfill,
  verifyBackfill,
} from "./backfill/pipeline.ts";
import {
  BACKFILL_EXIT_CODES,
  type BackfillCommand,
  type BackfillOptions,
} from "./backfill/types.ts";

function printHelp(): void {
  console.log(`
Usage: node scripts/backfill.ts [command] [options]

Commands:
  plan                   Preview backfill and classify rows against D1 without database writes
  apply                  Execute batch insertions of missing transactions into D1 (requires --yes)
  resume                 Resume an interrupted backfill from the last saved checkpoint
  verify                 Read-only verification check comparing D1 records against source manifest

Options:
  --dir <path>           Directory containing CSV sheets (default: data/sheets)
  --file <path>          Specific CSV file to parse and backfill
  --plan-file <path>     Path to plan artifact JSON required for verified apply
  --run-id <id>          Durable run ID (required for resume)
  --artifacts-dir <path> Directory for run artifacts and locks (default: .backfill-runs)
  --local                Target local D1 database
  --remote               Target production Cloudflare D1
  --user-id <id>         Tenant user ID (default: usr_default)
  --default-card <card>  Fallback card name (default: Historical)
  --dry-run              Dry-run mode without database execution (default)
  --yes, --confirm       Confirm execution of database writes (required for apply)
  --help                 Show this help message
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      dir: { type: "string" },
      file: { type: "string" },
      "plan-file": { type: "string" },
      "run-id": { type: "string" },
      "artifacts-dir": { type: "string" },
      "dry-run": { type: "boolean" },
      local: { type: "boolean" },
      remote: { type: "boolean" },
      "user-id": { type: "string" },
      "default-card": { type: "string" },
      yes: { type: "boolean" },
      confirm: { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const isLocal = Boolean(values.local);
  const isRemote = Boolean(values.remote);
  if (isLocal && isRemote) {
    throw new Error("Choose either --local or --remote, not both.");
  }

  const rawCmd = positionals[0]?.toLowerCase();
  let command: BackfillCommand = "plan";
  let explicitCommand = false;

  if (rawCmd === "plan" || rawCmd === "apply" || rawCmd === "resume" || rawCmd === "verify") {
    command = rawCmd;
    explicitCommand = true;
  } else if (rawCmd) {
    throw new Error(`Unknown command: ${rawCmd}. Supported commands: plan, apply, resume, verify.`);
  } else {
    // Default command resolution when no positional argument provided
    if (values.yes || values.confirm) {
      command = "apply";
    } else if (values["run-id"]) {
      command = "resume";
    } else {
      command = "plan";
    }
  }

  const isExplicitDryRun = Boolean(values["dry-run"]);
  const isDryRun = isExplicitDryRun || command === "plan" || command === "verify";

  const options: BackfillOptions = {
    command,
    userId: values["user-id"] ?? "usr_default",
    defaultCard: values["default-card"] ?? "Historical",
    dryRun: isDryRun,
    local: isLocal,
    remote: isRemote,
    dir: values.dir ?? "data/sheets",
    file: values.file,
    planFile: values["plan-file"],
    runId: values["run-id"],
    artifactsDir: values["artifacts-dir"],
    yes: Boolean(values.yes) || Boolean(values.confirm),
  };

  const targetLabel = isRemote ? "Production D1" : isLocal ? "Local D1" : "Offline Parse";

  // If running legacy dry-run (no explicit "plan" subcommand, or explicit --dry-run without explicit plan)
  const isLegacyDryRun =
    (!explicitCommand && !isLocal && !isRemote) || (!explicitCommand && isExplicitDryRun);

  if (isLegacyDryRun) {
    console.log("Starting historical Google Sheets backfill [Mode: DRY RUN (no DB writes)]...\n");
    const summary = await runBackfill(options);

    console.log("=== Sheet Breakdown ===");
    console.table(summary.sheets);

    console.log("\n=== Categorization Distribution ===");
    console.table(summary.categoryBreakdown);

    console.log("\n=== Summary Totals ===");
    console.log(`Total Valid Transactions : ${summary.totalValid}`);
    console.log(`USD Transactions         : ${summary.totalUsd}`);
    console.log(`CAD Transactions         : ${summary.totalCad}`);
    console.log(`Skipped (0/empty/formula): ${summary.totalSkipped}`);
    console.log("\nDry run completed successfully. Zero database writes executed.");
    process.exit(BACKFILL_EXIT_CODES.SUCCESS);
  }

  if (isExplicitDryRun && command === "apply") {
    console.log(
      "Notice: --dry-run specified with apply. Rerouting to plan mode (zero database writes).\n",
    );
    command = "plan";
  }

  if (command === "plan") {
    console.log(
      `Starting historical Google Sheets backfill [Mode: DRY RUN (no DB writes)] [Target: ${targetLabel}]...\n`,
    );
    const { report, manifest, artifactPath, exitCode } = await planBackfill(options);

    console.log("=== Source Manifest ===");
    console.log(`Manifest Hash          : ${manifest.manifestHash}`);
    console.log(`Total Source Files     : ${manifest.files.length}`);
    console.log(
      `Total Source Rows      : ${manifest.files.reduce((acc, f) => acc + f.totalRows, 0)}`,
    );
    console.log(`Total Valid Tx Rows    : ${manifest.totalValidTransactions}`);
    console.log(`Total Skipped Rows     : ${manifest.totalSkippedRows}`);

    console.log("\n=== Target Database Classification ===");
    console.table([
      { Status: "Already Present in D1", Count: report.counts.alreadyPresent },
      { Status: "Missing from D1 (To Insert)", Count: report.counts.missing },
      { Status: "Conflicting / Modified", Count: report.counts.conflicting },
      { Status: "Extra in D1 (Not in Source)", Count: report.counts.extra },
      { Status: "Total In Database", Count: report.counts.totalDb },
    ]);

    console.log("\n=== Categorization Distribution ===");
    console.table(report.categoryBreakdown);

    console.log("\n=== Currency Breakdown ===");
    console.table(report.currencyBreakdown);

    console.log("\n=== Summary Totals ===");
    console.log(`Total Valid Transactions : ${report.counts.totalSource}`);
    console.log(`Already Present in D1    : ${report.counts.alreadyPresent}`);
    console.log(`Missing (Pending Insert) : ${report.counts.missing}`);
    console.log(`Conflicting Records      : ${report.counts.conflicting}`);
    console.log(`Extra Records in D1      : ${report.counts.extra}`);
    console.log(`Skipped (0/empty/formula): ${manifest.totalSkippedRows}`);

    if (report.sampleMissingIds.length > 0) {
      console.log("\nSample Missing Transaction IDs (To Insert):");
      for (const id of report.sampleMissingIds) {
        console.log(`  + ${id}`);
      }
    }

    if (report.conflicts.length > 0) {
      console.log("\n=== CONFLICTS DETECTED ===");
      console.table(report.conflicts);
      console.log("Warning: Conflicts detected. Review before applying.");
    }

    console.log(`\nPlan artifact saved: ${artifactPath}`);
    console.log("\nDry run completed successfully. Zero database writes executed.");
    process.exit(exitCode);
  }

  if (command === "apply") {
    if (!options.yes) {
      console.error(
        "Apply requires explicit confirmation. Supply --yes to approve database writes.",
      );
      process.exit(BACKFILL_EXIT_CODES.APPROVAL_REQUIRED);
    }

    console.log(
      `Executing historical Google Sheets backfill [Mode: APPLY] [Target: ${targetLabel}]...\n`,
    );
    const { artifact, artifactPath, exitCode } = await applyBackfill(options);

    console.log("=== Execution Results ===");
    console.log(`Run ID                   : ${artifact.runId}`);
    console.log(`Target                   : ${targetLabel}`);
    console.log(`Transactions Inserted    : ${artifact.counts.written}`);
    console.log(`Transactions Skipped     : ${artifact.counts.skipped}`);
    console.log(`Pre-Execution DB Count   : ${artifact.verification.preCount}`);
    console.log(`Post-Execution DB Count  : ${artifact.verification.postCount}`);
    console.log(`Verification Status      : ${artifact.verification.passed ? "PASSED" : "FAILED"}`);
    console.log(`\nRun artifact saved: ${artifactPath}`);

    if (artifact.verification.passed) {
      console.log("\nBackfill execution completed successfully.");
    } else {
      console.error(
        "\nBackfill verification failed: post-execution count does not match expected inserts.",
      );
    }
    process.exit(exitCode);
  }

  if (command === "resume") {
    if (isExplicitDryRun) {
      throw new Error("Resume cannot be performed with --dry-run. Use plan to preview instead.");
    }

    console.log(
      `Resuming historical Google Sheets backfill [Mode: RESUME] [Target: ${targetLabel}]...\n`,
    );
    const { artifact, artifactPath, exitCode } = await resumeBackfill(options);

    console.log("=== Resume Execution Results ===");
    console.log(`Run ID                   : ${artifact.runId}`);
    console.log(`Transactions Inserted    : ${artifact.counts.written}`);
    console.log(`Verification Status      : ${artifact.verification.passed ? "PASSED" : "FAILED"}`);
    console.log(`\nRun artifact saved: ${artifactPath}`);
    process.exit(exitCode);
  }

  if (command === "verify") {
    console.log(
      `Verifying historical Google Sheets backfill [Mode: VERIFY] [Target: ${targetLabel}]...\n`,
    );
    const { passed, report, exitCode } = await verifyBackfill(options);

    console.log("=== Verification Report ===");
    console.table([
      { Status: "Already Present in D1", Count: report.counts.alreadyPresent },
      { Status: "Missing from D1", Count: report.counts.missing },
      { Status: "Conflicting Records", Count: report.counts.conflicting },
      { Status: "Extra in D1", Count: report.counts.extra },
    ]);
    console.log(`Verification Status: ${passed ? "PASSED (Consistent)" : "DRIFT DETECTED"}`);
    process.exit(exitCode);
  }
}

main().catch((err: unknown) => {
  console.error("Backfill pipeline failed:", err);
  process.exit(BACKFILL_EXIT_CODES.EXECUTION_ERROR);
});
